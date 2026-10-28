// @ts-check
// Riven review (tools/review.html): step through test/fixtures/local/review-queue.json (images with
// the reader's draft answers), correct each by hand, and download the verified answers in
// expected.json's format. Progress is kept in this browser's localStorage. Open from the dev
// server: http://localhost:8000/tools/review.html

import { ORDINARY, SPLICED, STAT_BY_ID } from '../src/data/stats.js';
import { WEAPONS } from '../src/data/weapons.js';
import { inferSign, shapeFor, gradeRoll, canRoll, format } from '../src/engine.js';
import { locateCard } from '../src/ocr-read.js';

const DIR = '../test/fixtures/local/';
const KEY = 'riven-review-v1';

/** @typedef {{file: string, weapon: string | null, rank: number | null, stats: string[], locked: string[], source?: string, problems?: string[]}} Item */
/** @typedef {{verdict: 'ok' | 'partial' | 'reject' | 'twoCards' | 'splice', checked?: Part[], weapon?: string | null, rank?: number | null, stats?: string[], locked?: string[], obstructed?: boolean}} Review */

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
// Review one part of every card at a time (rank, then weapon, then stats), or everything at once.
/** @typedef {'rank' | 'weapon' | 'stats'} Part */
/** @type {Part[]} */
const PARTS = ['rank', 'weapon', 'stats'];
const MODES = /** @type {const} */ ([['rank', 'Rank'], ['weapon', 'Weapon'], ['stats', 'Stats'], ['all', 'Everything']]);
const MODE_KEY = 'riven-review-mode';
/** @type {Part | 'all'} */
let mode = 'all';
try { const m = localStorage.getItem(MODE_KEY); if (MODES.some(([v]) => v === m)) mode = /** @type {Part | 'all'} */ (m); } catch { /* default */ }

/** Parts already checked on a card (an answer accepted before modes existed counts as all of them). @param {Review | undefined} r */
const checkedParts = r => r?.verdict === 'ok' ? r.checked ?? PARTS : r?.verdict === 'partial' ? r.checked ?? [] : [];
/** Whether the card needs nothing more in the current mode. @param {string} file */
function done(file) {
  const r = saved[file];
  if (!r) return false;
  if (r.verdict !== 'ok' && r.verdict !== 'partial') return true;
  return mode === 'all' ? r.verdict === 'ok' : checkedParts(r).includes(mode);
}
let index = Math.max(0, queue.findIndex(q => !done(q.file)));

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

/** Where each image's card text is (one quick read, done in the background). @type {Map<string, Promise<any>>} */
const located = new Map();
/** @param {string} file */
function locate(file) {
  if (!located.has(file)) located.set(file, fetch(DIR + file).then(r => r.blob()).then(locateCard).catch(() => null));
  return /** @type {Promise<any>} */ (located.get(file));
}

/**
 * Close-ups for the current mode: the whole card for its rank, the title for the weapon, the text
 * panel for stats (all three in Everything mode). Purely a view; nothing is read from them.
 * @param {string} file
 */
async function showZoom(file) {
  $('zoom').replaceChildren(el('p', { class: 'sub' }, ['Finding the card…']));
  const [spot, img] = await Promise.all([locate(file), /** @type {HTMLImageElement} */ ($('img')).decode().then(() => $('img'), () => null)]);
  if (queue[index].file !== file || !img) return;
  if (!spot) { $('zoom').replaceChildren(el('p', { class: 'sub' }, ["Couldn't find a single card to zoom in on."])); return; }
  const { text, title } = spot;
  const w = text.x1 - text.x0, h = text.y1 - text.y0;
  /** @type {[string, number, number, number, number][]} */
  const views = [];
  // The art above the text panel is about as tall again as the panel; the drain is at its top right.
  if (mode === 'rank' || mode === 'all') views.push(['Card', text.x0 - 0.2 * w, text.y0 - 1.5 * h, text.x1 + 0.2 * w, text.y1 + 0.35 * h]);
  if (mode === 'weapon' || mode === 'all') { const th = title.y1 - title.y0; views.push(['Title', title.x0 - 0.1 * w, title.y0 - 0.4 * th, title.x1 + 0.1 * w, title.y1 + 0.4 * th]); }
  if (mode === 'stats' || mode === 'all') views.push(['Text', text.x0 - 0.06 * w, text.y0 - 0.06 * h, text.x1 + 0.06 * w, text.y1 + 0.25 * h]);
  $('zoom').replaceChildren(...views.map(([label, x0, y0, x1, y1]) => {
    [x0, y0] = [Math.max(0, x0), Math.max(0, y0)];
    [x1, y1] = [Math.min(/** @type {HTMLImageElement} */ (img).naturalWidth, x1), Math.min(/** @type {HTMLImageElement} */ (img).naturalHeight, y1)];
    const k = Math.min(4, 430 / (x1 - x0), (label === 'Card' ? 520 : 400) / (y1 - y0));
    const c = /** @type {HTMLCanvasElement} */ (el('canvas', { width: String(Math.round((x1 - x0) * k)), height: String(Math.round((y1 - y0) * k)), title: label }));
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.imageSmoothingQuality = 'high';
    g.drawImage(/** @type {HTMLImageElement} */ (img), x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
    return c;
  }));
}

function show() {
  const item = queue[index];
  const prior = saved[item.file];
  const a = prior?.verdict === 'ok' || prior?.verdict === 'partial' ? { ...item, ...prior } : item;
  /** @type {HTMLImageElement} */ ($('img')).src = DIR + item.file;
  showZoom(item.file);
  // Have the next card's close-up ready.
  if (queue[index + 1]) locate(queue[index + 1].file);
  $('shot').classList.remove('full');
  const reviewed = queue.filter(q => done(q.file)).length;
  $('status').replaceChildren(`${index + 1} / ${queue.length} · ${item.file}${item.source ? ` (${item.source})` : ''} · done in this mode ${reviewed}`,
    ...(prior ? [' · ', el('span', { class: 'done' }, [`this one: ${prior.verdict === 'ok' ? 'accepted' : prior.verdict === 'partial' ? `checked ${checkedParts(prior).join(', ')}` : prior.verdict === 'twoCards' ? 'two cards' : prior.verdict === 'splice' ? 'splice screen' : 'not usable'}`])] : []),
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
  /** Hidden outside its own mode (its value still saves). @param {Part} part @param {HTMLElement} e */
  const only = (part, e) => { if (mode !== 'all' && mode !== part) e.hidden = true; return e; };
  const modes = el('div', { class: 'buttons modes' }, MODES.map(([m, label], i) => {
    const b = btn(label, m === mode ? 'accept' : '', () => setMode(m));
    b.title = `Alt+${i + 1}`;
    return b;
  }));
  $('form').replaceChildren(
    modes,
    // Rank mode is keys only: a digit sets the rank and moves on.
    mode === 'rank'
      ? el('p', {}, ['Rank ', el('span', { class: 'rank-now' }, [a.rank === null ? '?' : String(a.rank)]),
        el('span', { class: 'sub' }, [' (the draft) · press 0–8, or / * - + for ?']), el('span', { hidden: '' }, [rank])])
      : only('rank', el('label', { class: 'field' }, [el('span', {}, ['Rank']), rank])),
    only('weapon', el('label', { class: 'field' }, [el('span', {}, ['Weapon']), weapon])),
    // Cursor or overlay over some of the text: still a fair test for the reader, but those lines
    // shouldn't be training labels.
    only('stats', el('label', { class: 'obstructed', title: 'Alt+O' }, [
      el('input', { type: 'checkbox', name: 'obstructed', ...(prior?.obstructed ? { checked: '' } : {}) }),
      ' Obstructed (cursor or overlay over some text)'])),
    ...rows.map(row => only('stats', row)),
    el('div', { class: 'buttons' }, [
      btn('Accept ✓', 'accept', accept),
      btn('Not usable', '', () => decide('reject')),
      btn('Two cards', '', () => decide('twoCards')),
      btn('Splice screen', '', () => decide('splice')),
    ]),
    el('div', { class: 'buttons' }, [
      btn('← Back', '', () => go(-1)),
      btn('Forward →', '', () => go(1)),
      btn('Next unreviewed', '', nextUndone),
    ]),
    el('div', { class: 'buttons' }, [btn('Download answers', '', download)]),
  );
  checkRows();
  const first = mode === 'weapon' ? weapon : mode === 'stats' ? rows[0].querySelector('input') : mode === 'all' ? rank : null;
  if (first) /** @type {HTMLElement} */ (first).focus();
  else /** @type {HTMLElement | null} */ (document.activeElement)?.blur();
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

/** @param {Part | 'all'} m */
function setMode(m) {
  mode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch { /* not remembered */ }
  show();
}
/** The next card this mode still needs (wrapping round), else just the next card. */
function nextUndone() {
  const n = queue.findIndex((q, i) => i > index && !done(q.file));
  const wrap = n >= 0 ? n : queue.findIndex(q => !done(q.file));
  if (wrap >= 0 && wrap !== index) { index = wrap; show(); } else go(1);
}

/** Saves the whole form, marking this mode's part (or every part) as checked. */
function accept() {
  const file = queue[index].file;
  const checked = mode === 'all' ? PARTS : PARTS.filter(p => p === mode || checkedParts(saved[file]).includes(p));
  saved[file] = { ...current(), verdict: checked.length === PARTS.length ? 'ok' : 'partial', checked };
  store();
  nextUndone();
}
/** @param {'reject' | 'twoCards' | 'splice'} verdict */
function decide(verdict) {
  saved[queue[index].file] = { verdict };
  store();
  nextUndone();
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
    if (!r || r.verdict === 'partial') continue;   // not every part checked yet
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
  if (mode === 'rank' && !e.altKey && !e.ctrlKey && /^[0-8/*+-]$/.test(e.key)) {
    e.preventDefault();
    /** @type {HTMLSelectElement} */ ($('form').querySelector('[name=rank]')).value = /^\d$/.test(e.key) ? e.key : '';
    accept();
  }
  else if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); accept(); }
  else if (e.altKey && e.key.toLowerCase() === 'x') { e.preventDefault(); decide('reject'); }
  else if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); decide('twoCards'); }
  else if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); decide('splice'); }
  else if (e.altKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    const box = /** @type {HTMLInputElement} */ ($('form').querySelector('[name=obstructed]'));
    box.checked = !box.checked;
  }
  else if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); setMode(MODES[Number(e.key) - 1][0]); }
  else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
});
show();
