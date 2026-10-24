// @ts-check
// Build planner: pick the riven you want (positives, an optional spliced stat, a negative) and get
// the cheapest route to it: what to cycle for, what to lock at each point, when to splice, and
// the Kuva it's likely to cost.

import { CLASSES, SHAPES, SPLICED, STAT_BY_ID } from '../data/stats.js';
import { SHAPE_ORDER } from '../engine.js';
import { WEAPONS } from '../data/weapons.js';
import { pools } from '../cycle.js';
import { planBuild } from '../planner.js';
import { CLASS_LABEL, el, statName, segmented, select, weaponPicker, copyLinkButton, ipsOf } from './dom.js';
import { loadState, saveState, pick, oneOf } from './state.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */

const NONE = '';
const state = {
  weapon: 'Felarx',
  cls: /** @type {WeaponClass} */ ('shotgun'),
  spliced: 'viral',
  recipe: NONE,                         // "a+b", or '' for the cheapest
  want: ['cold', 'toxin', NONE],
  negative: 'critChance',
  shape: /** @type {Shape} */ ('+++-'),
  from: /** @type {'fresh' | 'mine'} */ ('fresh'),
  stage: /** @type {'pre' | 'post'} */ ('pre'),
  have: /** @type {string[]} */ ([]),
  myShape: /** @type {Shape} */ ('+++-'),
};

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
  if (!shapes.includes(state.shape)) state.shape = shapes[0] ?? '+++-';

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
      ...(recipes.length > 1 ? [select('From', recipeOptions, state.recipe, v => set({ recipe: v }))] : []),
      ...state.want.map((id, i) => select(`Positive ${i + 1}`, posOptions, id, v => {
        const want = [...state.want];
        want[i] = v;
        set({ want });
      })),
    ]),
    el('div', { class: 'controls' }, [
      select('Negative', negOptions, state.negative, v => set({ negative: v })),
      select('Shape', (shapes.length ? shapes : SHAPE_ORDER).map(s => /** @type {[string, string]} */ ([s, s])), state.shape,
        v => set({ shape: /** @type {Shape} */ (v), myShape: /** @type {Shape} */ (v) })),
    ]),
    el('div', { class: 'controls' }, [
      segmented('Start from', ['fresh', 'mine'], state.from, v => set({ from: /** @type {any} */ (v) }),
        v => (v === 'fresh' ? 'A fresh riven' : 'The riven I have')),
    ]),
  ];

  if (state.from === 'mine') {
    // What the riven has now, among the traits that matter.
    const parents = state.recipe ? state.recipe.split('+') : recipes[0] ?? [];
    const tracked = state.stage === 'pre' && state.spliced
      ? [...new Set([...parents, ...state.want.filter(Boolean)])]
      : state.want.filter(Boolean);
    const opts = [...tracked, ...(state.negative ? [`-${state.negative}`] : [])];
    state.have = state.have.filter(id => opts.includes(id));
    rows.push(el('div', { class: 'controls' }, [
      ...(state.spliced ? [segmented('Stage', ['pre', 'post'], state.stage, v => set({ stage: /** @type {any} */ (v), have: [] }),
        v => (v === 'pre' ? 'Not spliced yet' : `Already has ${name(state.spliced)}`))] : []),
      select('Its shape', SHAPE_ORDER.map(s => /** @type {[string, string]} */ ([s, s])), state.myShape, v => set({ myShape: /** @type {Shape} */ (v) })),
    ]));
    rows.push(el('div', { class: 'checks' }, [el('span', { class: 'field' }, ['It has:']), ...opts.map(id => {
      const box = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', ...(state.have.includes(id) ? { checked: '' } : {}) }));
      box.addEventListener('change', () => set({ have: box.checked ? [...state.have, id] : state.have.filter(x => x !== id) }));
      return el('label', { class: 'check' }, [box, name(id)]);
    })]));
  }
  return el('div', {}, rows);
}

/** @param {string} action */
function actionText(action, parents) {
  if (action === 'cycle') return 'Cycle, nothing locked';
  if (action === 'splice') return `Splice ${parents.map(name).join(' + ')} → ${name(state.spliced)}`;
  return `Lock ${name(action)} and cycle`;
}

function results() {
  const want = state.want.filter(Boolean);
  const problems = [];
  if (new Set(want).size !== want.length) problems.push('The same positive is picked twice.');
  if (!want.length && !state.spliced) problems.push('Pick at least one stat you want.');
  if (!validShapes().length) problems.push('No riven shape can hold all of that.');
  if (problems.length) return el('div', {}, problems.map(p => el('p', { class: 'note warn' }, [p])));

  let plan;
  try {
    plan = planBuild({
      cls: state.cls, ipsCode: ipsOf(state.weapon), positives: want, spliced: state.spliced || null,
      parents: state.recipe ? state.recipe.split('+') : undefined, negative: state.negative || null, shape: state.shape,
    }, state.from === 'mine' ? { stage: state.spliced ? state.stage : 'post', have: state.have, shape: state.myShape } : null);
  } catch (e) {
    return el('p', { class: 'note warn' }, [e instanceof Error ? e.message : String(e)]);
  }

  const parents = plan.parents ?? [];
  const mine = state.from === 'mine'
    ? plan.steps.find(s => s.stage === (state.spliced ? state.stage : 'post') && s.shape === state.myShape
      && [...s.have].sort().join() === [...state.have].sort().join())
    : null;
  const out = [
    el('p', { class: 'summary' }, [
      `${state.from === 'mine' ? 'From your riven' : 'From a fresh riven'}: about ${kuva(plan.expectedKuva)} (${cyc(plan.expectedCycles)}) on average.`]),
    el('p', { class: 'note' }, [
      `Half of runs finish within ${cyc(plan.median.cycles)} (about ${kuva(plan.median.kuva)}); `
      + `9 in 10 within ${cyc(plan.likely.cycles)} (about ${kuva(plan.likely.kuva)}).`
      + (plan.alternatives.length ? ` Splicing from ${plan.alternatives.map(a => `${a.parents.map(name).join(' + ')} would average ${kuva(a.kuva)}`).join('; ')}.` : '')]),
  ];
  if (state.from === 'mine') {
    out.push(el('p', { class: 'note next' }, [mine
      ? `Your next move: ${actionText(mine.action, parents)}.`
      : `Your riven isn't the ${state.shape} shape the target needs${state.spliced && state.stage === 'post' ? ', and a spliced riven\'s shape can\'t change' : ''}: cycle it unlocked until it is.`]));
  }

  /** @param {'pre' | 'post'} stage @param {string} title */
  const table = (stage, title) => {
    const steps = plan.steps.filter(s => s.stage === stage);
    if (!steps.length) return [];
    const rows = steps.map(s => el('tr', mine === s ? { class: 'best' } : {}, [
      el('th', { scope: 'row' }, [s.have.length ? s.have.map(name).join(', ') : 'None of them']),
      el('td', {}, [actionText(s.action, parents)]),
      el('td', {}, [`${kuva(s.kuva)} · ${cyc(s.cycles)}`]),
    ]));
    return [
      el('h3', { class: 'plan-stage' }, [title]),
      el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals plan' }, [
        el('thead', {}, [el('tr', {}, ['If the riven has', 'Do this', 'Expected to finish'].map(h => el('th', { scope: 'col' }, [h])))]),
        el('tbody', {}, rows)])]),
    ];
  };
  const goalList = [...want.map(name), ...(state.negative ? [name(`-${state.negative}`)] : [])].join(', ');
  if (state.spliced) {
    out.push(...table('pre', `1. Get ${parents.map(name).join(' and ')} on a ${state.shape} riven, then splice ${name(state.spliced)}`));
    out.push(...table('post', `2. With ${name(state.spliced)} in place, cycle for ${goalList}`));
  } else {
    out.push(...table('post', `Cycle for ${goalList} on a ${state.shape} riven`));
  }
  out.push(el('p', { class: 'note' }, [
    `Rows are for a ${state.shape} riven; on any other shape, cycle unlocked until it changes. `
    + 'Costs assume the riven is past its 10th cycle (3,500 Kuva, 7,000 with a lock). Odds use the community model: '
    + 'each shape equally likely when unlocked, stats drawn evenly with no repeats. Roll quality isn\'t included.']));
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
    ...(state.from === 'mine' ? { from: 'mine', stage: state.stage, have: state.have.join(','), my: state.myShape } : {}),
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
    shape: oneOf(SHAPE_ORDER),
    from: oneOf(/** @type {const} */ (['fresh', 'mine'])),
    stage: oneOf(/** @type {const} */ (['pre', 'post'])),
    have: v => v.split(',').filter(Boolean),
    my: oneOf(SHAPE_ORDER),
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
  if (saved.stage) state.stage = saved.stage;
  if (saved.have) state.have = saved.have;
  if (saved.my) state.myShape = saved.my;
}

/** @param {HTMLElement} container */
export function mountPlanner(container) {
  root = container;
  restore();
  render();
}
