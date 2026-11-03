import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fight } from '../src/fight.js';

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
  // More damage past a one-shot kill gains nothing; shooting sooner does.
  const felarx = (/** @type {number} */ damage, /** @type {number} */ fireRate) => fight(gun({ impact: 1000 }), { stats: { damage, fireRate }, elements: [] }, { target: target(100), targets: 20 }).dps;
  near(felarx(1, 0), felarx(0, 0));
  near(felarx(0, 0.5), 1.5 * felarx(0, 0));
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
