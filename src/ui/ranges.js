// @ts-check
// Range viewer: the spreadsheet replacement. Two views over the engine:
//   table   — every stat for one class + shape (what the spreadsheet showed)
//   compare — one stat across all four shapes

import { CLASSES, MAX_RANK, ORDINARY, SPLICED, STAT_BY_ID } from '../data/stats.js';
import { SHAPE_ORDER, canRoll, range, format, quirks, weaponCanRoll } from '../engine.js';
import { WEAPONS } from '../data/weapons.js';
import { CLASS_LABEL, el, statName, segmented, select, statOptions, weaponPicker, copyLinkButton, ipsOf, isBow, recipeText } from './dom.js';
import { loadState, saveState, pick, oneOf, num } from './state.js';

/** @typedef {import('../data/stats.js').Stat} Stat */
/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */
/** @typedef {import('../engine.js').Sign} Sign */

const state = {
  view: /** @type {'table' | 'compare'} */ ('table'),
  weapon: '',
  cls: /** @type {WeaponClass} */ ('rifle'),
  shape: /** @type {Shape} */ ('++-'),
  rank: MAX_RANK,
  statId: 'critChance',
};

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
  if (weaponCanRoll(stat, ipsOf(state.weapon)) === '?') {
    kids.push(el('span', { class: 'sub' }, [`May not roll on ${state.weapon}`]));
  }
  if (weaponCanRoll(stat, ipsOf(state.weapon)) === 'v') {
    kids.push(el('span', { class: 'sub vintage' }, [`Vintage on ${state.weapon}: older rivens only`]));
  }
  for (const q of quirks(stat, cls, isBow(state.weapon))) {
    kids.push(el('span', { class: 'sub' }, [`${q.label}: ${format(stat, r.at0 * q.factor)} to ${format(stat, r.at1 * q.factor)}`]));
  }
  return el('td', { class: sign === '+' ? 'pos' : 'neg' }, kids);
}

function controls() {
  const set = (/** @type {Partial<typeof state>} */ patch) => { Object.assign(state, patch); render(); };
  const ranks = Array.from({ length: MAX_RANK + 1 }, (_, r) => /** @type {[string, string]} */ ([String(r), String(r)]));
  const items = [
    segmented('View', ['table', 'compare'], state.view, v => set({ view: /** @type {any} */ (v) }),
      v => (v === 'table' ? 'All stats' : 'Compare shapes')),
    weaponPicker(WEAPONS, state.weapon, (weapon, cls) => set({ weapon, cls })),
    segmented('Weapon class', CLASSES, state.cls, v => set({ cls: /** @type {WeaponClass} */ (v), weapon: '' }),
      v => CLASS_LABEL[/** @type {WeaponClass} */ (v)]),
  ];
  if (state.view === 'table') {
    items.push(segmented('Shape', SHAPE_ORDER, state.shape, v => set({ shape: /** @type {Shape} */ (v) })));
  } else {
    const opts = statOptions([...ORDINARY, ...SPLICED], state.cls, ipsOf(state.weapon));
    if (!opts.some(([id]) => id === state.statId)) state.statId = opts[0][0];
    items.push(select('Stat', opts, state.statId, v => set({ statId: v })));
  }
  items.push(select('Rank', ranks, String(state.rank), v => set({ rank: Number(v) })));
  return el('div', { class: 'controls' }, items);
}

const BASE_ICONS = ['heat', 'cold', 'electricity', 'toxin'];

/**
 * A spliced stat's recipe: the game's element icons for a combined element (Heat + Cold for
 * Blast), text otherwise.
 * @param {Stat} s @param {WeaponClass} cls
 */
function recipe(s, cls) {
  const pair = s.from?.[0];
  if (pair && s.from?.length === 1 && pair.every(id => BASE_ICONS.includes(id))) {
    return el('span', { class: 'sub recipe' }, pair.flatMap((id, i) => [
      ...(i ? [' + '] : []),
      el('img', { src: `img/dmg/${id}.png`, alt: statName(STAT_BY_ID[id], cls), title: statName(STAT_BY_ID[id], cls), class: 'dmg-icon' }),
    ]));
  }
  return el('span', { class: 'sub' }, [recipeText(s, cls, STAT_BY_ID)]);
}

/** "Damage to Corpus", "Damage to Grineer" → "Damage to Corpus / Grineer". @param {string[]} names */
function joinNames(names) {
  const prefix = 'Damage to ';
  return names.length > 1 && names.every(n => n.startsWith(prefix))
    ? prefix + names.map(n => n.slice(prefix.length)).join(' / ')
    : names.join(' / ');
}

/** @param {string} title @param {Stat[]} stats */
function section(title, stats) {
  const { cls, shape } = state;
  // Stats whose ranges show exactly the same (Heat / Cold / Electricity / Toxin, the faction stats…)
  // share one row. Spliced stats only merge when their recipes are text (faction damage), each
  // recipe then listed under the row; spliced elements keep their rows for their icons.
  /** @type {{stats: Stat[], cells: HTMLElement[], key: string}[]} */
  const groups = [];
  for (const s of stats.filter(s => s.b[cls] !== undefined && weaponCanRoll(s, ipsOf(state.weapon)) !== 'n')) {
    const cells = [rangeCell(s, cls, shape, '+'), rangeCell(s, cls, shape, '-')];
    const own = s.spliced && s.from?.[0].every(id => BASE_ICONS.includes(id));
    const key = own ? s.id : `${s.spliced}|` + cells.map(c => `${c.className}|${c.textContent}`).join('/');
    const same = groups.find(g => g.key === key);
    if (same) { same.stats.push(s); continue; }
    groups.push({ stats: [s], cells, key });
  }
  const rows = groups.map(g => {
    const names = g.stats.map(s => statName(s, cls));
    const head = [joinNames(names)];
    if (g.stats[0].spliced) {
      head.push(...(g.stats.length === 1 ? [recipe(g.stats[0], cls)]
        : g.stats.map(s => el('span', { class: 'sub' }, [`${statName(s, cls).replace(/^Damage to /, '')}: ${recipeText(s, cls, STAT_BY_ID).replace(/Damage to /g, '')}`]))));
    }
    return el('tr', {}, [el('th', { scope: 'row' }, head), ...g.cells]);
  });
  if (rows.length === 0) return null;
  return el('tbody', {}, [el('tr', { class: 'group' }, [el('th', { colspan: '3', scope: 'colgroup' }, [title])]), ...rows]);
}

function tableView() {
  const isFaction = (/** @type {Stat} */ s) => s.unit === 'mult';
  // A combined element is spliced from two base elements.
  const BASE_ELEMENTS = ['heat', 'cold', 'electricity', 'toxin'];
  const PHYSICAL = ['impact', 'puncture', 'slash'];
  const isElement = (/** @type {Stat} */ s) => !!s.from?.[0].every(id => BASE_ELEMENTS.includes(id));
  const COMBO = ['comboDuration', 'additionalCombo', 'initialCombo', 'chanceToGainCombo'];
  /** Combo stats last, in COMBO order; everything else alphabetical by the name shown. */
  const byOtherOrder = (/** @type {Stat} */ a, /** @type {Stat} */ b) => {
    const ca = COMBO.indexOf(a.id), cb = COMBO.indexOf(b.id);   // -1 for non-combo stats
    if (ca !== cb) return ca - cb;
    return statName(a, state.cls).localeCompare(statName(b, state.cls));
  };
  const isDamage = (/** @type {Stat} */ s) =>
    s.id === 'damage' || BASE_ELEMENTS.includes(s.id) || PHYSICAL.includes(s.id);
  const sections = [
    // Damage, base elements and physical types, in data order; then faction damage.
    section('Damage', ORDINARY.filter(isDamage)),
    section('Faction Damage', ORDINARY.filter(isFaction)),
    section('Other Stats', ORDINARY.filter(s => !isDamage(s) && !isFaction(s))
      // Alphabetical by the name shown, so melee's "Attack Speed" sorts under A. The melee combo
      // stats go last as one block.
      .sort(byOtherOrder)),
    section('Spliced (Always Positive)', SPLICED.filter(s => !isFaction(s) && !isElement(s))),
    section('Spliced Elements', SPLICED.filter(isElement)),
    section('Spliced Faction Damage', SPLICED.filter(isFaction)),
  ].filter(x => x !== null);
  const head = el('thead', {}, [el('tr', {}, [el('th', { scope: 'col' }, ['Stat']), el('th', { scope: 'col' }, ['Positive']), el('th', { scope: 'col' }, ['Negative'])])]);
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges compact' }, [head, ...sections])]);
}

function compareView() {
  const stat = STAT_BY_ID[state.statId];
  const recipe = stat.spliced ? [el('p', { class: 'note' }, [`Spliced from ${recipeText(stat, state.cls, STAT_BY_ID)}.`])] : [];
  const rows = SHAPE_ORDER.map(shape =>
    el('tr', {}, [el('th', { scope: 'row' }, [shape]), rangeCell(stat, state.cls, shape, '+'), rangeCell(stat, state.cls, shape, '-')]));
  const head = el('thead', {}, [el('tr', {}, [el('th', { scope: 'col' }, ['Shape']), el('th', { scope: 'col' }, ['Positive']), el('th', { scope: 'col' }, ['Negative'])])]);
  return el('div', {}, [...recipe, el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges compact' }, [head, el('tbody', {}, rows)])])]);
}

/** @type {HTMLElement} */
let root;

function render() {
  const body = state.view === 'table' ? tableView() : compareView();
  root.replaceChildren(controls(), body, copyLinkButton('r'));
  saveState('r', {
    view: state.view, weapon: state.weapon, cls: state.cls, rank: state.rank,
    ...(state.view === 'table' ? { shape: state.shape } : { stat: state.statId }),
  });
}

/** Applies state from the URL hash; a known weapon overrides the class. */
function restore() {
  const saved = pick(loadState('r'), {
    view: oneOf(/** @type {const} */ (['table', 'compare'])),
    weapon: v => WEAPONS.find(w => w[0] === v)?.[0],
    cls: oneOf(CLASSES),
    shape: oneOf(SHAPE_ORDER),
    stat: v => (STAT_BY_ID[v] ? v : undefined),
    rank: num(0, MAX_RANK),
  });
  if (saved.view) state.view = saved.view;
  if (saved.weapon !== undefined) {
    state.weapon = saved.weapon;
    state.cls = /** @type {WeaponClass} */ (WEAPONS.find(w => w[0] === saved.weapon)?.[1]);
  } else if (saved.cls) {
    state.cls = saved.cls;
  }
  if (saved.shape) state.shape = saved.shape;
  if (saved.stat) state.statId = saved.stat;
  if (saved.rank !== undefined) state.rank = Math.round(saved.rank);
}

/** @param {HTMLElement} container */
export function mountRanges(container) {
  root = container;
  restore();
  render();
}
