// Scores the damage model (src/sim.js) against the community's recommended rolls (src/picks.js):
// how often the community's first choices are among the model's best stats, and which stats the
// two disagree on most. A check, not a target: read the disagreements.
//   node tools/score-sim.mjs [top] [armor] [weakpoint]
//   top: how many of the model's best stats count (default 6); armor: the enemy's (default 0);
//   weakpoint: the share of direct hits on weak points (default 0: body shots)

import { WEAPONS } from '../src/data/weapons.js';
import { WEAPON_STATS } from '../src/data/weapon-stats.js';
import { SPLICED, STAT_BY_ID } from '../src/data/stats.js';
import { PICKS } from '../src/data/picks.js';
import { pools } from '../src/cycle.js';
import { picksFor, pickFamily } from '../src/picks.js';
import { statEffects } from '../src/sim.js';

const TOP = Number(process.argv[2] ?? 6);
const ARMOR = Number(process.argv[3] ?? 0);
const WEAKPOINT = Number(process.argv[4] ?? 0);
let picks = 0, hits = 0, slot1 = 0, slot1Hits = 0, families = 0;
/** @type {Map<string, number>} community first choices the model ranks low */
const missed = new Map();
/** @type {Map<string, number>} the model's best stats the community doesn't list at all */
const unlisted = new Map();
const add = (/** @type {Map<string, number>} */ m, /** @type {string} */ k) => m.set(k, (m.get(k) ?? 0) + 1);

const seen = new Set();
for (const [name, cls, bow, ips] of WEAPONS) {
  const family = pickFamily(name);
  const w = WEAPON_STATS[name];
  // One weapon per family: the first listed (usually the base one).
  if (cls === 'melee' || !w || !family || seen.has(family)) continue;
  seen.add(family);
  families++;
  const pool = pools(cls, ips);
  const positives = [...pool.positive, ...SPLICED.filter(s => s.b[cls] !== undefined).map(s => s.id)];
  const ranked = statEffects(w, cls, '+++-', '+', positives, { bow: !!bow, armor: ARMOR, weakpoint: WEAKPOINT }).map(e => e.id);
  const best = new Set(ranked.slice(0, TOP));
  const [row] = picksFor(name, cls);
  const firsts = row.positives.map(slot => (slot[0] ?? []).map(p => p.stat).filter(id => id && STAT_BY_ID[id]));
  firsts.forEach((ids, i) => {
    for (const id of /** @type {string[]} */ (ids)) {
      picks++;
      if (best.has(id)) hits++; else add(missed, id);
      if (i === 0) { slot1++; if (ranked.slice(0, 3).includes(id)) slot1Hits++; }
    }
  });
  const listed = new Set(picksFor(name, cls).flatMap(r => r.positives.flat(2).map(p => p.stat)));
  for (const id of ranked.slice(0, 3)) if (!listed.has(id)) add(unlisted, id);
}

const pct = (/** @type {number} */ a, /** @type {number} */ b) => `${(100 * a / b).toFixed(0)}%`;
const list = (/** @type {Map<string, number>} */ m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${STAT_BY_ID[k]?.name ?? k} ${v}`).join(', ');
console.log(`${families} gun families (of ${Object.keys(PICKS).length} in the sheet), shape +++-, median rolls, armor ${ARMOR}, weak point hits ${WEAKPOINT}`);
console.log(`Community first choices among the model's top ${TOP}: ${hits} / ${picks} (${pct(hits, picks)})`);
console.log(`Slot 1 first choices among the model's top 3: ${slot1Hits} / ${slot1} (${pct(slot1Hits, slot1)})`);
console.log(`Most missed (community first choice, outside the model's top ${TOP}): ${list(missed)}`);
console.log(`Model's top 3 the community never lists: ${list(unlisted)}`);
