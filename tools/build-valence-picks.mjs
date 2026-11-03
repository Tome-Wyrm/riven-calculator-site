// Regenerates src/data/valence-picks.js: the Valence element each adversary weapon (Kuva, Tenet,
// Coda) is usually given, from two sources:
//  - Brozime's Lich Weapons note (publish.obsidian.md/brozime, kept current; also his tier), and
//  - the "Community" sheet of the user's own workbook, a local copy at tools/data/ValenceElements.xlsx
//    (not tracked in git; copy the workbook there to refresh it). Its "Broz" sheet is an older copy
//    of Brozime's picks, so the note stands in for it.
//   node tools/build-valence-picks.mjs [--offline]

import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cachedText } from './lib/cache.mjs';
import { readXlsx } from './lib/xlsx.mjs';
import { WEAPONS } from '../src/data/weapons.js';

const BROZIME = 'https://publish-01.obsidian.md/access/e24d3ab0728206012febd6e4fcc69c6e/Public/Guides%20%26%20Builds/Guides/Kuva%20Lich%2C%20Sisters%20of%20Parvos%2C%20%26%20Coda/Lich%20Weapons.md';
const SHEET = new URL('./data/ValenceElements.xlsx', import.meta.url);

/** The adversary weapons the site knows, by lower-case name. */
const KNOWN = new Map(WEAPONS.filter(w => /^(Kuva|Tenet|Coda|Dual Coda) /.test(w[0])).map(w => [w[0].toLowerCase(), w[0]]));
/** Names the sources spell their own way. @type {Record<string, string>} */
const ALIASES = { 'kuva chakkurr': 'Kuva Chakkhurr', 'kuva chakkhuur': 'Kuva Chakkhurr', 'coda torxica': 'Dual Coda Torxica' };
/** @param {string} name */
const weaponOf = name => {
  const key = name.replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase();
  return KNOWN.get(key) ?? ALIASES[key] ?? null;
};
/** "Electric" → electricity; anything else as its damage type id. @param {string} s */
const elementOf = s => {
  const id = s.trim().toLowerCase();
  return id === 'electric' ? 'electricity' : id;
};
const ELEMENTS = new Set(['heat', 'cold', 'electricity', 'toxin', 'impact', 'magnetic', 'radiation']);

/** @type {Record<string, {brozime?: string[], tier?: string, community?: string[]}>} */
const out = {};
const unmatched = [];
const pick = (/** @type {string} */ name, /** @type {'brozime' | 'community'} */ source, /** @type {string[]} */ elements, tier = '') => {
  const weapon = weaponOf(name);
  if (!weapon) { unmatched.push(`${source}: ${name}`); return; }
  const bad = elements.filter(e => !ELEMENTS.has(e));
  if (bad.length) throw new Error(`${name}: not a Valence element: ${bad.join(', ')}`);
  out[weapon] = { ...out[weapon], [source]: elements, ...(tier ? { tier } : {}) };
};

// Brozime: tables of "| Weapon | (Rotation |) Recommended Element | Tier |", elements as
// "Heat or Toxin" or "Heat, Magnetic, or Toxin".
const { data: note } = await cachedText('brozime-lich-weapons', 'md', BROZIME, { validate: t => (t.includes('Recommended Element') ? null : 'no element tables') });
for (const table of note.split(/\n(?=\| Weapon)/).slice(1)) {
  const [head, , ...rows] = table.split('\n').filter(l => l.startsWith('|'));
  const cols = head.split('|').slice(1, -1).map(c => c.trim());
  const [w, e, t] = ['Weapon', 'Recommended Element', 'Tier'].map(c => cols.indexOf(c));
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map(c => c.trim());
    pick(cells[w], 'brozime', cells[e].split(/,?\s+or\s+|,\s*/).filter(Boolean).map(elementOf), cells[t]);
  }
}

// The workbook's Community sheet: sections ("Kuva Lich"; "Sister of Parvos" and "Technocyte Coda"
// side by side), each a row of short names, every weapon over three columns, its elements below.
if (existsSync(SHEET)) {
  const rows = readXlsx(SHEET).get('Community') ?? [];
  /** @type {[number, string][]} where each section's columns start, and its weapons' prefix */
  let prefixes = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const titles = row.map((c, col) => /** @type {[number, string]} */ ([col, c])).filter(([, c]) => /Kuva|Sister|Tenet|Cod/i.test(c));
    if (titles.length && !row[2]) {
      prefixes = titles.map(([col, c]) => [col, /Kuva/i.test(c) ? 'Kuva' : /Sister|Tenet/i.test(c) ? 'Tenet' : 'Coda']);
      continue;
    }
    const below = rows[i + 1] ?? [];
    const names = row.map((c, col) => /** @type {[number, string]} */ ([col, c])).filter(([col, c]) => col >= 2 && c && !/^(Primary|Secondary|Melee|Archgun)$/.test(c));
    if (!names.length) continue;
    names.forEach(([col, name], j) => {
      const until = names[j + 1]?.[0] ?? col + 3;
      const elements = below.slice(col, until).filter(Boolean).map(elementOf);
      const prefix = [...prefixes].reverse().find(([start]) => col >= start)?.[1] ?? '';
      if (elements.length) pick(`${prefix} ${name}`, 'community', elements);
    });
    i++;
  }
} else console.log('No local copy of the workbook (tools/data/ValenceElements.xlsx): Brozime only');

if (unmatched.length) throw new Error(`Weapons not matched to the site's names:\n  ${unmatched.join('\n  ')}`);
const missing = [...KNOWN.values()].filter(w => !out[w]);
console.log(`Valence picks for ${Object.keys(out).length} weapons (${Object.values(out).filter(p => p.community).length} with community picks)${missing.length ? `; none for ${missing.join(', ')}` : ''}`);

const date = new Date().toISOString().slice(0, 10);
await writeFile(new URL('../src/data/valence-picks.js', import.meta.url), `// @ts-check
// GENERATED by tools/build-valence-picks.mjs on ${date}. Don't edit by hand.
// The Valence element adversary weapons are usually given: Brozime's (his Lich Weapons note, with
// his tier) and the community's (the user's workbook). Damage type ids, the first listed first.

export const VALENCE_PICKS_UPDATED = '${date}';

/** @type {Record<string, {brozime?: string[], tier?: string, community?: string[]}>} */
export const VALENCE_PICKS = {
${Object.keys(out).sort().map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(out[k])},`).join('\n')}
};
`);
