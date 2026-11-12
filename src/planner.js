// @ts-check
// Build planner: the cheapest way (in expected Kuva) to cycle and splice a riven into a target,
// e.g. "Felarx with Viral (spliced), Cold, Toxin and -Critical Chance".
//
// Model. A state is: the stage (before / after the splice), which of the traits we care about the
// riven currently has, whether it has the wanted negative, and its shape. In each state you either
// cycle unlocked, or lock one stat (keeps it and the shape, costs double): a wanted trait, the
// curse even when it isn't the wanted one, or a positive the target doesn't want (those two just
// hold the shape: the curse's lock leaves every positive slot rolling, the positive's leaves the
// curse rolling and costs a slot, which is free when the target has fewer positives than the shape).
// Reaching both splice parents on the target shape lets you splice (free): the parents are consumed,
// the spliced trait stays and the shape is frozen. A parent can be the curse (Critical Chance +
// -Zoom → Weak Point Critical Chance): then the spliced stat takes the positive parent's place and
// a random curse replaces the negative one. With two positive parents, a random positive fills the
// second slot. The spliced stat stays locked in a slot of its own at no extra cost (cycling with
// only it locked is the normal price); one other stat can be locked beside it, at the locked price.
// Policy iteration finds the cheapest action in every state; the result is exact for the model.
//
// Value goals ("Toxin at least 100%", at most, or exactly): a wanted stat only counts once its
// value meets the goal; the same for the wanted curse. A goal for the spliced stat works through
// its parents: the spliced stat keeps the better roll of its two parents, so the plan tracks each
// parent's roll as below, inside or above the goal's window, and splices only when neither is
// above it and at least one is inside ("at most" needs both parents low enough).
// Each cycle rerolls the values of unlocked stats (roll uniform from worst to best); a locked stat
// keeps its value, and stats that survive a splice keep theirs (both seen in game).
//
// Assumptions (see src/cycle.js): each shape equally likely when unlocked, stats drawn evenly with
// no repeats, rolls uniform, values at rank 8, and a flat cost per cycle (riven past its 10th
// cycle: 3,500, or 7,000 locked).

import { SHAPES, STAT_BY_ID } from './data/stats.js';
import { SHAPE_ORDER, range, solveU } from './engine.js';
import { pools, cycleCost } from './cycle.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('./data/stats.js').Shape} Shape */

export const FLAT_COST = cycleCost(99);          // 3,500
export const OP_TEXT = { gte: '≥', lte: '≤', eq: '=' };
/** The most wanted stats (alternatives and splice parents included) a plan follows: states double with each. */
export const MAX_TRACKED = 6;
const binom = (/** @type {number} */ n, /** @type {number} */ k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/**
 * @typedef {object} Target
 * @property {WeaponClass} cls
 * @property {string} [ipsCode]
 * @property {(string | string[])[]} positives  ordinary stats wanted as positives (not counting the
 *   spliced one), one per slot: a list is "any one of these" (Cold or Toxin)
 * @property {string | null} spliced  spliced stat wanted, if any
 * @property {string[]} [parents]     which recipe to splice it from (default: the cheapest)
 * @property {string | string[] | null} negative wanted negative (a list: any one of these), or null
 *   for "don't care"
 * @property {Shape} shape            the finished riven's shape
 * @property {Record<string, ValueGoal>} [goals]  wanted positive → the value it must show at rank 8
 * @property {ValueGoal} [negGoal]  the wanted negative's value goal (its size: "30" for -30%)
 *
 * @typedef {object} ValueGoal
 * @property {'gte' | 'lte' | 'eq'} op  at least, at most, or exactly (as the game shows it)
 * @property {number} value  a magnitude: "100" for +100%, "90" for -90% Weapon Recoil, "1.3" for x1.3
 *
 * @typedef {{stage: 'pre' | 'post', mask: number, neg: number, shape: Shape, pg: number}} State
 *   mask = bits over the stage's tracked positives; neg = what the negative is: 0 something else
 *   (or none), 2 / 3 the first / second splice parent (before the splice), 4 and up a wanted
 *   negative (one code per group of wanted negatives that behave alike, see negGroups);
 *   pg = with a goal for the spliced stat, two bits per splice parent (parent i at bits 2i, 2i+1):
 *   0 below the goal's roll window (or not on the riven), 1 inside it, 2 above it
 */

/** The wanted curses as a list (none, one, or any one of several). @param {Target} t */
const negativesOf = t => (Array.isArray(t.negative) ? t.negative : t.negative ? [t.negative] : []);

/**
 * Builds and solves the plan for one splice recipe (or none).
 * @param {Target} t @param {string[] | null} parents
 * @param {boolean} [modelOnly]  just the model (states and what a cycle does), nothing solved
 * @returns {any}
 */
function solveFor(t, parents, modelOnly = false) {
  const { positive: posPool, negative: negPool } = pools(t.cls, t.ipsCode);
  const S = t.spliced;
  // The wanted curse: any one of these (those that can roll as curses here). targetNeg stands for
  // the set (its ids joined by '|'), or null for none.
  const negWanted = negativesOf(t);
  const NEG = negWanted.filter(id => negPool.includes(id));
  const targetNeg = NEG.length ? NEG.join('|') : null;
  /**
   * The chance a freshly rolled positive meets its value goal on a shape (1 with no goal). The game
   * rounds what it shows (1 decimal, 2 for multipliers), so "≥ 148.5" includes rolls showing as
   * 148.5: a perfect roll is a goal like any other.
   */
  const meets = (/** @type {string} */ id, /** @type {Shape} */ shape, /** @type {'+' | '-'} */ pm = '+', goal = t.goals?.[id]) => {
    if (!goal) return 1;
    const stat = STAT_BY_ID[id];
    const half = stat.unit === 'mult' ? 0.005 : 0.05;
    const r = range(stat, t.cls, shape, pm);
    const sign = r.at1 < 0 ? -1 : 1;           // e.g. recoil shows as negative when it's the positive
    // (A curse's size grows with its roll too, so the same window works for it.)
    const u = (/** @type {number} */ mag) => Math.min(1, Math.max(0, solveU(stat, t.cls, shape, pm, sign * mag)));
    const lo = goal.op === 'lte' ? 0 : u(goal.value - half);
    const hi = goal.op === 'gte' ? 1 : u(goal.value + half);
    return Math.max(0, hi - lo);
  };
  const finalPos = SHAPES[t.shape].positives;
  if (t.positives.length + (S ? 1 : 0) > finalPos) throw new Error(`A ${t.shape} riven has only ${finalPos} positives.`);
  if (targetNeg && SHAPES[t.shape].negatives === 0) throw new Error(`A ${t.shape} riven has no negative.`);
  for (const id of parents ?? []) if (!posPool.includes(id)) throw new Error(`${STAT_BY_ID[id].name} can't roll as a positive on this weapon.`);
  if (negWanted.length && !NEG.length) throw new Error(`${negWanted.map(id => STAT_BY_ID[id].name).join(' or ')} can't roll as a negative on this weapon.`);
  // Each slot's alternatives, less the ones this weapon can't roll or that can't meet their goal;
  // a slot needs at least one left.
  const groups = t.positives.map(p => {
    const all = Array.isArray(p) ? p : [p];
    const names = all.map(id => STAT_BY_ID[id].name).join(' or ');
    const rollable = all.filter(id => posPool.includes(id));
    if (!rollable.length) throw new Error(`${names} can't roll as a positive on this weapon.`);
    const fit = rollable.filter(id => meets(id, t.shape) > 0);
    if (!fit.length) {
      const id = rollable[0];
      const r = range(STAT_BY_ID[id], t.cls, t.shape, '+');
      const [lo, hi] = [Math.abs(r.at0), Math.abs(r.at1)].sort((a, b) => a - b).map(v => Math.round(v * 100) / 100);
      throw new Error(`${rollable.length > 1 ? `None of ${names} can` : `${STAT_BY_ID[id].name} can't`} be ${OP_TEXT[/** @type {ValueGoal} */ (t.goals?.[id]).op]} ${t.goals?.[id]?.value} on a ${t.shape} riven${rollable.length > 1 ? '' : ` (it rolls ${lo} to ${hi})`}.`);
    }
    return fit;
  });
  // Tracked positives per stage. After the splice: every wanted alternative. Before: the parents
  // first, then the wanted ones that survive the splice.
  const postTracked = [...new Set(groups.flat())];
  const preTracked = parents ? [...parents, ...postTracked.filter(id => !parents.includes(id))] : [];
  if (Math.max(preTracked.length, postTracked.length) > MAX_TRACKED) {
    throw new Error(`Too many alternatives: the planner follows at most ${MAX_TRACKED} stats at once (splice parents included).`);
  }
  const parentMask = parents ? 0b11 : 0;
  // The wanted curses, grouped by what locking one does to the positive draw: a locked curse can't
  // also be drawn as a positive. Those that are never positives here are one group (nothing
  // changes), those that can be but aren't followed as positives another (one stat fewer to draw,
  // whichever it is), and each one that is followed as a positive is a group of its own.
  /** @type {string[][]} */
  const negGroups = [];
  {
    const followed = new Set([...preTracked, ...postTracked]);
    const never = NEG.filter(id => !followed.has(id) && !posPool.includes(id));
    const either = NEG.filter(id => !followed.has(id) && posPool.includes(id));
    for (const g of [never, either, ...NEG.filter(id => followed.has(id)).map(id => [id])]) if (g.length) negGroups.push(g);
  }
  const isParent = (/** @type {number} */ code) => code === 2 || code === 3;
  const isWanted = (/** @type {number} */ code) => code >= 4;

  /** @type {Map<string, State>} */
  const states = new Map();
  const key = (/** @type {State} */ s) => `${s.stage}|${s.mask}|${s.neg}|${s.shape}|${s.pg}`;
  // The spliced stat's goal, as the window a parent's roll must land in (the spliced stat keeps
  // the better one).
  const win = S && parents ? splicedRollWindow(t) : null;
  if (win && win.hi <= win.lo) {
    const r = range(STAT_BY_ID[/** @type {string} */ (S)], t.cls, t.shape, '+');
    const g = /** @type {ValueGoal} */ (t.goals?.[/** @type {string} */ (S)]);
    const [lo, hi] = [Math.abs(r.at0), Math.abs(r.at1)].sort((a, b) => a - b).map(v => Math.round(v * 10) / 10);
    throw new Error(`${STAT_BY_ID[/** @type {string} */ (S)].name} can't reach ${OP_TEXT[g.op]} ${g.value} on a ${t.shape} riven (it rolls ${lo} to ${hi}).`);
  }
  // Chance a fresh parent roll lands below, inside, above the window.
  const qCat = win ? [win.lo, win.hi - win.lo, 1 - win.hi] : [0, 1, 0];
  const cat = (/** @type {number} */ pg, /** @type {number} */ i) => (pg >> (2 * i)) & 3;
  const catBits = (/** @type {number} */ i) => 0b11 << (2 * i);
  /** Which parents are on the riven (as positives or the curse), as bits. @param {State} s */
  const present = s => (s.mask & parentMask) | (isParent(s.neg) ? 1 << (s.neg - 2) : 0);
  /** The stat a negative code stands for (a group's ids joined by '|'). @param {number} code @returns {string | null} */
  const negStat = code => (isWanted(code) ? negGroups[code - 4].join('|') : isParent(code) && parents ? parents[code - 2] : null);
  /** The code for a riven's curse. @param {string} id @param {'pre' | 'post'} stage */
  const negCode = (id, stage) => {
    const g = negGroups.findIndex(ids => ids.includes(id));
    if (g >= 0) return 4 + g;
    return stage === 'pre' && parents?.includes(id) && negPool.includes(id) ? 2 + parents.indexOf(id) : 0;
  };
  /** Negative codes possible in a stage: parents only before the splice, and only if they can be curses. */
  const negCodes = (/** @type {'pre' | 'post'} */ stage) => [0, ...negGroups.map((_, g) => 4 + g),
    ...(stage === 'pre' && parents ? [2, 3].filter(c => negPool.includes(/** @type {string} */ (negStat(c))) && !NEG.includes(/** @type {string} */ (negStat(c)))) : [])];
  const add = (/** @type {State} */ s) => { const k = key(s); if (!states.has(k)) states.set(k, s); return k; };
  const stages = /** @type {('pre' | 'post')[]} */ (parents ? ['pre', 'post'] : ['post']);
  for (const stage of stages) {
    const n = (stage === 'pre' ? preTracked : postTracked).length;
    for (let mask = 0; mask < 1 << n; mask++) for (const neg of negCodes(stage)) for (const shape of SHAPE_ORDER) {
      if (neg && SHAPES[shape].negatives === 0) continue;
      if (isParent(neg) && mask & (1 << (neg - 2))) continue;     // a parent can't be both
      if (stage === 'post' && S && shape !== t.shape) continue;   // splicing froze the shape
      const here = stage === 'pre' && win ? present({ stage, mask, neg, shape, pg: 0 }) : 0;
      for (let pg = 0; pg < (here ? 16 : 1); pg++) {
        if ([0, 1].every(i => cat(pg, i) === 0 || (here & (1 << i) && cat(pg, i) < 3 && qCat[cat(pg, i)] > 0))) add({ stage, mask, neg, shape, pg });
      }
    }
  }

  const tracked = (/** @type {State} */ s) => (s.stage === 'pre' ? preTracked : postTracked);
  // Done: each slot filled by a different stat the riven has (an alternative counts for one slot).
  const fills = (/** @type {number} */ mask) => {
    const have = postTracked.filter((_, i) => mask & (1 << i));
    const assign = (/** @type {number} */ g, /** @type {Set<string>} */ used) => g === groups.length
      || groups[g].some(id => have.includes(id) && !used.has(id) && assign(g + 1, new Set([...used, id])));
    return assign(0, new Set());
  };
  const isDone = (/** @type {State} */ s) => s.stage === 'post' && s.shape === t.shape
    && fills(s.mask) && (!targetNeg || isWanted(s.neg));
  // Both parents as positives, or one as a positive and the other as the curse; with a goal for
  // the spliced stat, neither may be above its window and one must be inside it.
  const canSplice = (/** @type {State} */ s) => s.stage === 'pre' && s.shape === t.shape
    && ((s.mask & parentMask) === parentMask || (isParent(s.neg) && (s.mask & (1 << (3 - s.neg))) !== 0))
    && (!win || (cat(s.pg, 0) !== 2 && cat(s.pg, 1) !== 2 && (cat(s.pg, 0) === 1 || cat(s.pg, 1) === 1)));

  /** The chance a fresh curse of a wanted stat meets the curse's goal. @param {Shape} shape @param {string} id */
  const meetsNeg = (shape, id) => (t.negGoal && SHAPES[shape].negatives ? meets(id, shape, '-', t.negGoal) : 1);
  if (NEG.length && t.negGoal && NEG.every(id => meetsNeg(t.shape, id) === 0)) {
    const r = range(STAT_BY_ID[NEG[0]], t.cls, t.shape, '-');
    const [lo, hi] = [Math.abs(r.at0), Math.abs(r.at1)].sort((a, b) => a - b).map(v => Math.round(v * 100) / 100);
    throw new Error(`${NEG.map(id => `-${STAT_BY_ID[id].name}`).join(' or ')} can't be ${OP_TEXT[t.negGoal.op]} ${t.negGoal.value} on a ${t.shape} riven${NEG.length > 1 ? '' : ` (it rolls ${lo} to ${hi})`}.`);
  }
  /**
   * Splits drawn stats into the ones that rolled well enough and the rest.
   * @param {string[]} drawn @param {Shape} shape @returns {[string[], number][]} [good ones, probability]
   */
  const rolls = (drawn, shape) => {
    let out = /** @type {[string[], number][]} */ ([[[], 1]]);
    for (const id of drawn) {
      const q = meets(id, shape);
      out = out.flatMap(([good, p]) => /** @type {[string[], number][]} */ ([[[...good, id], p * q], [good, p * (1 - q)]]))
        .filter(([, p]) => p > 0);
    }
    return out;
  };

  /**
   * A positive the target doesn't want isn't followed either: an ordinary stat stands for it (one
   * that can be a curse if there is one, as most can). Null if every positive is followed.
   * @param {'pre' | 'post'} stage
   */
  const spare = stage => {
    const tr = stage === 'pre' ? preTracked : postTracked;
    const free = posPool.filter(id => !tr.includes(id) && !NEG.includes(id));
    return free.find(id => negPool.includes(id)) ?? free[0] ?? null;
  };
  /** How many of the riven's positives the target has no use for. @param {State} s */
  const spares = s => {
    let wanted = s.stage === 'post' && S ? 1 : 0;
    for (let m = s.mask; m; m &= m - 1) wanted++;
    return SHAPES[s.shape].positives - wanted;
  };

  /**
   * Outcome distribution of one cycle.
   * @param {State} s @param {{lock: string | null}} action  lock = tracked id or 'NEG' or null
   * @returns {Map<string, number>}
   */
  function cycle(s, action) {
    const tr = tracked(s);
    const out = new Map();
    const lockPos = action.lock && action.lock !== 'NEG' && action.lock !== '+?' ? action.lock : null;
    const lockNeg = action.lock === 'NEG';
    // A locked positive the target doesn't want fills a slot and holds the shape (see spare).
    const lockSpare = action.lock === '+?' ? spare(s.stage) : null;
    const fixedPos = [...(s.stage === 'post' && S ? [S] : []), ...(lockPos ? [lockPos] : []), ...(lockSpare ? [lockSpare] : [])];
    const shapes = action.lock || (s.stage === 'post' && S) ? [s.shape] : SHAPE_ORDER;
    for (const shape of shapes) {
      const { positives: k, negatives: c } = SHAPES[shape];
      const d = k - fixedPos.length;
      if (d < 0) continue;
      // A stat locked as the negative can't also be drawn as a positive. For a group of wanted
      // curses that behave alike, any one of them stands for the locked one.
      // A curse the target doesn't want isn't followed: an ordinary stat that can be a curse
      // stands for it (nearly all of them are; one of the wanted positives' own stats is the exception).
      const lockedNeg = !lockNeg ? null : isWanted(s.neg) ? negGroups[s.neg - 4][0] : negStat(s.neg)
        ?? posPool.find(id => negPool.includes(id) && !NEG.includes(id) && !tr.includes(id) && !fixedPos.includes(id)) ?? null;
      const pool = posPool.filter(id => !fixedPos.includes(id) && id !== lockedNeg);
      const T = tr.filter(id => pool.includes(id));
      // Wanted curses that could be drawn as positives instead (x of them are, any x alike).
      const Xs = NEG.filter(id => pool.includes(id) && !tr.includes(id));
      const X = Xs.length;
      const xsMeet = (/** @type {Shape} */ sh) => (X ? Xs.reduce((a, id) => a + meetsNeg(sh, id), 0) / X : 0);
      const others = pool.filter(id => !T.includes(id) && !NEG.includes(id));
      const O1 = others.filter(id => negPool.includes(id)).length;
      const O2 = others.length - O1;
      const total = binom(pool.length, d);
      const negFixedPos = fixedPos.filter(id => negPool.includes(id)).length;
      for (let sub = 0; sub < 1 << T.length; sub++) {
        const A = T.filter((_, i) => sub & (1 << i));
        if (A.length > d) continue;
        for (let x = 0; x <= X; x++) for (let j = 0; j <= O1; j++) {
          const m = d - A.length - x - j;
          if (m < 0 || m > O2) continue;
          const p0 = (binom(X, x) * binom(O1, j) * binom(O2, m)) / total / shapes.length;
          if (!p0) continue;
          // Negative drawn from the negative pool minus everything that's already a positive: the
          // chance of each stat we track as a curse (the wanted one, or a parent not drawn as a positive).
          const taken = negFixedPos + A.filter(id => negPool.includes(id)).length + x + j;
          const negChances = negCodes(s.stage).filter(code => code > 0).map(code => {
            if (isWanted(code)) {
              // Any of the group's curses not already a positive: those of the x drawn are out
              // (each of the X equally likely to be among them).
              const good = negGroups[code - 4].reduce((a, id) => a + (A.includes(id) || fixedPos.includes(id) ? 0
                : meetsNeg(shape, id) * (Xs.includes(id) ? (X - x) / X : 1)), 0);
              return /** @type {[number, number]} */ ([code, good / (negPool.length - taken)]);
            }
            const id = /** @type {string} */ (negStat(code));
            const free = !A.includes(id) && !fixedPos.includes(id);
            return /** @type {[number, number]} */ ([code, free ? 1 / (negPool.length - taken) : 0]);
          });
          for (const [good, q] of rolls(A, shape)) {
            const p = p0 * q;
            let mask = 0;
            for (const id of [...good, ...(lockPos ? [lockPos] : [])]) mask |= 1 << tr.indexOf(id);
            // Parent rolls (with a spliced goal): a locked parent keeps its roll, a fresh one lands
            // below / inside / above the window with the chances in qCat.
            const kept = !win || s.stage !== 'pre' ? 0
              : s.pg & ((lockPos && parents?.includes(lockPos) ? catBits(parents.indexOf(lockPos)) : 0)
                | (lockNeg && isParent(s.neg) ? catBits(s.neg - 2) : 0));
            /** @param {number} neg @param {number} w */
            const put = (neg, w) => {
              const fresh = !win || s.stage !== 'pre' ? [] : [0, 1].filter(i => {
                const asPos = (mask & (1 << i)) !== 0 && lockPos !== parents?.[i];
                const asCurse = neg === 2 + i && !lockNeg;
                return asPos || asCurse;
              });
              let spread = /** @type {[number, number][]} */ ([[kept, w]]);
              for (const i of fresh) {
                spread = spread.flatMap(([pg, x]) => /** @type {[number, number][]} */ (qCat.map((q, c) => [pg | (c << (2 * i)), x * q])));
              }
              for (const [pg, x] of spread) {
                if (!x) continue;
                const kk = key({ stage: s.stage, mask, neg, shape, pg });
                out.set(kk, (out.get(kk) ?? 0) + x);
              }
            };
            if (c === 0) { put(0, p); continue; }
            if (lockNeg) { put(s.neg, p); continue; }
            let rest = 1;
            for (const [code, q] of negChances) { if (q) put(code, p * q); rest -= q; }
            put(0, p * rest);
          }
        }
      }
    }
    return out;
  }

  /**
   * Splicing: parents consumed, shape frozen. Two positive parents: a random positive takes the
   * second slot. A curse parent: a random curse replaces it.
   * @param {State} s
   */
  function splice(s) {
    const out = new Map();
    let mask = 0;
    const survivors = preTracked.filter((id, i) => i >= 2 && s.mask & (1 << i));
    for (const id of survivors) mask |= 1 << postTracked.indexOf(id);
    if (isParent(s.neg)) {
      // The new curse: from the negative pool minus the riven's positives (approximated by how
      // many positives the shape has; most stats can be either sign).
      const left = negPool.length - SHAPES[s.shape].positives;
      const wanted = negGroups.map((ids, g) => /** @type {[number, number]} */ ([4 + g,
        ids.filter(id => id !== S && !survivors.includes(id)).reduce((a, id) => a + meetsNeg(s.shape, id), 0) / left]));
      for (const [neg, w] of [...wanted, /** @type {[number, number]} */ ([0, 1 - wanted.reduce((a, [, w]) => a + w, 0)])]) {
        if (!w) continue;
        const kk = key({ stage: 'post', mask, neg, shape: s.shape, pg: 0 });
        out.set(kk, (out.get(kk) ?? 0) + w);
      }
      return out;
    }
    const pool = posPool.filter(id => id !== S && !survivors.includes(id));
    for (const id of pool) {
      const i = postTracked.indexOf(id);
      const q = i >= 0 ? meets(id, s.shape) : 0;
      for (const [m, w] of /** @type {[number, number][]} */ ([[mask | (i >= 0 ? 1 << i : 0), q], [mask, 1 - q]])) {
        if (!w) continue;
        const kk = key({ stage: 'post', mask: m, neg: isWanted(s.neg) ? s.neg : 0, shape: s.shape, pg: 0 });
        out.set(kk, (out.get(kk) ?? 0) + w / pool.length);
      }
    }
    return out;
  }

  /** @param {State} s @returns {{lock: string | null, label: string}[]} */
  function actions(s) {
    if (canSplice(s)) return [{ lock: 'SPLICE', label: 'splice' }];
    const acts = [{ lock: null, label: 'cycle' }];
    tracked(s).forEach((id, i) => { if (s.mask & (1 << i)) acts.push({ lock: id, label: `lock ${id}` }); });
    // The curse: the wanted one or a parent, or any other (its lock still holds the shape).
    if (s.neg || SHAPES[s.shape].negatives) acts.push({ lock: 'NEG', label: `lock ${negStat(s.neg) ?? 'the curse'}` });
    // A positive the target doesn't want: its lock holds the shape too, and leaves the curse rolling.
    if (spares(s) > 0 && spare(s.stage)) acts.push({ lock: '+?', label: 'lock a spare positive' });
    return acts;
  }

  if (modelOnly) return { states, isDone, cycle, negCode, postTracked, groups };

  // Transition tables per state and action.
  const keys = [...states.keys()];
  const index = new Map(keys.map((k, i) => [k, i]));
  const table = keys.map(k => {
    const s = /** @type {State} */ (states.get(k));
    if (isDone(s)) return [];
    return actions(s).map(a => ({
      ...a,
      cost: a.lock === 'SPLICE' ? 0 : a.lock ? 2 * FLAT_COST : FLAT_COST,
      cycles: a.lock === 'SPLICE' ? 0 : 1,
      next: [...(a.lock === 'SPLICE' ? splice(s) : cycle(s, a))].map(([kk, p]) => [/** @type {number} */ (index.get(kk)), p]),
    }));
  });

  // Policy iteration: start unlocked (splice where possible), evaluate, improve, repeat.
  let policy = table.map(acts => (acts.length ? 0 : -1));
  /** @param {'cost' | 'cycles'} field */
  const evaluate = field => {
    const n = keys.length;
    const A = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n + 1); r[i] = 1; return r; });
    table.forEach((acts, i) => {
      if (policy[i] < 0) return;
      const a = acts[policy[i]];
      A[i][n] = a[field];
      for (const [j, p] of a.next) A[i][j] -= p;
    });
    return gauss(A);
  };
  let V = evaluate('cost');
  for (let iter = 0; iter < 50; iter++) {
    let changed = false;
    policy = table.map((acts, i) => {
      if (!acts.length) return -1;
      const value = (/** @type {any} */ a) => a.cost + a.next.reduce((/** @type {number} */ sum, /** @type {[number, number]} */ [j, p]) => sum + p * V[j], 0);
      // Keep the current action unless another is clearly cheaper (avoids flip-flopping on ties).
      let best = policy[i], bestV = value(acts[best]);
      acts.forEach((a, ai) => {
        const v = value(a);
        if (v < bestV - 1e-9 * Math.max(1, bestV)) { bestV = v; best = ai; }
      });
      if (best !== policy[i]) changed = true;
      return best;
    });
    V = evaluate('cost');
    if (!changed) break;
  }
  const C = evaluate('cycles');
  return { states, keys, index, table, policy, V, C, isDone, canSplice, cycle, negStat, negCode, preTracked, postTracked, stage0: stages[0], win };
}

/** Solves A·x = b (augmented rows), partial pivoting. @param {Float64Array[]} A */
function gauss(A) {
  const n = A.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    if (Math.abs(d) < 1e-15) throw new Error('That target can\'t be reached.');
    for (let c = col; c <= n; c++) A[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col || !A[r][col]) continue;
      const f = A[r][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map(row => row[n]);
}

/**
 * @typedef {object} Step   one row of the plan
 * @property {'pre' | 'post'} stage
 * @property {string[]} have        wanted traits the riven has in this situation ('-x' for the negative)
 * @property {string[]} good        splice parents whose roll is inside the spliced stat's goal window
 * @property {string[]} high        splice parents whose roll is above it (too high for an at most / exactly goal)
 * @property {Shape} shape
 * @property {string} action        'cycle', 'splice', or the id to lock ('-x' for the negative, '-?' for
 *   a curse the target doesn't want, '+?' for a positive it doesn't want)
 * @property {number} kuva          expected Kuva from here to the finished riven
 * @property {number} cycles        expected cycles from here
 */

/**
 * Lock a positive or the curse? For a riven on the target shape that has one wanted positive and an
 * acceptable curse (and the spliced stat, if the target has one), the chance one locked cycle
 * finishes it, either way, by how many curses would do: the target's own first, then others this
 * weapon can roll. Both locks cost the same, so the better chance is the better lock.
 * Null when there is no such choice: no curse wanted, or fewer than two positives left to roll
 * (a riven with the one positive and the curse is already done).
 * @param {Target} t @param {number} [most]
 * @returns {{count: number, own: boolean, positive: number, negative: number}[] | null}
 */
export function lockOdds(t, most = 6) {
  if (!SHAPES[t.shape].negatives) return null;
  const { positive: posPool, negative: negPool } = pools(t.cls, t.ipsCode);
  const own = negativesOf(t).filter(id => negPool.includes(id));
  if (!own.length) return null;
  // Curses to add past the target's own: not wanted as positives, the usual kind first (stats
  // that can be either sign).
  const wanted = new Set(/** @type {string[]} */ (t.positives.flat()));
  const more = negPool.filter(id => !own.includes(id) && !wanted.has(id) && id !== t.spliced);
  const list = [...own, ...more.filter(id => posPool.includes(id)), ...more.filter(id => !posPool.includes(id))];
  const rows = [];
  for (let count = 1; count <= Math.min(most, list.length); count++) {
    let m;
    try { m = solveFor({ ...t, negative: list.slice(0, count) }, null, true); } catch { return null; }
    if (m.groups.length < 2) return null;
    const neg = m.negCode(list[0], 'post');
    /** The chance one cycle with that lock ends on a finished riven. */
    const finish = (/** @type {number} */ mask, /** @type {string} */ lock) => {
      let p = 0;
      for (const [k, q] of m.cycle({ stage: 'post', mask, neg, shape: t.shape, pg: 0 }, { lock })) {
        const s = m.states.get(k);
        if (s && m.isDone(s)) p += q;
      }
      return p;
    };
    rows.push({
      count,
      own: count === own.length,
      // Whichever wanted positive is the best one to hold (one that can't be a curse, say).
      positive: Math.max(...m.groups.map((/** @type {string[]} */ g) => finish(1 << m.postTracked.indexOf(g[0]), g[0]))),
      negative: finish(0, 'NEG'),
    });
  }
  return rows;
}

/**
 * The window of rolls (0–1) a splice parent's roll must land in for the spliced stat to meet its
 * goal on the target shape, or null with no goal. hi <= lo: the goal can't be met.
 * @param {Target} t @returns {{lo: number, hi: number} | null}
 */
export function splicedRollWindow(t) {
  const goal = t.spliced ? t.goals?.[t.spliced] : undefined;
  if (!goal || !t.spliced) return null;
  const stat = STAT_BY_ID[t.spliced];
  const half = stat.unit === 'mult' ? 0.005 : 0.05;
  const r = range(stat, t.cls, t.shape, '+');
  const sign = r.at1 < 0 ? -1 : 1;
  const u = (/** @type {number} */ mag) => Math.min(1, Math.max(0, solveU(stat, t.cls, t.shape, '+', sign * mag)));
  return { lo: goal.op === 'lte' ? 0 : u(goal.value - half), hi: goal.op === 'gte' ? 1 : u(goal.value + half) };
}

/**
 * Plans the cheapest route to a target riven.
 * @param {Target} t
 * @param {{stage: 'pre' | 'post', have: string[], shape: Shape, goodParents?: string[], highParents?: string[]} | null} [current]
 *   the riven you have now ('-x' = has x as its negative); null = a fresh, random riven.
 *   goodParents / highParents: with a goal for the spliced stat, the parents on it whose roll is
 *   inside / above its window (default: all inside)
 */
export function planBuild(t, current = null) {
  const S = t.spliced;
  const recipes = S ? (t.parents ? [t.parents] : /** @type {string[][]} */ (STAT_BY_ID[S].from)) : [null];
  /** @type {any[]} */
  const solved = [];
  const errors = [];
  for (const parents of recipes) {
    try { solved.push({ parents, ...solveFor(t, parents) }); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  if (!solved.length) throw new Error(errors[0] ?? 'That target can\'t be reached.');

  const start = (/** @type {any} */ sol) => {
    if (current) {
      const tr = current.stage === 'pre' ? sol.preTracked : sol.postTracked;
      let mask = 0;
      for (const id of current.have) if (!id.startsWith('-') && tr.includes(id)) mask |= 1 << tr.indexOf(id);
      const stage = sol.parents ? current.stage : 'post';
      // The riven's negative: the wanted one (1), a splice parent (2 / 3, before the splice), or other.
      const curse = current.have.find(id => id.startsWith('-'))?.slice(1);
      const neg = curse && SHAPES[current.shape].negatives > 0 ? sol.negCode(curse, stage) : 0;
      let pg = 0;
      if (sol.win && stage === 'pre') {
        const on = (/** @type {string} */ id) => current.have.includes(id) || (curse === id && (neg === 2 || neg === 3));
        sol.parents.forEach((/** @type {string} */ id, /** @type {number} */ i) => {
          if (!on(id)) return;
          if (current.highParents?.includes(id)) pg |= 2 << (2 * i);
          else if ((current.goodParents ?? sol.parents).includes(id)) pg |= 1 << (2 * i);
        });
      }
      return new Map([[`${stage}|${mask}|${neg}|${current.shape}|${pg}`, 1]]);
    }
    // A fresh riven: as if one unlocked cycle from nothing.
    return sol.cycle({ stage: sol.stage0, mask: 0, neg: 0, shape: SHAPE_ORDER[0], pg: 0 }, { lock: null });
  };
  const expected = (/** @type {any} */ sol, /** @type {number[]} */ vals) =>
    [...start(sol)].reduce((sum, [k, p]) => sum + p * vals[sol.index.get(k)], 0);

  for (const sol of solved) { sol.kuva = expected(sol, sol.V); sol.cyclesExp = expected(sol, sol.C); }
  solved.sort((a, b) => a.kuva - b.kuva);
  const best = solved[0];

  // Cycle-count quantiles: step the probability distribution forward under the policy.
  const dist = new Float64Array(best.keys.length);
  for (const [k, p] of start(best)) dist[best.index.get(k)] += p;
  const quantile = { median: -1, likely: 0 };
  let done = 0, cycles = 0, cur = dist;
  const doneIdx = best.keys.map((/** @type {string} */ k) => best.isDone(best.states.get(k)));
  const absorb = () => cur.reduce((s, p, i) => s + (doneIdx[i] ? p : 0), 0);
  // Splices are free: apply them without counting a cycle (a riven that can splice into the
  // target right away needs 0 cycles).
  const splice = () => {
    for (let pass = 0; pass < 2; pass++) {
      const next = new Float64Array(cur.length);
      cur.forEach((p, i) => {
        if (!p) return;
        const a = best.table[i][best.policy[i]];
        if (!a || a.lock !== 'SPLICE') { next[i] += p; return; }
        for (const [j, q] of a.next) next[j] += p * q;
      });
      cur = next;
    }
  };
  splice();
  done = absorb();
  if (done >= 0.5) quantile.median = 0;
  while (cycles < 200000 && done < 0.9) {
    const next = new Float64Array(cur.length);
    cur.forEach((p, i) => {
      if (!p) return;
      const a = best.table[i][best.policy[i]];
      if (!a) { next[i] += p; return; }
      for (const [j, q] of a.next) next[j] += p * q;
    });
    cur = next;
    cycles++;
    splice();
    done = absorb();
    if (quantile.median < 0 && done >= 0.5) quantile.median = cycles;
  }
  quantile.likely = cycles;
  const kuvaPerCycle = best.cyclesExp > 0 ? best.kuva / best.cyclesExp : FLAT_COST;

  /** @type {Step[]} */
  const steps = [];
  best.keys.forEach((/** @type {string} */ k, /** @type {number} */ i) => {
    const s = best.states.get(k);
    if (best.isDone(s) || s.shape !== t.shape) return;
    const tr = s.stage === 'pre' ? best.preTracked : best.postTracked;
    const a = best.table[i][best.policy[i]];
    const move = a.lock === 'SPLICE' ? 'splice' : a.lock === 'NEG' ? `-${best.negStat(s.neg) ?? '?'}` : a.lock ?? 'cycle';
    steps.push({
      stage: s.stage,
      have: [...tr.filter((/** @type {string} */ _, /** @type {number} */ b) => s.mask & (1 << b)), ...(s.neg ? [`-${best.negStat(s.neg)}`] : [])],
      shape: s.shape,
      good: (best.parents ?? []).filter((/** @type {string} */ _, /** @type {number} */ b) => ((s.pg >> (2 * b)) & 3) === 1),
      high: (best.parents ?? []).filter((/** @type {string} */ _, /** @type {number} */ b) => ((s.pg >> (2 * b)) & 3) === 2),
      action: move,
      kuva: best.V[i],
      cycles: best.C[i],
    });
  });
  steps.sort((a, b) => (a.stage === b.stage ? 0 : a.stage === 'pre' ? -1 : 1) || b.kuva - a.kuva);

  return {
    parents: best.parents,
    alternatives: solved.slice(1).map(s => ({ parents: s.parents, kuva: s.kuva })),
    expectedKuva: best.kuva,
    expectedCycles: best.cyclesExp,
    median: { cycles: quantile.median, kuva: quantile.median * kuvaPerCycle },
    likely: { cycles: quantile.likely, kuva: quantile.likely * kuvaPerCycle },
    steps,
  };
}
