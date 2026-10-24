// @ts-check
// Turns OCR text from a riven screenshot into a weapon, rank and stat rows. Pure functions, no
// DOM, so it can be tested in Node; src/ui/ocr.js does the image side.
//
// A riven card reads, top to bottom: drain (e.g. "18", which is 10 + rank), the riven's name
// ("Soma Visitio": weapon name + stat prefix/suffix), then one stat per line ("+267.2% Damage"),
// long names sometimes wrapping onto a second line, then "MR 13".

import { CLASSES, MAX_RANK, STATS, STAT_BY_ID } from './data/stats.js';
import { fittingShapes } from './engine.js';
import { WEAPONS } from './data/weapons.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */

/** Lowercase letters only, so OCR noise in spacing, icons and punctuation doesn't matter. */
const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z]/g, '');

// Names as the game shows them, including melee names and wordings that differ from ours.
const ALIASES = /** @type {[string, string][]} */ ([
  ['Weak Point Damage', 'weakpointDamage'],
  ['Weak Point Critical Chance', 'weakpointCrit'],
  ['Magazine Reloaded/s when Holstered', 'reloadWhileHolstered'],
  ['Heavy Attack Damage', 'meleeDamageOnHeavy'],
  ['Slam Damage', 'slamDamage'],
  ['Chance to gain extra Combo Count', 'additionalCombo'],
]);
const NAMES = [
  ...STATS.flatMap(s => [[s.name, s.id], ...(s.meleeName ? [[s.meleeName, s.id]] : [])]),
  ...ALIASES,
].map(([name, id]) => ({ key: norm(name), id }));

/** Edit distance, for matching misread stat names. @param {string} a @param {string} b */
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The stat a (possibly misread) name refers to, or null. Text in brackets, like
 * "(x2 for Bows)", is dropped first.
 * @param {string} text @returns {string | null}
 */
export function matchStat(text) {
  const clean = text.replace(/\(.*?(\)|$)/g, '');
  // OCR often glues an icon onto the name ("MW Heat", "Mlmpact"): also try without the first
  // word, and without the first letter.
  const words = clean.trim().split(/\s+/);
  const tries = [clean, words.slice(1).join(' '), clean.trim().slice(1)];
  let best = null, bestScore = Infinity;
  for (const t of tries) {
    const r = bestMatch(norm(t));
    if (r && r.score < bestScore) ({ id: best, score: bestScore } = r);
  }
  return bestScore <= 0.25 ? best : null;
}

/** @param {string} key normalised text @returns {{id: string, score: number} | null} */
function bestMatch(key) {
  if (key.length < 3) return null;
  let best = null, bestScore = Infinity;
  for (const n of NAMES) {
    // Allow trailing junk (icons, stray characters) by also comparing against the same-length prefix.
    const d = Math.min(distance(key, n.key), distance(key.slice(0, n.key.length), n.key) + 1);
    const score = d / n.key.length;
    if (score < bestScore) { best = n.id; bestScore = score; }
  }
  return best === null ? null : { id: best, score: bestScore };
}

/**
 * A stat line has a value then a name: "+267.2%", "-31.7%", "x0.58", "+10.8s", "+2.6m", "+32.8".
 * OCR often puts a few stray characters before the value (from the artwork or a lock icon), so
 * the value may start after up to 5 junk characters.
 */
const VALUE_LINE = /^.{0,5}?([+\-−–—‒x×]\s*\d+(?:[.,]\d+)?)\s*(%|s|m)?\s*(.*)$/i;

/** A percentage stat whose sign was lost (e.g. "102.7% Finisher Damage", or a lock icon read as digits). */
const UNSIGNED_LINE = /^.{0,5}?(\d+(?:[.,]\d+)?)\s*%\s*([a-z].*)$/i;

/** Common OCR slips inside numbers: "XO. 58" → "X0.58". @param {string} l */
const fixDigits = l => l.replace(/([x×+\-−–—‒])\s*[oO](?=\s*[.,\d])/gi, '$10').replace(/(\d)\s*([.,])\s*(\d)/g, '$1$2$3');

/**
 * The weapon named at the start of the riven's title, longest match first ("Vinquibus (melee)"
 * before "Vinquibus"). @param {string[]} lines
 */
function findWeapon(lines) {
  const byLength = [...WEAPONS].sort((a, b) => b[0].length - a[0].length);
  for (const line of lines) {
    // Try the line as read, and without stray 1–2 character tokens OCR puts before the name.
    // (Spaces don't matter either way: "L acera" still normalises to "lacera".)
    const forms = [norm(line), norm(line.replace(/^(\S{1,2}\s+)+/, ''))].filter(l => l.length >= 3);
    const w = byLength.find(([name]) => forms.some(l => l.startsWith(norm(name))));
    if (w) return { name: w[0], cls: w[1] };
  }
  return null;
}

/**
 * @typedef {object} OcrRiven
 * @property {{name: string, cls: WeaponClass} | null} weapon
 * @property {number | null} rank      from the drain number (10 + rank), when it was read
 * @property {{statId: string | null, value: string, magnitude?: string, text: string}[]} stats
 *   statId null = unrecognised; value "" with a magnitude = the number was read but not its sign
 * @property {string[]} header   lines above the first stat (the riven's name is at the end)
 */

/** @param {string} text OCR output @returns {OcrRiven} */
export function parseRivenText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const firstStat = lines.findIndex(l => VALUE_LINE.test(l) && /[a-z]{3}/i.test(l));
  const header = firstStat < 0 ? lines : lines.slice(0, firstStat);

  // Drain sits above the name: a lone number from 10 to 18 (rank 0 to 8).
  let rank = null;
  for (const l of header) {
    const m = l.match(/^\D{0,3}(1\d)\D{0,3}$/);
    if (m && Number(m[1]) <= 18) { rank = Number(m[1]) - 10; break; }
  }

  /** @type {OcrRiven['stats']} */
  const stats = [];
  if (firstStat >= 0) {
    for (const raw of lines.slice(firstStat)) {
      if (/^[\W_]*MR\s*\d/i.test(raw)) break;
      const l = fixDigits(raw);
      const m = l.match(VALUE_LINE);
      const unsigned = !m && l.match(UNSIGNED_LINE);
      if (m && /[a-z]{2}/i.test(m[3])) {
        m[3] = m[3].replace(/[\W_]*MR\s*\d+.*$/i, '');        // the MR line merged onto the last stat
        const value = m[1].replace(/\s/g, '').replace(/[−–—‒]/, '-').replace(/^[x×]/i, 'x').replace(',', '.');
        stats.push({ statId: null, value, text: m[3] });
      } else if (unsigned) {
        // Its own stat, but with the value left blank: the sign can't be trusted.
        stats.push({ statId: null, value: '', magnitude: unsigned[1].replace(',', '.'), text: unsigned[2] });
      } else if (stats.length) {
        stats[stats.length - 1].text += ' ' + l;             // a wrapped stat name
      }
    }
  }
  for (const s of stats) s.statId = matchStat(s.text);

  return { weapon: findWeapon(header.length ? header : lines), rank, stats: stats.slice(0, 4), header };
}

/**
 * The ranks (0–8) at which every read value is possible. Rank 8 values are 9x rank 0 values, but
 * neighbouring ranks overlap (a strong rank-7 roll can look like a weak rank-8 one), so this can
 * return several.
 * @param {{statId: string | null, value: string}[]} stats @param {WeaponClass} cls
 * @returns {number[]}
 */
export function possibleRanks(stats, cls) {
  const known = stats.filter(s => s.statId && /^[+-]?\d/.test(s.value))
    .map(s => ({ stat: STAT_BY_ID[/** @type {string} */ (s.statId)], shown: Number(s.value) }))
    .filter(s => s.stat.b[cls] !== undefined);
  if (!known.length) return [];
  const blanks = stats.length - known.length;            // unread values still take a slot
  const fits = [];
  for (let rank = 0; rank <= MAX_RANK; rank++) {
    if (fittingShapes(known, blanks, cls, rank).length) fits.push(rank);
  }
  return fits;
}

/**
 * The rank to use: the drain number if it was read and the values allow it; otherwise the only
 * rank the values allow; otherwise rank 8, then 0 (screenshots are nearly always of a maxed or
 * unranked riven). Null when nothing fits.
 * @param {{statId: string | null, value: string}[]} stats @param {WeaponClass} cls
 * @param {number | null} [drainRank]
 */
export function inferRank(stats, cls, drainRank = null) {
  const fits = possibleRanks(stats, cls);
  if (drainRank !== null && fits.includes(drainRank)) return drainRank;
  if (fits.length === 1) return fits[0];
  if (fits.includes(MAX_RANK)) return MAX_RANK;
  if (fits.includes(0)) return 0;
  return fits[0] ?? null;
}

/**
 * Without a weapon name, the weapon class the stats point to: one that can roll every recognised
 * stat and at whose ranges the values actually fit (e.g. +99.4% Multishot fits a shotgun +++-
 * riven but no rifle one). Falls back to the first class that can roll them all, then rifle.
 * @param {(string | null)[] | {statId: string | null, value: string}[]} stats
 * @returns {WeaponClass}
 */
export function guessClass(stats) {
  const rows = stats.map(s => (typeof s === 'object' && s !== null ? s : { statId: s, value: '' }));
  const ids = rows.map(r => r.statId).filter(Boolean);
  const rollable = CLASSES.filter(c => ids.every(id => STAT_BY_ID[/** @type {string} */ (id)].b[c] !== undefined));
  const withValues = rows.filter(r => r.statId && /^[+\-x]?\d/i.test(r.value));
  if (withValues.length) {
    const fits = rollable.find(c => possibleRanks(/** @type {any} */ (rows.filter(r => r.statId)), c).length > 0);
    if (fits) return fits;
  }
  return rollable[0] ?? 'rifle';
}
