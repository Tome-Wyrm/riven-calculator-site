import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPerks, bestPerks, evolutionsOf } from '../src/incarnon.js';
import { dps, critScale, BUILDS } from '../src/sim.js';
import { WEAPON_STATS } from '../src/data/weapon-stats.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const perk = (weapon, name) => {
  const evos = evolutionsOf(weapon);
  return evos.map(e => e.perks.findIndex(p => p.name === name));
};

test('Felarx: its evolutions from Underframe', () => {
  const names = evolutionsOf('Felarx').map(e => e.perks.map(p => p.name));
  assert.deepEqual(names[2], ['Brutal Edge', 'Incarnon Catalyst', 'Wracking Wrath']);
  assert.equal(names[3][0], 'Devastating Attrition');
  assert.deepEqual(evolutionsOf('Felarx')[3].perks[0].effects, [{ kind: 'nonCrit', value: 20, chance: 0.5 }]);
  assert.deepEqual(evolutionsOf('Not A Gun'), []);
});

test('perks change the base numbers: crit and status per form, base damage to normal attacks', () => {
  const w = WEAPON_STATS.Felarx;
  const brutal = withPerks(w, 'Felarx', perk('Felarx', 'Brutal Edge'));
  const [normal, form] = [brutal.modes[0].parts[0], brutal.modes[1].parts[0]];
  near(normal.cc, w.modes[0].parts[0].cc + 0.1);
  near(normal.sc, w.modes[0].parts[0].sc + 0.025);        // +2.5% per projectile
  near(form.sc, w.modes[1].parts[0].sc + 0.1);            // +10% for Incarnon Form
  assert.equal(w.modes[0].parts[0].cc, 0.2);              // the original is untouched
  // Boar Prime's Fortress Salvo (in game): each pellet 40 + 16 for mods to scale from, 72 in the hit,
  // each type in proportion; the form's Heat 30 + 16, once.
  const b = WEAPON_STATS['Boar Prime'];
  const salvo = withPerks(b, 'Boar Prime', perk('Boar Prime', 'Fortress Salvo'));
  const sum = d => Object.values(d).reduce((x, y) => x + y, 0);
  near(sum(salvo.modes[0].parts[0].dmg), 72, 1e-6);
  near(salvo.modes[0].parts[0].base ?? 0, 56, 1e-6);
  near(sum(salvo.modes[1].parts[0].dmg), 46, 1e-6);
  near(salvo.modes[1].parts[0].base ?? 0, 46, 1e-6);
});

test('Boar Prime with Fortress Salvo lands what the game showed (2026-11-05)', async () => {
  const { fight } = await import('../src/fight.js');
  const picks = evolutionsOf('Boar Prime').map(e => e.perks.findIndex(p => p.name === 'Fortress Salvo'));
  const w = withPerks(WEAPON_STATS['Boar Prime'], 'Boar Prime', picks);
  for (const m of w.modes) for (const p of m.parts) p.cc = 0;
  const head = (/** @type {object} */ t, /** @type {number} */ mode, stats = {}, elements = /** @type {{type: string, value: number}[]} */ ([])) => fight(w, { stats, elements }, { target: { health: 1e9, shields: 0, armor: 0, weak: {}, shieldWeak: {}, ...t }, mode, weakpoint: 1, enemy: 'grineer', targets: 20, burst: true }).perShot;
  // A pellet, non-crit, on heads: an Ancient Healer's, no armor, Slash +50%: 236; a level 235 Heavy
  // Gunner's, 2700 armor, Impact +50%: 29 (143 crit, x 5). 8 pellets: exactly what the game rounds to.
  assert.equal(Math.round(head({ weak: { slash: 0.5 } }, 0) / 8), 236);
  assert.equal(Math.round(head({ armor: 2700, weak: { impact: 0.5 } }, 0) / 8), 29);
  assert.equal(Math.round(head({ armor: 2700, weak: { impact: 0.5 } }, 0) / 8 * 5), 143);
  // The form with Primed Charged Shell: 122.1875 x 3 and Multishot, rolled 6 and 7 a tick in game:
  // 2,199 and 2,566, on armor 220 and 257.
  const tick = (/** @type {number} */ rolled, /** @type {object} */ t = {}) => Math.round(head(t, 1, { multishot: rolled - 1 }, [{ type: 'electricity', value: 1.65 }]));
  assert.equal(tick(6), 2199);
  assert.equal(tick(7), 2566);
  assert.equal(tick(6, { armor: 2700 }), 220);
  assert.equal(tick(7, { armor: 2700 }), 257);
});

test('the non-crit bonus: 50% chance of +2000% on hits that don’t crit, gone at 100% crit', () => {
  const p = { nonCrit: { chance: 0.5, mult: 20 } };
  near(critScale(0, 2, p), 11);
  near(critScale(0.2, 2, p), 1 + 0.2 + 0.8 * 10);
  near(critScale(1, 2, p), 2);
  near(critScale(1.5, 2, p), 2.5);
});

test('Felarx: the best perks avoid crit, and a crit chance curse helps', () => {
  const w = WEAPON_STATS.Felarx;
  const o = { weakpoint: 0 };
  const picks = bestPerks(w, 'Felarx', 'shotgun', o);
  const names = evolutionsOf('Felarx').map((e, i) => e.perks[picks[i]]?.name);
  assert.equal(names[2], 'Wracking Wrath');
  assert.equal(names[3], 'Devastating Attrition');
  const ev = withPerks(w, 'Felarx', picks);
  const curse = x => dps(x, 'shotgun', { critChance: -0.5 }, o) / dps(x, 'shotgun', {}, o) - 1;
  assert.ok(curse(w) < 0, 'unevolved: crit chance helps');
  assert.ok(curse(ev) > 0, 'evolved: losing crit chance helps');
});

test('perk fire rate adds to the mods (in game: Laetum, +100% mods and Rapid Wrath: 2.5 x 2.2 = 5.5)', () => {
  const w = WEAPON_STATS.Laetum;
  const fast = withPerks(w, 'Laetum', perk('Laetum', 'Rapid Wrath'));
  assert.deepEqual(fast.bonus, { fireRate: 0.2 });
  assert.equal(fast.modes[0].rate, w.modes[0].rate);
  // Burst DPS against the same build: (1 + mods + 0.2) / (1 + mods). (Without status, so that faster
  // stacking doesn't add to it.)
  const o = { weakpoint: 0, burst: true };
  const calm = x => ({ ...x, modes: x.modes.map(m => ({ ...m, parts: m.parts.map(p => ({ ...p, sc: 0 })) })) });
  const at = (x, mods) => dps(calm(x), 'pistol', mods, o);
  const B = BUILDS.pistol.fireRate ?? 0;                     // the reference build's own fire rate mods
  near(at(fast, { fireRate: 1 }) / at(w, { fireRate: 1 }), (1 + B + 1 + 0.2) / (1 + B + 1), 1e-9);
});

test('No adapter, normal fire, Incarnon: a gun without its adapter has no perks; a natural Incarnon always evolves', async () => {
  const { study } = await import('../src/study.js');
  const { pools } = await import('../src/cycle.js');
  const { takesAdapter, isForm } = await import('../src/incarnon.js');
  assert.ok(takesAdapter('Soma') && takesAdapter('Soma Prime'));
  assert.ok(!takesAdapter('Felarx') && !takesAdapter('Onos') && !takesAdapter('Dual Cestra'));
  const p = pools('rifle', '?yy');
  const run = (/** @type {object} */ o) => study({ weapon: 'Soma Prime', cls: 'rifle', shape: '++-', scenario: 'room', opts: { weakpoint: 0 }, positives: p.positive, negatives: p.negative, ...o });
  const form = WEAPON_STATS['Soma Prime'].modes.findIndex(isForm);
  const normal = run({ adapter: false }), off = run({}), on = run({ opts: { weakpoint: 0, mode: form } });
  assert.deepEqual(normal.perks, []);
  assert.ok(off.perks.length > 0 && on.perks.length > 0);
  assert.ok(off.none.dps > normal.none.dps, `${off.none.dps} vs ${normal.none.dps}`);
  assert.notEqual(on.none.dps, off.none.dps);
});

test('Incarnon charge: every gun has its gauge; Boar takes 50 weak point hits, Laetum\'s form holds 216 (both in game)', async () => {
  const { cycleOf } = await import('../src/incarnon.js');
  for (const name of Object.keys((await import('../src/data/incarnons.js')).INCARNONS)) {
    const c = cycleOf(name, WEAPON_STATS[name]);
    assert.ok(c && c.hits > 0 && c.ammo > 0, name);
    assert.ok(!/incarnon/i.test(WEAPON_STATS[name].modes[c.normal].name), name);
  }
  assert.deepEqual(cycleOf('Boar', WEAPON_STATS.Boar), { hits: 50, any: false, ammo: 150, normal: 0 });
  assert.equal(cycleOf('Laetum', WEAPON_STATS.Laetum)?.ammo, 216);
  assert.equal(cycleOf('Stug', WEAPON_STATS.Stug)?.any, true);
});

test('perks follow the mode: normal fire, the form and the cycle can each want different ones', async () => {
  const { cycleOf, isForm } = await import('../src/incarnon.js');
  const w = WEAPON_STATS.Boltor;
  const target = { health: 300000, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const base = { target, targets: 20, enemy: 'grineer', weakpoint: 0.02 };
  const form = w.modes.findIndex(isForm);
  const names = (/** @type {number[]} */ p) => p.map((k, i) => evolutionsOf('Boltor')[i].perks[k]?.name);
  const normal = names(bestPerks(w, 'Boltor', 'rifle', { ...base, mode: w.main }));
  const inForm = names(bestPerks(w, 'Boltor', 'rifle', { ...base, mode: form }));
  const cycle = names(bestPerks(w, 'Boltor', 'rifle', { ...base, mode: form, incarnon: { ...cycleOf('Boltor', w), share: 0.75 } }));
  // The cycle reloads and swaps, so it takes the reload perk the form alone has no use for.
  assert.ok(cycle.includes('Rapid Reinforcement') && !inForm.includes('Rapid Reinforcement'), String(cycle));
  assert.notDeepEqual(cycle, normal);
});

test('a form\'s status perk reaches its hit, not its radial attack (in game: Laetum, 42% and 22.2%)', () => {
  const w = withPerks(WEAPON_STATS.Laetum, 'Laetum', [0, 0, 2, 0]);
  const form = w.modes.find(m => /incarnon/i.test(m.name));
  near(form?.parts[0].sc ?? 0, 0.42);
  near(form?.parts[1].sc ?? 0, 0.22);
  near(w.modes[0].parts[0].sc, 0.42);
});
