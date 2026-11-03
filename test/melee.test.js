import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboTier, swingOf, combosFor, MAX_COMBO } from '../src/melee.js';
import { fight } from '../src/fight.js';
import { modPool, arcanePool, arcaneNames, SCENARIOS } from '../src/build.js';
import { WEAPON_STATS } from '../src/data/weapon-stats.js';
import { STANCES } from '../src/data/stances.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
/** A plain target: no armor, no shields, no weaknesses. */
const target = health => ({ health, shields: 0, armor: 0, weak: {}, shieldWeak: {} });
/** A test sword: 100 Slash, 1 swing/s, no crits or status. */
const sword = (over = {}) => ({
  kind: 'Sword', mag: 0, reload: 0, ammo: null, trigger: '', tags: [], main: 0,
  modes: [{ name: 'Normal Attack', rate: 1, cost: 0, parts: [{ name: 'Normal Attack', dmg: { slash: 100 }, cc: 0, cd: 2, sc: 0, ms: 1 }] }],
  melee: { ft: 0.5, range: 2.5, sweep: 0.25, combo: 5, heavy: 0, windUp: 1 }, ...over,
});
const totals = stats => ({ stats, elements: [] });

test('combo tiers: 1x below 20 points, +1x per 20, 12x from 220 (the wiki\'s Melee Combo)', () => {
  assert.deepEqual([0, 19, 20, 39, 40, 219, 220, 999].map(comboTier), [1, 1, 2, 2, 3, 11, 12, 12]);
  assert.equal(MAX_COMBO, 220);
});

test('a swing sums its hits\' multipliers and counts its knockdowns', () => {
  assert.deepEqual(swingOf([[2, 2], [1, 2], [3, 2, 'knockdown'], [1, 1, 'knockback']]), { mult: 13, hits: 7, knocks: 3 });
});

test('stances: Vermillion Storm\'s Crimson Hurricane from the wiki; the best combo first', () => {
  const storm = STANCES['Heavy Blade']?.find(s => s.name === 'Vermillion Storm') ?? Object.values(STANCES).flat().find(s => s.name === 'Vermillion Storm');
  const hurricane = storm.combos.find(c => c.name === 'Crimson Hurricane');
  assert.deepEqual(hurricane.attacks, [[[1, 1]], [[2, 1], [1, 3]], [[2, 1], [1, 1]]]);
  const list = combosFor('Tonfa');
  assert.ok(list.length > 1 && list.every((c, i) => i === 0 || c.perSwing <= list[i - 1].perSwing));
});

test('a swing deals its stance multiplier: a 3x attack kills a 250-health target in one swing', () => {
  const opts = { target: target(250), melee: { attacks: [[[3, 1]]], combo: 'initial' } };
  assert.equal(fight(sword(), totals({}), opts).shotsPerKill, 1);
  const plain = fight(sword(), totals({}), { target: target(250), melee: { attacks: [[[1, 1]]], combo: 'initial' } });
  near(plain.shotsPerKill, 2.5);
});

test('Blood Rush adds its crit chance per tier past 1x: none at the initial combo, 11 x 40% at the max', () => {
  const w = sword();
  w.modes[0].parts[0].cc = 0.1;
  const t = totals({ critChancePerTier: 0.4 });
  const at = combo => fight(w, t, { target: target(1e6), melee: { attacks: [[[1, 1]]], combo } }).dps;
  near(at('initial'), 110);                                // 10% crit at 2x
  // 10% x (1 + 0.4 x 11) = 54% crit
  near(at('max') / at('initial'), 1.54 / 1.1, 1e-6);
});

test('the combo builds up over the fight: tiers climb with the hits', () => {
  const w = sword();
  w.modes[0].rate = 4;                                      // 60 swings inside the 20 s simulated
  const r = fight(w, totals({}), { target: target(100 * 60), melee: { attacks: [[[1, 1]]], combo: 'build' } });
  assert.equal(r.tier, 3);                                  // 60 swings of 1 point: 59 points before the last
});

test('Melee Duplicate: a base crit strikes again (yellow crits only)', () => {
  const at = cc => {
    const w = sword();
    w.modes[0].parts[0].cc = cc;
    const plain = fight(w, totals({}), { target: target(1e6), melee: { attacks: [[[1, 1]]], combo: 'initial' } }).dps;
    const dup = fight(w, totals({ duplicate: 1 }), { target: target(1e6), melee: { attacks: [[[1, 1]]], combo: 'initial' } }).dps;
    return dup / plain;
  };
  near(at(0.5), 1.5, 1e-6);
  near(at(1.25), 1.75, 1e-6);
  near(at(2), 1, 1e-6);
});

test('room clearing: the enemies inside a swing fall together, each at the follow through of the one before', () => {
  const opts = nearby => ({ target: target(1000), targets: 20, melee: { attacks: [[[1, 1]]], combo: 'initial', nearby } });
  const one = fight(sword(), totals({}), opts(1)).timePerKill;
  near(fight(sword(), totals({}), opts(3)).timePerKill, one / (1 + 0.5 + 0.25), 1e-9);
});

test('Melee Influence spreads elemental procs to the close enemies in a room, more with clumping; nothing on one target', () => {
  const w = sword();
  w.modes[0].parts[0] = { name: 'Normal Attack', dmg: { electricity: 100 }, cc: 0, cd: 2, sc: 1, ms: 1 };
  const t = totals({ influence: 18 });
  const room = (close, clump) => fight(w, t, { target: target(5000), targets: 20, melee: { attacks: [[[1, 1]]], combo: 'initial', close, clump } }).timePerKill;
  const none = fight(w, totals({}), { target: target(5000), targets: 20, melee: { attacks: [[[1, 1]]], combo: 'initial' } }).timePerKill;
  assert.ok(room(4, 0) < none);
  assert.ok(room(4, 1) < room(4, 0));
  const single = (tt) => fight(w, tt, { target: target(5000), melee: { attacks: [[[1, 1]]], combo: 'initial', close: 4 } }).timePerKill;
  near(single(t), single(totals({})));
});

test('melee builds: melee mods (Melee Damage as Damage, Blood Rush per tier) and the melee arcanes', () => {
  const w = WEAPON_STATS['Kronen Prime'];
  const names = modPool('melee', w, SCENARIOS.room, {}).map(p => p.name);
  for (const m of ['Primed Pressure Point', 'Blood Rush', 'Condition Overload', 'Organ Shatter']) assert.ok(names.includes(m), m);
  const pp = modPool('melee', w, SCENARIOS.room, {}).find(p => p.name === 'Primed Pressure Point');
  assert.equal(pp.stats.damage, 1.65);
  assert.equal(modPool('melee', w, SCENARIOS.room, {}).find(p => p.name === 'Blood Rush').stats.critChancePerTier, 0.4);
  assert.ok(arcaneNames('melee').includes('Melee Influence'));
  // A chosen arcane is the only one offered, and always carried.
  const pool = arcanePool('melee', SCENARIOS.room, { arcane: 'Melee Afflictions' });
  assert.deepEqual(pool.map(p => [p.name, p.chosen]), [['Melee Afflictions', true]]);
  assert.deepEqual(arcanePool('melee', SCENARIOS.room, { arcane: '' }), []);
});
