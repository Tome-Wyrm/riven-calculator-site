import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBuild, lockOdds, FLAT_COST } from '../src/planner.js';
import { pools } from '../src/cycle.js';

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

test('after a splice, cycling with only the spliced stat locked is the normal price', () => {
  const p = planBuild({ ...VIRAL, negative: null }, { stage: 'post', have: [], shape: '+++-' });
  // Locking an element as well costs double, so the average sits between the two prices.
  assert.ok(p.expectedKuva < p.expectedCycles * 2 * FLAT_COST - 1);
  assert.equal(p.steps.find(s => s.stage === 'post' && !s.have.length)?.action, 'cycle');
});

test('a slot can take any one of several stats ("Cold or Toxin")', () => {
  const base = { cls: 'rifle', spliced: null, negative: null, shape: '+++' };
  const one = planBuild({ ...base, positives: ['cold', 'zoom'] }).expectedKuva;
  const either = planBuild({ ...base, positives: [['cold', 'toxin'], 'zoom'] }).expectedKuva;
  const both = planBuild({ ...base, positives: [['cold', 'toxin'], ['zoom', 'fireRate']] }).expectedKuva;
  assert.ok(either < one && both < either, `${one} > ${either} > ${both}`);
  // An alternative that another slot needs can't fill both: the same as wanting Cold and Toxin.
  near(planBuild({ ...base, positives: [['cold', 'toxin'], 'toxin'] }).expectedKuva,
    planBuild({ ...base, positives: ['cold', 'toxin'] }).expectedKuva, 1e-3);
  // A riven with Toxin and Range is done.
  const p = planBuild({ ...base, positives: [['cold', 'toxin'], 'zoom'] }, { stage: 'post', have: ['toxin', 'zoom'], shape: '+++' });
  assert.equal(p.expectedKuva, 0);
  // Alternatives that can't roll are dropped; a slot with none left is refused.
  assert.throws(() => planBuild({ ...base, positives: [['range', 'comboDuration']] }), /Range or Combo Duration can't roll/);
  assert.throws(() => planBuild({ ...base, positives: [['cold', 'toxin', 'heat', 'electricity'], ['zoom', 'fireRate', 'multishot']] }), /Too many alternatives/);
});

test('the curse can be any one of several too', () => {
  const base = { cls: 'rifle', positives: ['critChance', 'critDamage'], spliced: null, shape: '++-' };
  const one = planBuild({ ...base, negative: 'zoom' }).expectedKuva;
  near(planBuild({ ...base, negative: ['zoom'] }).expectedKuva, one, 1e-6);
  const either = planBuild({ ...base, negative: ['zoom', 'recoil'] }).expectedKuva;
  assert.ok(either < one, `${either} < ${one}`);
  // A riven with either one is done.
  assert.equal(planBuild({ ...base, negative: ['zoom', 'recoil'] }, { stage: 'post', have: ['critChance', 'critDamage', '-recoil'], shape: '++-' }).expectedKuva, 0);
  // Every curse but the positives' own stats: about as cheap as not caring (not quite: "don't care"
  // also takes a -Critical Chance riven on the way, before it rolls Critical Chance as a positive).
  const { negative } = pools('rifle');
  const any = planBuild({ ...base, negative: negative.filter(id => !base.positives.includes(id)) }).expectedKuva;
  const free = planBuild({ ...base, negative: null }).expectedKuva;
  assert.ok(any >= free && any < free * 1.01, `${any} vs ${free}`);
});

test('a positive the target has no use for can be locked to hold the shape', () => {
  const melee = { cls: 'melee', spliced: null };
  const none = (t, shape) => planBuild(t, { stage: 'post', have: [], shape });
  const step = (p, have) => p.steps.find(s => s.have.join() === have)?.action;
  // No curse to lock on +++: a spare positive holds the shape, and Melee Damage has the other two
  // slots, out of the 22 stats left: 11 cycles.
  const plain = none({ ...melee, positives: ['damage'], negative: null, shape: '+++' }, '+++');
  assert.equal(step(plain, ''), '+?');
  near(plain.expectedCycles, 11, 1e-6);
  // Melee Damage and -Impact on +++-: the spare's lock leaves the curse rolling too, so either
  // can land (or both). Locking the unwanted curse instead took 22/3 + 17.1 = 24.4 cycles.
  const t = { ...melee, positives: ['damage'], negative: 'impact', shape: '+++-' };
  const both = none(t, '+++-');
  assert.equal(step(both, ''), '+?');
  assert.ok(both.expectedCycles > 19 && both.expectedCycles < 20, String(both.expectedCycles));
  // What it has is still what it locks.
  assert.equal(step(both, 'damage'), 'damage');
  assert.equal(step(both, '-impact'), '-impact');
  // With every positive slot wanted there is no spare once the riven has all three.
  const full = planBuild({ ...melee, positives: ['fireRate', 'electricity', 'range'], negative: 'slash', shape: '+++-' });
  assert.notEqual(step(full, 'fireRate,electricity,range'), '+?');
  assert.equal(step(full, 'fireRate,-slash'), '-slash');
});

test('lock odds: a positive or the curse, by how many curses would do', () => {
  const t = { cls: 'melee', positives: ['fireRate', 'electricity', 'range'], spliced: null, negative: 'slash', shape: '+++-' };
  const rows = lockOdds(t);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map(r => r.own), [true, false, false, false, false, false]);
  // The curse's lock: the three positives from the other 22, however many curses would do.
  for (const r of rows) near(1 / r.negative, C(22, 3), 1e-6);
  // A positive's lock: the other two from 22, and one of the curses from the 15 left.
  rows.forEach((r, i) => near(1 / r.positive, (C(22, 2) * 15) / (i + 1), 1e-6));
  assert.equal(rows.findIndex(r => r.positive > r.negative), 2);       // from three
  // The target's own curses come first, and its count is marked.
  assert.deepEqual(lockOdds({ ...t, negative: ['slash', 'impact'] }).map(r => r.own), [false, true, false, false, false, false]);
  // With the spliced stat holding a slot, two curses are enough: 1 in 165 against 1 in 231.
  const spliced = lockOdds({ cls: 'melee', positives: ['fireRate', 'range'], spliced: 'statusDamage', negative: 'slash', shape: '+++-' });
  near(1 / spliced[1].positive, 165, 1e-6);
  near(1 / spliced[1].negative, C(22, 2), 1e-6);
  // No choice to make: no curse wanted, no curse on the shape, or only one positive to roll.
  assert.equal(lockOdds({ ...t, negative: null }), null);
  assert.equal(lockOdds({ ...t, shape: '+++' }), null);
  assert.equal(lockOdds({ ...t, positives: ['range'] }), null);
});

test('a locked curse is out of the positive draw, with several wanted curses too', () => {
  // Melee: 23 positives, 17 negatives. With the curse locked, the three positives come from the
  // other 22: C(22,3) = 1,540, however many curses the target takes. With a positive locked, the
  // other two come from 22 and the curse from the 15 left (Attack Speed and Range are taken).
  const base = { cls: 'melee', positives: ['fireRate', 'electricity', 'range'], spliced: null, shape: '+++-' };
  const from = (negative, have) => planBuild({ ...base, negative }, { stage: 'post', have, shape: '+++-' });
  const lockPos = k => (C(22, 2) * 15) / k;
  for (const negative of [['slash'], ['slash', 'impact']]) {
    // One or two wanted curses: locking the curse is the better lock.
    const p = from(negative, ['fireRate', '-slash']);
    near(p.expectedCycles, C(22, 3), 1e-6);
    assert.ok(p.steps.find(s => s.have.length === 2 && s.have[0] === 'fireRate' && s.have[1].startsWith('-'))?.action.startsWith('-'));
    assert.ok(lockPos(negative.length) > C(22, 3));
  }
  // Three: locking a positive wins, 1 in 1,155 a cycle.
  const three = from(['slash', 'impact', 'puncture'], ['fireRate', '-slash']);
  near(three.expectedCycles, lockPos(3), 1e-6);
  assert.equal(three.steps.find(s => s.have.length === 2 && s.have[0] === 'fireRate' && s.have[1].startsWith('-'))?.action, 'fireRate');
  // A curse that's also wanted as a positive keeps its own identity: locked as the curse, it
  // leaves 22 to draw from; the other wanted curse (never a positive here) leaves all 23.
  const mixed = { cls: 'melee', positives: [['slash', 'range']], spliced: null, shape: '++-', negative: ['slash', 'impact'] };
  const lockIt = (/** @type {string} */ curse) => planBuild(mixed, { stage: 'post', have: [curse], shape: '++-' });
  assert.ok(lockIt('-slash').expectedCycles > lockIt('-impact').expectedCycles);
});
