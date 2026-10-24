// @ts-check
// What a Kuva cycle can draw, and what it costs. Pure functions, no DOM; the build planner
// (src/planner.js) does the odds.
//
// Assumptions (no published data; these are the community's working model, used by riven price
// guides and calculators):
//  - Unlocked, each of the four shapes is equally likely (25%).
//  - Stats are drawn uniformly without repeats: positives from the class's positive pool, then the
//    negative from the negative pool minus whatever was drawn as a positive.
//  - A locked trait keeps itself and fixes the shape; the other slots are drawn the same way.
//  - Spliced stats are never drawn by cycling. A spliced trait already on the riven stays (always
//    positive) and fixes the shape too, but doesn't double the cost; a separate trait can still be
//    locked alongside it.
// Costs are from the wiki's cycle table; a locked trait doubles them.

import { ORDINARY } from './data/stats.js';
import { weaponCanRoll } from './engine.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */

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
