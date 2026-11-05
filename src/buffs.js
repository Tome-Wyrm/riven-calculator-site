// @ts-check
// What the chosen buffs (src/data/buffs.js) add to a build: one piece, summed in with its mods
// (src/build.js). Pure.

import { BUFFS } from './data/buffs.js';

/** Buff effects that are elements: never combined with another. @param {string} what */
const elementOf = what => (what.startsWith('element:') ? what.slice('element:'.length) : null);

/**
 * The chosen buffs as a piece. Strength and Duration are shares (1 is 100%), Strength raised first by
 * what raises it for the others. 'more' effects multiply each other, into the stat allDamage.
 * @param {string[]} ids @param {number} [strength] @param {number} [duration] @param {number} [stacks] what a primer keeps on the target @param {number} [heads] the share of hits on heads in Void's bubble
 * @returns {import('./build.js').Piece | null} null without any
 */
export function buffPiece(ids, strength = 1, duration = 1, stacks = 5, heads = 0.9) {
  /** @type {Record<string, number>} */
  const stats = {};
  /** @type {{type: string, value: number, loose: true}[]} */
  const elements = [];
  let more = 1, sparkMore = 1;
  const chosen = BUFFS.filter(b => ids.includes(b.id));
  const raising = chosen.flatMap(b => b.effects).filter(([what]) => what === 'strength');
  const boost = raising.reduce((s, [, value]) => s + Number(value) * strength, 0);
  const power = strength + Math.min(boost, Math.max(0, ...raising.map(e => e[3] ?? 0)));
  for (const b of chosen) {
    for (const [what, value, scaling, cap] of b.effects) {
      if (what === 'strength') continue;
      const v = Math.min(cap ?? Infinity, (value === 'stacks' ? stacks : value === 'heads' ? heads : value) * (scaling === 's' ? power : scaling === 'd' ? duration : 1));
      const element = elementOf(what);
      if (element) elements.push({ type: element, value: v, loose: true });
      else if (what === 'more') more *= 1 + v;
      else if (what === 'sparkMore') sparkMore *= 1 + v;
      else stats[what] = (stats[what] ?? 0) + v;
    }
  }
  if (!chosen.length) return null;
  if (more !== 1) stats.allDamage = more - 1;
  if (stats.sparks) stats.sparks *= sparkMore;
  return { name: 'Buffs', stats, elements, excl: [] };
}
