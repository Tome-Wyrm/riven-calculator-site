// @ts-check
// A random fight: src/fight.js's fight with every roll made, to check its averages (PLAN.md, "A random
// (Monte Carlo) fight"). Not used by the page or the optimiser: tools/fight-check.mjs runs it.
// What src/fight.js averages, and what this does instead:
// - Smoothed kills: a kill there costs the share of the last shot it needed. Here the next target
//   starts on the next shot after the kill, whatever was left of the one that killed.
// - Crits, weak points and procs: each pellet rolls its crit tier, whether it's on a weak point, and
//   its status procs (a whole number, the type by its share of the hit). Multishot rolls whole pellets.
// - DoTs: each tick lands at its second, Heat's on its shared timer.
// - Heat's strip: in its steps (0.5 s x (1 + Status Duration) each), where src/fight.js averages over
//   where a shot falls against them.
// - Blast (`blastPay`): each stack lasts 1.5 s; with 10 up they all detonate at 3x, else each pays 0.3x
//   as it runs out.
// - Reloads: a magazine's shots, then the reload, where src/fight.js gives every shot its share.
//   A magazine holds mag / cost shots, rounded up or down at random (Ammo Efficiency's fractions).
// - Incarnon: each pellet that lands while the target lives charges the gauge at the share aimed, up
//   to the one that kills (`chargedPellets` averages this); the swap in, the form's shots, the swap out.
// The same as src/fight.js otherwise (the hit by type, shields, Overguard, armor, Viral, Magnetic,
// Galvanized's count of status types, primers, beams' ramp), and it leaves out what that leaves out.
// Not covered (returns {unsupported}): melee, crowds (call it without opts.crowd, and src/fight.js too),
// Void's bubble.

import { BLAST_ALONE, BLAST_DETONATED, DOT, STATUS_SECONDS, STATUS_TYPES, TICKS_AT_ONCE, HEADS, ammoCost, critFlatOf, factionOf, hitByType, ticksOf, weakPointMult, critChanceOf } from './sim.js';
import { HEAT_STRIP, BEAM_RAMP, TARGET_SECONDS, SWAP_OUT, ehpOf, amplify } from './fight.js';

/** @typedef {import('./sim.js').SimOptions} SimOptions */
/** @typedef {import('./sim.js').Totals} Totals */
/** @typedef {import('./sim.js').Target} Target */
/** @typedef {import('./data/weapon-stats.js').WeaponStats} WeaponStats */

/** Seconds a Blast stack waits for nine more before it pays alone. */
const BLAST_SECONDS = 1.5;

/**
 * A seeded random number generator (mulberry32): the same seed, the same fight.
 * @param {number} seed @returns {() => number}
 */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number with x's mean: its floor, plus one at the chance of its fraction. @param {number} x @param {() => number} rng */
const whole = (x, rng) => { const f = Math.floor(x); return f + (rng() < x - f ? 1 : 0); };

/**
 * @typedef {object} RandomResult
 * @property {number} timePerKill   seconds a kill, from its first shot to the next target's
 * @property {number} shotsPerKill
 * @property {number} dps           the targets' health and shields over the time (no overkill counted)
 * @property {number} se            the standard error of timePerKill (from batches of kills)
 * @property {number} kills
 * @property {number} [inForm]      Incarnon: the share of the time in the form
 */

/**
 * A build against its target, every roll made: a stream of kills (room clearing), or for an Incarnon
 * on one target, kills each from a full gauge. A mixed room: each unit as a stream, combined as
 * src/fight.js `clear` does.
 * @param {WeaponStats} w @param {Totals} t @param {SimOptions & {target: Target, targets?: number}} opts
 * @param {{kills?: number, seed?: number}} [o]
 * @returns {RandomResult | {unsupported: string}}
 */
export function randomFight(w, t, opts, o = {}) {
  if (w.melee && opts.melee) return { unsupported: 'melee' };
  if (opts.crowd && (opts.targets ?? 1) > 1) return { unsupported: 'a crowd (leave opts.crowd out on both sides)' };
  if ((t.stats.voidHeads ?? 0) > (opts.weakpoint ?? 0)) return { unsupported: "Void's bubble" };
  if (opts.room) {
    const { room, ...rest } = opts;
    const each = room.map(({ n, target }) => ({ n, ehp: ehpOf(target), r: randomFight(w, t, { ...rest, target }, o) }));
    const bad = each.find(u => 'unsupported' in u.r);
    if (bad) return /** @type {{unsupported: string}} */ (bad.r);
    const ok = /** @type {{n: number, ehp: number, r: RandomResult}[]} */ (each);
    const sum = (/** @type {(u: typeof ok[number]) => number} */ f) => ok.reduce((s, u) => s + u.n * f(u), 0);
    const kills = sum(() => 1), time = sum(u => u.r.timePerKill);
    return { timePerKill: time / kills, shotsPerKill: sum(u => u.r.shotsPerKill) / kills, dps: sum(u => u.ehp) / time,
      se: Math.sqrt(sum(u => u.n * u.r.se ** 2 * u.n)) / kills, kills: ok.reduce((s, u) => s + u.r.kills, 0),
      ...(ok[0].r.inForm !== undefined ? { inForm: sum(u => u.r.timePerKill * (u.r.inForm ?? 0)) / time } : {}) };
  }
  // On-melee-kill stacks: up for their share of the time, as src/fight.js has it.
  const stacked = Object.keys(t.stats).filter(k => k.endsWith('Stacked'));
  if (!stacked.length) return stream(w, t, opts, o);
  const up = opts.melee?.uptime ?? 1;
  const none = { ...t.stats }, all = { ...t.stats };
  for (const k of stacked) {
    const id = k.slice(0, -'Stacked'.length);
    delete none[k]; delete all[k];
    all[id] = (all[id] ?? 0) + t.stats[k];
  }
  const on = stream(w, { ...t, stats: all }, opts, o), off = stream(w, { ...t, stats: none }, opts, { ...o, seed: (o.seed ?? 1) + 1 });
  const mix = (/** @type {number} */ a, /** @type {number} */ b) => up * a + (1 - up) * b;
  return { ...on, timePerKill: mix(on.timePerKill, off.timePerKill), shotsPerKill: mix(on.shotsPerKill, off.shotsPerKill),
    dps: ehpOf(opts.target) / mix(on.timePerKill, off.timePerKill), se: Math.hypot(up * on.se, (1 - up) * off.se) };
}

/**
 * What a mode's shot is made of, worked out once: per part, its hit by type and what each pellet rolls.
 * @param {WeaponStats} w @param {Totals} t @param {SimOptions} opts @param {number} index
 */
function prepare(w, t, opts, index) {
  const raw = (/** @type {string} */ id) => t.stats[id] ?? 0;
  const mode = w.modes[index] ?? w.modes[0];
  const enemy = opts.enemy ?? '';
  const faction = factionOf(raw, enemy);
  const D = Math.max(0, 1 + raw('damage'));
  const more = Math.max(0, 1 + raw('allDamage'));
  const headcrit = !raw('sonar') && (opts.headcrit ?? HEADS[/** @type {keyof typeof HEADS} */ (enemy)].headcrit);
  const statusDamage = Math.max(0, 1 + raw('statusDamage'));
  /** @type {Record<string, number>} */
  const matching = {};
  for (const e of t.elements) matching[e.type] = (matching[e.type] ?? 0) + e.value;
  const extraHits = Object.entries(t.stats).filter(([k, v]) => k.startsWith('extra:') && v > 0).map(([k, v]) => /** @type {[string, number]} */ ([k.slice('extra:'.length), v]));
  const multishot = raw('multishotLocked') ? 1 : Math.max(0, 1 + raw('multishot'));
  const parts = mode.parts.flatMap(p => {
    const typed = hitByType(p, t, raw, opts.valence);
    if (!typed) return [];
    const { base, byType, hit } = typed;
    const cdBody = p.cd * (1 + raw('critDamage')) + raw('critDamageFlat');
    const types = Object.entries(byType);
    // A proc's type, by its share of the hit (a type that isn't a status procs nothing).
    let acc = 0;
    const pick = types.map(([type, v]) => { acc += v / hit; return /** @type {[string, number]} */ ([type, acc]); });
    /** A tick of this type's DoT per unit of seed (a seed is base x Damage x faction x crit), and what's added to the seed. @param {string} type */
    const tickOf = type => {
      const share = type === 'blast' ? 1 : DOT[/** @type {keyof typeof DOT} */ (type)] ?? 0;
      const own = type === 'blast' ? 1 : (1 + (matching[type] ?? 0));
      return { per: faction * share * statusDamage * own * more, add: type === 'blast' ? 0 : 1 };
    };
    const ticks = Object.fromEntries([...STATUS_TYPES].map(type => [type, tickOf(type)]));
    return [{
      p, base, types, pick, ticks, aoe: !!p.aoe,
      cc: critChanceOf(p, raw('critChance'), critFlatOf(p, raw)), cd: cdBody,
      ccHead: critChanceOf(p, raw('critChance') + raw('weakpointCrit'), critFlatOf(p, raw) + raw('critFlatHead')), cdHead: headcrit ? 2 * cdBody : cdBody,
      head: weakPointMult(p, enemy, opts, raw), sonar: raw('sonar') || 1,
      chance: Math.max(0, p.sc * (1 + raw('statusChance'))), slashOnCrit: raw('slashOnCrit'), forced: p.forced ?? [],
      co: p.co ?? [1, 0],
    }];
  });
  return { mode, raw, faction, D, more, statusDamage, matching, extraHits, multishot, parts, beam: mode.held != null,
    extraVoid: raw('extraVoid'), directPer: raw('directDamagePerStatus'), direct: raw('directDamage') };
}

/** A min-heap of timed events. @template T */
class Heap {
  constructor() { /** @type {{at: number, v: T}[]} */ this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  /** @param {number} at @param {T} v */
  push(at, v) {
    const a = this.a; a.push({ at, v });
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j].at <= a[i].at) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop() {
    const a = this.a, top = a[0], last = /** @type {{at: number, v: T}} */ (a.pop());
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].at < a[m].at) m = l;
        if (r < a.length && a[r].at < a[m].at) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
  clear() { this.a.length = 0; }
}

/**
 * Kills one after another (or, for an Incarnon on one target, each from a full gauge), every roll made.
 * @param {WeaponStats} w @param {Totals} t @param {SimOptions & {target: Target, targets?: number}} opts
 * @param {{kills?: number, seed?: number}} o @returns {RandomResult}
 */
function stream(w, t, opts, o) {
  const rng = seeded(o.seed ?? 1);
  const KILLS = o.kills ?? 2000;
  const target = opts.target;
  const ehp = ehpOf(target);
  const wp = opts.weakpoint ?? 0;
  const c = opts.burst ? null : opts.incarnon ?? null;
  const formIndex = opts.mode ?? w.main;
  const form = prepare(w, t, opts, formIndex);
  const plain = c ? prepare(w, t, opts, c.normal) : form;
  const raw = form.raw;
  const duration = STATUS_SECONDS * Math.max(0, 1 + raw('statusDuration'));
  const stripStep = 0.5 * duration / STATUS_SECONDS;
  const held = STATUS_TYPES.filter(type => raw(`prime:${type}`) > 0);
  const rateOf = (/** @type {typeof form} */ m) => m.mode.rate * (raw('fireRateLocked') ? 1 : Math.max(0.05, 1 + raw('fireRate') * (opts.bow ? 2 : 1) + raw('fireRateFlat') + (w.bonus?.fireRate ?? 0)));
  const reloadTime = w.reload / Math.max(0.05, 1 + raw('reloadSpeed') + (w.bonus?.reloadSpeed ?? 0));
  const mag = w.mag <= 1 ? w.mag : Math.max(1, Math.round(w.mag * Math.max(0, 1 + raw('magazine'))));
  const reloadsIn = (/** @type {typeof form} */ m) => !opts.burst && w.mag > 0 && w.reload > 0 && m.mode.cost > 0 && !/incarnon/i.test(m.mode.name);
  const perMag = (/** @type {typeof form} */ m) => mag / (m.mode.cost * ammoCost(raw('ammoEfficiency')));
  const single = (opts.targets ?? 1) <= 1;

  // The gun: its mode, the shots left in the magazine (or the form), the gauge.
  let inForm = !!c && single;
  let left = inForm ? whole(/** @type {NonNullable<typeof c>} */ (c).ammo / Math.max(1e-9, form.mode.cost), rng) : whole(perMag(plain), rng);
  let magLeft = whole(perMag(plain), rng);
  let gauge = 0;
  let now = 0, formTime = 0;
  /** @type {number[]} */
  const times = [];

  // The target's state.
  let health = 0, shields = 0, overguard = 0, start = 0;
  /** @type {Map<string, number[]>} each type's stacks by when they end (in order: they all last the same) */
  const stacks = new Map();
  const heads = new Map();
  /** @typedef {{pay: number, extra: number}} BlastStack */
  /** @type {Heap<{type: string, amount: number} | {stack: BlastStack}>} DoT ticks and Blast stacks running out */
  const events = new Heap();
  let heat = { rate: 0, until: -1, start: -1, next: Infinity };
  /** @type {Set<BlastStack>} Blast stacks up */
  const blasts = new Set();

  const fresh = () => {
    health = target.health; shields = target.shields; overguard = target.overguard ?? 0;
    stacks.clear(); heads.clear(); events.clear(); blasts.clear();
    heat = { rate: 0, until: -1, start: -1, next: Infinity };
    start = now;
  };
  const count = (/** @type {string} */ type, /** @type {number} */ at) => {
    if (opts.primed) return 10;
    const kept = raw(`prime:${type}`);
    const q = stacks.get(type);
    if (!q) return Math.min(10, kept);
    let h = heads.get(type) ?? 0;
    while (h < q.length && q[h] <= at) h++;
    heads.set(type, h);
    return Math.min(10, kept + q.length - h);
  };
  const addStack = (/** @type {string} */ type, /** @type {number} */ at) => {
    let q = stacks.get(type);
    if (!q) stacks.set(type, q = []);
    q.push(at + duration);
  };
  const snap = (/** @type {number} */ at) => {
    const cor = count('corrosive', at);
    const stripped = cor < 1 ? 0.26 * cor : 0.2 + 0.06 * cor;
    const prime = opts.primed || raw('prime:heat') > 0;
    const burning = prime || heat.until >= at;
    const strip = !burning ? 0 : prime ? HEAT_STRIP[HEAT_STRIP.length - 1] : HEAT_STRIP[Math.min(HEAT_STRIP.length - 1, Math.floor((at - heat.start) / stripStep + 1e-9))];
    const armor = target.armor * (1 - stripped) * (1 - strip);
    return { kept: 1 - 0.9 * Math.sqrt(Math.min(armor, 2700) / 2700), viral: amplify(count('viral', at)), magnetic: count('magnetic', at) };
  };
  const land = (/** @type {string} */ type, /** @type {number} */ amount, /** @type {ReturnType<typeof snap>} */ s) => {
    if (!(amount > 0) || health <= 0) return;
    const bleed = type === 'slash-dot';
    const kind = bleed ? 'slash' : type;
    let rest = amount;
    if (overguard > 0) {
      const toGuard = rest * (kind === 'void' ? 1.5 : 1) * amplify(s.magnetic);
      if (toGuard < overguard) { overguard -= toGuard; return; }
      rest *= 1 - overguard / toGuard;
      overguard = 0;
      health -= 0.03 * s.magnetic * (target.overguard ?? 0) * Math.max(0, 1 + (target.weak.electricity ?? 0)) * s.kept * s.viral;
    }
    if (shields > 0 && kind !== 'toxin') {
      const toShields = rest * (bleed ? 1 : Math.max(0, 1 + (target.shieldWeak[kind] ?? 0))) * amplify(s.magnetic);
      if (toShields < shields) { shields -= toShields; return; }
      rest *= 1 - shields / toShields;
      shields = 0;
      health -= 0.03 * s.magnetic * target.shields * Math.max(0, 1 + (target.weak.electricity ?? 0)) * s.kept * s.viral;
    }
    health -= rest * (bleed ? 1 : Math.max(0, 1 + (target.weak[kind] ?? 0)) * s.kept) * s.viral;
  };
  // A proc landing at `at`: its stack, and its DoT's ticks or its Blast stack. `seed`: base x Damage x
  // faction x crit (and the weak point, as a DoT takes it), of what carried it.
  const proc = (/** @type {ReturnType<typeof prepare>['parts'][number]} */ part, /** @type {string} */ type, /** @type {number} */ seed, /** @type {number} */ at, /** @type {number} */ blastExtra) => {
    if (!STATUS_TYPES.includes(type)) return;
    addStack(type, at);
    const { per, add } = part.ticks[type];
    const tick = (seed + add) * per;
    if (type === 'blast') {
      // (Stacks running out at this moment have paid already: events come before a shot at the same time.)
      const stack = { pay: tick, extra: blastExtra };
      blasts.add(stack);
      // Ten up at once: they all go off.
      if (blasts.size >= 10) {
        const s = snap(at);
        for (const b of blasts) { land('blast', BLAST_DETONATED * b.pay, s); land('void', BLAST_DETONATED * b.extra, s); }
        blasts.clear();
      } else events.push(at + BLAST_SECONDS, { stack });
      return;
    }
    if (!tick || !DOT[/** @type {keyof typeof DOT} */ (type)]) return;
    const dotType = type === 'slash' ? 'slash-dot' : type;
    const n = ticksOf(type, duration);
    if (type === 'heat') {
      // One timer for all Heat stacks: each proc adds its tick and starts the time again.
      if (heat.until < at) heat = { rate: 0, until: -1, start: at, next: at + 1 };
      heat.rate += tick;
      heat.until = at + n;
      return;
    }
    if (TICKS_AT_ONCE.has(type)) {
      land(dotType, tick, snap(at));
      for (let k = 1; k < n; k++) events.push(at + k, { type: dotType, amount: tick });
    } else for (let k = 1; k <= n; k++) events.push(at + k, { type: dotType, amount: tick });
  };
  // The DoTs and Blast stacks due by `to`, in order (one running out as a shot comes is gone for it); stops at a kill.
  const runUntil = (/** @type {number} */ to) => {
    for (;;) {
      if (health <= 0) return;
      const e = events.size ? events.peek().at : Infinity;
      const h = heat.next <= heat.until ? heat.next : Infinity;
      const at = Math.min(e, h);
      if (at > to) return;
      if (at === h) {
        land('heat', heat.rate, snap(at));
        heat.next += 1;
        if (heat.next > heat.until) heat = { rate: 0, until: -1, start: -1, next: Infinity };
        continue;
      }
      const ev = events.pop().v;
      if ('stack' in ev) {
        // A stack still up when it runs out pays alone (one that went off is gone already).
        if (blasts.delete(ev.stack)) { const s = snap(at); land('blast', BLAST_ALONE * ev.stack.pay, s); land('void', BLAST_ALONE * ev.stack.extra, s); }
      } else land(ev.type, ev.amount, snap(at));
    }
  };

  // One shot of a mode at `now` on the target: pellet by pellet, each rolling its crit, weak point and
  // procs. Returns the pellets that landed while it lived.
  const shoot = (/** @type {typeof form} */ m) => {
    const s = snap(now);
    let types = 0;
    if (opts.primed) types = STATUS_TYPES.length;
    else if (m.directPer) {
      types = held.length;
      for (const type of stacks.keys()) if (!held.includes(type) && count(type, now) > 0) types++;
    }
    const direct = m.direct + types * m.directPer;
    const ramp = m.mode.held == null ? 1 : Math.min(1, m.mode.held + (1 - m.mode.held) * (now - start) / BEAM_RAMP);
    let landed = 0;
    for (const part of m.parts) {
      const [coShare, coMult] = part.co;
      const Dshot = Math.max(0, coMult ? m.D * (1 + coShare * direct) : m.D + coShare * direct);
      // A beam's tick is one hit of all its beams (each of its own rolling Multishot); a gun's shot, its pellets.
      const beams = m.beam ? Array.from({ length: Math.max(1, Math.round(part.p.ms)) }, () => whole(m.multishot, rng)).reduce((a, b) => a + b, 0) : 1;
      const pellets = m.beam ? 1 : whole(part.p.ms * m.multishot, rng);
      for (let k = 0; k < pellets; k++) {
        if (health <= 0) return landed;
        const onHead = !part.aoe && rng() < wp;
        const cc = onHead ? part.ccHead : part.cc, cd = onHead ? part.cdHead : part.cd;
        const tier = Math.floor(Math.max(0, cc)) + (rng() < Math.max(0, cc) - Math.floor(Math.max(0, cc)) ? 1 : 0);
        let mult = 1 + tier * (Math.max(1, cd) - 1);
        if (tier === 0 && part.p.nonCrit && rng() < part.p.nonCrit.chance) mult += part.p.nonCrit.mult;
        const scale = mult * (onHead ? part.head : 1);
        const dotScale = mult * (onHead ? part.head / part.sonar : 1);
        let whole_ = 0;
        for (const [type, v] of part.types) {
          const amount = v * m.faction * scale * beams * m.more;
          whole_ += amount;
          land(type, amount * Dshot * ramp, s);
        }
        landed++;
        // Extra hits: Xata's Void, and the others with their sure proc.
        const extraBase = whole_ * m.faction * (onHead ? part.head : 1);
        const extra = extraBase * m.extraVoid;
        if (extra) land('void', extra * Dshot * ramp, s);
        for (const [type, v] of m.extraHits) {
          land(type, extraBase * v * Dshot * ramp, s);
          const share = DOT[/** @type {keyof typeof DOT} */ (type)];
          if (share) {
            proc({ ...part, ticks: { ...part.ticks, [type]: { per: m.faction * share * m.statusDamage * (1 + (m.matching[type] ?? 0)), add: 1 } } }, type, extraBase * v * m.D, now, 0);
          }
        }
        // Procs: the status chance (x the beams in a tick), whole procs at its fraction, the type by its share.
        const seed = part.base * beams * m.D * m.faction * dotScale * ramp;
        const blastExtra = extra * m.statusDamage * m.faction * Dshot * ramp / Math.max(1, beams);
        const n = whole(part.chance * beams, rng);
        for (let j = 0; j < n; j++) {
          const r = rng();
          const hit = part.pick.find(([, upTo]) => r < upTo) ?? part.pick[part.pick.length - 1];
          if (hit) proc(part, hit[0], seed, now, blastExtra);
        }
        for (const type of part.forced) proc(part, type, seed, now, blastExtra);
        if (tier >= 1 && part.slashOnCrit > 0 && rng() < part.slashOnCrit) proc(part, 'slash', seed, now, blastExtra);
      }
    }
    return landed;
  };

  fresh();
  let shotsHere = 0;
  /** @type {number[]} */
  const shotsList = [];
  while (times.length < KILLS) {
    const m = inForm ? form : plain;
    const wasForm = inForm;
    const step = 1 / rateOf(m);
    // Past its time, a target is finished at the rate it has been losing health and shields.
    if (now - start > TARGET_SECONDS) {
      const lost = ehp - Math.max(0, health) - shields - overguard;
      const more = (Math.max(0, health) + shields + overguard) * (now - start) / Math.max(1e-9, lost);
      times.push(now - start + more); shotsList.push(shotsHere * (1 + more / Math.max(1e-9, now - start)));
      shotsHere = 0; fresh();
      if (single && c) { inForm = true; left = whole(c.ammo / Math.max(1e-9, form.mode.cost), rng); }
      continue;
    }
    const landed = shoot(m);
    shotsHere++;
    // The gauge: each pellet that landed while the target lived, at the share aimed.
    if (c && !inForm) for (let k = 0; k < landed; k++) if (c.any || rng() < (c.share ?? 0.75)) gauge++;
    // When the next shot can go.
    let next = now + step;
    if (inForm) {
      if (--left <= 0) { next += SWAP_OUT; inForm = false; gauge = 0; }
    } else if (reloadsIn(m) && --magLeft <= 0) {
      next = (w.quickReload ? now : next) + reloadTime;
      magLeft = whole(perMag(m), rng);
    }
    if (c && !inForm && gauge >= c.hits) {
      // The swap in: a reload's time (the magazine stays as it is for the swap back).
      next = now + step + reloadTime;
      inForm = true; gauge = 0;
      left = whole(c.ammo / Math.max(1e-9, form.mode.cost), rng);
    }
    if (wasForm) formTime += step;
    runUntil(next);
    now = next;
    if (health <= 0) {
      times.push(now - start); shotsList.push(shotsHere);
      shotsHere = 0;
      fresh();
      // One target: each kill from a full gauge, the form first.
      if (single && c) { inForm = true; left = whole(c.ammo / Math.max(1e-9, form.mode.cost), rng); magLeft = whole(perMag(plain), rng); }
    }
  }
  const total = times.reduce((a, b) => a + b, 0);
  const mean = total / times.length;
  // The standard error from 20 batches of kills (kills in a stream aren't independent).
  const B = 20, size = Math.floor(times.length / B);
  const batches = Array.from({ length: B }, (_, i) => times.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0) / size);
  const bm = batches.reduce((a, b) => a + b, 0) / B;
  const se = Math.sqrt(batches.reduce((s, x) => s + (x - bm) ** 2, 0) / (B - 1) / B);
  return { timePerKill: mean, shotsPerKill: shotsList.reduce((a, b) => a + b, 0) / shotsList.length, dps: ehp / mean, se, kills: times.length,
    ...(c ? { inForm: formTime / total } : {}) };
}
