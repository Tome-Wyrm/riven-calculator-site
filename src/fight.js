// @ts-check
// The fight: a build against its target, shot by shot, until it dies. The questions are "is it dead
// yet?" and "how many shots did it take?". The DPS it gives counts overkill: a riven serves on more
// than this target, so a gun that one-shots it still gains from more damage (what it takes on the
// next, tougher one), though the shots and seconds it reports can't go below one shot.
//
// Stepped by shots (the fire rate), not by engine ticks: each shot lands its expected damage (crits,
// weak points and procs as averages, so builds compare without random noise), and between shots the
// damage over time runs as a rate.
// - A shot: the hit by type (src/sim.js's maths), x faction, x Damage (Galvanized's Direct Damage
//   counting the status types on this target now), into shields first (Toxin skips them; Magnetic
//   stacks multiply what they take; damage past them spills to health), then health (its faction
//   weaknesses, armor after Corrosive and Heat, Viral stacks).
// - Procs: each type's expected procs, lasting 6 s x (1 + Status Duration). DoT ticks (the wiki's
//   Damage over Time): Slash, Heat and Toxin wait a second, then tick each second to the end (6 ticks
//   at 6 s; rounding down); Electricity and Gas tick at once and each second before the end (6 ticks;
//   rounding up). Between shots the ticks run as a rate, each spread over the second around it (from
//   half a second after the proc). Heat stacks share one timer that each whole Heat proc resets, so
//   they ramp while procs keep coming. Heat strips armor in steps (15%, 30%, 40%, 50%),
//   one every 0.5 s x (1 + Status Duration), averaged over where a shot falls against them (shots
//   just either side of a step differ by 15%: luck, which made a faster reload worse). Shields
//   breaking deal 3% of the max shields per Magnetic stack as Electricity.
// - Reloads: a magazine of shots (Ammo Efficiency stretches it), then the reload; bursts ignore them.
//   Every shot carries its share of the reload (Vectis starts it as it fires: the reload in place of
//   a shot's interval), so a fight runs at the gun's sustained rate, DoTs ticking and statuses fading through
//   it. Not the real reload's place in the fight: where it falls depends on what the magazine held
//   when the fight began, and a kill that only just fits a full magazine isn't worth 3x one that
//   doesn't (the cliff: one round more or less swung a build from 1.4 s a kill to 5 s).
// - Room clearing: a run of identical targets (statuses don't carry over, the magazine does), so one
//   fight stands for them all. Single target: one fight. A target alive after 20 s is finished at the
//   rate it has been losing health.
// A kill's time: the last interval and the shot ending it count for the share of them the kill
// needed (the smooth average of what crit rolls spread), DoT and hit alike, never less than one
// shot. So a little more damage always kills a little sooner: a kill by a DoT between shots runs
// into a kill by the shot before it without a jump. The result is an effective DPS, the targets'
// health and shields over the time taken (without that floor: past a one-shot kill, the share of
// the shot it needed), so it reads like the closed form (src/sim.js dpsOf) and the optimiser can use
// either.
// A mixed room (opts.room: the Simulacrum's battlegroups): each unit fought as above, the room's DPS
// its health and shields over the time all of it takes, so its toughest units count for what they
// cost. Shots and seconds are per kill, averaged over the units.
// A crowd (opts.crowd, gun rooms): explosions, chains and Punch Through reach other enemies
// (src/crowd.js). What they add is taken as more of the same: a room's kills come that much sooner,
// by each attack's share of a shot. The others' armor and statuses aren't followed, nor kill stacks
// building faster (they're counted as up).
// Incarnon (opts.incarnon): a cycle, not the form alone. Normal fire until the gauge is full, the swap
// in (a reload's time: Reload Speed shortens it), the form until its ammo is gone (fire rate spends it
// sooner; nothing stretches it), the swap back (under a second: in game, Boar). The DPS is the two
// fights weighted by their time, averaged like reloads. Each pellet on a weak point charges (in game,
// Boar: 8 pellets, 50 hits, full in 7 shots; Multishot's pellets too), at a share of hits you aim for
// (for the gauge's speed only: the damage while charging stays the build's own share, or Incarnon
// would score for the aiming, not the form), up to the pellet that kills: the rest of the shot charges nothing, though it lands on the same
// frame (the user). What a shot charges with is an average of what whole pellets do (`chargedPellets`,
// checked against a pellet by pellet simulation). One target: the gauge starts full, the form first,
// then the cycle for what's left. A burst stays in the form.
// Overguard (opts.target.overguard): goes before shields, with no armor or weaknesses: Void does 50%
// more, Magnetic multiplies it as on shields, and its break costs 3% of it per stack as Electricity.
// Statuses still land under it here, though the wiki says it stops crowd control.
// Xata's Whisper's Void procs make a bubble for 3 s that turns shots to the body part they hit: with a
// share of hits on heads in it (`voidHeads`, 90% by the user's play), a fight runs at that share for
// the time it's up, by what a kill lets it get going (the first procs come a few shots in).
// Melee (src/melee.js): a shot is a swing, the next attack of the stance combo (its hits' multipliers
// summed for damage, each hit rolling crit and status), at the attack speed. The combo counter is
// held at the initial combo or the max, or built up by the hits (room clearing carries it from target
// to target); Blood Rush and Weeping Wounds add their bonus per tier past 1x. In room clearing, the
// enemies inside a swing (opts.melee.nearby) each take the follow through's share of the one before
// and add combo points: the room falls that much faster.
// Heavy attacks (opts.melee.heavy): the wiki's heavy damage x the combo multiplier, one hit after the
// wind up (Wind Up Speed shortens it; attack speed doesn't; no recovery is known, so none is counted).
// A built-up counter swings normally until opts.melee.heavyAt's tier, then spends the combo, keeping
// Heavy Attack Efficiency's share (at most 90%); it adds no combo, and spent Initial Combo comes back
// at 40 points a second. A held counter heavy attacks every time. True Steel's and rivens' crit chance
// count twice, Melee Animosity adds 42% per normal hit since the last heavy (all 420% on a held counter).
// Beams (a Held mode): a shot is a tick. Multishot counts as src/sim.js has it (`procsOf`), and a beam
// starts each target at a share of its damage (20% for most: the mode's `held`), reaching all of it over
// 0.6 s on the target (the wiki's Continuous Weapon). Its procs start as weak as its hits: the wiki says
// only "damage", and the game draws them from the hit. A reload's decay isn't followed (under a quarter
// of a second's damage a magazine, and most of it on a long fight).
// Blast (src/sim.js `blastPay`): each proc lands what it pays on average, at once, its Extra Hit too.
// In a crowd its detonations reach everyone within 5 m: those at 10 stacks, and the one a dying target
// sets off with the stacks it has, which is all on the others.
// Not modelled yet: extra hits, abilities (Phase 14), random rolls (a Monte Carlo run
// could check the averages).

import { DOT, STATUS_SECONDS, STATUS_TYPES, TICKS_AT_ONCE, HEADS, ammoCost, beamCount, blastDetonates, blastPay, BLAST_DETONATED, critFlatOf, extraWeak, factionOf, hitByType, procsOf, ticksOf, weakPointMult, critScale, critChanceOf } from './sim.js';
import { reachOf, sparkReach, within } from './crowd.js';
import { comboTier, swingOf, heavyMult, ANIMOSITY_HITS, COMBO_REGEN, MAX_COMBO, MAX_EFFICIENCY, MAX_TIER, TIER_POINTS } from './melee.js';

/** The elemental statuses Melee Influence spreads (not physical, Void or Tau). */
const ELEMENTAL = new Set(['cold', 'electricity', 'heat', 'toxin', 'blast', 'corrosive', 'gas', 'magnetic', 'radiation', 'viral']);

/** @typedef {import('./sim.js').SimOptions} SimOptions */
/** @typedef {import('./sim.js').Totals} Totals */
/** @typedef {import('./sim.js').Target} Target */
/** @typedef {import('./data/weapon-stats.js').WeaponStats} WeaponStats */

/** Heat's armor strip after each step of 0.5 s x (1 + Status Duration). */
const HEAT_STRIP = [0, 0.15, 0.3, 0.4, 0.5];
/**
 * Heat's strip `steps` of its time in: each step reached halfway to the next on average, running
 * between them (a shot's timing against the steps is luck). @param {number} steps
 */
const heatStrip = steps => {
  const x = Math.min(HEAT_STRIP.length - 1, Math.max(0, steps - 0.5));
  const i = Math.min(HEAT_STRIP.length - 2, Math.floor(x));
  return HEAT_STRIP[i] + (HEAT_STRIP[i + 1] - HEAT_STRIP[i]) * (x - i);
};
/** Seconds of hitting a target for a beam to reach its full damage. */
const BEAM_RAMP = 0.6;
/** Seconds simulated on one target before the rest is extrapolated. */
const TARGET_SECONDS = 20;

/**
 * @typedef {object} FightResult
 * @property {number} dps          the targets' health and shields over the time taken, overkill counted
 * @property {number} timePerKill  seconds, from the first shot until the gun is ready for the next target
 * @property {number} shotsPerKill
 * @property {number} perShot      the first shot's damage to a fresh target (health and shields; overkill counts; a beam's at its full damage)
 * @property {number} [tier]       melee: the combo multiplier at the last kill
 * @property {number} [inForm]      Incarnon: the share of the time in the form
 */

/** Seconds from the form back to normal fire (in game on Boar: firing again in under a second). */
const SWAP_OUT = 0.75;
/** Seconds Void's bubble lasts. */
const BUBBLE_SECONDS = 3;
/** A target's whole: health, shields and Overguard. @param {Target} t */
const ehpOf = t => t.health + t.shields + (t.overguard ?? 0);

/**
 * The pellets a shot charges with, on average, while killing a stream of targets. Pellets land one by
 * one until one kills. How many a kill takes: its health over a pellet's average damage, plus the
 * overshoot, as a kill runs past its last point by more when some pellets hit far harder than others
 * (renewal theory: `spread` is a pellet's mean square over its mean squared; a head hit against a
 * body hit makes it large), and at least one. A kill that spills into another shot wastes the rest
 * of that one: on average half a shot's worth, once the kill takes about a shot.
 * @param {number} pellets a shot's pellets @param {number} perShot its damage @param {number} ehp the target's health and shields @param {number} spread
 */
export function chargedPellets(pellets, perShot, ehp, spread) {
  const x = ehp / Math.max(1e-9, perShot / pellets);
  const taken = Math.max(1, x + spread / 2 * (1 - Math.exp(-x)));
  const spilled = 0.5 * (1 - 1 / Math.max(1, pellets)) * Math.min(1, Math.max(0, taken / pellets - 0.5) * 2);
  return taken / Math.max(1, taken / pellets + spilled);
}

/**
 * A build against its target: one fight, or the Incarnon cycle of two.
 * @param {WeaponStats} w @param {Totals} t @param {SimOptions & {target: Target, targets?: number}} opts
 * @returns {FightResult}
 */
export function fight(w, t, opts) {
  if (opts.room) return clear(w, t, opts.room, opts);
  const c = opts.incarnon;
  const { interval: _i, reload: _r, hits: _h, spread: _s, aimed: _a, ...once } = engage(w, t, opts);
  if (!c || opts.burst) return once;
  const form = engage(w, t, opts);
  const plain = engage(w, t, { ...opts, mode: c.normal });
  const ehp = ehpOf(opts.target);
  const landed = chargedPellets(plain.hits, plain.aimed, ehp, plain.spread);
  const charging = c.hits * plain.interval / Math.max(1e-9, landed * (c.any ? 1 : c.share ?? 0.75));
  const shotsInForm = c.ammo / Math.max(1e-9, (w.modes[opts.mode ?? w.main] ?? w.modes[0]).cost);
  const firing = shotsInForm * form.interval;
  const cycle = charging + plain.reload + firing + SWAP_OUT;
  const dps = (plain.dps * charging + form.dps * firing) / cycle;
  const shots = charging / plain.interval + shotsInForm;
  if ((opts.targets ?? 1) <= 1) {
    // One target: the gauge starts full. The form may finish it; what's left goes at the cycle's rate.
    if (form.dps * firing >= ehp) return { ...once, inForm: 1 };
    const rest = (ehp - form.dps * firing) / Math.max(1e-9, dps);
    const time = firing + rest;
    return { dps: ehp / time, timePerKill: time, shotsPerKill: shotsInForm + rest * shots / cycle, perShot: form.perShot, inForm: (firing + rest * firing / cycle) / time };
  }
  const kills = charging / plain.timePerKill + firing / form.timePerKill;
  return { dps, timePerKill: cycle / kills, shotsPerKill: shots / kills, perShot: form.perShot, inForm: firing / cycle };
}

/**
 * A mix of units, killed one after another. What a shot does is reported on the toughest.
 * @param {WeaponStats} w @param {Totals} t @param {import('./sim.js').RoomUnit[]} room @param {SimOptions} opts
 * @returns {FightResult}
 */
function clear(w, t, room, opts) {
  const { room: _, ...rest } = opts;
  const each = room.map(({ n, target }) => {
    const ehp = ehpOf(target);
    const r = fight(w, t, { ...rest, target });
    return { n, ehp, r, time: ehp / Math.max(1e-9, r.dps) };
  });
  const sum = (/** @type {(u: typeof each[number]) => number} */ f) => each.reduce((s, u) => s + u.n * f(u), 0);
  const kills = sum(() => 1), time = sum(u => u.time);
  const toughest = each.reduce((a, b) => (b.ehp > a.ehp ? b : a));
  return { dps: sum(u => u.ehp) / Math.max(1e-9, time), timePerKill: sum(u => u.r.timePerKill) / kills, shotsPerKill: sum(u => u.r.shotsPerKill) / kills,
    perShot: toughest.r.perShot, ...(toughest.r.tier !== undefined ? { tier: toughest.r.tier } : {}),
    ...(toughest.r.inForm !== undefined ? { inForm: sum(u => u.time * (u.r.inForm ?? 0)) / Math.max(1e-9, time) } : {}) };
}

/** Viral on health, Magnetic on shields: +100% for the first stack, +25% for each more. @param {number} n */
const amplify = n => (n < 1 ? 1 + n : 1.75 + 0.25 * n);

/**
 * One fight in one fire mode, with what the Incarnon cycle needs: a shot's interval, the reload, the
 * pellets a shot lands (each may charge the gauge), and, aiming for weak points as you do to charge,
 * how unevenly they hit and a shot's damage (`chargedPellets`).
 * @param {WeaponStats} w @param {Totals} t @param {SimOptions & {target: Target, targets?: number}} opts
 * @returns {FightResult & {interval: number, reload: number, hits: number, spread: number, aimed: number}}
 */
function engage(w, t, opts) {
  const first = fought(w, t, opts);
  const heads = t.stats.voidHeads ?? 0, wp = opts.weakpoint ?? 0;
  if (heads <= wp) return first;
  // Void procs a shot, at the weapon's status chance on each of its hits.
  const mode = w.modes[opts.mode ?? w.main] ?? w.modes[0];
  const sc = Math.max(0, (mode.parts.find(p => !p.aoe) ?? mode.parts[0]).sc * (1 + (t.stats.statusChance ?? 0)));
  const chance = Math.min(1, sc * Math.max(1, first.hits));
  if (!(chance > 0)) return first;
  // Of a kill's shots, the share after the first proc; and once going, the share of time it's up.
  const shots = Math.max(1, first.shotsPerKill);
  const started = 1 - (1 - (1 - chance) ** shots) / (shots * chance);
  const steady = 1 - Math.exp(-chance / first.interval * BUBBLE_SECONDS);
  return fought(w, t, { ...opts, weakpoint: wp + (heads - wp) * Math.min(started, steady) });
}

/**
 * One fight at the weak point share given.
 * @param {WeaponStats} w @param {Totals} t @param {SimOptions & {target: Target, targets?: number}} opts
 * @returns {FightResult & {interval: number, reload: number, hits: number, spread: number, aimed: number}}
 */
function fought(w, t, opts) {
  const target = opts.target;
  const targets = opts.targets ?? 1;
  const raw = (/** @type {string} */ id) => t.stats[id] ?? 0;
  const mode = w.modes[opts.mode ?? w.main] ?? w.modes[0];
  const crowd = targets > 1 && !(w.melee && opts.melee) ? opts.crowd : undefined;
  const enemy = opts.enemy ?? '';
  const wp = opts.weakpoint ?? 0;
  const faction = factionOf(raw, enemy);
  const D = Math.max(0, 1 + raw('damage'));
  const more = Math.max(0, 1 + raw('allDamage'));         // damage multipliers and vulnerabilities
  // (A crit on a Sonar spot is never a headcrit.)
  const headcrit = !raw('sonar') && (opts.headcrit ?? HEADS[enemy].headcrit);
  const rate = mode.rate * (raw('fireRateLocked') ? 1 : Math.max(0.05, 1 + raw('fireRate') * (opts.bow ? 2 : 1) + raw('fireRateFlat') + (w.bonus?.fireRate ?? 0)));
  const crit = critScale;
  const duration = STATUS_SECONDS * Math.max(0, 1 + raw('statusDuration'));
  const stripStep = 0.5 * duration / STATUS_SECONDS;
  const statusDamage = Math.max(0, 1 + raw('statusDamage'));
  /** @type {Record<string, number>} the build's elemental mods by element, uncombined: they scale DoT ticks */
  const matching = {};
  for (const e of t.elements) matching[e.type] = (matching[e.type] ?? 0) + e.value;
  // Galvanized's Direct Damage per status type on the target (the only per status type bonus).
  const directPer = raw('directDamagePerStatus');
  // Extra hits that proc, by element.
  const extraHits = Object.entries(t.stats).filter(([k, v]) => k.startsWith('extra:') && v > 0).map(([k, v]) => /** @type {[string, number]} */ ([k.slice('extra:'.length), v]));
  // The status types primers hold on the target.
  const held = STATUS_TYPES.filter(type => raw(`prime:${type}`) > 0);

  // What one shot carries, before Galvanized's per-status Direct Damage (which depends on the target).
  // Melee: at each combo tier (Blood Rush's crit chance, Weeping Wounds' status chance per tier).
  /** @type {Map<import('./sim.js').Part, ReturnType<typeof hitByType>>} */
  const hitOf = new Map();
  const volleysAt = (/** @type {(id: string) => number} */ raw) => mode.parts.flatMap(p => {
    // (The same at every tier: only crit and status chance change with it.)
    let typed = hitOf.get(p);
    if (typed === undefined) hitOf.set(p, typed = hitByType(p, t, raw, opts.valence));
    if (!typed) return [];
    const { base, byType, hit } = typed;
    const cc = critChanceOf(p, raw('critChance'), critFlatOf(p, raw));
    // Melee Doughty: +1x Critical Damage per whole 10% of Puncture status chance.
    const punctureChance = Math.max(0, p.sc * (1 + raw('statusChance'))) * (byType.puncture ?? 0) / hit;
    const cd = p.cd * (1 + raw('critDamage')) + raw('critDamageFlat') + (raw('doughty') ? Math.floor(punctureChance * 10 + 1e-9) * raw('doughty') : 0);
    const onWp = p.aoe ? 0 : wp;
    const onHead = crit(critChanceOf(p, raw('critChance') + raw('weakpointCrit'), critFlatOf(p, raw) + raw('critFlatHead')), headcrit ? 2 * cd : cd, p);
    const scale = (1 - onWp) * crit(cc, cd, p) + onWp * weakPointMult(p, enemy, opts, raw) * onHead;
    // (DoTs don't inherit Sonar's spots: the wiki's Damage over Time.)
    const dotCrit = (1 - onWp) * crit(cc, cd, p) + onWp * weakPointMult(p, enemy, opts, raw) / (raw('sonar') || 1) * onHead;
    // Melee Duplicate: a base (yellow) critical hit strikes again, crit and status rolled anew. A hit
    // is yellow with the chance it crits below 100%, and with 2 - CC between 100% and 200%.
    const yellow = cc < 1 ? Math.max(0, cc) : cc < 2 ? 2 - cc : 0;
    const multishot = raw('multishotLocked') ? 1 : Math.max(0, 1 + raw('multishot'));
    const pellets = p.ms * multishot * (1 + Math.min(1, raw('duplicate')) * yellow);
    const procsOfType = procsOf(p, byType, hit, cc, raw, pellets, mode.held != null ? beamCount(p, multishot) : null);
    /** @type {[string, number, number][]} per type: expected procs a shot, and a tick of its DoT per proc */
    const procs = [];
    for (const type of new Set([...Object.keys(byType), ...(p.forced ?? []), 'slash'])) {
      const { n, strength } = procsOfType(type);
      if (!(n > 0) || !STATUS_TYPES.includes(type)) continue;
      // A tick: base x Damage x faction twice x crit x its share x Status Damage x its element's mods,
      // x what a proc carries.
      const share = type === 'blast' ? 1 : DOT[/** @type {keyof typeof DOT} */ (type)] ?? 0;
      const own = type === 'blast' ? 1 : (1 + (matching[type] ?? 0));
      // (A seed starts from 1: not Blast's.)
      procs.push([type, n, (base * D * faction * dotCrit * strength / n + (type === 'blast' ? 0 : 1)) * faction * share * statusDamage * own * more]);
    }
    const [coShare, coMult] = p.co ?? [1, 0];
    const hits = Object.entries(byType).map(([type, v]) => /** @type {[string, number]} */ ([type, v * faction * scale * pellets * more]));
    // An Extra Hit: a share of the whole hit, faction and weak points again.
    const whole = hits.reduce((s, [, v]) => s + v, 0) * faction * extraWeak(p, onWp, enemy, opts, raw);
    const extra = whole * raw('extraVoid');
    if (extra) hits.push(['void', extra]);
    // The others (Toxic Lash, Resupply): a proc each, guaranteed, whose seed is the extra hit.
    for (const [type, value] of extraHits) {
      hits.push([type, whole * value]);
      const n = mode.held != null ? 1 : pellets;
      const share = DOT[/** @type {keyof typeof DOT} */ (type)];
      if (share) procs.push([type, n, (whole * value * D / n + 1) * faction * share * statusDamage * (1 + (matching[type] ?? 0))]);
    }
    // A Blast proc's Extra Hit: the pellet's, at what the proc pays, Status Damage and faction again.
    const blastVoid = extra * procsOfType('blast').strength / Math.max(1e-9, pellets) * statusDamage * faction;
    return [{ hits, coShare, coMult, procs, blastVoid,
      reach: crowd ? reachOf(p, mode, raw('punchThrough'), crowd) : 0 }];
  });
  const melee = w.melee && opts.melee ? opts.melee : null;
  /** @type {Map<number, ReturnType<typeof volleysAt>>} */
  const byTier = new Map();
  // The stats that change with the tier: without any, every tier is the same.
  const perTier = Object.keys(t.stats).filter(k => k.endsWith('PerTier') && t.stats[k]);
  // `animosity`: a heavy attack's Animosity stacks; -1 for a normal attack.
  const volleysOf = (/** @type {number} */ tier, animosity = -1) => {
    const level = perTier.length ? tier : 1;
    const key = level + (animosity + 1) * (MAX_TIER + 1);
    let v = byTier.get(key);
    if (!v) {
      const stats = { ...t.stats };
      for (const k of perTier) { const id = k.slice(0, -'PerTier'.length); stats[id] = (stats[id] ?? 0) + t.stats[k] * (level - 1); }
      if (animosity >= 0) stats.critChance = (stats.critChance ?? 0) + (stats.critChanceHeavy ?? 0) + (stats.animosity ?? 0) * animosity / ANIMOSITY_HITS;
      byTier.set(key, v = volleysAt(id => stats[id] ?? 0));
    }
    return v;
  };
  // Slam hits take Slam Attack Damage on their base damage (src/melee.js).
  const swings = melee ? melee.attacks.map(a => swingOf(a, raw('slamDamage'))) : [];
  // Heavy attacks: what one does at 1x, its wind up, and what it leaves of the combo.
  // A heavy slam (opts.melee.heavySlam) is a heavy attack made of its slam hits (multiples of the fire
  // mode's damage, Slam Attack Damage on them), with no wind up (it comes down from the air).
  const heavySwing = melee?.heavySlam ? swingOf(melee.heavySlam, raw('slamDamage')) : null;
  const heavyBase = melee?.heavy || heavySwing ? (heavySwing ? heavySwing.mult : heavyMult(w)) * (D > 0 ? Math.max(0, D + raw('meleeDamageOnHeavy')) / D : 1) : 0;
  const windUp = heavySwing ? 0 : (w.melee?.windUp ?? 0) / Math.max(0.05, 1 + raw('heavyWindup'));
  const kept = Math.min(MAX_EFFICIENCY, Math.max(0, raw('heavyEfficiency')));
  const heavyAt = Math.min(MAX_TIER, Math.max(1, melee?.heavyAt ?? MAX_TIER));
  // The enemies inside a swing (room clearing): the target, then each further one at the follow
  // through's share of the one before. They fall together: the room goes that much faster.
  const nearby = melee && targets > 1 ? Math.max(1, Math.round(melee.nearby ?? 1)) : 1;
  const ft = w.melee?.ft ?? 1;
  let together = 0;
  for (let k = 0; k < nearby; k++) together += ft ** k;
  // Combo points: each hit its multiplier, plus Additional Combo Count Chance's point, per enemy hit.
  const comboChance = Math.max(0, raw('comboChance'));
  const initial = Math.max(0, raw('initialCombo'));
  // Melee Afflictions: a knockdown or launching hit adds stacks to every status on the target.
  const afflictions = melee ? raw('afflictions') : 0;
  // Melee Influence (room clearing): while its buff is up, every elemental proc on the target spreads
  // to the enemies within 20 m (close), with that element's damage from the hit and the status (its
  // ticks too). With clumping k, each reached enemy is also within 20 m of k of the others and passes
  // the proc on to them: each of the close enemies takes 1 + k x (close - 1) copies. The buff: an
  // Electricity proc's 20% chance of 18 s, not refreshed while up; its uptime is the steady share
  // 18 l / (1 + 18 l) for triggers at l per second. What spreads counts as damage to the room.
  const influence = melee && targets > 1 ? raw('influence') : 0;
  const close = Math.max(0, Math.round(melee?.close ?? 0));
  const copies = close * (1 + Math.min(1, Math.max(0, melee?.clump ?? 0)) * Math.max(0, close - 1));
  let spreadDamage = 0;                                    // damage spread to the room (this target)
  // The others' armor: as the target's before any strip (their own statuses aren't followed).
  const fullArmor = 1 - 0.9 * Math.sqrt(Math.min(target.armor, 2700) / 2700);

  // The magazine: shots before a reload (none for Incarnon modes, weapons without one, or bursts).
  const reloads = !opts.burst && w.mag > 0 && w.reload > 0 && mode.cost > 0 && !/incarnon/i.test(mode.name);
  const mag = w.mag <= 1 ? w.mag : Math.max(1, Math.round(w.mag * Math.max(0, 1 + raw('magazine'))));
  const shotsPerMag = reloads ? mag / (mode.cost * ammoCost(raw('ammoEfficiency'))) : Infinity;
  const reload = w.reload / Math.max(0.05, 1 + raw('reloadSpeed') + (w.bonus?.reloadSpeed ?? 0));
  // A shot's interval at the sustained rate: its own, and its share of the reload.
  const interval = 1 / rate + (Number.isFinite(shotsPerMag) ? Math.max(0, reload - (w.quickReload ? 1 / rate : 0)) / shotsPerMag : 0);
  // (A beam's tick is one hit, whatever merged into it.)
  const hits = mode.held != null ? 1 : Math.max(1, ...mode.parts.filter(p => !p.aoe).map(p => p.ms)) * (raw('multishotLocked') ? 1 : Math.max(0, 1 + raw('multishot')));
  // A pellet's rolls, by chance and multiplier: its crit tiers, the non-crit bonus, on a body or a head.
  const rolls = (/** @type {import('./sim.js').Part} */ p, /** @type {number} */ cc, /** @type {number} */ cd) => {
    const tier = Math.floor(Math.max(0, cc)), over = Math.max(0, cc) - tier;
    const low = 1 + tier * (Math.max(1, cd) - 1), high = low + Math.max(1, cd) - 1;
    const bonus = tier === 0 && p.nonCrit ? p.nonCrit.chance : 0;
    return [[(1 - over) * (1 - bonus), low], [(1 - over) * bonus, low + (p.nonCrit?.mult ?? 0)], [over, high]];
  };
  let spread = 1, aiming = 1;                               // and a shot's damage aimed, over as fought
  const first = opts.incarnon ? mode.parts.find(p => !p.aoe) : null;
  if (first) {
    const cd = first.cd * (1 + raw('critDamage')) + raw('critDamageFlat');
    const head = weakPointMult(first, enemy, opts, raw);
    const body = rolls(first, critChanceOf(first, raw('critChance'), critFlatOf(first, raw)), cd);
    const onHead = rolls(first, critChanceOf(first, raw('critChance') + raw('weakpointCrit'), critFlatOf(first, raw) + raw('critFlatHead')), headcrit ? 2 * cd : cd);
    const moment = (/** @type {number} */ share, /** @type {number} */ power) => body.reduce((s, [c, v]) => s + (1 - share) * c * v ** power, 0)
      + onHead.reduce((s, [c, v]) => s + share * c * (v * head) ** power, 0);
    const aim = opts.incarnon?.share ?? 0.75;
    spread = moment(aim, 2) / Math.max(1e-9, moment(aim, 1) ** 2);
    aiming = moment(aim, 1) / Math.max(1e-9, moment(wp, 1));
  }
  const ehp = ehpOf(target);
  let perShot = 0;
  let lastTier = 1;
  let lastCombo = 0;                                        // the combo count at the last swing

  // One target, from its first shot until the gun is ready for the next; melee starts at a combo
  // count (carried from the last target when it builds up).
  const one = (combo = initial) => {
    let now = 0;                                // when the next shot is due
    let shots = 0;
    // A fresh target: full health and shields, no statuses (all of them if primed).
    let health = target.health;
    let shields = target.shields;
    let overguard = target.overguard ?? 0;
    // Everything a build applies lasts the same time, so it all expires in the order it came: each
    // list is a queue (from its head index) with a running total.
    /** @type {Map<string, {list: {until: number, n: number}[], head: number, sum: number}>} expected stacks by type */
    const stacks = new Map();
    // DoT ticks: waiting to start (half a second after their proc), then running until they end, in
    // two queues (ticking at once, or after a second: each kind lasts the same, so expires in order).
    /** @type {{at: number, rate: number, type: string, ticks: number}[]} */
    const pending = [];
    let pendingHead = 0;
    /** @type {{until: number, rate: number, type: string}[][]} */
    const running = [[], []];
    const runningHead = [0, 0];
    /** @type {Record<string, number>} the DoTs' running damage per second by type */
    const dotRate = {};
    let heat = { rate: 0, until: -1, start: -1, owed: 0 };
    let elecSeen = 0, buffUp = 0;
    let last = ehp;                             // what the last shot left of the target
    let swing = 0, sinceHeavy = 0;              // normal swings so far, and since the last heavy attack

    // Stacks still up at `at` (expired ones leave their queue for good: time only moves forward).
    const count = (/** @type {string} */ type, /** @type {number} */ at) => {
      if (opts.primed) return 10;
      const kept = raw(`prime:${type}`);                   // a primer's stacks
      const q = stacks.get(type);
      if (!q) return Math.min(10, kept);
      while (q.head < q.list.length && q.list[q.head].until <= at) q.sum -= q.list[q.head++].n;
      return Math.min(10, kept + q.sum);
    };
    // The target's state at a moment: what armor keeps, Viral and Magnetic.
    const snap = (/** @type {number} */ at) => {
      const c = count('corrosive', at);
      const stripped = c < 1 ? 0.26 * c : 0.2 + 0.06 * c;
      const held = opts.primed || raw('prime:heat') > 0;
      const burning = held || heat.until > at;
      const strip = !burning ? 0 : held ? HEAT_STRIP[HEAT_STRIP.length - 1] : heatStrip((at - heat.start) / stripStep);
      const armor = target.armor * (1 - stripped) * (1 - strip);
      return { kept: 1 - 0.9 * Math.sqrt(Math.min(armor, 2700) / 2700), viral: amplify(count('viral', at)), magnetic: count('magnetic', at) };
    };
    // Damage of one type landing: shields first (not Toxin), spilling to health. Bleeds (True
    // damage) skip armor and weaknesses.
    const land = (/** @type {string} */ type, /** @type {number} */ amount, /** @type {ReturnType<typeof snap>} */ s) => {
      if (!(amount > 0)) return;
      const bleed = type === 'slash-dot';
      const kind = bleed ? 'slash' : type;
      let left = amount;
      if (overguard > 0) {
        const toGuard = left * (kind === 'void' ? 1.5 : 1) * amplify(s.magnetic);
        if (toGuard < overguard) { overguard -= toGuard; return; }
        left *= 1 - overguard / toGuard;
        overguard = 0;
        health -= 0.03 * s.magnetic * (target.overguard ?? 0) * Math.max(0, 1 + (target.weak.electricity ?? 0)) * s.kept * s.viral;
      }
      if (shields > 0 && kind !== 'toxin') {
        const toShields = left * (bleed ? 1 : Math.max(0, 1 + (target.shieldWeak[kind] ?? 0))) * amplify(s.magnetic);
        if (toShields < shields) { shields -= toShields; return; }
        left *= 1 - shields / toShields;
        shields = 0;
        // The break: 3% of the max shields per Magnetic stack, as Electricity.
        health -= 0.03 * s.magnetic * target.shields * Math.max(0, 1 + (target.weak.electricity ?? 0)) * s.kept * s.viral;
      }
      health -= left * (bleed ? 1 : Math.max(0, 1 + (target.weak[kind] ?? 0)) * s.kept) * s.viral;
    };
    // One span of DoT damage at the rates now.
    const span = (/** @type {number} */ a, /** @type {number} */ b) => {
      if (b <= a) return;
      const s = snap(a);
      for (const type in dotRate) land(type, dotRate[type] * (b - a), s);
      if (heat.until > a) land('heat', heat.rate * (b - a), s);
    };
    // The DoTs from `from` to `to`, in spans between ticks starting and ending.
    const runDots = (/** @type {number} */ from, /** @type {number} */ to) => {
      let a = from;
      for (;;) {
        const starts = pendingHead < pending.length ? pending[pendingHead].at : Infinity;
        const ends0 = runningHead[0] < running[0].length ? running[0][runningHead[0]].until : Infinity;
        const ends1 = runningHead[1] < running[1].length ? running[1][runningHead[1]].until : Infinity;
        const heatEnds = heat.until > a ? heat.until : Infinity;
        const b = Math.min(starts, ends0, ends1, heatEnds);
        if (b >= to) break;
        span(a, b);
        a = b;
        if (b === starts) {
          const d = pending[pendingHead++];
          if (d.type === 'heat') { if (heat.until > b) heat.rate += d.rate; continue; }
          const q = TICKS_AT_ONCE.has(d.type) ? 0 : 1;
          running[q].push({ until: b + d.ticks, rate: d.rate, type: d.type });
          dotRate[d.type] = (dotRate[d.type] ?? 0) + d.rate;
        } else if (b === ends0 || b === ends1) {
          const q = b === ends0 ? 0 : 1;
          const d = running[q][runningHead[q]++];
          dotRate[d.type] -= d.rate;
        } else heat = { rate: 0, until: -1, start: -1, owed: 0 };
      }
      span(a, to);
    };

    for (;;) {
      if (now > TARGET_SECONDS && health > 0) {
        // Still alive: finish it at the rate it has been losing health and shields.
        const lost = ehp - Math.max(0, health) - shields - overguard;
        const more = (Math.max(0, health) + shields + overguard) * now / Math.max(1e-9, lost);
        return { time: now + more, pace: now + more, shots: shots + more / interval, combo };
      }
      // The shot: Galvanized counts the status types on the target now.
      const s = snap(now);
      const dotKilled = health <= 0;
      let types = 0;
      if (opts.primed) types = STATUS_TYPES.length;
      else if (directPer) {
        // (A type a primer holds is up; the weapon's own are up as likely as their stacks say.)
        types = held.length;
        for (const type of stacks.keys()) if (!held.includes(type)) types += 1 - Math.exp(-count(type, now));
      }
      const direct = raw('directDamage') + types * directPer;
      // Melee: this swing's attack (its multiplier and hit count) at the combo's tier now.
      const tier = !melee ? 1 : comboTier(melee.combo === 'max' ? MAX_COMBO : combo);
      const heavy = heavyBase > 0 && (melee?.combo !== 'build' || tier >= heavyAt);
      const sw = !melee ? null : heavy ? { mult: heavyBase * tier, points: 0, hits: heavySwing?.hits ?? 1, knocks: heavySwing?.knocks ?? 0 } : swings[swing % swings.length];
      const mult = sw ? sw.mult : 1;
      const hitsPer = sw ? sw.hits : 1;
      const step = heavy && !heavySwing ? Math.max(windUp, 1e-3) : interval;
      const ramp = mode.held == null ? 1 : Math.min(1, mode.held + (1 - mode.held) * now / BEAM_RAMP);
      const volleys = heavy ? volleysOf(tier, melee?.combo === 'build' ? Math.min(ANIMOSITY_HITS, sinceHeavy) : ANIMOSITY_HITS) : volleysOf(tier);
      for (const v of volleys) {
        const Dshot = Math.max(0, v.coMult ? D * (1 + v.coShare * direct) : D + v.coShare * direct);
        for (const [type, amount] of v.hits) land(type, amount * Dshot * mult * ramp, s);
        for (const [type, n0, perProc0] of v.procs) {
          // Each hit of a swing rolls status; a proc's ticks follow its hit's multiplier (on average).
          const n = n0 * hitsPer;
          const perProc = perProc0 * mult * ramp / hitsPer;
          let q = stacks.get(type);
          if (!q) stacks.set(type, q = { list: [], head: 0, sum: 0 });
          q.list.push({ until: now + duration, n });
          q.sum += n;
          const perTick = perProc * n;
          if (!perTick) continue;
          if (type === 'blast') {
            land('blast', perTick * blastPay(n / step), s);
            land('void', v.blastVoid * Dshot * mult * ramp * blastPay(n / step), s);
            continue;
          }
          const dotType = type === 'slash' ? 'slash-dot' : type;
          let ticks = ticksOf(type, duration);
          // Electricity and Gas: the first tick at once.
          if (TICKS_AT_ONCE.has(type)) { land(dotType, perTick, s); ticks -= 1; }
          if (type === 'heat') {
            // Heat stacks share one timer; each whole proc resets it, to its ticks from now.
            if (heat.start < 0) heat.start = now;
            heat.owed += n;
            if (heat.owed >= 1 || heat.until < now) { heat.until = now + 0.5 + ticks; heat.owed = Math.max(0, heat.owed - 1); }
          }
          if (ticks > 0) pending.push({ at: now + 0.5, rate: perTick, type: dotType, ticks });
        }
      }
      if (sw && afflictions && sw.knocks > 0) {
        // The knockdown adds stacks to each status already up (Melee Afflictions), each new stack's
        // ticks the average of that type's running ones.
        for (const [type, q] of stacks) {
          const have = count(type, now);
          if (!(have > 0)) continue;
          q.list.push({ until: now + duration, n: afflictions });
          q.sum += afflictions;
          const dotType = type === 'slash' ? 'slash-dot' : type;
          const per = (type === 'heat' ? heat.rate : dotRate[dotType] ?? 0) / have;
          if (per > 0) pending.push({ at: now + 0.5, rate: per * afflictions, type: dotType, ticks: ticksOf(type, duration) });
        }
      }
      if (influence && copies > 0) {
        let electric = 0;
        const s2 = snap(now);
        for (const v of volleys) {
          const Dshot = Math.max(0, v.coMult ? D * (1 + v.coShare * direct) : D + v.coShare * direct);
          for (const [type, n0, perProc0] of v.procs) {
            if (type === 'electricity') electric += n0 * hitsPer;
            if (!ELEMENTAL.has(type)) continue;
            // Each proc spreads its hit's share of this element, and the status (with its ticks).
            const amount = (v.hits.find(([t]) => t === type)?.[1] ?? 0) * Dshot * mult / hitsPer;
            const ticks = DOT[/** @type {keyof typeof DOT} */ (type)] ? ticksOf(type, duration) * perProc0 * mult / hitsPer : 0;
            spreadDamage += n0 * hitsPer * buffUp * copies * (amount + ticks) * Math.max(0, 1 + (target.weak[type] ?? 0)) * fullArmor;
          }
        }
        // The buff's uptime from the Electricity procs so far (each a 20% chance of 18 s).
        elecSeen += electric;
        const lambda = 0.2 * elecSeen / Math.max(step, now + step);
        buffUp = influence * lambda / (1 + influence * lambda);
      }
      shots++;
      const swungAt = combo;
      if (heavy) { sinceHeavy = 0; if (melee?.combo === 'build') combo *= kept; }
      else if (sw) {
        swing++; sinceHeavy++;
        if (melee?.combo === 'build') combo += (sw.points + sw.hits * comboChance) * nearby;
      }
      if (sw && melee?.combo === 'build' && combo < initial) combo = Math.min(initial, combo + COMBO_REGEN * step);
      lastTier = tier;
      lastCombo = swungAt;
      if (shots === 1) perShot = (ehp - health - shields - overguard) / ramp;
      if (health <= 0) {
        // Dead by this shot, or the DoTs before it: these count for the share of them that was needed
        // (crits make the real count a spread; this is its smooth average), but a kill always takes
        // at least one shot. (A heavy attack's wind up is all spent before it lands; a heavy slam has none.)
        const f = !heavy || heavySwing ? Math.min(1, last / Math.max(1e-9, last - health - shields - overguard)) : dotKilled ? 0 : 1;
        // (`pace`: the time without that floor, for the DPS.)
        return { time: Math.max(step, now + f * step), pace: now + f * step, shots: Math.max(1, shots - 1 + f), combo };
      }
      last = health + shields + overguard;
      const next = now + step;
      runDots(now, next);
      now = next;
    }
  };

  if (targets <= 1 || !melee) {
    const r = one();
    // How much further a shot goes in a crowd: each attack's reach, by its share of the shot.
    let landed = 0, beyond = 0;
    if (crowd) {
      for (const v of volleysOf(1)) {
        for (const [, amount] of v.hits) { landed += amount * D; beyond += amount * D * v.reach; }
        // Blast: what its stacks carry, a stack at a time.
        const proc = v.procs.find(([type]) => type === 'blast');
        if (!proc) continue;
        const [, n, perProc] = proc;
        const carried = perProc * n + v.blastVoid * D;
        const near = within(crowd, 5);
        landed += carried * blastPay(n / interval);
        beyond += carried * BLAST_DETONATED * near * blastDetonates(n / interval);
        // A dying target's stacks, a shot's share: as many as it took, and were still up, to 10.
        const up = Math.min(10, n * Math.min(r.shots, 1.5 / interval));
        beyond += carried / n * up * BLAST_DETONATED * near / Math.max(1, r.shots);
      }
    }
    const reached = 1 + Math.min(crowd?.close ?? 0, beyond / Math.max(1e-9, landed) + (crowd ? sparkReach(raw('sparks'), crowd, r.shots) : 0));
    return { dps: reached * ehp / Math.max(1e-9, r.pace), timePerKill: r.time / reached, shotsPerKill: r.shots / reached, perShot, interval, reload, hits, spread, aimed: perShot * aiming, ...(melee ? { tier: lastTier } : {}) };
  }
  {
    // A room of melee kills: the combo carries from target to target when it builds up; the enemies
    // inside each swing fall together. Targets fought wholly within one tier are alike (only the tier
    // changes a fight), each adding the same combo: the next ones up to the tier's end aren't re-fought.
    let time = 0, pace = 0, shots = 0, combo = initial, first = 0, spreadAll = 0;
    for (let k = 0; k < targets; k++) {
      spreadDamage = 0;
      const r = one(combo);
      if (k === 0) first = perShot;
      const gain = r.combo - combo;
      const left = targets - k;
      const tier = comboTier(combo);
      const steady = !perTier.length || tier >= MAX_TIER || gain <= 0;
      // (Heavy attacks spend the combo, so a built-up counter's targets all differ.)
      const alike = melee.combo !== 'build' ? left
        : heavyBase > 0 ? 1
        : steady ? left
        : comboTier(lastCombo) !== tier ? 1
        : Math.min(left, Math.ceil((tier * TIER_POINTS - lastCombo) / gain));
      time += r.time * alike; pace += r.pace * alike; shots += r.shots * alike; spreadAll += spreadDamage * alike;
      if (melee.combo === 'build') lastTier = comboTier(lastCombo + (alike - 1) * gain);
      combo += gain * alike;
      k += alike - 1;
    }
    // Each kill also brings down the others in the swing, and the spread damage counts as more kills
    // (at most the close enemies' share of the room).
    const others = Math.min(close, spreadAll / targets / Math.max(1, ehp));
    const kills = Math.min(targets, together + others);
    time /= targets * kills;
    pace /= targets * kills;
    return { dps: ehp / Math.max(1e-9, pace), timePerKill: time, shotsPerKill: shots / targets / kills, perShot: first, tier: lastTier, interval, reload, hits, spread, aimed: first * aiming };
  }
}
