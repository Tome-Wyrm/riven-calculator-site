// Regenerates src/data/weapon-stats.js (what the damage model needs about each gun) from the wiki's
// weapon data modules. Run by hand when weapons change:
//   node tools/build-weapon-stats.mjs [--offline]
// The output is committed, so the site never fetches at runtime. Melee isn't included: the damage
// model covers guns only.

import { writeFile } from 'node:fs/promises';
import { cachedText, cachedJson } from './lib/cache.mjs';
import { WEAPONS } from '../src/data/weapons.js';

const WIKI = 'https://wiki.warframe.com/w/Module:Weapons/data/';
const MODULES = ['primary', 'secondary', 'archwing', 'companion'];

/**
 * Reads a Lua data module (`return { ... }`: tables, strings, numbers, booleans, comments) into
 * plain values. A table with only positional entries becomes an array.
 * @param {string} src
 */
function parseLua(src) {
  let i = 0;
  const fail = (/** @type {string} */ msg) => { throw new Error(`${msg} at ${src.slice(i, i + 40)}`); };
  const skip = () => {
    for (;;) {
      while (/\s/.test(src[i] ?? '')) i++;
      if (src.startsWith('--[[', i)) { i = src.indexOf(']]', i) + 2; continue; }
      if (src.startsWith('--', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
      return;
    }
  };
  const string = () => {
    const q = src[i++];
    let s = '';
    while (src[i] !== q) {
      if (src[i] === '\\') { i++; s += { n: '\n', t: '\t' }[src[i]] ?? src[i]; } else s += src[i];
      i++;
    }
    i++;
    return s;
  };
  /** @returns {any} */
  const value = () => {
    skip();
    const c = src[i];
    if (c === '{') return table();
    if (c === '"' || c === "'") return string();
    const m = src.slice(i, i + 40).match(/^(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|true|false|nil|math\.huge)/);
    if (!m) fail('Unexpected value');
    i += m[0].length;
    return { true: true, false: false, nil: null, 'math.huge': Infinity }[m[0]] ?? Number(m[0]);
  };
  const table = () => {
    i++;                                                    // {
    /** @type {Record<string, any>} */
    const named = {};
    const list = [];
    for (;;) {
      skip();
      if (src[i] === '}') { i++; break; }
      let key = null;
      if (src[i] === '[') {
        i++; skip(); key = String(value()); skip();
        if (src[i] !== ']') fail('Expected ]');
        i++; skip(); i++;                                   // ] =
      } else {
        const m = src.slice(i).match(/^([A-Za-z_]\w*)\s*=(?!=)/);
        if (m) { key = m[1]; i += m[0].length; }
      }
      const v = value();
      if (key === null) list.push(v); else named[key] = v;
      skip();
      if (src[i] === ',' || src[i] === ';') i++;
    }
    return Object.keys(named).length ? named : list;
  };
  skip();
  if (!src.startsWith('return', i)) fail('Expected return');
  i += 6;
  return value();
}

const lower = (/** @type {Record<string, number>} */ d) => Object.fromEntries(Object.entries(d ?? {}).filter(([, v]) => v).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]));
const round = (/** @type {number} */ x) => Math.round(x * 1e4) / 1e4;

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
 * CO isn't copied to explosions).
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
if (missing.length) console.warn(`Guns with no wiki stats (${missing.length}): ${missing.join(', ')}`);

const date = new Date().toISOString().slice(0, 10);
await writeFile(new URL('../src/data/weapon-stats.js', import.meta.url), `// @ts-check
// GENERATED by tools/build-weapon-stats.mjs from the Warframe wiki's Module:Weapons/data on ${date}.
// Don't edit by hand. Guns only (the damage model doesn't cover melee).
//
// Per weapon: magazine, reload (s), max ammo, trigger, a few compatibility tags, the default fire
// mode, and each mode: fire rate, ammo per shot, charge time, and its parts (an attack and what
// hangs off it, e.g. a projectile and its explosion), each with damage by type, crit chance, crit
// multiplier, status chance, multishot, forced procs and whether it's an area attack.

export const WEAPON_STATS_UPDATED = '${date}';

/**
 * @typedef {{name: string, dmg: Record<string, number>, cc: number, cd: number, sc: number, ms: number, forced?: string[], aoe?: number, co?: number[]}} Part
 * @typedef {{name: string, rate: number, cost: number, charge?: number, parts: Part[]}} Mode
 * @typedef {{kind: string, mag: number, reload: number, ammo: number | null, trigger: string, tags: string[], main: number, modes: Mode[]}} WeaponStats
 */

/** @type {Record<string, WeaponStats>} */
export const WEAPON_STATS = {
${Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}
};
`);
console.log(`Wrote ${Object.keys(out).length} guns`);
