// @ts-check
// Range viewer: the spreadsheet replacement. Two views over the engine:
//   table   — every stat for one class + shape (what the spreadsheet showed)
//   compare — one stat across all four shapes

import { CLASSES, MAX_RANK, ORDINARY, SPLICED, STAT_BY_ID } from '../data/stats.js';
import { SHAPE_ORDER, canRoll, range, format } from '../engine.js';

/** @typedef {import('../data/stats.js').Stat} Stat */
/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */
/** @typedef {import('../engine.js').Sign} Sign */

const CLASS_LABEL = { rifle: 'Rifle', shotgun: 'Shotgun', pistol: 'Pistol', archgun: 'Archgun', melee: 'Melee' };

const state = {
  view: /** @type {'table' | 'compare'} */ ('table'),
  cls: /** @type {WeaponClass} */ ('rifle'),
  shape: /** @type {Shape} */ ('++-'),
  rank: MAX_RANK,
  statId: 'critChance',
};

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node | string)[]} [kids] */
function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

/** @param {Stat} stat @param {WeaponClass} cls */
const statName = (stat, cls) => (cls === 'melee' && stat.meleeName) || stat.name;

/**
 * One range cell: "+120.3% to +147.0%", or a dash when that sign can't roll.
 * Faction stats also show the equivalent percent, like the spreadsheet's "like Roar" row.
 * @param {Stat} stat @param {WeaponClass} cls @param {Shape} shape @param {Sign} sign
 */
function rangeCell(stat, cls, shape, sign) {
  if (!canRoll(stat, cls, shape, sign)) return el('td', { class: 'na' }, ['—']);
  const r = range(stat, cls, shape, sign, state.rank);
  const kids = [`${format(stat, r.at0)} to ${format(stat, r.at1)}`];
  if (stat.unit === 'mult') {
    const pct = (/** @type {number} */ x) => `${x >= 1 ? '+' : '-'}${Math.abs((x - 1) * 100).toFixed(1)}%`;
    kids.push(el('span', { class: 'sub' }, [`${pct(r.at0)} to ${pct(r.at1)}`]));
  }
  return el('td', { class: sign === '+' ? 'pos' : 'neg' }, kids);
}

/** @param {string} name @param {string[]} options @param {string} value @param {(v: string) => void} onChange @param {(v: string) => string} [label] */
function segmented(name, options, value, onChange, label = v => v) {
  return el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    options.map(opt => {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(opt === value) }, [label(opt)]);
      b.addEventListener('click', () => onChange(opt));
      return b;
    }));
}

/** @param {string} labelText @param {[string, string][]} options @param {string} value @param {(v: string) => void} onChange */
function select(labelText, options, value, onChange) {
  const s = /** @type {HTMLSelectElement} */ (el('select', {},
    options.map(([v, text]) => el('option', v === value ? { value: v, selected: '' } : { value: v }, [text]))));
  s.addEventListener('change', () => onChange(s.value));
  return el('label', { class: 'field' }, [el('span', {}, [labelText]), s]);
}

function controls() {
  const set = (/** @type {Partial<typeof state>} */ patch) => { Object.assign(state, patch); render(); };
  const ranks = Array.from({ length: MAX_RANK + 1 }, (_, r) => /** @type {[string, string]} */ ([String(r), String(r)]));
  const items = [
    segmented('View', ['table', 'compare'], state.view, v => set({ view: /** @type {any} */ (v) }),
      v => (v === 'table' ? 'All stats' : 'Compare shapes')),
    segmented('Weapon class', CLASSES, state.cls, v => set({ cls: /** @type {WeaponClass} */ (v) }),
      v => CLASS_LABEL[/** @type {WeaponClass} */ (v)]),
  ];
  if (state.view === 'table') {
    items.push(segmented('Shape', SHAPE_ORDER, state.shape, v => set({ shape: /** @type {Shape} */ (v) })));
  } else {
    const opts = [...ORDINARY, ...SPLICED]
      .filter(s => s.b[state.cls] !== undefined)
      .map(s => /** @type {[string, string]} */ ([s.id, statName(s, state.cls) + (s.spliced ? ' (spliced)' : '')]));
    if (!opts.some(([id]) => id === state.statId)) state.statId = opts[0][0];
    items.push(select('Stat', opts, state.statId, v => set({ statId: v })));
  }
  items.push(select('Rank', ranks, String(state.rank), v => set({ rank: Number(v) })));
  return el('div', { class: 'controls' }, items);
}

/** @param {string} title @param {Stat[]} stats */
function section(title, stats) {
  const { cls, shape } = state;
  const rows = stats
    .filter(s => s.b[cls] !== undefined)
    .map(s => el('tr', {}, [el('th', { scope: 'row' }, [statName(s, cls)]), rangeCell(s, cls, shape, '+'), rangeCell(s, cls, shape, '-')]));
  if (rows.length === 0) return null;
  return el('tbody', {}, [el('tr', { class: 'group' }, [el('th', { colspan: '3', scope: 'colgroup' }, [title])]), ...rows]);
}

function tableView() {
  const isFaction = (/** @type {Stat} */ s) => s.unit === 'mult';
  const sections = [
    section('Stats', ORDINARY.filter(s => !isFaction(s))),
    section('Faction damage', ORDINARY.filter(isFaction)),
    section('Spliced (always positive)', SPLICED),
  ].filter(x => x !== null);
  const head = el('thead', {}, [el('tr', {}, [el('th', { scope: 'col' }, ['Stat']), el('th', { scope: 'col' }, ['Positive']), el('th', { scope: 'col' }, ['Negative'])])]);
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges' }, [head, ...sections])]);
}

function compareView() {
  const stat = STAT_BY_ID[state.statId];
  const rows = SHAPE_ORDER.map(shape =>
    el('tr', {}, [el('th', { scope: 'row' }, [shape]), rangeCell(stat, state.cls, shape, '+'), rangeCell(stat, state.cls, shape, '-')]));
  const head = el('thead', {}, [el('tr', {}, [el('th', { scope: 'col' }, ['Shape']), el('th', { scope: 'col' }, ['Positive']), el('th', { scope: 'col' }, ['Negative'])])]);
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges' }, [head, el('tbody', {}, rows)])]);
}

/** @type {HTMLElement} */
let root;

function render() {
  const body = state.view === 'table' ? tableView() : compareView();
  root.replaceChildren(controls(), body);
}

/** @param {HTMLElement} container */
export function mountRanges(container) {
  root = container;
  render();
}
