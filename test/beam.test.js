// @ts-check
// Beams (a Held mode): the wiki's Multishot and Continuous Weapon pages, and kengineer's video.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPON_STATS } from '../src/data/weapon-stats.js';
import { beamCount, dpsOf, procsOf } from '../src/sim.js';
import { fight } from '../src/fight.js';

const near = (/** @type {number} */ a, /** @type {number} */ b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
/** @param {Record<string, number>} [stats] */
const totals = (stats = {}) => ({ stats, elements: [] });
const m = (/** @type {Record<string, number>} */ stats) => (/** @type {string} */ id) => stats[id] ?? 0;
/** A plain gun in one mode. @param {object} part @param {object} [mode] @returns {any} */
const gun = (part, mode = {}) => ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Held', tags: [], main: 0,
  modes: [{ name: 'Normal Attack', rate: 10, cost: 0, parts: [{ name: 'x', dmg: { slash: 100 }, cc: 0, cd: 2, sc: 0.3, ms: 1, ...part }], ...mode }] });
const dummy = (health = 1e12) => ({ health, shields: 0, armor: 0, weak: {}, shieldWeak: {} });

test('which attacks are beams: a held trigger on hit-scan, mode by mode', () => {
  assert.equal(WEAPON_STATS.Amprex.modes[0].held, 0.2);
  assert.equal(WEAPON_STATS['Boar Prime'].modes[0].held, undefined);       // shells
  assert.equal(WEAPON_STATS['Boar Prime'].modes[1].held, 0.2);             // its form
  assert.equal(WEAPON_STATS.Larkspur.modes[1].held, undefined);            // the alt fire's projectile
  assert.equal(WEAPON_STATS['Tenet Spirex'].modes[0].held, undefined);     // BEAM tag, fires slugs
  assert.equal(WEAPON_STATS.Convectrix.modes[1].held, 0.8);
  assert.equal(WEAPON_STATS.Phage.modes[0].held, 0.7);
});

test('Multishot rolls to a whole number: Multishot 2.5 is 2 or 3 on even odds', () => {
  const { mean, square } = beamCount(/** @type {any} */ ({ ms: 1 }), 2.5);
  near(mean, 2.5);
  near(square, (4 + 9) / 2);
  near(beamCount(/** @type {any} */ ({ ms: 1 }), 2).square, 4);
  // Two beams each rolling 1.5: 2 (a quarter), 3 (a half), 4 (a quarter).
  near(beamCount(/** @type {any} */ ({ ms: 2 }), 1.5).square, (4 + 2 * 9 + 16) / 4);
});

test('kengineer: 30% status at 1.5 Multishot, a beam’s rolled tick is one 60% roll, a gun’s are two 30% ones', () => {
  const p = /** @type {any} */ ({ sc: 0.3, ms: 1 });
  const beam = procsOf(p, { heat: 1 }, 1, 0, m({}), 2, beamCount(p, 2))('heat');
  const shots = procsOf(p, { heat: 1 }, 1, 0, m({}), 2)('heat');
  near(beam.n, 0.6);
  near(shots.n, 0.6);
  near(beam.strength, 1.2);           // each proc carries both beams
  near(shots.strength, 0.6);
});

test('Hunter Munitions and forced procs: one roll a tick, carrying the tick, a gun’s damage', () => {
  const p = /** @type {any} */ ({ sc: 0, ms: 1, forced: ['impact'] });
  const on = { slashOnCrit: 0.3 };
  const beam = procsOf(p, { heat: 1 }, 1, 1, m(on), 2, beamCount(p, 2));
  const shots = procsOf(p, { heat: 1 }, 1, 1, m(on), 2);
  near(beam('slash').n, 0.3);
  near(shots('slash').n, 0.6);
  near(beam('slash').strength, shots('slash').strength);
  near(beam('impact').n, 1);
  near(shots('impact').n, 2);
});

test('direct damage is a gun’s, DoTs count Multishot twice', () => {
  const hit = { dmg: { heat: 100 }, sc: 0 };
  const held = gun(hit, { held: 1 }), plain = gun(hit);
  const t = totals({ multishot: 1 });
  near(dpsOf(held, t), dpsOf(plain, t));
  // All Slash, every hit procs: the same with no Multishot, DoT x 2 on the beam with it.
  const proc = { dmg: { slash: 100 }, sc: 1 };
  const held2 = gun(proc, { held: 1 }), plain2 = gun(proc);
  near(dpsOf(held2, totals()), dpsOf(plain2, totals()));
  const dot = (/** @type {any} */ w) => dpsOf(w, t) - dpsOf(gun({ ...proc, sc: 0 }, w.modes[0].held ? { held: 1 } : {}), t);
  near(dot(held2) / dot(plain2), 2, 0.02);                                 // (a seed's +1 isn't doubled)
});

test('a fight counts a beam’s DoTs as the closed form does', () => {
  const w = gun({ dmg: { slash: 100 }, sc: 0.3 }, { held: 1 });           // no ramp
  const t = totals({ multishot: 1.5 });
  const flat = fight(w, t, { target: dummy() }).dps;
  const plain = fight(gun({ dmg: { slash: 100 }, sc: 0.3 }), t, { target: dummy() }).dps;
  assert.ok(flat > plain * 1.1, `${flat} against ${plain}`);
});

test('the ramp: a beam starts a target at its start share, full after 0.6 s', () => {
  const part = { dmg: { heat: 100 }, sc: 0 };
  const start = gun(part, { held: 0.2, rate: 10 });
  const full = gun(part, { held: 1, rate: 10 });
  // Ten ticks a second, 100 a tick at full. Ticks at 0, 0.1 … 0.5 ramp: 20, 33 … 87, then 100.
  const ramped = [0, 1, 2, 3, 4, 5].reduce((s, i) => s + 100 * (0.2 + 0.8 * i / 6), 0) + 100 * 4;
  near(fight(start, totals(), { target: dummy(ramped) }).timePerKill, 1, 1e-6);
  near(fight(full, totals(), { target: dummy(1000) }).timePerKill, 1, 1e-6);
  // What the first shot reports is the beam at its full damage.
  near(fight(start, totals(), { target: dummy() }).perShot, 100);
  // A long fight hardly feels it, a short one does.
  const ratio = (/** @type {number} */ health) => fight(start, totals(), { target: dummy(health) }).dps / fight(full, totals(), { target: dummy(health) }).dps;
  assert.ok(ratio(1e6) > 0.98);
  near(ratio(10), 0.2);                                                    // one tick: its start share
});

test('a beam’s tick charges an Incarnon gauge once, whatever merged into it', () => {
  const part = { dmg: { heat: 100 }, sc: 0 };
  const w = gun(part, { held: 1 });
  w.modes.push({ ...w.modes[0], name: 'Incarnon Form' });
  const opts = { target: dummy(1e5), targets: 20, mode: 1, incarnon: { hits: 10, any: true, ammo: 10, normal: 0 } };
  const charge = (/** @type {number} */ multishot) => fight(w, totals({ multishot }), opts).inForm ?? 0;
  near(charge(0), charge(3), 0.2);
});
