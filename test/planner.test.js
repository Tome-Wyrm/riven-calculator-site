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

test('a riven that already has both parents splices straight into the target: 0 cycles', () => {
  const plan = planBuild({ cls: 'shotgun', ipsCode: '?y?', positives: ['critDamage'], spliced: 'viral', negative: 'recoil', shape: '+++-' },
    { stage: 'pre', have: ['critDamage', 'cold', 'toxin', '-recoil'], shape: '+++-' });
  assert.equal(plan.expectedCycles, 0);
  assert.equal(plan.median.cycles, 0);
  assert.equal(plan.likely.cycles, 0);
});

test('value goals: a minimum makes it cost more, and an impossible one is refused', () => {
  const base = { cls: 'shotgun', ipsCode: '?y?', positives: ['toxin', 'multishot'], spliced: null, negative: null, shape: '++' };
  const any = planBuild(base);
  const good = planBuild({ ...base, goals: { toxin: { op: 'gte', value: 110 } } });
  assert.ok(good.expectedKuva > any.expectedKuva * 1.5, `${good.expectedKuva} vs ${any.expectedKuva}`);
  // No minimum, or one below the worst roll, changes nothing.
  near(planBuild({ ...base, goals: { toxin: { op: 'gte', value: 1 } } }).expectedKuva, any.expectedKuva, 1);
  assert.throws(() => planBuild({ ...base, goals: { toxin: { op: 'gte', value: 9999 } } }), /can't be ≥ 9999/);
  // A perfect roll (the best value the game can show) is possible, just expensive.
  const best = planBuild({ ...base, goals: { toxin: { op: 'gte', value: 117.6 } } });
  assert.ok(best.expectedKuva > good.expectedKuva);
  // At most / exactly
  assert.ok(planBuild({ ...base, goals: { toxin: { op: 'lte', value: 100 } } }).expectedKuva > any.expectedKuva);
  assert.ok(planBuild({ ...base, goals: { toxin: { op: 'eq', value: 100 } } }).expectedKuva > best.expectedKuva / 2);
});

test('value goals: a riven that already meets them is done', () => {
  const plan = planBuild({ cls: 'shotgun', ipsCode: '?y?', positives: ['toxin'], spliced: null, negative: null, shape: '++', goals: { toxin: { op: 'gte', value: 100 } } },
    { stage: 'post', have: ['toxin', 'multishot'], shape: '++' });
  assert.equal(plan.expectedCycles, 0);
});

test('a curse can be a splice parent (Mausolon: Critical Chance + -Zoom → Weak Point Critical Chance)', () => {
  const target = { cls: 'archgun', positives: ['damage', 'toxin'], spliced: 'weakpointCrit', parents: ['critChance', 'zoom'], negative: null, shape: '+++-' };
  const plan = planBuild(target, { stage: 'pre', have: ['damage', 'critChance', 'toxin', '-zoom'], shape: '+++-' });
  assert.equal(plan.expectedCycles, 0);
  assert.equal(plan.steps.find(s => s.have.includes('-zoom') && s.have.includes('critChance'))?.action, 'splice');
  // Allowing Zoom as the curse makes the route cheaper than needing it as a positive.
  const fresh = planBuild(target);
  assert.ok(fresh.expectedKuva > 0);
  // With a wanted curse, the new random curse only sometimes matches it.
  const wanted = planBuild({ ...target, negative: 'recoil' }, { stage: 'pre', have: ['damage', 'critChance', 'toxin', '-zoom'], shape: '+++-' });
  assert.ok(wanted.expectedCycles > 0);
});

test('a goal for the spliced stat: only splice once a parent rolled well enough', () => {
  const base = { cls: 'shotgun', ipsCode: '?y?', positives: ['critDamage'], spliced: 'viral', negative: null, shape: '+++-' };
  const any = planBuild(base);
  const high = planBuild({ ...base, goals: { viral: { op: 'gte', value: 105 } } });
  assert.ok(high.expectedKuva > any.expectedKuva, `${high.expectedKuva} vs ${any.expectedKuva}`);
  // Parents on the riven: a good roll on either one splices now, two bad ones don't.
  const riven = { stage: /** @type {'pre'} */ ('pre'), have: ['critDamage', 'cold', 'toxin', '-recoil'], shape: /** @type {'+++-'} */ ('+++-') };
  assert.equal(planBuild({ ...base, goals: { viral: { op: 'gte', value: 105 } } }, { ...riven, goodParents: ['toxin'] }).expectedCycles, 0);
  assert.ok(planBuild({ ...base, goals: { viral: { op: 'gte', value: 105 } } }, { ...riven, goodParents: [] }).expectedCycles > 0);
  assert.throws(() => planBuild({ ...base, goals: { viral: { op: 'gte', value: 999 } } }), /can't reach/);
});

test('at most / exactly goals for the spliced stat need both parents low enough', () => {
  const base = { cls: 'shotgun', ipsCode: '?y?', positives: ['critDamage'], spliced: 'viral', negative: null, shape: '+++-' };
  const riven = { stage: /** @type {'pre'} */ ('pre'), have: ['critDamage', 'cold', 'toxin', '-recoil'], shape: /** @type {'+++-'} */ ('+++-') };
  const atMost = { ...base, goals: { viral: { op: /** @type {'lte'} */ ('lte'), value: 100 } } };
  assert.equal(planBuild(atMost, { ...riven, goodParents: ['cold', 'toxin'] }).expectedCycles, 0);
  // One parent rolled too high: the spliced stat would keep that roll.
  assert.ok(planBuild(atMost, { ...riven, goodParents: ['cold'], highParents: ['toxin'] }).expectedCycles > 0);
  const exactly = { ...base, goals: { viral: { op: /** @type {'eq'} */ ('eq'), value: 95 } } };
  assert.ok(planBuild(exactly).expectedKuva > planBuild(base).expectedKuva);
  assert.throws(() => planBuild({ ...base, goals: { viral: { op: 'lte', value: 1 } } }), /can't reach/);
});

test('a value goal for the curse', () => {
  const base = { cls: 'rifle', positives: ['critChance', 'critDamage'], spliced: null, negative: 'zoom', shape: '++-' };
  const any = planBuild(base);
  const small = planBuild({ ...base, negGoal: { op: 'lte', value: 35 } });
  assert.ok(small.expectedKuva > any.expectedKuva, `${small.expectedKuva} vs ${any.expectedKuva}`);
  assert.throws(() => planBuild({ ...base, negGoal: { op: 'gte', value: 999 } }), /can't be/);
});

test('after a splice every cycle pays the locked price: the spliced stat holds a lock', () => {
  const target = { ...VIRAL, negative: null };
  const p = planBuild(target, { stage: 'post', have: [], shape: '+++-' });
  near(p.expectedKuva, p.expectedCycles * 2 * FLAT_COST, 1e-3);
  // Giving the splice up (unlocked, it's rerolled away) is never worth it once it's on the right shape.
  assert.ok(p.steps.every(s => !s.action.startsWith('unsplice:')));
});
