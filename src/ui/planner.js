// @ts-check
// Build planner: pick the riven you want (positives, an optional spliced stat, a negative) and get
// the cheapest route to it: what to cycle for, what to lock at each point, when to splice, and
// the Kuva it's likely to cost.

import { CLASSES, SHAPES, SPLICED, STAT_BY_ID } from '../data/stats.js';
import { SHAPE_ORDER, displayValue, format, range, solveU, rollScore } from '../engine.js';
import { WEAPONS } from '../data/weapons.js';
import { pools } from '../cycle.js';
import { planBuild, OP_TEXT, splicedRollWindow } from '../planner.js';
import { CLASS_LABEL, el, statName, segmented, select, weaponPicker, copyLinkButton, ipsOf } from './dom.js';
import { loadState, saveState, pick, oneOf } from './state.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */

const NONE = '';

/** @typedef {'gte' | 'lte' | 'eq'} Op */
const OPS = /** @type {Op[]} */ (['lte', 'eq', 'gte']);
const OP_TIP = { lte: 'at most', eq: 'exactly', gte: 'at least' };
/** ≤ / = / ≥ buttons, with "at most" / "exactly" / "at least" on hover. @param {string} label @param {Op} op @param {(op: Op) => void} onChange */
const opPicker = (label, op, onChange) => segmented(label, OPS, op, v => onChange(/** @type {Op} */ (v)),
  v => OP_TEXT[/** @type {Op} */ (v)], v => OP_TIP[/** @type {Op} */ (v)]);
const state = {
  weapon: '',
  cls: /** @type {WeaponClass} */ ('rifle'),
  spliced: NONE,
  recipe: NONE,                         // "a+b", or '' for the cheapest
  want: [NONE, NONE, NONE],
  mins: ['', '', ''],                   // value wanted for each positive, '' = any
  ops: /** @type {Op[]} */ (['gte', 'gte', 'gte']),
  negative: NONE,
  negOp: /** @type {Op} */ ('gte'),
  negMin: '',                           // value wanted for the curse (its size), '' = any
  shape: /** @type {Shape | 'any'} */ ('any'),   // the finished riven's shape; 'any' = the cheapest
  from: /** @type {'fresh' | 'mine'} */ ('fresh'),
  // The riven you have now: its positives (spliced ones included) and its negative.
  myPos: [NONE, NONE, NONE],
  myNeg: NONE,
  myVals: ['', '', ''],                 // its positives' values, '' = not given
  myNegVal: '',                         // its curse's value (asked when the curse is a splice parent)
  splicedMin: '',                       // value wanted for the spliced stat, '' = any
  splicedOp: /** @type {Op} */ ('gte'),
  myLocks: /** @type {string[]} */ ([]), // stats locked on it now
};

/** "100", "+100%", "x1.3" → 100 / 1.3; null for blank or junk. @param {string} v */
const magnitude = v => {
  const m = v.replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** The target shape being planned (state.shape, or with 'any' the shape being tried). */
let T = /** @type {Shape} */ ('+++-');

/** The value goals as the planner takes them. @returns {Record<string, import('../planner.js').ValueGoal>} */
function valueGoals() {
  /** @type {Record<string, import('../planner.js').ValueGoal>} */
  const out = {};
  state.want.forEach((id, i) => { const m = magnitude(state.mins[i]); if (id && m !== null) out[id] = { op: state.ops[i], value: m }; });
  const sm = magnitude(state.splicedMin);
  if (state.spliced && sm !== null) out[state.spliced] = { op: state.splicedOp, value: sm };
  return out;
}

/** The curse's value goal, if any. @returns {import('../planner.js').ValueGoal | undefined} */
function negGoal() {
  const m = magnitude(state.negMin);
  return state.negative && m !== null ? { op: state.negOp, value: m } : undefined;
}

/** The splice parents that matter for the spliced stat's goal: every recipe's, or the chosen one's. */
function goalParents() {
  if (!state.spliced || !valueGoals()[state.spliced]) return [];
  const recipes = state.recipe ? [state.recipe.split('+')] : /** @type {string[][]} */ (STAT_BY_ID[state.spliced].from);
  return [...new Set(recipes.flat())];
}

/**
 * Your riven's parents whose roll is inside the spliced stat's goal window, and those above it
 * (the spliced stat keeps the better parent roll). A parent with no value given counts as inside.
 * @param {Shape} shape @returns {{good: string[], high: string[]} | undefined}
 */
function parentRolls(shape) {
  const win = splicedRollWindow({ cls: state.cls, positives: [], spliced: state.spliced || null, negative: null, shape: T, goals: valueGoals() });
  if (win === null) return undefined;
  const rollOf = (/** @type {string} */ id, /** @type {'+' | '-'} */ sign, /** @type {string} */ v) => {
    const m = magnitude(v);
    if (m === null) return 1;
    const r = range(STAT_BY_ID[id], state.cls, shape, sign);
    return solveU(STAT_BY_ID[id], state.cls, shape, sign, Math.sign(r.at1) * m);
  };
  const on = goalParents().flatMap(id => {
    const i = state.myPos.indexOf(id);
    if (i >= 0) return [[id, magnitude(state.myVals[i]) === null ? null : rollOf(id, '+', state.myVals[i])]];
    return id === state.myNeg ? [[id, magnitude(state.myNegVal) === null ? null : rollOf(id, '-', state.myNegVal)]] : [];
  });
  return {
    good: on.filter(([, u]) => u === null || (u >= win.lo && u <= win.hi)).map(([id]) => /** @type {string} */ (id)),
    high: on.filter(([, u]) => u !== null && u > win.hi).map(([id]) => /** @type {string} */ (id)),
  };
}

/** Whether a shown value meets a goal. @param {number} v @param {import('../planner.js').ValueGoal} g */
const meetsGoal = (v, g) => (g.op === 'gte' ? v >= g.value : g.op === 'lte' ? v <= g.value : v === g.value);

/** A padlock toggle for one of your riven's stats. @param {string} id */
function lockToggle(id) {
  const on = state.myLocks.includes(id);
  const b = el('button', { type: 'button', class: 'icon-button lock', 'aria-pressed': String(on), 'aria-label': `${name(id)} locked`, title: 'Locked now' }, ['🔒']);
  b.addEventListener('click', () => {
    state.myLocks = on ? state.myLocks.filter(x => x !== id) : [...state.myLocks, id];
    render();
  });
  return b;
}

/**
 * The next move from your riven, given what's locked on it now: "Unlock Cold, lock Toxin and cycle".
 * @param {string} action @param {string[]} parents @param {boolean} spliced  after the splice
 */
function nextMove(action, parents, spliced) {
  if (action === 'splice' || action === '-?') return actionText(action, parents, current().have, spliced);
  const want = action === 'cycle' ? null : action.startsWith('-') ? action.slice(1) : action;
  // (The spliced stat's lock is a slot of its own: it stays.)
  const unlock = state.myLocks.filter(id => id !== want && !(spliced && id === state.spliced));
  const keep = want !== null && state.myLocks.includes(want);
  const text = want === null ? 'cycle' : `${keep ? 'keep' : 'lock'} ${name(action)} ${keep ? 'locked ' : ''}and cycle`;
  const rest = spliced ? `, with ${name(state.spliced)} locked` : want === null && !unlock.length ? ', nothing locked' : '';
  return (unlock.length ? `Unlock ${unlock.map(name).join(', ')}, ${text}` : text[0].toUpperCase() + text.slice(1)) + rest;
}

/**
 * A number box that updates on change (not every keystroke, so re-rendering doesn't steal focus).
 * @param {string} labelText @param {string} value @param {string} placeholder @param {(v: string) => void} onChange
 * @param {string} [shown]  the visible label, if different ('' for none: labelText stays as the accessible name)
 */
function numberBox(labelText, value, placeholder, onChange, shown = labelText) {
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'text', inputmode: 'decimal', value, placeholder, 'aria-label': labelText }));
  input.addEventListener('change', () => onChange(input.value.trim()));
  return el('label', { class: 'field target' }, [...(shown ? [el('span', {}, [shown])] : []), input]);
}

/**
 * The riven you have, as the planner needs it: its shape (null if it isn't a real riven), whether
 * the target's spliced stat is already on it, and every stat on it ("-id" for the negative).
 * @returns {{shape: Shape | null, stage: 'pre' | 'post', have: string[], goodParents?: string[], highParents?: string[]}}
 */
function current() {
  const pos = state.myPos.filter(Boolean);
  const shape = pos.length >= 2 && new Set(pos).size === pos.length
    ? /** @type {Shape} */ ('+'.repeat(pos.length) + (state.myNeg ? '-' : '')) : null;
  // A stat whose value is given and below the goal doesn't count yet.
  const goals = valueGoals();
  const good = state.myPos.filter((id, i) => {
    const v = magnitude(state.myVals[i]);
    return id && !(goals[id] && v !== null && !meetsGoal(v, goals[id]));
  });
  // Likewise the wanted curse, if its value misses its goal.
  const ng = negGoal(), nv = magnitude(state.myNegVal);
  const curseOk = !(state.myNeg === state.negative && ng && nv !== null && !meetsGoal(nv, ng));
  const rolls = shape ? parentRolls(shape) : undefined;
  return {
    shape,
    stage: state.spliced && pos.includes(state.spliced) ? 'post' : 'pre',
    have: [...good, ...(state.myNeg && curseOk ? [`-${state.myNeg}`] : [])],
    goodParents: rolls?.good,
    highParents: rolls?.high,
  };
}

/** Splices the riven you have could do right now: "Cold + Toxin → Viral". @param {string[]} positive */
function splicesNow(positive) {
  const pos = state.myPos.filter(Boolean);
  if (pos.some(id => STAT_BY_ID[id].spliced)) return [];     // one splice per riven
  return SPLICED.filter(s => s.b[state.cls] !== undefined).flatMap(s => /** @type {string[][]} */ (s.from)
    // Both parents as positives, or one of them as the curse.
    .filter(r => r.every(id => pos.includes(id) || id === state.myNeg) && r.some(id => pos.includes(id)))
    .map(r => `${r.map(id => (id === state.myNeg ? name(`-${id}`) : name(id))).join(' + ')} → ${name(s.id)}`));
}

/** A roll on the grader's ±10% scale. @param {number} u */
const rollText = u => { const x = rollScore(u); return `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(4)}%`; };

const kuva = (/** @type {number} */ n) => `${Math.round(n).toLocaleString('en-US')} Kuva`;
const cyc = (/** @type {number} */ n) => `${n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-US')} cycles`;
const name = (/** @type {string} */ id) => (id.startsWith('-') ? `−${statName(STAT_BY_ID[id.slice(1)], state.cls)}` : statName(STAT_BY_ID[id], state.cls));

/** Shapes that can hold the target. */
function validShapes() {
  const pos = state.want.filter(Boolean).length + (state.spliced ? 1 : 0);
  return SHAPE_ORDER.filter(s => SHAPES[s].positives >= Math.max(2, pos) && (!state.negative || SHAPES[s].negatives > 0));
}

function controls() {
  const set = (/** @type {Partial<typeof state>} */ patch) => { Object.assign(state, patch); render(); };
  const { positive, negative } = pools(state.cls, ipsOf(state.weapon));
  const posOptions = /** @type {[string, string][]} */ ([[NONE, '—'], ...positive.map(id => [id, name(id)])]);
  const negOptions = /** @type {[string, string][]} */ ([[NONE, "Don't care"], ...negative.map(id => [id, name(id)])]);
  const splicedList = SPLICED.filter(s => s.b[state.cls] !== undefined);
  const splicedOptions = /** @type {[string, string][]} */ ([[NONE, 'None'], ...splicedList.map(s => [s.id, name(s.id)])]);
  // Keep choices valid for the class.
  state.want = state.want.map(id => (positive.includes(id) ? id : NONE));
  if (!negative.includes(state.negative)) state.negative = NONE;
  if (!splicedList.some(s => s.id === state.spliced)) state.spliced = NONE;
  const shapes = validShapes();
  if (state.shape !== 'any' && !shapes.includes(state.shape)) state.shape = 'any';

  const recipes = state.spliced ? /** @type {string[][]} */ (STAT_BY_ID[state.spliced].from).filter(r => r.every(id => positive.includes(id))) : [];
  const recipeOptions = /** @type {[string, string][]} */ ([[NONE, 'Cheapest'], ...recipes.map(r => [r.join('+'), r.map(name).join(' + ')])]);
  if (!recipeOptions.some(([v]) => v === state.recipe)) state.recipe = NONE;

  const rows = [
    el('div', { class: 'controls' }, [
      weaponPicker(WEAPONS, state.weapon, (weapon, cls) => set({ weapon, cls })),
      segmented('Weapon class', CLASSES, state.cls, v => set({ cls: /** @type {WeaponClass} */ (v), weapon: '' }),
        v => CLASS_LABEL[/** @type {WeaponClass} */ (v)]),
    ]),
    el('div', { class: 'controls' }, [
      select('Spliced', splicedOptions, state.spliced, v => set({ spliced: v })),
      ...(state.spliced ? [
        opPicker('Spliced value', state.splicedOp, v => set({ splicedOp: v })),
        numberBox('Spliced value', state.splicedMin, 'any value', v => set({ splicedMin: v }), ''),
      ] : []),
      ...(recipes.length > 1 ? [select('From', recipeOptions, state.recipe, v => set({ recipe: v }))] : []),
    ]),
    ...state.want.map((id, i) => el('div', { class: 'controls' }, [
      select(`Positive ${i + 1}`, posOptions, id, v => {
        const want = [...state.want];
        want[i] = v;
        set({ want });
      }),
      ...(id ? [
        opPicker(`Positive ${i + 1} value`, state.ops[i], v => {
          const ops = [...state.ops];
          ops[i] = v;
          set({ ops });
        }),
        numberBox(`Positive ${i + 1} value`, state.mins[i], 'any value', v => {
          const mins = [...state.mins];
          mins[i] = v;
          set({ mins });
        }, ''),
      ] : []),
    ])),
    el('div', { class: 'controls' }, [
      select('Negative', negOptions, state.negative, v => set({ negative: v })),
      // The curse's size: "≤ 30" = no worse than -30%.
      ...(state.negative ? [
        opPicker('Negative value', state.negOp, v => set({ negOp: v })),
        numberBox('Negative value (its size)', state.negMin, 'any value', v => set({ negMin: v }), ''),
      ] : []),
    ]),
    el('div', { class: 'controls' }, [
      select('Shape', [['any', 'Any (cheapest)'], ...(shapes.length ? shapes : SHAPE_ORDER).map(s => /** @type {[string, string]} */ ([s, s]))], state.shape,
        v => set({ shape: /** @type {Shape | 'any'} */ (v) })),
    ]),
    el('div', { class: 'controls' }, [
      segmented('Start from', ['fresh', 'mine'], state.from, v => set({ from: /** @type {any} */ (v) }),
        v => (v === 'fresh' ? 'A fresh riven' : 'The riven I have')),
    ]),
  ];

  if (state.from === 'mine') {
    // The riven you have now, stat by stat (spliced stats included, for a riven that already has one).
    const myPosOptions = /** @type {[string, string][]} */ ([...posOptions, ...splicedList.map(s => [s.id, name(s.id)])]);
    state.myPos = state.myPos.map(id => (myPosOptions.some(([v]) => v === id) ? id : NONE));
    if (!negative.includes(state.myNeg)) state.myNeg = NONE;
    state.myLocks = state.myLocks.filter(id => state.myPos.includes(id) || id === state.myNeg);
    rows.push(el('h3', { class: 'plan-stage' }, ['Your riven now']));
    const goals = valueGoals();
    rows.push(...state.myPos.map((id, i) => el('div', { class: 'controls' }, [
      select(`Its positive ${i + 1}`, myPosOptions, id, v => {
        const myPos = [...state.myPos];
        myPos[i] = v;
        set({ myPos });
      }),
      // Only asked when there's a value goal for that stat, or it's a parent of a spliced stat with one.
      ...(id ? [lockToggle(id)] : []),
      ...(id && (goals[id] || goalParents().includes(id)) ? [numberBox('value', state.myVals[i], 'meets it', v => {
        const myVals = [...state.myVals];
        myVals[i] = v;
        set({ myVals });
      })] : []),
    ])));
    rows.push(el('div', { class: 'controls' }, [
      select('Its negative', [[NONE, 'None'], ...negOptions.slice(1)], state.myNeg, v => set({ myNeg: v })),
      ...(state.myNeg ? [lockToggle(state.myNeg)] : []),
      ...(state.myNeg && (goalParents().includes(state.myNeg) || (state.myNeg === state.negative && negGoal()))
        ? [numberBox('value', state.myNegVal, 'meets it', v => set({ myNegVal: v }))] : []),
    ]));
    const now = splicesNow(positive);
    if (now.length) rows.push(el('p', { class: 'note next' }, [`It can splice now: ${now.join('; ')}.`]));
    // ...but for a spliced goal, only with a parent that rolled well enough.
    const cur = current();
    const stuck = cur.goodParents && (cur.highParents?.length || !cur.goodParents.length);
    if (now.length && cur.shape && stuck && state.spliced && now.some(t => t.endsWith(name(state.spliced)))) {
      const g = valueGoals()[state.spliced];
      rows.push(el('p', { class: 'note warn' }, [`Its parents' rolls don't give ${name(state.spliced)} ${OP_TEXT[g.op]} ${g.value} yet `
        + `(${cur.highParents?.length ? `${cur.highParents.map(name).join(' and ')} rolled too high: ` : ''}the spliced stat keeps the better parent roll).`]));
    }
  }
  return el('div', {}, rows);
}

/**
 * @param {string} action @param {string[]} parents
 * @param {string[]} [have] the riven's stats at that point ('-x' = x is its curse, which can be a parent)
 * @param {boolean} [spliced] after the splice (the spliced stat stays locked, in a slot of its own)
 */
function actionText(action, parents, have = [], spliced = false) {
  const also = spliced ? ` (with ${name(state.spliced)})` : '';
  if (action === 'cycle') return spliced ? `Cycle with only ${name(state.spliced)} locked` : 'Cycle, nothing locked';
  if (action === 'splice') return `Splice ${parents.map(id => name(have.includes(`-${id}`) ? `-${id}` : id)).join(' + ')} → ${name(state.spliced)}`;
  // Any curse: its lock holds the shape.
  if (action === '-?') return `Lock the curse${also} and cycle`;
  return `Lock ${name(action)}${also} and cycle`;
}

function results() {
  const want = state.want.filter(Boolean);
  const problems = [];
  if (new Set(want).size !== want.length) problems.push('The same positive is picked twice.');
  if (!want.length && !state.spliced) problems.push('Pick at least one stat you want.');
  if (!validShapes().length) problems.push('No riven shape can hold all of that.');
  if (state.from === 'mine' && !current().shape) problems.push('Enter your riven: at least 2 different positives.');
  if (problems.length) return el('div', {}, problems.map(p => el('p', { class: 'note warn' }, [p])));

  // Plan each candidate shape (just the chosen one, or with 'any' every shape that can hold the
  // target) and keep the cheapest.
  const candidates = state.shape === 'any' ? validShapes() : [state.shape];
  /** @type {{shape: Shape, plan: ReturnType<typeof planBuild>, mineNow: ReturnType<typeof current> | null}[]} */
  const tried = [];
  const errors = [];
  for (const shape of candidates) {
    T = shape;
    const mineNow = state.from === 'mine' ? current() : null;
    try {
      const plan = planBuild({
        cls: state.cls, ipsCode: ipsOf(state.weapon), positives: want, spliced: state.spliced || null,
        parents: state.recipe ? state.recipe.split('+') : undefined, negative: state.negative || null, shape,
        goals: valueGoals(), negGoal: negGoal(),
      }, mineNow && mineNow.shape
        ? { stage: state.spliced ? mineNow.stage : 'post', have: mineNow.have, shape: mineNow.shape, goodParents: mineNow.goodParents, highParents: mineNow.highParents }
        : null);
      tried.push({ shape, plan, mineNow });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (!tried.length) return el('p', { class: 'note warn' }, [errors[0] ?? "That target can't be reached."]);
  tried.sort((a, b) => a.plan.expectedKuva - b.plan.expectedKuva);
  const { plan, mineNow } = tried[0];
  T = tried[0].shape;

  const parents = plan.parents ?? [];
  // The table row your riven is on: the stats it has among those the plan tracks at its stage.
  let mine = null;
  if (mineNow?.shape) {
    const stage = state.spliced ? mineNow.stage : 'post';
    const steps = plan.steps.filter(s => s.stage === stage && s.shape === mineNow.shape);
    const tracked = new Set(steps.flatMap(s => s.have));
    const key = mineNow.have.filter(id => tracked.has(id)).sort().join();
    // With a spliced goal, rows also differ by which parents rolled well enough.
    const onIt = (/** @type {string[] | undefined} */ ids) => (ids ?? []).filter(id => mineNow.have.some(h => h === id || h === `-${id}`)).sort().join();
    const rolled = plan.steps.some(x => x.good.length || x.high.length);
    mine = steps.find(s => [...s.have].sort().join() === key
      && (!rolled || ([...s.good].sort().join() === onIt(mineNow.goodParents) && [...s.high].sort().join() === onIt(mineNow.highParents)))) ?? null;
  }
  // Goals every roll meets ("≥ 1") aren't wrong, just pointless: say so, and plan anyway.
  const ng = negGoal();
  const trivial = [...Object.entries(valueGoals()).map(([id, g]) => /** @type {const} */ ([id, g, '+'])), ...(ng ? [/** @type {const} */ ([state.negative, ng, '-'])] : [])].flatMap(([id, g, pm]) => {
    if (pm === '-' && !SHAPES[T].negatives) return [];
    const r = range(STAT_BY_ID[id], state.cls, T, pm);
    const [lo, hi] = [Math.abs(r.at0), Math.abs(r.at1)].sort((a, b) => a - b).map(v => Math.round(v * 100) / 100);
    const always = g.op === 'gte' ? g.value <= lo : g.op === 'lte' ? g.value >= hi : false;
    return always ? [`${name(pm === '-' ? `-${id}` : id)} ${OP_TEXT[g.op]} ${g.value} is met by every roll (it rolls ${lo} to ${hi} on a ${T} riven), so it doesn't change the plan.`] : [];
  });
  const shapeNote = state.shape === 'any' && tried.length > 1
    ? [el('p', { class: 'note' }, [`Cheapest shape: ${T}. `
      + tried.slice(1).map(x => `${x.shape} would average ${kuva(x.plan.expectedKuva)}`).join('; ') + '.'])]
    : [];
  const out = [
    ...trivial.map(t => el('p', { class: 'note warn' }, [t])),
    el('p', { class: 'summary' }, [
      plan.expectedCycles < 0.005
        ? 'From your riven: no Kuva needed.'
        : `${state.from === 'mine' ? 'From your riven' : 'From a fresh riven'}: about ${kuva(plan.expectedKuva)} (${cyc(plan.expectedCycles)}) on average.`]),
    el('p', { class: 'note' }, [
      `Half of runs finish within ${cyc(plan.median.cycles)} (about ${kuva(plan.median.kuva)}); `
      + `9 in 10 within ${cyc(plan.likely.cycles)} (about ${kuva(plan.likely.kuva)}).`
      + (plan.alternatives.length ? ` Splicing from ${plan.alternatives.map(a => `${a.parents.map(name).join(' + ')} would average ${kuva(a.kuva)}`).join('; ')}.` : '')]),
    ...shapeNote,
  ];
  if (state.from === 'mine') {
    out.push(el('p', { class: 'note next' }, [mine
      ? `Your next move: ${nextMove(mine.action, parents, mine.stage === 'post' && !!state.spliced)}.`
      : `Your riven isn't the ${T} shape the target needs${state.spliced && mineNow?.stage === 'post' ? ', and a spliced riven\'s shape can\'t change' : ''}: cycle it unlocked until it is.`
        + (state.shape !== 'any' && mineNow?.shape ? ` (Or set Shape to Any to also plan for its own ${mineNow.shape} shape.)` : '')]));
  }

  /** @param {'pre' | 'post'} stage @param {string} title */
  const table = (stage, title) => {
    const steps = plan.steps.filter(s => s.stage === stage);
    if (!steps.length) return [];
    // The table as a short rule list, read top-down (the first row that matches is the one): each
    // row is the fewest traits that pick out situations sharing one move, so a dozen situations
    // that all say "lock Magazine Capacity" become one "Has Magazine Capacity" row.
    const situation = (/** @type {typeof steps[number]} */ s) => (s.have.length
      ? s.have.map(id => name(id) + (s.good.includes(id.replace(/^-/, '')) ? ' (good roll)' : s.high.includes(id.replace(/^-/, '')) ? ' (rolled too high)' : '')).join(', ')
      : 'None of them');
    /** Traits a situation has: each stat, its roll note, and "a parent rolled well". @param {typeof steps[number]} s */
    const traits = s => new Set([...s.have, ...s.have.flatMap(id => {
      const bare = id.replace(/^-/, '');
      return s.good.includes(bare) ? [`${id}:good`] : s.high.includes(bare) ? [`${id}:high`] : [];
    }), ...(s.good.length ? ['anygood'] : [])]);
    const traitText = (/** @type {string} */ t) => (t === 'anygood' ? 'a good roll on a parent'
      : t.endsWith(':good') ? `${name(t.slice(0, -5))} (good roll)` : t.endsWith(':high') ? `${name(t.slice(0, -5))} (rolled too high)` : name(t));
    const moveOf = (/** @type {typeof steps[number]} */ s) => actionText(s.action, parents, s.have, s.stage === 'post' && !!state.spliced);
    const all = [...new Set(steps.flatMap(s => [...traits(s)]))];
    /** @type {string[][]} */
    const conditions = [[]];
    for (let i = 0; i < all.length; i++) {
      conditions.push([all[i]]);
      for (let j = i + 1; j < all.length; j++) {
        conditions.push([all[i], all[j]]);
        for (let k = j + 1; k < all.length; k++) conditions.push([all[i], all[j], all[k]]);
      }
    }
    // Skip "X and X (good roll)": the second says it all.
    const base = (/** @type {string} */ t) => t.replace(/:(good|high)$/, '');
    // ("A good roll on a parent" only alongside a stat, or it reads as a riddle.)
    const usable = conditions.filter(c => new Set(c.map(base)).size === c.length && !(c.length === 1 && c[0] === 'anygood'));
    const fits = (/** @type {string[] | null} */ c, /** @type {typeof steps[number]} */ s) => c !== null && c.every(x => traits(s).has(x));
    let left = [...steps];
    /** @type {{label: string, c: string[] | null, covered: typeof steps}[]} */
    const rules = [];
    while (left.length) {
      let best = null;
      for (const c of usable) {
        const hit = left.filter(s => { const t = traits(s); return c.every(x => t.has(x)); });
        if (!hit.length || hit.some(s => moveOf(s) !== moveOf(hit[0]))) continue;
        if (!best || hit.length > best.hit.length || (hit.length === best.hit.length && c.length < best.c.length)) best = { c, hit };
      }
      // No short rule fits: the situation on its own.
      if (!best) best = { c: null, hit: [left[0]] };
      const label = best.c === null ? situation(left[0])
        : best.c.length === 0 ? (rules.length ? 'Anything else' : 'Any of them')
          : `Has ${best.c.map(traitText).join(' and ')}`;
      rules.push({ label, c: best.c, covered: best.hit });
      left = left.filter(s => !best.hit.includes(s));
    }
    // Drop a row when the rows after it would give every situation it covers the same move.
    for (let i = rules.length - 2; i >= 0; i--) {
      const later = rules.slice(i + 1);
      const moves = rules[i].covered.map(s => later.find(r => fits(r.c, s)));
      if (moves.every(r => r && moveOf(r.covered[0]) === moveOf(rules[i].covered[0]))) {
        rules[i].covered.forEach((s, j) => /** @type {any} */ (moves[j]).covered.push(s));
        rules.splice(i, 1);
      }
    }
    const span = (/** @type {number[]} */ xs, /** @type {(n: number) => string} */ f) => {
      const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
      return f(lo) === f(hi) ? f(lo) : `${f(lo).replace(/ \D+$/, '')}–${f(hi)}`;
    };
    const rows = rules.map(({ label, covered }) => el('tr', mine && covered.includes(mine) ? { class: 'best' } : {}, [
      el('th', { scope: 'row' }, [el('div', {}, [label]),
        ...(mine && covered.includes(mine) && covered.length > 1 ? [el('div', { class: 'sub mine' }, [`Yours: ${situation(mine)}`])] : [])]),
      el('td', {}, [moveOf(covered[0])]),
      el('td', {}, [`${span(covered.map(s => s.kuva), kuva)} · ${span(covered.map(s => s.cycles), cyc)}`]),
    ]));
    return [
      el('h3', { class: 'plan-stage' }, [title]),
      el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals plan' }, [
        el('thead', {}, [el('tr', {}, ['If the riven has (first row that fits)', 'Do this', 'Expected to finish'].map(h => el('th', { scope: 'col' }, [h])))]),
        el('tbody', {}, rows)])]),
    ];
  };
  const goals = valueGoals();
  const goalList = [...want.map(id => (goals[id] ? `${name(id)} ${OP_TEXT[goals[id].op]} ${goals[id].value}` : name(id))),
    ...(state.negative ? [name(`-${state.negative}`) + (ng ? ` ${OP_TEXT[ng.op]} ${ng.value}` : '')] : [])].join(', ');
  if (state.spliced) {
    const curseOk = SHAPES[T].negatives > 0 && parents.some(id => pools(state.cls, ipsOf(state.weapon)).negative.includes(id));
    // The spliced stat keeps the better parent roll: with a goal, say what the parents need.
    const win = splicedRollWindow({ cls: state.cls, positives: [], spliced: state.spliced, negative: null, shape: T, goals });
    const g = goals[state.spliced];
    // In the parents' own numbers on this shape ("Attack Speed +9.7% or Range +1.2 m"), the
    // roll after it.
    const at = (/** @type {number} */ u, join = ' or ') => parents.map(id => format(STAT_BY_ID[id], displayValue(STAT_BY_ID[id], state.cls, T, '+', u)) + ` ${name(id)}`).join(join);
    /** Each parent's values for a roll window: "+67.7% to +67.8% Attack Speed", or one number when they round the same. @param {number} lo @param {number} hi */
    const between = (lo, hi) => parents.map(id => {
      const [x, y] = [lo, hi].map(u => format(STAT_BY_ID[id], displayValue(STAT_BY_ID[id], state.cls, T, '+', u)));
      return `${x === y ? x : `${x} to ${y}`} ${name(id)}`;
    }).join(' or ');
    const needText = win === null ? ''
      : `, with ${g.op === 'gte' ? `one of them at least ${at(win.lo)} (roll ${rollText(win.lo)})`
        : g.op === 'lte' ? `both at most ${at(win.hi, ' and ')} (roll ${rollText(win.hi)})`
          : `one of them at ${between(win.lo, win.hi)} (roll ${rollText(win.lo)} to ${rollText(win.hi)}) and the other no higher`}`
        + ` (for ${name(state.spliced)} ${OP_TEXT[g.op]} ${g.value}; it keeps the better roll)`;
    out.push(...table('pre', `1. Get ${parents.map(name).join(' and ')}${curseOk ? ' (one of them can be the curse)' : ''}${needText} on a ${T} riven, then splice ${name(state.spliced)}`));
    out.push(...table('post', `2. With ${name(state.spliced)} in place, cycle for ${goalList}`));
  } else {
    out.push(...table('post', `Cycle for ${goalList} on a ${T} riven`));
  }
  out.push(el('p', { class: 'note' }, [
    `Rows are for a ${T} riven; on any other shape, cycle unlocked until it changes. `
    + 'Costs assume the riven is past its 10th cycle (3,500 Kuva, 7,000 with a lock). Odds use the community model: '
    + 'each shape equally likely when unlocked, stats drawn evenly with no repeats. Values are at rank 8, with every roll equally likely.']));
  return el('div', {}, out);
}

/** @type {HTMLElement} */
let root;
/** @type {HTMLElement} */
let resultsBox;

function renderResults() {
  resultsBox.replaceChildren(results());
  saveState('p', {
    weapon: state.weapon, cls: state.cls, spliced: state.spliced, recipe: state.recipe,
    want: state.want.filter(Boolean).join(','), neg: state.negative, shape: state.shape,
    min: state.want.map((id, i) => (id && state.mins[i] ? `${id}:${state.ops[i]}:${state.mins[i]}` : '')).filter(Boolean).join(','),
    smin: state.spliced && state.splicedMin ? `${state.splicedOp}:${state.splicedMin}` : '',
    nmin: state.negative && state.negMin ? `${state.negOp}:${state.negMin}` : '',
    ...(state.from === 'mine' ? {
      from: 'mine', mp: state.myPos.filter(Boolean).join(','), mn: state.myNeg,
      ml: state.myLocks.join(','),
      mv: state.myPos.map((id, i) => (id && state.myVals[i] ? `${id}:${state.myVals[i]}` : '')).filter(Boolean).join(','),
      mnv: state.myNeg ? state.myNegVal : '',
    } : {}),
  });
}

function render() {
  resultsBox = el('div', { 'aria-live': 'polite' });
  root.replaceChildren(controls(), resultsBox, copyLinkButton('p'));
  renderResults();
}

/** "lte:30" → {op, value}; a bare "30" (older links) is "at least". @param {string} v */
const opValue = v => {
  const [op, value] = v.includes(':') ? v.split(':') : ['gte', v];
  return { op: /** @type {Op} */ (OPS.includes(/** @type {Op} */ (op)) ? op : 'gte'), value };
};

function restore() {
  const raw = loadState('p');
  if (!Object.keys(raw).length) return;
  const saved = pick(raw, {
    weapon: v => WEAPONS.find(w => w[0] === v)?.[0],
    cls: oneOf(CLASSES),
    spliced: v => (v === '' || STAT_BY_ID[v]?.spliced ? v : undefined),
    recipe: v => v,
    want: v => v.split(',').filter(id => STAT_BY_ID[id]).slice(0, 3),
    neg: v => (v === '' || STAT_BY_ID[v] ? v : undefined),
    shape: oneOf(/** @type {(Shape | 'any')[]} */ ([...SHAPE_ORDER, 'any'])),
    from: oneOf(/** @type {const} */ (['fresh', 'mine'])),
    mp: v => v.split(',').filter(id => STAT_BY_ID[id]).slice(0, 3),
    min: v => Object.fromEntries(v.split(',').map(p => {
      const [id, ...rest] = p.split(':');
      const [op, value] = rest.length > 1 ? rest : ['gte', rest[0]];   // old links: "id:value"
      return [id, { op: ['gte', 'lte', 'eq'].includes(op) ? op : 'gte', value }];
    })),
    mv: v => Object.fromEntries(v.split(',').map(p => p.split(':'))),
    smin: opValue,
    nmin: opValue,
    mnv: v => v,
    mn: v => (v === '' || STAT_BY_ID[v] ? v : undefined),
    ml: v => v.split(',').filter(id => STAT_BY_ID[id]),
  });
  if (saved.weapon !== undefined) {
    state.weapon = saved.weapon;
    state.cls = /** @type {WeaponClass} */ (WEAPONS.find(w => w[0] === saved.weapon)?.[1]);
  } else if (saved.cls) { state.weapon = ''; state.cls = saved.cls; }
  if (saved.spliced !== undefined) state.spliced = saved.spliced;
  if (saved.recipe !== undefined) state.recipe = saved.recipe;
  if (saved.want) state.want = [...saved.want, NONE, NONE, NONE].slice(0, 3);
  if (saved.neg !== undefined) state.negative = saved.neg;
  if (saved.shape) state.shape = saved.shape;
  state.from = saved.from ?? 'fresh';
  if (saved.mp) state.myPos = [...saved.mp, NONE, NONE, NONE].slice(0, 3);
  if (saved.mn !== undefined) state.myNeg = saved.mn;
  if (saved.ml) state.myLocks = saved.ml;
  if (saved.min) {
    state.mins = state.want.map(id => saved.min[id]?.value ?? '');
    state.ops = state.want.map(id => saved.min[id]?.op ?? 'gte');
  }
  if (saved.mv) state.myVals = state.myPos.map(id => saved.mv[id] ?? '');
  if (saved.smin) { state.splicedOp = saved.smin.op; state.splicedMin = saved.smin.value; }
  if (saved.nmin) { state.negOp = saved.nmin.op; state.negMin = saved.nmin.value; }
  if (saved.mnv !== undefined) state.myNegVal = saved.mnv;
}

/** @param {HTMLElement} container */
export function mountPlanner(container) {
  root = container;
  restore();
  render();
}

/**
 * Starts the plan from a riven the user has (from the grader): its weapon and stats. The target
 * itself is kept.
 * @param {{weapon: string, cls: WeaponClass, positives: string[], values?: string[], negative: string | null, negValue?: string, shape: Shape, locked?: string[]}} riven
 */
export function loadIntoPlanner(riven) {
  if (riven.weapon || riven.cls !== state.cls) { state.weapon = riven.weapon; state.cls = riven.cls; }
  Object.assign(state, {
    from: 'mine',
    myPos: [...riven.positives, NONE, NONE, NONE].slice(0, 3),
    myVals: [...(riven.values ?? []), '', '', ''].slice(0, 3),
    myNeg: riven.negative ?? NONE,
    myNegVal: riven.negValue ?? '',
    myLocks: riven.locked ?? [],
  });
  render();
  const details = /** @type {HTMLDetailsElement | null} */ (root.closest('details'));
  if (details) details.open = true;
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
