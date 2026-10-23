import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAT_BY_ID as S } from '../src/data/stats.js';
import {
  range, displayValue, format, solveU, canRoll, evaluateGoal, fingerprintToU, probability, quirks, weaponCanRoll, gradeRoll, shapeFor, rollScore, letterGrade,
} from '../src/engine.js';

const near = (got, want, tol, msg) =>
  assert.ok(Math.abs(got - want) < tol, `${msg}: got ${got.toFixed(4)}, want ${want}`);

// [stat, class, shape, sign, value at u=0, value at u=1] from the two spreadsheets (2 decimals).
const SHEET = [
  ['ammoMax',           'rifle',   '++-',  '+', 66.76, 81.59],
  ['ammoMax',           'rifle',   '++-',  '-', -26.7, -32.64],
  ['critChance',        'rifle',   '++-',  '-', -80.19, -98.01],
  ['damage',            'pistol',  '++-',  '+', 293.5, 358.72],
  ['damage',            'pistol',  '++-',  '-', -117.4, -143.49],
  ['recoil',            'rifle',   '++-',  '+', -120.29, -147.02],
  ['recoil',            'rifle',   '++-',  '-', 48.11, 58.81],
  ['comboDuration',     'melee',   '++-',  '-', -4.33, -5.29],
  ['chanceToGainCombo', 'melee',   '++-',  '-', -56.05, -68.51],
  ['range',             'melee',   '++-',  '-', -1.04, -1.27],
  ['corpus',            'shotgun', '++-',  '+', 1.6, 1.74],
  ['corpus',            'shotgun', '++-',  '-', 0.76, 0.71],
  ['ammoEfficiency',    'shotgun', '++-',  '+', 60.14, 73.51],
  ['ammoMax',           'rifle',   '+++-', '+', 50.57, 61.81],
  ['ammoMax',           'rifle',   '+++-', '-', -40.46, -49.45],
  ['damage',            'rifle',   '+++-', '-', -133.65, -163.35],
  ['zoom',              'shotgun', '+++-', '-', -34.02, -41.57],
  ['initialCombo',      'melee',   '+++-', '+', 24.81, 30.32],
  ['comboDuration',     'melee',   '+++-', '+', 8.2, 10.02],
  ['chanceToGainCombo', 'melee',   '+++-', '-', -84.93, -103.8],
  ['corpus',            'archgun', '+++-', '+', 1.46, 1.56],
  ['corpus',            'archgun', '+++-', '-', 0.64, 0.55],
  ['punchThrough',      'archgun', '+++-', '+', 2.73, 3.34],
  ['weakpointCrit',     'pistol',  '+++-', '+', 250.59, 306.28],
  ['parryAngle',        'melee',   '+++-', '+', 82.01, 100.24],
];

test('ranges match both spreadsheets, both ends, buffs and curses', () => {
  for (const [id, cls, shape, sign, at0, at1] of SHEET) {
    const r = range(S[id], cls, shape, sign);
    const tol = S[id].unit === 'mult' ? 0.006 : 0.0051;
    near(r.at0, at0, tol, `${id} ${cls} ${shape}${sign} u=0`);
    near(r.at1, at1, tol, `${id} ${cls} ${shape}${sign} u=1`);
  }
});

// In-game screenshots (2026-10-23): fingerprint Value → displayed text.
const INGAME = [
  // Soma (TennoAR), rank 8
  ['damage',         'rifle', '+', 1023126307, 8, '+267.2%'],
  ['electricity',    'rifle', '+',  741268739, 8, '+138.7%'],
  ['ammoMax',        'rifle', '-',  910199365, 8, '-31.7%'],
  // Lacera (StalkerMios), rank 8 and rank 0
  ['critDamage',     'melee', '+',  363944839, 8, '+129.3%'],
  ['statusChance',   'melee', '+',   87457298, 8, '+122.5%'],
  ['finisher',       'melee', '-',   86463855, 8, '-65.1%'],
  ['critDamage',     'melee', '+',  363944839, 0, '+14.4%'],
  ['statusChance',   'melee', '+',   87457298, 0, '+13.6%'],
  ['finisher',       'melee', '-',   86463855, 0, '-7.2%'],
];

test('fingerprint rolls reproduce the in-game display text', () => {
  for (const [id, cls, sign, value, rank, text] of INGAME) {
    const d = displayValue(S[id], cls, '++-', sign, fingerprintToU(value), rank);
    assert.equal(format(S[id], d), text, `${id} rank ${rank}`);
  }
});

// More screenshots, other shapes and the melee Impact/Puncture coefficient (0.0133). Rank 8.
const INGAME_SHAPES = [
  // Vinquibus melee (TnBayonetMeleeWeapon), ++
  ['puncture',        'melee', '++',   '+',   65769889, '+129.7%'],
  ['additionalCombo', 'melee', '++',   '+',  837879988, '+73.7%'],
  // Obex (KickPunchWeapon), ++-
  ['damage',          'melee', '++-',  '+',  973737259, '+264.5%'],
  ['heat',            'melee', '++-',  '+',  625524962, '+135.9%'],
  ['impact',          'melee', '++-',  '-', 1046153858, '-77.8%'],
  // Vinquibus rifle (TnBayonetRifleWeapon), +++-; a recoil curse shows as a positive number
  ['statusChance',    'rifle', '+++-', '+',  691947666, '+104.2%'],
  ['puncture',        'rifle', '+++-', '+',  343166119, '+130.1%'],
  ['cold',            'rifle', '+++-', '+',  397983968, '+98.6%'],
  ['recoil',          'rifle', '+++-', '-',  420713326, '+79.2%'],
  // Dax bow, +++-: decides gun Puncture = 0.01333 (0.013333 would show +138.5%)
  ['puncture',        'rifle', '+++-', '+',  674991521, '+138.4%'],
];

test('more in-game rivens across shapes match the display text', () => {
  for (const [id, cls, shape, sign, value, text] of INGAME_SHAPES) {
    const d = displayValue(S[id], cls, shape, sign, fingerprintToU(value));
    assert.equal(format(S[id], d), text, `${id} ${cls} ${shape}`);
  }
});

test('quirks: melee crit doubles on heavies, fire rate doubles on bows only', () => {
  assert.deepEqual(quirks(S.critChance, 'melee', false), [{ label: 'Heavy attacks', factor: 2 }]);
  assert.deepEqual(quirks(S.critChance, 'rifle', false), []);
  assert.deepEqual(quirks(S.fireRate, 'rifle', true), [{ label: 'On bows', factor: 2 }]);
  assert.deepEqual(quirks(S.fireRate, 'rifle', false), []);
});

test('weaponCanRoll reads the IPS code for physical stats only', () => {
  assert.equal(weaponCanRoll(S.impact, 'nyy'), 'n');
  assert.equal(weaponCanRoll(S.slash, 'nyy'), 'y');
  assert.equal(weaponCanRoll(S.puncture, 'n?n'), '?');
  assert.equal(weaponCanRoll(S.critChance, 'nnn'), 'y');
  assert.equal(weaponCanRoll(S.impact, undefined), 'y');
});

test('gradeRoll: the true roll from each fingerprint lies inside the interval from the shown text', () => {
  const cases = [
    ...INGAME.map(([id, cls, sign, value, rank, text]) => [id, cls, '++-', sign, value, rank, text]),
    ...INGAME_SHAPES.map(([id, cls, shape, sign, value, text]) => [id, cls, shape, sign, value, 8, text]),
  ];
  for (const [id, cls, shape, sign, value, rank, text] of cases) {
    const g = gradeRoll(S[id], cls, shape, sign, parseFloat(text), rank);
    const u = fingerprintToU(value);
    assert.ok(g.possible, `${id} ${text} possible`);
    assert.ok(g.lo - 1e-6 <= u && u <= g.hi + 1e-6, `${id} ${text}: u=${u.toFixed(4)} not in [${g.lo.toFixed(4)}, ${g.hi.toFixed(4)}]`);
    // One 0.1 display step is a small slice of the range (widest here: unranked Finisher, ~6%)
    assert.ok(g.hi - g.lo < 0.07, `${id} interval width ${(g.hi - g.lo).toFixed(4)}`);
  }
});

test('gradeRoll flags values no roll can show, and shapeFor maps counts to shapes', () => {
  assert.equal(gradeRoll(S.damage, 'rifle', '++-', '+', 300).possible, false);   // max is 269.5
  assert.equal(gradeRoll(S.damage, 'rifle', '++-', '+', 269.5).hi, 1);
  assert.equal(shapeFor(2, 1), '++-');
  assert.equal(shapeFor(3, 0), '+++');
  assert.equal(shapeFor(1, 1), null);
});

test('letter grades follow the community ±10% thresholds', () => {
  const cases = [[10, 'S'], [9.5, 'S'], [9.4, 'A+'], [7.5, 'A+'], [5.5, 'A'], [3.5, 'A-'], [1.5, 'B+'],
    [0, 'B'], [-1.5, 'B'], [-1.6, 'B-'], [-5.5, 'C+'], [-7.5, 'C'], [-9.5, 'C-'], [-9.6, 'F'], [-10, 'F']];
  for (const [score, grade] of cases) assert.equal(letterGrade(score), grade, String(score));
  // From the verified rivens: Soma Damage, Lacera Crit Damage, Lacera Finisher curse (scored as mildness)
  assert.equal(letterGrade(rollScore(fingerprintToU(1023126307))), 'A+');   // +9.1%
  assert.equal(letterGrade(rollScore(fingerprintToU(363944839))), 'B-');    // -3.2%
  assert.equal(letterGrade(rollScore(fingerprintToU(86463855), true)), 'A+'); // +8.4%, a mild curse
});

test('solveU inverts displayValue', () => {
  for (const u of [0, 0.25, 0.738, 1]) {
    const d = displayValue(S.ammoEfficiency, 'shotgun', '++-', '+', u);
    near(solveU(S.ammoEfficiency, 'shotgun', '++-', '+', d), u, 1e-6, `u=${u}`);
  }
});

test('canRoll respects class, polarity and shape', () => {
  assert.equal(canRoll(S.heat, 'rifle', '++-', '-'), false);        // positive only
  assert.equal(canRoll(S.chanceToGainCombo, 'melee', '++', '+'), false);
  assert.equal(canRoll(S.damage, 'rifle', '++', '-'), false);       // no curse slot
  assert.equal(canRoll(S.zoom, 'melee', '++-', '+'), false);        // not a melee stat
  assert.equal(canRoll(S.fireRate, 'melee', '+++-', '-'), true);
});

test('probability: uniform for ordinary stats, max-of-two for spliced', () => {
  near(probability(0.75, 1, false), 0.25, 1e-12, 'uniform');
  near(probability(0.75, 1, true), 1 - 0.75 ** 2, 1e-12, 'spliced');
  assert.equal(probability(1.2, 2, false), 0);
});

const byShape = res => Object.fromEntries(res.results.map(r => [r.shape, r]));

test('goal: Felarx ≥ 70% Ammo Efficiency → only ++-, needs u ≥ ~0.738', () => {
  const res = evaluateGoal({ stat: S.ammoEfficiency, cls: 'shotgun', op: 'gte', target: 70 });
  const r = byShape(res);
  assert.equal(res.sign, '+');
  assert.deepEqual(['++', '++-', '+++', '+++-'].map(s => r[s].feasible), [false, true, false, false]);
  near(r['++-'].uInterval[0], 0.7376, 0.001, 'threshold');
  near(r['++-'].probability, 1 - 0.7376 ** 2, 0.002, 'spliced odds');
  assert.ok(r['++-'].best);
});

test('goal: < 180% Heavy Attack Wind Up → always, except ++- (u < ~0.563)', () => {
  const r = byShape(evaluateGoal({ stat: S.heavyWindup, cls: 'melee', op: 'lte', target: 180 }));
  for (const s of ['++', '+++', '+++-']) near(r[s].probability, 1, 1e-9, s);
  near(r['++-'].uInterval[1], 0.5632, 0.001, '++- threshold');
});

test('goal: ≈ 105% Parry Angle → ++ hits it at u ≈ 0.956', () => {
  const r = byShape(evaluateGoal({ stat: S.parryAngle, cls: 'melee', op: 'near', target: 105 }));
  assert.ok(r['++'].best);
  near(r['++'].closestU, 0.9558, 0.001, 'u');
  near(r['++-'].delta, 3.26, 0.01, '++- misses low');
  near(r['+++-'].delta, 4.76, 0.01, '+++- misses high');
});

test('goal sign follows the display side: recoil buffs are negative numbers', () => {
  assert.equal(evaluateGoal({ stat: S.recoil, cls: 'rifle', op: 'lte', target: -130 }).sign, '+');
  assert.equal(evaluateGoal({ stat: S.damage, cls: 'rifle', op: 'gte', target: -100 }).sign, '-');
  assert.equal(evaluateGoal({ stat: S.corpus, cls: 'rifle', op: 'gte', target: 1.65 }).sign, '+');
});
