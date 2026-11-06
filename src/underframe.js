// @ts-check
// Reads a frame build out of an Underframe share link (underframe.site/share#v4.<token>) and adds up what the build is
// cast with. The token is the whole build, so this needs nothing from Underframe: JSON, gzipped, in base64url. Frames
// and mods are stored as a hash of their name, Arcanes and shard effects as their text. Short links (/vshare/...) are
// held on Underframe's server, which doesn't let other sites ask.

import { FRAME_MOD_NAMES, FRAME_NAMES, POWER } from './data/frame-power.js';

/** @typedef {{name: string, frame: string, mods: {name: string, rank?: number}[], arcanes: string[], shards: string[], helminth: {name: string, slot: number} | null, unknown: number}} ReadBuild */

const WARFRAME = 3;   // in the link's list of build types
const PRECISION = 'Precision Intensify';
const UMBRAL = ['Umbral Intensify', 'Umbral Vitality', 'Umbral Fiber'];
/** Where the builds' name for a frame isn't Underframe's. */
const FRAME_NAME = /** @type {Record<string, string>} */ ({ Cyte: 'Cyte-09', Sirius: 'Sirius & Orion', Orion: 'Sirius & Orion' });
/** Umbral Intensify with this many of the set. */
const UMBRAL_SET = /** @type {Record<number, number>} */ ({ 1: 1, 2: 1.25, 3: 1.75 });

/** Underframe's id for a name: its 64-bit FNV-1a hash, base64url. @param {string} namespace @param {string} name */
function shareId(namespace, name) {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(`${namespace}\0${name}`)) hash = ((hash ^ BigInt(byte)) * 1099511628211n) & 0xffffffffffffffffn;
  const bytes = Array.from({ length: 8 }, (_, i) => Number((hash >> BigInt(8 * (7 - i))) & 0xffn));
  return `~${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** @param {string} namespace @param {string[]} names */
const byId = (namespace, names) => new Map(names.map(n => [shareId(namespace, n), n]));
/** @type {Map<string, string> | undefined} */ let frames;
/** @type {Map<string, string> | undefined} */ let mods;

/** @param {string} text @returns {Uint8Array} */
const bytesOf = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/** The build in a pasted link or token. @param {string} text @returns {Promise<ReadBuild>} */
export async function readLink(text) {
  if (/\/vshare\//.test(text)) throw new Error('that’s a short link, which only Underframe can open: use the long one, from Share before Minify');
  const hit = /\bv4(u?)\.([A-Za-z0-9_-]+)/.exec(text);
  if (!hit) throw new Error('that isn’t an Underframe share link (underframe.site/share#v4…)');
  /** @type {any} */
  let payload;
  try {
    const bytes = bytesOf(hit[2]);
    const json = hit[1] ? new TextDecoder().decode(bytes) : await new Response(new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    payload = JSON.parse(json);
  } catch {
    throw new Error('that link is cut off or damaged');
  }
  const b = payload?.b;
  if (!b) throw new Error('that link has no build in it');
  if (b.t !== WARFRAME) throw new Error('that link is a weapon or companion’s build: it needs a frame’s');
  frames ??= byId('warframe', FRAME_NAMES);
  mods ??= byId('mod', FRAME_MOD_NAMES);
  let unknown = 0;
  const known = /** @type {{name: string, rank?: number}[]} */ ((b.m ?? []).flatMap((/** @type {any} */ m) => {
    if (!m) return [];
    if (!Array.isArray(m)) return m.n ? [{ name: m.n, ...(m.r === undefined ? {} : { rank: m.r }) }] : [];
    const name = mods?.get(m[0]);
    if (!name) unknown++;
    return name ? [{ name, ...(m[1] === undefined ? {} : { rank: m[1] }) }] : [];
  }));
  const frame = frames.get(b.i) ?? (String(b.i).startsWith('~') ? null : String(b.i));
  if (!frame) throw new Error('that build is for a frame this page doesn’t know yet');
  return {
    name: String(b.n ?? 'Shared Build'), frame, mods: known,
    arcanes: (b.a ?? []).filter((/** @type {any} */ a) => typeof a === 'string'),
    shards: (b.as ?? []).flatMap((/** @type {any} */ s) => (s && typeof s[1] === 'string' ? [s[1]] : [])),
    helminth: Array.isArray(b.h) ? { name: String(b.h[0]), slot: Number(b.h[1]) } : null,
    unknown,
  };
}

/**
 * The panel's general totals for a build, unrounded. Like the panel, no conditional: Molt Augmented, Arcane Bellicose
 * and Precision Intensify are for whoever uses this to add. A mod without a rank is at its maximum, as are shards' text.
 * @param {{name: string, rank?: number}[]} mods @param {string[]} shards each one's effect
 */
export function panelPower(mods, shards) {
  const totals = { strength: 100, duration: 100 };
  const set = UMBRAL_SET[mods.filter(m => UMBRAL.includes(m.name)).length] ?? 1;
  for (const m of mods) {
    const p = POWER[m.name];
    if (!p) continue;
    const share = ((m.rank ?? p.rank) + 1) / (p.rank + 1) * (m.name === UMBRAL[0] ? set : 1);
    totals.strength += (p.strength ?? 0) * share;
    totals.duration += (p.duration ?? 0) * share;
  }
  for (const effect of shards) {
    const hit = /^\+(\d+(?:\.\d+)?)% Ability (Strength|Duration)$/.exec(effect);
    if (hit) totals[/** @type {'strength' | 'duration'} */ (hit[2].toLowerCase())] += Number(hit[1]);
  }
  return totals;
}

/** What Buffs needs of a read build. @param {ReadBuild} read @returns {import('./buffs.js').BuffBuild} */
export function ownBuild(read) {
  const { strength, duration } = panelPower(read.mods, read.shards);
  const has = (/** @type {string} */ arcane) => read.arcanes.includes(arcane);
  const frame = read.frame.replace(/ Prime$/, '');
  return {
    frame: FRAME_NAME[frame] ?? frame, tab: read.name, strength: Math.round(strength), duration: Math.round(duration), reads: 0, own: 1,
    ...(has('Molt Augmented') ? { molt: 1 } : {}),
    ...(has('Arcane Bellicose') ? { bellicose: 1 } : {}),
    ...(read.helminth ? { sub: read.helminth.name } : {}),
    ...(read.helminth?.slot === 4 && read.mods.some(m => m.name === PRECISION) ? { fourth: 1 } : {}),
  };
}
