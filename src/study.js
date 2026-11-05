// @ts-check
// A gun's riven study for the page: the best build without a riven, what each stat is worth in the
// riven's slot, the best rivens, and what each curse costs on the best one. Each riven's value
// comes from re-optimising the build around it (src/build.js). Pure; run in a worker by the page.

import { WEAPON_STATS } from './data/weapon-stats.js';
import { STAT_BY_ID, SHAPES } from './data/stats.js';
import { rawValue, displayValue, format } from './engine.js';
import { modPool, arcanePool, optimise, optimiseEach, rivenPiece, fightOf, worth, withoutOutclassed, shortlist, SCENARIOS } from './build.js';
import { NO_DPS, VALENCE_TYPES } from './sim.js';
import { evolutionsOf, withPerks, bestPerks } from './incarnon.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('./data/stats.js').Shape} Shape */
/** @typedef {import('./build.js').Build} Build */

/**
 * @typedef {object} StudyInput
 * @property {string} weapon
 * @property {WeaponClass} cls
 * @property {Shape} shape
 * @property {keyof typeof SCENARIOS} scenario
 * @property {import('./sim.js').SimOptions} opts  an adversary weapon's Valence type 'best': the
 *   element whose best build (no riven) does most, each one tried
 * @property {string[]} positives  stats the riven can roll as positives (spliced ones included)
 * @property {string[]} negatives  and as the curse
 * @property {number[] | 'best'} [perks]  an incarnon's perk per evolution (index; -1 none), or 'best'
 *   (default): the combination that does most with the reference build
 * @property {boolean} [adapter]  false: a gun that takes an Incarnon Genesis adapter, without one (no perks)
 */

/**
 * A build as the page shows it: mod names in slot order (the riven as "Riven"), arcane, DPS, and its
 * fight against the target when there is one (shots a kill takes, seconds, the first shot's damage).
 * @param {Build} b @param {import('./fight.js').FightResult | null} [f]
 */
const summary = (b, f = null) => ({
  mods: b.slots.map(p => (p.riven ? 'Riven' : p.name)), arcane: b.arcane?.name ?? null, dps: b.dps,
  fight: f && { shots: f.shotsPerKill, seconds: f.timePerKill, perShot: f.perShot, inForm: f.inForm },
});

/** A spliced stat keeps the better of two parents' rolls: its median roll is √½. @param {string} id */
const medianU = id => (STAT_BY_ID[id].spliced ? Math.SQRT1_2 : 0.5);

/** @param {StudyInput} input */
export function study(input) {
  const sc = SCENARIOS[input.scenario];
  const { cls, shape } = input;
  // The kind of build decides the weak point share.
  // Room clearing and weak point builds fight 20 targets in a row (src/fight.js), single target one.
  const opts = { ...input.opts, weakpoint: sc.weakpoint, targets: sc.kills ? 20 : 1,
    ...(input.opts.incarnon ? { incarnon: { ...input.opts.incarnon, share: sc.charging } } : {}) };
  // An incarnon: the gun as evolved (Felarx's Devastating Attrition turns crit chance into a cost).
  const plain = WEAPON_STATS[input.weapon];
  const perks = !evolutionsOf(input.weapon).length || cls === 'melee' || input.adapter === false ? []
    : Array.isArray(input.perks) ? input.perks : bestPerks(plain, input.weapon, cls, { ...opts, valence: undefined });
  const w = withPerks(plain, input.weapon, perks);
  const pool = withoutOutclassed(modPool(cls, w, sc, opts));
  const arcanes = arcanePool(cls, sc, opts);
  // Each Valence element, by its best build without a riven (the elements it leaves the mods to
  // make change with it); the study goes on with the best one.
  /** @type {{type: string, change: number, build: ReturnType<typeof summary>}[] | null} */
  let valences = null;
  /** @type {Build | null} the chosen element's build, where the study's own search starts */
  let found = null;
  if (w.adversary && opts.valence?.type === 'best') {
    const value = opts.valence.value;
    const builds = optimiseEach(w, pool, arcanes, VALENCE_TYPES.map(type => ({ ...opts, valence: { type, value } })));
    const tried = VALENCE_TYPES.map((type, i) => ({ type, b: builds[i] })).sort((a, b) => b.b.dps - a.b.dps);
    valences = tried.map(t => ({ type: t.type, change: t.b.dps / tried[0].b.dps - 1, build: summary(t.b) }));
    opts.valence = { type: tried[0].type, value };
    found = tried[0].b;
  }
  const raw = (/** @type {string} */ id, /** @type {'+' | '-'} */ sign) => rawValue(STAT_BY_ID[id], cls, shape, sign, sign === '+' ? medianU(id) : 0.5);
  const shown = (/** @type {string} */ id, /** @type {'+' | '-'} */ sign) => format(STAT_BY_ID[id], displayValue(STAT_BY_ID[id], cls, shape, sign, sign === '+' ? medianU(id) : 0.5));
  /** @param {Record<string, number>} roll @param {Build} from */
  const withRiven = (roll, from) => optimise(w, short, arcanes, opts, { riven: rivenPiece(roll), start: from.slots });
  // The search can stick on a poor build, and where it starts decides which: `own`, unless the riven
  // does better on the mods of one of `others`; then a search from the best of those.
  const orBetter = (/** @type {Record<string, number>} */ roll, /** @type {Build} */ own, /** @type {Build[]} */ others) => {
    const piece = rivenPiece(roll);
    const tried = others.map(b => ({ b, dps: worth(w, { ...b, slots: b.slots.map(p => (p.riven ? piece : p)) }, opts) }));
    const best = tried.reduce((x, y) => (y.dps > x.dps ? y : x), { b: own, dps: own.dps * (1 + 1e-9) });
    return best.b === own ? own : withRiven(roll, best.b);
  };

  const none = found ?? optimise(w, pool, arcanes, opts);
  // Every search from here is around this gun: a shorter pool, from the build just found.
  const short = shortlist(w, pool, opts, none);
  const shownBuild = (/** @type {Build} */ b) => summary(b, fightOf(w, b, opts));
  // (The whole pool: every percentage below is measured from here.)
  const start = optimise(w, pool, arcanes, opts, { riven: rivenPiece({}), start: none.slots });

  // Each positive alone in the riven's slot, against the slot empty. Each search lands somewhere a
  // little different, so each stat, and the empty slot, then gets the best mods any of them found.
  const alone = input.positives.map(id => { const roll = { [id]: raw(id, '+') }; return { id, roll, b: withRiven(roll, start) }; });
  const distinct = (/** @type {Build[]} */ builds) => [...new Map(builds.map(b => [b.slots.filter(p => !p.riven).map(p => p.name).sort().join('|') + (b.arcane?.name ?? ''), b])).values()];
  const foundAlone = distinct(alone.map(a => a.b));
  const empty = orBetter({}, start, foundAlone);
  const singles = alone.map(({ id, roll, b }) => {
    const better = orBetter(roll, b, foundAlone);
    return { id, shown: shown(id, '+'), change: better.dps / empty.dps - 1, b: better };
  }).sort((a, b) => b.change - a.change);
  const foundSingles = distinct(singles.map(s => s.b));

  // The best rivens: sets of as many positives as the shape holds (at most one spliced), from the
  // best singles, each against no riven at all.
  const k = SHAPES[shape].positives;
  const top = singles.filter(s => s.change > 0.005).slice(0, 7).map(s => s.id);
  /** @type {string[][]} */
  const combos = [];
  const pick = (/** @type {number} */ from, /** @type {string[]} */ chosen) => {
    if (chosen.length === Math.min(k, top.length)) {
      if (chosen.filter(id => STAT_BY_ID[id].spliced).length <= 1) combos.push(chosen);
      return;
    }
    for (let i = from; i < top.length; i++) pick(i + 1, [...chosen, top[i]]);
  };
  pick(0, []);
  const sets = combos.map(ids => {
    const roll = Object.fromEntries(ids.map(id => [id, raw(id, '+')]));
    const b = orBetter(roll, withRiven(roll, empty), foundSingles);
    return { ids, change: b.dps / none.dps - 1, build: shownBuild(b), b };
  }).sort((a, b) => b.change - a.change).slice(0, 5);

  // Each curse on the best riven, against that riven without it.
  const best = sets[0];
  /** @type {{id: string, shown: string, change: number}[]} */
  let curses = [];
  if (best && SHAPES[shape].negatives) {
    const roll = Object.fromEntries(best.ids.map(id => [id, raw(id, '+')]));
    let base = withRiven(roll, best.b);
    // A curse can shake the search loose onto mods that do better without the curse too: then it was
    // the mods, not the curse (a −Magazine showed +5% so), so the riven without it gets them as well.
    const ids = input.negatives.filter(id => !best.ids.includes(id));
    /** @type {{id: string, b: Build}[]} */
    let cursed = [];
    for (let round = 0; round < 3; round++) {
      const from = base;
      cursed = ids.map(id => ({ id, b: NO_DPS.has(id) ? from : withRiven({ ...roll, [id]: raw(id, '-') }, from) }));
      base = orBetter(roll, from, cursed.map(c => c.b));
      if (base === from) break;
    }
    curses = cursed.map(({ id, b }) => ({ id, shown: shown(id, '-'), change: b.dps / base.dps - 1 })).sort((a, b) => b.change - a.change);
    // A shape with a curse always has one: each best riven carries the best curse it can (the
    // kindest on the best riven, or the next for a riven that rolls that stat as a positive).
    for (const set of sets) {
      const c = curses.find(x => !set.ids.includes(x.id));
      if (c) Object.assign(set, { curse: { id: c.id, shown: c.shown } });
    }
  }
  // Each best riven gets the best mods any of them found: one that stuck mustn't rank below the others.
  const rollOf = (/** @type {typeof sets[number] & {curse?: {id: string}}} */ set) => ({ ...Object.fromEntries(set.ids.map(id => [id, raw(id, '+')])), ...(set.curse ? { [set.curse.id]: raw(set.curse.id, '-') } : {}) });
  const searched = sets.map(set => withRiven(rollOf(set), set.b));
  for (const [i, set] of sets.entries()) {
    const b = orBetter(rollOf(set), searched[i], searched);
    Object.assign(set, { change: b.dps / none.dps - 1, build: shownBuild(b) });
  }
  sets.sort((a, b) => b.change - a.change);
  return { none: shownBuild(none), empty: empty.dps, singles: singles.map(({ b: _, ...s }) => s), cursesOn: best?.ids ?? [], sets: /** @type {(Omit<typeof sets[number], 'b'> & {curse?: {id: string, shown: string}})[]} */ (sets.map(({ b: _, ...s }) => s)), curses, valences, valence: opts.valence ?? null, perks };
}
