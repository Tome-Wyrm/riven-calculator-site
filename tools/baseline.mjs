// A saved baseline of riven studies, to see what a model change moved: a handful of guns in two
// settings, each study's DPS without a riven, its best build, its top stats and its best rivens.
//   node tools/baseline.mjs            compare the model as it stands with the saved baseline
//   node tools/baseline.mjs --save     save it as the new baseline (after a change you mean)
//   node tools/baseline.mjs --only "Soma Prime,Felarx"   just these guns
// The baseline is tools/data/baseline.json. Inputs come from src/model-input.js, as the page builds
// them, so a study here is the one the page shows for these settings. Studies run one a thread.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const FILE = new URL('tools/data/baseline.json', ROOT);

/** The guns: a spread of what the model does (crit, status, AoE, beams, Incarnons, pellets, chaining). */
const GUNS = ['Soma Prime', 'Kuva Bramma', 'Ignis Wraith', 'Acceltra', 'Kuva Hek', 'Felarx', 'Phage', 'Laetum',
  'Kuva Nukor', 'Rubico Prime', 'Torid'];
/** The settings, on top of the page's defaults (src/model-input.js `defaultModel`). */
const SETTINGS = {
  'room': { scenario: 'room' },                       // Fodder clear, armor stripped: the page as it opens
  'single, armored': { scenario: 'single', armor: 2700 }, // Single target with its full armor
  // Incarnon guns only: the page fires them normally (with perks) by default, so the form's cycle
  // (src/fight.js `fightNow`) gets its own setting.
  'room, in form': { scenario: 'room', incarnon: 'on' },
};

/** The tops kept of each list: enough to see a reordering, few enough to read. */
const TOP_SINGLES = 6, TOP_SETS = 3, TOP_CURSES = 3;

/** What's kept of a study. @param {any} s */
const keep = s => ({
  dps: s.none.dps,
  build: [...s.none.mods.filter((/** @type {string} */ m) => m !== 'Riven')].sort(), arcane: s.none.arcane,
  singles: s.singles.slice(0, TOP_SINGLES).map((/** @type {any} */ x) => ({ id: x.id, change: x.change })),
  sets: s.sets.slice(0, TOP_SETS).map((/** @type {any} */ x) => ({ ids: x.ids, curse: x.curse?.id ?? null, change: x.change })),
  curses: s.curses.slice(0, TOP_CURSES).map((/** @type {any} */ x) => ({ id: x.id, change: x.change })),
  ...(s.valence ? { valence: s.valence.type } : {}),
  ...(s.perks?.length ? { perks: s.perks } : {}),
});

if (!isMainThread) {
  const { study } = await import(new URL('src/study.js', ROOT).href);
  parentPort?.on('message', (/** @type {{id: string, input: any}} */ { id, input }) => {
    try { parentPort?.postMessage({ id, result: keep(study(input)) }); } catch (err) { parentPort?.postMessage({ id, error: String(err) }); }
  });
} else {
  const { WEAPONS } = await import(new URL('src/data/weapons.js', ROOT).href);
  const { WEAPON_STATS: stats } = await import(new URL('src/data/weapon-stats.js', ROOT).href);
  const enemies = await import(new URL('src/data/enemies.js', ROOT).href);
  const { defaultModel, modelInput } = await import(new URL('src/model-input.js', ROOT).href);
  const { evolutionsOf } = await import(new URL('src/incarnon.js', ROOT).href);
  const cls = Object.fromEntries(WEAPONS.map((/** @type {[string, string]} */ [n, c]) => [n, c]));

  const arg = (/** @type {string} */ flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
  const save = process.argv.includes('--save');
  const only = arg('--only')?.split(',').map(s => s.trim());
  const guns = only ?? GUNS;

  /** @type {{id: string, input: any}[]} */
  const jobs = [];
  for (const gun of guns) {
    for (const [setting, patch] of Object.entries(SETTINGS)) {
      if ('incarnon' in patch && !evolutionsOf(gun).length) continue;
      const m = modelInput(gun, cls[gun], { ...defaultModel(), ...patch }, { stats, enemies });
      if (!m) { console.log(`${gun}: no stats, skipped.`); continue; }
      jobs.push({ id: `${gun} | ${setting}`, input: m.input });
    }
  }

  const started = Date.now();
  /** @type {Record<string, any>} */
  const now = {};
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), queue.length) }, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url));
    const next = () => { const j = queue.shift(); if (j) w.postMessage(j); else w.terminate().then(resolve); };
    w.on('message', (/** @type {{id: string, result?: any, error?: string}} */ { id, result, error }) => {
      now[id] = error ? { error } : result;
      next();
    });
    w.on('error', reject);
    next();
  })));
  const ordered = Object.fromEntries(jobs.map(j => [j.id, now[j.id]]));
  console.log(`${jobs.length} studies in ${Math.round((Date.now() - started) / 1000)} s.`);

  const saved = JSON.parse(await readFile(FILE, 'utf8').catch(() => '{}'));
  if (save) {
    // (--only updates just those guns, keeping the rest.)
    const studies = only ? { ...saved.studies, ...ordered } : ordered;
    await writeFile(FILE, JSON.stringify({ made: new Date().toISOString().slice(0, 10), studies }, null, 1) + '\n');
    console.log(`Saved as the baseline: ${FILE.pathname.slice(ROOT.pathname.length)}.`);
  } else if (!saved.studies) {
    console.log('No baseline yet: run with --save.');
  } else {
    console.log(`Against the baseline of ${saved.made}:\n`);
    let moved = 0;
    for (const [id, b] of Object.entries(ordered)) {
      const lines = compare(saved.studies[id], b);
      if (!lines.length) continue;
      moved++;
      console.log(`${id}\n${lines.map(l => `  ${l}`).join('\n')}\n`);
    }
    console.log(moved ? `${moved} of ${jobs.length} studies moved.` : 'Nothing moved.');
  }
}

/** "+12.3%" @param {number} x */
function pct(x) { return `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`; }

/** A study's top as text, each with its value. @param {{id?: string, ids?: string[], curse?: string | null, change: number}[]} list */
function tops(list) {
  return list.map(x => `${x.ids ? x.ids.join('/') + (x.curse ? ` −${x.curse}` : '') : x.id} ${pct(x.change)}`).join(', ');
}

/** What changed between a saved study and the same study now, as lines (none: nothing worth saying). @param {any} a @param {any} b */
function compare(a, b) {
  if (!a) return ['new: not in the baseline'];
  if (a.error || b.error) return a.error === b.error ? [] : [`error: ${a.error ?? 'none'} → ${b.error ?? 'none'}`];
  const out = [];
  // Under 0.1% is noise from the search, not the model.
  const rel = b.dps / a.dps - 1;
  if (Math.abs(rel) >= 0.001) out.push(`DPS without a riven: ${Math.round(a.dps)} → ${Math.round(b.dps)} (${pct(rel)})`);
  const gone = a.build.filter((/** @type {string} */ m) => !b.build.includes(m)), came = b.build.filter((/** @type {string} */ m) => !a.build.includes(m));
  if (gone.length || came.length) out.push(`build: ${[...gone.map((/** @type {string} */ m) => `−${m}`), ...came.map((/** @type {string} */ m) => `+${m}`)].join(', ')}`);
  if (a.arcane !== b.arcane) out.push(`arcane: ${a.arcane ?? 'none'} → ${b.arcane ?? 'none'}`);
  if (a.valence !== b.valence) out.push(`valence: ${a.valence ?? 'none'} → ${b.valence ?? 'none'}`);
  if (JSON.stringify(a.perks) !== JSON.stringify(b.perks)) out.push(`perks: ${a.perks?.join(',') ?? 'none'} → ${b.perks?.join(',') ?? 'none'}`);
  // A list moved if its order did, or any value by a point or more.
  const listMoved = (/** @type {any[]} */ x, /** @type {any[]} */ y, /** @type {(e: any) => string} */ key) =>
    x.map(key).join() !== y.map(key).join() || x.some((e, i) => Math.abs(e.change - y[i].change) >= 0.01);
  if (listMoved(a.singles, b.singles, e => e.id)) out.push(`top stats: ${tops(a.singles)}\n          → ${tops(b.singles)}`);
  if (listMoved(a.sets, b.sets, e => e.ids.join('/') + e.curse)) out.push(`best rivens: ${tops(a.sets)}\n          → ${tops(b.sets)}`);
  if (listMoved(a.curses, b.curses, e => e.id)) out.push(`kindest curses: ${tops(a.curses)}\n          → ${tops(b.curses)}`);
  return out;
}
