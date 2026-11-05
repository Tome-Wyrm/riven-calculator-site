// Scores the optimiser (src/study.js: each riven's value as the best build with it minus the best
// without) against the community's recommended rolls (src/picks.js), per build type and target.
// The same measures as tools/score-sim.mjs (which scores the old fixed reference build), plus how
// much of the community's first choices the best riven holds, and the curses. A check, not a
// target: read the disagreements.
//   node tools/score-optimiser.mjs [--fresh] [setting…]
// Settings (default: all): room, mix, burst, single, weak, primed, grineer, corpus. Each takes ~30 s on 11
// threads; results are kept in tools/data/cache/score-optimiser.json (not in git) and reused
// unless --fresh.

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** What each setting studies. Targets at level 150 on the Steel Path, as endgame rivens are judged; "any" is a Heavy Gunner without faction weaknesses. */
const SETTINGS = {
  room: { label: 'Room clearing, any faction, armor stripped', scenario: 'room', opts: { enemy: '' } },
  burst: { label: 'Room clearing, any faction, armor stripped, burst (no reloads)', scenario: 'room', opts: { enemy: '', burst: true } },
  mix: { label: 'Room clearing, the Grineer battlegroup without weaknesses, armor stripped', scenario: 'room', opts: { enemy: '' }, mix: true },
  single: { label: 'Single target, any faction, armor stripped', scenario: 'single', opts: { enemy: '' } },
  weak: { label: 'Weak points, any faction, armor stripped', scenario: 'weak', opts: { enemy: '' } },
  primed: { label: 'Room clearing, primed target', scenario: 'room', opts: { enemy: '', primed: true } },
  grineer: { label: 'Room clearing, Heavy Gunner 150 SP, full armor', scenario: 'room', target: ['grineer', false] },
  corpus: { label: 'Room clearing, Elite Crewman 150 SP', scenario: 'room', target: ['corpus', true] },
};

if (!isMainThread) {
  const { study } = await import('../src/study.js');
  parentPort?.on('message', input => {
    try {
      const r = study(input);
      parentPort?.postMessage({ weapon: input.weapon, singles: r.singles.map(s => [s.id, s.change]), best: r.sets[0]?.ids ?? [],
        curses: r.curses.map(c => [c.id, c.change]) });
    } catch (e) { parentPort?.postMessage({ weapon: input.weapon, error: String(e) }); }
  });
} else {
  const { WEAPONS } = await import('../src/data/weapons.js');
  const { WEAPON_STATS } = await import('../src/data/weapon-stats.js');
  const { SPLICED, STAT_BY_ID } = await import('../src/data/stats.js');
  const { pools } = await import('../src/cycle.js');
  const { picksFor, pickFamily } = await import('../src/picks.js');
  const { targetOf, roomOf } = await import('../src/enemies.js');
  const { BATTLEGROUPS } = await import('../src/data/battlegroups.js');
  const E = await import('../src/data/enemies.js');

  const args = process.argv.slice(2);
  const fresh = args.includes('--fresh');
  const chosen = args.filter(a => !a.startsWith('--'));
  const names = /** @type {(keyof typeof SETTINGS)[]} */ (chosen.length ? chosen : Object.keys(SETTINGS));
  const CACHE = new URL('./data/cache/score-optimiser.json', import.meta.url);
  /** @type {Record<string, Record<string, any>>} */
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

  // One weapon per pick family: the first listed (usually the base one), as score-sim does.
  const guns = [];
  const seen = new Set();
  for (const [name, cls, bow, ips] of WEAPONS) {
    const family = pickFamily(name);
    if (cls === 'melee' || !WEAPON_STATS[name] || !family || seen.has(family)) continue;
    seen.add(family);
    guns.push({ name, cls: /** @type {any} */ (cls), bow: !!bow, ips });
  }

  /** Runs one setting's studies on a pool of workers. @param {keyof typeof SETTINGS} key */
  const run = async key => {
    const s = SETTINGS[key];
    // Builds are judged by fights (src/fight.js): a faction's unit, or for any faction a Heavy Gunner
    // without weaknesses (armor stripped), at level 150 on the Steel Path.
    const target = 'target' in s && s.target ? (() => {
      const [f, stripped] = s.target;
      return { enemy: f, target: targetOf(E.UNITS[f].find(u => u.name === E.DEFAULT_UNIT[f]), 150, true, stripped, E) };
    })() : { target: targetOf({ ...E.UNITS.grineer.find(u => u.name === 'Heavy Gunner'), types: '' }, 150, true, true, E) };
    const inputs = guns.map(g => {
      const pool = pools(g.cls, g.ips);
      return { weapon: g.name, cls: g.cls, shape: '+++-', scenario: s.scenario,
        opts: { ...('opts' in s ? s.opts : {}), ...target, ...('mix' in s ? { room: roomOf('grineer', BATTLEGROUPS.grineer.members, 150, true, true, E, '') } : {}), bow: g.bow },
        positives: [...pool.positive, ...SPLICED.filter(x => x.b[g.cls] !== undefined).map(x => x.id)], negatives: pool.negative };
    });
    /** @type {Record<string, any>} */
    const out = {};
    const queue = [...inputs];
    const t0 = Date.now();
    await Promise.all(Array.from({ length: Math.max(1, availableParallelism() - 1) }, () => new Promise(resolve => {
      const w = new Worker(new URL(import.meta.url));
      const next = () => { const job = queue.shift(); if (job) w.postMessage(job); else { w.terminate(); resolve(null); } };
      w.on('message', r => { out[r.weapon] = r; next(); });
      next();
    })));
    console.log(`${key}: ${inputs.length} guns in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    return out;
  };

  for (const key of names) {
    if (fresh || !cache[key]) { cache[key] = await run(key); writeFileSync(CACHE, JSON.stringify(cache)); }
  }

  const pct = (/** @type {number} */ a, /** @type {number} */ b) => `${(100 * a / b).toFixed(0)}%`;
  const name = (/** @type {string} */ id) => STAT_BY_ID[id]?.name ?? id;
  const list = (/** @type {Map<string, number>} */ m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${name(k)} ${v}`).join(', ');
  const add = (/** @type {Map<string, number>} */ m, /** @type {string} */ k) => m.set(k, (m.get(k) ?? 0) + 1);

  console.log(`${guns.length} gun families, shape +++-, median rolls. Old reference build (score-sim): 58% in top 6, 79% slot 1 in top 3.\n`);
  for (const key of names) {
    const results = cache[key];
    let picks = 0, top6 = 0, slot1 = 0, slot1Top3 = 0, setPicks = 0, inSet = 0, curses = 0, curseHits = 0, errors = 0;
    const missed = new Map(), unlisted = new Map(), badCurse = new Map();
    for (const g of guns) {
      const r = results[g.name];
      if (!r || r.error) { errors++; continue; }
      // Stats with no effect (a gain under half a percent) don't count as recommended.
      const ranked = r.singles.filter((/** @type {[string, number]} */ [, c]) => c > 0.005).map((/** @type {[string, number]} */ [id]) => id);
      const best = new Set(r.best);
      const [row] = picksFor(g.name, g.cls);
      const firsts = row.positives.map(slot => (slot[0] ?? []).map(p => p.stat).filter(id => id && STAT_BY_ID[id]));
      firsts.forEach((ids, i) => {
        for (const id of /** @type {string[]} */ (ids)) {
          picks++;
          if (ranked.slice(0, 6).includes(id)) top6++; else add(missed, id);
          if (i === 0) { slot1++; if (ranked.slice(0, 3).includes(id)) slot1Top3++; }
        }
        // The best riven: does it hold one of this slot's first choices?
        if (ids.length) { setPicks++; if (ids.some(id => best.has(/** @type {string} */ (id)))) inSet++; }
      });
      const listed = new Set(picksFor(g.name, g.cls).flatMap(x => x.positives.flat(2).map(p => p.stat)));
      for (const id of ranked.slice(0, 3)) if (!listed.has(id)) add(unlisted, id);
      // Curses: a community first choice costing at most 2 points more than the most harmless curse
      // (many cost nothing at all, so a top 3 would be an arbitrary pick among ties).
      const floor = (r.curses[0]?.[1] ?? 0) - 0.02;
      const harmless = r.curses.filter((/** @type {[string, number]} */ [, c]) => c >= floor).map((/** @type {[string, number]} */ [id]) => id);
      const curseFirst = (row.negatives[0] ?? []).map(p => p.stat).filter(id => id && STAT_BY_ID[id]);
      if (curseFirst.length && r.curses.length) {
        curses++;
        if (curseFirst.some(id => harmless.includes(/** @type {string} */ (id)))) curseHits++;
        else for (const id of curseFirst) add(badCurse, /** @type {string} */ (id));
      }
    }
    console.log(`${key}: ${SETTINGS[key].label}${errors ? ` (${errors} failed)` : ''}`);
    console.log(`  first choices in the top 6: ${top6} / ${picks} (${pct(top6, picks)}); slot 1 in the top 3: ${slot1Top3} / ${slot1} (${pct(slot1Top3, slot1)})`);
    console.log(`  slots whose first choice is in the best riven: ${inSet} / ${setPicks} (${pct(inSet, setPicks)}); curse first choice within 2 points of the most harmless: ${curseHits} / ${curses} (${pct(curseHits, curses)})`);
    console.log(`  most missed: ${list(missed)}`);
    console.log(`  model's top 3 the community never lists: ${list(unlisted)}`);
    console.log(`  community curses the model finds costly: ${list(badCurse)}\n`);
  }
}
