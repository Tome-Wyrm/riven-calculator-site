// @ts-check
// Screenshot → riven stats. Drop, paste (Ctrl+V) or choose an image of a riven card; it's read
// with Tesseract.js in the browser and the result fills the grader for checking. Tesseract is
// loaded from a CDN only when someone first uses this, so the rest of the site stays
// dependency-free. The image never leaves the browser (only Tesseract's code and language data
// are downloaded).

import { guessClass, inferRank, parseRivenText } from '../ocr-parse.js';
import { STAT_BY_ID } from '../data/stats.js';
import { el } from './dom.js';
import { loadIntoGrader } from './grader.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

/** @type {Promise<any> | null} */
let workerPromise = null;

/** Loads Tesseract.js once, and creates one English worker reused for every image. */
function getWorker() {
  workerPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = async () => {
      const worker = await /** @type {any} */ (window).Tesseract.createWorker('eng');
      // Sparse-text mode: the card is short lines scattered over artwork, not a paragraph.
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      resolve(worker);
    };
    s.onerror = () => { workerPromise = null; reject(new Error('Could not load the text recognition library (offline?).')); };
    document.head.append(s);
  });
  return workerPromise;
}

/**
 * Riven text is pale lavender on a dark purple card. Scale up and invert to greyscale dark text on
 * light. (A hard black/white threshold was tried and lost decimal points; Tesseract's own
 * binarisation does better on the inverted greyscale.)
 * @param {Blob} blob @returns {Promise<HTMLCanvasElement>}
 */
async function prepare(blob) {
  const img = await createImageBitmap(blob);
  const scale = Math.max(1, Math.min(4, 2400 / img.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true }));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = 255 - lum;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** @type {HTMLElement} */
let status;

/** @param {(Node | string)[]} kids @param {string} [cls] */
const say = (kids, cls = 'note') => status.replaceChildren(el('p', { class: cls }, kids));

/** @param {Blob} blob */
async function readScreenshot(blob) {
  say(['Reading the screenshot… (the first time also downloads the text recogniser, a few MB)']);
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(await prepare(blob));
    const parsed = parseRivenText(data.text);
    // A faction stat needs its multiplier ("x1.06"); the companion app shows "+0" instead.
    const noMultiplier = parsed.stats.filter(s => s.statId && STAT_BY_ID[s.statId].unit === 'mult' && !/^x/i.test(s.value));
    // It stays in with no value, so the riven's shape still counts it.
    const rows = parsed.stats.filter(s => s.statId)
      .map(s => ({ statId: /** @type {string} */ (s.statId), value: noMultiplier.includes(s) ? '' : s.value }));
    const raw = el('details', {}, [el('summary', {}, ['Text that was read']), el('pre', { class: 'ocr-raw' }, [data.text])]);
    if (!rows.length) {
      say(['No riven stats found in that image. Try a tighter crop around the riven card.'], 'note warn');
      status.append(raw);
      return;
    }
    // The drain number is small and next to an icon, so it's often missed or misread. The values
    // themselves pin the rank (rank 8 values are 9x rank 0), and win if the two disagree.
    const cls = parsed.weapon?.cls ?? guessClass(rows.map(r => r.statId));
    const rank = inferRank(rows, cls, parsed.rank) ?? parsed.rank;
    loadIntoGrader({ weapon: parsed.weapon?.name ?? '', cls, rank: rank ?? 8, rows });
    const issues = [
      ...(parsed.weapon ? [] : ['the weapon (pick it above)']),
      ...(rank === null ? ['the rank (assumed 8)'] : []),
      ...parsed.stats.filter(s => !s.statId).map(s => `the stat "${s.value} ${s.text}"`),
      ...noMultiplier.map(s => `${STAT_BY_ID[/** @type {string} */ (s.statId)].name}, which shows "${s.value}" instead of a multiplier `
        + '(the companion app does this; type its x value from the game into that row)'),
    ];
    const found = rows.map(r => `${r.value} ${STAT_BY_ID[r.statId].name}`).join(', ');
    say([`Read ${parsed.weapon?.name ?? 'a riven'}${rank === null ? '' : `, rank ${rank}`}: ${found}. Check the values above.`],
      issues.length ? 'note warn' : 'note');
    if (issues.length) status.append(el('p', { class: 'note warn' }, [`Couldn't read ${issues.join(', ')}.`]));
    status.append(raw);
  } catch (e) {
    say([e instanceof Error ? e.message : String(e)], 'note warn');
  }
}

/** @param {DataTransfer | null} dt */
const imageFrom = dt => [...(dt?.files ?? [])].find(f => f.type.startsWith('image/'));

/** @param {HTMLElement} container */
export function mountOcr(container) {
  const file = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept: 'image/*', 'aria-label': 'Riven screenshot' }));
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) readScreenshot(f); });
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
    if (f) readScreenshot(f);
  });
  // Paste anywhere on the page, unless the cursor is in a text box.
  document.addEventListener('paste', e => {
    const t = /** @type {HTMLElement | null} */ (e.target);
    if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
    const f = imageFrom(e.clipboardData);
    if (f) { e.preventDefault(); readScreenshot(f); }
  });
  status = el('div', { 'aria-live': 'polite' });
  container.replaceChildren(zone, status);
}
