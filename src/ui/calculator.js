// @ts-check
// Goal calculator: "can a <class> riven roll <op> <target> <stat>, and how likely is it?"

import { CLASSES, MAX_RANK, ORDINARY, SPLICED, STAT_BY_ID } from '../data/stats.js';
import { SHAPE_ORDER, canRoll, displayValue, evaluateGoal, format, gradeRoll, inferSign, letterGrade, quirks, rollScore, weaponCanRoll } from '../engine.js';
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
  // The shape the Value and Roll boxes convert on (a roll shows a different value on each shape).
  shape: /** @type {import('../data/stats.js').Shape} */ ('++'),
};

/** The roll (u) a value is on the conversion shape, or null when no roll shows it. @param {import('../data/stats.js').Stat} stat @param {number} v */
function rollOf(stat, v) {
  const sign = inferSign(stat, state.cls, v);
  if (!canRoll(stat, state.cls, state.shape, sign)) return null;
  const g = gradeRoll(stat, state.cls, state.shape, sign, v, state.rank);
  return g.possible ? g.mid : null;
}

/** The value a roll on the ±10% scale shows on the conversion shape (as a buff, or as a curse
 * if the current target reads as one). @param {import('../data/stats.js').Stat} stat @param {number} score */
function valueOf(stat, score) {
  const u = Math.max(0, Math.min(1, score / 20 + 0.5));
  let sign = state.target === null ? '+' : inferSign(stat, state.cls, state.target);
  if (!canRoll(stat, state.cls, state.shape, sign)) sign = sign === '+' ? '-' : '+';
  if (!canRoll(stat, state.cls, state.shape, sign)) return null;
  const v = displayValue(stat, state.cls, state.shape, /** @type {'+' | '-'} */ (sign), u, state.rank);
  const step = stat.unit === 'mult' ? 100 : 10;
  return Math.round(v * step) / step;
}

const pct = (/** @type {number} */ x) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`;

/** A roll on the grader's ±10% scale (−10% worst, +10% best): "+6.9200%". @param {number} u */
const roll = u => { const x = rollScore(u); return `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(4)}%`; };

/** "Roll ≥ 74%" style description of the u-interval that meets the goal. @param {ShapeResult} r */
function rollNeeded(r) {
  if (!r.feasible || !r.uInterval) return '—';
  if (state.op === 'near') return roll(r.closestU ?? 0);
  const [a, b] = r.uInterval;
  if (a <= 0 && b >= 1) return 'Any';
  if (b >= 1) return `≥ ${roll(a)}`;
  if (a <= 0) return `≤ ${roll(b)}`;
  return `${roll(a)} to ${roll(b)}`;
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
      ? `Best: ${best.shape}, which can hit ${format(stat, state.target)} exactly with a ${roll(best.closestU ?? 0)} roll.`
      : `Nothing reaches ${format(stat, state.target)} exactly. Closest: ${best.shape} at ${format(stat, best.closest ?? 0)}.`;
  }
  const feasible = res.results.filter(r => r.feasible).map(r => r.shape);
  return `Best: ${best.shape} (${pct(best.probability)} of rolls). Possible on ${feasible.join(', ')}.`;
}

function controls() {
  const set = (/** @type {Partial<typeof state>} */ patch) => { Object.assign(state, patch); render(); };
  const stats = statOptions([...ORDINARY, ...SPLICED], state.cls, ipsOf(state.weapon), false);
  if (!stats.some(([id]) => id === state.statId)) state.statId = stats[0][0];
  const stat = STAT_BY_ID[state.statId];

  const input = /** @type {HTMLInputElement} */ (el('input', {
    type: 'number', step: 'any', inputmode: 'decimal', value: state.target === null ? '' : String(state.target), 'aria-label': 'Target value',
  }));
  // The same target as a roll on the ±10% scale: type in either box and the other fills in.
  const u0 = state.target === null ? null : rollOf(stat, state.target);
  const rollInput = /** @type {HTMLInputElement} */ (el('input', {
    type: 'number', step: 'any', inputmode: 'decimal', min: '-10', max: '10', 'aria-label': 'Target roll (±10%)',
    value: u0 === null ? '' : rollScore(u0).toFixed(2), placeholder: '−10 to +10',
  }));
  // Update results without re-rendering the controls, so the input keeps focus while typing.
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (input.value === '') { state.target = null; rollInput.value = ''; renderResults(); } else if (Number.isFinite(n)) {
      state.target = n;
      const u = rollOf(stat, n);
      rollInput.value = u === null ? '' : rollScore(u).toFixed(2);
      renderResults();
    }
  });
  rollInput.addEventListener('input', () => {
    const n = Number(rollInput.value);
    if (rollInput.value === '' || !Number.isFinite(n)) return;
    const v = valueOf(stat, n);
    if (v === null) return;
    state.target = v;
    input.value = String(v);
    renderResults();
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
    el('label', { class: 'field target', title: 'The same target as a roll: −10% is the worst roll, +10% the best' }, [el('span', {}, ['or roll']), rollInput, el('span', {}, ['%'])]),
    segmented('Roll on shape', SHAPE_ORDER, state.shape, v => set({ shape: /** @type {any} */ (v) })),
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
    el('td', {}, [targetGrade(stat, r.shape, res.sign)]),
  ]));
  const chanceHead = state.op === 'near' ? 'Chance (±1)' : 'Chance';
  const head = el('thead', {}, [el('tr', {}, ['Shape', 'Range', 'Meets goal', 'Roll needed (±10%)', chanceHead, `${format(stat, state.target)} grades as`]
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
    ...(stat.spliced && res.sign === '+' ? spliceTables(stat, res) : []),
  ]);
}

/** What the target value grades as on a shape: "+4.20% (A-)", or why it can't. @param {import('../data/stats.js').Stat} stat @param {import('../data/stats.js').Shape} shape @param {'+' | '-'} sign */
function targetGrade(stat, shape, sign) {
  if (!canRoll(stat, state.cls, shape, sign)) return '—';
  const g = gradeRoll(stat, state.cls, shape, sign, /** @type {number} */ (state.target), state.rank);
  if (!g.possible) return 'Out of range';
  const [a, b] = [rollScore(g.lo), rollScore(g.hi)];
  const [la, lb] = [letterGrade(a), letterGrade(b)];
  return `${roll(g.mid)} (${la === lb ? la : `${la} / ${lb}`})`;
}

/**
 * "Splice to this": the values each parent needs on each shape. The spliced stat keeps the better
 * of its parents' rolls, so it's the same roll window, shown in the parents' own numbers.
 * @param {import('../data/stats.js').Stat} stat @param {ReturnType<typeof evaluateGoal>} res
 */
function spliceTables(stat, res) {
  const cls = state.cls;
  const recipes = /** @type {string[][]} */ (stat.from ?? []).filter(r => r.every(id => STAT_BY_ID[id].b[cls] !== undefined));
  const rule = state.op === 'gte' ? 'One parent at least this (the better roll is kept):'
    : state.op === 'lte' ? 'Both parents at most this (the better roll is kept):'
      : 'One parent at this, the other no higher:';
  return recipes.flatMap(pair => {
    const parents = pair.map(id => STAT_BY_ID[id]);
    const rows = res.results.filter(r => r.possible && r.uInterval).map(r => {
      const show = (/** @type {import('../data/stats.js').Stat} */ p, /** @type {number} */ u) =>
        format(p, displayValue(p, cls, r.shape, '+', u, state.rank));
      const [a, b] = /** @type {[number, number]} */ (r.uInterval);
      const cell = (/** @type {import('../data/stats.js').Stat} */ p) => {
        if (state.op === 'near' ? (r.delta ?? 1) >= 0.05 : !r.feasible) return el('td', { class: 'na' }, ['—']);
        if (state.op === 'near') return el('td', {}, [show(p, r.closestU ?? 0)]);
        if (state.op === 'gte') return el('td', {}, [a <= 0 ? 'Any' : `≥ ${show(p, a)}`]);
        return el('td', {}, [b >= 1 ? 'Any' : `≤ ${show(p, b)}`]);
      };
      return el('tr', {}, [el('th', { scope: 'row' }, [r.shape]), ...parents.map(cell)]);
    });
    return [
      el('h3', { class: 'plan-stage' }, [`Splice from ${parents.map(p => statName(p, cls)).join(' + ')}`]),
      el('p', { class: 'note' }, [rule]),
      el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals compact' }, [
        el('thead', {}, [el('tr', {}, ['Shape', ...parents.map(p => statName(p, cls))].map(h => el('th', { scope: 'col' }, [h])))]),
        el('tbody', {}, rows)])]),
    ];
  });
}

/** @type {HTMLElement} */
let root;
/** @type {HTMLElement} */
let resultsBox;

function renderResults() {
  resultsBox.replaceChildren(results());
  saveState('g', { weapon: state.weapon, cls: state.cls, stat: state.statId, op: state.op, t: state.target ?? '', rank: state.rank, ...(state.shape !== '++' ? { sh: state.shape } : {}) });
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
    sh: oneOf(SHAPE_ORDER),
  });
  if (saved.weapon !== undefined) {
    state.weapon = saved.weapon;
    state.cls = /** @type {WeaponClass} */ (WEAPONS.find(w => w[0] === saved.weapon)?.[1]);
  } else if (saved.cls) {
    state.weapon = '';
    state.cls = saved.cls;
  }
  if (saved.sh) state.shape = saved.sh;
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
