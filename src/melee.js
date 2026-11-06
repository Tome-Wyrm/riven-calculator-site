// @ts-check
// Melee helpers for the fight (src/fight.js): the combo counter's tiers, a stance attack's swing, and
// the stance combo a weapon uses. Pure; no DOM.
//
// Normal attacks only (Phase 15). A swing is one attack of a stance combo: its hits' damage
// multipliers and hit counts count, their timing doesn't (each attack takes one swing at the weapon's
// attack speed). Each hit rolls crit and status on its own and adds its multiplier in combo points
// (the wiki's Melee Combo: a 300% hit adds 3), plus Additional Combo Count Chance's extra point.
// The combo multiplier is 1x below 20 points, then 2x, +1x per 20 more, 12x from 220. It doesn't
// multiply normal attacks: Blood Rush and Weeping Wounds add their bonus once per tier past 1x (the
// wiki's worked example: 20% x (1 + 1.2 True Steel + 0.4 x (4 - 1)) at 4x).

import { STANCES } from './data/stances.js';

/** @typedef {import('./data/stances.js').Hit} Hit */
/** @typedef {import('./data/stances.js').Combo} Combo */

/** Combo points per tier, and the highest tier. */
export const TIER_POINTS = 20;
export const MAX_TIER = 12;
/** The points that reach the highest tier. */
export const MAX_COMBO = TIER_POINTS * (MAX_TIER - 1);

/** Heavy Attack Efficiency's cap, Initial Combo's regeneration (points a second), and Animosity's stacks to its cap. */
export const MAX_EFFICIENCY = 0.9;
export const COMBO_REGEN = 40;
export const ANIMOSITY_HITS = 10;

/** The combo multiplier at a count of combo points. @param {number} points */
export const comboTier = points => Math.min(MAX_TIER, 1 + Math.floor(Math.max(0, points) / TIER_POINTS));

/**
 * A swing: its damage as a multiple of one plain hit (the hits' multipliers summed), its hit count,
 * and its hits that knock the target down or fling it.
 * @param {Hit[]} attack
 */
export function swingOf(attack) {
  let mult = 0, hits = 0, knocks = 0;
  for (const [m, n, proc] of attack) { mult += m * n; hits += n; if (proc) knocks += n; }
  return { mult, hits, knocks };
}

/**
 * A heavy attack's damage as a multiple of a plain hit at 1x (the wiki gives its total; its damage
 * types share out as the normal attack's). 0: the weapon has none.
 * @param {import('./data/weapon-stats.js').WeaponStats} w
 */
export function heavyMult(w) {
  const normal = Object.values(w.modes[w.main]?.parts[0]?.dmg ?? {}).reduce((a, b) => a + b, 0);
  return normal > 0 ? (w.melee?.heavy ?? 0) / normal : 0;
}

/** A combo's damage per swing on average. @param {Combo} c */
const perSwing = c => c.attacks.reduce((s, a) => s + swingOf(a).mult, 0) / Math.max(1, c.attacks.length);

/**
 * The stances for a weapon (its wiki class: "Heavy Blade", "Tonfa"…), each combo with its damage per
 * swing; the best combo first.
 * @param {string} kind
 */
export function combosFor(kind) {
  return (STANCES[kind] ?? []).flatMap(s => s.combos.map(c => ({ stance: s.name, combo: c, perSwing: perSwing(c) })))
    .sort((a, b) => b.perSwing - a.perSwing);
}

/** A weapon's swings when its class has no stance data: one plain hit each. @type {Hit[][]} */
export const PLAIN = [[[1, 1]]];
