// @ts-check
// Enemy level scaling, from the wiki's Enemy Level Scaling page (checked by tools/build-enemies.mjs):
// a stat is its base value x a multiplier that runs along one curve at low levels and another past
// them, with a smoothstep between 70 and 80 levels above the unit's base level. Each curve is
// 1 + C x (level - base level)^E. Steel Path: health and shields x2.5 (armor isn't raised).
// Armor is capped at 2700 (90% damage reduction), and an armored unit starts with at least 200.
// Not modelled: Eximus units' extra health, shields and Overguard.

/** @typedef {import('./data/enemies.js').Unit} Unit */

/**
 * The [C, E] of the two curves, by stat and faction group.
 * @type {Record<'health' | 'shields' | 'armor', Record<string, [number, number][]>>}
 */
export const SCALING = {
  health: {
    grineer: [[0.015, 2.12], [10.7332, 0.72]],   // Grineer, Scaldra
    corpus: [[0.015, 2.12], [13.4165, 0.55]],
    infested: [[0.0225, 2.12], [16.0998, 0.72]],
    corrupted: [[0.015, 2.1], [10.7332, 0.685]],  // Corrupted, Anarchs
    murmur: [[0.015, 2], [10.7332, 0.5]],         // the Murmur, Sentients, unaffiliated
    techrot: [[0.02, 2.12], [15.0998, 0.7]],
  },
  shields: {
    corpus: [[0.02, 1.76], [2, 0.76]],
    corrupted: [[0.02, 1.75], [2, 0.75]],
    grineer: [[0.02, 1.75], [1.6, 0.75]],          // Grineer, Sentients (and anyone the page doesn't name)
    techrot: [[0.02, 1.76], [3.5, 0.76]],
  },
  armor: { all: [[0.005, 1.75], [0.4, 0.75]] },
};

/** Each faction type's scaling group (the wiki's faction names, as in WEAKNESSES). */
const GROUP = /** @type {Record<string, {health: string, shields: string}>} */ ({
  Grineer: { health: 'grineer', shields: 'grineer' }, 'Kuva Grineer': { health: 'grineer', shields: 'grineer' },
  Scaldra: { health: 'grineer', shields: 'grineer' },
  Corpus: { health: 'corpus', shields: 'corpus' }, 'Corpus Amalgam': { health: 'corpus', shields: 'corpus' },
  Infested: { health: 'infested', shields: 'grineer' }, 'Infested Deimos': { health: 'infested', shields: 'grineer' },
  Orokin: { health: 'corrupted', shields: 'corrupted' },
  'The Murmur': { health: 'murmur', shields: 'grineer' },
  Techrot: { health: 'techrot', shields: 'techrot' },
});

/**
 * A stat's multiplier `levels` above the unit's base level.
 * @param {[number, number][]} curves @param {number} levels
 */
export function multiplier([[c1, e1], [c2, e2]], levels) {
  const q = Math.max(0, levels);
  const f1 = 1 + c1 * q ** e1;
  const f2 = 1 + c2 * q ** e2;
  const t = Math.min(1, Math.max(0, (q - 70) / 10));
  return f1 + (f2 - f1) * t * t * (3 - 2 * t);
}

/**
 * A unit's health, shields and armor at a level (as the game shows it; on the Steel Path that's the
 * raised level).
 * @param {Unit} unit @param {number} level @param {boolean} [steelPath]
 * @returns {{health: number, shields: number, armor: number}}
 */
export function scaled(unit, level, steelPath = false) {
  const g = GROUP[unit.types] ?? { health: 'murmur', shields: 'grineer' };
  const q = level - unit.level;
  const sp = steelPath ? 2.5 : 1;
  const armor = unit.armor > 0 ? Math.min(2700, Math.max(200, unit.armor * multiplier(SCALING.armor.all, q))) : 0;
  return {
    health: unit.health * multiplier(SCALING.health[g.health], q) * sp,
    shields: unit.shields * multiplier(SCALING.shields[g.shields], q) * sp,
    armor,
  };
}

/**
 * The damage model's target: a unit at a level, with its faction's weaknesses (`data`: the
 * generated src/data/enemies.js, passed in so the page can load it when needed).
 * @param {Unit} unit @param {number} level @param {boolean} steelPath @param {boolean} stripped  armor fully stripped
 * @param {{WEAKNESSES: Record<string, Record<string, number>>, SHIELD_WEAKNESSES: Record<string, number>}} data
 * @returns {import('./sim.js').Target}
 */
export function targetOf(unit, level, steelPath, stripped, data) {
  const s = scaled(unit, level, steelPath);
  return { health: s.health, shields: s.shields, armor: stripped ? 0 : s.armor,
    weak: data.WEAKNESSES[unit.types] ?? {}, shieldWeak: data.SHIELD_WEAKNESSES };
}
