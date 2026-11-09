import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fight } from '../src/fight.js';
import { randomFight } from '../src/fight-mc.js';

// As in test/fight.test.js: one part, two shots a second, no crits or status unless asked.
const gun = (/** @type {Record<string, number>} */ dmg, part = {}, weapon = {}) => ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0, ...weapon,
  modes: [{ name: 'Normal Attack', rate: 2, cost: 1, parts: [{ name: 'Normal Attack', dmg, cc: 0, cd: 2, sc: 0, ms: 1, ...part }] }] });
const none = { stats: {}, elements: [] };
const target = (/** @type {number} */ health, more = {}) => ({ health, shields: 0, armor: 0, weak: {}, shieldWeak: {}, ...more });
/** @param {any} r @returns {import('../src/fight-mc.js').RandomResult} */
const ok = r => { assert.ok(!('unsupported' in r), r.unsupported); return r; };

test('random fight: with nothing to roll, the same as the averaged one', () => {
  for (const [w, t] of /** @type {[any, any][]} */ ([[gun({ impact: 100 }), target(1000)], [gun({ impact: 100 }), target(30000, { armor: 1000 })],
    [gun({ impact: 100 }, {}, { mag: 5, reload: 1 }), target(100000)], [gun({ corrosive: 100 }, { sc: 1 }), target(30000, { armor: 1000 })]])) {
    const opts = { target: t, targets: 20 };
    const a = fight(w, none, opts), r = ok(randomFight(w, none, opts, { kills: 200 }));
    assert.ok(Math.abs(r.timePerKill / a.timePerKill - 1) < 1e-9, `${r.timePerKill} vs ${a.timePerKill}`);
    assert.ok(Math.abs(r.shotsPerKill / a.shotsPerKill - 1) < 1e-9, `${r.shotsPerKill} vs ${a.shotsPerKill}`);
  }
});

test('random fight: a kill takes whole shots (the averaged one counts the share of the last it needed)', () => {
  const opts = { target: target(950), targets: 20 };
  assert.equal(fight(gun({ impact: 100 }), none, opts).shotsPerKill, 9.5);
  assert.equal(ok(randomFight(gun({ impact: 100 }), none, opts, { kills: 100 })).shotsPerKill, 10);
});

test('random fight: the same seed, the same fight; crits over a long fight average out', () => {
  const w = gun({ impact: 100 }, { cc: 0.5 }), opts = { target: target(100000), targets: 20 };
  const a = ok(randomFight(w, none, opts, { kills: 400, seed: 7 })), b = ok(randomFight(w, none, opts, { kills: 400, seed: 7 }));
  assert.equal(a.timePerKill, b.timePerKill);
  assert.ok(Math.abs(a.timePerKill / fight(w, none, opts).timePerKill - 1) < 0.02);
});

test('random fight: what it leaves to src/fight.js', () => {
  assert.ok('unsupported' in randomFight(gun({ impact: 100 }), none, { target: target(100), targets: 20, crowd: /** @type {any} */ ({ close: 5 }) }));
});
