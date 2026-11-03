import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dps, statEffects, bestSets, BUILDS, NO_DPS } from '../src/sim.js';
import { WEAPON_STATS } from '../src/data/weapon-stats.js';
import { pools } from '../src/cycle.js';
import { SPLICED } from '../src/data/stats.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// A plain test gun: one part, no status, no reload.
const gun = (part = {}, extra = {}) => ({
  mag: 0, reload: 0, ammo: 100, trigger: 'Auto', tags: [], main: 0,
  modes: [{ name: 'Normal Attack', rate: 10, cost: 1, parts: [{ name: 'Normal Attack', dmg: { puncture: 50, heat: 50 }, cc: 0.2, cd: 2, sc: 0, ms: 1, ...part }] }],
  ...extra,
});
const gain = (w, mods, opts = { weakpoint: 0 }) => dps(w, 'rifle', mods, opts) / dps(w, 'rifle', {}, opts) - 1;
const R = BUILDS.rifle;

test('Damage, Multishot and Fire Rate scale everything: gain = v / their build total', () => {
  near(gain(gun(), { damage: 1 }), 1 / (1 + R.damage));
  near(gain(gun(), { multishot: 1 }), 1 / (1 + R.multishot));
  near(gain(gun(), { fireRate: 0.5 }), 0.5);
});

test('crit: the average multiplier 1 + CC × (CD − 1)', () => {
  const cc = 0.2 * (1 + R.critChance), cd = 2 * (1 + R.critDamage);
  const base = 1 + cc * (cd - 1);
  near(gain(gun(), { critDamage: 1 }), (1 + cc * (2 * (1 + R.critDamage + 1) - 1)) / base - 1);
  // No crit chance: crit damage is worthless.
  near(gain(gun({ cc: 0 }), { critDamage: 1 }), 0);
});

test('an element adds a share of the base; physical stats only their own part', () => {
  near(gain(gun(), { toxin: 1 }), 1 / (1 + R.element));
  near(gain(gun(), { puncture: 1 }), 50 / (100 * (1 + R.element)));
  // A curse on a type the weapon doesn't have costs nothing.
  near(gain(gun(), { impact: -0.7 }), 0);
});

test('status: Toxin adds DoT, Viral (no DoT) doesn’t; Status Chance does nothing without DoT types', () => {
  const w = gun({ sc: 0.3, dmg: { puncture: 100 } });
  assert.ok(gain(w, { toxin: 1 }) > gain(w, { viral: 1 }) + 0.01);
  near(gain(w, { statusChance: 1 }), 0);
  const slashy = gun({ sc: 0.3, dmg: { slash: 100 } });
  assert.ok(gain(slashy, { statusChance: 1 }) > 0.05);
  assert.ok(gain(slashy, { statusDuration: 1 }) > 0 && gain(slashy, { statusDamage: 1 }) > 0);
});

test('faction damage counts only against that faction', () => {
  near(gain(gun(), { grineer: 0.5 }), 0);
  near(gain(gun(), { grineer: 0.5 }, { weakpoint: 0, enemy: 'grineer' }), 0.5);
});

test('weak points (the wiki, Update 44): head multiplier + 1.5 x Weakpoint Damage, x headshot bonuses', () => {
  // Body shots: weak point stats do nothing.
  near(gain(gun(), { weakpointDamage: 2 }), 0);
  // Every hit on a 3x head: 3 + 1.5 x 2 = 6, so damage doubles.
  near(gain(gun(), { weakpointDamage: 2 }, { weakpoint: 1 }), 1);
  // The page's example: 3x head, Primary Acuity (+350%) and Seek (+75%): 3 + 1.5 x 4.25 = 9.375;
  // with Deadhead and Prowl (+30% +40% headshot multiplier): x 1.7 = 15.9375.
  const t = { weakpoint: 1, headcrit: false };
  const at = mods => dps(gun({ cc: 0 }), 'rifle', mods, t);
  near(at({ weakpointDamage: 4.25 }) / at({}), 9.375 / 3, 1e-9);
  near(at({ weakpointDamage: 4.25, headshotMultiplier: 0.7 }) / at({}), 15.9375 / 3, 1e-9);
  // A Murmur / Techrot weak point (1.5x): 1.5 + 1.5 x 2 = 4.5, three times the bare 1.5.
  near(dps(gun({ cc: 0 }), 'rifle', { weakpointDamage: 2 }, { weakpoint: 1, headMult: 1.5 }) / dps(gun({ cc: 0 }), 'rifle', {}, { weakpoint: 1, headMult: 1.5 }), 3);
  // Weakpoint Crit Chance is Crit Chance's bucket on weak point hits: equal when every hit is one.
  near(gain(gun(), { weakpointCrit: 1 }, { weakpoint: 1 }), gain(gun(), { critChance: 1 }, { weakpoint: 1 }));
  assert.ok(gain(gun(), { weakpointCrit: 1 }, { weakpoint: 0.5 }) < gain(gun(), { critChance: 1 }, { weakpoint: 0.5 }));
});

test('critical headshots double the crit multiplier, where the enemy allows it', () => {
  const g = gun({ cc: 1, cd: 2 });                          // every shot crits, x2 crit multiplier
  const head = headcrit => dps(g, 'rifle', {}, { weakpoint: 1, headcrit });
  // With the reference build's +180% CD: crit multiplier 2 x 2.8 = 5.6, doubled to 11.2.
  near(head(true) / head(false), (1 + 2.5 * (11.2 - 1)) / (1 + 2.5 * (5.6 - 1)), 1e-9);
});

test('explosions are never weak point hits', () => {
  const blast = gun({ aoe: 1 });
  near(dps(blast, 'rifle', { weakpointDamage: 2 }, { weakpoint: 1 }) / dps(blast, 'rifle', {}, { weakpoint: 1 }), 1);
});

test("Galvanized's Direct Damage: added to Damage, or multiplying on the attacks that do (Coda Bassocyst)", async () => {
  const { dpsOf } = await import('../src/sim.js');
  const t = stats => ({ stats, elements: [] });
  const ratio = part => dpsOf(gun(part), t({ damage: 3, directDamage: 1 })) / dpsOf(gun(part), t({ damage: 3 }));
  near(ratio({}), 5 / 4);                                   // (1 + 3 + 1) / (1 + 3)
  near(ratio({ co: [1, 1] }), 2);                           // (1 + 3) x (1 + 1)
  near(ratio({ co: [0.5] }), 4.5 / 4);                      // half of it
  near(ratio({ co: [0] }), 1);                              // none (explosions)
  assert.deepEqual(WEAPON_STATS['Coda Bassocyst'].modes[0].parts[0].co, [1, 1]);
});

test('sustained: reloads dilute Fire Rate; Magazine, Reload Speed and Ammo Efficiency help', () => {
  const w = gun({}, { mag: 20, reload: 2 });       // 2 s firing, 2 s reloading
  assert.ok(gain(w, { fireRate: 0.5 }) < 0.5 && gain(w, { fireRate: 0.5 }) > 0);
  near(gain(w, { fireRate: 0.5 }, { weakpoint: 0, burst: true }), 0.5);
  near(gain(w, { reloadSpeed: 1 }), (2 / 3) / (2 / 4) - 1);          // reload 2 s → 1 s
  near(gain(w, { magazine: 1 }), (4 / 6) / (2 / 4) - 1);             // 40 shots: 4 s firing
  near(gain(w, { ammoEfficiency: -0.5 }), (4 / 6) / (2 / 4) - 1);    // half the ammo per shot
  // A one-arrow magazine can't be modded.
  near(gain(gun({}, { mag: 1, reload: 1 }), { magazine: -0.5 }), 0);
});

test('Incarnon modes: the magazine stats do nothing', () => {
  const w = gun({}, { mag: 20, reload: 2 });
  w.modes[0].name = 'Incarnon Form';
  near(gain(w, { magazine: 1 }), 0);
  near(gain(w, { ammoEfficiency: -0.5 }), 0);
  near(gain(w, { magazine: -0.5 }), 0);
});

test('QoL stats have no DPS effect', () => {
  for (const id of NO_DPS) near(gain(gun({ sc: 0.3 }, { mag: 20, reload: 2 }), { [id]: 1 }), 0);
});

test('real guns: every one gives a finite, positive DPS', () => {
  for (const [name, w] of Object.entries(WEAPON_STATS)) {
    for (let mode = 0; mode < w.modes.length; mode++) {
      const d = dps(w, 'rifle', {}, { mode });
      assert.ok(Number.isFinite(d) && d >= 0, `${name} mode ${mode}: ${d}`);
    }
    assert.ok(dps(w, 'rifle', {}) > 0, name);
  }
});

test('Felarx +++- (the community: MS, then Viral / Corrosive / Ammo Efficiency): Multishot leads, Ammo Efficiency next', () => {
  const w = WEAPON_STATS.Felarx;
  const pool = pools('shotgun', '?yy');
  const positives = [...pool.positive, ...SPLICED.filter(s => s.b.shotgun !== undefined).map(s => s.id)];
  // Body shots only: on weak points, Weakpoint Damage (a multiplier) leads instead.
  const pos = statEffects(w, 'shotgun', '+++-', '+', positives, { weakpoint: 0 });
  assert.deepEqual(pos.slice(0, 2).map(e => e.id), ['multishot', 'ammoEfficiency']);
  // Zoom does nothing to damage, so it's a free curse.
  const neg = statEffects(w, 'shotgun', '+++-', '-', pool.negative);
  assert.equal(neg.find(e => e.id === 'zoom')?.change, 0);
  const sets = bestSets(w, 'shotgun', '+++-', positives);
  assert.equal(sets[0].ids.length, 3);
  assert.ok(sets[0].ids.includes('multishot'), sets[0].ids.join());
  assert.ok(sets.every(s => s.ids.filter(id => SPLICED.some(x => x.id === id)).length <= 1));
});

test('ticks per proc: 6 at base; with Status Duration, Slash, Heat and Toxin round down, Electricity and Gas up', async () => {
  const { ticksOf } = await import('../src/sim.js');
  assert.deepEqual([ticksOf('toxin', 6), ticksOf('electricity', 6)], [6, 6]);
  assert.deepEqual([ticksOf('toxin', 7.8), ticksOf('electricity', 7.8)], [7, 8]);
  assert.deepEqual([ticksOf('slash', 12), ticksOf('gas', 12)], [12, 12]);
});

test('DoT ticks scale with their own element’s mods (the wiki’s Supra Vandal: +60% Heat, ticks x1.6)', async () => {
  const { dpsOf } = await import('../src/sim.js');
  const heatGun = { kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0,
    modes: [{ name: 'Normal Attack', rate: 1, cost: 1, parts: [{ name: 'Normal Attack', dmg: { heat: 40 }, cc: 0, cd: 1, sc: 1, ms: 1 }] }] };
  // A hit of 40 x 1.6 = 64 a second; a Heat proc a second, 6 ticks of 0.5 x 40, x1.6: 192.
  const heat = { stats: {}, elements: [{ type: 'heat', value: 0.6 }] };
  assert.ok(Math.abs(dpsOf(heatGun, heat) - (64 + 192)) < 1e-6, String(dpsOf(heatGun, heat)));
});

test('a Slash proc per tick: the wiki’s Damage over Time example (faction twice)', async () => {
  const { dpsOf } = await import('../src/sim.js');
  // 100 Slash, Serration (+165%), Bane of Grineer (+30%), +90% Status Damage, against Grineer:
  // a bleed tick is 100 x 2.65 x 0.35 x 1.3² x 1.9 = 297.8202; the hit 100 x 2.65 x 1.3 = 344.5.
  const slashGun = { kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0,
    modes: [{ name: 'Normal Attack', rate: 1, cost: 1, parts: [{ name: 'Normal Attack', dmg: { slash: 100 }, cc: 0, cd: 1, sc: 1, ms: 1 }] }] };
  const build = { stats: { damage: 1.65, grineer: 0.3, statusDamage: 0.9 }, elements: [] };
  // One proc a second, 6 ticks each.
  assert.ok(Math.abs(dpsOf(slashGun, build, { enemy: 'grineer' }) - (344.5 + 6 * 297.8202)) < 1e-3);
});
