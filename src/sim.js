// @ts-check
// Damage model for guns: what each riven stat adds to a weapon's damage per second over a simple
// reference build. Pure functions, no DOM. Melee fights through src/fight.js (src/melee.js: stance
// swings, the combo counter); this closed form is for guns.
//
// Per part of a fire mode (an attack and what hangs off it, e.g. a projectile and its explosion):
//
//   hit     = (1 + Damage) × (physical × (1 + Impact/Puncture/Slash) + other innate + base × Elements)
//   crit    = 1 + CC × (CD − 1)                         (average; holds past 100% crit chance)
//   direct  = hit × faction × crit × multishot × fire rate
//   DoT     = procs/s × share of DoT types × tick × ticks × (1 + Status Duration) × (1 + Status Damage)
//             × (1 + the matching elemental mods)
//
// The DoT is the base damage × (1 + Damage) × faction² × crit, per tick: Slash 35%, Heat, Toxin,
// Electricity and Gas 50%, each x (1 + its own element's mods: the wiki's Damage/Calculation; a
// Heat, Toxin or Electricity mod counts even once combined, Gas only counts Gas bonuses). Proc types
// are weighted by each type's share of the modded hit. Ticks (the wiki's Damage over Time): Slash,
// Heat and Toxin wait a second, then tick each second up to the proc's end (6 s: 6 ticks, the last at
// 6 s); Electricity and Gas tick at once and each second before the end (6 ticks, none at 6 s). So
// Status Duration rounds differently: at 7.8 s Toxin ticks 7 times, Electricity 8.
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
// A target (src/enemies.js: a unit at its level) has health, shields and armor, and its faction's
// weaknesses (Update 36: +50% or -50% by damage type). Shields go first: armor doesn't cover them,
// Heat does half to them, Toxin skips them (Slash bleeds don't, since Update 27.2), and Magnetic procs
// multiply the damage they take like Viral does health's (x2 for one, +25% each more, x4.25 at 10).
// When they break, each Magnetic stack deals 3% of the max shields as Electricity to health. Armor
// covers health: Corrosive and Heat procs take it down, Slash bleeds ignore it. The result is an
// effective DPS: the target's health and shields over the time to take both. Without a target:
// health only, no weaknesses, and the armor given (stripped by default).
// "Per status type" bonuses (Galvanized) count the status types the weapon keeps on the target: each
// type's chance of being up, from its procs per second over the 6 s a proc lasts. A primed target
// (a primer companion's work, or a squad's) has every type up, Viral and Corrosive at 10 stacks and
// Heat burning.
// Not modelled: Overguard, Eximus units, falloff, and the build changing around the riven (a riven
// element that saves a mod slot). Shield regeneration is left out on purpose: Magnetic stops it, and
// a target whose shields come back is one the build isn't keeping up with.

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
export const DOT = { slash: 0.35, heat: 0.5, toxin: 0.5, electricity: 0.5, gas: 0.5 };
/** The DoTs that tick when they proc (Electricity, Gas); the others wait a second. */
export const TICKS_AT_ONCE = new Set(['electricity', 'gas']);

/**
 * How many times a proc of a DoT type ticks, lasting `seconds`: each whole second after a delayed
 * proc up to its end, or from the proc on but not at its end.
 * @param {string} type @param {number} seconds
 */
export function ticksOf(type, seconds) {
  return TICKS_AT_ONCE.has(type) ? Math.ceil(seconds - 1e-9) : Math.floor(seconds + 1e-9);
}
/** The build's two elementals combine into this. */
const BUILD_ELEMENT = 'viral';
export const STATUS_SECONDS = 6;
/** Status types a target can carry (each counted once by "per status type" bonuses). */
export const STATUS_TYPES = [...PHYSICAL, ...ELEMENTS];
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
 * @property {number} [armor]      the enemy's armor without a target (default 0: stripped)
 * @property {Target} [target]     the unit fought, at its level (overrides armor)
 * @property {boolean} [primed]    every status type on the target (Viral and Corrosive at 10 stacks, Heat burning)
 * @property {number} [targets]    targets fought in a row (src/fight.js: 20 room clearing, 1 single target)
 * @property {Valence} [valence]   an adversary weapon's Valence bonus
 * @property {MeleeOptions} [melee] a melee weapon’s swings (src/fight.js; src/melee.js)
 * @property {string} [arcane]     the arcane the build carries (src/build.js arcanePool: '' for none; unset: the best found)
 */

/**
 * How a melee weapon fights: its stance combo's attacks (each a swing), the combo counter (held at
 * the initial combo, held at the max, or built up by the hits), and the enemies inside each swing
 * (room clearing: each further one takes the follow through's share and adds combo points).
 * @typedef {{attacks: import('./data/stances.js').Hit[][], combo: 'initial' | 'max' | 'build', heavy?: boolean, heavyAt?: number, nearby?: number, close?: number, clump?: number}} MeleeOptions
 */

/**
 * An adversary weapon's Valence bonus (Kuva, Tenet, Coda): one of Heat, Cold, Electricity, Toxin,
 * Impact, Magnetic, Radiation, 25%–60% of its listed damage (60% once fused; Valence Fusion).
 * @typedef {{type: string, value: number}} Valence
 */
export const VALENCE_TYPES = ['heat', 'cold', 'electricity', 'toxin', 'impact', 'magnetic', 'radiation'];

/**
 * A target at its level: what it takes to kill, and its weaknesses (damage type → extra share, e.g.
 * 0.5 or -0.5) on health and on shields.
 * @typedef {{health: number, shields: number, armor: number, weak: Record<string, number>, shieldWeak: Record<string, number>}} Target
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
 * An attack's crit chance: its own x (1 + Critical Chance mods), plus an incarnon perk's flat bonus
 * added after the mods (Elemental Excess, -10%). @param {Part} p @param {number} mods
 */
export const critChanceOf = (p, mods) => p.cc * (1 + mods) + (p.ccFlat ?? 0);

/**
 * The average damage multiplier from crits: 1 + CC x (CD - 1) (past 100%, the tiers keep it linear),
 * plus an incarnon's bonus on non-critical hits (Devastating / Devouring Attrition: a 50% chance of
 * +2000% on each hit that doesn't crit, so it fades as crit chance rises and is gone at 100%).
 * @param {number} cc @param {number} cd @param {Part} [p]
 */
export function critScale(cc, cd, p) {
  const nonCrit = p?.nonCrit ? Math.max(0, 1 - Math.max(0, cc)) * p.nonCrit.chance * p.nonCrit.mult : 0;
  return 1 + Math.max(0, cc) * (Math.max(1, cd) - 1) + nonCrit;
}

/**
 * An attack's weak point multiplier: the target's (its head, or opts.headMult) plus 1.5 x Weakpoint
 * Damage, then x (1 + headshot bonuses: Deadhead, Target Acquired, the weapon's own, e.g. Cernos
 * Prime's +50%). Weapons the wiki marks -2 (Arca Plasmor, Flux Rifle…) get no weak point bonus: 1x,
 * Weakpoint Damage does nothing, headshot bonuses still apply. Checked in game 2026-11-03: Cernos
 * Prime 2.25x on a Murmur head (1.5 x 1.5); Tenet Arca Plasmor 1x; Ignis Wraith 3x on a Grineer head.
 * @param {Part} p @param {string} enemy @param {SimOptions} opts @param {(id: string) => number} m
 */
export function weakPointMult(p, enemy, opts, m) {
  const head = (p.hs ?? 0) <= -1 ? 1 : Math.max(0, (opts.headMult ?? HEADS[enemy].headMult) + 1.5 * m('weakpointDamage'));
  return head * Math.max(0, 1 + m('headshotMultiplier') + Math.max(0, p.hs ?? 0));
}

/**
 * Damage per second of a build, from its totals.
 * @param {WeaponStats} w @param {Totals} t @param {SimOptions} [opts]
 */
export function dpsOf(w, t, opts = {}) {
  const raw = (/** @type {string} */ id) => t.stats[id] ?? 0;
  const mode = w.modes[opts.mode ?? w.main] ?? w.modes[0];
  // Each part's hit by type (the per status bonuses don't touch it), worked out once.
  const parts = mode.parts.map(p => ({ p, typed: hitByType(p, t, raw, opts.valence) }));
  const statusTypes = statusTypesUp(w, mode, t, opts, parts);
  // A "per status type" bonus (stat id + "PerStatus") counts once per type up.
  const stats = statusTypes ? withPerStatus(t.stats, statusTypes) : t.stats;
  const m = (/** @type {string} */ id) => stats[id] ?? 0;
  const wp = opts.weakpoint ?? 0;
  const enemy = opts.enemy ?? '';
  const faction = enemy ? Math.max(0, 1 + m(enemy)) : 1;
  const D = Math.max(0, 1 + m('damage'));
  // A weak point: its multiplier plus 1.5 x Weakpoint Damage (heads), then x headshot bonuses.
  const headcrit = opts.headcrit ?? HEADS[enemy].headcrit;
  // A fire-rate lock (the Semi- Cannonades) keeps the weapon's own rate.
  const rate = mode.rate * (m('fireRateLocked') ? 1 : Math.max(0.05, 1 + m('fireRate') * (opts.bow ? 2 : 1) + (w.bonus?.fireRate ?? 0)));
  const crit = critScale;
  const statusSeconds = STATUS_SECONDS * Math.max(0, 1 + m('statusDuration'));
  const statusMult = Math.max(0, 1 + m('statusDamage'));

  /** @type {Record<string, number>} the build's elemental mods by element, uncombined: they scale DoT ticks */
  const matching = {};
  for (const e of t.elements) matching[e.type] = (matching[e.type] ?? 0) + e.value;
  /** @type {Record<string, number>} damage per second by type (direct hits and DoT), before the target */
  const dealt = {};
  let bleed = 0;                                            // Slash DoT: True damage, past armor and shields
  /** @type {Record<string, number>} procs per second of the types whose stacks matter */
  const procs = { viral: 0, corrosive: 0, heat: 0, magnetic: 0 };
  for (const { p, typed } of parts) {
    if (!typed) continue;
    const { base, byType, hit } = typed;

    const cc = critChanceOf(p, m('critChance'));
    const ccWp = critChanceOf(p, m('critChance') + m('weakpointCrit'));
    const cd = p.cd * (1 + m('critDamage'));
    // Body and weak point hits: their scale (weak point × crit) mixed by share; Damage mods apart.
    // Explosions are never weak point hits.
    const onWp = p.aoe ? 0 : wp;
    const scale = (1 - onWp) * crit(cc, cd, p) + onWp * weakPointMult(p, enemy, opts, m) * crit(ccWp, headcrit ? 2 * cd : cd, p);
    // Galvanized's Direct Damage: added to Damage, or multiplying it, at this attack's share.
    const [coShare, coMult] = p.co ?? [1, 0];
    const Ddirect = Math.max(0, coMult ? D * (1 + coShare * m('directDamage')) : D + coShare * m('directDamage'));
    const pellets = p.ms * (m('multishotLocked') ? 1 : Math.max(0, 1 + m('multishot')));
    const direct = faction * Ddirect * scale * pellets * rate;

    // Status: chance per pellet (plus forced procs), type weighted by share of the hit; Hunter
    // Munitions adds a Slash proc chance on each critical hit.
    const procsPerPellet = procsOf(p, byType, hit, cc, m);
    // DoT ticks are a share of the base damage (not the elements or IPS mods), faction twice.
    const dotScale = statusMult * base * faction * faction * D * scale * pellets * rate;
    for (const [type, v] of Object.entries(byType)) dealt[type] = (dealt[type] ?? 0) + v * direct;
    for (const [type, tick] of Object.entries(DOT)) {
      const dot = procsPerPellet(type) * tick * ticksOf(type, statusSeconds) * dotScale * (1 + (matching[type] ?? 0));
      if (type === 'slash') bleed += dot; else dealt[type] = (dealt[type] ?? 0) + dot;
    }
    for (const type of Object.keys(procs)) procs[type] += procsPerPellet(type) * pellets * rate;
  }
  const uptime = opts.burst ? 1 : sustained(w, mode, rate, m);
  // Average stacks up: procs per second over the time each lasts, capped (all of them on a primed target).
  const stacks = (/** @type {string} */ type, cap = 10) => (opts.primed ? cap
    : Math.min(cap, procs[type] * uptime * STATUS_SECONDS * Math.max(0, 1 + m('statusDuration'))));
  // Below one stack on average, an effect ramps up with the share of time it's there.
  // Viral on health, Magnetic on shields: +100% for the first stack, +25% for each more.
  const amplify = (/** @type {number} */ n) => (n < 1 ? 1 + n : 1.75 + 0.25 * n);
  const viral = amplify(stacks('viral'));
  // Armor: Corrosive takes 26% for the first stack, 6% for each more (80% at 10); a Heat proc
  // halves what's left while it burns. Damage reduction 0.9 × √(armor / 2700).
  const c = stacks('corrosive');
  const stripped = c < 1 ? 0.26 * c : 0.2 + 0.06 * c;
  const target = opts.target ?? { health: 1, shields: 0, armor: opts.armor ?? 0, weak: {}, shieldWeak: {} };
  const armor = target.armor * (1 - stripped) * (1 - 0.5 * stacks('heat', 1));
  const kept = 1 - 0.9 * Math.sqrt(Math.min(armor, 2700) / 2700);

  // Per second, while firing: to health (all of it), and to shields (all but Toxin, which takes
  // health even while shields are up). Bleeds are True damage: no armor, no weaknesses.
  const toHealthOf = (/** @type {string} */ type, /** @type {number} */ v) => v * Math.max(0, 1 + (target.weak[type] ?? 0)) * kept * viral;
  const magnetic = target.shields > 0 ? stacks('magnetic') : 0;
  let toHealth = bleed * viral;
  let toxin = 0;
  let toShields = bleed * amplify(magnetic);
  for (const [type, v] of Object.entries(dealt)) {
    const h = toHealthOf(type, v);
    toHealth += h;
    if (type === 'toxin') toxin += h;
    else toShields += v * Math.max(0, 1 + (target.shieldWeak[type] ?? 0)) * amplify(magnetic);
  }
  if (target.shields <= 0) return toHealth * uptime;
  // Shields first; Toxin takes health meanwhile, and finishes it alone if it's faster. The break
  // costs health 3% of the max shields per Magnetic stack, as Electricity.
  const shieldTime = toShields > 0 ? target.shields / toShields : Infinity;
  const left = target.health - toxin * shieldTime - toHealthOf('electricity', 0.03 * magnetic * target.shields);
  const toxinAlone = target.health / Math.max(1e-9, toxin);
  const time = !Number.isFinite(shieldTime) ? toxinAlone : left <= 0 ? Math.min(shieldTime, toxinAlone) : shieldTime + left / toHealth;
  return (target.health + target.shields) / time * uptime;
}

/**
 * Stats with each per status type bonus counted `n` times into its own stat.
 * @param {Record<string, number>} stats @param {number} n
 */
export function withPerStatus(stats, n) {
  const out = { ...stats };
  for (const [k, v] of Object.entries(stats)) {
    if (k.endsWith('PerStatus')) { const id = k.slice(0, -'PerStatus'.length); out[id] = (out[id] ?? 0) + n * v; }
  }
  return out;
}

/**
 * A part's hit before Damage mods, by type: physical types scaled by their own stats; the build's
 * elements (shares of the base, in slot order) combined with the weapon's own (combineElements).
 * Null for a part that does no damage.
 * @param {Part} p @param {Totals} t @param {(id: string) => number} m @param {Valence} [valence]
 */
export function hitByType(p, t, m, valence) {
  const listed = Object.values(p.dmg).reduce((s, v) => s + v, 0);
  if (listed <= 0) return null;
  /** @type {Record<string, number>} */
  const byType = {};
  /** @type {Record<string, number>} */
  const innate = {};
  // The Valence bonus is the weapon's own damage: a share of its listed damage, joining in HCET order
  // (Impact scales with Impact mods), and part of the base that elemental mods and DoTs scale from.
  // In game, Coda Bassocyst's 808 with 60% Heat totals 1292.8, and Incendiary Coat's 90% adds 1163.5.
  const own = { ...p.dmg };
  if (valence?.value) own[valence.type] = (own[valence.type] ?? 0) + valence.value * listed;
  const base = listed * (1 + (valence?.value ?? 0));
  for (const [type, v] of Object.entries(own)) {
    if (PHYSICAL.includes(type)) byType[type] = v * Math.max(0, 1 + m(type));
    else if (ELEMENTS.includes(type)) innate[type] = v;
    else byType[type] = v;                                  // Tau, Void, True: as they are
  }
  const combined = combineElements(t.elements.map(e => ({ type: e.type, value: e.value * base })), innate);
  for (const [type, v] of Object.entries(combined)) byType[type] = (byType[type] ?? 0) + v;
  const hit = Object.values(byType).reduce((s, v) => s + v, 0);
  return hit > 0 ? { base, byType, hit } : null;
}

/**
 * Procs per pellet of a type: the status chance, the type weighted by its share of the hit, plus
 * forced procs and Hunter Munitions' Slash proc chance on each critical hit.
 * @param {Part} p @param {Record<string, number>} byType @param {number} hit @param {number} cc @param {(id: string) => number} m
 */
export function procsOf(p, byType, hit, cc, m) {
  const chance = Math.max(0, p.sc * (1 + m('statusChance')));
  const slashOnCrit = Math.min(1, Math.max(0, cc)) * m('slashOnCrit');   // the only "on crit" proc stat
  return (/** @type {string} */ type) => chance * (byType[type] ?? 0) / hit + (p.forced?.includes(type) ? 1 : 0)
    + (type === 'slash' ? slashOnCrit : 0);
}

/**
 * How many status types the weapon keeps on the target, on average: each type's chance of being up,
 * 1 - e^(-procs/s x seconds a proc lasts). Every type on a primed target. Per status type bonuses
 * don't change it (no status stat counts per status type).
 * @param {WeaponStats} w @param {WeaponStats['modes'][number]} mode @param {Totals} t @param {SimOptions} opts
 * @param {{p: Part, typed: ReturnType<typeof hitByType>}[]} parts
 */
function statusTypesUp(w, mode, t, opts, parts) {
  if (opts.primed) return STATUS_TYPES.length;
  const m = (/** @type {string} */ id) => t.stats[id] ?? 0;
  if (!Object.keys(t.stats).some(k => k.endsWith('PerStatus'))) return 0;
  const rate = mode.rate * (m('fireRateLocked') ? 1 : Math.max(0.05, 1 + m('fireRate') * (opts.bow ? 2 : 1) + (w.bonus?.fireRate ?? 0)));
  const pellets = m('multishotLocked') ? 1 : Math.max(0, 1 + m('multishot'));
  const uptime = opts.burst ? 1 : sustained(w, mode, rate, m);
  const seconds = STATUS_SECONDS * Math.max(0, 1 + m('statusDuration'));
  /** @type {Record<string, number>} procs per second by type (only the types the hit has, forced ones and Slash) */
  const perSecond = {};
  for (const { p, typed } of parts) {
    if (!typed) continue;
    const procs = procsOf(p, typed.byType, typed.hit, critChanceOf(p, m('critChance')), m);
    for (const type of new Set([...Object.keys(typed.byType), ...(p.forced ?? []), 'slash'])) {
      if (STATUS_TYPES.includes(type)) perSecond[type] = (perSecond[type] ?? 0) + procs(type) * p.ms * pellets * rate * uptime;
    }
  }
  return Object.values(perSecond).reduce((n, r) => n + 1 - Math.exp(-r * seconds), 0);
}

/**
 * What a shot costs in ammo, from Ammo Efficiency as a change to the cost (a riven's 70% is -0.7).
 * It stops at 75% off; only a source that sets it to 100% (free shots) goes further, and none the
 * model follows does (the user, 2026-11-04). @param {number} raw
 */
export const ammoCost = raw => Math.max(0.25, 1 + raw);

/**
 * The share of time spent firing: a magazine's shots, then the reload. A one-shot magazine (bows)
 * can't be modded. 1 for weapons without reloads or ammo use, and for Incarnon modes (their charges
 * aren't the magazine, so Magazine, Reload Speed and Ammo Efficiency don't touch them).
 * @param {WeaponStats} w @param {WeaponStats['modes'][number]} mode @param {number} rate @param {(id: string) => number} m
 */
function sustained(w, mode, rate, m) {
  if (w.mag <= 0 || w.reload <= 0 || mode.cost <= 0 || /incarnon/i.test(mode.name)) return 1;

  const mag = w.mag <= 1 ? w.mag : Math.max(1, Math.round(w.mag * Math.max(0, 1 + m('magazine'))));
  const shots = mag / (mode.cost * ammoCost(m('ammoEfficiency')));
  const firing = shots / rate;
  const reload = w.reload / Math.max(0.05, 1 + m('reloadSpeed') + (w.bonus?.reloadSpeed ?? 0));
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
