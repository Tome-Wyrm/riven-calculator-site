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
// Weak point hits (a chosen share of the direct hits; explosions never count) follow the wiki's Enemy
// Body Parts page (Update 44): the head's own multiplier (x3 for most factions, x1.5 for the Murmur
// and Techrot) plus 1.5 x Weakpoint Damage, then x (1 + headshot multiplier bonuses: Deadhead, Target
// Acquired); a critical headshot doubles the crit multiplier where the enemy allows it (not Corpus
// humanoids, the Murmur, Techrot). Weakpoint Critical Chance adds to Critical Chance, on weak point
// hits only. Galvanized's Direct Damage (gun Condition Overload) adds to Damage on direct hits, or
// multiplies on the attacks Underframe marks so (Coda Bassocyst), at the share it lists.
// Sustained DPS adds the reload: a magazine of shots (Ammo Efficiency stretches it) then the reload time.
//
// Armor is optional (stripped by default): Corrosive and Heat procs take it down, Slash bleeds ignore it.
// Not modelled: shields, health types,
// falloff, and the build changing around the riven (a riven element that saves a mod slot).

import { STAT_BY_ID, SHAPES } from './data/stats.js';
import { rawValue, displayValue, format } from './engine.js';
import { combineElements } from './elements.js';

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
export const FACTIONS = ['grineer', 'corpus', 'infested', 'orokin', 'scaldra', 'techrot', 'murmur'];

/** @typedef {'' | 'grineer' | 'corpus' | 'infested' | 'orokin' | 'scaldra' | 'techrot' | 'murmur'} Enemy */

/**
 * Each faction's usual weak point (the wiki's Enemy Body Parts, Update 44): its multiplier, and
 * whether its heads take the critical headshot bonus. Typical units; many differ (MOA rears, Bursa
 * consoles, Juggernaut maws…). Any faction: a Grineer-like 3x head.
 * @type {Record<Enemy, {headMult: number, headcrit: boolean}>}
 */
export const HEADS = {
  '': { headMult: 3, headcrit: true },
  grineer: { headMult: 3, headcrit: true },
  corpus: { headMult: 3, headcrit: false },               // humanoids: no headcrit (Ospreys do)
  infested: { headMult: 3, headcrit: true },
  orokin: { headMult: 3, headcrit: true },                // Corrupted (Grineer-like heads)
  scaldra: { headMult: 3, headcrit: true },
  techrot: { headMult: 1.5, headcrit: false },
  murmur: { headMult: 1.5, headcrit: false },
};

/**
 * @typedef {object} SimOptions
 * @property {number} [mode]       fire mode index (default: the weapon's main one)
 * @property {Enemy} [enemy]       faction fought ('' = none: faction damage counts for nothing)
 * @property {number} [weakpoint]  share of direct hits on weak points, 0–1 (default 0: body shots)
 * @property {number} [headMult]   the target's weak point multiplier (default: its faction's, HEADS)
 * @property {boolean} [headcrit]  whether the target takes the critical headshot bonus (default: its faction's)
 * @property {boolean} [burst]     ignore reloads (default: sustained)
 * @property {boolean} [bow]       a bow: Fire Rate rolls count double
 * @property {number} [armor]      the enemy's armor (default 0: stripped); Steel Path enemies reach 2700
 */

/** Stats with no effect on damage in this model (they're quality of life). */
export const NO_DPS = new Set(['ammoMax', 'punchThrough', 'projectileSpeed', 'zoom', 'recoil', 'reloadWhileHolstered']);

/**
 * A build's totals: each stat summed over its mods, arcane and riven (raw: +165% → 1.65), faction
 * stats by faction id, and the elements in slot order (each a share of the base damage) for
 * combineElements.
 * @typedef {{stats: Record<string, number>, elements: {type: string, value: number}[]}} Totals
 */

/**
 * The reference build plus riven modifiers, as totals (the old fixed-build model; 13b replaces it
 * with real builds). Its elements are one Viral, already combined; the riven's come after.
 * @param {Exclude<WeaponClass, 'melee'>} cls @param {Record<string, number>} mods @returns {Totals}
 */
export function referenceTotals(cls, mods) {
  const b = BUILDS[cls];
  /** @type {Record<string, number>} */
  const stats = { ...mods };
  for (const k of /** @type {const} */ (['damage', 'multishot', 'critChance', 'critDamage'])) stats[k] = (stats[k] ?? 0) + b[k];
  const elements = [{ type: BUILD_ELEMENT, value: b.element },
    ...ELEMENTS.filter(id => (mods[id] ?? 0) > 0).map(id => ({ type: id, value: mods[id] }))];
  for (const id of ELEMENTS) delete stats[id];
  return { stats, elements };
}

/**
 * Damage per second with riven modifiers `mods` (stat id → raw value, as rawValue gives it) on the
 * reference build.
 * @param {WeaponStats} w @param {Exclude<WeaponClass, 'melee'>} cls @param {Record<string, number>} mods @param {SimOptions} [opts]
 */
export function dps(w, cls, mods, opts = {}) {
  return dpsOf(w, referenceTotals(cls, mods), opts);
}

/**
 * Damage per second of a build, from its totals.
 * @param {WeaponStats} w @param {Totals} t @param {SimOptions} [opts]
 */
export function dpsOf(w, t, opts = {}) {
  const m = (/** @type {string} */ id) => t.stats[id] ?? 0;
  const mode = w.modes[opts.mode ?? w.main] ?? w.modes[0];
  const wp = opts.weakpoint ?? 0;
  const enemy = opts.enemy ?? '';
  const faction = enemy ? Math.max(0, 1 + m(enemy)) : 1;
  const D = Math.max(0, 1 + m('damage'));
  // A weak point: its multiplier plus 1.5 x Weakpoint Damage (heads), then x headshot bonuses.
  const wpMult = Math.max(0, (opts.headMult ?? HEADS[enemy].headMult) + 1.5 * m('weakpointDamage')) * Math.max(0, 1 + m('headshotMultiplier'));
  const headcrit = opts.headcrit ?? HEADS[enemy].headcrit;
  // A fire-rate lock (the Semi- Cannonades) keeps the weapon's own rate.
  const rate = mode.rate * (m('fireRateLocked') ? 1 : Math.max(0.05, 1 + m('fireRate') * (opts.bow ? 2 : 1)));
  const crit = (/** @type {number} */ cc, /** @type {number} */ cd) => 1 + Math.max(0, cc) * (Math.max(1, cd) - 1);
  const statusMult = TICKS * Math.max(0, 1 + m('statusDuration')) * Math.max(0, 1 + m('statusDamage'));

  let armored = 0;                                          // damage armor reduces
  let bleed = 0;                                            // Slash DoT: true damage, armor or not
  /** @type {Record<string, number>} procs per second of the types whose stacks matter */
  const procs = { viral: 0, corrosive: 0, heat: 0 };
  for (const p of mode.parts) {
    const base = Object.values(p.dmg).reduce((s, v) => s + v, 0);
    if (base <= 0) continue;
    // The hit before Damage mods, by type: physical types scaled by their own stats; the build's
    // elements (shares of the base, in slot order) combined with the weapon's own (combineElements).
    /** @type {Record<string, number>} */
    const byType = {};
    /** @type {Record<string, number>} */
    const innate = {};
    for (const [type, v] of Object.entries(p.dmg)) {
      if (PHYSICAL.includes(type)) byType[type] = v * Math.max(0, 1 + m(type));
      else if (ELEMENTS.includes(type)) innate[type] = v;
      else byType[type] = v;                                // Tau, Void, True: as they are
    }
    const combined = combineElements(t.elements.map(e => ({ type: e.type, value: e.value * base })), innate);
    for (const [type, v] of Object.entries(combined)) byType[type] = (byType[type] ?? 0) + v;
    const hit = Object.values(byType).reduce((s, v) => s + v, 0);
    if (hit <= 0) continue;

    const cc = p.cc * (1 + m('critChance'));
    const ccWp = p.cc * (1 + m('critChance') + m('weakpointCrit'));
    const cd = p.cd * (1 + m('critDamage'));
    // Body and weak point hits: their scale (weak point × crit) mixed by share; Damage mods apart.
    // Explosions are never weak point hits.
    const onWp = p.aoe ? 0 : wp;
    const scale = (1 - onWp) * crit(cc, cd) + onWp * wpMult * crit(ccWp, headcrit ? 2 * cd : cd);
    // Galvanized's Direct Damage: added to Damage, or multiplying it, at this attack's share.
    const [coShare, coMult] = p.co ?? [1, 0];
    const Ddirect = Math.max(0, coMult ? D * (1 + coShare * m('directDamage')) : D + coShare * m('directDamage'));
    const pellets = p.ms * (m('multishotLocked') ? 1 : Math.max(0, 1 + m('multishot')));
    const direct = hit * faction * Ddirect * scale * pellets * rate;

    // Status: chance per pellet (plus forced procs), type weighted by share of the hit; Hunter
    // Munitions adds a Slash proc chance on each critical hit.
    const chance = Math.max(0, p.sc * (1 + m('statusChance')));
    const onCrit = (/** @type {string} */ type) => Math.min(1, Math.max(0, cc)) * m(`${type}OnCrit`);
    const procsPerPellet = (/** @type {string} */ type) => chance * (byType[type] ?? 0) / hit + (p.forced?.includes(type) ? 1 : 0) + onCrit(type);
    // DoT ticks are a share of the base damage (not the elements or IPS mods), faction twice.
    const dotScale = statusMult * base * faction * faction * D * scale * pellets * rate;
    armored += direct;
    for (const [type, tick] of Object.entries(DOT)) {
      const dot = procsPerPellet(type) * tick * dotScale;
      if (type === 'slash') bleed += dot; else armored += dot;
    }
    for (const type of Object.keys(procs)) procs[type] += procsPerPellet(type) * pellets * rate;
  }
  const uptime = opts.burst ? 1 : sustained(w, mode, rate, m);
  // Average stacks up: procs per second over the time each lasts, capped.
  const stacks = (/** @type {string} */ type, cap = 10) => Math.min(cap, procs[type] * uptime * STATUS_SECONDS * Math.max(0, 1 + m('statusDuration')));
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
