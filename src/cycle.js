// @ts-check
// Cycling odds and Kuva cost. Pure functions, no DOM.
//
// Assumptions (no published data; these are the community's working model, used by riven price
// guides and calculators):
//  - Unlocked, each of the four shapes is equally likely (25%).
//  - Stats are drawn uniformly without repeats: positives from the class's positive pool, then the
//    negative from the negative pool minus whatever was drawn as a positive.
//  - A locked trait keeps itself and fixes the shape; the other slots are drawn the same way.
//  - Spliced stats are never drawn by cycling.
// Costs are from the wiki's cycle table; a locked trait doubles them.

import { ORDINARY, SHAPES } from './data/stats.js';
import { SHAPE_ORDER, weaponCanRoll } from './engine.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('./data/stats.js').Shape} Shape */

/** Kuva for the 1st, 2nd, … cycle; every cycle from the 10th on costs the last entry. */
export const CYCLE_COSTS = [900, 1000, 1200, 1400, 1700, 2000, 2350, 2750, 3150, 3500];

/** Kuva for cycle number n (1-based), doubled with a locked trait. @param {number} n @param {boolean} [locked] */
export const cycleCost = (n, locked = false) => CYCLE_COSTS[Math.min(n, CYCLE_COSTS.length) - 1] * (locked ? 2 : 1);

/**
 * Stats a cycle can draw for a class (and weapon, via its IPS code: 'n' is excluded, '?' kept).
 * @param {WeaponClass} cls @param {string} [ipsCode]
 */
export function pools(cls, ipsCode) {
  const rollable = ORDINARY.filter(s => s.b[cls] !== undefined && weaponCanRoll(s, ipsCode) !== 'n');
  return {
    positive: rollable.filter(s => s.polarity !== 'negOnly').map(s => s.id),
    negative: rollable.filter(s => s.polarity !== 'posOnly').map(s => s.id),
  };
}

/** @param {string[]} items @param {number} k @returns {string[][]} */
function combinations(items, k) {
  if (k === 0) return [[]];
  const out = [];
  for (let i = 0; i <= items.length - k; i++) {
    for (const rest of combinations(items.slice(i + 1), k - 1)) out.push([items[i], ...rest]);
  }
  return out;
}

/**
 * @typedef {object} CycleGoal
 * @property {WeaponClass} cls
 * @property {string} [ipsCode]
 * @property {string[]} want          positives that must all appear
 * @property {'any' | 'none' | string[]} negative   accepted outcomes for the negative slot:
 *   any (including no negative), none (only shapes without one), or one of these stats
 * @property {{statId: string, sign: '+' | '-', shape: Shape} | null} [lock]
 */

/**
 * Chance that one cycle meets the goal, by exact enumeration of every draw.
 * @param {CycleGoal} goal @returns {{total: number, byShape: Record<string, number>}}
 */
export function cycleChance(goal) {
  const { positive, negative } = pools(goal.cls, goal.ipsCode);
  const lock = goal.lock ?? null;
  const shapes = lock ? [lock.shape] : SHAPE_ORDER;
  const shapeWeight = 1 / shapes.length;
  /** @type {Record<string, number>} */
  const byShape = {};
  let total = 0;

  for (const shape of shapes) {
    const { positives: k, negatives: c } = SHAPES[shape];
    // A locked positive is already in place; the rest are drawn.
    const fixedPos = lock?.sign === '+' ? [lock.statId] : [];
    const posPool = positive.filter(id => !fixedPos.includes(id) && !(lock?.sign === '-' && id === lock.statId));
    let p = 0;
    const draws = combinations(posPool, k - fixedPos.length);
    for (const drawn of draws) {
      const pos = [...fixedPos, ...drawn];
      if (!goal.want.every(id => pos.includes(id))) continue;
      const pDraw = 1 / draws.length;
      if (c === 0) {
        if (goal.negative === 'any' || goal.negative === 'none') p += pDraw;
        continue;
      }
      if (goal.negative === 'none') continue;
      if (lock?.sign === '-') {
        if (goal.negative === 'any' || goal.negative.includes(lock.statId)) p += pDraw;
        continue;
      }
      const negPool = negative.filter(id => !pos.includes(id));
      const ok = goal.negative === 'any' ? negPool.length : negPool.filter(id => goal.negative.includes(id)).length;
      p += pDraw * (ok / negPool.length);
    }
    byShape[shape] = p;
    total += shapeWeight * p;
  }
  return { total, byShape };
}

/**
 * Cycles and Kuva to reach the goal, starting after `rerolls` cycles already done.
 * @param {number} p chance per cycle @param {number} rerolls @param {boolean} locked
 */
export function kuvaPlan(p, rerolls, locked) {
  if (p <= 0) return null;
  const kuvaFor = (/** @type {number} */ n) => {
    let sum = 0;
    for (let i = 1; i <= n; i++) sum += cycleCost(rerolls + i, locked);
    return sum;
  };
  /** Cycles needed for an overall chance q of having hit at least once. @param {number} q */
  const cyclesFor = q => (p >= 1 ? 1 : Math.ceil(Math.log(1 - q) / Math.log(1 - p)));
  // Expected Kuva: each cycle i is paid only if the first i−1 all missed.
  let expectedKuva = 0, miss = 1;
  for (let i = 1; miss > 1e-9 && i < 100000; i++) {
    expectedKuva += miss * cycleCost(rerolls + i, locked);
    miss *= 1 - p;
  }
  const at = (/** @type {number} */ q) => ({ cycles: cyclesFor(q), kuva: kuvaFor(cyclesFor(q)) });
  return { expectedCycles: 1 / p, expectedKuva, median: at(0.5), likely: at(0.9) };
}
