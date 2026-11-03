// Regenerates src/data/weapon-stats.js (what the damage model needs about each gun) from the wiki's
// weapon data modules. Run by hand when weapons change:
//   node tools/build-weapon-stats.mjs [--offline]
// The output is committed, so the site never fetches at runtime. Melee isn't included: the damage
// model covers guns only.

import { writeFile } from 'node:fs/promises';
import { cachedText, cachedJson } from './lib/cache.mjs';
import { readWikiCo, crossCheckCo } from './lib/co-wiki.mjs';
import { parseLua } from './lib/lua.mjs';
import { WEAPONS } from '../src/data/weapons.js';

const WIKI = 'https://wiki.warframe.com/w/Module:Weapons/data/';
const MODULES = ['primary', 'secondary', 'archwing', 'companion'];

const lower = (/** @type {Record<string, number>} */ d) => Object.fromEntries(Object.entries(d ?? {}).filter(([, v]) => v).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]));
const round = (/** @type {number} */ x) => Math.round(x * 1e4) / 1e4;
/** The wiki's traits for adversary weapons (Kuva Lich, Sister of Parvos, Technocyte Coda): a Valence bonus. */
const ADVERSARY = ['Kuva Lich', 'Tenet', 'Technocyte Coda'];

/**
 * One gun as the model needs it. A fire mode is a top-level attack plus the attacks that hang off it
 * (AttackParentIndex: a projectile's explosion, say), which land together.
 * @param {any} w
 */
function compact(w) {
  const attacks = /** @type {any[]} */ (w.Attacks ?? []);
  const part = (/** @type {any} */ a) => ({
    ...partOf(a),
    ...coOf(w.Name ?? '', a),
  });
  return compactModes(w, attacks, part);
}

/**
 * How Galvanized's "Direct Damage" (gun Condition Overload) applies to an attack, from Underframe's
 * per-attack CO table: [share that applies, 1 if it multiplies instead of adding]. Left out when it's
 * the usual full, additive bonus. An explosion Underframe doesn't list gets none (its notes: direct-hit
 * CO isn't copied to explosions; the wiki's Condition Overload (Mechanic): "Projectile Explosion
 * Radius" doesn't apply CO). Multiplying: base x (1 + damage mods) x (1 + CO); adding: base x
 * (1 + damage mods + CO), so CO competes with Serration. A share under 1 is mostly a charged shot
 * (CO uses the uncharged damage: 50% on bows) or an incarnon whose evolution raised base damage.
 * Underframe is the source (its rows are newer, some audited against Update 44); the wiki's page is a
 * cross-check (below).
 * @param {string} weapon @param {any} a
 */
function coOf(weapon, a) {
  const row = coTable.get(`${weapon}|${a.AttackName}`);
  if (!row) return a.ShotType === 'AoE' ? { co: [0] } : {};
  const share = Math.round(parseFloat(row.co_factor)) / 100;
  const mult = row.effect === 'Multiplies';
  return share === 1 && !mult ? {} : { co: mult ? [share, 1] : [share] };
}

/** An attack's own numbers. @param {any} a */
function partOf(a) {
  return ({
    name: a.AttackName,
    dmg: Object.fromEntries(Object.entries(lower(a.Damage)).map(([k, v]) => [k, round(v)])),
    cc: round(a.CritChance ?? 0), cd: round(a.CritMultiplier ?? 1), sc: round(a.StatusChance ?? 0),
    ms: round(a.Multishot ?? 1),
    ...(a.ForcedProcs?.length ? { forced: a.ForcedProcs.map((/** @type {string} */ p) => p.toLowerCase()) } : {}),
    ...(a.ShotType === 'AoE' ? { aoe: 1 } : {}),
    // The wiki's ExtraHeadshotDmg: a headshot bonus (Cernos Prime +0.5), or -2 for no weak point bonus.
    ...(a.ExtraHeadshotDmg ? { hs: a.ExtraHeadshotDmg } : {}),
  });
}

/** The fire modes, each a top-level attack and its parts. @param {any} w @param {any[]} attacks @param {(a: any) => any} part */
function compactModes(w, attacks, part) {
  // A charge weapon can list its fire rate as unlimited (math.huge): the charge time sets it.
  const rateOf = (/** @type {any} */ a) => {
    const r = a.FireRate ?? w.FireRate;
    return Number.isFinite(r) && r > 0 ? round(r) : a.ChargeTime ? round(1 / a.ChargeTime) : 1;
  };
  const modes = attacks.filter(a => !a.AttackParentIndex).map(a => ({
    name: a.AttackName,
    rate: rateOf(a),
    cost: round(a.AmmoCost ?? 1),
    ...(a.ChargeTime ? { charge: round(a.ChargeTime) } : {}),
    parts: [a, ...attacks.filter(b => b.AttackParentIndex === a.AttackIndex)].map(part),
  }));
  // The attack the wiki's tooltip shows first (or its parent) is the default mode.
  const shown = attacks.find(a => a.AttackIndex === w._TooltipAttackDisplay);
  const main = Math.max(0, modes.findIndex(m => m.name === (shown?.AttackParentIndex
    ? attacks.find(a => a.AttackIndex === shown.AttackParentIndex)?.AttackName : shown?.AttackName)));
  return {
    // The wiki's class ("Rifle", "Sniper Rifle", "Bow", "Shotgun", "Launcher"…): which mods fit.
    kind: w.Class ?? '',
    mag: w.Magazine ?? 1, reload: round(w.Reload ?? 0), ammo: w.AmmoMax ?? null, trigger: w.Trigger ?? '',
    tags: w.CompatibilityTags ?? [],
    ...(/** @type {string[]} */ (w.Traits ?? []).some(t => ADVERSARY.includes(t)) ? { adversary: true } : {}),
    main, modes,
  };
}

/** Underframe's per-attack CO table, by "weapon|attack". */
const underframe = await cachedJson('underframe', 'https://www.underframe.site/api/data', {
  validate: d => (Array.isArray(d?.co_data) ? null : 'no co_data'),
});
const coTable = new Map(/** @type {any[]} */ (underframe.data.co_data).map(r => [`${r.weapon_name}|${r.fire_mode_name}`, r]));

/** @type {Record<string, any>} */
const wiki = {};
for (const m of MODULES) {
  // Kept locally (tools/lib/cache.mjs): used when the wiki can't be reached or its module no longer parses.
  const { data } = await cachedText(`wiki-weapons-${m}`, 'lua', `${WIKI}${m}?action=raw`, {
    validate: text => { try { parseLua(text); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } },
  });
  const parsed = parseLua(data);
  for (const [key, w] of Object.entries(parsed)) wiki[(w.Name ?? key).toLowerCase()] = w;
}

/** @type {Record<string, any>} */
const out = {};
const missing = [];
for (const [name, cls] of WEAPONS) {
  if (cls === 'melee') continue;
  // The wiki names a gun with a melee form "Vinquibus (Primary)".
  const w = wiki[name.toLowerCase()] ?? wiki[`${name.toLowerCase()} (primary)`];
  // Kitgun chambers have no stats of their own (the grip and loader decide), so they stay out.
  if (!w || !w.Attacks?.some((/** @type {any} */ a) => Object.values(a.Damage ?? {}).some(v => /** @type {number} */ (v) > 0))) { missing.push(name); continue; }
  out[name] = compact(w);
}
// Cross-check: Underframe's is_progenitor flag against the wiki's traits.
{
  const flagged = new Set(/** @type {any[]} */ (underframe.data.weapons).filter(w => w.is_progenitor).map(w => w.name));
  const ours = Object.keys(out).filter(k => out[k].adversary);
  const differ = [...ours.filter(k => !flagged.has(k)), ...Object.keys(out).filter(k => flagged.has(k) && !out[k].adversary)];
  console.log(`Adversary weapons: ${ours.length}${differ.length ? `; differ from Underframe: ${differ.join(', ')}` : ', as Underframe has'}`);
}
if (missing.length) console.warn(`Guns with no wiki stats (${missing.length}): ${missing.join(', ')}`);

// Cross-check: the wiki's Condition Overload (Mechanic) catalogue, from a local copy of the page
// (tools/data/ConditionOverload.wiki, not tracked in git; save the page's source there to run it).
// Known differences (2026-11-02), none changing the data:
// - incarnon radial attacks (Braton, Burston, Zylok), where the page's figures predate Underframe's
//   (Zylok Prime's is audited against Update 44; Burston's 24% vs 100% is the one worth a check);
// - Kulstar's cluster bombs: the page says 257%, but its own 200 of 75 is 267%, as Underframe has;
// - Ballistica Prime's charged shot: 38 vs 40 of 76, a base damage difference;
// - Vulcax: the page's 167% is the impact and explosion together (1000 of 600), which is
//   Underframe's 100% of 500 plus 500% of 100;
// - alt-fires the model doesn't have (Zenith's disk bonk, Scyotid's grab).
const wikiCo = readWikiCo(new URL('./data/ConditionOverload.wiki', import.meta.url));
if (wikiCo) {
  const { agree, differ } = crossCheckCo(wikiCo, underframe.data.co_data, new Set(Object.keys(out)));
  console.log(`CO against the wiki's catalogue: ${agree} agree, ${differ.length} differ${differ.map(d => `\n  ${d}`).join('')}`);
} else console.log('CO: no local copy of the wiki page, so no cross-check');

const date = new Date().toISOString().slice(0, 10);
await writeFile(new URL('../src/data/weapon-stats.js', import.meta.url), `// @ts-check
// GENERATED by tools/build-weapon-stats.mjs from the Warframe wiki's Module:Weapons/data on ${date}.
// Don't edit by hand. Guns only (the damage model doesn't cover melee).
//
// Per weapon: magazine, reload (s), max ammo, trigger, a few compatibility tags, whether it's an
// adversary weapon (Kuva, Tenet, Coda: it has a Valence bonus), the default fire
// mode, and each mode: fire rate, ammo per shot, charge time, and its parts (an attack and what
// hangs off it, e.g. a projectile and its explosion), each with damage by type, crit chance, crit
// multiplier, status chance, multishot, forced procs and whether it's an area attack.

export const WEAPON_STATS_UPDATED = '${date}';

/**
 * @typedef {{name: string, dmg: Record<string, number>, cc: number, cd: number, sc: number, ms: number, forced?: string[], aoe?: number, hs?: number, ccFlat?: number, nonCrit?: {chance: number, mult: number}, co?: number[]}} Part
 * @typedef {{name: string, rate: number, cost: number, charge?: number, parts: Part[]}} Mode
 * @typedef {{kind: string, mag: number, reload: number, ammo: number | null, trigger: string, tags: string[], adversary?: boolean, main: number, modes: Mode[], bonus?: {fireRate?: number, reloadSpeed?: number}}} WeaponStats
 */

/** @type {Record<string, WeaponStats>} */
export const WEAPON_STATS = {
${Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}
};
`);
console.log(`Wrote ${Object.keys(out).length} guns`);
