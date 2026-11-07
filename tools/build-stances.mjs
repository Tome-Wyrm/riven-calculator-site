// Regenerates src/data/stances.js (each melee weapon type's stances and their combos' hits) from the
// wiki's stance data module. Run by hand when stances change:
//   node tools/build-stances.mjs [--offline]
// A combo is its attacks in order; an attack is its hits, each [damage multiplier, hit count, proc?]
// (Vermillion Storm's Crimson Hurricane: 100%, then 200% and three 100% spins, then 200% and 100%),
// a slam hit marked (its Slam Attack Damage multiplies it).
// The damage model uses the multipliers and hit counts, not the timing (src/melee.js).

import { writeFile } from 'node:fs/promises';
import { cachedText } from './lib/cache.mjs';
import { parseLua } from './lib/lua.mjs';

const URL_ = 'https://wiki.warframe.com/w/Module:Stances/data?action=raw';
/** Combos every stance of a type shares, or that aren't stance combos: not modelled as one. */
const SHARED = ['Heavy', 'Slide', 'Aerial', 'Wall', 'Finisher'];
/** Slams: the shared Slam of each weapon type and a unique stance's own, listed by the stance alone. */
const SLAMS = ['Slam', 'Heavy Slam'];
/** Procs a hit forces that knock the target down or fling it (Melee Afflictions triggers on them). */
const KNOCK = ['Knockdown', 'Lifted', 'Ragdoll', 'Knockback'];

const { data } = await cachedText('wiki-stances', 'lua', URL_, {
  validate: text => { try { parseLua(text, 'local StanceData ='); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } },
});
const all = parseLua(data, 'local StanceData =');

/** A combo's attacks: each hit [multiplier, count, knock proc or '', 'slam' when it's a slam hit]. @param {any} c */
const attacksOf = c => c.Attacks.map((/** @type {any} */ a) => (a.Dmg ?? []).map((/** @type {number} */ d, /** @type {number} */ i) => {
  // A hit's procs: one name, or a list of them (['Bleed', 'Knockdown']).
  const procs = [a.Procs?.[i] ?? ''].flat();
  const knock = procs.find(p => KNOCK.includes(p))?.toLowerCase() ?? '';
  const slam = a.Types?.[i] === 'Slam';
  return /** @type {[number, number, string?, string?]} */ ([d / 100, a.Hits?.[i] ?? 1, ...(knock || slam ? [knock] : []), ...(slam ? ['slam'] : [])]);
})).filter((/** @type {any[]} */ a) => a.length);

/** @type {Record<string, {name: string, unique?: 1, combos: {key: string, name: string, attacks: [number, number, string?, string?][][]}[]}[]>} */
const out = {};
/** A class's heavy attacks, and a unique stance's (by weapon): the first and second, in turn. @type {Record<string, [number, number, string?][][]>} */
const heavies = {}, uniqueHeavies = {};
/** A heavy attack's hits: [multiplier, count, 'bleed' when it forces one]. @param {any} c */
const heavyOf = c => c.Attacks.map((/** @type {any} */ a) => (a.Dmg ?? []).map((/** @type {number} */ d, /** @type {number} */ i) =>
  /** @type {[number, number, string?]} */ ([d / 100, a.Hits?.[i] ?? 1, ...([a.Procs?.[i] ?? ''].flat().includes('Bleed') ? ['bleed'] : [])])));
let count = 0;
for (const [name, s] of Object.entries(all)) {
  // Conclave stances aren't for PvE. A type's stanceless entry gives only its shared slam (stance '').
  if (!s?.WeaponType || s.ConclaveOnly || name.startsWith('__')) continue;
  const stanceless = !!s.StancelessStance || name === s.WeaponType;
  if (Array.isArray(s.Heavy?.Attacks)) {
    if (stanceless) heavies[s.WeaponType] = heavyOf(s.Heavy);
    else if (s.UniqueToWeapon) uniqueHeavies[name] = heavyOf(s.Heavy);
  }
  const combos = [];
  for (const [key, c] of Object.entries(s)) {
    if (SHARED.includes(key) || !Array.isArray(c?.Attacks)) continue;
    if (stanceless && !SLAMS.includes(key)) continue;
    if (!stanceless && !s.UniqueToWeapon && SLAMS.includes(key)) continue;
    const attacks = attacksOf(c);
    // The wiki's own names; "(unofficial)" names for a weapon's unique attacks say only that.
    if (attacks.length) combos.push({ key, name: String(c.Name || key).replace(/\s*\(unofficial\)$/, '').replace(new RegExp(`^${name} `), ''), attacks });
  }
  if (!combos.length) continue;
  // A weapon's unique stance (Sampotes, Tenet Exec…) is named after the weapon and goes on it alone.
  (out[s.WeaponType] ??= []).push({ name: stanceless ? '' : name, ...(s.UniqueToWeapon ? { unique: /** @type {1} */ (1) } : {}), combos });
  count++;
}
// Where the module's heavy attacks disagree with the wiki's Melee page and the weapons' own values.
Object.assign(heavies, {
  Sparring: [[[12, 1]], [[3, 3], [3, 2, 'bleed']]],
  Machete: [[[1.5, 1, 'bleed'], [1.5, 3]], [[5, 1]]],
  Gunblade: [[[5, 1]], [[5, 1]]],
  Glaive: [[[2, 1]], [[3, 1]]],
});
// Each class's usual stored heavy damage, as a multiple of the normal attack: a weapon away from it is
// an exception (Hirudo). The stored value isn't always the attack's total (Daggers have 2 for 5x).
const { WEAPON_STATS } = await import('../src/data/weapon-stats.js');
/** @type {Record<string, Record<string, number>>} */
const counts = {};
for (const w of Object.values(WEAPON_STATS)) {
  const normal = Object.values(w.modes[w.main]?.parts[0]?.dmg ?? {}).reduce((a, b) => a + b, 0);
  if (!w.melee?.heavy || !normal) continue;
  const r = (w.melee.heavy / normal).toFixed(2);
  (counts[w.kind] ??= {})[r] = (counts[w.kind][r] ?? 0) + 1;
}
const usual = Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, Number(Object.entries(c).sort((a, b) => b[1] - a[1])[0][0])]));
for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));

const date = new Date().toISOString().slice(0, 10);
await writeFile(new URL('../src/data/stances.js', import.meta.url), `// @ts-check
// Generated by tools/build-stances.mjs from the wiki's Module:Stances/data (${date}).
// Don't edit by hand. Per weapon type (the wiki's weapon Class): its stances, each combo's attacks,
// each combo its wiki key (Neutral, Forward…; Slam, Heavy Slam) and name, each attack's hits as
// [damage multiplier, hit count, knockdown/lifted/ragdoll/knockback proc or '', 'slam' for a slam hit].
// A stance named '' is the weapon type's shared slam; unique: a weapon's own stance (named after it).

/** @typedef {[number, number, string?, string?]} Hit */
/** @typedef {{key: string, name: string, attacks: Hit[][]}} Combo */
/** @typedef {{name: string, unique?: 1, combos: Combo[]}} Stance */

/** @type {Record<string, Stance[]>} */
export const STANCES = ${JSON.stringify(out)};

/** Each class's two heavy attacks, in turn, as [multiplier, hit count, 'bleed' where it forces one]. @type {Record<string, [number, number, string?][][]>} */
export const HEAVIES = ${JSON.stringify(heavies)};

/** A weapon's own heavy attacks, where a unique stance gives it some. @type {Record<string, [number, number, string?][][]>} */
export const UNIQUE_HEAVIES = ${JSON.stringify(uniqueHeavies)};

/** Each class's usual stored heavy damage, as a multiple of the normal attack. @type {Record<string, number>} */
export const HEAVY_USUAL = ${JSON.stringify(usual)};
`);
console.log(`${count} stances for ${Object.keys(out).length} weapon types`);
