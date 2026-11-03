// Regenerates src/data/arcanes.js: the arcanes that change gun and melee damage, at max rank, as effects.
//   node tools/build-arcanes.mjs [--offline]
//
// Sources (each cached locally by tools/lib/cache.mjs):
//  - warframe-public-export-plus (calamity-inc): ExportArcanes keeps each rank's stats as text
//    templates with their values; dict.en fills the templates in. The text is then read by the same
//    reader as the mods (tools/lib/mod-text.mjs).
//  - Check: Underframe's max-rank descriptions, read the same way. Disagreements are printed;
//    settle them in game.

import { writeFile } from 'node:fs/promises';
import { cachedJson } from './lib/cache.mjs';
import { readStats } from './lib/mod-text.mjs';

const PEPP = 'https://raw.githubusercontent.com/calamity-inc/warframe-public-export-plus/senpai/';
const arcanes = await cachedJson('pepp-arcanes', `${PEPP}ExportArcanes.json`, {
  validate: d => (d && Object.keys(d).length > 100 ? null : 'too few arcanes'),
});
const dict = await cachedJson('pepp-dict-en', `${PEPP}dict.en.json`, {
  validate: d => (d && Object.keys(d).length > 10000 ? null : 'too few strings'),
});
const uf = await cachedJson('underframe', 'https://www.underframe.site/api/data', {
  validate: d => (Array.isArray(d?.arcanes) ? null : 'no arcanes'),
});
/** @type {Record<string, string>} */
const T = /** @type {any} */ (dict.data);

/**
 * A PE++ stat entry as text: the template from the dictionary with its |PLACEHOLDERS| filled in
 * (values, nested bonuses, or other dictionary entries such as the trigger's name).
 * @param {any} node @returns {string}
 */
function render(node) {
  if (typeof node === 'string') return node.startsWith('/Lotus/') ? render(T[node] ?? node) : node;
  const text = T[node.tag] ?? '';
  return text.replace(/\|(\w+)\|/g, (m, k) => (node.sub?.[k] === undefined ? m : render(node.sub[k])));
}

/** Warframe arcanes whose bonus goes to guns. */
const WARFRAME = ['Arcane Avenger', 'Arcane Rage', 'Arcane Precision', 'Arcane Velocity', 'Arcane Acceleration',
  'Arcane Tempo', 'Arcane Awakening', 'Arcane Momentum', 'Arcane Arachne', 'Arcane Pistoleer'];
/** @param {string} name @returns {'primary' | 'secondary' | 'melee' | 'warframe' | null} */
const slotOf = name => (/^(Primary|Shotgun) /.test(name) ? 'primary' : /^Secondary /.test(name) ? 'secondary'
  : /^Melee /.test(name) ? 'melee' : WARFRAME.includes(name) ? 'warframe' : null);

/**
 * Melee arcanes whose text isn't a plain stat, as the model uses them at max rank (each assumption in
 * the note). Heavy attack, finisher, roll and kill arcanes (Animosity, Assimilation, Crescendo,
 * Careen, Vortex) don't change normal attacks and stay out.
 * @type {Record<string, {effects: import('./lib/mod-text.mjs').Effect[], note: string}>}
 */
const MELEE_EFFECTS = {
  'Melee Exposure': { effects: [{ stat: 'corrosive', value: 2.4 }], note: 'At its 240% cap: abilities cast often enough to keep it stacked.' },
  'Melee Retaliation': { effects: [{ stat: 'damage', value: 4.2 }], note: 'At its 420% cap: 2,800 shields or more (not overshields).' },
  'Melee Duplicate': { effects: [{ stat: 'duplicate', value: 1 }], note: 'Each base (yellow) critical hit strikes again, rolling crit and status anew.' },
  'Melee Doughty': { effects: [{ stat: 'doughty', value: 1 }], note: '+1x Critical Damage per whole 10% of Puncture status chance (status chance x the hit’s Puncture share).' },
  'Melee Influence': { effects: [{ stat: 'influence', value: 18 }], note: 'An Electricity proc has a 20% chance to grant 18 s in which elemental procs spread to enemies within 20 m (src/fight.js).' },
  'Melee Afflictions': { effects: [{ stat: 'afflictions', value: 6 }], note: '+6 stacks of each status on an enemy knocked down or flung (the stance’s knockdown hits).' },
};

/** Underframe's arcanes by name: their max-rank text, read into effects. */
const ufArcanes = new Map(/** @type {any[]} */ (uf.data.arcanes).map(a => [a.arcane_name, readStats([a.max_rank_description])]));

const rows = [];
const mismatches = [];
const unchecked = [];
const unreadable = [];
for (const a of Object.values(/** @type {Record<string, any>} */ (arcanes.data))) {
  const name = T[a.name];
  const slot = name && slotOf(name);
  if (!slot || !a.levelStats?.length) continue;
  const lines = a.levelStats[Math.min(a.fusionLimit, a.levelStats.length - 1)].map(render);
  // "+1 Arcane Revive" is a warframe arcane's revive, not a weapon stat.
  const read = readStats(lines.filter(l => !/Arcane Revive/.test(l)));
  const hand = MELEE_EFFECTS[name];
  const { effects, notes } = hand ? { effects: hand.effects, notes: [hand.note] } : read;

  const theirs = ufArcanes.get(name);
  if (!theirs) unchecked.push(name);
  // Underframe's text we can't read (its own wording): nothing to compare, not a disagreement.
  else if (!theirs.effects.length && effects.length) unreadable.push(`${name}: ${theirs.notes.join(' / ')}`);
  else {
    // Same stats with the same value, duration and stacks (triggers are worded differently:
    // Underframe writes "On Kill/Passive" where the game writes "On Kill").
    const key = (/** @type {import('./lib/mod-text.mjs').Effect} */ e) => `${e.stat} ${Math.round(e.value * 1000) / 1000} ${e.seconds ?? ''}s x${e.stacks ?? 1}`;
    const ours = effects.map(key).sort().join(', ');
    const other = theirs.effects.map(key).sort().join(', ');
    if (ours !== other) mismatches.push(`${name}: ours [${ours}], Underframe [${other}]`);
  }
  rows.push({ name, slot, rank: a.fusionLimit, effects, ...(notes.length ? { notes } : {}) });
}
rows.sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));

console.log(`${rows.length} arcanes (PE++ ${arcanes.fromCache ? `cached ${arcanes.fetched}` : 'fresh'}; Underframe ${uf.fromCache ? `cached ${uf.fetched}` : 'fresh'})`);
console.log(`Not in Underframe's data (unchecked): ${unchecked.length}${unchecked.length ? `: ${unchecked.join(', ')}` : ''}`);
console.log(`Underframe text we couldn't read, so unchecked (${unreadable.length}):\n  ${unreadable.join('\n  ')}`);
console.log(`Disagreements with Underframe (${mismatches.length}):\n  ${mismatches.join('\n  ')}`);
console.log(`Not read into effects:\n  ${rows.filter(r => r.notes).map(r => `${r.name}: ${r.notes?.join(' / ')}`).join('\n  ')}`);

const date = new Date().toISOString().slice(0, 10);
await writeFile(new URL('../src/data/arcanes.js', import.meta.url), `// @ts-check
// GENERATED by tools/build-arcanes.mjs on ${date}. Don't edit by hand.
// Arcanes that change gun damage, at max rank: warframe-public-export-plus's stat templates filled in
// from its dictionary, read like the mods' text; cross-checked against Underframe's descriptions.
// slot: primary / secondary / melee weapon arcane, or a warframe arcane whose bonus goes to guns.
// effects: as in mods.js, plus chance (of the trigger giving it) and to (the weapons it goes to).

export const ARCANES_UPDATED = '${date}';

/**
 * @typedef {import('../../tools/lib/mod-text.mjs').Effect} Effect
 * @typedef {{name: string, slot: 'primary' | 'secondary' | 'melee' | 'warframe', rank: number, effects: Effect[], notes?: string[]}} Arcane
 */

/** @type {Arcane[]} */
export const GUN_ARCANES = [
${rows.map(r => `  ${JSON.stringify(r)},`).join('\n')}
];
`);
