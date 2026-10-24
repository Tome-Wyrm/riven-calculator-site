// @ts-check
// Build planner: pick the riven you want (positives, an optional spliced stat, a negative) and get
// the cheapest route to it: what to cycle for, what to lock at each point, when to splice, and
// the Kuva it's likely to cost.

import { CLASSES, SHAPES, SPLICED, STAT_BY_ID } from '../data/stats.js';
import { SHAPE_ORDER, range, solveU, rollScore } from '../engine.js';
import { WEAPONS } from '../data/weapons.js';
import { pools } from '../cycle.js';
import { planBuild, OP_TEXT, splicedRollNeeded } from '../planner.js';
import { CLASS_LABEL, el, statName, segmented, select, weaponPicker, copyLinkButton, ipsOf } from './dom.js';
import { loadState, saveState, pick, oneOf } from './state.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */

const NONE = '';
const state = {
  weapon: '',
  cls: /** @type {WeaponClass} */ ('rifle'),
  spliced: NONE,
  recipe: NONE,                         // "a+b", or '' for the cheapest
  want: [NONE, NONE, NONE],
  mins: ['', '', ''],                   // value wanted for each positive, '' = any
  ops: /** @type {('gte' | 'lte' | 'eq')[]} */ (['gte', 'gte', 'gte']),
  negative: NONE,
  shape: /** @type {Shape | 'any'} */ ('any'),   // the finished riven's shape; 'any' = the cheapest
  from: /** @type {'fresh' | 'mine'} */ ('fresh'),
  // The riven you have now: its positives (spliced ones included) and its negative.
  myPos: [NONE, NONE, NONE],
  myNeg: NONE,
  myVals: ['', '', ''],                 // its positives' values, '' = not given
  myNegVal: '',                         // its curse's value (asked when the curse is a splice parent)
  splicedMin: '',                       // least value wanted for the spliced stat, '' = any
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
  if (state.spliced && sm !== null) out[state.spliced] = { op: 'gte', value: sm };
  return out;
}

/** The splice parents that matter for the spliced stat's goal: every recipe's, or the chosen one's. */
function goalParents() {
  if (!state.spliced || !valueGoals()[state.spliced]) return [];
  const recipes = state.recipe ? [state.recipe.split('+')] : /** @type {string[][]} */ (STAT_BY_ID[state.spliced].from);
  return [...new Set(recipes.flat())];
}

/**
 * Your riven's parents whose roll is good enough for the spliced stat's goal (the spliced stat
 * keeps the better parent roll). A parent with no value given counts as good.
 * @param {Shape} shape
 */
function goodParents(shape) {
  const need = splicedRollNeeded({ cls: state.cls, positives: [], spliced: state.spliced || null, negative: null, shape: T, goals: valueGoals() });
  if (need === null) return undefined;
  const rollOf = (/** @type {string} */ id, /** @type {'+' | '-'} */ sign, /** @type {string} */ v) => {
    const m = magnitude(v);
    if (m === null) return 1;
    const r = range(STAT_BY_ID[id], state.cls, shape, sign);
    return solveU(STAT_BY_ID[id], state.cls, shape, sign, Math.sign(r.at1) * m);
  };
  return goalParents().filter(id => {
    const i = state.myPos.indexOf(id);
    if (i >= 0) return rollOf(id, '+', state.myVals[i]) >= need;
    return id === state.myNeg && rollOf(id, '-', state.myNegVal) >= need;
  });
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
 * @param {string} action @param {string[]} parents
 */
function nextMove(action, parents) {
  if (action === 'splice') return actionText(action, parents, current().have);
  const want = action === 'cycle' ? null : action.startsWith('-') ? action.slice(1) : action;
  const unlock = state.myLocks.filter(id => id !== want);
  const keep = want !== null && state.myLocks.includes(want);
  const text = want === null ? 'cycle' : `${keep ? 'keep' : 'lock'} ${name(action)} ${keep ? 'locked ' : ''}and cycle`;
  return unlock.length ? `Unlock ${unlock.map(name).join(', ')}, ${text}` : text[0].toUpperCase() + text.slice(1) + (want === null ? ', nothing locked' : '');
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
 * @returns {{shape: Shape | null, stage: 'pre' | 'post', have: string[]}}
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
  return {
    shape,
    stage: state.spliced && pos.includes(state.spliced) ? 'post' : 'pre',
    have: [...good, ...(state.myNeg ? [`-${state.myNeg}`] : [])],
    goodParents: shape ? goodParents(shape) : undefined,
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
      ...(state.spliced ? [numberBox('Spliced value at least', state.splicedMin, 'any value', v => set({ splicedMin: v }), '≥')] : []),
      ...(recipes.length > 1 ? [select('From', recipeOptions, state.recipe, v => set({ recipe: v }))] : []),
    ]),
    ...state.want.map((id, i) => el('div', { class: 'controls' }, [
      select(`Positive ${i + 1}`, posOptions, id, v => {
        const want = [...state.want];
        want[i] = v;
        set({ want });
      }),
      ...(id ? [
        segmented(`Positive ${i + 1} value`, ['gte', 'lte', 'eq'], state.ops[i], v => {
          const ops = [...state.ops];
          ops[i] = /** @type {any} */ (v);
          set({ ops });
        }, v => OP_TEXT[/** @type {'gte' | 'lte' | 'eq'} */ (v)]),
        numberBox(`Positive ${i + 1} value`, state.mins[i], 'any value', v => {
          const mins = [...state.mins];
          mins[i] = v;
          set({ mins });
        }, ''),
      ] : []),
    ])),
    el('div', { class: 'controls' }, [
      select('Negative', negOptions, state.negative, v => set({ negative: v })),
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
      ...(state.myNeg && goalParents().includes(state.myNeg)
        ? [numberBox('value', state.myNegVal, 'good enough', v => set({ myNegVal: v }))] : []),
    ]));
    const now = splicesNow(positive);
    if (now.length) rows.push(el('p', { class: 'note next' }, [`It can splice now: ${now.join('; ')}.`]));
    // ...but for a spliced goal, only with a parent that rolled well enough.
    const cur = current();
    if (now.length && cur.shape && cur.goodParents && !cur.goodParents.length && state.spliced && now.some(t => t.endsWith(name(state.spliced)))) {
      rows.push(el('p', { class: 'note warn' }, [`Neither parent rolled well enough for ${name(state.spliced)} ≥ ${valueGoals()[state.spliced].value} yet (the spliced stat keeps the better parent roll).`]));
    }
  }
  return el('div', {}, rows);
}

/**
 * @param {string} action @param {string[]} parents
 * @param {string[]} [have] the riven's stats at that point ('-x' = x is its curse, which can be a parent)
 */
function actionText(action, parents, have = []) {
  if (action === 'cycle') return 'Cycle, nothing locked';
  if (action === 'splice') return `Splice ${parents.map(id => name(have.includes(`-${id}`) ? `-${id}` : id)).join(' + ')} → ${name(state.spliced)}`;
  return `Lock ${name(action)} and cycle`;
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
        goals: valueGoals(),
      }, mineNow && mineNow.shape
        ? { stage: state.spliced ? mineNow.stage : 'post', have: mineNow.have, shape: mineNow.shape, goodParents: mineNow.goodParents }
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
    const goodKey = (mineNow.goodParents ?? []).filter(id => mineNow.have.some(h => h === id || h === `-${id}`)).sort().join();
    mine = steps.find(s => [...s.have].sort().join() === key && (!plan.steps.some(x => x.good.length) || [...s.good].sort().join() === goodKey)) ?? null;
  }
  // Goals every roll meets ("≥ 1") aren't wrong, just pointless: say so, and plan anyway.
  const trivial = Object.entries(valueGoals()).flatMap(([id, g]) => {
    const r = range(STAT_BY_ID[id], state.cls, T, '+');
    const [lo, hi] = [Math.abs(r.at0), Math.abs(r.at1)].sort((a, b) => a - b).map(v => Math.round(v * 100) / 100);
    const always = g.op === 'gte' ? g.value <= lo : g.op === 'lte' ? g.value >= hi : false;
    return always ? [`${name(id)} ${OP_TEXT[g.op]} ${g.value} is met by every roll (it rolls ${lo} to ${hi} on a ${T} riven), so it doesn't change the plan.`] : [];
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
      ? `Your next move: ${nextMove(mine.action, parents)}.`
      : `Your riven isn't the ${T} shape the target needs${state.spliced && mineNow?.stage === 'post' ? ', and a spliced riven\'s shape can\'t change' : ''}: cycle it unlocked until it is.`
        + (state.shape !== 'any' && mineNow?.shape ? ` (Or set Shape to Any to also plan for its own ${mineNow.shape} shape.)` : '')]));
  }

  /** @param {'pre' | 'post'} stage @param {string} title */
  const table = (stage, title) => {
    const steps = plan.steps.filter(s => s.stage === stage);
    if (!steps.length) return [];
    const rows = steps.map(s => el('tr', mine === s ? { class: 'best' } : {}, [
      el('th', { scope: 'row' }, [s.have.length
        ? s.have.map(id => name(id) + (s.good.includes(id.replace(/^-/, '')) ? ' (good roll)' : '')).join(', ')
        : 'None of them']),
      el('td', {}, [actionText(s.action, parents, s.have)]),
      el('td', {}, [`${kuva(s.kuva)} · ${cyc(s.cycles)}`]),
    ]));
    return [
      el('h3', { class: 'plan-stage' }, [title]),
      el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals plan' }, [
        el('thead', {}, [el('tr', {}, ['If the riven has', 'Do this', 'Expected to finish'].map(h => el('th', { scope: 'col' }, [h])))]),
        el('tbody', {}, rows)])]),
    ];
  };
  const goals = valueGoals();
  const goalList = [...want.map(id => (goals[id] ? `${name(id)} ${OP_TEXT[goals[id].op]} ${goals[id].value}` : name(id))), ...(state.negative ? [name(`-${state.negative}`)] : [])].join(', ');
  if (state.spliced) {
    const curseOk = SHAPES[T].negatives > 0 && parents.some(id => pools(state.cls, ipsOf(state.weapon)).negative.includes(id));
    // The spliced stat keeps the better parent roll: with a goal, say what a parent needs.
    const need = splicedRollNeeded({ cls: state.cls, positives: [], spliced: state.spliced, negative: null, shape: T, goals });
    const needText = need === null ? ''
      : `, with one of them rolling at least ${rollText(need)} (for ${name(state.spliced)} ≥ ${goals[state.spliced].value}; it keeps the better roll)`;
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
    smin: state.spliced ? state.splicedMin : '',
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
    smin: v => v,
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
  if (saved.smin !== undefined) state.splicedMin = saved.smin;
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
