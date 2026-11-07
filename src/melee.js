// @ts-check
// Melee helpers for the fight (src/fight.js): the combo counter's tiers, a stance attack's swing, and
// the stance combo a weapon uses. Pure; no DOM.
//
// Normal attacks only (Phase 15). A swing is one attack of a stance combo: its hits' damage
// multipliers and hit counts count, their timing doesn't (each attack takes one swing at the weapon's
// attack speed). A slam (the class's or a unique stance's) is one such attack; its slam hits take
// Slam Attack Damage on their base damage. Each hit rolls crit and status on its own and adds its multiplier in combo points
// (the wiki's Melee Combo: a 300% hit adds 3), plus Additional Combo Count Chance's extra point.
// The combo multiplier is 1x below 20 points, then 2x, +1x per 20 more, 12x from 220. It doesn't
// multiply normal attacks: Blood Rush and Weeping Wounds add their bonus once per tier past 1x (the
// wiki's worked example: 20% x (1 + 1.2 True Steel + 0.4 x (4 - 1)) at 4x).

import { STANCES, HEAVIES, UNIQUE_HEAVIES, HEAVY_USUAL } from './data/stances.js';

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
/** Seconds from one heavy slam to the next in play, whatever the attack speed (the user: 0.25 a second or less). */
export const HEAVY_SLAM_CYCLE = 4;
export const ANIMOSITY_HITS = 10;

/** The combo multiplier at a count of combo points. @param {number} points */
export const comboTier = points => Math.min(MAX_TIER, 1 + Math.floor(Math.max(0, points) / TIER_POINTS));

/**
 * A swing: its damage as a multiple of one plain hit (the hits' multipliers summed, slam hits times
 * 1 + Slam Attack Damage: it multiplies their base damage), the combo points its hits add (their
 * multipliers, slam bonus aside), its hit count, and its hits that knock the target down or fling it.
 * @param {Hit[]} attack @param {number} [slamDamage]  the build's Slam Attack Damage
 */
export function swingOf(attack, slamDamage = 0) {
  let mult = 0, points = 0, hits = 0, knocks = 0;
  for (const [m, n, proc, kind] of attack) {
    mult += m * n * (kind === 'slam' ? Math.max(0, 1 + slamDamage) : 1);
    points += m * n; hits += n;
    if (proc) knocks += n;
  }
  return { mult, points, hits, knocks };
}

/** Whether any of these attacks has a slam hit (Slam Attack Damage counts). @param {Hit[][]} attacks */
export const hasSlam = attacks => attacks.some(a => a.some(h => h[3] === 'slam'));

/**
 * A heavy attack's damage as a multiple of a plain hit at 1x (the wiki gives its total; its damage
 * types share out as the normal attack's). 0: the weapon has none.
 * @param {import('./data/weapon-stats.js').WeaponStats} w
 */
export function heavyMult(w) {
  const normal = Object.values(w.modes[w.main]?.parts[0]?.dmg ?? {}).reduce((a, b) => a + b, 0);
  return normal > 0 ? (w.melee?.heavy ?? 0) / normal : 0;
}

/**
 * A weapon's heavy attacks in turn (each class has two), for the fight: `scale` against heavyMult(w),
 * `bleed` the share of its damage on hits that force a Bleed, `bleeds` those hits, `hits` all of them.
 * The class's table decides; a weapon stored away from its class's usual value keeps that difference.
 * A unique stance's are kept to the weapon's own value, its first attack being 1.
 * @param {import('./data/weapon-stats.js').WeaponStats} w @param {string} [weapon]
 */
export function heaviesFor(w, weapon = '') {
  const own = heavyMult(w);
  const unique = UNIQUE_HEAVIES[weapon];
  const table = unique ?? HEAVIES[w.kind];
  if (!table?.length || !own) return [];
  const total = (/** @type {[number, number, string?][]} */ a) => a.reduce((s, [m, n]) => s + m * n, 0);
  const usual = HEAVY_USUAL[w.kind];
  const per = unique ? 1 / total(table[0]) : (usual ? own / usual : 1) / own;
  return table.map(a => {
    const forced = a.filter(h => h[2] === 'bleed');
    return { scale: total(a) * per, bleed: total(forced) / total(a), bleeds: forced.reduce((s, h) => s + h[1], 0), hits: a.reduce((s, h) => s + h[1], 0) };
  });
}

/** A combo's damage per swing on average. @param {Combo} c */
const perSwing = c => c.attacks.reduce((s, a) => s + swingOf(a).points, 0) / Math.max(1, c.attacks.length);

/**
 * The attacks a weapon can be judged by: its class's stance combos ("Heavy Blade", "Tonfa"…), the best
 * per swing first, then its slams (the class's shared one, a unique stance's own). A weapon's unique
 * stance (Sampotes, Tenet Exec…) is offered on that weapon alone. Each with the wiki's label:
 * "Shattering Storm: Neutral, Falling Rock"; a slam by its stance alone ("Slam", "Sampotes: Heavy Slam").
 * @param {string} kind @param {string} [weapon]
 */
export function combosFor(kind, weapon = '') {
  const all = (STANCES[kind] ?? []).filter(s => !s.unique || s.name === weapon)
    .flatMap(s => s.combos.map(c => {
      const slam = c.key === 'Slam' || c.key === 'Heavy Slam';
      const label = slam ? (s.name ? `${s.name}: ${c.key}` : c.key) : `${s.name}: ${c.key}, ${c.name}`;
      return { stance: s.name, combo: c, slam, label, perSwing: perSwing(c) };
    }));
  const best = (/** @type {typeof all} */ list) => list.sort((a, b) => b.perSwing - a.perSwing);
  return [...best(all.filter(c => !c.slam)), ...best(all.filter(c => c.slam))];
}

/** A weapon's swings when its class has no stance data: one plain hit each. @type {Hit[][]} */
export const PLAIN = [[[1, 1]]];
