// @ts-check
// Riven review (tools/review.html): step through test/fixtures/local/review-queue.json (images with
// the reader's draft answers), correct each by hand, and download the verified answers in
// expected.json's format. Progress is kept in this browser's localStorage. Open from the dev
// server: http://localhost:8000/tools/review.html

import { ORDINARY, SPLICED, STAT_BY_ID } from '../src/data/stats.js';
import { WEAPONS } from '../src/data/weapons.js';
import { inferSign, shapeFor, gradeRoll, canRoll, format } from '../src/engine.js';

const DIR = '../test/fixtures/local/';
const KEY = 'riven-review-v1';

/** @typedef {{file: string, weapon: string | null, rank: number | null, stats: string[], locked: string[], source?: string, problems?: string[]}} Item */
/** @typedef {{verdict: 'ok' | 'reject' | 'twoCards' | 'splice', weapon?: string | null, rank?: number | null, stats?: string[], locked?: string[], obstructed?: boolean}} Review */

/** @type {Item[]} */
const queue = await (await fetch(DIR + 'review-queue.json', { cache: 'no-store' })).json();
/** @type {Record<string, Review>} */
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* fresh start */ }
const store = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* full or blocked */ } };

const STATS = [...ORDINARY, ...SPLICED];
// For a splice screen's unrevealed new stat; review-only, never a stat on the site.
const UNKNOWN = '???';
const statLabel = (/** @type {import('../src/data/stats.js').Stat} */ s) => s.name + (s.meleeName ? ` / ${s.meleeName}` : '') + (s.spliced ? ' (spliced)' : '');
let index = Math.max(0, queue.findIndex(q => !saved[q.file]));

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node | string)[]} [kids] */
function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

const weaponList = el('datalist', { id: 'weapons' }, WEAPONS.map(w => el('option', { value: w[0] })));
document.body.append(weaponList);

/** The form's current answer. */
function current() {
  const f = $('form');
  const weapon = /** @type {HTMLInputElement} */ (f.querySelector('[name=weapon]')).value.trim() || null;
  const r = /** @type {HTMLSelectElement} */ (f.querySelector('[name=rank]')).value;
  const stats = [], locked = [];
  for (const row of f.querySelectorAll('.row')) {
    const v = /** @type {HTMLInputElement} */ (row.querySelector('input[type=text]')).value.trim();
    const id = /** @type {HTMLSelectElement} */ (row.querySelector('select')).value;
    if (!id) continue;
    stats.push(`${v} ${id}`);
    if (/** @type {HTMLInputElement} */ (row.querySelector('input[type=checkbox]')).checked) locked.push(id);
  }
  const obstructed = /** @type {HTMLInputElement} */ (f.querySelector('[name=obstructed]')).checked;
  return { weapon, rank: r === '' ? null : Number(r), stats, locked, ...(obstructed ? { obstructed: true } : {}) };
}

/** "In range" check for one stat row, given the whole answer (the shape depends on every sign). */
function checkRows() {
  const a = current();
  const w = WEAPONS.find(x => x[0] === a.weapon);
  const parsed = a.stats.map(s => { const [v, id] = s.split(' '); return { n: Number(v.replace(/^x/, '')), stat: STAT_BY_ID[id], v }; });
  const notes = $('form').querySelectorAll('.check');
  // An unrevealed stat (a splice screen's "???") has no sign, so no shape to check against.
  if (parsed.some(p => p.v && !p.stat && a.stats.some(s => s.endsWith(' ' + UNKNOWN)))) {
    notes.forEach(n => { n.textContent = ''; n.className = 'check'; });
    return;
  }
  if (!w || a.rank === null || parsed.some(p => !p.v)) { notes.forEach(n => { n.textContent = w ? '' : 'weapon not recognised'; n.className = 'check bad'; }); return; }
  const signs = parsed.map(p => inferSign(p.stat, w[1], p.n));
  const shape = shapeFor(signs.filter(s => s === '+').length, signs.filter(s => s === '-').length);
  [...$('form').querySelectorAll('.row')].filter(r => /** @type {HTMLSelectElement} */ (r.querySelector('select')).value).forEach((row, i) => {
    const note = /** @type {HTMLElement} */ (row.querySelector('.check'));
    if (!shape) { note.textContent = 'not a valid riven shape'; note.className = 'check bad'; return; }
    const p = parsed[i];
    const ok = canRoll(p.stat, w[1], shape, signs[i]) && gradeRoll(p.stat, w[1], shape, signs[i], p.n, a.rank).possible;
    note.textContent = ok ? `in range (${shape}, rank ${a.rank})` : `out of range for ${shape} rank ${a.rank} (old riven, or a misread)`;
    note.className = `check ${ok ? 'ok' : 'bad'}`;
  });
}

function show() {
  const item = queue[index];
  const prior = saved[item.file];
  const a = prior?.verdict === 'ok' ? { ...item, ...prior } : item;
  /** @type {HTMLImageElement} */ ($('img')).src = DIR + item.file;
  $('shot').classList.remove('full');
  const reviewed = Object.keys(saved).length;
  $('status').replaceChildren(`${index + 1} / ${queue.length} · ${item.file}${item.source ? ` (${item.source})` : ''} · reviewed ${reviewed}`,
    ...(prior ? [' · ', el('span', { class: 'done' }, [`this one: ${prior.verdict === 'ok' ? 'accepted' : prior.verdict === 'twoCards' ? 'two cards' : prior.verdict === 'splice' ? 'splice screen' : 'not usable'}`])] : []),
    ...(item.problems?.length ? [` · reader flagged: ${item.problems.join(', ')}`] : []));

  const weapon = el('input', { type: 'text', name: 'weapon', list: 'weapons', value: a.weapon ?? '', placeholder: 'weapon (blank if not shown)' });
  const rank = el('select', { name: 'rank' }, [el('option', { value: '' }, ['?']),
    ...Array.from({ length: 9 }, (_, r) => el('option', { value: String(r), ...(a.rank === r ? { selected: '' } : {}) }, [String(r)]))]);
  const rows = Array.from({ length: 4 }, (_, i) => {
    const [v = '', id = ''] = (a.stats[i] ?? '').split(' ');
    const sel = el('select', {}, [el('option', { value: '' }, ['—']),
      el('option', { value: UNKNOWN, ...(id === UNKNOWN ? { selected: '' } : {}) }, ['??? (unrevealed)']),
      ...STATS.map(s => el('option', { value: s.id, ...(s.id === id ? { selected: '' } : {}) }, [statLabel(s)]))]);
    const lock = el('input', { type: 'checkbox', title: 'Locked', ...(a.locked.includes(id) && id ? { checked: '' } : {}) });
    return el('div', { class: 'row' }, [el('input', { type: 'text', value: v, placeholder: '+97.4 / x1.06' }), sel,
      el('label', {}, [lock, ' 🔒']), el('span', { class: 'move' }, [moveBtn('↑', -1), moveBtn('↓', 1)]), el('span', { class: 'check' })]);
  });
  const btn = (/** @type {string} */ text, /** @type {string} */ cls, /** @type {() => void} */ fn) => { const b = el('button', { type: 'button', class: cls }, [text]); b.addEventListener('click', fn); return b; };
  $('form').replaceChildren(
    el('label', { class: 'field' }, [el('span', {}, ['Weapon']), weapon]),
    el('label', { class: 'field' }, [el('span', {}, ['Rank']), rank]),
    // Cursor or overlay over some of the text: still a fair test for the reader, but those lines
    // shouldn't be training labels.
    el('label', { class: 'obstructed', title: 'Alt+O' }, [
      el('input', { type: 'checkbox', name: 'obstructed', ...(prior?.obstructed ? { checked: '' } : {}) }),
      ' Obstructed (cursor or overlay over some text)']),
    ...rows,
    el('div', { class: 'buttons' }, [
      btn('Accept ✓', 'accept', accept),
      btn('Not usable', '', () => decide('reject')),
      btn('Two cards', '', () => decide('twoCards')),
      btn('Splice screen', '', () => decide('splice')),
      btn('← Back', '', () => go(-1)),
      btn('Skip →', '', () => go(1)),
      btn('Next unreviewed', '', () => { const n = queue.findIndex((q, i) => i > index && !saved[q.file]); if (n >= 0) { index = n; show(); } }),
    ]),
    el('div', { class: 'buttons' }, [btn('Download answers', '', download)]),
  );
  checkRows();
  /** @type {HTMLInputElement} */ (weapon).focus();
}

/** A button that swaps its stat row with the one above (-1) or below (1). */
function moveBtn(/** @type {string} */ text, /** @type {number} */ dir) {
  const b = el('button', { type: 'button', title: dir < 0 ? 'Move up' : 'Move down' }, [text]);
  b.addEventListener('click', () => {
    const row = /** @type {HTMLElement} */ (b.closest('.row'));
    const other = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!other?.classList.contains('row')) return;
    dir < 0 ? other.before(row) : other.after(row);
    checkRows();
  });
  return b;
}

function accept() {
  saved[queue[index].file] = { verdict: 'ok', ...current() };
  store();
  go(1);
}
/** @param {'reject' | 'twoCards' | 'splice'} verdict */
function decide(verdict) {
  saved[queue[index].file] = { verdict };
  store();
  go(1);
}
/** @param {number} step */
function go(step) {
  index = Math.max(0, Math.min(queue.length - 1, index + step));
  show();
}

/** expected.json-style answers for everything reviewed so far. */
function download() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const item of queue) {
    const r = saved[item.file];
    if (!r) continue;
    out[item.file] = r.verdict === 'ok'
      ? { weapon: r.weapon, rank: r.rank, stats: r.stats, locked: r.locked, ...(r.obstructed ? { obstructed: true } : {}), source: item.source }
      : r.verdict === 'twoCards' ? { twoCards: true, source: item.source }
        : r.verdict === 'splice' ? { spliceScreen: true, source: item.source } : { rejected: true, source: item.source };
  }
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })), download: 'review-answers.json' });
  a.click();
}

$('form').addEventListener('input', checkRows);
$('form').addEventListener('change', checkRows);
$('shot').addEventListener('click', () => $('shot').classList.toggle('full'));
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); accept(); }
  else if (e.altKey && e.key.toLowerCase() === 'x') { e.preventDefault(); decide('reject'); }
  else if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); decide('twoCards'); }
  else if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); decide('splice'); }
  else if (e.altKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    const box = /** @type {HTMLInputElement} */ ($('form').querySelector('[name=obstructed]'));
    box.checked = !box.checked;
  }
  else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
});
show();
