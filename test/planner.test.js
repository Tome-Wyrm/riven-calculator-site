import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBuild, FLAT_COST } from '../src/planner.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const C = (n, k) => (k === 0 ? 1 : (n * C(n - 1, k - 1)) / k);
// Felarx: 24 possible positives, 19 possible negatives (Impact only "may not roll", so counted)
const VIRAL = { cls: 'shotgun', ipsCode: '?yy', positives: ['cold', 'toxin'], spliced: 'viral', negative: 'critChance', shape: '+++-' };

test('after splicing with -CC locked: both elements from the other 23 positives, 1 in C(23,2)', () => {
  const p = planBuild(VIRAL, { stage: 'post', have: ['-critChance'], shape: '+++-' });
  near(p.expectedCycles, C(23, 2), 1e-6);
  near(p.expectedKuva, C(23, 2) * 2 * FLAT_COST, 1e-3);
  assert.equal(p.steps.find(s => s.stage === 'post' && s.have.join() === '-critChance')?.action, '-critChance');
});

test('the Felarx Viral plan: lock an element before splicing, lock -CC after', () => {
  const p = planBuild(VIRAL);
  assert.deepEqual([...p.parents].sort(), ['cold', 'toxin']);
  const step = (stage, have) => p.steps.find(s => s.stage === stage && s.have.join() === have)?.action;
  assert.equal(step('pre', 'toxin'), 'toxin');            // lock the element you have
  assert.equal(step('pre', 'toxin,cold'), 'splice');
  assert.equal(step('post', '-critChance'), '-critChance');
  assert.equal(step('post', 'cold,-critChance'), '-critChance');
  // Around 2M Kuva on average; far below just cycling (18M+ for the second stage alone)
  assert.ok(p.expectedKuva > 1.5e6 && p.expectedKuva < 2.5e6, String(p.expectedKuva));
  assert.ok(p.median.cycles < p.expectedCycles && p.likely.cycles > p.expectedCycles);
});

test('no splice: one stage, and the shape may change until something is locked', () => {
  // Rifle, want Crit Chance + Crit Damage, no negative wanted, ++ shape
  const p = planBuild({ cls: 'rifle', positives: ['critChance', 'critDamage'], spliced: null, negative: null, shape: '++' });
  assert.equal(p.parents, null);
  assert.ok(p.expectedKuva > 0 && Number.isFinite(p.expectedKuva));
  assert.equal(p.steps.find(s => s.have.join() === 'critChance')?.action, 'critChance');
});

test('impossible targets are refused with a reason', () => {
  assert.throws(() => planBuild({ ...VIRAL, shape: '++-' }), /only 2 positives/);
  assert.throws(() => planBuild({ ...VIRAL, negative: 'cold' }), /can't roll as a negative/);
});
