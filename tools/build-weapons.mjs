// Regenerates src/data/weapons.js from WFCD warframe-items. Run by hand when new weapons release:
//   node tools/build-weapons.mjs
// The output is committed, so the site never fetches at runtime.

import { readFile, writeFile } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/';
const FILES = ['Primary', 'Secondary', 'Melee', 'Arch-Gun'];

// Kitguns use Pistol riven coefficients whether built as a primary or a secondary. WFCD doesn't
// list them as whole weapons, so they're named here by their chambers.
const KITGUNS = ['Catchmoon', 'Gaze', 'Rattleguts', 'Sporelacer', 'Tombfinger', 'Vermisplicer'];

// WFCD lists these as weapons, but they can't take rivens.
const NO_RIVEN = new Set(['Sirocco']);                     // the Drifter's amp

/** @param {any} w @returns {string | null} riven class, or null if the item can't take a riven */
function rivenClass(w) {
  if (w.masterable === false) return null;               // zaw parts other than strikes, etc.
  if (NO_RIVEN.has(w.name)) return null;
  switch (w.category) {
    case 'Arch-Gun': return 'archgun';
    case 'Melee': return 'melee';                        // includes zaw strikes
    case 'Secondary': return 'pistol';
    case 'Primary': return w.type === 'Shotgun' ? 'shotgun' : w.type === 'Pistol' ? 'pistol' : 'rifle';
    default: return null;
  }
}

// IPS eligibility, one letter each for Impact, Puncture, Slash: y = can roll, n = can't,
// ? = may not roll. Sources, most trusted first:
//  1. Rivens seen in game (screenshots, player data): IPS_OVERRIDES below.
//  2. The wiki's rule on the weapon's first attack: more than 25% of that type → y. When it says
//     no, that's only '?' unless the listings agree: checked against listings it said "can't" for
//     39 stats that were listed (e.g. Ocucor Impact at 0%).
//  3. warframe.market listings (tools/data/wfm-ips.json, from tools/wfm-ips-scan.mjs), which nothing
//     in game verifies: they only settle a stat the rule says no to (none in a full filtered search
//     of a family with >= 20 listings → n), or decide alone when there's no damage data.
const PHYSICAL = ['impact', 'puncture', 'slash'];
const MIN_LISTINGS_FOR_NO = 20;

/** @param {any} d @returns {number[] | null} share of each physical type, or null without data */
function shares(d) {
  if (!d) return null;
  const total = d.total || Object.entries(d).filter(([k]) => k !== 'total').reduce((s, [, v]) => s + v, 0);
  return total > 0 ? PHYSICAL.map(k => (d[k] || 0) / total) : null;
}

/** warframe.market evidence by family name (lowercase). */
const evidence = new Map();
try {
  const scan = JSON.parse(await readFile(new URL('./data/wfm-ips.json', import.meta.url), 'utf8'));
  for (const r of Object.values(scan)) evidence.set(String(r.name).toLowerCase(), r);
} catch { /* no scan yet: rule only */ }

/** Riven family of each weapon name, from the CSV. */
const familyOf = new Map();
for (const line of (await readFile(new URL('./data/internal_names.csv', import.meta.url), 'utf8')).trim().split(/\r?\n/).slice(1)) {
  const [, name, family] = line.slice(1, -1).split('","');
  familyOf.set(name, family);
}

/** @param {any} w WFCD item (or null) @param {string} name */
function ips(w, name) {
  const rule = w ? shares(w.attacks?.[0]?.damage) ?? shares(w.damage) : null;
  const family = familyOf.get(name) ?? name;
  // warframe.market names zaws and kitguns without our "(Zaw)" / "(Kitgun)" labels.
  const ev = evidence.get(family.replace(/ \((Zaw|Kitgun)\)$/, '').toLowerCase());
  const seen = IPS_OVERRIDES[/** @type {keyof typeof IPS_OVERRIDES} */ (family)] ?? '???';
  return PHYSICAL.map((t, i) => {
    if (seen[i] !== '?') return seen[i];
    const listedNo = !ev?.[t] && ev?.searched?.[t] && ev.listings >= MIN_LISTINGS_FOR_NO;
    if (rule) {
      if (rule[i] > 0.25) return 'y';
      return listedNo ? 'n' : '?';
    }
    if (ev?.[t]) return 'y';
    return listedNo ? 'n' : '?';
  }).join('');
}

// Rivens seen in game, by riven family. Each letter overrides everything else; '?' = no information.
const IPS_OVERRIDES = {
  Obex: 'y??',                    // screenshot + player data: -77.8% Impact
  Cinta: '?y?',                   // screenshot + player data: +138.4% Puncture
  Vinquibus: '?y?',               // screenshot + player data: +130.1% Puncture
  'Vinquibus (melee)': '?y?',     // screenshot + player data: +129.7% Puncture
  Exergis: '?y?',                 // screenshot: -105.9% Puncture
};

/** @type {[string, string, number, string][]} */
const rows = [];
for (const file of FILES) {
  const items = await (await fetch(BASE + file + '.json')).json();
  for (const w of items) {
    const cls = rivenClass(w);
    if (!cls) continue;
    // WFCD writes "Mk1-Braton", "Ax-52", "Efv-5 Jupiter"; the game writes MK1 / AX / EFV.
    const base = w.name.replace(/^(Mk1|Ax|Efv)-/, (/** @type {string} */ s) => s.toUpperCase());
    const name = w.type === 'Zaw Component' ? `${base} (Zaw)` : base;
    rows.push([name, cls, w.type === 'Bow' ? 1 : 0, ips(w, name)]);
  }
}
for (const k of KITGUNS) rows.push([`${k} (Kitgun)`, 'pistol', 0, ips(null, `${k} (Kitgun)`)]);

// Weapons whose second form takes its own riven, which WFCD lists only once.
rows.push(['Vinquibus (melee)', 'melee', 0, ips(null, 'Vinquibus (melee)')]);

// Weapons WFCD is missing.
rows.push(['Corufell Prime', 'melee', 0, ips(null, 'Corufell Prime')]);

// Robotic (companion) weapons take Robotic rivens, but roll with their associated class's values.
// Prime/Prisma variants inherit from the base weapon.
const ROBOTIC_CLASS = {
  Akaten: 'melee', Artax: 'rifle', Batoten: 'melee', 'Burst Laser': 'pistol', Cryotra: 'rifle',
  Deconstructor: 'melee', 'Deth Machine Rifle': 'rifle', Helstrum: 'rifle', Lacerten: 'melee',
  'Laser Rifle': 'rifle', Multron: 'rifle', Stinger: 'rifle', Sweeper: 'shotgun', Tazicor: 'rifle',
  Verglas: 'rifle', Vulcax: 'rifle', Vulklok: 'rifle',
};
const robotic = await (await fetch(BASE + 'SentinelWeapons.json')).json();
for (const w of robotic) {
  const base = w.name.replace(/^(Prime|Prisma) | Prime$/g, '');
  const cls = ROBOTIC_CLASS[/** @type {keyof typeof ROBOTIC_CLASS} */ (base)];
  if (cls) rows.push([w.name, cls, 0, ips(w, w.name)]);
  else console.warn(`Skipped robotic weapon with no class: ${w.name}`);
}

const unique = [...new Map(rows.map(r => [r[0], r])).values()].sort((a, b) => a[0].localeCompare(b[0]));
const date = new Date().toISOString().slice(0, 10);
const body = unique.map(r => `  ${JSON.stringify(r)},`).join('\n');

await writeFile(new URL('../src/data/weapons.js', import.meta.url), `// @ts-check
// GENERATED by tools/build-weapons.mjs from WFCD warframe-items on ${date}. Don't edit by hand.
// [name, riven class, isBow (fire rate rolls count double), IPS eligibility (Impact/Puncture/Slash:
// y = can roll, n = can't, ? = may not roll)]

export const WEAPONS_UPDATED = '${date}';

/** @type {[string, import('./stats.js').WeaponClass, number, string][]} */
export const WEAPONS = [
${body}
];
`);
console.log(`Wrote ${unique.length} weapons`);
