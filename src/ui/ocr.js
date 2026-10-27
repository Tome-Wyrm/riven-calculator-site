// @ts-check
// Screenshot → riven stats. Drop, paste (Ctrl+V) or choose an image of a riven card; it's read
// with Tesseract.js in the browser and the result fills the grader for checking. Tesseract is
// loaded from a CDN only when someone first uses this, so the rest of the site stays
// dependency-free. The image never leaves the browser (only Tesseract's code and language data
// are downloaded).

import { readScreenshot } from '../ocr-read.js';
import { STAT_BY_ID } from '../data/stats.js';
import { gradeRoll, inferSign, letterGrade, rollScore, shapeFor } from '../engine.js';
import { el, statName } from './dom.js';
import { graderSnapshot, loadIntoGrader } from './grader.js';
import { offerShare } from './share.js';

/** @type {HTMLElement} */
let status;

/** @param {(Node | string)[]} kids @param {string} [cls] */
const say = (kids, cls = 'note') => status.replaceChildren(el('p', { class: cls }, kids));

const signed = (/** @type {number} */ x) => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(1)}`;

/**
 * Each stat's grade on a card read from a multi-card screen, and the positives' average.
 * @param {import('../ocr-read.js').ScreenshotRead} read
 */
function gradeCard(read) {
  const rank = read.rank ?? 8;
  const nums = read.rows.map(r => ({ r, stat: STAT_BY_ID[r.statId], n: r.value === '' ? null : Number(r.value.replace(/^x/i, '')) }));
  const signs = nums.map(x => (x.n === null ? '+' : inferSign(x.stat, read.cls, x.n)));
  const shape = shapeFor(signs.filter(s => s === '+').length, signs.filter(s => s === '-').length);
  const stats = nums.map((x, i) => {
    const g = shape && x.n !== null ? gradeRoll(x.stat, read.cls, shape, signs[i], x.n, rank) : null;
    return { ...x, sign: signs[i], score: g?.possible ? rollScore(g.mid) : null };
  });
  const scored = stats.filter(s => s.sign === '+' && s.score !== null);
  const avg = scored.length ? scored.reduce((a, s) => a + /** @type {number} */ (s.score), 0) / scored.length : null;
  return { stats, avg };
}

/**
 * Several cards side by side (a cycle, splice or unveil screen), each read on its own: one row
 * per card with its grades and a button to open it in the grader. The first card is loaded.
 * @param {import('../ocr-read.js').ScreenshotRead[]} cards
 */
function showCards(cards) {
  const open = (/** @type {typeof cards[number]} */ c) => loadIntoGrader({ weapon: c.weapon?.name ?? '', cls: c.cls, rank: c.rank ?? 8, rows: c.rows });
  // What the screen is: a splice preview shows "???" for its random stat; two cards of one weapon
  // otherwise are a cycle's choice (the current riven on the left, the new roll on the right).
  const splice = cards.length === 2 && cards.some(c => c.text.includes('???'));
  const cycle = !splice && cards.length === 2 && cards[0].weapon?.name && cards[0].weapon.name === cards[1].weapon?.name;
  const labels = splice ? cards.map(c => (c.text.includes('???') ? 'Spliced (preview)' : 'Before splicing'))
    : cycle ? ['Current', 'New roll'] : cards.map(() => '');
  // The one most worth grading: a cycle's new roll, otherwise the first card.
  open(cards[cycle ? 1 : 0]);
  const rows = cards.map((c, i) => {
    const { stats, avg } = gradeCard(c);
    const button = el('button', { type: 'button', class: 'copy-link' }, ['Open in grader']);
    button.addEventListener('click', () => open(c));
    return el('tr', {}, [
      el('th', { scope: 'row' }, [labels[i] ? el('b', {}, [labels[i]]) : `${i + 1}.`, ` ${c.weapon?.name ?? 'Unknown weapon'}`,
        el('span', { class: 'sub' }, [c.rank === null ? 'rank ? (8 assumed)' : `rank ${c.rank}`])]),
      el('td', {}, [el('ul', { class: 'stat-list' }, stats.map(s => el('li', { class: s.sign === '+' ? 'pos-text' : 'neg-text' }, [
        `${s.r.value || '?'} ${statName(s.stat, c.cls)}`,
        ...(s.score === null ? [] : [' ', el('b', { class: 'grade' }, [letterGrade(s.score)]), ` (${signed(s.score)}%)`]),
      ])))]),
      el('td', { class: 'grade' }, [avg === null ? '—' : `${letterGrade(avg)} (${signed(avg)}%)`]),
      el('td', {}, [button]),
    ]);
  });
  const head = el('thead', {}, [el('tr', {}, ['Card (left to right)', 'Stats', 'Average', ''].map(h => el('th', { scope: 'col' }, [h])))]);
  const what = splice ? 'a splice screen' : cycle ? 'a cycle screen' : `${cards.length} riven cards side by side`;
  say([`Found ${what} and read each card on its own. The ${cycle ? 'new roll' : 'first card'} is in the grader above; `
    + 'open another with its button. Check the values against the screenshot.']);
  status.append(el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges imports' }, [head, el('tbody', {}, rows)])]));
  const missing = cards.flatMap((c, i) => c.issues.map(x => `card ${i + 1}: ${x}`));
  if (missing.length) status.append(el('p', { class: 'note warn' }, [`Couldn't read ${missing.join('; ')}.`]));
}

/** @param {Blob} blob */
async function showScreenshot(blob) {
  say(['Reading the screenshot… (the first time also downloads the text recogniser, a few MB)']);
  try {
    const read = await readScreenshot(blob);
    const raw = el('details', {}, [el('summary', {}, ['Text that was read']), el('pre', { class: 'ocr-raw' }, [read.text])]);
    if (read.cards) {
      // Several cards, each read cleanly: nothing more to say here, and not offered as test data
      // (the single-card reads are what the reader's tests are built on).
      showCards(read.cards);
      status.append(raw);
      return;
    }
    const { rows, rank, issues, positives } = read;
    if (!rows.length) {
      say(['No riven stats found in that image. Try a tighter crop around the riven card.'], 'note warn');
      status.append(raw);
      return;
    }
    loadIntoGrader({ weapon: read.weapon?.name ?? '', cls: read.cls, rank: rank ?? 8, rows });

    const found = rows.map(r => `${r.value} ${STAT_BY_ID[r.statId].name}`).join(', ');
    say([`Read ${read.weapon?.name ?? 'a riven'}${rank === null ? '' : `, rank ${rank}`}: ${found}. Check the values above.`],
      issues.length ? 'note warn' : 'note');
    if (read.market) {
      status.append(el('p', { class: 'note warn' }, [
        "This looks like a warframe.market listing, not the game: its stat boxes don't read well, so some may be missing. "
        + 'Check the values above against the listing, or use a screenshot from the game.']));
    }
    if (read.twoCards) {
      status.append(el('p', { class: 'note warn' }, [
        "This looks like several riven cards side by side, and they couldn't be read apart. Crop to one card and try again."]));
    }
    if (positives) {
      status.append(el('p', { class: 'note' }, [`The riven's name confirms the positives: ${positives.map(id => STAT_BY_ID[id].name).join(', ')}.`]));
    }
    const locked = rows.filter(r => r.locked);
    if (locked.length) status.append(el('p', { class: 'note' }, [`Locked: ${locked.map(r => STAT_BY_ID[r.statId].name).join(', ')}.`]));
    if (read.notes.length) status.append(el('p', { class: 'note' }, [`Fixed using the name and the stat ranges: ${read.notes.join('; ')}.`]));
    if (issues.length) status.append(el('p', { class: 'note warn' }, [`Couldn't read ${issues.join(', ')}.`]));
    status.append(raw);
    // A market listing isn't the game's own text, so it's no use as reader test data.
    if (!read.market) offerShare({
      kind: 'screenshot',
      summary: `${read.weapon?.name ?? 'Unknown weapon'}, rank ${rank ?? '?'}: ${found}`,
      image: blob,
      // Built when sent, so corrections made in the grader go too.
      data: () => ({
        read: { weapon: read.weapon?.name ?? null, rank, rows, twoCards: read.twoCards, notes: read.notes, issues },
        corrected: graderSnapshot(),
        ocrText: read.text,
        page: location.origin + location.pathname,
      }),
    });
  } catch (e) {
    say([e instanceof Error ? e.message : String(e)], 'note warn');
  }
}

/** @param {DataTransfer | null} dt */
const imageFrom = dt => [...(dt?.files ?? [])].find(f => f.type.startsWith('image/'));

/** @param {HTMLElement} container */
export function mountOcr(container) {
  const file = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept: 'image/*', 'aria-label': 'Riven screenshot' }));
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) showScreenshot(f); });
  const zone = el('div', { class: 'drop-zone', tabindex: '0' }, [
    el('strong', {}, ['Grade from a screenshot']),
    el('span', {}, [' — drop an image here, paste one (Ctrl+V), or ']),
    el('label', { class: 'file-link' }, ['choose a file', file]),
    el('span', { class: 'sub' }, ['Crop close to the riven card for the best results. The image stays in your browser.']),
  ]);
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = imageFrom(e.dataTransfer);
    if (f) showScreenshot(f);
  });
  // Paste anywhere on the page, unless the cursor is in a text box.
  document.addEventListener('paste', e => {
    const t = /** @type {HTMLElement | null} */ (e.target);
    if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
    const f = imageFrom(e.clipboardData);
    if (f) { e.preventDefault(); showScreenshot(f); }
  });
  status = el('div', { 'aria-live': 'polite' });
  container.replaceChildren(zone, status);
}
