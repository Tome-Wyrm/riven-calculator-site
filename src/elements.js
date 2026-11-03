// @ts-check
// How elements combine on a weapon. Pure functions, no DOM.
//
// The rules (the wiki's Damage and Riven pages; "Elemental priority" by The Engineer,
// youtube.com/watch?v=74LM3QPOkOw, with in-game tests in the Simulacrum; still to check in our arsenal):
//  1. Elemental mods are taken in slot order: the eight main slots in reading order, the top row
//     left to right (1-4), then the bottom row (5-8). The exilus slot never matters (no exilus mod
//     adds an element), nor do the stance slot on melee or the arcane slot.
//  2. Only the first time a base element appears decides its place; more of it just adds damage
//     there (two Heat mods are one Heat).
//  3. Base elements pair up in order: the 1st with the 2nd, the 3rd with the 4th. One left over
//     stays as it is.
//  4. Every base element that isn't from a mod on the weapon (the weapon's own damage, a progenitor
//     / Valence bonus, an ability's buff, even an augment's buff such as Shock Trooper) goes into a
//     third row after the mods, always in the order Heat, Cold, Electricity, Toxin ("Harrow Chassis
//     Every Time", HCET), whatever its source or when it arrived. One already placed by a mod just
//     adds there: a Toxin mod on a Toxin weapon pulls the weapon's Toxin up into the mods' order
//     (Electricity + Toxin mods make Corrosive, and an ability's Heat can't take the Toxin away).
//  5. Combined elements, from anywhere (a spliced riven's Viral, innate Radiation, a progenitor
//     Magnetic, Venom Dose's Corrosive), never combine further and never split.
//  6. A riven with several elements puts them in bottom-up: the last one listed first (rivenOrder).
//     So a mod before the riven pairs with its last-listed element, and a mod after it pairs only
//     with an odd one out (1 or 3 elements: the first listed). Heat, then a riven with Electricity
//     and Cold, makes Blast + Electricity; the riven, then Heat, keeps the riven's Magnetic.
//  7. Toxic Lash's Toxin stays apart from all of it: plain Toxin, whatever else the weapon has.

export const BASE = ['heat', 'cold', 'electricity', 'toxin'];
export const COMBINED = ['blast', 'corrosive', 'gas', 'magnetic', 'radiation', 'viral'];

/** The combined element two base elements make. @type {Record<string, string>} */
const PAIRS = {
  'heat+cold': 'blast', 'electricity+toxin': 'corrosive', 'heat+toxin': 'gas',
  'cold+electricity': 'magnetic', 'heat+electricity': 'radiation', 'cold+toxin': 'viral',
};

/** @param {string} a @param {string} b */
export const combine = (a, b) => PAIRS[`${a}+${b}`] ?? PAIRS[`${b}+${a}`];

/**
 * A riven's elements in the order they join the list: bottom-up, the last one listed first.
 * @param {{type: string, value: number}[]} listed  as the riven shows them, top to bottom
 */
export const rivenOrder = listed => [...listed].reverse();

/**
 * The elements a weapon deals, after combining.
 * @param {{type: string, value: number}[]} mods  elemental damage from the weapon's mods, in slot
 *   order (absolute damage: the mod's % × the weapon's base damage); a riven's several elements via
 *   rivenOrder
 * @param {Record<string, number>} [other]  every other source by type: the weapon's own elements, a
 *   progenitor / Valence bonus, ability buffs. Base ones join after the mods in Heat, Cold,
 *   Electricity, Toxin order; combined ones stay as they are.
 * @param {Record<string, number>} [apart]  elements that skip combining altogether (Toxic Lash's Toxin)
 * @returns {Record<string, number>} damage by element
 */
export function combineElements(mods, other = {}, apart = {}) {
  /** @type {{type: string, value: number}[]} base elements in order, not yet paired */
  const order = [];
  /** @type {Record<string, number>} */
  const out = {};
  const add = (/** @type {string} */ type, /** @type {number} */ value) => {
    if (!value) return;
    if (COMBINED.includes(type)) { out[type] = (out[type] ?? 0) + value; return; }
    const there = order.find(e => e.type === type);
    if (there) there.value += value; else order.push({ type, value });
  };
  for (const m of mods) add(m.type, m.value);
  for (const type of BASE) add(type, other[type] ?? 0);                     // HCET
  for (const [type, value] of Object.entries(other)) if (!BASE.includes(type)) add(type, value);
  for (let i = 0; i < order.length; i += 2) {
    const [a, b] = [order[i], order[i + 1]];
    const type = b ? combine(a.type, b.type) : a.type;
    out[type] = (out[type] ?? 0) + a.value + (b?.value ?? 0);
  }
  for (const [type, value] of Object.entries(apart)) if (value) out[type] = (out[type] ?? 0) + value;
  return out;
}
