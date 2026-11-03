// @ts-check
// The fight: a build against its target, shot by shot, until it dies. The questions are "is it dead
// yet?" and "how many shots did it take?": a gun that kills in one shot gains nothing from more
// damage, only from shooting again sooner.
//
// Stepped by shots (the fire rate), not by engine ticks: each shot lands its expected damage (crits,
// weak points and procs as averages, so builds compare without random noise), and between shots the
// damage over time runs as a rate, so a DoT that kills between shots is found where it does.
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
//   one every 0.5 s x (1 + Status Duration). Shields breaking deal 3% of the max shields per
//   Magnetic stack as Electricity.
// - Reloads: a magazine of shots (Ammo Efficiency stretches it), then the reload; bursts ignore them.
// - Room clearing: a run of identical targets (statuses don't carry over, the magazine does). One
//   fight without reloads gives the shots a kill takes, and the reloads are spread over the kills
//   (each magazine's reload in place of a shot's interval). Single target: one fight, reloads and all
//   (its DoTs keep ticking through them). A target alive after 20 s is finished at the rate it has
//   been losing health.
// A kill's time: a shot that kills counts for the share of it the kill needed (the smooth average
// of what crit rolls spread), never less than one shot; a DoT that kills between shots, when it
// does. The result is an effective DPS, the targets' health and shields over the time taken, so it
// reads like the closed form (src/sim.js dpsOf) and the optimiser can use either.
// Melee (src/melee.js): a shot is a swing, the next attack of the stance combo (its hits' multipliers
// summed for damage, each hit rolling crit and status), at the attack speed. The combo counter is
// held at the initial combo or the max, or built up by the hits (room clearing carries it from target
// to target); Blood Rush and Weeping Wounds add their bonus per tier past 1x. In room clearing, the
// enemies inside a swing (opts.melee.nearby) each take the follow through's share of the one before
// and add combo points: the room falls that much faster.
// Not modelled yet: Blast stacks, extra hits, abilities (Phase 14), random rolls (a Monte Carlo run
// could check the averages).

import { DOT, STATUS_SECONDS, STATUS_TYPES, TICKS_AT_ONCE, HEADS, hitByType, procsOf, ticksOf, weakPointMult, critScale, critChanceOf } from './sim.js';
import { comboTier, swingOf, MAX_COMBO } from './melee.js';

/** The elemental statuses Melee Influence spreads (not physical, Void or Tau). */
const ELEMENTAL = new Set(['cold', 'electricity', 'heat', 'toxin', 'blast', 'corrosive', 'gas', 'magnetic', 'radiation', 'viral']);

/** @typedef {import('./sim.js').SimOptions} SimOptions */
/** @typedef {import('./sim.js').Totals} Totals */
/** @typedef {import('./sim.js').Target} Target */
/** @typedef {import('./data/weapon-stats.js').WeaponStats} WeaponStats */

/** Heat's armor strip after each step of 0.5 s x (1 + Status Duration). */
const HEAT_STRIP = [0, 0.15, 0.3, 0.4, 0.5];
/** Seconds simulated on one target before the rest is extrapolated. */
const TARGET_SECONDS = 20;

/**
 * @typedef {object} FightResult
 * @property {number} dps          the targets' health and shields over the time taken
 * @property {number} timePerKill  seconds, from the first shot until the gun is ready for the next target
 * @property {number} shotsPerKill
 * @property {number} perShot      the first shot's damage to a fresh target (health and shields; overkill counts)
 * @property {number} [tier]       melee: the combo multiplier at the last kill
 */

/** Viral on health, Magnetic on shields: +100% for the first stack, +25% for each more. @param {number} n */
const amplify = n => (n < 1 ? 1 + n : 1.75 + 0.25 * n);

/**
 * @param {WeaponStats} w @param {Totals} t @param {SimOptions & {target: Target, targets?: number}} opts
 * @returns {FightResult}
 */
export function fight(w, t, opts) {
  const target = opts.target;
  const targets = opts.targets ?? 1;
  const raw = (/** @type {string} */ id) => t.stats[id] ?? 0;
  const mode = w.modes[opts.mode ?? w.main] ?? w.modes[0];
  const enemy = opts.enemy ?? '';
  const wp = opts.weakpoint ?? 0;
  const faction = enemy ? Math.max(0, 1 + raw(enemy)) : 1;
  const D = Math.max(0, 1 + raw('damage'));
  const headcrit = opts.headcrit ?? HEADS[enemy].headcrit;
  const rate = mode.rate * (raw('fireRateLocked') ? 1 : Math.max(0.05, 1 + raw('fireRate') * (opts.bow ? 2 : 1) + (w.bonus?.fireRate ?? 0)));
  const crit = critScale;
  const duration = STATUS_SECONDS * Math.max(0, 1 + raw('statusDuration'));
  const stripStep = 0.5 * duration / STATUS_SECONDS;
  const statusDamage = Math.max(0, 1 + raw('statusDamage'));
  /** @type {Record<string, number>} the build's elemental mods by element, uncombined: they scale DoT ticks */
  const matching = {};
  for (const e of t.elements) matching[e.type] = (matching[e.type] ?? 0) + e.value;
  // Galvanized's Direct Damage per status type on the target (the only per status type bonus).
  const directPer = raw('directDamagePerStatus');

  // What one shot carries, before Galvanized's per-status Direct Damage (which depends on the target).
  // Melee: at each combo tier (Blood Rush's crit chance, Weeping Wounds' status chance per tier).
  const volleysAt = (/** @type {(id: string) => number} */ raw) => mode.parts.flatMap(p => {
    const typed = hitByType(p, t, raw, opts.valence);
    if (!typed) return [];
    const { base, byType, hit } = typed;
    const cc = critChanceOf(p, raw('critChance'));
    // Melee Doughty: +1x Critical Damage per whole 10% of Puncture status chance.
    const punctureChance = Math.max(0, p.sc * (1 + raw('statusChance'))) * (byType.puncture ?? 0) / hit;
    const cd = p.cd * (1 + raw('critDamage')) + (raw('doughty') ? Math.floor(punctureChance * 10 + 1e-9) * raw('doughty') : 0);
    const onWp = p.aoe ? 0 : wp;
    const scale = (1 - onWp) * crit(cc, cd, p) + onWp * weakPointMult(p, enemy, opts, raw) * crit(critChanceOf(p, raw('critChance') + raw('weakpointCrit')), headcrit ? 2 * cd : cd, p);
    // Melee Duplicate: a base (yellow) critical hit strikes again, crit and status rolled anew. A hit
    // is yellow with the chance it crits below 100%, and with 2 - CC between 100% and 200%.
    const yellow = cc < 1 ? Math.max(0, cc) : cc < 2 ? 2 - cc : 0;
    const pellets = p.ms * (raw('multishotLocked') ? 1 : Math.max(0, 1 + raw('multishot'))) * (1 + Math.min(1, raw('duplicate')) * yellow);
    const procsPerPellet = procsOf(p, byType, hit, cc, raw);
    /** @type {[string, number, number][]} per type: expected procs a shot, and a tick of its DoT per proc */
    const procs = [];
    for (const type of new Set([...Object.keys(byType), ...(p.forced ?? []), 'slash'])) {
      const n = procsPerPellet(type) * pellets;
      if (!(n > 0) || !STATUS_TYPES.includes(type)) continue;
      // A tick: base x Damage x faction twice x crit x its share x Status Damage x its element's mods.
      const share = DOT[/** @type {keyof typeof DOT} */ (type)] ?? 0;
      procs.push([type, n, base * D * faction * faction * scale * share * statusDamage * (1 + (matching[type] ?? 0))]);
    }
    const [coShare, coMult] = p.co ?? [1, 0];
    return [{ hits: Object.entries(byType).map(([type, v]) => /** @type {[string, number]} */ ([type, v * faction * scale * pellets])), coShare, coMult, procs }];
  });
  const melee = w.melee && opts.melee ? opts.melee : null;
  /** @type {Map<number, ReturnType<typeof volleysAt>>} */
  const byTier = new Map();
  const volleysOf = (/** @type {number} */ tier) => {
    let v = byTier.get(tier);
    if (!v) byTier.set(tier, v = volleysAt(tier <= 1 ? raw : id => raw(id) + raw(`${id}PerTier`) * (tier - 1)));
    return v;
  };
  const swings = melee ? melee.attacks.map(swingOf) : [];
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
  let spread = 0;                                          // damage spread to the room (this target)
  // The others' armor: as the target's before any strip (their own statuses aren't followed).
  const fullArmor = 1 - 0.9 * Math.sqrt(Math.min(target.armor, 2700) / 2700);

  // The magazine: shots before a reload (none for Incarnon modes, weapons without one, or bursts).
  const reloads = !opts.burst && w.mag > 0 && w.reload > 0 && mode.cost > 0 && !/incarnon/i.test(mode.name);
  const mag = w.mag <= 1 ? w.mag : Math.max(1, Math.round(w.mag * Math.max(0, 1 + raw('magazine'))));
  const shotsPerMag = reloads ? mag / (mode.cost * Math.max(0.01, 1 + raw('ammoEfficiency'))) : Infinity;
  const reload = w.reload / Math.max(0.05, 1 + raw('reloadSpeed') + (w.bonus?.reloadSpeed ?? 0));
  const ehp = target.health + target.shields;
  let perShot = 0;
  let lastTier = 1;

  // One target, from its first shot until the gun is ready for the next, reloading or not; melee
  // starts at a combo count (carried from the last target when it builds up).
  const one = (/** @type {boolean} */ reloading, combo = initial) => {
    let now = 0;                                // when the next shot is due
    let inMag = reloading ? shotsPerMag : Infinity;
    let shots = 0;
    // A fresh target: full health and shields, no statuses (all of them if primed).
    let health = target.health;
    let shields = target.shields;
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
    let dead = -1;

    // Stacks still up at `at` (expired ones leave their queue for good: time only moves forward).
    const count = (/** @type {string} */ type, /** @type {number} */ at) => {
      if (opts.primed) return 10;
      const q = stacks.get(type);
      if (!q) return 0;
      while (q.head < q.list.length && q.list[q.head].until <= at) q.sum -= q.list[q.head++].n;
      return Math.min(10, q.sum);
    };
    // The target's state at a moment: what armor keeps, Viral and Magnetic.
    const snap = (/** @type {number} */ at) => {
      const c = count('corrosive', at);
      const stripped = c < 1 ? 0.26 * c : 0.2 + 0.06 * c;
      const burning = opts.primed || heat.until > at;
      const step = opts.primed ? 4 : heat.start < 0 ? 0 : Math.min(4, Math.floor((at - heat.start) / stripStep));
      const armor = target.armor * (1 - stripped) * (1 - (burning ? HEAT_STRIP[step] : 0));
      return { kept: 1 - 0.9 * Math.sqrt(Math.min(armor, 2700) / 2700), viral: amplify(count('viral', at)), magnetic: count('magnetic', at) };
    };
    // Damage of one type landing: shields first (not Toxin), spilling to health. Bleeds (True
    // damage) skip armor and weaknesses.
    const land = (/** @type {string} */ type, /** @type {number} */ amount, /** @type {ReturnType<typeof snap>} */ s, /** @type {number} */ at) => {
      if (!(amount > 0)) return;
      const bleed = type === 'slash-dot';
      const kind = bleed ? 'slash' : type;
      let left = amount;
      if (shields > 0 && kind !== 'toxin') {
        const toShields = left * (bleed ? 1 : Math.max(0, 1 + (target.shieldWeak[kind] ?? 0))) * amplify(s.magnetic);
        if (toShields < shields) { shields -= toShields; return; }
        left *= 1 - shields / toShields;
        shields = 0;
        // The break: 3% of the max shields per Magnetic stack, as Electricity.
        health -= 0.03 * s.magnetic * target.shields * Math.max(0, 1 + (target.weak.electricity ?? 0)) * s.kept * s.viral;
      }
      health -= left * (bleed ? 1 : Math.max(0, 1 + (target.weak[kind] ?? 0)) * s.kept) * s.viral;
      if (health <= 0 && dead < 0) dead = at;
    };
    // One span of DoT damage at the rates now; a kill inside it is placed by how much it took.
    const span = (/** @type {number} */ a, /** @type {number} */ b) => {
      if (b <= a || dead >= 0) return;
      const s = snap(a);
      const before = Math.max(0, health) + shields;
      for (const type in dotRate) land(type, dotRate[type] * (b - a), s, a);
      if (heat.until > a) land('heat', heat.rate * (b - a), s, a);
      if (dead >= 0) dead = a + (b - a) * Math.min(1, before / Math.max(1e-9, before - health - shields));
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
        if (dead >= 0) return;
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
      if (now > TARGET_SECONDS) {
        // Still alive: finish it at the rate it has been losing health and shields.
        const lost = ehp - Math.max(0, health) - shields;
        const more = (Math.max(0, health) + shields) * now / Math.max(1e-9, lost);
        return { time: now + more, shots: shots + more * rate, combo };
      }
      // The shot: Galvanized counts the status types on the target now.
      const s = snap(now);
      const before = Math.max(0, health) + shields;
      let types = 0;
      if (opts.primed) types = STATUS_TYPES.length;
      else if (directPer) for (const type of stacks.keys()) types += 1 - Math.exp(-count(type, now));
      const direct = raw('directDamage') + types * directPer;
      // Melee: this swing's attack (its multiplier and hit count) at the combo's tier now.
      const sw = melee ? swings[shots % swings.length] : null;
      const tier = !melee ? 1 : comboTier(melee.combo === 'max' ? MAX_COMBO : combo);
      const mult = sw ? sw.mult : 1;
      const hitsPer = sw ? sw.hits : 1;
      for (const v of volleysOf(tier)) {
        const Dshot = Math.max(0, v.coMult ? D * (1 + v.coShare * direct) : D + v.coShare * direct);
        for (const [type, amount] of v.hits) land(type, amount * Dshot * mult, s, now);
        for (const [type, n0, perProc0] of v.procs) {
          // Each hit of a swing rolls status; a proc's ticks follow its hit's multiplier (on average).
          const n = n0 * hitsPer;
          const perProc = perProc0 * mult / hitsPer;
          let q = stacks.get(type);
          if (!q) stacks.set(type, q = { list: [], head: 0, sum: 0 });
          q.list.push({ until: now + duration, n });
          q.sum += n;
          const perTick = perProc * n;
          if (!perTick) continue;
          const dotType = type === 'slash' ? 'slash-dot' : type;
          let ticks = ticksOf(type, duration);
          // Electricity and Gas: the first tick at once.
          if (TICKS_AT_ONCE.has(type)) { land(dotType, perTick, s, now); ticks -= 1; }
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
        for (const v of volleysOf(tier)) {
          const Dshot = Math.max(0, v.coMult ? D * (1 + v.coShare * direct) : D + v.coShare * direct);
          for (const [type, n0, perProc0] of v.procs) {
            if (type === 'electricity') electric += n0 * hitsPer;
            if (!ELEMENTAL.has(type)) continue;
            // Each proc spreads its hit's share of this element, and the status (with its ticks).
            const amount = (v.hits.find(([t]) => t === type)?.[1] ?? 0) * Dshot * mult / hitsPer;
            const ticks = DOT[/** @type {keyof typeof DOT} */ (type)] ? ticksOf(type, duration) * perProc0 * mult / hitsPer : 0;
            spread += n0 * hitsPer * buffUp * copies * (amount + ticks) * Math.max(0, 1 + (target.weak[type] ?? 0)) * fullArmor;
          }
        }
        // The buff's uptime from the Electricity procs so far (each a 20% chance of 18 s).
        elecSeen += electric;
        const lambda = 0.2 * elecSeen / Math.max(1 / rate, now + 1 / rate);
        buffUp = influence * lambda / (1 + influence * lambda);
      }
      shots++;
      if (sw && melee?.combo === 'build') combo += (sw.mult + sw.hits * comboChance) * nearby;
      lastTier = tier;
      if (shots === 1) perShot = ehp - health - shields;
      if (dead >= 0) {
        // Killed by this shot: it counts for the share of it that was needed (crits make the real
        // count a spread; this is its smooth average), but a kill always takes at least one shot.
        const f = Math.min(1, before / Math.max(1e-9, before - health - shields));
        return { time: Math.max(1 / rate, now + f / rate), shots: Math.max(1, shots - 1 + f), combo };
      }
      // The next shot (after a reload when the magazine is empty).
      inMag -= 1;
      let next = now + 1 / rate;
      if (inMag <= 0) { next = now + reload; inMag = shotsPerMag; }
      runDots(now, next);
      if (dead >= 0) return { time: Math.max(1 / rate, dead), shots: Math.max(1, shots), combo };
      now = next;
    }
  };

  if (targets <= 1) {
    const r = one(true);
    return { dps: ehp / Math.max(1e-9, r.time), timePerKill: r.time, shotsPerKill: r.shots, perShot, ...(melee ? { tier: lastTier } : {}) };
  }
  if (melee) {
    // A room of melee kills: the combo carries from target to target when it builds up (once it's at
    // the max, every target is alike); the enemies inside each swing fall together.
    let time = 0, shots = 0, combo = initial, first = 0, spreadAll = 0;
    for (let k = 0; k < targets; k++) {
      spread = 0;
      const r = one(false, combo);
      if (k === 0) first = perShot;
      if (melee.combo !== 'build' || combo >= MAX_COMBO) {
        const left = targets - k;
        time += r.time * left; shots += r.shots * left; spreadAll += spread * left;
        break;
      }
      time += r.time; shots += r.shots; spreadAll += spread; combo = r.combo;
    }
    // Each kill also brings down the others in the swing, and the spread damage counts as more kills
    // (at most the close enemies' share of the room).
    const others = Math.min(close, spreadAll / targets / Math.max(1, ehp));
    const kills = Math.min(targets, together + others);
    time /= targets * kills;
    return { dps: ehp / Math.max(1e-9, time), timePerKill: time, shotsPerKill: shots / targets / kills, perShot: first, tier: lastTier };
  }
  // A room: every target is the same, so one fight without reloads gives the shots a kill takes;
  // the reloads come every magazine, each in place of a shot's interval.
  const r = one(false);
  const time = r.time + (Number.isFinite(shotsPerMag) ? (r.shots / shotsPerMag) * Math.max(0, reload - 1 / rate) : 0);
  return { dps: ehp / Math.max(1e-9, time), timePerKill: time, shotsPerKill: r.shots, perShot };
}
