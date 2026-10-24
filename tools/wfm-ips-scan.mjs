// Checks which Impact/Puncture/Slash stats each riven weapon can roll, from warframe.market
// listings. Run by hand:
//   node tools/wfm-ips-scan.mjs            every riven weapon on warframe.market (~30+ min)
//   node tools/wfm-ips-scan.mjs Acceltra Zarr     just these (names as warframe.market lists them)
//
// Per weapon: one unfiltered search (up to 100 listings) shows which stats appear. Each stat not
// seen there gets a filtered search (as a positive, then as a negative), which covers every
// listing, so "none with either sign" is strong evidence the weapon can't roll it.
// Progress is saved to tools/data/wfm-ips.json after every weapon, so a re-run resumes.

import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://api.warframe.market';
// The same headers WFM_Pricer uses; a non-default User-Agent gets past Cloudflare.
const HEADERS = {
  'User-Agent': 'riven-calculator-ips-scan', Platform: 'pc', Language: 'en', Crossplay: 'true', Accept: 'application/json',
};
const DELAY_MS = 2500;   // ~1 request per second still trips warframe.market's limit
const STATS = { impact: 'impact_damage', puncture: 'puncture_damage', slash: 'slash_damage' };
const OUT = new URL('./data/wfm-ips.json', import.meta.url);

const sleep = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));

/** @param {string} path */
async function get(path) {
  for (let attempt = 0; ; attempt++) {
    await sleep(DELAY_MS);
    const r = await fetch(API + path, { headers: HEADERS });
    if (r.status === 429 && attempt < 5) {
      const wait = Number(r.headers.get('retry-after') || 30) * 1000;
      console.warn(`  rate limited, waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} for ${path}`);
    return r.json();
  }
}

/** @param {Record<string, string>} params @returns {Promise<any[]>} */
async function search(params) {
  const q = new URLSearchParams({ type: 'riven', ...params });
  return (await get(`/v1/auctions/search?${q}`)).payload.auctions;
}

/** @type {Record<string, any>} */
let results = {};
try { results = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

const weapons = (await get('/v2/riven/weapons')).data;
const wanted = process.argv.slice(2).map(s => s.toLowerCase());
const todo = weapons
  .filter((/** @type {any} */ w) => !wanted.length || wanted.includes(w.i18n.en.name.toLowerCase()))
  .filter((/** @type {any} */ w) => !results[w.slug]);
console.log(`${todo.length} weapons to scan (${Object.keys(results).length} already done)`);

for (const [i, w] of todo.entries()) {
  const name = w.i18n.en.name;
  const listings = await search({ weapon_url_name: w.slug, sort_by: 'price_desc' });
  /** @type {Record<string, string>} '+', '-', '+-', or '' (not seen anywhere) */
  const seen = { impact: '', puncture: '', slash: '' };
  const add = (/** @type {string} */ k, /** @type {string} */ sign) => { if (!seen[k].includes(sign)) seen[k] = sign === '+' ? sign + seen[k] : seen[k] + sign; };
  for (const a of listings) {
    for (const attr of a.item.attributes) {
      for (const [k, slug] of Object.entries(STATS)) if (attr.url_name === slug) add(k, attr.positive ? '+' : '-');
    }
  }
  // Filtered searches only for stats the sample didn't show, and only if the weapon has listings.
  /** @type {Record<string, boolean>} */
  const searched = {};
  if (listings.length) {
    for (const [k, slug] of Object.entries(STATS)) {
      if (seen[k]) continue;
      searched[k] = true;
      if ((await search({ weapon_url_name: w.slug, positive_stats: slug })).length) { add(k, '+'); continue; }
      if ((await search({ weapon_url_name: w.slug, negative_stats: slug })).length) add(k, '-');
    }
  }
  results[w.slug] = { name, gameRef: w.gameRef, rivenType: w.rivenType, listings: listings.length, ...seen, searched };
  await writeFile(OUT, JSON.stringify(results, null, 1));
  const show = (/** @type {string} */ k) => seen[k] || (searched[k] ? 'none' : '?');
  console.log(`[${i + 1}/${todo.length}] ${name}: ${listings.length} listings | I ${show('impact')} | P ${show('puncture')} | S ${show('slash')}`);
}
console.log(`Saved ${Object.keys(results).length} weapons to tools/data/wfm-ips.json`);
