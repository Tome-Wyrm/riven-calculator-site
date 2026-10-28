// @ts-check
// Screenshot → riven, with no page around it: text recognition (Tesseract.js, loaded from a CDN
// the first time) and the two parsing passes. Used by the grader's screenshot box (src/ui/ocr.js)
// and by the screenshot check page (test/ocr-check.html). Browser only (canvas, Tesseract).

import { guessClass, inferRank, isTitle, parseRivenText, ranksFromDrain } from './ocr-parse.js';
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
 * @param {ImageBitmap} img @returns {{canvas: HTMLCanvasElement, colour: Uint8ClampedArray}}
 *   colour: the scaled pixels before inverting (for the drain number's colour)
 */
function prepare(img, scale = Math.max(1, Math.min(4, 2400 / img.width))) {
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
 * @property {ScreenshotRead[] | null} [cards]  several cards side by side (a cycle, splice or unveil
 *   screen), each read on its own, left to right; null if they couldn't be told apart
 */

/** @param {ImageBitmap} img @param {number} [scale] */
async function readImage(img, scale = undefined) {
  const worker = await getWorker();
  const { canvas, colour } = prepare(img, scale);
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return { read: interpretText(data.text, findDrain(data, colour, canvas.width, canvas.height)), data, scale: canvas.width / img.width };
}

/** A card's "MR 15" bar (OCR can read the M as A, and add a stray word before it: "Wig MR 8"). */
const MR_BAR = /^(\S{1,4}\s+)?\W{0,3}[MA]R\s*\d{1,2}\b/;
/** A stat line: "+64.7% Fire Rate", "x1.59 Damage to Infested". */
const STAT_LINE = /[+\-x×]\s?\d+([.,]\d+)?%?\s*\S*\s*[a-z]{3}/i;
/** A line that's part of a card: its title, a stat value, or its MR bar. */
const cardLine = (/** @type {string} */ t) => isTitle(t) || MR_BAR.test(t) || /[+\-x×]\s?\d/i.test(t);

/**
 * Tesseract's lines, in image pixels.
 * @param {any} data @param {number} scale
 * @returns {{text: string, x0: number, y0: number, x1: number, y1: number}[]}
 */
function linesOf(data, scale) {
  return (data.blocks ?? []).flatMap((/** @type {any} */ b) => b.paragraphs.flatMap((/** @type {any} */ p) => p.lines))
    .map((/** @type {any} */ l) => ({ text: l.text.trim(), x0: l.bbox.x0 / scale, y0: l.bbox.y0 / scale, x1: l.bbox.x1 / scale, y1: l.bbox.y1 / scale }));
}

/**
 * Each card's title or MR bar, as [centre, width] in image pixels, left to right (one per card).
 * Titles and MR bars aren't mixed (the "MR 15" sits left of its card's centre, so the two would
 * count as two cards): whichever finds more cards, titles on a tie.
 * @param {ReturnType<typeof linesOf>} lines @param {number} width
 */
function anchors(lines, width) {
  const centres = (/** @type {(t: string) => boolean} */ test) => lines.filter(l => test(l.text))
    .map(l => /** @type {[number, number]} */ ([(l.x0 + l.x1) / 2, l.x1 - l.x0]))
    .sort((a, b) => a[0] - b[0])
    // A title read twice (or wrapped onto two lines) is one card.
    .filter((c, i, all) => i === 0 || c[0] - all[i - 1][0] > width * 0.05);
  const titles = centres(isTitle), bars = centres(t => MR_BAR.test(t));
  return bars.length > titles.length ? bars : titles;
}

/**
 * Where each card is, as [left, right] in image pixels: one column per anchor, as wide as the
 * gap between neighbouring cards.
 * @param {[number, number][]} found @param {number} width @returns {[number, number][]}
 */
function cardColumns(found, width) {
  const centres = found.map(([c]) => c);
  const gap = Math.min(...centres.slice(1).map((c, i) => c - centres[i]));
  return centres.map(c => /** @type {[number, number]} */ ([Math.max(0, Math.round(c - gap / 2)), Math.min(width, Math.round(c + gap / 2))]));
}

/**
 * Reads part of the image as one card: kept only if it isn't itself several cards and gives at
 * least three stats, or two and a title or MR bar (so a stray block of numbers doesn't count).
 * @param {ImageBitmap} img @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 */
async function readCard(img, x0, y0, x1, y1) {
  [x0, y0, x1, y1] = [Math.max(0, x0), Math.max(0, y0), Math.min(img.width, x1), Math.min(img.height, y1)].map(Math.round);
  if (x1 - x0 < 40 || y1 - y0 < 40) return null;
  const { read, data, scale } = await readImage(await createImageBitmap(img, x0, y0, x1 - x0, y1 - y0));
  const lines = linesOf(data, scale);
  const ok = !read.twoCards && (read.rows.length >= 3 || (read.rows.length >= 2 && lines.some(l => isTitle(l.text) || MR_BAR.test(l.text))));
  return ok ? { x: (x0 + x1) / 2, read, box: textBox(lines.map(l => ({ ...l, x0: l.x0 + x0, x1: l.x1 + x0, y0: l.y0 + y0, y1: l.y1 + y0 }))) } : null;
}

/** The box around a card's own text lines. @param {ReturnType<typeof linesOf>} lines */
function textBox(lines) {
  const own = lines.filter(l => cardLine(l.text));
  if (!own.length) return null;
  return { x0: Math.min(...own.map(l => l.x0)), x1: Math.max(...own.map(l => l.x1)), y0: Math.min(...own.map(l => l.y0)), y1: Math.max(...own.map(l => l.y1)) };
}

/** @typedef {{x0: number, y0: number, x1: number, y1: number}} Box */

/**
 * Where a single card's text sits, in image pixels, for showing it close up: the box around its
 * text lines, and the title's band (the lines just above the first stat, read as a title or not;
 * an estimate a line high when nothing was read there). Null when no card, or several, are found.
 * @param {Blob} blob @returns {Promise<{text: Box, title: Box} | null>}
 */
export async function locateCard(blob) {
  const img = await createImageBitmap(blob);
  const { data, scale } = await readImage(img);
  const lines = linesOf(data, scale);
  const found = anchors(lines, img.width);
  if (found.length >= 2) return null;
  const stats = lines.filter(l => STAT_LINE.test(l.text) && (!found.length || Math.abs((l.x0 + l.x1) / 2 - found[0][0]) < 1.2 * Math.max(found[0][1], 100)));
  const text = textBox(found.length ? lines.filter(l => Math.abs((l.x0 + l.x1) / 2 - found[0][0]) < 1.2 * Math.max(found[0][1], 100)) : stats);
  if (!text || !stats.length) return null;
  const first = stats.reduce((a, l) => (l.y0 < a.y0 ? l : a));
  const h = first.y1 - first.y0;
  const above = lines.filter(l => l.y1 <= first.y0 + h * 0.3 && l.y0 >= first.y0 - 2.6 * h
    && (l.x0 + l.x1) / 2 > text.x0 && (l.x0 + l.x1) / 2 < text.x1);
  const title = above.length
    ? { x0: Math.min(...above.map(l => l.x0)), x1: Math.max(...above.map(l => l.x1)), y0: Math.min(...above.map(l => l.y0)), y1: Math.max(...above.map(l => l.y1)) }
    : { x0: text.x0, x1: text.x1, y0: first.y0 - 1.4 * h, y1: first.y0 };
  return { text: { x0: Math.min(text.x0, title.x0), x1: Math.max(text.x1, title.x1), y0: Math.min(text.y0, title.y0), y1: text.y1 }, title };
}

/**
 * Reads a screenshot. Several cards side by side (a cycle, splice or unveil screen) are each read
 * on their own, so their lines can't mix: found by their titles and MR bars, or, when only one
 * card reads (a cycle screen dims the card that isn't selected), by looking for a card-sized
 * block of text either side of it.
 * @param {Blob} blob @returns {Promise<ScreenshotRead>}
 */
export async function readScreenshot(blob) {
  const img = await createImageBitmap(blob);
  const { read, data, scale } = await readImage(img);
  const lines = linesOf(data, scale);
  const found = anchors(lines, img.width);
  /** @type {{x: number, read: ScreenshotRead, box: ReturnType<typeof textBox>}[]} */
  const cards = [];
  if (found.length >= 2) {
    for (const [x0, x1] of cardColumns(found, img.width)) {
      const card = await readCard(img, x0, 0, x1, img.height);
      if (card) cards.push(card);
    }
  }
  // Only one card read: its own lines are the ones near its title or MR bar.
  const near = (/** @type {[number, number]} */ [c, w]) => textBox(lines.filter(l => Math.abs((l.x0 + l.x1) / 2 - c) < 1.2 * Math.max(w, 100)));
  const one = cards.length === 1 ? cards[0].box : found.length === 1 ? near(found[0])
    // No title or MR bar read at all: the riven's stat lines.
    : found.length === 0 && read.rows.length >= 2 ? textBox(lines.filter(l => STAT_LINE.test(l.text))) : null;
  // On a wide screenshot, look either side of it for another (a cycle screen dims the card that
  // isn't selected, too faintly to read on the whole screen).
  if (one && cards.length <= 1 && img.width > 2.5 * (one.x1 - one.x0)) {
    const w = one.x1 - one.x0, h = one.y1 - one.y0;
    const [top, bottom] = [one.y0 - 0.9 * h, one.y1 + 0.4 * h];
    if (!cards.length) {
      const card = await readCard(img, one.x0 - 0.2 * w, top, one.x1 + 0.2 * w, bottom);
      if (card) cards.push(card);
    }
    for (const [x0, x1] of [[one.x0 - 1.7 * w, one.x0 - 0.05 * w], [one.x1 + 0.05 * w, one.x1 + 1.7 * w]]) {
      const card = await readCard(img, x0, top, x1, bottom);
      if (card) cards.push(card);
    }
  }
  if (cards.length < 2) return read.twoCards ? { ...read, cards: null } : read;
  cards.sort((a, b) => a.x - b.x);
  const reads = cards.map(c => c.read);
  // A card whose title didn't read takes the weapon the other cards agree on (a cycle or splice
  // screen is all one weapon), or failing that the one read off the whole screen; then it's
  // re-read with that name in place, so its class and grades follow.
  const named = [...new Set(reads.map(c => c.weapon?.name).filter(Boolean))];
  const fallback = named.length === 1 ? named[0] : named.length === 0 ? read.weapon?.name : undefined;
  if (fallback) reads.forEach((c, i) => { if (!c.weapon) reads[i] = interpretText(`${fallback}\n${c.text}`, c.drain); });
  return { ...read, cards: reads };
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
