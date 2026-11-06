// @ts-check
// What the chosen buffs (src/data/buffs.js) add to a build: one piece, summed in with its mods
// (src/build.js). Pure.

import { BUFFS } from './data/buffs.js';
import { FRAME_BUILDS } from './data/frame-builds.js';

/** @typedef {import('./data/frame-builds.js').FrameBuild & {frame: string}} BuffBuild */

/** Molt Augmented at 250 kills: conditional Strength counts at its maximum, and an ability keeps what it was cast with. */
const FULL_MOLT = 60;
/** Where a buff's `from` isn't the frame's name in the builds. */
const FRAME_OF = /** @type {Record<string, string>} */ ({ Sirius: 'Sirius & Orion' });
const letters = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z]/g, '');
/** A tab named for a buff ("Roar Aug", "Bonnet"). @param {{name: string}} buff @param {string} tab */
const namedFor = (buff, tab) => tab.split(/\W+/).some(w => w.length >= 4 && letters(buff.name).includes(w.toLowerCase()));

/** A build's stable name in a link. @param {BuffBuild} b */
export const buildSlug = b => (b.frame + b.tab).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The builds a buff can be cast from: its frame's, or for a subsumed ability (no frame of its own) any frame's build
 * named for it. Those tabs are what the ability is subsumed for: Revenant's Nourish, Follie's Roar, Ivara's Eclipse.
 * @param {{name: string, from: string}} buff @returns {BuffBuild[]}
 */
export function buildsFor(buff) {
  const frame = FRAME_OF[buff.from] ?? buff.from;
  if (FRAME_BUILDS[frame]) return FRAME_BUILDS[frame].map(b => ({ ...b, frame }));
  if (buff.from !== 'Helminth') return [];
  return Object.entries(FRAME_BUILDS).flatMap(([name, list]) => list.filter(b => namedFor(buff, b.tab)).map(b => ({ ...b, frame: name })))
    .sort((a, b) => b.reads - a.reads);
}

/** The build named for a buff, else its most-read one; budget builds last. @param {{name: string, from: string}} buff @returns {BuffBuild | null} */
export function defaultBuild(buff) {
  const list = buildsFor(buff);
  return list.find(b => !b.budget && namedFor(buff, b.tab)) ?? list.find(b => !b.budget) ?? list[0] ?? null;
}

/** The chosen build, the default without a choice, or null for the Strength and Duration boxes ('x'). @param {{name: string, from: string}} buff @param {string} [slug] */
export function buildOf(buff, slug) {
  if (slug === 'x') return null;
  return buildsFor(buff).find(b => buildSlug(b) === slug) ?? defaultBuild(buff);
}

/** What a buff is cast with on a build, as shares. @param {BuffBuild} b */
export const buildPower = b => ({ strength: (b.strength + (b.molt ? FULL_MOLT : 0)) / 100, duration: b.duration / 100 });

/** Buff effects that are elements: never combined with another. @param {string} what */
const elementOf = what => (what.startsWith('element:') ? what.slice('element:'.length) : null);

/**
 * The chosen buffs as a piece. Strength and Duration are shares (1 is 100%), Strength raised first by
 * what raises it for the others. `each` gives a buff its own, from the build it's cast from; others use the two given. 'more' effects multiply each other, into the stat allDamage.
 * @param {string[]} ids @param {number} [strength] @param {number} [duration] @param {number} [stacks] what a primer keeps on the target @param {number} [heads] the share of hits on heads in Void's bubble @param {Record<string, {strength: number, duration: number}>} [each]
 * @returns {import('./build.js').Piece | null} null without any
 */
export function buffPiece(ids, strength = 1, duration = 1, stacks = 5, heads = 0.9, each = {}) {
  /** @type {Record<string, number>} */
  const stats = {};
  /** @type {{type: string, value: number, loose: true}[]} */
  const elements = [];
  let more = 1, sparkMore = 1;
  const chosen = BUFFS.filter(b => ids.includes(b.id));
  const own = (/** @type {{id: string}} */ b) => each[b.id]?.strength ?? strength;
  const raisers = chosen.flatMap(b => b.effects.filter(([what]) => what === 'strength').map(e => /** @type {const} */ ([e, own(b)])));
  const boost = Math.min(raisers.reduce((s, [e, power]) => s + Number(e[1]) * power, 0), Math.max(0, ...raisers.map(([e]) => e[3] ?? 0)));
  for (const b of chosen) {
    const power = own(b) + boost, lasting = each[b.id]?.duration ?? duration;
    for (const [what, value, scaling, cap] of b.effects) {
      if (what === 'strength') continue;
      const v = Math.min(cap ?? Infinity, (value === 'stacks' ? stacks : value === 'heads' ? heads : value) * (scaling === 's' ? power : scaling === 'd' ? lasting : 1));
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
