// @ts-check
// Riven grader: enter a riven's stats as the game shows them → each stat's roll on the community
// ±10% scale, with a letter grade.

import { CLASSES, MAX_RANK, ORDINARY, SPLICED, STAT_BY_ID } from '../data/stats.js';
import { canRoll, fittingShapes, weaponCanRoll, format, gradeRoll, inferSign, letterGrade, range, rollScore, shapeFor } from '../engine.js';
import { WEAPONS } from '../data/weapons.js';
import { CLASS_LABEL, el, statName, segmented, select, statOptions, weaponPicker, copyLinkButton, ipsOf } from './dom.js';
import { loadState, saveState, pick, oneOf, num } from './state.js';
import { loadIntoPlanner } from './planner.js';

/** @typedef {import('../data/stats.js').Stat} Stat */
/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */

const MAX_ROWS = 4;

const state = {
  weapon: '',
  cls: /** @type {WeaponClass} */ ('rifle'),
  rank: MAX_RANK,
  rows: /** @type {{statId: string, value: string, locked?: boolean}[]} */ ([]),
};

const signed = (/** @type {number} */ x) => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(4)}`;

/** Score interval → "+9.1%" or "+8.9 to +9.2%" when the game's rounding leaves real doubt. */
function scoreText(/** @type {number} */ lo, /** @type {number} */ hi) {
  return hi - lo < 0.1 ? `${signed((lo + hi) / 2)}%` : `${signed(lo)} to ${signed(hi)}%`;
}

/** The letter for a score interval; both letters when it straddles a boundary. */
function gradeText(/** @type {number} */ lo, /** @type {number} */ hi) {
  const [a, b] = [letterGrade(lo), letterGrade(hi)];
  return a === b ? a : `${a} / ${b}`;
}

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
    if (!options.some(([id]) => id === row.statId)) {
      // A stat the class can roll but our IPS data says this weapon can't: keep it (the riven is
      // better evidence than the data) and say so, rather than silently swapping it out.
      const stat = STAT_BY_ID[row.statId];
      if (stat?.b[state.cls] !== undefined) options.push([row.statId, `${statName(stat, state.cls)} (not expected on ${state.weapon})`]);
      else row.statId = options[0][0];
    }
    const input = /** @type {HTMLInputElement} */ (el('input', {
      type: 'text', inputmode: 'decimal', value: row.value, placeholder: 'e.g. +267.2', 'aria-label': `Stat ${i + 1} value`,
    }));
    // Results update as you type without rebuilding the inputs, so focus stays put.
    input.addEventListener('input', () => { row.value = input.value; renderResults(); });
    const remove = el('button', { type: 'button', class: 'icon-button', 'aria-label': `Remove stat ${i + 1}` }, ['×']);
    // Locked (padlock in game): doesn't change the grade, but the Build planner uses it.
    const lock = el('button', {
      type: 'button', class: 'icon-button lock', 'aria-label': `Stat ${i + 1} locked`, 'aria-pressed': String(!!row.locked),
      title: 'Locked in game',
    }, ['🔒']);
    lock.addEventListener('click', () => { row.locked = !row.locked; render(); });
    remove.addEventListener('click', () => { state.rows.splice(i, 1); render(); });
    return el('div', { class: 'grade-row' }, [
      select(`Stat ${i + 1}`, options, row.statId, v => { row.statId = v; render(); }),
      el('label', { class: 'field target' }, [input]),
      lock,
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
  // A stat with no value yet (e.g. a faction stat the companion app shows as "+0") still takes a
  // slot, but its sign is unknown: use whichever shape makes every entered value possible.
  const blanks = state.rows.filter(r => r.value.trim() === '').length;
  const positives = parsed.filter(r => r.sign === '+').length + blanks;
  const negatives = parsed.length + blanks - positives;
  const shape = blanks
    ? (fittingShapes(/** @type {{stat: Stat, shown: number}[]} */ (parsed), blanks, cls, rank)[0] ?? shapeFor(positives, negatives))
    : shapeFor(positives, negatives);
  if (!shape && parsed.length) {
    problems.push(`${positives} positive and ${negatives} negative: a riven has 2 or 3 positives and at most 1 negative.`);
  }
  if (!shape || problems.length) {
    return el('div', {}, problems.length
      ? problems.map(p => el('p', { class: 'note warn' }, [p]))
      : [el('p', { class: 'note' }, ['Enter the values shown on the riven.'])]);
  }

  /** @type {number[]} */
  const scores = [];
  /** @type {string[]} things worth reporting: impossible values, IPS stats the data rules out */
  const oddities = [];
  const rows = parsed.map(({ stat, shown, sign }) => {
    const can = state.weapon ? weaponCanRoll(stat, ipsOf(state.weapon)) : 'y';
    if (can === 'n' || can === '?') {
      oddities.push(`${statName(stat, cls)} on ${state.weapon}: the data says it ${weaponCanRoll(stat, ipsOf(state.weapon)) === 'n' ? "can't" : 'may not'} roll`);
    }
    // Vintage: fine to have, but a cycle won't give it back.
    const name = el('th', { scope: 'row', ...(can === 'v' ? { class: 'vintage', title: 'Vintage: no longer rolls on this weapon' } : {}) },
      [statName(stat, cls), ...(can === 'v' ? [el('span', { class: 'sub' }, ['Vintage: cycling won\u2019t bring it back'])] : [])]);
    const shownCell = el('td', {}, [format(stat, /** @type {number} */ (shown))]);
    if (!canRoll(stat, cls, shape, sign)) {
      oddities.push(`${format(stat, /** @type {number} */ (shown))} ${statName(stat, cls)} can't be ${sign === '+' ? 'positive' : 'negative'} on a ${shape} riven`);
      return el('tr', {}, [name, shownCell, el('td', { class: 'miss', colspan: '3' }, [`Can't be ${sign === '+' ? 'positive' : 'negative'} on a ${shape} riven`])]);
    }
    const r = range(stat, cls, shape, sign, rank);
    const g = gradeRoll(stat, cls, shape, sign, /** @type {number} */ (shown), rank);
    const rangeCell = el('td', {}, [`${format(stat, r.at0)} to ${format(stat, r.at1)}`]);
    if (!g.possible) {
      oddities.push(`${format(stat, /** @type {number} */ (shown))} ${statName(stat, cls)} is outside the range ${format(stat, r.at0)} to ${format(stat, r.at1)} (${shape}, rank ${rank})`);
      return el('tr', {}, [name, shownCell, rangeCell, el('td', { class: 'miss', colspan: '2' }, ['Outside the range: check the value or the rank'])]);
    }
    // The curse is scored by size, like the positives: a curse can be a splice parent, and a big
    // one makes a big spliced stat. So it counts in the average too.
    const curse = sign === '-';
    const [sLo, sHi] = [rollScore(g.lo), rollScore(g.hi)].sort((x, y) => x - y);
    scores.push((sLo + sHi) / 2);
    return el('tr', {}, [name, shownCell, rangeCell,
      el('td', { class: curse ? 'neg' : 'pos' }, [scoreText(sLo, sHi)]),
      el('td', { class: 'grade' }, [gradeText(sLo, sHi)])]);
  });

  const head = el('thead', {}, [el('tr', {}, ['Stat', 'Shown', `Range (${shape}, rank ${rank})`, 'Roll', 'Grade']
    .map(h => el('th', { scope: 'col' }, [h])))]);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return el('div', {}, [
    el('p', { class: 'summary' }, [`Shape ${shape}` + (avg === null ? '' : ` · average roll ${signed(avg)}% (${letterGrade(avg)})`)]),
    planButton(parsed, shape),
    ...(blanks ? [el('p', { class: 'note' }, [`${blanks} stat${blanks > 1 ? "s have" : " has"} no value yet: it still counts toward the shape (as whichever sign fits the other values), but isn't graded.`])] : []),
    el('p', { class: 'note' }, [
      'Roll: how far each stat landed from average, from −10% (worst) to +10% (best). The curse is scored by its size, like the positives (a big curse splices into a big stat). ',
      'Grades: S ≥ +9.5, A+ ≥ +7.5, A ≥ +5.5, A- ≥ +3.5, B+ ≥ +1.5, B ≥ −1.5, B- ≥ −3.5, C+ ≥ −5.5, C ≥ −7.5, C- ≥ −9.5, else F.']),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals' }, [head, el('tbody', {}, rows)])]),
    ...(oddities.length ? [reportLink(oddities)] : []),
  ]);
}

/**
 * Sends this riven to the Build planner as the riven to start from.
 * @param {{stat: Stat, sign: string, shown: number | null}[]} parsed @param {import('../data/stats.js').Shape} shape
 */
function planButton(parsed, shape) {
  const b = el('button', { type: 'button', class: 'copy-link' }, ['Plan from this riven']);
  b.addEventListener('click', () => loadIntoPlanner({
    weapon: state.weapon, cls: state.cls, shape,
    positives: parsed.filter(r => r.sign === '+').map(r => r.stat.id),
    values: parsed.filter(r => r.sign === '+').map(r => String(Math.abs(/** @type {number} */ (r.shown)))),
    negative: parsed.find(r => r.sign === '-')?.stat.id ?? null,
    negValue: (n => (n ? String(Math.abs(/** @type {number} */ (n.shown))) : ''))(parsed.find(r => r.sign === '-')),
    locked: state.rows.filter(r => r.locked).map(r => r.statId),
  }));
  return b;
}

const ISSUES_URL = 'https://github.com/Tome-Wyrm/riven-calculator-site/issues/new';

/**
 * "Is this riven real?" A link to a pre-filled GitHub issue (form: .github/ISSUE_TEMPLATE/riven-report.yml).
 * A real riven the site can't explain is the best way to correct its data.
 * @param {string[]} oddities
 */
function reportLink(oddities) {
  // In the game's own format ("+267.2%", "x0.58"), whatever was typed.
  const stats = state.rows.filter(r => parseShown(r.value) !== null).map(r => {
    const stat = STAT_BY_ID[r.statId];
    return `${format(stat, /** @type {number} */ (parseShown(r.value)))} ${statName(stat, state.cls)}`;
  }).join('\n');
  const params = new URLSearchParams({
    template: 'riven-report.yml',
    title: `[Riven] ${state.weapon || CLASS_LABEL[state.cls]}: ${oddities[0]}`.slice(0, 120),
    weapon: state.weapon || CLASS_LABEL[state.cls],
    rank: String(state.rank),
    stats,
    problem: oddities.join('\n'),
  });
  const a = el('a', { href: `${ISSUES_URL}?${params}`, target: '_blank', rel: 'noopener' }, ['report it on GitHub']);
  return el('p', { class: 'note warn' }, [
    "If these are the real values from the game, the site's data may be wrong: please ", a,
    ' with a screenshot of the riven. (Old rivens from before a balance change can also show values that no longer roll.)']);
}

/** @type {HTMLElement} */
let root;
/** @type {HTMLElement} */
let resultsBox;

function renderResults() {
  resultsBox.replaceChildren(results());
  saveState('v', {
    weapon: state.weapon, cls: state.cls, rank: state.rank,
    rows: state.rows.map(r => `${r.statId}:${r.value}${r.locked ? ':l' : ''}`).join(';'),
  });
}

function render() {
  resultsBox = el('div', { 'aria-live': 'polite' });
  root.replaceChildren(controls(), statRows(), resultsBox, copyLinkButton('v'));
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
        const [statId, value = '', lock] = p.split(':');
        return { statId, value, ...(lock === 'l' ? { locked: true } : {}) };
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

/**
 * Fills the grader with a riven (used by the inventory importer).
 * @param {{weapon: string, cls: WeaponClass, rank: number, rows: {statId: string, value: string, locked?: boolean}[]}} riven
 */
export function loadIntoGrader(riven) {
  Object.assign(state, riven);
  render();
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** What the grader shows now (after any corrections), for test data. */
export function graderSnapshot() {
  return { weapon: state.weapon, cls: state.cls, rank: state.rank, rows: state.rows.map(r => ({ ...r })) };
}

/** @param {HTMLElement} container */
export function mountGrader(container) {
  root = container;
  restore();
  render();
}
