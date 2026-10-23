// ==UserScript==
// @name         WFM riven IPS checker
// @namespace    riven-calculator-site
// @version      2.1
// @description  Opens each weapon's warframe.market riven search and records which Impact/Puncture/Slash stats appear on its listings.
// @match        https://warframe.market/auctions/search*
// @grant        none
// ==/UserScript==

// One unfiltered search per weapon: every listing on the page is scanned for Impact, Puncture and
// Slash, as positives and negatives. A stat that appears proves the weapon can roll it. A stat
// that never appears across many listings suggests it can't; with few listings it proves nothing.
// Results are kept in localStorage. "Next" opens the next weapon; "Auto" keeps going on its own.

(() => {
  'use strict';

  // The uncertain weapons (names as warframe.market lists them, or the start of them: a name also
  // matches entries like "Dark Split-Sword (Dual Swords)").
  const CANDIDATES = ['Acceltra', 'Aegrit', 'Akarius', 'Astilla', 'Penta', 'Tysis', 'Dark Split-Sword',
    'Helstrum', 'Kuva Bramma', 'Grattler', 'Ogris', 'Seer', 'Tonkor', 'Zarr', 'Morgha', 'Nataruk',
    'Riot-848', 'Tenet Envoy', 'Tenet Spirex', 'Zymos',
    'Balla', 'Cyath', 'Dehtat', 'Dokrahm', 'Kronsh', 'Mewan', 'Ooltha', 'Plague Keewar', 'Plague Kripath',
    'Rabvee', 'Sepfahn',
    'Catchmoon', 'Gaze', 'Rattleguts', 'Tombfinger', 'Sporelacer', 'Vermisplicer',
    'Corufell', 'Vinquibus'];
  const TYPES = ['Impact', 'Puncture', 'Slash'];
  const KEY = 'ipsCheck.v2';
  const AUTO_DELAY_MS = 4000;
  const MAX_WAIT_MS = 60000;      // results can take a while to load
  const STABLE_MS = 3000;         // at the bottom of the list, wait until no new entries appear

  /**
   * @typedef {{listings: number, seen: Record<string, string>}} Result   seen: type -> '+', '-' or '+-'
   * @type {{weapons?: {slug: string, name: string}[], results: Record<string, Result>, auto?: boolean,
   *         current?: string, all?: boolean}}
   */
  const db = JSON.parse(localStorage.getItem(KEY) || '{"results":{}}');
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));

  async function wfmWeapons() {
    if (db.weapons) return db.weapons;
    const j = await (await fetch('https://api.warframe.market/v2/riven/weapons')).json();
    db.weapons = j.data.map((/** @type {any} */ w) => ({ slug: w.slug, name: w.i18n.en.name }))
      .sort((/** @type {any} */ a, /** @type {any} */ b) => a.name.localeCompare(b.name));
    save();
    return db.weapons;
  }

  /** Candidates first (each expanded to every matching entry), then everything if "All" is on. */
  async function queue() {
    const all = await wfmWeapons();
    const matches = (/** @type {string} */ n) => all.filter(w =>
      w.name.toLowerCase() === n.toLowerCase() || w.name.toLowerCase().startsWith(n.toLowerCase() + ' ('));
    const picked = CANDIDATES.flatMap(matches);
    const rest = db.all ? all.filter(w => !picked.includes(w)) : [];
    return { list: [...picked, ...rest], missing: CANDIDATES.filter(n => matches(n).length === 0) };
  }

  async function go() {
    const { list } = await queue();
    const next = list.find(w => !db.results[w.slug]);
    if (!next) { db.auto = false; save(); render(); return; }
    db.current = next.slug;
    save();
    const p = new URLSearchParams({ type: 'riven', sort_by: 'price_desc', weapon_url_name: next.slug });
    location.href = `/auctions/search?${p}`;
  }

  /**
   * Reads the listings currently rendered. The list is virtualised (only on-screen entries exist),
   * so results accumulate in `found` while the page scrolls. Positive vs negative comes from which
   * list a stat is in, not its sign: a Weapon Recoil curse shows as "+77.9%".
   * @param {Map<string, {pos: string[], neg: string[]}>} found  auction link -> stat names
   */
  function harvest(found) {
    for (const entry of document.querySelectorAll('section.auction-entry')) {
      const link = entry.querySelector('.auction-entry__name a')?.getAttribute('href');
      if (!link || found.has(link)) continue;
      const names = (/** @type {string} */ sel) =>
        [...entry.querySelectorAll(`${sel} .attribute-name`)].map(e => (e.textContent || '').trim());
      found.set(link, { pos: names('.auction-entry__positive-attributes'), neg: names('.auction-entry__negative-attributes') });
    }
  }

  /** @param {Map<string, {pos: string[], neg: string[]}>} found */
  function tally(found) {
    /** @type {Record<string, string>} */
    const seen = {};
    for (const { pos, neg } of found.values()) {
      for (const t of TYPES) {
        const cur = seen[t] || '';
        if (pos.includes(t) && !cur.includes('+')) seen[t] = '+' + cur;
        if (neg.includes(t) && !(seen[t] || '').includes('-')) seen[t] = (seen[t] || '') + '-';
      }
    }
    return seen;
  }

  function recordCurrent() {
    if (!db.current) return;
    const slug = db.current;
    const started = Date.now();
    /** @type {Map<string, {pos: string[], neg: string[]}>} */
    const found = new Map();
    let lastCount = -1, lastChange = Date.now();
    const timer = setInterval(() => {
      harvest(found);
      const empty = /No contracts found/.test(document.body.innerText);
      if (found.size !== lastCount) { lastCount = found.size; lastChange = Date.now(); }
      // Keep scrolling to make the virtual list render the next entries.
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 5;
      if (found.size > 0 && !atBottom) window.scrollBy(0, window.innerHeight * 0.8);
      const stable = found.size > 0 && atBottom && Date.now() - lastChange >= STABLE_MS;
      if (!empty && !stable) {
        if (Date.now() - started < MAX_WAIT_MS) return;
        // Never saw listings or "No contracts found" (a Cloudflare check, an error page): record
        // nothing and stop, so it can't be mistaken for "no listings".
        clearInterval(timer);
        db.auto = false;
        save();
        render();
        return;
      }
      clearInterval(timer);
      db.results[slug] = { listings: found.size, seen: tally(found) };
      db.current = undefined;
      save();
      render();
      if (db.auto) setTimeout(go, AUTO_DELAY_MS);
    }, 500);
  }

  async function summary() {
    const { list, missing } = await queue();
    const lines = ['weapon | listings | ' + TYPES.join(' | ')];
    for (const w of list) {
      const r = db.results[w.slug];
      if (!r) { lines.push(`${w.name} | not checked`); continue; }
      lines.push(`${w.name} | ${r.listings} | ` + TYPES.map(t => r.seen[t] || '.').join(' | '));
    }
    if (missing.length) lines.push('', 'Not on warframe.market under these names: ' + missing.join(', '));
    return lines.join('\n');
  }

  /** @type {HTMLDivElement | undefined} */
  let box;
  async function render() {
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;top:70px;right:8px;width:380px;z-index:99999;background:#111;'
        + 'color:#ddd;border:1px solid #444;border-radius:6px;padding:8px;font:12px monospace';
      document.body.append(box);
    }
    const { list } = await queue();
    const done = list.filter(w => db.results[w.slug]).length;
    const head = document.createElement('div');
    head.textContent = `IPS check: ${done}/${list.length} weapons (+ positive, - negative, . not seen)`;
    const btn = (/** @type {string} */ t, /** @type {() => void} */ f) => {
      const b = document.createElement('button');
      b.textContent = t;
      b.style.cssText = 'margin:6px 6px 6px 0;padding:2px 8px';
      b.onclick = f;
      return b;
    };
    const ta = document.createElement('textarea');
    ta.value = await summary();
    ta.readOnly = true;
    ta.style.cssText = 'width:100%;height:380px;background:#000;color:#ddd;font:11px monospace';
    box.replaceChildren(head,
      btn('Next', () => go()),
      btn(db.auto ? 'Stop auto' : 'Auto', () => { db.auto = !db.auto; save(); render(); if (db.auto) go(); }),
      btn(db.all ? 'Candidates only' : 'All weapons', () => { db.all = !db.all; save(); render(); }),
      btn('Copy', () => navigator.clipboard.writeText(ta.value)),
      btn('Reset', () => {
        if (confirm('Clear all IPS results?')) { db.results = {}; db.auto = false; db.current = undefined; save(); render(); }
      }),
      ta);
  }

  render();
  recordCurrent();
})();
