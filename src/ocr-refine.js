// @ts-check
// Second pass over OCR results, using what a riven card must contain:
//   1. The riven's name encodes its positive stats: one prefix per positive except the last,
//      which contributes prefix + suffix ("Visi" + "tio" = Damage, Electricity;
//      "Toxi-vexi" + "pha" = Toxin, Electricity, Heat). The curse is never in the name. So the
//      name says which stats are positive, which one is the negative, and what a garbled stat
//      name should have been.
//   2. Every value must be possible for its stat, shape and rank. A value that isn't is usually a
//      misread digit, a lost decimal point or a stray leading digit, so try those corrections
//      and keep the one that fits.

import { MAX_RANK, STATS, STAT_BY_ID } from './data/stats.js';
import { gradeRoll, inferSign, shapeFor } from './engine.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('./data/stats.js').Shape} Shape */

const lower = (/** @type {string} */ s) => s.toLowerCase();
const PREFIXES = STATS.filter(s => s.prefix).map(s => ({ id: s.id, text: lower(/** @type {string} */ (s.prefix)) }));
const SUFFIXES = STATS.filter(s => s.suffix).map(s => ({ id: s.id, text: lower(/** @type {string} */ (s.suffix)) }));

/**
 * The positive stats a riven name spells, e.g. "Toxi-vexipha" → [toxin, electricity, heat].
 * Hyphens, spaces and case are ignored (OCR mangles them). Null if it doesn't decode to 2 or 3
 * distinct stats, or decodes more than one way.
 * @param {string} name @param {string[] | null} [present] stats read off the card, to choose between readings
 * @returns {string[] | null}
 */
export function decodeRivenName(name, present = null) {
  const s = lower(name).replace(/[^a-z]/g, '');
  /** @type {string[][]} */
  const found = [];
  // Name = 1 or 2 prefixes, then the suffix of the last positive (2 or 3 stats in all).
  /** @param {number} at @param {string[]} ids prefixes read so far */
  const walk = (at, ids) => {
    if (ids.length >= 1) {
      for (const x of SUFFIXES) if (s.slice(at) === x.text && !ids.includes(x.id)) found.push([...ids, x.id]);
    }
    if (ids.length === 2) return;
    for (const p of PREFIXES) {
      if (s.startsWith(p.text, at) && !ids.includes(p.id)) walk(at + p.text.length, [...ids, p.id]);
    }
  };
  walk(0, []);
  // Some prefixes are shared ("Laci": Additional Combo Count Chance and Parry Angle); the stats
  // read off the card pick between the readings.
  const fits = present ? found.filter(f => f.every(id => present.includes(id))) : found;
  const options = fits.length ? fits : found;
  const keys = [...new Set(options.map(f => [...f].sort().join()))];
  return keys.length === 1 ? options[0] : null;
}

/**
 * Looks for a riven name at the end of the card's header text (the title can wrap, and OCR may
 * split it or add junk): tries the last 3, 2, then 1 words, longest first.
 * @param {string[]} headerLines @param {string[] | null} [present] stats read off the card
 * @returns {string[] | null}
 */
export function findPositivesInHeader(headerLines, present = null) {
  const words = headerLines.join(' ').split(/[\s\-–—]+/).map(w => w.replace(/[^a-z]/gi, '')).filter(w => w.length >= 2);
  for (let k = 3; k >= 1; k--) {
    if (words.length < k) continue;
    const ids = decodeRivenName(words.slice(-k).join(''), present);
    if (ids) return ids;
  }
  return null;
}

// Characters OCR commonly confuses with each other in this font.
const LOOKALIKES = /** @type {Record<string, string>} */ ({
  0: '869', 1: '74', 2: '7', 3: '8', 4: '1', 5: '6', 6: '58', 7: '12', 8: '0365', 9: '0',
});

/**
 * Plausible readings of a misread number, fewest changes first: one look-alike digit swapped,
 * leading junk digits dropped (a lock icon read as "214"), or a lost decimal point restored.
 * @param {string} digits e.g. "214109.7" @returns {{text: string, edits: number}[]}
 */
export function numberVariants(digits) {
  const out = new Map([[digits, 0]]);
  const add = (/** @type {string} */ t, /** @type {number} */ e) => {
    if (/^\d+(\.\d+)?$/.test(t) && !(out.get(t) <= e)) out.set(t, e);
  };
  for (let i = 0; i < digits.length; i++) {
    for (const c of LOOKALIKES[digits[i]] ?? '') add(digits.slice(0, i) + c + digits.slice(i + 1), 1);
  }
  for (let drop = 1; drop <= 3 && digits.indexOf('.') - drop >= 1; drop++) add(digits.slice(drop), drop);
  if (!digits.includes('.') && digits.length >= 2) add(`${digits.slice(0, -1)}.${digits.slice(-1)}`, 1);
  return [...out].map(([text, edits]) => ({ text, edits })).sort((a, b) => a.edits - b.edits);
}

/**
 * @typedef {object} RefinedStat
 * @property {string} statId
 * @property {string} value      "" when it still couldn't be read
 * @property {string} [note]     what was corrected, if anything
 */

/**
 * Applies the name and range checks to parsed OCR stats.
 * @param {{statId: string | null, value: string, magnitude?: string, text: string}[]} stats
 * @param {WeaponClass} cls
 * @param {string[] | null} positives  from the riven's name, if it decoded
 * @param {number | null} drainRank
 * @returns {{stats: RefinedStat[], rank: number | null, notes: string[]}}
 */
export function refineStats(stats, cls, positives, drainRank) {
  const notes = [];
  const rows = stats.map(s => ({ ...s, note: /** @type {string | undefined} */ (undefined) }));

  if (positives) {
    // A garbled stat name: if exactly one positive from the name is unaccounted for, that's it.
    const missing = positives.filter(id => !rows.some(r => r.statId === id));
    const unknown = rows.filter(r => !r.statId);
    if (missing.length === 1 && unknown.length === 1) {
      unknown[0].statId = missing[0];
      unknown[0].note = `stat name from the riven's name`;
    }
    // Signs: in the name means positive; the one stat not in it is the negative.
    for (const r of rows) {
      if (!r.statId) continue;
      const stat = STAT_BY_ID[r.statId];
      const shouldBePositive = positives.includes(r.statId);
      const raw = r.value || (r.magnitude ? `+${r.magnitude}` : '');
      if (!raw || stat.unit === 'mult') continue;
      const n = Number(raw.replace(/^x/i, ''));
      const isPositive = inferSign(stat, cls, n) === '+';
      if (isPositive !== shouldBePositive) {
        // Flip the shown sign (recoil's display sign is reversed, which inferSign accounts for).
        const flipped = raw.startsWith('-') ? `+${raw.slice(1)}` : `-${raw.replace(/^\+/, '')}`;
        r.note = r.value ? 'sign corrected from the riven\'s name' : 'sign from the riven\'s name';
        r.value = flipped;
      } else if (!r.value) {
        r.value = raw;
        r.note = 'sign from the riven\'s name';
      }
    }
  }

  const known = rows.filter(r => r.statId);
  const shape = positives
    ? shapeFor(positives.length, known.length - positives.length)
    : null;

  // Rank: the one where the most values fit as read (ties: the drain number, then 8, then 0).
  // Corrections are only tried at that rank, so a single odd value (or an old riven from before
  // dispositions were removed) can't drag the rank somewhere else.
  const order = [...new Set([drainRank, MAX_RANK, 0, 1, 2, 3, 4, 5, 6, 7].filter(r => r !== null))];
  let best = null;
  for (const rank of /** @type {number[]} */ (order)) {
    const attempt = tryRank(known, cls, shape, rank);
    if (attempt && (!best || attempt.asRead > best.asRead || (attempt.asRead === best.asRead && attempt.edits < best.edits))) {
      best = { ...attempt, rank };
    }
  }
  // An old riven (rolled before dispositions were removed) fits no rank well; then the drain
  // number, if it was read, is the better guide than the rank where a few values happen to fit.
  const valued = known.filter(r => r.value).length;
  if (best && drainRank !== null && best.rank !== drainRank && best.asRead < valued) {
    const atDrain = tryRank(known, cls, shape, drainRank);
    if (atDrain) best = { ...atDrain, rank: drainRank };
  }
  // Corrections lean on the other values fitting: on an old riven where most don't, a "fix" would
  // just be a guess (x0.65 → x0.55), so out-of-range values are only flagged.
  const trustFixes = best && best.asRead >= valued / 2;
  if (best) {
    for (const [r, fixed, options] of best.fixes) {
      if (options?.length) r.note = `"${r.value}" can't be right; it's probably ${options.join(' or ')}, so check it`;
      else if (options) r.note = `"${r.value}" is outside today's range (an old riven, or a misread)`;
      else if (fixed !== r.value && !trustFixes) r.note = `"${r.value || r.magnitude}" is outside today's range (an old riven, or a misread)`;
      else if (fixed !== r.value) { r.note = `read as ${r.value || r.magnitude}, corrected to fit the range`; r.value = fixed; }
    }
    notes.push(...known.filter(r => r.note).map(r => `${STAT_BY_ID[/** @type {string} */ (r.statId)].name}: ${r.note}`));
  }
  return {
    stats: rows.filter(r => r.statId).map(r => ({
      statId: /** @type {string} */ (r.statId), value: r.value, note: r.note, ...(r.locked ? { locked: true } : {}),
    })),
    rank: best ? best.rank : null,
    notes,
  };
}

/**
 * How many values fit at this rank as read, and the corrections for the rest: a value is
 * corrected only when exactly one fewest-change reading fits; otherwise it's kept as read with
 * the candidate readings (an empty list when nothing fits).
 * @param {any[]} rows @param {WeaponClass} cls @param {Shape | null} shapeHint @param {number} rank
 */
function tryRank(rows, cls, shapeHint, rank) {
  const valued = rows.filter(r => r.value);
  const signOf = (/** @type {any} */ r, /** @type {string} */ v) => inferSign(STAT_BY_ID[r.statId], cls, Number(v.replace(/^x/i, '')));
  const pos = rows.filter(r => r.value && signOf(r, r.value) === '+').length + rows.filter(r => !r.value).length;
  const shape = shapeHint ?? shapeFor(pos, rows.length - pos);
  if (!shape) return null;
  /** @type {[any, string, string[]?][]} [row, value to use, candidates when it can't be settled] */
  const fixes = [];
  let edits = 0, asRead = 0;
  for (const r of valued) {
    const stat = STAT_BY_ID[r.statId];
    if (stat.b[cls] === undefined) return null;
    const m = r.value.match(/^([+\-x]?)(.*)$/i);
    const [prefix, digits] = [m[1], m[2]];
    const fits = numberVariants(digits).filter(v => {
      const n = Number(`${prefix}${v.text}`.replace(/^x/i, ''));
      return gradeRoll(stat, cls, shape, inferSign(stat, cls, n), n, rank).possible;
    });
    if (fits[0]?.edits === 0) { asRead++; fixes.push([r, r.value]); continue; }
    const fewest = fits.filter(v => v.edits === fits[0]?.edits);
    if (fewest.length === 1) { edits += fewest[0].edits; fixes.push([r, `${prefix}${fewest[0].text}`]); }
    else fixes.push([r, r.value, fewest.map(v => `${prefix}${v.text}`)]);
  }
  return { fixes, edits, asRead };
}

/**
 * Whether a decoded name fits the number of stats read: 4 stats is +++- (3 positives), 2 stats is
 * ++ (2), and 3 stats is ++- or +++. A partly hidden name can still decode, to too few positives
 * ("P?ci-toxican" → just "toxican"), so a mismatch means the decode can't be trusted.
 * @param {string[] | null} positives @param {number} statCount
 */
export function nameFitsStats(positives, statCount) {
  if (!positives) return false;
  if (statCount === 4) return positives.length === 3;
  if (statCount === 2) return positives.length === 2;
  return statCount === 3;
}
