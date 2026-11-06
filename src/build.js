// @ts-check
// Build optimiser: the best mods (and arcane) for a gun in a scenario, with or without a riven, so a
// riven's worth is the best build with it against the best without it. Pure functions, no DOM.
//
// A build is up to eight mods in slot order (the order decides how elements combine) plus an
// arcane; a riven, when there is one, takes a slot like a mod and its elements go in bottom-up.
// The search fills the slots greedily, then keeps making the single best change (swap a mod for
// another, or swap two slots) until none helps. Not exhaustive: a good build, not a proven best.

import { GUN_MODS } from './data/mods.js';
import { GUN_ARCANES } from './data/arcanes.js';
import { STAT_BY_ID } from './data/stats.js';
import { rivenOrder, BASE, COMBINED } from './elements.js';
import { dpsOf } from './sim.js';
import { fight } from './fight.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('./data/weapon-stats.js').WeaponStats} WeaponStats */
/** @typedef {import('./data/mods.js').Mod} Mod */
/** @typedef {import('./data/mods.js').Effect} Effect */
/** @typedef {import('./sim.js').SimOptions} SimOptions */
/** @typedef {import('./sim.js').Totals} Totals */

/**
 * The kind of build: what it's up against and how it's used. Hitting weak points is hard, so it's a
 * build of its own, not a share of every build's hits.
 * @typedef {object} Scenario
 * @property {boolean} kills       kills keep on-kill stacks up; false: a single target, no stacks
 * @property {boolean} aiming      aiming-only bonuses count
 * @property {number} weakpoint    share of direct hits on weak points
 */

/** @type {Record<'room' | 'single' | 'weak', Scenario>} */
export const SCENARIOS = {
  room: { kills: true, aiming: true, weakpoint: 0 },    // room clearing: kills, body shots
  single: { kills: false, aiming: true, weakpoint: 0 },  // one target, no kill stacks
  weak: { kills: true, aiming: true, weakpoint: 1 },    // every direct hit on a weak point
};

const ELEMENTS = [...BASE, ...COMBINED];
/** Arcane effects that change how a melee weapon works, rather than adding to a stat. */
const MECHANIC = new Set(['influence', 'afflictions', 'duplicate', 'doughty']);

/** Stats the damage model uses (others, such as zoom or ammo, change nothing in it). */
const DPS_STATS = new Set(['damage', 'multishot', 'critChance', 'critDamage', 'statusChance', 'statusDuration',
  'statusDamage', 'fireRate', 'magazine', 'reloadSpeed', 'ammoEfficiency', 'impact', 'puncture', 'slash',
  'weakpointDamage', 'weakpointCrit', 'headshotMultiplier', 'directDamage', 'slashOnCrit', 'multishotLocked', 'fireRateLocked',
  'directDamagePerStatus', 'critChancePerTier', 'statusChancePerTier', 'initialCombo', 'comboChance',
  'duplicate', 'doughty', 'influence', 'afflictions', ...ELEMENTS]);

/**
 * How much of an effect is live in a scenario: 0 (off), 1, or its stack count (a per status type
 * bonus counts per type on the target in dpsOf). Triggers the model doesn't follow (reload from empty, first shot,
 * invisibility, ability casts, movement, a chance proc) count as off.
 * @param {Effect} e @param {Scenario} sc
 */
export function liveFactor(e, sc) {
  if (e.aim && !sc.aiming) return 0;
  if (e.chance !== undefined && e.chance < 1) return 0;
  const wp = sc.weakpoint > 0;
  let f = 0;
  const on = e.on;
  if (!on) f = 1;
  else if (/^kill(\/passive)?$/.test(on)) f = sc.kills ? (e.stacks ?? 1) : 0;
  else if (/(weak point|headshot) kill/.test(on)) f = sc.kills && wp ? (e.stacks ?? 1) : 0;
  else if (/(weak point|headshot)( hit)?$/.test(on)) f = wp ? (e.stacks ?? 1) : 0;
  else if (on === 'hit') f = e.stacks ?? 1;                 // sustained fire keeps on-hit stacks up
  return f;
}

/**
 * Mod compat names that fit a weapon. Rifle mods fit every rifle-class primary; Assault Rifle mods
 * only the "Rifle" kind; Sniper and Bow mods their own; PRIMARY mods rifles and shotguns.
 * @param {WeaponClass} cls @param {string} kind  the wiki's class, e.g. "Sniper Rifle"
 */
export function compatFor(cls, kind) {
  if (cls === 'rifle') return ['Rifle', 'PRIMARY', ...(kind === 'Rifle' ? ['Assault Rifle'] : []),
    ...(kind === 'Sniper Rifle' ? ['Sniper'] : []), ...(/bow/i.test(kind) ? ['Bow'] : [])];
  if (cls === 'shotgun') return ['Shotgun', 'PRIMARY'];
  if (cls === 'pistol') return ['Pistol'];
  if (cls === 'archgun') return ['Archgun'];
  if (cls === 'melee') return ['Melee'];
  return [];
}

/**
 * One thing in a build (a mod, the riven, the arcane) reduced to what it adds in a scenario.
 * @typedef {{name: string, stats: Record<string, number>, elements: {type: string, value: number}[], excl: string[], riven?: true, chosen?: true}} Piece
 */

/**
 * A piece from effects: live values summed by stat, elements kept in order.
 * @param {string} name @param {Effect[]} effects @param {Scenario} sc @param {SimOptions} opts @param {string[]} [excl]
 * @returns {Piece}
 */
function piece(name, effects, sc, opts, excl = []) {
  /** @type {Record<string, number>} */
  const stats = {};
  const elements = [];
  for (const e of effects) {
    const f = liveFactor(e, sc);
    if (!f) continue;
    // Per status type on the target, or per melee combo tier past 1x (Blood Rush): counted in the fight.
    const stat = e.per === 'status type' ? `${e.stat}PerStatus` : e.per === 'combo tier' ? `${e.stat}PerTier` : e.stat;
    if (ELEMENTS.includes(e.stat)) elements.push({ type: e.stat, value: e.value * f });
    else stats[stat] = (stats[stat] ?? 0) + e.value * f;
  }
  return { name, stats, elements, excl };
}

/**
 * A riven as a piece: its stats (raw values, as rawValue gives them), its elements bottom-up.
 * @param {Record<string, number>} roll  stat id → raw value
 * @returns {Piece}
 */
export function rivenPiece(roll) {
  /** @type {Record<string, number>} */
  const stats = {};
  const listed = [];
  for (const [id, v] of Object.entries(roll)) {
    if (ELEMENTS.includes(id)) listed.push({ type: id, value: v }); else stats[id] = v;
  }
  return { name: 'Riven', stats, elements: rivenOrder(listed), excl: [], riven: true };
}

/** A build's totals: its pieces summed, elements in slot order. @param {Piece[]} pieces @returns {Totals} */
function totalsOf(pieces) {
  /** @type {Record<string, number>} */
  const stats = {};
  const elements = [];
  for (const p of pieces) {
    for (const [k, v] of Object.entries(p.stats)) stats[k] = (stats[k] ?? 0) + v;
    elements.push(...p.elements);
  }
  return { stats, elements };
}

/**
 * A weapon's compatibility tags, as mods ask for them. The wiki tags few weapons SEMI_AUTO, so a
 * weapon whose only trigger is semi-auto counts too. "Auto / Semi" doesn't: Felarx and Laetum can't
 * take the Semi- Cannonades (the user, in game, 2026-11-02).
 * @param {WeaponStats} w
 */
export function weaponTags(w) {
  return new Set([...w.tags, ...(/^Semi(-Auto)?$/.test(w.trigger) ? ['SEMI_AUTO'] : [])]);
}

/**
 * The mods (as pieces) that can help this weapon in this scenario: compatible (class, and the
 * weapon tags a mod needs or can't go with), and with at least one live effect on a stat the damage
 * model uses (faction mods only against their own faction).
 * @param {WeaponClass} cls @param {WeaponStats} w @param {Scenario} sc @param {SimOptions} opts
 */
export function modPool(cls, w, sc, opts) {
  const fits = compatFor(cls, w.kind);
  const tags = weaponTags(w);
  const enemy = opts.enemy ?? '';
  return GUN_MODS.filter(m => fits.includes(m.compat) && (!m.needs || m.needs.some(t => tags.has(t)))
    && !(m.notWith ?? []).some(t => tags.has(t))).map(m => ({ m, p: piece(m.name, m.effects, sc, opts, m.excl ?? []) }))
    .filter(({ p }) => Object.keys(p.stats).some(k => DPS_STATS.has(k) || k === enemy) || p.elements.length)
    .map(({ p }) => p);
}

/**
 * The arcanes a weapon's arcane slot takes, by name (each one, whether the model sees it do anything).
 * @param {WeaponClass} cls
 */
export function arcaneNames(cls) {
  const slot = cls === 'pistol' ? 'secondary' : cls === 'rifle' || cls === 'shotgun' ? 'primary' : cls === 'melee' ? 'melee' : null;
  return GUN_ARCANES.filter(a => a.slot === slot && !(cls === 'rifle' && /^Shotgun /.test(a.name))).map(a => a.name);
}

/**
 * The arcanes (as pieces) a weapon's arcane slot takes: those that do something here, or only the
 * one chosen (opts.arcane: '' for none), which the build then always carries.
 * @param {WeaponClass} cls @param {Scenario} sc @param {SimOptions} opts
 */
export function arcanePool(cls, sc, opts) {
  const names = arcaneNames(cls);
  if (opts.arcane !== undefined) {
    const a = GUN_ARCANES.find(x => x.name === opts.arcane && names.includes(x.name));
    return a ? [{ ...piece(a.name, a.effects, sc, opts), chosen: /** @type {const} */ (true) }] : [];
  }
  return GUN_ARCANES.filter(a => names.includes(a.name))
    .map(a => piece(a.name, a.effects, sc, opts)).filter(p => Object.keys(p.stats).length || p.elements.length);
}

/** Whether a piece can join the others (not the same mod, and no exclusion either way). @param {Piece} p @param {Piece[]} others */
const fitsWith = (p, others) => others.every(o => o.name !== p.name && !o.excl.includes(p.name) && !p.excl.includes(o.name));

/**
 * @typedef {object} Build
 * @property {Piece[]} slots   in slot order (the riven among them, when there is one)
 * @property {Piece | null} arcane
 * @property {number} dps
 */

/**
 * A build's fight against the target (src/fight.js), or null without one.
 * @param {WeaponStats} w @param {Build} b @param {SimOptions} opts
 */
export function fightOf(w, b, opts) {
  return opts.target ? fight(w, totalsOf(b.arcane ? [...b.slots, b.arcane] : b.slots), { ...opts, target: opts.target }) : null;
}

/**
 * The best build the search finds.
 * @param {WeaponStats} w @param {Piece[]} pool @param {Piece[]} arcanes @param {SimOptions} opts
 * @param {{riven?: Piece, start?: Piece[], slots?: number}} [o]  a riven to build around; a build to start from
 * @returns {Build}
 */
export function optimise(w, pool, arcanes, opts, o = {}) {
  const size = o.slots ?? 8;
  // A build's worth: the fight against the target (src/fight.js) when there is one, else the closed form.
  const target = opts.target;
  const value = (/** @type {Piece[]} */ slots, /** @type {Piece | null} */ arc) => {
    const t = totalsOf(arc ? [...slots, arc] : slots);
    return target ? fight(w, t, { ...opts, target }).dps : dpsOf(w, t, opts);
  };
  // For the pair move: the strongest mod of each base element (most of it, then most else besides).
  /** @type {Map<string, Piece>} */
  const strongest = new Map();
  for (const p of pool) {
    const e = p.elements[0];
    if (!e || p.elements.length > 1 || !BASE.includes(e.type)) continue;
    const have = strongest.get(e.type);
    const extra = (/** @type {Piece} */ q) => Object.values(q.stats).reduce((s, v) => s + v, 0);
    if (!have || e.value > have.elements[0].value || (e.value === have.elements[0].value && extra(p) > extra(have))) strongest.set(e.type, p);
  }
  const pairReps = [...strongest.values()];

  /** @param {Piece[]} slots @param {Piece | null} arc */
  const search = (slots, arc) => {
    let best = value(slots, arc);
    // Fill empty slots greedily.
    while (slots.length < size) {
      let pick = null, pickValue = -Infinity;
      for (const c of pool) {
        if (!fitsWith(c, slots)) continue;
        const v = value([...slots, c], arc);
        if (v > pickValue) { pick = c; pickValue = v; }
      }
      if (!pick) break;
      slots = [...slots, pick];
      best = pickValue;
    }
    // Then the single best change, again and again: swap a mod out, swap two slots, or put in two
    // elemental mods at once (a combined element needs both halves; either alone may not earn its
    // slot, so one swap at a time would never find Viral).
    const hasElements = (/** @type {Piece} */ p) => p.elements.length > 0;
    for (let round = 0; round < 50; round++) {
      let move = null, moveValue = best * (1 + 1e-9);
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].riven) continue;
        for (let j = i + 1; j < slots.length; j++) {
          if (slots[j].riven) continue;
          const rest = slots.filter((_, k) => k !== i && k !== j);
          for (const a of pairReps) {
            for (const b of pairReps) {
              if (a === b || a.elements[0].type === b.elements[0].type || !fitsWith(a, rest) || !fitsWith(b, [...rest, a])) continue;
              const next = [...slots];
              next[i] = a;
              next[j] = b;
              const v = value(next, arc);
              if (v > moveValue) { move = next; moveValue = v; }
            }
          }
        }
      }
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].riven) continue;
        const rest = slots.filter((_, j) => j !== i);
        for (const c of pool) {
          if (!fitsWith(c, rest)) continue;
          const next = [...slots];
          next[i] = c;
          const v = value(next, arc);
          if (v > moveValue) { move = next; moveValue = v; }
        }
        for (let j = i + 1; j < slots.length; j++) {
          if (!hasElements(slots[i]) && !hasElements(slots[j])) continue;
          const next = [...slots];
          [next[i], next[j]] = [next[j], next[i]];
          const v = value(next, arc);
          if (v > moveValue) { move = next; moveValue = v; }
        }
      }
      if (!move) break;
      slots = move;
      best = moveValue;
    }
    return { slots, dps: best };
  };

  const start = o.riven ? [o.riven, ...(o.start ?? []).filter(p => !p.riven).slice(0, size - 1)] : (o.start ?? []).slice(0, size);
  let { slots, dps } = search(start, null);
  // The arcane: the best for these mods, then the mods again around it.
  let arc = null;
  for (const a of arcanes) {
    const v = value(slots, a);
    // A chosen arcane goes in whatever it does.
    if (a.chosen || v > dps * (1 + 1e-9)) { arc = a; dps = v; }
  }
  if (arc) ({ slots, dps } = search(slots, arc));
  // Arcanes that change how the weapon works (Melee Influence needs Electricity procs; Afflictions
  // knockdowns with statuses up) can be worth nothing to the mods found without them: each gets a
  // search of its own around it. One worth under a quarter of the build when simply put in is passed
  // over (a winning one was never seen below 0.4 of it).
  for (const a of arcanes) {
    if (a === arc || !Object.keys(a.stats).some(k => MECHANIC.has(k))) continue;
    if (value(slots, a) < dps * 0.25) continue;
    const b = search(slots, a);
    if (b.dps > dps * (1 + 1e-9)) ({ slots, dps } = b), arc = a;
  }
  return { slots, arcane: arc, dps };
}

/**
 * The best build for each of several settings (a Valence element each, say). The search can stick
 * on a poor build, so each one restarts from every other setting's build and keeps the best.
 * @param {WeaponStats} w @param {Piece[]} pool @param {Piece[]} arcanes @param {SimOptions[]} settings
 * @returns {Build[]}
 */
export function optimiseEach(w, pool, arcanes, settings) {
  const builds = settings.map(opts => optimise(w, pool, arcanes, opts));
  const key = (/** @type {Build} */ b) => b.slots.map(p => p.name).sort().join('|');
  const starts = [...new Map(builds.map(b => [key(b), b.slots])).entries()];
  return settings.map((opts, i) => {
    let best = builds[i];
    for (const [k, slots] of starts) {
      if (k === key(builds[i])) continue;
      const b = optimise(w, pool, arcanes, opts, { start: slots });
      if (b.dps > best.dps) best = b;
    }
    return best;
  });
}

/**
 * A riven's worth on a weapon: the best build with it against the best without it, and each stat's
 * worth in the riven's slot (the best build with that stat alone on the riven, against an empty
 * riven slot: the seven other mods are re-chosen each time).
 * @param {WeaponStats} w @param {WeaponClass} cls @param {Scenario} sc @param {SimOptions} opts
 * @param {Record<string, number>[]} rolls  riven rolls to value (stat id → raw value)
 */
export function rivenWorth(w, cls, sc, opts, rolls) {
  opts = { ...opts, weakpoint: sc.weakpoint, targets: sc.kills ? 20 : 1 };
  const pool = modPool(cls, w, sc, opts);
  const arcanes = arcanePool(cls, sc, opts);
  const none = optimise(w, pool, arcanes, opts);
  const empty = optimise(w, pool, arcanes, opts, { riven: rivenPiece({}), start: none.slots });
  const results = rolls.map(roll => optimise(w, pool, arcanes, opts, { riven: rivenPiece(roll), start: empty.slots }));
  return { none, empty, results };
}

/** A build's mods as names in slot order, the riven shown with its stats. @param {Build} b */
export const describe = b => b.slots.map(p => (p.riven
  ? `Riven (${[...Object.keys(p.stats), ...p.elements.map(e => e.type)].map(id => STAT_BY_ID[id]?.name ?? id).join(', ') || 'empty'})`
  : p.name));
