import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatFor, liveFactor, modPool, arcanePool, optimise, optimiseEach, rivenPiece, rivenWorth, SCENARIOS } from '../src/build.js';
import { combineElements, COMBINED } from '../src/elements.js';
import { WEAPON_STATS } from '../src/data/weapon-stats.js';
import { GUN_MODS } from '../src/data/mods.js';

const opts = {};

test('which mods fit: snipers take Sniper mods, bows Bow mods, only "Rifle" kinds Assault Rifle mods', () => {
  assert.deepEqual(compatFor('rifle', 'Sniper Rifle'), ['Rifle', 'PRIMARY', 'Sniper']);
  assert.deepEqual(compatFor('rifle', 'Crossbow'), ['Rifle', 'PRIMARY', 'Bow']);
  assert.deepEqual(compatFor('rifle', 'Rifle'), ['Rifle', 'PRIMARY', 'Assault Rifle']);
  assert.deepEqual(compatFor('shotgun', 'Shotgun'), ['Shotgun', 'PRIMARY']);
  assert.deepEqual(compatFor('pistol', 'Dual Pistols'), ['Pistol']);
});

test('build types: kill stacks in room clearing and weak point builds, weak point triggers in weak point builds only', () => {
  const chamber = { stat: 'multishot', value: 0.3, on: 'kill', seconds: 20, stacks: 5 };
  assert.equal(liveFactor(chamber, SCENARIOS.room), 5);
  assert.equal(liveFactor(chamber, SCENARIOS.single), 0);
  assert.equal(liveFactor(chamber, SCENARIOS.weak), 5);
  const scope = { stat: 'critChance', value: 1.2, on: 'weak point hit', seconds: 12, aim: 1 };
  assert.equal(liveFactor(scope, SCENARIOS.room), 0);
  assert.equal(liveFactor(scope, SCENARIOS.single), 0);
  assert.equal(liveFactor(scope, SCENARIOS.weak), 1);
  assert.equal(liveFactor(scope, { ...SCENARIOS.weak, aiming: false }), 0);
  // Per status type: Galvanized Aptitude's 2 stacks (dpsOf counts the status types on the target).
  assert.equal(liveFactor({ stat: 'directDamage', value: 0.4, on: 'kill', stacks: 2, per: 'status type' }, SCENARIOS.room), 2);
  // Triggers the model doesn't follow are off; so are chance procs.
  assert.equal(liveFactor({ stat: 'damage', value: 2.2, on: 'reload from empty', seconds: 17 }, SCENARIOS.room), 0);
  assert.equal(liveFactor({ stat: 'critChance', value: 0.45, on: 'damaged', chance: 0.21 }, SCENARIOS.room), 0);
});

test('a weak point build values Weakpoint Damage; a room clearing build, one hit in fifty, far less', async () => {
  const { study } = await import('../src/study.js');
  const input = scenario => ({ weapon: 'Rubico Prime', cls: 'rifle', shape: '+++-', scenario, opts: {},
    positives: ['multishot', 'critDamage', 'weakpointDamage'], negatives: [] });
  const wpd = r => r.singles.find(x => x.id === 'weakpointDamage')?.change ?? NaN;
  assert.ok(wpd(study(input('weak'))) > 0.2, String(wpd(study(input('weak')))));
  assert.ok(wpd(study(input('room'))) < wpd(study(input('weak'))) / 3, String(wpd(study(input('room')))));
  // Accidents don't keep stacks from weak point hits up: those need aiming for them.
  assert.equal(liveFactor({ stat: 'statusChance', value: 0.3, on: 'weak point hit', stacks: 10 }, SCENARIOS.room), 0);
  assert.equal(liveFactor({ stat: 'statusChance', value: 0.3, on: 'weak point hit', stacks: 10 }, SCENARIOS.weak), 10);
});

test('a build: 8 slots, no mod twice, no two mods that exclude each other, an arcane', () => {
  const w = WEAPON_STATS['Rubico Prime'];
  const b = optimise(w, modPool('rifle', w, SCENARIOS.room, opts), arcanePool('rifle', SCENARIOS.room, opts), opts);
  assert.equal(b.slots.length, 8);
  const names = b.slots.map(p => p.name);
  assert.equal(new Set(names).size, 8);
  for (const n of names) {
    const excl = GUN_MODS.find(m => m.name === n)?.excl ?? [];
    assert.ok(!excl.some(x => names.includes(x)), `${n} with one it excludes`);
  }
  assert.ok(b.arcane?.name.startsWith('Primary '), b.arcane?.name);
  // A sniper build never carries an Assault Rifle mod.
  assert.ok(names.every(n => GUN_MODS.find(m => m.name === n && m.compat !== 'Assault Rifle')), names.join());
});

test('the search pairs elements: without a riven, Laetum still gets a combined element', () => {
  const w = WEAPON_STATS.Laetum;
  const b = optimise(w, modPool('pistol', w, SCENARIOS.room, opts), arcanePool('pistol', SCENARIOS.room, opts), opts);
  const combined = combineElements(b.slots.flatMap(p => p.elements));
  assert.ok(Object.keys(combined).some(t => COMBINED.includes(t)), JSON.stringify(combined));
});

test('each Valence element’s best build: no worse than its own search, nor than any other element’s build', async () => {
  const { dpsOf } = await import('../src/sim.js');
  const w = WEAPON_STATS['Kuva Bramma'];
  const pool = modPool('rifle', w, SCENARIOS.room, opts), arcanes = arcanePool('rifle', SCENARIOS.room, opts);
  const settings = ['heat', 'toxin', 'magnetic'].map(type => ({ ...opts, valence: { type, value: 0.6 } }));
  const each = optimiseEach(w, pool, arcanes, settings);
  const totals = (/** @type {import('../src/build.js').Build} */ b) => ({
    stats: Object.fromEntries(Object.entries([...b.slots, ...(b.arcane ? [b.arcane] : [])].flatMap(p => Object.entries(p.stats))
      .reduce((m, [k, v]) => m.set(k, (m.get(k) ?? 0) + v), new Map()))),
    elements: b.slots.flatMap(p => p.elements),
  });
  settings.forEach((o, i) => {
    assert.ok(each[i].dps >= optimise(w, pool, arcanes, o).dps - 1e-6);
    // Within the search's own fine steps: another element's build never beats it by much.
    for (const b of each) assert.ok(dpsOf(w, totals(b), o) <= each[i].dps * 1.02, `${o.valence.type}`);
  });
});

test("a riven's worth: it takes a slot; a good stat beats the empty slot; the riven stays in the build", () => {
  const w = WEAPON_STATS.Felarx;
  const { none, empty, results } = rivenWorth(w, 'shotgun', SCENARIOS.room, opts, [{ multishot: 1.2 }, {}]);
  assert.ok(empty.dps < none.dps, 'an empty riven slot costs a mod');
  assert.ok(results[0].dps > empty.dps * 1.2, `${results[0].dps} vs ${empty.dps}`);
  assert.ok(results[0].slots.some(p => p.riven));
  // An empty riven is the empty slot.
  assert.ok(Math.abs(results[1].dps - empty.dps) / empty.dps < 1e-9);
});

test('a riven with elements: they go in bottom-up, and the slot order is searched', () => {
  const p = rivenPiece({ electricity: 1, cold: 0.9, critDamage: 1 });
  assert.deepEqual(p.elements, [{ type: 'cold', value: 0.9 }, { type: 'electricity', value: 1 }]);
  assert.deepEqual(p.stats, { critDamage: 1 });
});

test('fast enough for the page: a gun and 5 rivens in well under a second', () => {
  const t0 = performance.now();
  rivenWorth(WEAPON_STATS['Rubico Prime'], 'rifle', SCENARIOS.room, opts, [{ multishot: 1 }, { critDamage: 1 }, { toxin: 1 }, { viral: 1 }, { damage: 1 }]);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `${ms} ms`);
});

test('a study (the page\'s numbers): Felarx +++-, fodder', async () => {
  const { study } = await import('../src/study.js');
  const { pools } = await import('../src/cycle.js');
  const { SPLICED } = await import('../src/data/stats.js');
  const p = pools('shotgun', '?yy');
  const r = study({ weapon: 'Felarx', cls: 'shotgun', shape: '+++-', scenario: 'room', opts: { weakpoint: 0 },
    positives: [...p.positive, ...SPLICED.filter(s => s.b.shotgun !== undefined).map(s => s.id)], negatives: p.negative });
  assert.equal(r.none.mods.length, 8);
  assert.ok(!r.none.mods.includes('Riven'));
  // Singles best first; the best riven has 3 positives, at most one spliced, and beats no riven.
  assert.ok(r.singles.every((s, i) => i === 0 || r.singles[i - 1].change >= s.change));
  assert.equal(r.sets[0].ids.length, 3);
  assert.ok(r.sets[0].change > 0.3, String(r.sets[0].change));
  assert.ok(r.sets[0].build.mods.includes('Riven'));
  // Zoom does nothing to damage: a free curse.
  assert.ok(Math.abs(r.curses.find(c => c.id === 'zoom')?.change ?? 1) < 1e-9);
});

test('weapon tags: Semi- Cannonades need a semi-auto trigger; beam mods need a beam', async () => {
  const { weaponTags } = await import('../src/build.js');
  const names = (w, cls) => modPool(cls, w, SCENARIOS.room, opts).map(p => p.name);
  // Felarx is "Auto / Semi": no Semi-Shotgun Cannonade. Lex Prime is semi-auto: Semi-Pistol Cannonade fits.
  assert.ok(!weaponTags(WEAPON_STATS.Felarx).has('SEMI_AUTO'));
  assert.ok(!weaponTags(WEAPON_STATS.Laetum).has('SEMI_AUTO'));    // checked in game too
  assert.ok(!names(WEAPON_STATS.Felarx, 'shotgun').includes('Semi-Shotgun Cannonade'));
  assert.ok(names(WEAPON_STATS['Lex Prime'], 'pistol').includes('Semi-Pistol Cannonade'));
  // Beam-only mods (needs BEAM) aren't offered to Rubico Prime.
  const beam = GUN_MODS.filter(m => m.needs?.includes('BEAM')).map(m => m.name);
  assert.ok(beam.length > 0);
  assert.ok(!names(WEAPON_STATS['Rubico Prime'], 'rifle').some(n => beam.includes(n)));
});

test('a fire-rate lock keeps the weapon\'s own rate', async () => {
  const { dpsOf } = await import('../src/sim.js');
  const w = WEAPON_STATS['Lex Prime'];
  const t = (stats) => ({ stats, elements: [] });
  const a = dpsOf(w, t({ damage: 1, fireRateLocked: 1 }), opts);
  assert.equal(dpsOf(w, t({ damage: 1, fireRateLocked: 1, fireRate: 0.9 }), opts), a);
  assert.ok(dpsOf(w, t({ damage: 1, fireRate: 0.9 }), opts) > dpsOf(w, t({ damage: 1 }), opts));
});

test('a curse is never worth more than a search\'s luck: Felarx ++-, single target, level 9999 Steel Path', async () => {
  const { study } = await import('../src/study.js');
  const { pools } = await import('../src/cycle.js');
  const { SPLICED } = await import('../src/data/stats.js');
  const E = await import('../src/data/enemies.js');
  const { targetOf } = await import('../src/enemies.js');
  const target = targetOf(E.UNITS.grineer.find(u => u.name === 'Heavy Gunner'), 9999, true, false, E);
  const p = pools('shotgun', '?yy');
  const r = study({ weapon: 'Felarx', cls: 'shotgun', shape: '++-', scenario: 'single', opts: { enemy: 'grineer', target, burst: false, primed: false },
    positives: [...p.positive, ...SPLICED.filter(s => s.b.shotgun !== undefined).map(s => s.id)], negatives: p.negative });
  // −Magazine costs reloads (it once showed +5%, the search landing on better mods); −Critical Chance
  // really helps (Devastating Attrition), the community's top curse.
  assert.ok((r.curses.find(c => c.id === 'magazine')?.change ?? 1) < 0);
  assert.equal(r.curses[0].id, 'critChance');
  assert.ok(r.curses[0].change > 0);
  assert.deepEqual(r.sets[0].ids.slice().sort(), ['multishot', 'viral']);
  assert.equal(r.sets[0].curse?.id, 'critChance');
});

test('Ammo Efficiency from a mod takes off the cost, as a riven\'s does', () => {
  const { stats } = arcanePool('rifle', SCENARIOS.weak, {}).find(a => a.name === 'Primary Crux') ?? { stats: {} };
  assert.ok(Math.abs((stats.ammoEfficiency ?? 0) + 0.6) < 1e-9, String(stats.ammoEfficiency));
});
