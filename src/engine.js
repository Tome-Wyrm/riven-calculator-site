// @ts-check
// Riven math: pure functions, no DOM.
//
//   v = b × 10 × (rank + 1) × DISPOSITION × L × W,   W = 0.9 + 0.2u
//
// u ∈ [0, 1] is the roll quality (the player-data fingerprint `Value` / 2^30). For curses a
// higher u means a bigger negative. The game works in 32-bit floats, so each step is fround-ed.

import { SHAPES, DISPOSITION, MAX_RANK } from './data/stats.js';

/** @typedef {import('./data/stats.js').Stat} Stat */
/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('./data/stats.js').Shape} Shape */
/** @typedef {'+' | '-'} Sign */

const f = Math.fround;

export const SHAPE_ORDER = /** @type {Shape[]} */ (['++', '++-', '+++', '+++-']);

/** Fingerprint `Value` (30-bit integer) → u. */
export const fingerprintToU = (/** @type {number} */ value) => value / 2 ** 30;

/**
 * Whether `stat` can appear with `sign` on a `shape` riven for `cls`.
 * @param {Stat} stat @param {WeaponClass} cls @param {Shape} shape @param {Sign} sign
 */
export function canRoll(stat, cls, shape, sign) {
  if (stat.b[cls] === undefined) return false;
  if (sign === '+') return stat.polarity !== 'negOnly';
  return SHAPES[shape].malus !== null && stat.polarity !== 'posOnly';
}

/**
 * Raw modifier v before display conversion.
 * @param {Stat} stat @param {WeaponClass} cls @param {Shape} shape @param {Sign} sign
 * @param {number} u @param {number} [rank]
 */
export function rawValue(stat, cls, shape, sign, u, rank = MAX_RANK) {
  const b = stat.b[cls];
  const L = sign === '+' ? SHAPES[shape].bonus : SHAPES[shape].malus;
  if (b === undefined || L === null) throw new Error(`${stat.id} can't roll ${sign} on ${cls} ${shape}`);
  const W = f(0.9 + 0.2 * u);
  return f(f(f(f(f(b * 10) * (rank + 1)) * DISPOSITION) * L) * W);
}

/**
 * v → the number the game shows (before rounding), in the stat's unit.
 * @param {Stat} stat @param {number} v
 */
export function toDisplay(stat, v) {
  switch (stat.unit) {
    case 'pct': return v * 100;
    case 'pctNeg': return -v * 100;
    case 'mult': return 1 + v;
    default: return v;
  }
}

/**
 * Display value for a roll.
 * @param {Stat} stat @param {WeaponClass} cls @param {Shape} shape @param {Sign} sign
 * @param {number} u @param {number} [rank]
 */
export function displayValue(stat, cls, shape, sign, u, rank = MAX_RANK) {
  return toDisplay(stat, rawValue(stat, cls, shape, sign, u, rank));
}

/**
 * Display values at the worst (u = 0) and best (u = 1) roll, plus lo/hi in numeric order.
 * @param {Stat} stat @param {WeaponClass} cls @param {Shape} shape @param {Sign} sign
 * @param {number} [rank]
 */
export function range(stat, cls, shape, sign, rank = MAX_RANK) {
  const at0 = displayValue(stat, cls, shape, sign, 0, rank);
  const at1 = displayValue(stat, cls, shape, sign, 1, rank);
  return { at0, at1, lo: Math.min(at0, at1), hi: Math.max(at0, at1) };
}

/**
 * The u that produces a display value (unclamped; outside [0, 1] means unreachable).
 * Display is affine in u, so interpolating between the endpoints is exact up to float noise.
 * @param {Stat} stat @param {WeaponClass} cls @param {Shape} shape @param {Sign} sign
 * @param {number} target @param {number} [rank]
 */
export function solveU(stat, cls, shape, sign, target, rank = MAX_RANK) {
  const { at0, at1 } = range(stat, cls, shape, sign, rank);
  return (target - at0) / (at1 - at0);
}

/**
 * Formats a display value the way the game does: signed, 1 decimal (faction: ×, 2 decimals).
 * @param {Stat} stat @param {number} display @param {number} [decimals]
 */
export function format(stat, display, decimals) {
  if (stat.unit === 'mult') return `x${display.toFixed(decimals ?? 2)}`;
  const sign = display < 0 ? '-' : '+';
  const n = Math.abs(display).toFixed(decimals ?? 1);
  const unit = { pct: '%', pctNeg: '%', sec: 's', m: 'm', flat: '' }[stat.unit];
  return `${sign}${n}${unit}`;
}

/**
 * Effects that apply at a multiple of the riven's displayed value: melee Critical Chance counts
 * double on heavy attacks, and Fire Rate counts double on bows.
 * @param {Stat} stat @param {WeaponClass} cls @param {boolean} isBow
 * @returns {{label: string, factor: number}[]}
 */
export function quirks(stat, cls, isBow) {
  const out = [];
  if (stat.id === 'critChance' && cls === 'melee') out.push({ label: 'Heavy attacks', factor: 2 });
  if (stat.id === 'fireRate' && isBow) out.push({ label: 'On bows', factor: 2 });
  return out;
}

const IPS_INDEX = { impact: 0, puncture: 1, slash: 2 };

/**
 * Whether a weapon can roll a stat, from its IPS code (see weapons.js). Only Impact, Puncture and
 * Slash depend on the weapon; everything else is 'y'.
 * @param {Stat} stat @param {string} [ipsCode] e.g. 'nyy'; omitted when no weapon is picked
 * @returns {'y' | 'n' | '?'}
 */
export function weaponCanRoll(stat, ipsCode) {
  const i = IPS_INDEX[/** @type {keyof typeof IPS_INDEX} */ (stat.id)];
  if (i === undefined || !ipsCode) return 'y';
  return /** @type {'y' | 'n' | '?'} */ (ipsCode[i]);
}

/**
 * Probability that u lands in [a, b]. Ordinary stats roll u uniformly. A spliced stat keeps the
 * higher u of its two parents, so its u follows max(U1, U2) with CDF u².
 * @param {number} a @param {number} b @param {boolean} spliced
 */
export function probability(a, b, spliced) {
  const lo = Math.max(0, Math.min(1, a));
  const hi = Math.max(0, Math.min(1, b));
  if (hi <= lo) return 0;
  return spliced ? hi * hi - lo * lo : hi - lo;
}

/**
 * @typedef {object} Goal
 * @property {Stat} stat
 * @property {WeaponClass} cls
 * @property {'gte' | 'lte' | 'near'} op
 * @property {number} target              in display units, e.g. 70 for +70%
 * @property {number} [rank]
 * @property {Sign} [sign]                defaults to the side of zero the target is on
 * @property {number} [tolerance]         'near' only: counts as a hit within ±tolerance (default 1)
 */

/**
 * @typedef {object} ShapeResult
 * @property {Shape} shape
 * @property {boolean} possible          the stat can roll with this sign on this shape at all
 * @property {boolean} feasible          some roll meets the goal
 * @property {{at0: number, at1: number, lo: number, hi: number}} [range]
 * @property {[number, number]} [uInterval]   rolls that meet the goal, clamped to [0, 1]
 * @property {number} probability        chance a roll of this stat meets the goal
 * @property {number} [closest]          'near': nearest achievable display value
 * @property {number} [closestU]
 * @property {number} [delta]            'near': |closest − target|
 * @property {boolean} best
 */

/**
 * Evaluates a goal against every shape.
 * @param {Goal} goal
 * @returns {{sign: Sign, results: ShapeResult[]}}
 */
export function evaluateGoal(goal) {
  const { stat, cls, op, target, rank = MAX_RANK, tolerance = 1 } = goal;
  const sign = goal.sign ?? inferSign(stat, cls, target);

  /** @type {ShapeResult[]} */
  const results = SHAPE_ORDER.map(shape => {
    if (!canRoll(stat, cls, shape, sign)) {
      return { shape, possible: false, feasible: false, probability: 0, best: false };
    }
    const r = range(stat, cls, shape, sign, rank);
    const uAt = (/** @type {number} */ t) => solveU(stat, cls, shape, sign, t, rank);
    // Display increases with u when at1 > at0; flip the comparison otherwise.
    const rising = r.at1 > r.at0;

    if (op === 'near') {
      const closestU = Math.max(0, Math.min(1, uAt(target)));
      const closest = displayValue(stat, cls, shape, sign, closestU, rank);
      const delta = Math.abs(closest - target);
      const [a, b] = [uAt(target - tolerance), uAt(target + tolerance)].sort((x, y) => x - y);
      return {
        shape, possible: true, feasible: delta <= tolerance, range: r,
        uInterval: clampInterval(a, b), probability: probability(a, b, stat.spliced),
        closest, closestU, delta, best: false,
      };
    }

    const u = uAt(target);
    const wantHigh = (op === 'gte') === rising;   // need u ≥ threshold?
    const [a, b] = wantHigh ? [u, 1] : [0, u];
    const p = probability(a, b, stat.spliced);
    return {
      shape, possible: true, feasible: p > 0, range: r,
      uInterval: clampInterval(a, b), probability: p, best: false,
    };
  });

  markBest(results, op);
  return { sign, results };
}

/** @param {number} a @param {number} b @returns {[number, number]} */
function clampInterval(a, b) {
  return [Math.max(0, Math.min(1, a)), Math.max(0, Math.min(1, b))];
}

/**
 * Picks the sign whose display values are on the same side of zero as the target.
 * (Weapon Recoil buffs display negative, so this can't just be the target's sign.)
 * @param {Stat} stat @param {WeaponClass} cls @param {number} target @returns {Sign}
 */
export function inferSign(stat, cls, target) {
  if (stat.polarity === 'posOnly') return '+';
  if (stat.polarity === 'negOnly') return '-';
  const plus = displayValue(stat, cls, '++', '+', 0.5);
  const zero = stat.unit === 'mult' ? 1 : 0;
  return (target - zero >= 0) === (plus - zero >= 0) ? '+' : '-';
}

/** @param {ShapeResult[]} results @param {Goal['op']} op */
function markBest(results, op) {
  const candidates = results.filter(r => r.possible);
  if (candidates.length === 0) return;
  const score = op === 'near'
    ? (/** @type {ShapeResult} */ r) => [-(r.delta ?? Infinity), r.probability]
    : (/** @type {ShapeResult} */ r) => [r.probability, 0];
  let best = candidates[0];
  for (const r of candidates.slice(1)) {
    const [s1, t1] = score(r), [s0, t0] = score(best);
    if (s1 > s0 + 1e-12 || (Math.abs(s1 - s0) <= 1e-12 && t1 > t0)) best = r;
  }
  if (op === 'near' || best.probability > 0) best.best = true;
}

/**
 * The shape implied by how many positives and negatives a riven has, or null if none fits.
 * @param {number} positives @param {number} negatives @returns {Shape | null}
 */
export function shapeFor(positives, negatives) {
  return SHAPE_ORDER.find(s => SHAPES[s].positives === positives && SHAPES[s].negatives === negatives) ?? null;
}

/**
 * Back-solves the roll quality u from a value as the game shows it. The game rounds to 1 decimal
 * (faction multipliers to 2), so a shown value pins u to a small interval rather than a point.
 * @param {Stat} stat @param {WeaponClass} cls @param {Shape} shape @param {Sign} sign
 * @param {number} shown  the displayed number, e.g. 267.2 for "+267.2%"
 * @param {number} [rank]
 * @returns {{lo: number, hi: number, mid: number, possible: boolean}}
 *   lo/hi clamped to [0, 1]; possible is false when no roll can show that value
 */
export function gradeRoll(stat, cls, shape, sign, shown, rank = MAX_RANK) {
  const half = stat.unit === 'mult' ? 0.005 : 0.05;
  const [a, b] = [solveU(stat, cls, shape, sign, shown - half, rank), solveU(stat, cls, shape, sign, shown + half, rank)]
    .sort((x, y) => x - y);
  const possible = b >= 0 && a <= 1;
  const lo = Math.max(0, Math.min(1, a));
  const hi = Math.max(0, Math.min(1, b));
  return { lo, hi, mid: (lo + hi) / 2, possible };
}

/**
 * Community letter grades on the ±10% scale (score = how far the roll is from average:
 * u = 0 → −10%, u = 1 → +10%). Thresholds from RivenParser.js, as used by WFHelper.
 * Each entry is the lowest score that earns the grade; anything below −9.5 is F.
 */
export const GRADES = /** @type {const} */ ([
  [9.5, 'S'], [7.5, 'A+'], [5.5, 'A'], [3.5, 'A-'], [1.5, 'B+'],
  [-1.5, 'B'], [-3.5, 'B-'], [-5.5, 'C+'], [-7.5, 'C'], [-9.5, 'C-'],
]);

/** u → score on the ±10% scale. For a curse pass mild = true to score 1 − u (a smaller penalty scores higher). */
export const rollScore = (/** @type {number} */ u, mild = false) => ((mild ? 1 - u : u) - 0.5) * 20;

/** @param {number} score on the ±10% scale */
export function letterGrade(score) {
  return GRADES.find(([min]) => score >= min - 1e-9)?.[1] ?? 'F';
}
