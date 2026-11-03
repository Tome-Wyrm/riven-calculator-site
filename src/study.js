// @ts-check
// A gun's riven study for the page: the best build without a riven, what each stat is worth in the
// riven's slot, the best rivens, and what each curse costs on the best one. Each riven's value
// comes from re-optimising the build around it (src/build.js). Pure; run in a worker by the page.

import { WEAPON_STATS } from './data/weapon-stats.js';
import { STAT_BY_ID, SHAPES } from './data/stats.js';
import { rawValue, displayValue, format } from './engine.js';
import { modPool, arcanePool, optimise, optimiseEach, rivenPiece, SCENARIOS } from './build.js';
import { VALENCE_TYPES } from './sim.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('./data/stats.js').Shape} Shape */
/** @typedef {import('./build.js').Build} Build */

/**
 * @typedef {object} StudyInput
 * @property {string} weapon
 * @property {Exclude<WeaponClass, 'melee'>} cls
 * @property {Shape} shape
 * @property {keyof typeof SCENARIOS} scenario
 * @property {import('./sim.js').SimOptions} opts  an adversary weapon's Valence type 'best': the
 *   element whose best build (no riven) does most, each one tried
 * @property {string[]} positives  stats the riven can roll as positives (spliced ones included)
 * @property {string[]} negatives  and as the curse
 */

/** A build as the page shows it: mod names in slot order (the riven as "Riven"), arcane, DPS. @param {Build} b */
const summary = b => ({ mods: b.slots.map(p => (p.riven ? 'Riven' : p.name)), arcane: b.arcane?.name ?? null, dps: b.dps });

/** A spliced stat keeps the better of two parents' rolls: its median roll is √½. @param {string} id */
const medianU = id => (STAT_BY_ID[id].spliced ? Math.SQRT1_2 : 0.5);

/** @param {StudyInput} input */
export function study(input) {
  const w = WEAPON_STATS[input.weapon];
  const sc = SCENARIOS[input.scenario];
  const { cls, shape } = input;
  // The kind of build decides the weak point share.
  // Room clearing and weak point builds fight 20 targets in a row (src/fight.js), single target one.
  const opts = { ...input.opts, weakpoint: sc.weakpoint, targets: sc.kills ? 20 : 1 };
  const pool = modPool(cls, w, sc, opts);
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
  const withRiven = (roll, from) => optimise(w, pool, arcanes, opts, { riven: rivenPiece(roll), start: from.slots });

  const none = found ?? optimise(w, pool, arcanes, opts);
  const empty = withRiven({}, none);

  // Each positive alone in the riven's slot, against the slot empty.
  const singles = input.positives.map(id => {
    const b = withRiven({ [id]: raw(id, '+') }, empty);
    return { id, shown: shown(id, '+'), change: b.dps / empty.dps - 1 };
  }).sort((a, b) => b.change - a.change);

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
    const b = withRiven(Object.fromEntries(ids.map(id => [id, raw(id, '+')])), empty);
    return { ids, change: b.dps / none.dps - 1, build: summary(b) };
  }).sort((a, b) => b.change - a.change).slice(0, 5);

  // Each curse on the best riven, against that riven without it.
  const best = sets[0];
  /** @type {{id: string, shown: string, change: number}[]} */
  let curses = [];
  if (best && SHAPES[shape].negatives) {
    const roll = Object.fromEntries(best.ids.map(id => [id, raw(id, '+')]));
    const base = withRiven(roll, empty);
    curses = input.negatives.filter(id => !best.ids.includes(id)).map(id => {
      const b = withRiven({ ...roll, [id]: raw(id, '-') }, base);
      return { id, shown: shown(id, '-'), change: b.dps / base.dps - 1 };
    }).sort((a, b) => b.change - a.change);
  }
  return { none: summary(none), empty: empty.dps, singles, sets, curses, valences, valence: opts.valence ?? null };
}
