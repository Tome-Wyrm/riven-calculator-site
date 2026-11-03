// The wiki's Condition Overload (Mechanic) page: its catalogue of gun attacks where CO doesn't
// behave as written (community-measured; the page cites Prof_Blocks_007's, Rainy's and WFCD's
// sheets). Read from a local copy (tools/data/ConditionOverload.wiki, not tracked in git), used to
// cross-check Underframe's per-attack table.
import { existsSync, readFileSync } from 'node:fs';

/** The page's gun tables (melee, stances, exalted weapons and amps aren't guns we model). */
const GUN_SECTIONS = ['Primaries', 'Secondaries', 'Archguns', 'Robotic'];

/**
 * @typedef {object} WikiCo
 * @property {string} weapon
 * @property {string} attack
 * @property {number} share  the CO bonus relative to the attack's base damage (1 = as written)
 * @property {boolean} mult  "Multiplying": stacks multiplicatively with Serration and co.
 * @property {string} [note]
 */

/**
 * The page's rows, one per weapon named in the row ("Braton/Mk1/Prime/Vandal" is four), or null
 * with no local copy.
 * @param {string | URL} file
 * @returns {WikiCo[] | null}
 */
export function readWikiCo(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  /** @type {WikiCo[]} */
  const rows = [];
  for (const section of text.split(/\n===? ?/).slice(1)) {
    const title = section.slice(0, section.indexOf('=')).trim();
    if (!GUN_SECTIONS.includes(title)) continue;
    const table = section.slice(section.indexOf('{|'), section.indexOf('\n|}'));
    for (const raw of table.split('\n|-').slice(1)) {
      const cells = raw.replace(/^\n\|/, '').split(/\|\||\n\|/).map(c => c.trim());
      const weapons = [...cells[0].matchAll(/\{\{Weapon\|([^|}]+)/g)].map(m => m[1].trim());
      const pct = cells.find(c => /^[\d.]+%/.test(c));
      const behaviour = cells.find(c => /^(Adding|Multiplying|N\/A|Does not apply)$/.test(c));
      if (!weapons.length || !pct) continue;
      const share = parseFloat(pct) / 100;
      const note = cells.slice(cells.indexOf(/** @type {string} */ (behaviour)) + 1).join(' ').trim() || undefined;
      for (const weapon of weapons) rows.push({ weapon, attack: cells[1], share, mult: share > 0 && behaviour === 'Multiplying', note });
    }
  }
  return rows;
}

/**
 * The wiki's rows against Underframe's (`co_data`), for the weapons given. A row agrees when
 * Underframe's attack of the same name, or any of the weapon's attacks when the names differ ("Main-
 * fire" vs "Normal Attack"), has the same share (within 2 points) and the same adding/multiplying.
 * @param {WikiCo[]} rows @param {any[]} coData @param {Set<string>} weapons
 */
export function crossCheckCo(rows, coData, weapons) {
  /** @type {Map<string, any[]>} */
  const byWeapon = new Map();
  for (const r of coData) byWeapon.set(r.weapon_name.toLowerCase(), [...(byWeapon.get(r.weapon_name.toLowerCase()) ?? []), r]);
  const modelled = new Set([...weapons].map(w => w.toLowerCase()));
  let agree = 0;
  /** @type {string[]} */
  const differ = [];
  for (const w of rows) {
    const theirs = byWeapon.get(w.weapon.toLowerCase());
    if (!theirs || !modelled.has(w.weapon.toLowerCase())) continue;
    const same = (/** @type {any} */ r) => Math.abs(parseFloat(r.co_factor) / 100 - w.share) < 0.02
      && (w.share === 0 || (r.effect === 'Multiplies') === w.mult);
    const named = theirs.find(r => r.fire_mode_name.toLowerCase() === w.attack.toLowerCase());
    if (named ? same(named) : theirs.some(same)) { agree++; continue; }
    const shown = (named ? [named] : theirs).map(r => `${r.fire_mode_name} ${Math.round(parseFloat(r.co_factor))}% ${r.effect === 'Multiplies' ? 'multiplying' : 'adding'}`);
    differ.push(`${w.weapon}, ${w.attack}: wiki ${Math.round(w.share * 100)}% ${w.mult ? 'multiplying' : 'adding'}; Underframe ${shown.join(', ')}`);
  }
  return { agree, differ };
}
