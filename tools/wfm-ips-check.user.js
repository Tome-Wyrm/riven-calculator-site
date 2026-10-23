// ==UserScript==
// @name         WFM riven IPS checker
// @namespace    riven-calculator-site
// @version      1.0
// @description  Steps through warframe.market riven searches and records whether any listing has a given Impact/Puncture/Slash stat.
// @match        https://warframe.market/auctions/search*
// @grant        none
// ==/UserScript==

// For each (weapon, stat) it searches the stat as a positive first; if nothing turns up it
// searches it as the negative. Results are kept in localStorage, so page loads don't lose them.
// "Next" opens the next unchecked search; "Auto" keeps going on its own (slowly, to stay polite).

(() => {
  'use strict';

  // Grouped by stat, so the attribute stays the same while you work through a block.
  const ZAWS = ['Balla', 'Cyath', 'Dehtat', 'Dokrahm', 'Kronsh', 'Mewan', 'Ooltha', 'Plague Keewar',
    'Plague Kripath', 'Rabvee', 'Sepfahn'];
  const KITGUNS = ['Catchmoon', 'Gaze', 'Rattleguts', 'Tombfinger', 'Sporelacer', 'Vermisplicer'];
  const CHECKS = {
    impact_damage: ['Aegrit', 'Akarius', 'Penta', 'Dark Split-Sword', 'Kuva Bramma', 'Ogris', 'Zarr',
      'Morgha', 'Tenet Envoy', 'Tenet Spirex', 'Zymos', ...ZAWS, ...KITGUNS, 'Corufell', 'Vinquibus (melee)'],
    puncture_damage: ['Acceltra', 'Tysis', 'Helstrum', 'Grattler', 'Tonkor', 'Riot-848', 'Zymos',
      ...ZAWS, ...KITGUNS, 'Corufell'],
    slash_damage: ['Aegrit', 'Astilla', 'Tysis', 'Dark Split-Sword', 'Seer', 'Tonkor', 'Nataruk',
      ...ZAWS, ...KITGUNS, 'Corufell', 'Vinquibus (melee)'],
  };
  const LABEL = { impact_damage: 'Impact', puncture_damage: 'Puncture', slash_damage: 'Slash' };
  const KEY = 'ipsCheck.v1';
  const AUTO_DELAY_MS = 4000;

  /** @type {{results: Record<string, {pos?: number, neg?: number}>, slugs?: Record<string, string>, auto?: boolean, current?: string}} */
  const db = JSON.parse(localStorage.getItem(KEY) || '{"results":{}}');
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));

  const queue = Object.entries(CHECKS).flatMap(([stat, weapons]) => weapons.map(w => ({ w, stat })));
  const id = (/** @type {{w: string, stat: string}} */ q) => `${q.w}|${q.stat}`;

  async function slugs() {
    if (db.slugs) return db.slugs;
    const j = await (await fetch('https://api.warframe.market/v2/riven/weapons')).json();
    db.slugs = Object.fromEntries(j.data.map((/** @type {any} */ w) => [w.i18n.en.name.toLowerCase(), w.slug]));
    save();
    return db.slugs;
  }

  /** The next search to run: positive first, then negative if the positive found nothing. */
  function nextStep() {
    for (const q of queue) {
      const r = db.results[id(q)] || {};
      if (r.pos === undefined) return { ...q, sign: 'pos' };
      if (r.pos === 0 && r.neg === undefined) return { ...q, sign: 'neg' };
    }
    return null;
  }

  async function go() {
    const step = nextStep();
    if (!step) { db.auto = false; save(); render(); return; }
    const slug = (await slugs())[step.w.toLowerCase()];
    if (!slug) {                                   // weapon unknown to warframe.market
      db.results[id(step)] = { pos: -1, neg: -1 };
      save();
      return go();
    }
    db.current = `${id(step)}|${step.sign}`;
    save();
    const p = new URLSearchParams({ type: 'riven', weapon_url_name: slug, sort_by: 'price_desc' });
    p.set(step.sign === 'pos' ? 'positive_stats' : 'negative_stats', step.stat);
    location.href = `/auctions/search?${p}`;
  }

  /** After a search page loads, wait for results or "No contracts found", then record the count. */
  function recordCurrent() {
    if (!db.current) return;
    const [w, stat, sign] = db.current.split('|');
    const started = Date.now();
    const timer = setInterval(() => {
      const text = document.body.innerText;
      const settled = /No contracts found|Selling price|Starting Price/.test(text);
      if (!settled) {
        if (Date.now() - started < 20000) return;
        // Never saw results or "No contracts found" (a Cloudflare check, an error page, a slow load):
        // record nothing and stop, so it can't be mistaken for "none found".
        clearInterval(timer);
        db.auto = false;
        save();
        render();
        return;
      }
      clearInterval(timer);
      const count = /No contracts found/.test(text) ? 0 : (text.match(/Selling price|Starting Price/g) || []).length;
      const r = (db.results[`${w}|${stat}`] ||= {});
      r[/** @type {'pos' | 'neg'} */ (sign)] = count;
      db.current = undefined;
      save();
      render();
      if (db.auto) setTimeout(go, AUTO_DELAY_MS);
    }, 500);
  }

  function summary() {
    const lines = [];
    for (const [stat, weapons] of Object.entries(CHECKS)) {
      lines.push(`== ${LABEL[/** @type {keyof typeof LABEL} */ (stat)]} ==`);
      for (const w of weapons) {
        const r = db.results[`${w}|${stat}`];
        let v = 'not checked';
        if (r?.pos === -1) v = 'NOT ON WFM (check name)';
        else if (r?.pos > 0) v = `YES (${r.pos} with +)`;
        else if (r?.neg > 0) v = `YES (${r.neg} with -)`;
        else if (r?.pos === 0 && r?.neg === 0) v = 'none found';
        else if (r?.pos === 0) v = 'none with +, - not checked yet';
        lines.push(`${w}: ${v}`);
      }
    }
    return lines.join('\n');
  }

  let box;
  function render() {
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;top:70px;right:8px;width:340px;z-index:99999;background:#111;'
        + 'color:#ddd;border:1px solid #444;border-radius:6px;padding:8px;font:12px monospace';
      document.body.append(box);
    }
    const done = queue.filter(q => !nextStepFor(q)).length;
    box.innerHTML = '';
    const head = document.createElement('div');
    head.textContent = `IPS check: ${done}/${queue.length} done`;
    const btn = (/** @type {string} */ t, /** @type {() => void} */ f) => {
      const b = document.createElement('button');
      b.textContent = t;
      b.style.cssText = 'margin:6px 6px 6px 0;padding:2px 8px';
      b.onclick = f;
      return b;
    };
    const ta = document.createElement('textarea');
    ta.value = summary();
    ta.readOnly = true;
    ta.style.cssText = 'width:100%;height:360px;background:#000;color:#ddd;font:11px monospace';
    box.append(head,
      btn('Next', () => go()),
      btn(db.auto ? 'Stop auto' : 'Auto', () => { db.auto = !db.auto; save(); render(); if (db.auto) go(); }),
      btn('Copy', () => navigator.clipboard.writeText(ta.value)),
      btn('Reset', () => { if (confirm('Clear all IPS results?')) { db.results = {}; db.auto = false; save(); render(); } }),
      ta);
  }

  /** @param {{w: string, stat: string}} q */
  function nextStepFor(q) {
    const r = db.results[id(q)] || {};
    return r.pos === undefined || (r.pos === 0 && r.neg === undefined);
  }

  render();
  recordCurrent();
})();
