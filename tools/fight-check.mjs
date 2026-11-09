// Checks src/fight.js's averages against a random fight (src/fight-mc.js), every roll made: the
// baseline's studies (tools/baseline.mjs), each its best build without a riven, fought both ways.
//   node tools/fight-check.mjs [--kills N] [--only "Soma Prime,Felarx"]
// Crowds are left out on both sides: what's checked is one target's fight (smoothed kills, crits,
// procs, Heat's strip, Blast, reloads, the Incarnon gauge), not what reaches the others.
// Time per kill is the measure: the random fight's next target starts on the shot after a kill, so
// a gap there is what src/fight.js's smoothing (and its other averages) leaves out.

import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const { WEAPONS } = await import(new URL('src/data/weapons.js', ROOT).href);
const { WEAPON_STATS: stats } = await import(new URL('src/data/weapon-stats.js', ROOT).href);
const enemies = await import(new URL('src/data/enemies.js', ROOT).href);
const { defaultModel, modelInput } = await import(new URL('src/model-input.js', ROOT).href);
const { withPerks } = await import(new URL('src/incarnon.js', ROOT).href);
const { SCENARIOS, modPool, arcanePool, buildTotals } = await import(new URL('src/build.js', ROOT).href);
const { fight } = await import(new URL('src/fight.js', ROOT).href);
const { randomFight } = await import(new URL('src/fight-mc.js', ROOT).href);

const arg = (/** @type {string} */ flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const KILLS = Number(arg('--kills') ?? 2000);
const only = arg('--only')?.split(',').map(s => s.trim());
const cls = Object.fromEntries(WEAPONS.map((/** @type {[string, string]} */ [n, c]) => [n, c]));
/** The baseline's settings (tools/baseline.mjs), by name. */
const SETTINGS = { 'room': { scenario: 'room' }, 'single, armored': { scenario: 'single', armor: 2700 }, 'room, in form': { scenario: 'room', incarnon: 'on' } };

const baseline = JSON.parse(await readFile(new URL('tools/data/baseline.json', ROOT), 'utf8'));
const pct = (/** @type {number} */ x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
const pad = (/** @type {string} */ s, /** @type {number} */ n) => s.padEnd(n);
const num = (/** @type {number} */ x, d = 3) => x.toPrecision(d);

console.log(`${pad('Study', 32)} ${pad('averaged s/kill', 16)} ${pad('random s/kill', 22)} ${pad('gap', 8)} ${pad('shots avg/rnd', 14)} in form avg/rnd`);
/** @type {number[]} */
const gaps = [];
for (const [id, saved] of Object.entries(baseline.studies)) {
  const [gun, setting] = id.split(' | ');
  if (only && !only.includes(gun)) continue;
  const m = modelInput(gun, cls[gun], { ...defaultModel(), .../** @type {any} */ (SETTINGS)[setting] }, { stats, enemies });
  const input = m.input;
  // The study's own options (src/study.js), the crowd left out.
  const sc = SCENARIOS[input.scenario];
  const { crowd: _, ...rest } = input.opts;
  const opts = { ...rest, weakpoint: sc.weakpoint, targets: sc.kills ? 20 : 1,
    ...(input.opts.incarnon ? { incarnon: { ...input.opts.incarnon, share: sc.charging } } : {}),
    ...(saved.valence ? { valence: { ...input.opts.valence, type: saved.valence } } : {}) };
  const w = withPerks(stats[gun], gun, saved.perks ?? []);
  const pool = modPool(input.cls, w, sc, opts);
  const slots = saved.build.map((/** @type {string} */ name) => pool.find((/** @type {any} */ p) => p.name === name));
  const arcane = saved.arcane ? arcanePool(input.cls, sc, opts).find((/** @type {any} */ p) => p.name === saved.arcane) : null;
  if (slots.some((/** @type {any} */ p) => !p) || (saved.arcane && !arcane)) { console.log(`${pad(id, 32)} its build's mods aren't in the pool now: run the baseline again`); continue; }
  const t = buildTotals({ slots, arcane }, opts);
  const avg = fight(w, t, opts);
  const rnd = randomFight(w, t, opts, { kills: KILLS });
  if ('unsupported' in rnd) { console.log(`${pad(id, 32)} not covered: ${rnd.unsupported}`); continue; }
  const gap = avg.timePerKill / rnd.timePerKill - 1;
  gaps.push(gap);
  console.log(`${pad(id, 32)} ${pad(num(avg.timePerKill), 16)} ${pad(`${num(rnd.timePerKill)} ± ${num(rnd.se, 2)}`, 22)} ${pad(pct(gap), 8)} ${pad(`${num(avg.shotsPerKill)}/${num(rnd.shotsPerKill)}`, 14)} ${avg.inForm !== undefined ? `${num(avg.inForm, 2)}/${num(rnd.inForm ?? 0, 2)}` : ''}`);
}
if (gaps.length) {
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  console.log(`\nGap: the averaged time per kill over the random one, less 1 (− : the averages say kills come sooner). Mean ${pct(mean)}, from ${pct(Math.min(...gaps))} to ${pct(Math.max(...gaps))}.`);
}
