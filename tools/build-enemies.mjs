// Regenerates src/data/enemies.js (what the damage model needs about its targets): each faction's
// damage weaknesses from the wiki's Module:DamageTypes/data (Update 36's faction types), and the
// units, with base level, health, shields, armor and Overguard, from Underframe's codex-based
// presets. Run by hand when enemies change:
//   node tools/build-enemies.mjs [--offline]
// Level scaling lives in src/enemies.js; this checks its coefficients against the wiki's Enemy
// Level Scaling page.

import { writeFile } from 'node:fs/promises';
import { cachedText, cachedJson } from './lib/cache.mjs';
import { parseLua } from './lib/lua.mjs';
import { SCALING } from '../src/enemies.js';

/** The faction (for Bane mods and weak points, src/sim.js FACTIONS) of each of Underframe's faction names. */
const BANE = /** @type {Record<string, string>} */ ({
  grineer: 'grineer', 'kuva grineer': 'grineer', corpus: 'corpus', 'corpus amalgam': 'corpus',
  infested: 'infested', 'infested deimos': 'infested', orokin: 'orokin', scaldra: 'scaldra',
  techrot: 'techrot', 'the murmur': 'murmur',
});
// Left out: Narmer, Sentient, Zariman and the odd one-offs (no Bane mod of their own).

/** The wiki's damage types we model, by its names. */
const TYPES = ['Impact', 'Puncture', 'Slash', 'Cold', 'Electricity', 'Heat', 'Toxin', 'Blast', 'Corrosive', 'Gas',
  'Magnetic', 'Radiation', 'Viral', 'Void', 'Tau'];

/** Each Bane faction's usual unit, the default target. */
const DEFAULT_UNIT = {
  grineer: 'Heavy Gunner', corpus: 'Elite Crewman', infested: 'Ancient Healer', orokin: 'Corrupted Heavy Gunner',
  scaldra: 'Scaldra Screamer', techrot: 'Techrot Scaart', murmur: 'Lumbering Fragment',
};

// Weaknesses: each damage type lists the health types it does more (Positives) or less (Negatives)
// to. Since Update 36 those are factions, and the module's own script reads a bare name as 50%.
const { data: typesLua } = await cachedText('wiki-damagetypes', 'lua', 'https://wiki.warframe.com/w/Module:DamageTypes/data?action=raw', {
  validate: text => { try { return parseLua(text, 'local DamageTypes =').Types?.Heat ? null : 'no Types.Heat'; } catch (e) { return String(e); } },
});
const damageTypes = parseLua(typesLua, 'local DamageTypes =').Types;
/** @type {Record<string, Record<string, number>>} faction (the wiki's name) → damage type → modifier */
const weak = {};
for (const type of TYPES) {
  const t = damageTypes[type];
  if (!t) throw new Error(`Module:DamageTypes/data has no ${type}`);
  for (const [list, sign] of /** @type {const} */ ([['Positives', 1], ['Negatives', -1]])) {
    for (const entry of t[list] ?? []) {
      const [name, pct] = typeof entry === 'string' ? [entry, 50] : entry;
      (weak[name] ??= {})[type.toLowerCase()] = sign * pct / 100;
    }
  }
}

// Check the scaling coefficients in src/enemies.js against the wiki page's formulas.
const { data: scalingPage } = await cachedText('wiki-enemy-level-scaling', 'wiki', 'https://wiki.warframe.com/w/Enemy_Level_Scaling?action=raw', {
  validate: text => (text.includes('Base Level') ? null : 'no formulas'),
});
const formula = (/** @type {number[]} */ [c, e]) => `1 + ${c}(x - \\text{Base Level})^${Number.isInteger(e) ? e : `{${e}}`}`;
const unseen = Object.entries(SCALING).flatMap(([stat, byGroup]) => Object.entries(byGroup).flatMap(([group, curves]) =>
  curves.filter(cur => !scalingPage.includes(formula(cur))).map(cur => `${stat} ${group}: ${formula(cur)}`)));
if (unseen.length) console.warn(`Scaling not on the wiki page (it changed?):\n  ${unseen.join('\n  ')}`);
else console.log('Level scaling agrees with the wiki page');

const underframe = await cachedJson('underframe', 'https://www.underframe.site/api/data', {
  validate: d => (d?.dummy_presets ? null : 'no dummy_presets'),
});
/** @type {Record<string, any>} */
const presets = underframe.data.dummy_presets;
/** @type {Record<string, any[]>} */
const units = {};
for (const [name, p] of Object.entries(presets)) {
  const faction = BANE[String(p.faction).toLowerCase()];
  if (!faction || !(p.base_hp > 0)) continue;
  // The wiki's faction for weaknesses: "Kuva Grineer", "Infested Deimos"… differ from their Bane faction.
  const types = { grineer: 'Grineer', 'kuva grineer': 'Kuva Grineer', corpus: 'Corpus', 'corpus amalgam': 'Corpus Amalgam',
    infested: 'Infested', 'infested deimos': 'Infested Deimos', orokin: 'Orokin', scaldra: 'Scaldra', techrot: 'Techrot',
    'the murmur': 'The Murmur' }[String(p.faction).toLowerCase()];
  (units[faction] ??= []).push({
    name, types, level: p.base_level ?? 1, health: p.base_hp, shields: p.base_shields ?? 0, armor: p.base_armor ?? 0,
    ...(p.base_overguard ? { overguard: p.base_overguard } : {}),
  });
}
for (const [f, list] of Object.entries(units)) {
  list.sort((a, b) => a.name.localeCompare(b.name));
  if (!list.some(u => u.name === DEFAULT_UNIT[/** @type {keyof typeof DEFAULT_UNIT} */ (f)])) throw new Error(`No default unit for ${f}`);
}
const used = new Set(Object.values(units).flat().map(u => u.types));

const date = new Date().toISOString().slice(0, 10);
await writeFile(new URL('../src/data/enemies.js', import.meta.url), `// @ts-check
// GENERATED by tools/build-enemies.mjs on ${date}, from the Warframe wiki's Module:DamageTypes/data
// (weaknesses) and Underframe's enemy presets (units, from DE's codex). Don't edit by hand.
//
// WEAKNESSES: per faction type, the extra (or, negative, the lost) share of damage each damage type
// does to its health. Shields: Heat does 50% less to them, Toxin skips them.
// UNITS: per Bane faction, its units at their base level (src/enemies.js scales them).

export const ENEMIES_UPDATED = '${date}';

/** @typedef {{name: string, types: string, level: number, health: number, shields: number, armor: number, overguard?: number}} Unit */

/** @type {Record<string, Record<string, number>>} */
export const WEAKNESSES = {
${Object.entries(weak).filter(([k]) => used.has(k)).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}
};

/** Damage types against shields. @type {Record<string, number>} */
export const SHIELD_WEAKNESSES = ${JSON.stringify(weak.Shield ?? {})};

/** Each faction's default target. @type {Record<string, string>} */
export const DEFAULT_UNIT = ${JSON.stringify(DEFAULT_UNIT)};

/** @type {Record<string, Unit[]>} */
export const UNITS = {
${Object.entries(units).map(([k, list]) => `  ${k}: [\n${list.map(u => `    ${JSON.stringify(u)},`).join('\n')}\n  ],`).join('\n')}
};
`);
console.log(`Wrote ${Object.values(units).flat().length} units; weaknesses for ${[...used].join(', ')}`);
