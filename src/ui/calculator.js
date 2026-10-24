// @ts-check
// Goal calculator: "can a <class> riven roll <op> <target> <stat>, and how likely is it?"

import { CLASSES, MAX_RANK, ORDINARY, SPLICED, STAT_BY_ID } from '../data/stats.js';
import { evaluateGoal, format, quirks, weaponCanRoll } from '../engine.js';
import { WEAPONS } from '../data/weapons.js';
import { CLASS_LABEL, el, statName, segmented, select, statOptions, weaponPicker, copyLinkButton, ipsOf, isBow, recipeText } from './dom.js';
import { loadState, saveState, pick, oneOf, num } from './state.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../engine.js').Goal} Goal */
/** @typedef {import('../engine.js').ShapeResult} ShapeResult */

const OP_LABEL = { gte: 'At least', lte: 'At most', near: 'Closest to' };
const UNIT_SUFFIX = { pct: '%', pctNeg: '%', mult: '×', sec: 's', m: 'm', flat: '' };

const state = {
  weapon: '',
  cls: /** @type {WeaponClass} */ ('rifle'),
  statId: '',
  op: /** @type {Goal['op']} */ ('gte'),
  target: /** @type {number | null} */ (null),
  rank: MAX_RANK,
};

const pct = (/** @type {number} */ x) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`;

/** "Roll ≥ 74%" style description of the u-interval that meets the goal. @param {ShapeResult} r */
function rollNeeded(r) {
  if (!r.feasible || !r.uInterval) return '—';
  if (state.op === 'near') return `≈ ${pct(r.closestU ?? 0)}`;
  const [a, b] = r.uInterval;
  if (a <= 0 && b >= 1) return 'Any';
  if (b >= 1) return `≥ ${pct(a)}`;
  if (a <= 0) return `≤ ${pct(b)}`;
  return `${pct(a)} – ${pct(b)}`;
}

/** @param {ShapeResult} r @param {import('../data/stats.js').Stat} stat */
function resultCell(r, stat) {
  if (!r.possible) return el('td', { class: 'na' }, ["Can't roll"]);
  if (state.op === 'near') {
    const hit = (r.delta ?? Infinity) < 0.05;
    return el('td', { class: hit ? 'ok' : 'miss' },
      [hit ? 'Exact' : `${format(stat, r.closest ?? 0)} (off by ${(r.delta ?? 0).toFixed(stat.unit === 'mult' ? 2 : 1)})`]);
  }
  return el('td', { class: r.feasible ? 'ok' : 'miss' }, [r.feasible ? 'Yes' : 'No']);
}

/** @param {ReturnType<typeof evaluateGoal>} res @param {import('../data/stats.js').Stat} stat */
function summary(res, stat) {
  const best = res.results.find(r => r.best);
  const name = statName(stat, state.cls);
  if (!best) return `${CLASS_LABEL[state.cls]} rivens can't roll that ${name} goal on any shape.`;
  if (state.op === 'near') {
    return (best.delta ?? 0) < 0.05
      ? `Best: ${best.shape}, which can hit ${format(stat, state.target)} exactly with a ${pct(best.closestU ?? 0)} roll.`
      : `Nothing reaches ${format(stat, state.target)} exactly. Closest: ${best.shape} at ${format(stat, best.closest ?? 0)}.`;
  }
  const feasible = res.results.filter(r => r.feasible).map(r => r.shape);
  return `Best: ${best.shape} (${pct(best.probability)} of rolls). Possible on ${feasible.join(', ')}.`;
}

function controls() {
  const set = (/** @type {Partial<typeof state>} */ patch) => { Object.assign(state, patch); render(); };
  const stats = statOptions([...ORDINARY, ...SPLICED], state.cls, ipsOf(state.weapon));
  if (!stats.some(([id]) => id === state.statId)) state.statId = stats[0][0];
  const stat = STAT_BY_ID[state.statId];

  const input = /** @type {HTMLInputElement} */ (el('input', {
    type: 'number', step: 'any', inputmode: 'decimal', value: state.target === null ? '' : String(state.target), 'aria-label': 'Target value',
  }));
  // Update results without re-rendering the controls, so the input keeps focus while typing.
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (input.value === '') { state.target = null; renderResults(); } else if (Number.isFinite(n)) { state.target = n; renderResults(); }
  });
  const ranks = Array.from({ length: MAX_RANK + 1 }, (_, r) => /** @type {[string, string]} */ ([String(r), String(r)]));

  return el('div', { class: 'controls' }, [
    weaponPicker(WEAPONS, state.weapon, (weapon, cls) => set({ weapon, cls })),
    segmented('Weapon class', CLASSES, state.cls, v => set({ cls: /** @type {WeaponClass} */ (v), weapon: '' }),
      v => CLASS_LABEL[/** @type {WeaponClass} */ (v)]),
    select('Stat', stats, state.statId, v => set({ statId: v })),
    segmented('Comparison', ['gte', 'lte', 'near'], state.op, v => set({ op: /** @type {Goal['op']} */ (v) }),
      v => OP_LABEL[/** @type {Goal['op']} */ (v)]),
    el('label', { class: 'field target' }, [input, el('span', {}, [UNIT_SUFFIX[stat.unit]])]),
    select('Rank', ranks, String(state.rank), v => set({ rank: Number(v) })),
  ]);
}

function results() {
  if (state.target === null) return el('p', { class: 'note' }, ['Enter a target value.']);
  const stat = STAT_BY_ID[state.statId];
  const res = evaluateGoal({ stat, cls: state.cls, op: state.op, target: state.target, rank: state.rank });
  const rows = res.results.map(r => el('tr', r.best ? { class: 'best' } : {}, [
    el('th', { scope: 'row' }, [r.shape + (r.best ? ' ★' : '')]),
    el('td', {}, [r.range ? `${format(stat, r.range.at0)} to ${format(stat, r.range.at1)}` : '—']),
    resultCell(r, stat),
    el('td', {}, [rollNeeded(r)]),
    el('td', {}, [r.possible ? pct(r.probability) : '—']),
  ]));
  const chanceHead = state.op === 'near' ? 'Chance (±1)' : 'Chance';
  const head = el('thead', {}, [el('tr', {}, ['Shape', 'Range', 'Meets goal', 'Roll needed', chanceHead]
    .map(h => el('th', { scope: 'col' }, [h])))]);

  const notes = [el('p', { class: 'summary' }, [summary(res, stat)])];
  if (stat.spliced) {
    notes.push(el('p', { class: 'note' }, [
      `Spliced from ${recipeText(stat, state.cls, STAT_BY_ID)}. It keeps the better roll of its two parents, so the chances assume max-of-two rolls.`]));
  }
  if (weaponCanRoll(stat, ipsOf(state.weapon)) === '?') {
    notes.push(el('p', { class: 'note' }, [
      `${state.weapon} may not be able to roll ${statName(stat, state.cls)}: its damage data is unclear for this type.`]));
  }
  for (const q of quirks(stat, state.cls, isBow(state.weapon))) {
    notes.push(el('p', { class: 'note' }, [
      `${q.label}: this stat counts ×${q.factor}, so ${format(stat, state.target)} on the riven acts as ${format(stat, state.target * q.factor)}.`]));
  }
  if (res.sign === '-') {
    notes.push(el('p', { class: 'note' }, ['That target reads as a negative (curse) roll.']));
  }
  return el('div', {}, [
    ...notes,
    el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals' }, [head, el('tbody', {}, rows)])]),
  ]);
}

/** @type {HTMLElement} */
let root;
/** @type {HTMLElement} */
let resultsBox;

function renderResults() {
  resultsBox.replaceChildren(results());
  saveState('g', { weapon: state.weapon, cls: state.cls, stat: state.statId, op: state.op, t: state.target ?? '', rank: state.rank });
}

function render() {
  resultsBox = el('div', { 'aria-live': 'polite' });
  root.replaceChildren(controls(), resultsBox, copyLinkButton('g'));
  renderResults();
}

/** Applies state from the URL hash; a known weapon overrides the class. */
function restore() {
  const saved = pick(loadState('g'), {
    weapon: v => WEAPONS.find(w => w[0] === v)?.[0],
    cls: oneOf(CLASSES),
    stat: v => (STAT_BY_ID[v] ? v : undefined),
    op: oneOf(/** @type {const} */ (['gte', 'lte', 'near'])),
    t: num(),
    rank: num(0, MAX_RANK),
  });
  if (saved.weapon !== undefined) {
    state.weapon = saved.weapon;
    state.cls = /** @type {WeaponClass} */ (WEAPONS.find(w => w[0] === saved.weapon)?.[1]);
  } else if (saved.cls) {
    state.weapon = '';
    state.cls = saved.cls;
  }
  if (saved.stat) state.statId = saved.stat;
  if (saved.op) state.op = saved.op;
  if (saved.t !== undefined) state.target = saved.t;
  if (saved.rank !== undefined) state.rank = Math.round(saved.rank);
}

/** @param {HTMLElement} container */
export function mountCalculator(container) {
  root = container;
  restore();
  render();
}
