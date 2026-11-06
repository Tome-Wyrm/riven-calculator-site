// Regenerates src/data/weapon-stats.js (what the damage model needs about each gun) from the wiki's
// weapon data modules. Run by hand when weapons change:
//   node tools/build-weapon-stats.mjs [--offline]
// The output is committed, so the site never fetches at runtime. Melee weapons carry their normal
// attack and a melee block (attack speed, follow through, range, combo duration); their stances'
// combos are tools/build-stances.mjs's.

import { writeFile } from 'node:fs/promises';
import { cachedText, cachedJson } from './lib/cache.mjs';
import { readWikiCo, crossCheckCo } from './lib/co-wiki.mjs';
import { parseLua } from './lib/lua.mjs';
import { WEAPONS } from '../src/data/weapons.js';

const WIKI = 'https://wiki.warframe.com/w/Module:Weapons/data/';
const MODULES = ['primary', 'secondary', 'archwing', 'companion', 'melee'];

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
    // What reaches other enemies (src/crowd.js): Punch Through, m ("infinite" as 99), an explosion's falloff.
    ...(a.PunchThrough ? { pt: round(Math.min(99, a.PunchThrough)) } : {}),
    ...(a.ShotType === 'AoE' && a.Falloff ? { falloff: { from: round(a.Falloff.StartRange ?? 0), to: round(a.Falloff.EndRange ?? 0), cut: round(a.Falloff.Reduction ?? 0) } } : {}),
  });
  return compactModes(w, attacks, part);
}

/**
 * One melee weapon: each attack a mode (the normal attack the default: a swing at its attack speed,
 * the stance's multipliers on top; slams, throws, a gunblade's shots and Corufell's projectile keep
 * their own falloff in their parts), no magazine, and what a swing reaches: follow through (the share
 * of damage each further enemy in the swing keeps), range and sweep radius, and the combo's duration.
 * @param {any} w
 */
function compactMelee(w) {
  const attacks = /** @type {any[]} */ (w.Attacks ?? []);
  const base = compactModes(w, attacks, (/** @type {any} */ a) => ({
    ...partOf(a), ...coOf(w.Name ?? '', a),
    ...(a.Falloff ? { falloff: { from: round(a.Falloff.StartRange ?? 0), to: round(a.Falloff.EndRange ?? 0), cut: round(a.Falloff.Reduction ?? 0) } } : {}),
  }));
  return {
    ...base, mag: 0, reload: 0, ammo: null, trigger: '',
    main: Math.max(0, base.modes.findIndex(m => m.name === 'Normal Attack')),
    modes: base.modes.map(m => ({ ...m, cost: 0 })),
    melee: {
      ft: round(w.FollowThrough ?? 1), range: round(w.MeleeRange ?? 0), sweep: round(w.SweepRadius ?? 0),
      combo: round(w.ComboDur ?? 5), heavy: round(w.HeavyAttack ?? 0), windUp: round(w.WindUp ?? 0),
    },
  };
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

/**
 * The share of its damage a beam starts a target on (the wiki's Continuous Weapon: 20% for most, ramping
 * to full over 0.6 s), and the weapons that start higher, by attack.
 */
const BEAM_START = 0.2;
/** @type {Record<string, Record<string, number>>} */
const BEAM_STARTS = { Convectrix: { 'Normal Attack': 0.6, 'Alt-Fire': 0.8 }, Phage: { 'Normal Attack': 0.7 }, Embolist: { 'Normal Attack': 0.3 } };

/**
 * Beams that chain to more enemies, from their wiki pages (2026-11-05), by attack ('*': the mode a held
 * trigger gives): how many links, within how many metres, each taking `share` of the one before, or of
 * the main beam if `flat`. Boar's form fires up to 3 beams.
 * @type {Record<string, Record<string, {links: number, range: number, share: number, flat?: number, beams?: number}>>}
 */
const CHAINS = {
  Amprex: { '*': { links: 3, range: 10, share: 0.5 } },
  Atomos: { '*': { links: 3, range: 7, share: 0.75 } },
  Basmu: { '*': { links: 5, range: 7, share: 0.5 } },
  'Kuva Nukor': { '*': { links: 2, range: 9, share: 0.5, flat: 1 } },
  Larkspur: { '*': { links: 3, range: 6, share: 0.8 } },
  'Larkspur Prime': { '*': { links: 3, range: 6, share: 0.8 } },
  'Tenet Cycron': { '*': { links: 2, range: 7, share: 0.6, flat: 1 } },
  'Tenet Glaxion': { '*': { links: 3, range: 8, share: 0.5 } },
  Torid: { '*': { links: 5, range: 7, share: 0.75 } },
  Boar: { '*': { links: 2, range: 10, share: 0.8, beams: 3 } },
  'Boar Prime': { '*': { links: 2, range: 10, share: 0.8, beams: 3 } },
};

/**
 * A beam: a held trigger (the attack's own, or the weapon's where the attack has none) firing hit-scan
 * ticks. Not the BEAM tag, which is what fits the mods: Tenet Spirex has it and fires slugs, and Boar's
 * form hasn't and is one.
 * @param {any} w @param {any} a
 */
const heldOf = (w, a) => ((a.Trigger ?? w.Trigger) === 'Held' && /^Hit-?[Ss]can$/.test(a.ShotType ?? '')
  ? { held: BEAM_STARTS[w.Name]?.[a.AttackName] ?? BEAM_START, ...(CHAINS[w.Name] ? { chain: CHAINS[w.Name]['*'] } : {}) } : {});

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
    ...heldOf(w, a),
    parts: [a, ...attacks.filter(b => b.AttackParentIndex === a.AttackIndex)].map(part),
  }));
  // The attack the wiki's tooltip shows first (or its parent) is the default mode.
  const shown = attacks.find(a => a.AttackIndex === w._TooltipAttackDisplay);
  const main = Math.max(0, modes.findIndex(m => m.name === (shown?.AttackParentIndex
    ? attacks.find(a => a.AttackIndex === shown.AttackParentIndex)?.AttackName : shown?.AttackName)));
  return {
    // The wiki's class ("Rifle", "Sniper Rifle", "Bow", "Shotgun", "Launcher"…): which mods fit.
    kind: w.Class ?? '',
    // (Epitaph draws from the ammo pool and never reloads; Vectis starts its reload as it fires: the
    // wiki's Damage/Calculation, Average Sustained DPS.)
    mag: w.Magazine ?? 1, reload: w.Name === 'Epitaph' ? 0 : round(w.Reload ?? 0), ...(/^Vectis( Prime)?$/.test(w.Name ?? '') ? { quickReload: 1 } : {}), ammo: w.AmmoMax ?? null, trigger: w.Trigger ?? '',
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
  // The wiki names a gun with a melee form "Vinquibus (Primary)", and its melee "Vinquibus (Melee)".
  const w = wiki[name.toLowerCase()] ?? wiki[`${name.toLowerCase()} (${cls === 'melee' ? 'melee' : 'primary'})`];
  // Kitgun chambers have no stats of their own (the grip and loader decide), so they stay out.
  if (!w || !w.Attacks?.some((/** @type {any} */ a) => Object.values(a.Damage ?? {}).some(v => /** @type {number} */ (v) > 0))) { missing.push(name); continue; }
  out[name] = cls === 'melee' ? compactMelee(w) : compact(w);
}
// Cross-check: Underframe's is_progenitor flag against the wiki's traits.
{
  const flagged = new Set(/** @type {any[]} */ (underframe.data.weapons).filter(w => w.is_progenitor).map(w => w.name));
  const ours = Object.keys(out).filter(k => out[k].adversary);
  const differ = [...ours.filter(k => !flagged.has(k)), ...Object.keys(out).filter(k => flagged.has(k) && !out[k].adversary)];
  console.log(`Adversary weapons: ${ours.length}${differ.length ? `; differ from Underframe: ${differ.join(', ')}` : ', as Underframe has'}`);
}
if (missing.length) console.warn(`Weapons with no wiki stats (${missing.length}): ${missing.join(', ')}`);

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
// Don't edit by hand. Melee weapons have their normal attack as the one mode, and a melee block.
//
// Per weapon: magazine, reload (s), max ammo, trigger, a few compatibility tags, whether it's an
// adversary weapon (Kuva, Tenet, Coda: it has a Valence bonus), the default fire
// mode, and each mode: fire rate, ammo per shot, charge time, the share of its damage a beam starts a target on, and its parts (an attack and what
// hangs off it, e.g. a projectile and its explosion), each with damage by type, crit chance, crit
// multiplier, status chance, multishot, forced procs and whether it's an area attack. Melee: follow
// through, range and sweep radius (m), combo duration (s), heavy attack damage and wind up, and
// each melee attack's falloff where it has one (start and end range, the share it loses).

export const WEAPON_STATS_UPDATED = '${date}';

/**
 * @typedef {{name: string, dmg: Record<string, number>, cc: number, cd: number, sc: number, ms: number, forced?: string[], aoe?: number, pt?: number, hs?: number, ccFlat?: number, nonCrit?: {chance: number, mult: number}, co?: number[], falloff?: {from: number, to: number, cut: number}}} Part
 * @typedef {{name: string, rate: number, cost: number, charge?: number, held?: number, chain?: {links: number, range: number, share: number, flat?: number, beams?: number}, parts: Part[]}} Mode
 * @typedef {{ft: number, range: number, sweep: number, combo: number, heavy: number, windUp: number}} Melee
 * @typedef {{kind: string, mag: number, reload: number, quickReload?: number, ammo: number | null, trigger: string, tags: string[], adversary?: boolean, main: number, modes: Mode[], bonus?: {fireRate?: number, reloadSpeed?: number}, melee?: Melee}} WeaponStats
 */

/** @type {Record<string, WeaponStats>} */
export const WEAPON_STATS = {
${Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}
};
`);
console.log(`Wrote ${Object.keys(out).length} weapons`);
