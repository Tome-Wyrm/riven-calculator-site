// @ts-check
// Screenshot → riven, with no page around it: text recognition (Tesseract.js, loaded from a CDN
// the first time) and the two parsing passes. Used by the grader's screenshot box (src/ui/ocr.js)
// and by the screenshot check page (test/ocr-check.html). Browser only (canvas, Tesseract).

import { guessClass, inferRank, parseRivenText } from './ocr-parse.js';
import { findPositivesInHeader, nameFitsStats, refineStats } from './ocr-refine.js';
import { STAT_BY_ID } from './data/stats.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */

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
 *
 * The tuning harness (tools/ocr-train) can't reproduce this resampling exactly; its closest
 * match, src/ocr-prep.js with the Mitchell filter, reads a few screenshots worse (97 of 115
 * against 103), so the site keeps the canvas.
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

/**
 * @typedef {object} ScreenshotRead
 * @property {string} text            what Tesseract read
 * @property {{name: string, cls: WeaponClass} | null} weapon
 * @property {WeaponClass} cls
 * @property {number | null} rank
 * @property {{statId: string, value: string, locked?: boolean}[]} rows
 * @property {string[] | null} positives   from the riven's name, when it fits
 * @property {string[]} notes              what the second pass fixed or flagged
 * @property {string[]} issues             what couldn't be read
 * @property {{statId: string | null, value: string}[]} noMultiplier  faction stats shown as "+0"
 * @property {boolean} twoCards
 * @property {boolean} market   a warframe.market listing, not a game screenshot
 */

/** @param {Blob} blob @returns {Promise<ScreenshotRead>} */
export async function readScreenshot(blob) {
  const worker = await getWorker();
  const { data } = await worker.recognize(await prepare(blob));
  return interpretText(data.text);
}

/**
 * Everything after text recognition: parse, use the riven's name, check values against the
 * ranges. No DOM, so the tuning harness (tools/ocr-train/harness.mjs) runs it in Node.
 * @param {string} text @returns {ScreenshotRead}
 */
export function interpretText(text) {
  const data = { text };
  const parsed = parseRivenText(data.text);
  // A faction stat needs its multiplier ("x1.06"); the companion app shows "+0" instead. It
  // stays in with no value, so the riven's shape still counts it.
  const noMultiplier = parsed.stats.filter(s => s.statId && STAT_BY_ID[s.statId].unit === 'mult' && !/^x/i.test(s.value));
  const stats = parsed.stats.map(s => (noMultiplier.includes(s) ? { ...s, value: '' } : s));

  // Second pass: the riven's name says which stats are positive (and recovers lost signs and
  // garbled names); impossible values are corrected to the reading that fits the range.
  // A partly hidden name can decode to too few positives: only trust it if it fits the stat count.
  const decoded = findPositivesInHeader(parsed.header, stats.map(s => s.statId).filter(Boolean));
  const positives = nameFitsStats(decoded, stats.filter(s => s.statId).length) ? decoded : null;
  const cls = parsed.weapon?.cls ?? guessClass(stats);
  const refined = refineStats(stats, cls, positives, parsed.rank);
  const rows = refined.stats.map(s => ({ statId: s.statId, value: s.value, ...(s.locked ? { locked: true } : {}) }));
  // The drain number is small and next to an icon, so it's often missed or misread; the values
  // pin the rank (rank 8 values are 9x rank 0), and win if the two disagree.
  const rank = rows.length ? refined.rank ?? inferRank(rows, cls, parsed.rank) ?? parsed.rank : parsed.rank;

  const issues = [
    ...(parsed.weapon ? [] : ['the weapon (pick it above)']),
    ...(rank === null ? ['the rank (assumed 8)'] : []),
    // Unrecognised names the riven's name couldn't fill in.
    ...(refined.stats.length < parsed.stats.length
      ? parsed.stats.filter(s => !s.statId).map(s => `the stat "${s.value || s.magnitude} ${s.text}"`)
      : []),
    ...rows.filter(r => r.value === '' && !noMultiplier.some(s => s.statId === r.statId))
      .map(r => `the value of ${STAT_BY_ID[r.statId].name} (type it in)`),
    ...noMultiplier.map(s => `${STAT_BY_ID[/** @type {string} */ (s.statId)].name}, which shows "${s.value}" instead of a multiplier `
      + '(the companion app does this; type its x value from the game into that row)'),
  ];
  return {
    text: data.text, weapon: parsed.weapon, cls, rank, rows, positives, notes: refined.notes, issues,
    noMultiplier, twoCards: parsed.twoCards, market: parsed.market,
  };
}
