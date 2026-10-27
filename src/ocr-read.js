// @ts-check
// Screenshot → riven, with no page around it: text recognition (Tesseract.js, loaded from a CDN
// the first time) and the two parsing passes. Used by the grader's screenshot box (src/ui/ocr.js)
// and by the screenshot check page (test/ocr-check.html). Browser only (canvas, Tesseract).

import { guessClass, inferRank, parseRivenText, ranksFromDrain } from './ocr-parse.js';
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
 * @param {Blob} blob @returns {Promise<{canvas: HTMLCanvasElement, colour: Uint8ClampedArray}>}
 *   colour: the scaled pixels before inverting (for the drain number's colour)
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
  const colour = px.slice();
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = 255 - lum;
  }
  ctx.putImageData(data, 0, 0);
  return { canvas, colour };
}

/**
 * The drain number (top right of the card) and its colour, from Tesseract's word boxes: a number
 * from 5 to 23 alone on its line, in the top half of the image. Numbers read off the artwork
 * ("5X") lose to one that's a possible drain in its colour, then to the highest one.
 * @param {any} data Tesseract's result @param {Uint8ClampedArray} px @param {number} w @param {number} h
 * @returns {{n: number, colour: 'white' | 'red' | 'green'} | null}
 */
function findDrain(data, px, w, h) {
  /** @type {{n: number, colour: 'white' | 'red' | 'green', y: number}[]} */
  const found = [];
  const lines = (data.blocks ?? []).flatMap((/** @type {any} */ b) => b.paragraphs.flatMap((/** @type {any} */ p) => p.lines));
  for (const line of lines) {
    if (line.words.length > 2 || line.bbox.y1 > h / 2) continue;
    for (const word of line.words) {
      // (The polarity icon after it can read as one more digit: "239".)
      const m = word.text.match(/^\D{0,3}(\d{1,2})\d?\D{0,3}$/);
      if (!m || Number(m[1]) < 5 || Number(m[1]) > 23) continue;
      // Count the bright pixels in its box that are clearly red or green; riven text is lavender.
      let bright = 0, red = 0, green = 0;
      const { x0, y0, x1, y1 } = word.bbox;
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
          const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
          if (Math.max(r, g, b) < 140) continue;
          bright++;
          if (r > 1.6 * g && r > 1.4 * b) red++;
          else if (g > 1.3 * r && g > 1.1 * b) green++;
        }
      }
      const colour = red > bright * 0.3 ? 'red' : green > bright * 0.3 ? 'green' : 'white';
      found.push({ n: Number(m[1]), colour, y: y0 });
    }
  }
  const valid = (/** @type {typeof found[number]} */ d) => (ranksFromDrain(d.n, d.colour).length ? 0 : 1);
  const best = found.sort((a, b) => valid(a) - valid(b) || a.y - b.y)[0];
  return best ? { n: best.n, colour: best.colour } : null;
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
 * @property {{n: number, colour: 'white' | 'red' | 'green'} | null} drain  the drain number and its colour
 */

/** @param {Blob} blob @returns {Promise<ScreenshotRead>} */
export async function readScreenshot(blob) {
  const worker = await getWorker();
  const { canvas, colour } = await prepare(blob);
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return interpretText(data.text, findDrain(data, colour, canvas.width, canvas.height));
}

/**
 * Everything after text recognition: parse, use the riven's name, check values against the
 * ranges. No DOM, so the tuning harness (tools/ocr-train/harness.mjs) runs it in Node.
 * @param {string} text
 * @param {{n: number, colour: 'white' | 'red' | 'green'} | null} [drain] the drain number and its
 *   colour, when the image was available (without it, a lone 10–18 is read as white)
 * @returns {ScreenshotRead}
 */
export function interpretText(text, drain = null) {
  const data = { text };
  const parsed = parseRivenText(data.text);
  // The drain's colour says how to read it; a green one that fits several ranks leaves it to the values.
  const fromDrain = drain ? ranksFromDrain(drain.n, drain.colour) : [];
  const drainRank = drain ? (fromDrain.length === 1 ? fromDrain[0] : null) : parsed.rank;
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
  const refined = refineStats(stats, cls, positives, drainRank);
  const rows = refined.stats.map(s => ({ statId: s.statId, value: s.value, ...(s.locked ? { locked: true } : {}) }));
  // The drain number is small and next to an icon, so it's often missed or misread; the values
  // pin the rank (rank 8 values are 9x rank 0), and win if the two disagree.
  const rank = rows.length ? refined.rank ?? inferRank(rows, cls, drainRank) ?? drainRank : drainRank;

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
    noMultiplier, twoCards: parsed.twoCards, market: parsed.market, drain,
  };
}
