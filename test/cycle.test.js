import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pools, cycleChance, kuvaPlan, cycleCost } from '../src/cycle.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const C = (n, k) => (k === 0 ? 1 : (n * C(n - 1, k - 1)) / k);

test('pools match the wiki: 24 rifle positives, 19 possible negatives', () => {
  const { positive, negative } = pools('rifle');
  assert.equal(positive.length, 24);
  assert.equal(negative.length, 19);
  // 24C3 = 2024 three-positive combinations, as the community count says
  assert.equal(C(positive.length, 3), 2024);
});

test('one wanted stat, any negative: matches the closed form', () => {
  // P(stat in a k-of-24 draw) = k/24; shapes 25% each with k = 2, 2, 3, 3
  const p = cycleChance({ cls: 'rifle', want: ['critChance'], negative: 'any' }).total;
  near(p, 0.25 * (2 / 24 + 2 / 24 + 3 / 24 + 3 / 24));
});

test('two wanted stats with no negative allowed', () => {
  const p = cycleChance({ cls: 'rifle', want: ['critChance', 'critDamage'], negative: 'none' });
  near(p.byShape['++'], 1 / C(24, 2));
  near(p.byShape['+++'], 22 / C(24, 3));
  near(p.byShape['++-'], 0);
});

test('negative restricted to a list: the curse is drawn from what the positives left', () => {
  // ++- with wanted CC + CD: the negative comes from the 19 negatives minus CC and CD = 17.
  const p = cycleChance({ cls: 'rifle', want: ['critChance', 'critDamage'], negative: ['zoom'] });
  near(p.byShape['++-'], (1 / C(24, 2)) * (1 / 17));
});

test('a locked trait fixes the shape and keeps itself', () => {
  const p = cycleChance({ cls: 'rifle', want: ['critChance', 'critDamage'], negative: 'any',
    lock: { statId: 'critChance', sign: '+', shape: '+++-' } });
  // CD must be one of the 2 drawn from the other 23
  near(p.total, 2 / 23);
});

test('Kuva: costs follow the cycle table from the current reroll count', () => {
  assert.equal(cycleCost(1), 900);
  assert.equal(cycleCost(10), 3500);
  assert.equal(cycleCost(40, true), 7000);
  const plan = kuvaPlan(0.5, 0, false);
  near(plan.expectedCycles, 2);
  near(plan.expectedKuva, 900 + 0.5 * 1000 + 0.25 * 1200 + 0.125 * 1400 + 0.0625 * 1700 + 0.03125 * 2000
    + 0.015625 * 2350 + 0.0078125 * 2750 + 0.00390625 * 3150 + 0.001953125 * 3500 * 2, 1);
  assert.deepEqual(plan.median, { cycles: 1, kuva: 900 });
  // Already past 10 cycles: everything costs 3,500
  assert.equal(kuvaPlan(1, 31, false).expectedKuva, 3500);
});
