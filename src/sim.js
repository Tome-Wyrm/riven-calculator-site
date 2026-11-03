// @ts-check
// Damage model for guns: what each riven stat adds to a weapon's damage per second over a simple
// reference build. Pure functions, no DOM. Melee isn't modelled (combo, heavy attacks and stance
// builds don't fit a DPS number).
//
// Per part of a fire mode (an attack and what hangs off it, e.g. a projectile and its explosion):
//
//   hit     = (1 + Damage) × (physical × (1 + Impact/Puncture/Slash) + other innate + base × Elements)
//   crit    = 1 + CC × (CD − 1)                         (average; holds past 100% crit chance)
//   direct  = hit × faction × crit × multishot × fire rate
//   DoT     = procs/s × share of DoT types × tick × ticks × (1 + Status Duration) × (1 + Status Damage)
//
// The DoT is the base damage × (1 + Damage) × faction² × crit, per tick: Slash 35%, Heat, Toxin,
// Electricity and Gas 50%, 7 ticks. Proc types are weighted by each type's share of the modded hit.
// Viral procs stack (6 s each, up to 10): the first adds +100% damage, each more +25%. The build's
// elements are Viral, so a riven's Viral or Status Chance adds stacks until they cap.
// Weak point hits (a chosen share of them, heads or any other weak point) take the weak point
// multiplier, x2, which Weakpoint Damage multiplies: x2 x (1 + Weakpoint Damage). Weakpoint Critical
// Chance adds to Critical Chance (the same bucket), on weak point hits only. Sustained DPS adds the reload: a magazine
// of shots (Ammo Efficiency stretches it) then the reload time.
//
// Armor is optional (stripped by default): Corrosive and Heat procs take it down, Slash bleeds ignore it.
// Not modelled: shields, health types,
// falloff, and the build changing around the riven (a riven element that saves a mod slot).

import { STAT_BY_ID, SHAPES } from './data/stats.js';
import { rawValue, displayValue, format } from './engine.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('./data/stats.js').Shape} Shape */
/** @typedef {import('./data/weapon-stats.js').WeaponStats} WeaponStats */
/** @typedef {import('./data/weapon-stats.js').Part} Part */

/**
 * The reference build each riven is added to: an extra slot beside these mods (raw sums). The
 * damage includes a Merciless / Deadhead arcane at full stacks (+360%), which is why a riven's own
 * Damage counts for little on an endgame gun.
 * Rifle: Serration, Split Chamber, Vigilante Armaments, Point Strike, Vital Sense, Hammer Shot, two
 * 90% elementals. Shotgun: Primed Point Blank, Hell's Chamber, Blunderbuss, Primed Ravage, two
 * elementals. Pistol: Hornet Strike, Barrel Diffusion, Pistol Gambit, Primed Target Cracker, two
 * elementals. Archgun: the rifle's mods, no arcane.
 * @type {Record<Exclude<WeaponClass, 'melee'>, {damage: number, multishot: number, critChance: number, critDamage: number, element: number}>}
 */
export const BUILDS = {
  rifle:   { damage: 5.25, multishot: 1.5, critChance: 1.5, critDamage: 1.8, element: 1.8 },
  shotgun: { damage: 5.25, multishot: 1.2, critChance: 0.9, critDamage: 1.1, element: 1.8 },
  pistol:  { damage: 5.8,  multishot: 1.2, critChance: 1.2, critDamage: 1.1, element: 1.8 },
  archgun: { damage: 1.65, multishot: 1.5, critChance: 1.5, critDamage: 1.8, element: 1.8 },
};

const PHYSICAL = ['impact', 'puncture', 'slash'];
const ELEMENTS = ['cold', 'electricity', 'heat', 'toxin', 'blast', 'corrosive', 'gas', 'magnetic', 'radiation', 'viral'];
/** Damage per tick, as a share of the hit, for the types whose procs deal damage over time. */
const DOT = { slash: 0.35, heat: 0.5, toxin: 0.5, electricity: 0.5, gas: 0.5 };
const TICKS = 7;
/** The build's two elementals combine into this. */
const BUILD_ELEMENT = 'viral';
const STATUS_SECONDS = 6;
export const FACTIONS = ['grineer', 'corpus', 'infested', 'orokin', 'scaldra', 'techrot'];

/** @typedef {'' | 'grineer' | 'corpus' | 'infested' | 'orokin' | 'scaldra' | 'techrot'} Enemy */

/**
 * @typedef {object} SimOptions
 * @property {number} [mode]       fire mode index (default: the weapon's main one)
 * @property {Enemy} [enemy]       faction fought ('' = none: faction damage counts for nothing)
 * @property {number} [weakpoint]  share of hits on weak points, 0–1 (default 0.25)
 * @property {boolean} [burst]     ignore reloads (default: sustained)
 * @property {boolean} [bow]       a bow: Fire Rate rolls count double
 * @property {number} [armor]      the enemy's armor (default 0: stripped); Steel Path enemies reach 2700
 */

/** Stats with no effect on damage in this model (they're quality of life). */
export const NO_DPS = new Set(['ammoMax', 'punchThrough', 'projectileSpeed', 'zoom', 'recoil', 'reloadWhileHolstered']);

/**
 * Damage per second with riven modifiers `mods` (stat id → raw value, as rawValue gives it).
 * @param {WeaponStats} w @param {Exclude<WeaponClass, 'melee'>} cls @param {Record<string, number>} mods @param {SimOptions} [opts]
 */
export function dps(w, cls, mods, opts = {}) {
  const b = BUILDS[cls];
  const m = (/** @type {string} */ id) => mods[id] ?? 0;
  const mode = w.modes[opts.mode ?? w.main] ?? w.modes[0];
  const wp = opts.weakpoint ?? 0.25;
  const enemy = opts.enemy ?? '';
  const faction = enemy ? Math.max(0, 1 + m(enemy)) : 1;
  const D = Math.max(0, 1 + b.damage + m('damage'));
  const wpMult = 2 * Math.max(0, 1 + m('weakpointDamage'));
  const rate = mode.rate * Math.max(0.05, 1 + m('fireRate') * (opts.bow ? 2 : 1));
  const crit = (/** @type {number} */ cc, /** @type {number} */ cd) => 1 + Math.max(0, cc) * (Math.max(1, cd) - 1);
  const statusMult = TICKS * Math.max(0, 1 + m('statusDuration')) * Math.max(0, 1 + m('statusDamage'));

  let armored = 0;                                          // damage armor reduces
  let bleed = 0;                                            // Slash DoT: true damage, armor or not
  /** @type {Record<string, number>} procs per second of the types whose stacks matter */
  const procs = { viral: 0, corrosive: 0, heat: 0 };
  for (const p of mode.parts) {
    const base = Object.values(p.dmg).reduce((s, v) => s + v, 0);
    if (base <= 0) continue;
    // The hit before Damage mods, by type: physical types scaled by their own stats, the
    // build's and riven's elements added as a share of the base.
    /** @type {Record<string, number>} */
    const byType = {};
    for (const [t, v] of Object.entries(p.dmg)) byType[t] = PHYSICAL.includes(t) ? v * Math.max(0, 1 + m(t)) : v;
    // The build's elements and the riven's, each to its own type.
    byType[BUILD_ELEMENT] = (byType[BUILD_ELEMENT] ?? 0) + base * b.element;
    for (const id of ELEMENTS) if (m(id) > 0) byType[id] = (byType[id] ?? 0) + base * m(id);
    const hit = Object.values(byType).reduce((s, v) => s + v, 0);

    const cc = p.cc * (1 + b.critChance + m('critChance'));
    const ccWp = p.cc * (1 + b.critChance + m('critChance') + m('weakpointCrit'));
    const cd = p.cd * (1 + b.critDamage + m('critDamage'));
    // Body and weak point hits: their damage scale (Damage mods × headshot × crit) mixed by share.
    const scale = (1 - wp) * D * crit(cc, cd) + wp * wpMult * D * crit(ccWp, cd);
    const pellets = p.ms * Math.max(0, 1 + b.multishot + m('multishot'));
    const direct = hit * faction * scale * pellets * rate;

    // Status: chance per pellet (plus forced procs), type weighted by share of the hit.
    const chance = Math.max(0, p.sc * (1 + m('statusChance')));
    const procsPerPellet = (/** @type {string} */ t) => chance * (byType[t] ?? 0) / hit + (p.forced?.includes(t) ? 1 : 0);
    // DoT ticks are a share of the base damage (not the elements or IPS mods), faction twice.
    const dotScale = statusMult * base * faction * faction * scale * pellets * rate;
    armored += direct;
    for (const [t, tick] of Object.entries(DOT)) {
      const dot = procsPerPellet(t) * tick * dotScale;
      if (t === 'slash') bleed += dot; else armored += dot;
    }
    for (const t of Object.keys(procs)) procs[t] += procsPerPellet(t) * pellets * rate;
  }
  const uptime = opts.burst ? 1 : sustained(w, mode, rate, m);
  // Average stacks up: procs per second over the time each lasts, capped.
  const stacks = (/** @type {string} */ t, cap = 10) => Math.min(cap, procs[t] * uptime * STATUS_SECONDS * Math.max(0, 1 + m('statusDuration')));
  // Below one stack on average, an effect ramps up with the share of time it's there.
  const v = stacks('viral');
  const viral = v < 1 ? 1 + v : 1.75 + 0.25 * v;
  // Armor: Corrosive takes 26% for the first stack, 6% for each more (80% at 10); a Heat proc
  // halves what's left while it burns. Damage reduction 0.9 × √(armor / 2700).
  const c = stacks('corrosive');
  const stripped = c < 1 ? 0.26 * c : 0.2 + 0.06 * c;
  const armor = (opts.armor ?? 0) * (1 - stripped) * (1 - 0.5 * stacks('heat', 1));
  const kept = 1 - 0.9 * Math.sqrt(Math.min(armor, 2700) / 2700);
  return (armored * kept + bleed) * uptime * viral;
}

/**
 * The share of time spent firing: a magazine's shots, then the reload. A one-shot magazine (bows)
 * can't be modded. 1 for weapons without reloads or ammo use, and for Incarnon modes (their charges
 * aren't the magazine, so Magazine, Reload Speed and Ammo Efficiency don't touch them).
 * @param {WeaponStats} w @param {WeaponStats['modes'][number]} mode @param {number} rate @param {(id: string) => number} m
 */
function sustained(w, mode, rate, m) {
  if (w.mag <= 0 || w.reload <= 0 || mode.cost <= 0 || /incarnon/i.test(mode.name)) return 1;

  const mag = w.mag <= 1 ? w.mag : Math.max(1, Math.round(w.mag * Math.max(0, 1 + m('magazine'))));
  const shots = mag / (mode.cost * Math.max(0.01, 1 + m('ammoEfficiency')));
  const firing = shots / rate;
  const reload = w.reload / Math.max(0.05, 1 + m('reloadSpeed'));
  return firing / (firing + reload);
}

/**
 * A spliced stat keeps the better of its two parents' rolls, so its median roll is √½, not ½.
 * @param {string} id
 */
const medianU = id => (STAT_BY_ID[id].spliced ? Math.SQRT1_2 : 0.5);

/**
 * @typedef {object} StatEffect
 * @property {string} id
 * @property {string} shown    the median roll as the game shows it, e.g. "+147.6%"
 * @property {number} change   DPS change, e.g. 0.42 = +42%
 */

/**
 * Each stat on its own at its median roll for the shape: the DPS gain as a positive, or the loss as
 * the curse. Stats the shape can't hold that way are left out.
 * @param {WeaponStats} w @param {Exclude<WeaponClass, 'melee'>} cls @param {Shape} shape @param {'+' | '-'} sign
 * @param {string[]} ids  the stats to try (the weapon's pool) @param {SimOptions} [opts]
 * @returns {StatEffect[]} best first (biggest gain, or smallest loss)
 */
export function statEffects(w, cls, shape, sign, ids, opts = {}) {
  if (sign === '-' && !SHAPES[shape].negatives) return [];
  const base = dps(w, cls, {}, opts);
  return ids.map(id => {
    const stat = STAT_BY_ID[id];
    const u = sign === '+' ? medianU(id) : 0.5;
    const v = rawValue(stat, cls, shape, sign, u);
    return { id, shown: format(stat, displayValue(stat, cls, shape, sign, u)), change: dps(w, cls, { [id]: v }, opts) / base - 1 };
  }).sort((a, b) => b.change - a.change);
}

/**
 * The best sets of positives for the shape (as many as it holds, at most one spliced), each at its
 * median roll, by DPS gain together.
 * @param {WeaponStats} w @param {Exclude<WeaponClass, 'melee'>} cls @param {Shape} shape
 * @param {string[]} ids  the positives to try @param {SimOptions} [opts] @param {number} [top]
 * @returns {{ids: string[], change: number}[]}
 */
export function bestSets(w, cls, shape, ids, opts = {}, top = 5) {
  const k = SHAPES[shape].positives;
  const base = dps(w, cls, {}, opts);
  const value = Object.fromEntries(ids.map(id => [id, rawValue(STAT_BY_ID[id], cls, shape, '+', medianU(id))]));
  // Stats with no DPS effect only pad a set; leave them out unless there aren't enough others.
  const useful = ids.filter(id => !NO_DPS.has(id));
  const pool = useful.length >= k ? useful : ids;
  /** @type {{ids: string[], change: number}[]} */
  const sets = [];
  const pick = (/** @type {number} */ from, /** @type {string[]} */ chosen) => {
    if (chosen.length === k) {
      if (chosen.filter(id => STAT_BY_ID[id].spliced).length > 1) return;
      const mods = Object.fromEntries(chosen.map(id => [id, value[id]]));
      sets.push({ ids: chosen, change: dps(w, cls, mods, opts) / base - 1 });
      return;
    }
    for (let i = from; i < pool.length; i++) pick(i + 1, [...chosen, pool[i]]);
  };
  pick(0, []);
  return sets.sort((a, b) => b.change - a.change).slice(0, top);
}
