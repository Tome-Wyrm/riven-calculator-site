// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPON_STATS } from '../src/data/weapon-stats.js';
import { crowdRadius, discMean, reachOf } from '../src/crowd.js';
import { fight } from '../src/fight.js';
import { modPool, SCENARIOS, withoutOutclassed } from '../src/build.js';

const near = (/** @type {number} */ a, /** @type {number} */ b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const crowd = { close: 6, clump: 0.5 };
/** @param {object} part @param {object} [mode] @returns {any} */
const part = (part, mode = {}) => {
  const p = { name: 'x', dmg: { impact: 100 }, cc: 0, cd: 1, sc: 0, ms: 1, ...part };
  return { p, mode: { name: 'x', rate: 1, cost: 1, parts: [p], ...mode } };
};
const reach = (/** @type {object} */ a, /** @type {object} */ m = {}, pt = 0, c = crowd) => { const { p, mode } = part(a, m); return reachOf(p, mode, pt, c); };

test('the crowd: 20 m apart at no clumping, 5 m fully', () => {
  near(crowdRadius({ close: 6, clump: 0 }), 20);
  near(crowdRadius(crowd), 12.5);
  near(crowdRadius({ close: 6, clump: 1 }), 5);
});

test('an explosion: the enemies in its radius at the average of its falloff', () => {
  near(discMean({ from: 0, to: 6, cut: 0 }), 1);
  near(discMean({ from: 0, to: 6, cut: 0.6 }), 0.6);          // 1 - 2/3 x 60%
  near(discMean({ from: 6, to: 6.0001, cut: 1 }), 1, 1e-3);   // (full to its edge)
  near(discMean({ from: 3, to: 6, cut: 1 }), 1 - (72 - 18 - 9) / 108);
  near(reach({ aoe: 1, falloff: { from: 0, to: 5, cut: 0 } }), 6 * (5 / 12.5) ** 2);
  assert.equal(reach({ aoe: 1 }), 0);                         // no radius known
  near(reach({ aoe: 1, falloff: { from: 0, to: 50, cut: 0 } }), 6);   // no more than there are
});

test('Punch Through: more bodies, wearing off at what there is to hit; none on explosives or plain beams', () => {
  const line = 1.5 * 6 / (Math.PI * 12.5);
  assert.equal(reach({}), 0);
  near(reach({ pt: 99 }), line);
  assert.ok(reach({ pt: 1.2 }) > reach({ pt: 0.6 }) && reach({ pt: 0.6 }) > 0);
  near(reach({ pt: 1 }, {}, 0.2), reach({ pt: 1.2 }));         // a mod adds to the weapon's
  assert.equal(reach({ pt: 2 }, { held: 0.2 }), 0);
  const { p, mode } = part({ pt: 2 });
  assert.equal(reachOf(p, { ...mode, parts: [p, { ...p, aoe: 1 }] }, 2, crowd), 0);
});

test('chains: each link needs an enemy in range; a flat share stays the main beam\'s', () => {
  const link = 1 - Math.exp(-6 * (10 / 12.5) ** 2);
  near(reach({}, { held: 0.2, chain: { links: 3, range: 10, share: 0.5 } }), link * 0.5 + link ** 2 * 0.25 + link ** 3 * 0.125);
  near(reach({}, { held: 0.2, chain: { links: 2, range: 10, share: 0.5, flat: 1 } }), link * 0.5 + link ** 2 * 0.5);
  // Boar's form: up to 3 beams, each with its chains.
  const one = reach({}, { held: 0.2, chain: { links: 2, range: 10, share: 0.8 } });
  near(reach({}, { held: 0.2, chain: { links: 2, range: 10, share: 0.8, beams: 3 } }), (1 + one) * (1 + 2 * (1 - Math.exp(-6))) - 1);
  assert.equal(reach({}, { held: 0.2, chain: { links: 3, range: 10, share: 0.5 } }, 0, { close: 0, clump: 0.5 }), 0);
});

test('the chain table is on the beams it names', () => {
  assert.equal(WEAPON_STATS.Amprex.modes[0].chain?.links, 3);
  assert.equal(WEAPON_STATS['Boar Prime'].modes[0].chain, undefined);       // shells
  assert.equal(WEAPON_STATS['Boar Prime'].modes[1].chain?.beams, 3);        // its form
  assert.equal(WEAPON_STATS.Larkspur.modes[1].chain, undefined);            // the alt fire
  assert.equal(WEAPON_STATS.Glaxion.modes[0].chain, undefined);
});

test('a room with a crowd goes that much faster, by each attack\'s share of the shot', () => {
  const target = { health: 1000, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const gun = /** @type {any} */ ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0, modes: [{ name: 'x', rate: 1, cost: 1, parts: [
    { name: 'hit', dmg: { impact: 50 }, cc: 0, cd: 1, sc: 0, ms: 1 },
    { name: 'boom', dmg: { impact: 50 }, cc: 0, cd: 1, sc: 0, ms: 1, aoe: 1, falloff: { from: 0, to: 12.5, cut: 0 } }] }] });
  const none = { stats: {}, elements: [] };
  const alone = fight(gun, none, { target, targets: 20 });
  const crowded = fight(gun, none, { target, targets: 20, crowd });
  near(crowded.dps / alone.dps, 1 + 0.5 * 6, 1e-6);              // half the shot reaches all six
  near(crowded.timePerKill * 4, alone.timePerKill, 1e-6);
  near(fight(gun, none, { target, targets: 1, crowd }).dps, fight(gun, none, { target, targets: 1 }).dps, 1e-6);
});

test('Punch Through mods join the pool only in a crowd', () => {
  const w = WEAPON_STATS['Soma Prime'];
  const has = (/** @type {object} */ opts) => withoutOutclassed(modPool('rifle', w, SCENARIOS.room, opts)).some(p => p.name === 'Metal Auger');
  assert.equal(has({}), false);
  assert.equal(has({ crowd }), true);
});
