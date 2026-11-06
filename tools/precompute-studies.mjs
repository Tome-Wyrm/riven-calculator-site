// Precomputes the riven studies most people want: every weapon, every riven shape, every role (Fodder
// clear, Single target, Weak points, and Slam for melee), the other settings at the page's defaults.
// The page shows one of these at once, without the search, when its settings are exactly these.
//   node tools/precompute-studies.mjs [--jobs N] [--only "Name,Name"] [--fresh] [--check]
// Each weapon's studies go to src/data/studies/<slug>.json, keyed by the md5 of the study's input
// (src/model-input.js builds it, the page too), so a stored study is only ever used for its own input.
// It picks up where it left off: a weapon whose file already has every key is skipped (--fresh redoes
// them). src/data/studies/index.json records the model's source hash; --check says whether it's stale
// (the damage model changed since: run it again).

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('src/data/studies/', ROOT);
/** The sources a study's result depends on: a change to any makes the stored studies stale. */
const SOURCES = ['src/study.js', 'src/build.js', 'src/fight.js', 'src/sim.js', 'src/melee.js', 'src/elements.js', 'src/crowd.js',
  'src/incarnon.js', 'src/enemies.js', 'src/engine.js', 'src/cycle.js', 'src/buffs.js', 'src/model-input.js',
  'src/data/weapon-stats.js', 'src/data/mods.js', 'src/data/arcanes.js', 'src/data/stats.js', 'src/data/stances.js',
  'src/data/enemies.js', 'src/data/battlegroups.js', 'src/data/incarnons.js', 'src/data/weapons.js'];

const { WEAPONS } = await import(new URL('src/data/weapons.js', ROOT).href);
const { WEAPON_STATS: stats } = await import(new URL('src/data/weapon-stats.js', ROOT).href);
const enemies = await import(new URL('src/data/enemies.js', ROOT).href);
const { defaultModel, modelInput, ROLES } = await import(new URL('src/model-input.js', ROOT).href);
const { SHAPE_ORDER } = await import(new URL('src/engine.js', ROOT).href);
const { md5 } = await import(new URL('src/md5.js', ROOT).href);
const { studySlug } = await import(new URL('src/studies.js', ROOT).href);

/**
 * A weapon's precomputed inputs: by shape and role, the page's defaults otherwise.
 * @param {string} name @param {string} cls @returns {{key: string, input: any}[]}
 */
function inputsFor(name, cls) {
  const out = [];
  for (const shape of SHAPE_ORDER) {
    for (const [role] of ROLES) {
      if (role === 'slam' && !(cls === 'melee' && stats[name]?.melee)) continue;
      const m = modelInput(name, cls, { ...defaultModel(), shape, scenario: role }, { stats, enemies });
      if (m) out.push({ key: md5(JSON.stringify(m.input)), input: m.input });
    }
  }
  return out;
}

if (!isMainThread) {
  // A worker: studies one weapon at a time, as the main thread hands them out.
  const { study } = await import(new URL('src/study.js', ROOT).href);
  parentPort?.on('message', (/** @type {{name: string, jobs: {key: string, input: any}[]}} */ { name, jobs }) => {
    /** @type {Record<string, unknown>} */
    const results = {};
    for (const { key, input } of jobs) {
      try { results[key] = study(input); } catch (e) { results[key] = { error: e instanceof Error ? e.message : String(e) }; }
    }
    parentPort?.postMessage({ name, results });
  });
} else {
  const arg = (/** @type {string} */ flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
  const hash = createHash('sha256');
  for (const f of SOURCES) hash.update(await readFile(new URL(f, ROOT)));
  const version = hash.digest('hex').slice(0, 16);
  const indexUrl = new URL('index.json', OUT);
  const index = JSON.parse(await readFile(indexUrl, 'utf8').catch(() => '{}'));

  if (process.argv.includes('--check')) {
    console.log(index.version === version ? `Up to date (${version}).` : `Stale: made with ${index.version ?? 'nothing'}, the model is now ${version}.`);
    process.exit(index.version === version ? 0 : 1);
  }
  const fresh = process.argv.includes('--fresh') || (index.version && index.version !== version);
  const only = arg('--only')?.split(',').map(s => s.trim());
  const jobs = Number(arg('--jobs') ?? availableParallelism());
  await mkdir(OUT, { recursive: true });
  // The files are this model's from now on (a run cut short picks up where it left off).
  await writeFile(indexUrl, JSON.stringify({ version, made: new Date().toISOString().slice(0, 10) }, null, 1) + '\n');

  /** @type {{name: string, file: URL, have: Record<string, unknown>, jobs: {key: string, input: any}[]}[]} */
  const queue = [];
  for (const [name, cls] of WEAPONS) {
    if (!stats[name] || (only && !only.includes(name))) continue;
    const file = new URL(`${studySlug(name)}.json`, OUT);
    const have = fresh ? {} : JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
    const all = inputsFor(name, cls);
    const missing = all.filter(j => !(j.key in have));
    if (missing.length) queue.push({ name, file, have: Object.fromEntries(all.filter(j => j.key in have).map(j => [j.key, have[j.key]])), jobs: missing });
  }
  const total = queue.reduce((n, q) => n + q.jobs.length, 0);
  console.log(`${queue.length} weapons, ${total} studies to run on ${jobs} threads (model ${version}).`);
  let done = 0;
  const started = Date.now();
  const byName = new Map(queue.map(q => [q.name, q]));
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url));
    const next = () => { const q = queue.shift(); if (q) w.postMessage({ name: q.name, jobs: q.jobs }); else w.terminate().then(resolve); };
    w.on('message', async (/** @type {{name: string, results: Record<string, unknown>}} */ { name, results }) => {
      const q = /** @type {NonNullable<ReturnType<typeof byName.get>>} */ (byName.get(name));
      await writeFile(q.file, JSON.stringify({ ...q.have, ...results }));
      done += q.jobs.length;
      const rate = (Date.now() - started) / 1000 / done;
      console.log(`${name}: ${q.jobs.length} (${done}/${total}, ~${Math.round(rate * (total - done) / 60)} min left)`);
      next();
    });
    w.on('error', reject);
    next();
  })));
  console.log(`Done: model ${version}.`);
}
