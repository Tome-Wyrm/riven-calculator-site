// @ts-check
// The community's recommended rolls (src/data/picks.js, from the Rolls & Resources sheet), read out
// of the sheet's shorthand. Pure functions, no DOM.
//
// A sheet row is three positive slots, the negatives and a note. Each cell is a priority list:
// "COR / VIR > CC / FR" means Corrosive or Viral first, then Crit Chance or Fire Rate. A pick can
// carry a note in brackets ("ELEC(infl)" = for Melee Influence builds, "AMMO(inc)" = harmless in
// Incarnon mode, "PUNC(0%)" = the weapon has no Puncture, "IMP(Vandal)" = on the Vandal only) and
// stars pointing at the row's note.

import { STAT_BY_ID, SPLICED } from './data/stats.js';
import { PICKS, PICK_FAMILY } from './data/picks.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */

/**
 * @typedef {object} Pick
 * @property {string} code     the abbreviation as written, e.g. "COR"
 * @property {string | null} stat  stat id; 'any' / 'none' for ANY / NONE, 'bane' for any faction; null if unknown
 * @property {string} note     the bracketed note, e.g. "infl", "0%", "Vandal" ('' for none)
 * @property {string} mark     footnote stars, e.g. "*" ('' for none)
 */

/** A slot: tiers in priority order, each a list of equally good picks. @typedef {Pick[][]} Slot */

/** @typedef {{positives: Slot[], negatives: Slot, notes: string[]}} PickRow */

/** The sheet's abbreviations (its legend, plus a few spellings used in rows). EFF and FR depend on the class. */
const ABBR = {
  MS: 'multishot', DMG: 'damage', CC: 'critChance', CD: 'critDamage', WPC: 'weakpointCrit',
  WPD: 'weakpointDamage', SDMG: 'statusDamage', SC: 'statusChance', SD: 'statusDuration',
  FR: 'fireRate', AS: 'fireRate', RNG: 'range', PT: 'punchThrough', RLS: 'reloadSpeed',
  HDMG: 'meleeDamageOnHeavy', WUP: 'heavyWindup', SLAM: 'slamDamage', IC: 'initialCombo',
  CCC: 'additionalCombo', FIN: 'finisher', SLIDE: 'slideCrit', TOX: 'toxin', ELEC: 'electricity',
  HEAT: 'heat', COLD: 'cold', COR: 'corrosive', VIR: 'viral', VIRAL: 'viral', GAS: 'gas',
  BLAST: 'blast', RAD: 'radiation', MAG: 'magnetic', IMP: 'impact', PUNC: 'puncture', SL: 'slash',
  MC: 'magazine', PFS: 'projectileSpeed', REC: 'recoil', Z: 'zoom', AMMO: 'ammoMax',
  DTG: 'grineer', DTC: 'corpus', DTI: 'infested', BANE: 'bane', PARRY: 'parryAngle',
  RWH: 'reloadWhileHolstered', ANY: 'any', NONE: 'none',
};

/** @param {string} code @param {WeaponClass} cls @returns {string | null} */
function statFor(code, cls) {
  const c = code.toUpperCase();
  if (c === 'EFF') return cls === 'melee' ? 'heavyEfficiency' : 'ammoEfficiency';
  return ABBR[/** @type {keyof typeof ABBR} */ (c)] ?? null;
}

/** Splits on separators outside brackets: "ANY (not AS/CCC) > X" → ["ANY (not AS/CCC)", "X"]. @param {string} s @param {string} seps */
function splitTop(s, seps) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(ch)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

/** One pick: "ELEC(infl)*" → {code: ELEC, note: infl, mark: *}. @param {string} text @param {WeaponClass} cls @returns {Pick} */
function parsePick(text, cls) {
  const m = text.match(/^([A-Za-z]+)\s*(?:\(([^)]*)\)?)?\s*(\**)$/);
  if (!m) return { code: text, stat: null, note: '', mark: '' };
  return { code: m[1].toUpperCase(), stat: statFor(m[1], cls), note: (m[2] ?? '').trim(), mark: m[3] };
}

/**
 * A cell: "CC* > PUNC" → [[CC*], [PUNC]]. Codes run together with a space ("IMP Z") are read as
 * equals, as the sheet means them.
 * @param {string} cell @param {WeaponClass} cls @returns {Slot}
 */
export function parseSlot(cell, cls) {
  return splitTop(cell, '>').map(tier => splitTop(tier, '/,').flatMap(text => {
    const words = text.split(/\s+/);
    if (words.length > 1 && words.every(w => statFor(w.replace(/\*+$/, ''), cls))) return words.map(w => parsePick(w, cls));
    return [parsePick(text, cls)];
  })).filter(tier => tier.length);
}

/**
 * A sheet row as stored: [slot 1, slot 2, slot 3, negatives, note].
 * @param {string[]} cells @param {WeaponClass} cls @returns {PickRow}
 */
export function parseRow(cells, cls) {
  return {
    positives: cells.slice(0, 3).map(c => parseSlot(c, cls)),
    negatives: parseSlot(cells[3] ?? '', cls),
    notes: (cells[4] ?? '').split(/\s+\|\s+/).map(s => s.trim()).filter(Boolean),
  };
}

/** The sheet family for a weapon name (or a family name itself), or undefined if it has no picks. @param {string} weapon */
export function pickFamily(weapon) {
  const family = PICK_FAMILY[weapon] ?? weapon;
  return PICKS[family] ? family : undefined;
}

/** The weapon's recommended rows, best first (the sheet's order). @param {string} weapon @param {WeaponClass} cls @returns {PickRow[]} */
export function picksFor(weapon, cls) {
  const family = pickFamily(weapon);
  return family ? PICKS[family].map(cells => parseRow(cells, cls)) : [];
}

/**
 * Whether a pick applies to this weapon: "IMP(Vandal)" is for the Vandal only, "PUNC(0% Tenet)" for
 * the Tenet. Notes without a capitalised name (infl, inc, 0%) apply to all.
 * @param {Pick} pick @param {string} weapon
 */
export function forWeapon(pick, weapon) {
  const names = (pick.note.match(/\b[A-Z][a-z]+\b/g) ?? []).filter(w => w !== 'Inc');
  return !names.length || !weapon || names.some(n => weapon.includes(n));
}

/** @param {string | null} id */
const isSpliced = id => !!id && !!STAT_BY_ID[id]?.spliced;

/**
 * Stats a weapon's riven can have, for picking: positives (ordinary ones it can roll, spliced ones
 * for its class) and negatives.
 * @typedef {{positive: string[], negative: string[]}} Pool
 */

/**
 * Whether a pick can go on the riven as a positive (or as the negative).
 * @param {Pick} pick @param {Pool} pool @param {WeaponClass} cls @param {boolean} negative
 */
export function plannable(pick, pool, cls, negative) {
  if (!pick.stat) return false;
  if (negative) return pool.negative.includes(pick.stat);
  return pool.positive.includes(pick.stat) || SPLICED.some(s => s.id === pick.stat && s.b[cls] !== undefined);
}

/**
 * The row's top roll: each slot's first pick that fits (rollable on the weapon, for this weapon's
 * variant, not already taken, and at most one spliced stat), and the first such negative. Returns
 * the stat id picked per slot (null where nothing fits, or the slot is ANY / NONE).
 * @param {PickRow} row @param {Pool} pool @param {WeaponClass} cls @param {string} weapon
 * @returns {{positives: (string | null)[], negative: string | null}}
 */
export function topRoll(row, pool, cls, weapon) {
  /** @type {(string | null)[]} */
  const chosen = [];
  for (const slot of row.positives) {
    const pick = slot.flat().find(p => plannable(p, pool, cls, false) && forWeapon(p, weapon)
      && !chosen.includes(p.stat) && !(isSpliced(p.stat) && chosen.some(isSpliced)));
    chosen.push(pick?.stat ?? null);
  }
  const neg = row.negatives.flat().find(p => plannable(p, pool, cls, true) && forWeapon(p, weapon) && !chosen.includes(p.stat));
  return { positives: chosen, negative: neg?.stat ?? null };
}

/**
 * How the community rates a stat on this weapon, for the grader: 'top' if it's a first choice in
 * any slot of any row (or among the first negatives), 'listed' if it's anywhere lower, 'parent' if
 * it isn't listed itself but splices into a listed spliced stat (Cold, for Viral), null otherwise.
 * With the pick (for 'parent', the spliced stat's), for its note.
 * @param {PickRow[]} rows @param {string} statId @param {boolean} negative @param {string} weapon
 * @returns {{fit: 'top' | 'listed' | 'parent', pick: Pick} | null}
 */
export function communityFit(rows, statId, negative, weapon) {
  /** @type {{fit: 'top' | 'listed' | 'parent', pick: Pick} | null} */
  let best = null;
  for (const row of rows) {
    for (const slot of negative ? [row.negatives] : row.positives) {
      slot.forEach((tier, t) => {
        const pick = tier.find(p => p.stat === statId && forWeapon(p, weapon));
        if (pick && (!best || (t === 0 && best.fit !== 'top'))) best = { fit: t === 0 ? 'top' : 'listed', pick };
      });
    }
  }
  if (best) return best;
  // A splice parent (a curse can be one too).
  const parentOf = rows.flatMap(row => row.positives.flat(2))
    .find(p => isSpliced(p.stat) && forWeapon(p, weapon) && STAT_BY_ID[/** @type {string} */ (p.stat)].from?.some(pair => pair.includes(statId)));
  return parentOf ? { fit: 'parent', pick: parentOf } : null;
}

/** A pick's bracketed note in words: "infl" → "for Melee Influence". @param {string} note */
export function noteText(note) {
  return { infl: 'for Melee Influence', inc: 'for Incarnon mode', '0%': 'the weapon has none' }[note.toLowerCase()] ?? note;
}

/**
 * A chosen roll as the build planner's target: up to three ordinary positives, at most one spliced
 * stat, and the negative.
 * @param {(string | null)[]} positives @param {string | null} negative
 * @returns {{positives: string[], spliced: string | null, negative: string | null}}
 */
export function toTarget(positives, negative) {
  const ids = /** @type {string[]} */ (positives.filter(Boolean));
  const spliced = ids.find(isSpliced) ?? null;
  return { positives: ids.filter(id => !isSpliced(id)), spliced, negative };
}
