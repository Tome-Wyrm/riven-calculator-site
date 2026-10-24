// @ts-check
// Screenshot → riven stats. Drop, paste (Ctrl+V) or choose an image of a riven card; it's read
// with Tesseract.js in the browser and the result fills the grader for checking. Tesseract is
// loaded from a CDN only when someone first uses this, so the rest of the site stays
// dependency-free. The image never leaves the browser (only Tesseract's code and language data
// are downloaded).

import { readScreenshot } from '../ocr-read.js';
import { STAT_BY_ID } from '../data/stats.js';
import { el } from './dom.js';
import { graderSnapshot, loadIntoGrader } from './grader.js';
import { offerShare } from './share.js';

/** @type {HTMLElement} */
let status;

/** @param {(Node | string)[]} kids @param {string} [cls] */
const say = (kids, cls = 'note') => status.replaceChildren(el('p', { class: cls }, kids));

/** @param {Blob} blob */
async function showScreenshot(blob) {
  say(['Reading the screenshot… (the first time also downloads the text recogniser, a few MB)']);
  try {
    const read = await readScreenshot(blob);
    const raw = el('details', {}, [el('summary', {}, ['Text that was read']), el('pre', { class: 'ocr-raw' }, [read.text])]);
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
    if (read.twoCards) {
      status.append(el('p', { class: 'note warn' }, [
        'This looks like two riven cards side by side, and their lines get mixed up. Crop to one card and try again.']));
    }
    if (positives) {
      status.append(el('p', { class: 'note' }, [`The riven's name confirms the positives: ${positives.map(id => STAT_BY_ID[id].name).join(', ')}.`]));
    }
    const locked = rows.filter(r => r.locked);
    if (locked.length) status.append(el('p', { class: 'note' }, [`Locked: ${locked.map(r => STAT_BY_ID[r.statId].name).join(', ')}.`]));
    if (read.notes.length) status.append(el('p', { class: 'note' }, [`Fixed using the name and the stat ranges: ${read.notes.join('; ')}.`]));
    if (issues.length) status.append(el('p', { class: 'note warn' }, [`Couldn't read ${issues.join(', ')}.`]));
    status.append(raw);
    offerShare({
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
