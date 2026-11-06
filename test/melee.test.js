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
  assert.deepEqual(swingOf([[2, 2], [1, 2], [3, 2, 'knockdown'], [1, 1, 'knockback']]), { mult: 13, points: 13, hits: 7, knocks: 3 });
});

test('a slam hit takes Slam Attack Damage on its base damage; its combo points don\'t', () => {
  // Seismic Wave's +200%: the 1x slam hit counts 3x, the 2x normal hit stays 2x.
  assert.deepEqual(swingOf([[2, 1], [1, 1, '', 'slam']], 2), { mult: 5, points: 3, hits: 2, knocks: 0 });
  const opts = () => ({ target: target(1e6), melee: { attacks: [[[1, 1, '', 'slam']]], combo: 'initial' } });
  near(fight(sword(), totals({ slamDamage: 2 }), opts()).dps / fight(sword(), totals({}), opts()).dps, 3);
});

test('stances: Vermillion Storm\'s Crimson Hurricane from the wiki; the best combo first', () => {
  const storm = STANCES['Heavy Blade']?.find(s => s.name === 'Vermillion Storm') ?? Object.values(STANCES).flat().find(s => s.name === 'Vermillion Storm');
  const hurricane = storm.combos.find(c => c.name === 'Crimson Hurricane');
  assert.deepEqual(hurricane.attacks, [[[1, 1]], [[2, 1], [1, 3]], [[2, 1], [1, 1]]]);
  const list = combosFor('Tonfa');
  const combos = list.filter(c => !c.slam);
  assert.ok(combos.length > 1 && combos.every((c, i) => i === 0 || c.perSwing <= combos[i - 1].perSwing));
  assert.ok(list.findIndex(c => c.slam) >= combos.length, 'slams after the combos');
});

test('stances: labelled as the wiki does; a unique stance only on its weapon; slams by stance, never the default', () => {
  const hammer = combosFor('Hammer', 'Sancti Magistar');
  assert.ok(!hammer.some(c => c.stance === 'Sampotes'), 'Sampotes\' stance is for the Sampotes');
  assert.ok(!hammer[0].slam);
  assert.ok(hammer.some(c => c.label === 'Shattering Storm: Neutral, Falling Rock'));
  assert.ok(hammer.some(c => c.label === 'Slam' && c.slam));
  const sampotes = combosFor('Hammer', 'Sampotes');
  assert.ok(!sampotes[0].slam);
  assert.deepEqual(sampotes.filter(c => c.stance === 'Sampotes').map(c => c.label).sort(), ['Sampotes: Heavy Slam', 'Sampotes: Slam']);
  // Falling Rock's last attack ends in a 100% slam hit that knocks down (the wiki's red S).
  const rock = hammer.find(c => c.combo.name === 'Falling Rock');
  assert.deepEqual(rock.combo.attacks.at(-1).at(-1), [1, 1, 'knockdown', 'slam']);
});

test('Seismic Wave joins the mod pool when the attack slams, not otherwise', () => {
  const w = WEAPON_STATS['Sancti Magistar'];
  const pool = attacks => modPool('melee', w, SCENARIOS.room, { melee: { attacks, combo: 'initial' } }).map(p => p.name);
  assert.ok(pool([[[2, 1, '', 'slam']]]).includes('Seismic Wave'));
  assert.ok(!pool([[[2, 1]]]).includes('Seismic Wave'));
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

const heavySword = () => sword({ melee: { ft: 0.5, range: 2.5, sweep: 0.25, combo: 5, heavy: 500, windUp: 1 } });
const heavyOpts = (combo, extra = {}) => ({ enemy: '', headcrit: false, target: target(1e6), melee: { attacks: [[[1, 1]]], combo, heavy: true, heavyAt: 2, ...extra } });

test('a heavy attack: its damage x the combo multiplier, wind up shortened by Wind Up Speed only', () => {
  near(fight(heavySword(), totals({}), heavyOpts('max')).perShot, 500 * 12);
  near(fight(heavySword(), totals({}), heavyOpts('initial')).perShot, 500);
  const quick = { ...heavyOpts('max'), target: target(6000) };
  near(fight(heavySword(), totals({}), quick).timePerKill, 1);
  near(fight(heavySword(), totals({ heavyWindup: 1 }), quick).timePerKill, 0.5);
  near(fight(heavySword(), totals({ fireRate: 1 }), quick).timePerKill, 1);
});

test('Melee Damage On Heavy Attack adds to Melee Damage, on heavy attacks only', () => {
  near(fight(heavySword(), totals({ damage: 1, meleeDamageOnHeavy: 1 }), heavyOpts('initial')).perShot, 500 * 3);
});

test('a built-up counter swings to the tier, spends it, and keeps Heavy Attack Efficiency (at most 90%)', () => {
  const time = stats => fight(heavySword(), totals(stats), { ...heavyOpts('build'), target: target(20 * 100 + 1000 + 1) }).timePerKill;
  // 20 swings (20 s of hits) reach 2x; the heavy then does 1000, the fight's last point falling after it.
  assert.ok(time({}) > 20);
  // (Quick swings: the whole fight inside the 20 s simulated.)
  const quick = () => { const w = heavySword(); w.modes[0].rate = 10; return w; };
  const spent = fight(quick(), totals({}), { ...heavyOpts('build'), target: target(6000) }).shotsPerKill;
  const thrifty = fight(quick(), totals({ heavyEfficiency: 0.99 }), { ...heavyOpts('build'), target: target(6000) }).shotsPerKill;
  assert.ok(thrifty < spent, `${thrifty} vs ${spent}`);
});

test('heavy attacks double True Steel and rivens, and count Animosity', () => {
  const crit = p => { p.modes[0].parts[0].cc = 0.1; return p; };
  const none = fight(crit(heavySword()), totals({ critChance: 1 }), heavyOpts('initial')).perShot;
  const twice = fight(crit(heavySword()), totals({ critChance: 1, critChanceHeavy: 1 }), heavyOpts('initial')).perShot;
  const held = fight(crit(heavySword()), totals({ critChance: 1, animosity: 4.2 }), heavyOpts('initial')).perShot;
  assert.ok(none < twice && twice < held);
});

test('without the heavy option, or a heavy attack, swings stay normal', () => {
  const o = { ...heavyOpts('max'), melee: { attacks: [[[1, 1]]], combo: 'max' } };
  near(fight(heavySword(), totals({}), o).perShot, 100);
  near(fight(sword(), totals({}), heavyOpts('max')).perShot, 100);
});

test('heavy-only mods join the pool only for heavy attacks', () => {
  const names = opts => modPool('melee', WEAPON_STATS.Skana, SCENARIOS.single, opts).map(p => p.name);
  assert.ok(!names({ enemy: '' }).includes('Killing Blow'));
  assert.ok(names({ enemy: '', melee: { heavy: true } }).includes('Killing Blow'));
});
