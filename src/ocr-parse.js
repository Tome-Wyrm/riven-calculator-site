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
  if (bestScore <= 0.25) return best;
  return byFirstWord(clean);
}

/**
 * Last resort: a clean first word and a garbled rest ("Magazine Slllsli"). Among stats whose name
 * starts with that word, the one whose name length is closest to what was read.
 * @param {string} text @returns {string | null}
 */
function byFirstWord(text) {
  const words = text.trim().split(/\s+/).map(norm);
  const first = words.find(w => w.length >= 5);
  if (!first) return null;
  const from = norm(text.slice(text.toLowerCase().indexOf(first.slice(0, 3))));
  const fits = NAMES.filter(n => n.key.startsWith(first));
  if (!fits.length) return null;
  fits.sort((a, b) => Math.abs(a.key.length - from.length) - Math.abs(b.key.length - from.length));
  return fits[0].id;
}

/** @param {string} key normalised text @returns {{id: string, score: number} | null} */
function bestMatch(key) {
  if (key.length < 3) return null;
  let best = null, bestScore = Infinity;
  for (const n of NAMES) {
    // Allow trailing junk (icons, stray characters) by also comparing against the same-length prefix.
    const d = Math.min(distance(key, n.key), distance(key.slice(0, n.key.length), n.key) + 0.5);
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

/**
 * A locked stat has a padlock before its value, which OCR reads as a "0", "O" or "8" just before
 * the sign: "0 +103.6% Status Damage", "8+71.8% Ammo", "vs 8 -50.1%". (Sometimes as digits glued
 * to the value, "214109.7%", which can't be told from a misread value: those aren't marked.)
 * Tested on the junk read before a stat's value.
 */
const LOCKED = /(^|\s)[0Oo8]\s*$/;

/** A value alone on its line ("+84.3"), its name on the next ("% Electricity"). */
const BARE_VALUE = /^(?:.{0,5}?[+\-−–—‒x×]\s*\d+(?:[.,]\d+)?\s*%?|\d+(?:[.,]\d+)?\s*%)$/;   // unsigned: nothing else on the line

/** The cycle counter in the bottom bar ("↻ 34" read as "O 34", "010", "O95"): the stats are over. */
const CYCLES = /^[O0©@]\s*\d{1,3}(?:\D|$)/;

/**
 * Whether a line that looks like "value + words" is a stat. Junk from the title or artwork can
 * look like one ("Efv-5 Jupiter Geli-", "Geli-1gnitox", "-3 : Kuva Bramma"): a stat has a "%", a
 * decimal value, or a name we recognise (the name may wrap onto the next line). @param {string} l
 */
function isStatLine(l) {
  const m = fixDigits(l).match(VALUE_LINE);
  return !!m && /[a-z]{2}/i.test(m[3]) && (/%/.test(l) || /\d[.,]\d/.test(m[1]) || matchStat(m[3]) !== null);
}

/** A percentage stat whose sign was lost (e.g. "102.7% Finisher Damage", or a lock icon read as digits). */
const UNSIGNED_LINE = /^.{0,5}?(\d+(?:[.,]\d+)?)\s*%\s*([a-z].*)$/i;

/** Common OCR slips inside numbers: "XO. 58" → "X0.58", "+99 4%" → "+99.4%". @param {string} l */
const fixDigits = l => l.replace(/(\d) (\d)\s*%/, '$1.$2%').replace(/([x×+\-−–—‒])\s*[oO](?=\s*[.,\d])/gi, '$10').replace(/(\d)\s*([.,])\s*(\d)/g, '$1$2$3');

const byLength = [...WEAPONS].sort((a, b) => b[0].length - a[0].length);

/**
 * The weapon named at the start of the riven's title, longest match first ("Vinquibus (melee)"
 * before "Vinquibus"). Failing an exact match, the closest name to the start of a line (lines
 * joined, as long titles wrap: "Phant" / "Asma"), allowing about one misread letter in three
 * ("Phiitaem" → Phantasma), among weapons whose class the read values fit.
 * @param {string[]} lines @param {{statId: string | null, value: string}[]} stats
 */
function findWeapon(lines, stats) {
  // The title is just above the stats, so look from the bottom up: words in the artwork ("SEER")
  // come earlier.
  const exact = findWeaponExact([...lines].reverse()) ?? findWeaponExact([lines.join('')]);
  if (exact) return exact;
  // Stray short tokens are dropped from the start of the line the name starts on, but not from
  // the lines after it: there a short token may be the end of the name ("Phiitaem" / "a Parci-").
  const fitting = CLASSES.filter(c => possibleRanks(stats, c).length);
  let best = null, bestScore = Infinity;
  for (let i = lines.length - 1; i >= 0; i--) {
    const first = norm(lines[i].replace(/^(\S{1,2}\s+)+/, ''));
    if (first.length < 3) continue;
    const text = first + lines.slice(i + 1).map(norm).join('');
    for (const [name, cls] of byLength) {
      const key = norm(name);
      // Short names would match any word with one slip ("acritor" → Acrid): exact matches only.
      if (key.length < 6 || (fitting.length && !fitting.includes(cls))) continue;
      // The read may be a letter or two shorter or longer than the name.
      const score = Math.min(...[-2, -1, 0, 1, 2].map(d => distance(text.slice(0, key.length + d), key))) / key.length;
      // About one slip in three letters for long names, one in four for short ones ("titron" ≠ Detron).
      if (score <= (key.length >= 8 ? 0.34 : 0.25) && score < bestScore) { best = { name, cls }; bestScore = score; }
    }
  }
  return best;
}

/** @param {string[]} lines */
function findWeaponExact(lines) {
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
 * @property {{statId: string | null, value: string, magnitude?: string, text: string, locked?: boolean}[]} stats
 *   statId null = unrecognised; value "" with a magnitude = the number was read but not its sign
 * @property {string[]} header   lines above the first stat (the riven's name is at the end)
 * @property {boolean} twoCards  two riven titles were read: OCR mixes two cards' lines, so the
 *   stats can't be trusted
 */

/** @param {string} text OCR output @returns {OcrRiven} */
export function parseRivenText(text) {
  const lines = [];
  for (const l of text.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
    if (lines.length && BARE_VALUE.test(lines[lines.length - 1]) && !/^MR\s*\d/i.test(l)) lines[lines.length - 1] += ' ' + l;
    else lines.push(l);
  }
  const firstStat = lines.findIndex(l => /[a-z]{3}/i.test(l) && isStatLine(l));
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
      if (/^.{0,3}?MR\s*\d/i.test(raw)) break;                // the "MR 12" bar ends the stats
      // So does the cycle counter, once a riven's 4 stats are in; before that it's skipped (on wide
      // screenshots OCR can read it before the last stat).
      if (CYCLES.test(raw)) { if (stats.length >= 4) break; continue; }
      const l = fixDigits(raw);
      if (l.startsWith('(') && stats.length) {               // "(x2 for Heavy Attacks)" belongs to the line above
        stats[stats.length - 1].text += ' ' + l;
        continue;
      }
      const m = l.match(VALUE_LINE);
      const unsigned = !m && l.match(UNSIGNED_LINE);
      if (m && /[a-z]{2}/i.test(m[3]) && !isStatLine(raw)) continue;   // junk shaped like a stat
      if (m && /[a-z]{2}/i.test(m[3])) {
        m[3] = m[3].replace(/[\W_]*MR\s*\d+.*$/i, '');        // the MR line merged onto the last stat
        let value = m[1].replace(/\s/g, '').replace(/[−–—‒]/, '-').replace(/^[x×]/i, 'x').replace(',', '.');
        // The game shows 1 decimal (2 for multipliers): more means a "%" read as a digit ("+88.79").
        if (!value.startsWith('x')) value = value.replace(/(\.\d)\d+$/, '$1');
        const junk = l.slice(0, l.indexOf(m[1]));
        stats.push({ statId: null, value, text: m[3], ...(LOCKED.test(junk) ? { locked: true } : {}) });
      } else if (unsigned) {
        // Its own stat, but with the value left blank: the sign can't be trusted.
        stats.push({ statId: null, value: '', magnitude: unsigned[1].replace(',', '.'), text: unsigned[2] });
      } else if (stats.length) {
        stats[stats.length - 1].text += ' ' + l;             // a wrapped stat name
      }
    }
  }
  for (const s of stats) s.statId = matchStat(s.text);

  // Two cards side by side (a transmute or compare screen): two lines start with a weapon name.
  const titles = new Set((header.length ? header : lines).filter(l => {
    const t = l.replace(/^(\S{1,2}\s+)+/, '').toLowerCase();
    // A title is the weapon's name then the riven's own name ("Magnus Ampilis", "Mausolon 227?").
    return WEAPONS.some(([n]) => t.startsWith(n.toLowerCase()) && /^[\s-]+\S{2}/.test(t.slice(n.length)));
  }).map(l => norm(l.replace(/^(\S{1,2}\s+)+/, ''))));        // the same title read twice is one card
  const twoCards = titles.size >= 2 || new Set(stats.map(s => s.statId).filter(Boolean)).size < stats.filter(s => s.statId).length;
  return { weapon: findWeapon(header.length ? header : lines, stats.slice(0, 4)), rank, stats: stats.slice(0, 4), header, twoCards };
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
