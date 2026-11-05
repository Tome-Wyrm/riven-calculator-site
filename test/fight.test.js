import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargedPellets, fight } from '../src/fight.js';

const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
// One part, one shot a second, no crits or status unless asked: easy numbers.
const gun = (/** @type {Record<string, number>} */ dmg, part = {}, weapon = {}) => ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0, ...weapon,
  modes: [{ name: 'Normal Attack', rate: 1, cost: 1, parts: [{ name: 'Normal Attack', dmg, cc: 0, cd: 1, sc: 0, ms: 1, ...part }] }] });
const none = { stats: {}, elements: [] };
const target = (/** @type {number} */ health, more = {}) => ({ health, shields: 0, armor: 0, weak: {}, shieldWeak: {}, ...more });

test('shots to kill: overkill still takes a shot, and the killing shot counts for the share it needed', () => {
  const big = fight(gun({ impact: 1000 }), none, { target: target(100) });
  assert.equal(big.shotsPerKill, 1);
  near(big.timePerKill, 1);
  // 100 a shot into 250 health: 2 shots and half of the third.
  near(fight(gun({ impact: 100 }), none, { target: target(250) }).shotsPerKill, 2.5);
  // The DPS counts overkill: past a one-shot kill, more damage is worth as much as shooting sooner.
  const felarx = (/** @type {number} */ damage, /** @type {number} */ fireRate) => fight(gun({ impact: 1000 }), { stats: { damage, fireRate }, elements: [] }, { target: target(100), targets: 20 });
  near(felarx(1, 0).dps, 2 * felarx(0, 0).dps);
  near(felarx(0, 0.5).dps, 1.5 * felarx(0, 0).dps);
  // The kill itself can't be quicker than a shot.
  near(felarx(1, 0).timePerKill, felarx(0, 0).timePerKill);
  // No jump where a one-shot kill begins: 99 and 101 a shot on 100 health.
  const near100 = (/** @type {number} */ impact) => fight(gun({ impact }), none, { target: target(100) }).dps;
  assert.ok(near100(101) / near100(99) < 1.05, String(near100(101) / near100(99)));
});

test('room clearing spreads reloads over the kills: a 5-round magazine and a 2 s reload, one shot a kill', () => {
  const r = fight(gun({ impact: 100 }, {}, { mag: 5, reload: 2 }), none, { target: target(100), targets: 20 });
  // Five kills take 4 shot intervals and the reload: 6 s.
  near(r.timePerKill, 1.2);
});

test('shields go first, then health; Toxin skips them', () => {
  near(fight(gun({ impact: 100 }), none, { target: target(100, { shields: 100 }) }).shotsPerKill, 2);
  near(fight(gun({ toxin: 100 }), none, { target: target(100, { shields: 100 }) }).shotsPerKill, 1);
});

test('DoT: a bleed that kills between shots; Heat stacks ramp while procs keep coming', () => {
  // 100 Slash with a proc every shot: the hit, then 35 a tick from each proc's bleed, 6 ticks from a second later.
  const slash = fight(gun({ slash: 100 }, { sc: 1 }), none, { target: target(1000) });
  assert.ok(slash.shotsPerKill < 1000 / 100, String(slash.shotsPerKill));
  // Against a target that lasts, Heat's shared timer makes its stacks pile up past 6 ticks each.
  const heat = fight(gun({ heat: 100 }, { sc: 1 }), none, { target: target(1e6) }).dps;
  const toxin = fight(gun({ toxin: 100 }, { sc: 1 }), none, { target: target(1e6) }).dps;
  assert.ok(heat > 1.5 * toxin, `${heat} vs ${toxin}`);
});

test('Electricity ticks at once, Toxin a second later: the same proc kills sooner as Electricity', () => {
  // 100 a hit and a 50-a-tick proc each shot, into 150 health.
  const electricity = fight(gun({ electricity: 100 }, { sc: 1 }), none, { target: target(150) });
  const toxin = fight(gun({ toxin: 100 }, { sc: 1 }), none, { target: target(150) });
  assert.equal(electricity.shotsPerKill, 1);
  assert.ok(toxin.shotsPerKill > 1, String(toxin.shotsPerKill));
});

test('single target spreads reloads too: a kill that only just fits a magazine is no cliff', () => {
  // Five shots to kill, a 2 s reload: five rounds or four only move each shot's share of the reload.
  const time = (/** @type {number} */ mag) => fight(gun({ impact: 100 }, {}, { mag, reload: 2 }), none, { target: target(500) }).timePerKill;
  near(time(5), 5 * 1.2);
  near(time(4), 5 * 1.25);
  // A reload shorter than a shot's interval costs nothing (it can't speed the gun up).
  near(fight(gun({ impact: 100 }, {}, { mag: 1, reload: 0.5 }), none, { target: target(500) }).timePerKill, 5);
});

test('more damage never slows a kill: a kill by the shot runs into one by the DoT after it', () => {
  let last = Infinity, jump = 0;
  for (let damage = 0; damage <= 2; damage += 0.01) {
    const t = fight(gun({ impact: 100, toxin: 100 }, { sc: 1 }), { stats: { damage }, elements: [] }, { target: target(1000) }).timePerKill;
    assert.ok(t <= last + 1e-9, `${t} after ${last} at +${damage}`);
    if (last < Infinity) jump = Math.max(jump, 1 - t / last);
    last = t;
  }
  assert.ok(jump < 0.03, String(jump));
});

test('a faster reload never hurts: where a shot falls against Heat\'s strip steps is luck', () => {
  let last = 0;
  for (let reloadSpeed = 0; reloadSpeed <= 1; reloadSpeed += 0.01) {
    const dps = fight(gun({ heat: 100 }, { sc: 1 }, { mag: 3, reload: 2 }), { stats: { reloadSpeed }, elements: [] }, { target: target(2000, { armor: 1000 }) }).dps;
    assert.ok(dps >= last * (1 - 1e-9), `${dps} after ${last} at +${reloadSpeed}`);
    last = dps;
  }
});

test('Ammo Efficiency stops at 75%: a magazine lasts four times as long at most', () => {
  const time = (/** @type {number} */ ammoEfficiency) => fight(gun({ impact: 100 }, {}, { mag: 2, reload: 3 }), { stats: { ammoEfficiency }, elements: [] }, { target: target(100), targets: 20 }).timePerKill;
  near(time(-0.75), 1 + 2 / 8);
  near(time(-0.9), time(-0.75));
  assert.ok(time(-0.5) > time(-0.75));
});

// A gun with a form: 1 shot a second normally (2 pellets), 2 a second in the form (10x the damage).
const incarnon = (/** @type {object} */ weapon = {}) => ({ kind: 'Rifle', mag: 0, reload: 3, ammo: null, trigger: 'Auto', tags: [], main: 0, ...weapon, modes: [
  { name: 'Normal Attack', rate: 1, cost: 1, parts: [{ name: 'Normal Attack', dmg: { impact: 100 }, cc: 0, cd: 1, sc: 0, ms: 2 }] },
  { name: 'Incarnon Form', rate: 2, cost: 1, parts: [{ name: 'Incarnon Form', dmg: { impact: 1000 }, cc: 0, cd: 1, sc: 0, ms: 1 }] }] });
const charged = { hits: 6, any: false, ammo: 20, normal: 0, share: 0.5 };

test('Incarnon: a room is the cycle, charging at the pellets on weak points, then a reload to swap, the form, and back', () => {
  const big = target(1e7);
  const room = { target: big, targets: 20, mode: 1 };
  const form = fight(incarnon(), none, room).dps;
  const r = fight(incarnon(), none, { ...room, incarnon: charged });
  // 6 hits at 2 pellets a shot, half on weak points: 6 s. Swap in 3 s, 20 shots in 10 s, swap back 0.75 s.
  // The aiming speeds the gauge, but its damage stays the build's own (no weak points here).
  const plain = fight(incarnon(), none, { target: big, targets: 20, mode: 0 }).dps;
  near(r.dps, (plain * 6 + form * 10) / 19.75, 1e-3);
  near(r.inForm, 10 / 19.75, 1e-3);
  // Reload Speed shortens the swap; a burst stays in the form.
  const quick = fight(incarnon(), { stats: { reloadSpeed: 1 }, elements: [] }, { ...room, incarnon: charged });
  near(quick.inForm, 10 / 18.25, 1e-3);
  near(fight(incarnon(), none, { ...room, incarnon: charged, burst: true }).dps, form);
  // Any hit charges at every pellet, whatever the share.
  near(fight(incarnon(), none, { ...room, incarnon: { ...charged, any: true } }).inForm, 10 / 16.75, 1e-3);
});

test('Incarnon: one target starts with a full gauge, the form first and the cycle for what\'s left', () => {
  const one = (/** @type {number} */ health) => fight(incarnon(), none, { target: target(health), mode: 1, incarnon: charged });
  // 20 shots in the form hold 20,000: inside that it's the form alone.
  near(one(10000).dps, fight(incarnon(), none, { target: target(10000), mode: 1 }).dps);
  assert.equal(one(10000).inForm, 1);
  // Just past it the kill slows without a jump, and well past it the form is only part of the time.
  assert.ok(one(20500).timePerKill / one(19500).timePerKill < 1.15);
  assert.ok(one(1e6).inForm < 0.6);
});

test('Incarnon: the pellet that kills ends the shot\'s charge, so overkill charges slowly', () => {
  // 2 pellets, a third of a shot's damage kills: one pellet charges. 6 hits at half on weak points: 12 s.
  const room = (/** @type {number} */ health) => fight(incarnon(), none, { target: target(health), targets: 20, mode: 1, incarnon: charged });
  near(room(100).inForm, 10 / 25.75);
  near(room(1e7).inForm, 10 / 19.75, 1e-3);
});

test('whole pellets, on average: one pellet at least, more on fodder when some hit far harder, the spill wasted', () => {
  // 8 pellets of 10 damage, even: one kills a 5-health target, all 8 charge on a tough one.
  near(chargedPellets(8, 80, 5, 1), 1);
  near(chargedPellets(8, 80, 1e7, 1), 8, 1e-3);
  // A weak target with uneven pellets takes more of them than the average says.
  assert.ok(chargedPellets(8, 80, 30, 2.5) > chargedPellets(8, 80, 30, 1));
  // A kill that spills just past a shot wastes much of the next one (the simulation: about 70% of 8).
  assert.ok(chargedPellets(8, 80, 88, 1) < 6.5, String(chargedPellets(8, 80, 88, 1)));
  // One pellet a shot wastes nothing, and it's smooth over health.
  near(chargedPellets(1, 10, 1000, 2), 1);
  let last = chargedPellets(8, 80, 1, 2);
  for (let ehp = 1; ehp < 2000; ehp += 1) {
    const now = chargedPellets(8, 80, ehp, 2);
    assert.ok(Math.abs(now - last) < 0.25, `${now} after ${last} at ${ehp}`);
    last = now;
  }
});
