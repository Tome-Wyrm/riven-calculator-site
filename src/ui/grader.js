// @ts-check
// Riven grader: enter a riven's stats as the game shows them → roll quality of each stat.

import { CLASSES, MAX_RANK, ORDINARY, SPLICED, STAT_BY_ID } from '../data/stats.js';
import { canRoll, format, gradeRoll, inferSign, range, shapeFor } from '../engine.js';
import { WEAPONS } from '../data/weapons.js';
import { CLASS_LABEL, el, statName, segmented, select, statOptions, weaponPicker, copyLinkButton, ipsOf } from './dom.js';
import { loadState, saveState, pick, oneOf, num } from './state.js';

/** @typedef {import('../data/stats.js').Stat} Stat */
/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */

const MAX_ROWS = 4;

const state = {
  weapon: 'Soma',
  cls: /** @type {WeaponClass} */ ('rifle'),
  rank: MAX_RANK,
  // The Soma riven from the verified screenshots, as a worked example.
  rows: [
    { statId: 'damage', value: '267.2' },
    { statId: 'electricity', value: '138.7' },
    { statId: 'ammoMax', value: '-31.7' },
  ],
};

/** @param {number} q quality 0..1, higher is better */
function gradeLabel(q) {
  if (q >= 0.9) return 'Excellent';
  if (q >= 0.7) return 'Good';
  if (q >= 0.4) return 'Average';
  return 'Low';
}

/** @param {number} q mildness 0..1, higher is a smaller penalty */
function curseLabel(q) {
  if (q >= 0.7) return 'Mild';
  if (q >= 0.4) return 'Average';
  return 'Harsh';
}

const pct =(/** @type {number} */ x) => `${(x * 100).toFixed(1)}%`;

function controls() {
  const set = (/** @type {Partial<typeof state>} */ patch) => { Object.assign(state, patch); render(); };
  const ranks = Array.from({ length: MAX_RANK + 1 }, (_, r) => /** @type {[string, string]} */ ([String(r), String(r)]));
  return el('div', { class: 'controls' }, [
    weaponPicker(WEAPONS, state.weapon, (weapon, cls) => set({ weapon, cls })),
    segmented('Weapon class', CLASSES, state.cls, v => set({ cls: /** @type {WeaponClass} */ (v), weapon: '' }),
      v => CLASS_LABEL[/** @type {WeaponClass} */ (v)]),
    select('Rank', ranks, String(state.rank), v => set({ rank: Number(v) })),
  ]);
}

function statRows() {
  const options = statOptions([...ORDINARY, ...SPLICED], state.cls, ipsOf(state.weapon));
  const rows = state.rows.map((row, i) => {
    if (!options.some(([id]) => id === row.statId)) row.statId = options[0][0];
    const input = /** @type {HTMLInputElement} */ (el('input', {
      type: 'text', inputmode: 'decimal', value: row.value, placeholder: 'e.g. +267.2', 'aria-label': `Stat ${i + 1} value`,
    }));
    // Results update as you type without rebuilding the inputs, so focus stays put.
    input.addEventListener('input', () => { row.value = input.value; renderResults(); });
    const remove = el('button', { type: 'button', class: 'icon-button', 'aria-label': `Remove stat ${i + 1}` }, ['×']);
    remove.addEventListener('click', () => { state.rows.splice(i, 1); render(); });
    return el('div', { class: 'grade-row' }, [
      select(`Stat ${i + 1}`, options, row.statId, v => { row.statId = v; render(); }),
      el('label', { class: 'field target' }, [input]),
      remove,
    ]);
  });
  const add = el('button', { type: 'button', class: 'copy-link' }, ['Add stat']);
  add.addEventListener('click', () => { state.rows.push({ statId: options[0][0], value: '' }); render(); });
  return el('div', { class: 'grade-rows' }, [...rows, ...(state.rows.length < MAX_ROWS ? [add] : [])]);
}

/** Parses "+267.2%", "-31.7", "x1.65", "10.8s" etc. to a number, or null. @param {string} s */
function parseShown(s) {
  const m = s.replace(/,/g, '.').match(/[+-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function results() {
  const { cls, rank } = state;
  const parsed = state.rows
    .map(r => ({ stat: STAT_BY_ID[r.statId], shown: parseShown(r.value) }))
    .filter(r => r.shown !== null)
    .map(r => ({ ...r, sign: inferSign(r.stat, cls, /** @type {number} */ (r.shown)) }));

  const problems = [];
  const ids = parsed.map(r => r.stat.id);
  if (new Set(ids).size !== ids.length) problems.push('The same stat is listed twice.');
  const positives = parsed.filter(r => r.sign === '+').length;
  const negatives = parsed.length - positives;
  const shape = shapeFor(positives, negatives);
  if (!shape && parsed.length) {
    problems.push(`${positives} positive and ${negatives} negative: a riven has 2 or 3 positives and at most 1 negative.`);
  }
  if (!shape || problems.length) {
    return el('div', {}, problems.length
      ? problems.map(p => el('p', { class: 'note warn' }, [p]))
      : [el('p', { class: 'note' }, ['Enter the values shown on the riven.'])]);
  }

  /** @type {number[]} */
  const qualities = [];
  const rows = parsed.map(({ stat, shown, sign }) => {
    const name = el('th', { scope: 'row' }, [statName(stat, cls)]);
    const shownCell = el('td', {}, [format(stat, /** @type {number} */ (shown))]);
    if (!canRoll(stat, cls, shape, sign)) {
      return el('tr', {}, [name, shownCell, el('td', { class: 'miss', colspan: '3' }, [`Can't be ${sign === '+' ? 'positive' : 'negative'} on a ${shape} riven`])]);
    }
    const r = range(stat, cls, shape, sign, rank);
    const g = gradeRoll(stat, cls, shape, sign, /** @type {number} */ (shown), rank);
    const rangeCell = el('td', {}, [`${format(stat, r.at0)} to ${format(stat, r.at1)}`]);
    if (!g.possible) {
      return el('tr', {}, [name, shownCell, rangeCell, el('td', { class: 'miss', colspan: '2' }, ['Outside the range: check the value or the rank'])]);
    }
    // For a negative, a higher roll is a bigger penalty, so quality runs the other way.
    const [qLo, qHi] = sign === '+' ? [g.lo, g.hi] : [1 - g.hi, 1 - g.lo];
    const q = (qLo + qHi) / 2;
    if (sign === '+') qualities.push(q);
    const qText = qHi - qLo < 0.005 ? pct(q) : `${pct(qLo)}–${pct(qHi)}`;
    return el('tr', {}, [name, shownCell, rangeCell,
      el('td', { class: sign === '+' ? 'pos' : 'neg' }, [qText]),
      el('td', {}, [sign === '+' ? gradeLabel(q) : curseLabel(q)])]);
  });

  const head = el('thead', {}, [el('tr', {}, ['Stat', 'Shown', `Range (${shape}, rank ${rank})`, 'Roll quality', 'Grade']
    .map(h => el('th', { scope: 'col' }, [h])))]);
  const avg = qualities.length ? qualities.reduce((a, b) => a + b, 0) / qualities.length : null;
  return el('div', {}, [
    el('p', { class: 'summary' }, [`Shape ${shape}` + (avg === null ? '' : ` · average positive roll ${pct(avg)} (${gradeLabel(avg)})`)]),
    el('p', { class: 'note' }, ['Roll quality: 0% is the worst possible roll, 100% the best. For the negative, 100% means the mildest penalty.']),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals' }, [head, el('tbody', {}, rows)])]),
  ]);
}

/** @type {HTMLElement} */
let root;
/** @type {HTMLElement} */
let resultsBox;

function renderResults() {
  resultsBox.replaceChildren(results());
  saveState('v', {
    weapon: state.weapon, cls: state.cls, rank: state.rank,
    rows: state.rows.map(r => `${r.statId}:${r.value}`).join(';'),
  });
}

function render() {
  resultsBox = el('div', { 'aria-live': 'polite' });
  root.replaceChildren(controls(), statRows(), resultsBox, copyLinkButton());
  renderResults();
}

/** Applies state from the URL hash; a known weapon overrides the class. */
function restore() {
  const saved = pick(loadState('v'), {
    weapon: v => WEAPONS.find(w => w[0] === v)?.[0],
    cls: oneOf(CLASSES),
    rank: num(0, MAX_RANK),
    rows: v => {
      const rows = v.split(';').slice(0, MAX_ROWS).map(p => {
        const [statId, value = ''] = p.split(':');
        return { statId, value };
      }).filter(r => STAT_BY_ID[r.statId]);
      return rows.length ? rows : undefined;
    },
  });
  if (saved.weapon !== undefined) {
    state.weapon = saved.weapon;
    state.cls = /** @type {WeaponClass} */ (WEAPONS.find(w => w[0] === saved.weapon)?.[1]);
  } else if (saved.cls) {
    state.weapon = '';
    state.cls = saved.cls;
  }
  if (saved.rank !== undefined) state.rank = Math.round(saved.rank);
  if (saved.rows) state.rows = saved.rows;
}

/** @param {HTMLElement} container */
export function mountGrader(container) {
  root = container;
  restore();
  render();
}
