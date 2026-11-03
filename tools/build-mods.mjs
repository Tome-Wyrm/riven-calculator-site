// Regenerates src/data/mods.js: the gun mods the build simulator can use, at max rank, as effects.
//   node tools/build-mods.mjs [--offline]
//
// Sources (each cached locally by tools/lib/cache.mjs, in case it changes or goes away):
//  - Numbers: DE's Public Export via WFCD warframe-items (Mods.json keeps every rank's stat text).
//  - Released or not: warframe-public-export-plus (calamity-inc) flags entries as frivolous or leaves
//    out their introduction date; such a mod is dropped unless Underframe has it too (a live build
//    site only lists real mods). PE++ has no stat values for mods.
//  - Which mods can't be equipped together: Underframe's game data (incompatible_mods).
//  - Check: Underframe's per-rank upgrade values, × (max rank + 1), against the text we read.
//    Disagreements are printed; settle them in game, and record the answer in
//    tools/data/in-game-checks.json, which overrides every source.

import { readFile, writeFile } from 'node:fs/promises';
import { cachedJson } from './lib/cache.mjs';
import { readStats } from './lib/mod-text.mjs';

/** Mods for these compat names apply to a whole class (or a slice of one: snipers, bows…). */
const CLASS_COMPAT = ['Rifle', 'Assault Rifle', 'Sniper', 'Bow', 'PRIMARY', 'Shotgun', 'Pistol', 'Archgun'];

const wfcd = await cachedJson('wfcd-mods', 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Mods.json', {
  validate: d => (Array.isArray(d) && d.some(m => m.levelStats?.length) ? null : 'no mods with levelStats'),
});
const uf = await cachedJson('underframe', 'https://www.underframe.site/api/data', {
  validate: d => (Array.isArray(d?.mods) && Array.isArray(d?.incompatible_mods) ? null : 'no mods / incompatible_mods'),
});

const pepp = await cachedJson('pepp-upgrades', 'https://raw.githubusercontent.com/calamity-inc/warframe-public-export-plus/senpai/ExportUpgrades.json', {
  validate: d => (d && typeof d === 'object' && Object.keys(d).length > 1000 ? null : 'too few upgrades'),
});
/** @type {{mods: Record<string, {checked: string, exists: boolean, stats?: 'confirmed' | 'unconfirmed', note?: string}>}} */
const inGame = JSON.parse(await readFile(new URL('./data/in-game-checks.json', import.meta.url), 'utf8'));

/** Underframe's mods by "name|compat", and incompatibilities by name. */
// Names are matched ignoring case: DE writes "Bane Of Grineer", Underframe "Bane of Grineer".
const lc = (/** @type {string} */ s) => s.toLowerCase();
const ufMods = new Map(/** @type {any[]} */ (uf.data.mods).map(m => [lc(`${m['Local Name']}|${m['Compat Name']}`), m]));
const ufNames = new Set(/** @type {any[]} */ (uf.data.mods).map(m => lc(m['Local Name'])));

// Conclave, Flawed (Beginner / Intermediate) and riven entries aren't part of a real build. Nor are
// the export's 10-rank "Expert" copies under an ordinary name (".../Expert/WeaponFireIterationsModExpert"
// is "Split Chamber" at +165%): unreleased. Released Expert mods are named "Primed …", but not every
// "Primed …" is released (Primed Blunderbuss isn't): see released().
const candidates = /** @type {any[]} */ (wfcd.data).filter(m => CLASS_COMPAT.includes(m.compatName)
  && !/PvP|Conclave|Beginner|Intermediate|Riven/i.test(m.uniqueName) && m.levelStats?.length
  && !(/\/Expert\//.test(m.uniqueName) && !/^Primed /.test(m.name)));

const unreleased = [];
const doubtful = [];
/**
 * Whether a mod is in the game: the in-game record if there is one; otherwise unless PE++ flags it
 * (frivolous, or no introduction date) and Underframe doesn't list it. Flagged ones Underframe has
 * are kept, and listed as worth a look.
 * @param {any} m
 */
function released(m) {
  const seen = inGame.mods[m.name];
  if (seen) return seen.exists;
  const p = /** @type {any} */ (pepp.data)[m.uniqueName];
  const flagged = !p || p.isFrivolous || !p.introducedAt;
  if (!flagged) return true;
  if (ufNames.has(lc(m.name))) { doubtful.push(m.name); return true; }
  return false;
}
const mods = candidates.filter(m => released(m) || (unreleased.push(m.name), false));
const ufIncompat = new Map(/** @type {any[]} */ (uf.data.incompatible_mods).map(x => [lc(x['Local Name']), x['Incompatible Mods']]));

// Underframe's upgrade types → our stat ids. Elements and factions are told apart by damage type / text.
const UPGRADE = {
  WEAPON_DAMAGE_AMOUNT: 'damage', WEAPON_PROC_CHANCE: 'statusChance', WEAPON_RELOAD_SPEED: 'reloadSpeed',
  WEAPON_FIRE_RATE: 'fireRate', WEAPON_CLIP_MAX: 'magazine', WEAPON_FIRE_ITERATIONS: 'multishot',
  WEAPON_RECOIL: 'recoil', WEAPON_PUNCTURE_DEPTH: 'punchThrough', WEAPON_CRIT_CHANCE: 'critChance',
  WEAPON_CRIT_DAMAGE: 'critDamage', WEAPON_PROC_TIME: 'statusDuration', WEAPON_PROJECTILE_SPEED: 'projectileSpeed',
  WEAPON_EXPLOSION_RADIUS: 'blastRange', WEAPON_PROC_DAMAGE: 'statusDamage', WEAPON_DAMAGE_WEAKPOINT: 'weakpointDamage',
  WEAPON_CRIT_CHANCE_WEAKPOINT: 'weakpointCrit', WEAPON_CHARGE_RATE: 'chargeRate',
  WEAPON_HEADSHOT_MULTIPLIER: 'headshotMultiplier', WEAPON_AMMO_MAX: 'ammoMax', WEAPON_ZOOM: 'zoom',
  WEAPON_RANGE: 'range', WEAPON_PROJECTILE_EXPLOSION_CHANCE: 'explodeChance',
};
/** Underframe's faction names (from the game's text tags) → ours. */
const FACTION = { corrupted: 'orokin', murmurs: 'murmur' };
const DAMAGE_TYPE = {
  DT_FIRE: 'heat', DT_FREEZE: 'cold', DT_ELECTRICITY: 'electricity', DT_POISON: 'toxin', DT_RADIATION: 'radiation',
  DT_MAGNETIC: 'magnetic', DT_VIRAL: 'viral', DT_CORROSIVE: 'corrosive', DT_GAS: 'gas', DT_EXPLOSION: 'blast',
  DT_IMPACT: 'impact', DT_PUNCTURE: 'puncture', DT_SLASH: 'slash',
};

/** Underframe's unconditional stats for a mod at max rank, as {stat: value}; unknown types noted. @param {any} m */
function ufStats(m) {
  /** @type {Record<string, number>} */
  const out = {};
  const unknown = [];
  const ranks = Number(m['Fusion Limit']) + 1;
  for (const s of m.Stats ?? []) {
    let stat = UPGRADE[/** @type {keyof typeof UPGRADE} */ (s.UpgradeType)];
    if (s.UpgradeType === 'WEAPON_PERCENT_BASE_DAMAGE_ADDED') stat = DAMAGE_TYPE[/** @type {keyof typeof DAMAGE_TYPE} */ (s.DamageType)];
    if (s.UpgradeType === 'GAMEPLAY_FACTION_DAMAGE') {
      const f = (String(s.LocTag).match(/Faction\w*Damage(\w+?)Desc$/)?.[1] ?? '').toLowerCase();
      stat = FACTION[/** @type {keyof typeof FACTION} */ (f)] ?? f;
    }
    if (!stat) { unknown.push(`${s.UpgradeType}/${s.DamageType}`); continue; }
    out[stat] = (out[stat] ?? 0) + Number(s.Value) * ranks;
  }
  return { out, unknown };
}

/** Stats that change damage, where a value missing on either side matters. */
const DPS_STATS = new Set(['damage', 'multishot', 'critChance', 'critDamage', 'statusChance', 'statusDuration',
  'statusDamage', 'fireRate', 'magazine', 'reloadSpeed', 'heat', 'cold', 'electricity', 'toxin', 'radiation',
  'magnetic', 'viral', 'corrosive', 'gas', 'blast', 'impact', 'puncture', 'slash', 'weakpointDamage',
  'weakpointCrit', 'headshotMultiplier', 'directDamage', 'grineer', 'corpus', 'infested', 'orokin', 'murmur']);

/** Underframe's conditional mods (Galvanized, aiming, on-kill…) by name: their details. */
const ufCond = new Map([...uf.data.conditionals.galvanized_mods, ...uf.data.conditionals.misc_mods]
  .filter(x => x.details).map(x => [lc(x.name), x.details]));

/** Our spelling of each mod name. */
const ourName = new Map(mods.map(m => [lc(m.name), m.name]));

const rows = [];
const notes = [];
const mismatches = [];
const unchecked = [];
const condUnchecked = [];
const seen = new Set();
for (const m of mods) {
  const key = `${m.name}|${m.compatName}`;
  if (seen.has(key)) continue;
  seen.add(key);
  // levelStats can run past the mod's max rank: take the max rank's entry, not the last.
  const { effects, notes: unread } = readStats(m.levelStats[Math.min(m.fusionLimit, m.levelStats.length - 1)].stats);
  if (unread.length) notes.push(`${m.name}: ${unread.join(' / ')}`);

  const other = ufMods.get(lc(key));
  if (!other) { if (inGame.mods[m.name]?.stats !== 'confirmed') unchecked.push(m.name); }
  else {
    const { out, unknown } = ufStats(other);
    const plainFx = effects.filter(e => !e.on && !e.aim);
    const condFx = effects.filter(e => e.on || e.aim);
    const near = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) <= Math.max(0.006, Math.abs(a) * 0.01);
    // Plain stats against Underframe's stat list. It also lists some conditional stats there
    // (while aiming, on a weak point hit): a conditional of ours with that value matches too.
    /** @type {Record<string, number>} */
    const ours = Object.fromEntries(plainFx.map(e => [e.stat, e.value]));
    for (const stat of new Set([...Object.keys(ours), ...Object.keys(out)])) {
      const a = ours[stat], b = out[stat];
      // (Underframe may store a stacking one fully stacked: Split Flights +100% x4 as +400%.)
      if (a === undefined && b !== undefined && condFx.some(e => e.stat === stat && (near(e.value, b) || near(e.value * (e.stacks ?? 1), b)))) continue;
      // Underframe leaves out stats that don't change damage (ammo, zoom, accuracy…): only a
      // value both sides have, or a damage stat one side lacks, is a disagreement.
      if ((a === undefined || b === undefined) && !DPS_STATS.has(stat)) continue;
      if (a === undefined || b === undefined || !near(a, b)) {
        mismatches.push(`${m.name}: ${stat} ours ${a ?? '—'}, Underframe ${b === undefined ? '—' : Math.round(b * 1e4) / 1e4}`);
      }
    }
    if (unknown.length) mismatches.push(`${m.name}: Underframe types we don't map: ${unknown.join(', ')}`);
    // Conditional stats against Underframe's conditionals table (per-rank bonus, stacks, duration).
    const cond = ufCond.get(lc(m.name));
    for (const e of condFx) {
      if (Object.prototype.hasOwnProperty.call(out, e.stat) && (near(e.value, out[e.stat]) || near(e.value * (e.stacks ?? 1), out[e.stat]))) continue;
      if (!cond?.bonus_per_rank) { if (inGame.mods[m.name]?.stats !== 'confirmed') condUnchecked.push(`${m.name} (${e.stat})`); continue; }
      const value = cond.bonus_per_rank * (m.fusionLimit + 1);
      const fits = condFx.some(x => near(x.value, value)
        && (!cond.max_stacks || !x.stacks || x.stacks === cond.max_stacks)
        && (!cond.duration_seconds || !x.seconds || x.seconds === cond.duration_seconds));
      if (!fits) mismatches.push(`${m.name}: conditional ${e.stat} ours ${e.value} (${e.stacks ?? 1}x, ${e.seconds ?? '—'}s), Underframe ${Math.round(value * 1e4) / 1e4} (${cond.max_stacks ?? 1}x, ${cond.duration_seconds ?? '—'}s)`);
    }
  }

  // In our spelling where we have the mod (Underframe's otherwise); Flawed mods aren't in the table.
  const excl = (ufIncompat.get(lc(m.name)) ?? []).filter((/** @type {string} */ n) => !/^Flawed /.test(n))
    .map((/** @type {string} */ n) => ourName.get(lc(n)) ?? n);
  rows.push({
    name: m.name, compat: m.compatName, drain: m.baseDrain, rank: m.fusionLimit,
    effects, ...(unread.length ? { notes: unread } : {}), ...(excl.length ? { excl } : {}),
    ...(m.isExilus ? { exilus: 1 } : {}),
    ...(inGame.mods[m.name]?.stats === 'confirmed' ? { ingame: 1 } : {}),
  });
}
rows.sort((a, b) => a.compat.localeCompare(b.compat) || a.name.localeCompare(b.name));

console.log(`${rows.length} mods (DE export ${wfcd.fromCache ? `cached ${wfcd.fetched}` : 'fresh'}; Underframe ${uf.fromCache ? `cached ${uf.fetched}` : 'fresh'})`);
console.log(`Dropped as unreleased (${unreleased.length}): ${unreleased.join(', ')}`);
console.log(`Flagged by PE++ but listed by Underframe, kept (worth a look in game) (${doubtful.length}): ${doubtful.join(', ')}`);
console.log(`Confirmed in game: ${Object.values(inGame.mods).filter(x => x.stats === 'confirmed').length}`);
console.log(`Not in Underframe's data and not confirmed in game (unchecked): ${unchecked.length}${unchecked.length ? `: ${unchecked.join(', ')}` : ''}`);
console.log(`Conditional stats Underframe has nothing on (unchecked): ${condUnchecked.length}${condUnchecked.length ? `: ${condUnchecked.join(', ')}` : ''}`);
console.log(`Disagreements with Underframe (${mismatches.length}):\n  ${mismatches.join('\n  ')}`);
console.log(`Lines not read (${notes.length}), kept as notes:\n  ${notes.join('\n  ')}`);

const date = new Date().toISOString().slice(0, 10);
await writeFile(new URL('../src/data/mods.js', import.meta.url), `// @ts-check
// GENERATED by tools/build-mods.mjs on ${date}. Don't edit by hand.
// Gun mods at max rank: numbers from DE's Public Export (via WFCD warframe-items), mods that can't
// be equipped together from Underframe's game data, values cross-checked against Underframe's.
//
// effects: raw values (+165% → 1.65, x1.55 faction → 0.55); conditional ones say when:
// on (trigger), aim (only while aiming), seconds, stacks, per ("status type").
// notes: stat lines not read into effects. excl: mods it can't be equipped with.

export const MODS_UPDATED = '${date}';

/**
 * @typedef {import('../../tools/lib/mod-text.mjs').Effect} Effect
 * @typedef {{name: string, compat: string, drain: number, rank: number, effects: Effect[], notes?: string[], excl?: string[], exilus?: 1}} Mod
 */

/** @type {Mod[]} */
export const GUN_MODS = [
${rows.map(r => `  ${JSON.stringify(r)},`).join('\n')}
];
`);
