// @ts-check
// Enemy level scaling, from the wiki's Enemy Level Scaling page (checked by tools/build-enemies.mjs):
// a stat is its base value x a multiplier that runs along one curve at low levels and another past
// them, with a smoothstep between 70 and 80 levels above the unit's base level. Each curve is
// 1 + C x (level - base level)^E. Steel Path: health and shields x2.5 (armor isn't raised).
// Armor is capped at 2700 (90% damage reduction), and an armored unit starts with at least 200.
// Overguard runs on its own curves, from level 1 whatever the unit's base level, past level 45-50, and
// isn't raised on the Steel Path as far as the page says.
// Eximus units: 12 base Overguard whatever the unit (the wiki's Overguard). Their other stats aren't
// given exactly, and beside that Overguard they hardly count, so they're left as the unit's.

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
  // The page's tabs put Anarchs with Corrupted (its health text also names them with the Murmur).
  Anarchs: { health: 'corrupted', shields: 'corrupted' },
  Sentient: { health: 'murmur', shields: 'grineer' },
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

/** An Eximus unit's base Overguard. */
const EXIMUS_OVERGUARD = 12;

/** Overguard's multiplier at a level (the wiki's Enemy Level Scaling). @param {number} level */
export function overguardMultiplier(level) {
  const q = Math.max(0, level - 1);
  const f1 = 1 + 0.0015 * q ** 4;
  const f2 = 1 + 260 * q ** 0.9;
  const t = Math.min(1, Math.max(0, (level - 45) / 5));
  return f1 + (f2 - f1) * t * t * (3 - 2 * t);
}

/**
 * A unit's health, shields and armor at a level (as the game shows it; on the Steel Path that's the
 * raised level).
 * @param {Unit} unit @param {number} level @param {boolean} [steelPath]
 * @returns {{health: number, shields: number, armor: number, overguard: number}}
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
    overguard: (unit.overguard ?? 0) * overguardMultiplier(level),
  };
}

/**
 * A battlegroup at a level, as targets: `types` puts them all in one faction ('' for no weaknesses:
 * "any faction" fights the Grineer's); unset, each its own, and a unit borrowed from another group
 * takes the group's.
 * `eximus` of them are Eximus: the rest shrink in proportion, and they're all taken as the group's
 * commonest unit, one more fight rather than twice as many (their Overguard is the same on any, and
 * far more than the unit's own health).
 * @param {string} id  the group (src/data/battlegroups.js) @param {import('./data/battlegroups.js').Member[]} members
 * @param {number} level @param {boolean} steelPath @param {boolean} stripped
 * @param {Parameters<typeof targetOf>[4] & {UNITS: Record<string, Unit[]>}} data @param {string} [types]
 * @param {number} [eximus]
 * @returns {import('./sim.js').RoomUnit[]}
 */
export function roomOf(id, members, level, steelPath, stripped, data, types, eximus = 0) {
  const faction = data.UNITS[id][0].types;
  const all = members.reduce((s, [, n]) => s + n, 0);
  const special = Math.min(all, Math.max(0, eximus));
  const units = members.map(([name, n, from]) => {
    const unit = /** @type {Unit} */ (data.UNITS[from ?? id].find(u => u.name === name));
    return { n: n * (all - special) / all, target: targetOf({ ...unit, types: types ?? faction }, level, steelPath, stripped, data) };
  });
  if (!special) return units;
  const commonest = units.reduce((a, b) => (b.n > a.n ? b : a));
  return [...units.filter(u => u.n > 0), { n: special, target: { ...commonest.target, overguard: (commonest.target.overguard ?? 0) + EXIMUS_OVERGUARD * overguardMultiplier(level) } }];
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
  return { health: s.health, shields: s.shields, armor: stripped ? 0 : s.armor, ...(s.overguard ? { overguard: s.overguard } : {}),
    weak: data.WEAKNESSES[unit.types] ?? {}, shieldWeak: data.SHIELD_WEAKNESSES };
}
