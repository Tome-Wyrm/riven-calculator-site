import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pools, cycleCost } from '../src/cycle.js';

const C = (n, k) => (k === 0 ? 1 : (n * C(n - 1, k - 1)) / k);

test('pools match the wiki: 24 rifle positives, 19 possible negatives', () => {
  const { positive, negative } = pools('rifle');
  assert.equal(positive.length, 24);
  assert.equal(negative.length, 19);
  // 24C3 = 2024 three-positive combinations, as the community count says
  assert.equal(C(positive.length, 3), 2024);
});

test('cycle costs follow the wiki table', () => {
  assert.equal(cycleCost(1), 900);
  assert.equal(cycleCost(9), 3150);
  assert.equal(cycleCost(10), 3500);
  assert.equal(cycleCost(40, true), 7000);
});

test('vintage stats are never rolled by a cycle', async () => {
  const { pools } = await import('../src/cycle.js');
  const { WEAPONS } = await import('../src/data/weapons.js');
  const sobek = WEAPONS.find(w => w[0] === 'Sobek');
  assert.equal(pools('shotgun', sobek[3]).positive.includes('projectileSpeed'), false);
  assert.equal(pools('shotgun', 'yyy').positive.includes('projectileSpeed'), true);
});
