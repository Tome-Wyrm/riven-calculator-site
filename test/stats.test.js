import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASSES, SHAPES, DISPOSITION, MAX_RANK, ORDINARY, SPLICED, STATS, STAT_BY_ID,
} from '../src/data/stats.js';

test('stat counts match the wiki (32 ordinary, 18 spliced)', () => {
  assert.equal(ORDINARY.length, 32);
  assert.equal(SPLICED.length, 18);
});

test('ids and prefix/suffix pairs are unique', () => {
  assert.equal(new Set(STATS.map(s => s.id)).size, STATS.length);
  const named = STATS.filter(s => s.prefix);
  assert.equal(new Set(named.map(s => s.prefix)).size, named.length);
  assert.equal(new Set(named.map(s => s.suffix)).size, named.length);
});

test('every stat can roll on at least one class', () => {
  for (const s of STATS) assert.ok(Object.keys(s.b).length > 0, s.id);
});

test('spliced stats are positive only and their recipes name ordinary stats', () => {
  for (const s of SPLICED) {
    assert.equal(s.polarity, 'posOnly', s.id);
    assert.ok(s.from && s.from.length > 0, s.id);
    for (const pair of s.from) {
      assert.equal(pair.length, 2, s.id);
      for (const id of pair) assert.equal(STAT_BY_ID[id]?.spliced, false, `${s.id} <- ${id}`);
    }
  }
});

test('splice recipes match the wiki Riven Splicer table (22 rows)', () => {
  const WIKI = {
    ammoEfficiency: [['magazine', 'reloadSpeed'], ['recoil', 'ammoMax']],
    blast: [['heat', 'cold']], corrosive: [['toxin', 'electricity']],
    orokin: [['grineer', 'corpus']], scaldra: [['infested', 'grineer']], techrot: [['corpus', 'infested']],
    gas: [['toxin', 'heat']], heavyWindup: [['heavyEfficiency', 'comboDuration']],
    magnetic: [['electricity', 'cold']], meleeDamageOnHeavy: [['heavyEfficiency', 'additionalCombo']],
    parryAngle: [['fireRate', 'range']], radiation: [['heat', 'electricity']],
    reloadWhileHolstered: [['ammoMax', 'reloadSpeed'], ['ammoMax', 'magazine']],
    slamDamage: [['damage', 'fireRate']], statusDamage: [['damage', 'statusChance']], viral: [['toxin', 'cold']],
    weakpointCrit: [['critChance', 'zoom'], ['critChance', 'multishot']],
    weakpointDamage: [['damage', 'zoom'], ['damage', 'multishot']],
  };
  const norm = pairs => pairs.map(p => [...p].sort().join('+')).sort();
  for (const s of SPLICED) assert.deepEqual(norm(s.from), norm(WIKI[s.id]), s.id);
  assert.equal(Object.values(WIKI).flat().length, 22);
});

// Independent transcription check: recompute the spreadsheet's lowest positive ++- roll (u = 0)
// for every stat and class. The math engine (Phase 2) gets its own full golden suite.
function sheetMin(stat, cls) {
  const f = Math.fround;
  const v = f(f(f(f(f(stat.b[cls] * 10) * (MAX_RANK + 1)) * DISPOSITION) * SHAPES['++-'].bonus) * 0.9);
  switch (stat.unit) {
    case 'pct': return v * 100;
    case 'pctNeg': return -v * 100;
    case 'mult': return 1 + v;
    default: return v;
  }
}

// Positive minimums from the ++- spreadsheet, columns [rifle, shotgun, pistol, archgun, melee].
// null = blank cell. Merged sheet rows are checked against the stat they match (see PLAN.md).
const SHEET_PP_MINUS_MIN = {
  ammoMax:              [66.76, 120.29, 120.29, 133.52, null],
  heat:                 [120.29, 120.29, 120.29, 159.98, 120.29],
  critChance:           [200.47, 120.29, 200.47, 133.52, 240.57],
  critDamage:           [160.38, 120.29, 120.29, 107.05, 120.29],
  damage:               [220.52, 220.12, 293.5, 133.52, 220.12],
  fireRate:             [80.23, 120.29, 99.84, 80.23, 73.37],
  projectileSpeed:      [120.29, 120.29, 120.29, null, null],
  impact:               [160.38, 160.38, 160.38, 120.29, 159.98],
  magazine:             [66.82, 66.82, 66.82, 80.59, null],
  multishot:            [120.29, 159.98, 159.98, 80.59, null],
  punchThrough:         [3.61, 3.61, 3.61, 3.61, null],
  reloadSpeed:          [66.82, 66.82, 66.82, 133.52, null],
  statusChance:         [120.29, 120.29, 120.29, 80.59, 120.29],
  statusDuration:       [133.64, 133.64, 133.64, 133.64, 133.64],
  recoil:               [-120.29, -120.29, -120.29, -120.29, null],
  zoom:                 [80.18, 56.12, 107.05, 80.18, null],
  additionalCombo:      [null, null, null, null, 78.55],
  comboDuration:        [null, null, null, null, 10.83],
  slideCrit:            [null, null, null, null, 160.39],
  finisher:             [null, null, null, null, 159.98],
  initialCombo:         [null, null, null, null, 32.75],
  heavyEfficiency:      [null, null, null, null, 98.15],
  range:                [null, null, null, null, 2.6],
  corpus:               [1.6, 1.6, 1.6, 1.6, 1.6],
  ammoEfficiency:       [60.14, 60.14, 60.14, 60.14, null],
  blast:                [120.29, 120.29, 120.29, 120.29, 120.29],
  reloadWhileHolstered: [120.29, 120.29, 120.29, null, null],
  statusDamage:         [120.29, 120.29, 120.29, 120.29, 120.29],
  weakpointDamage:      [300.71, 300.71, 300.71, 300.71, null],
  weakpointCrit:        [330.78, 330.78, 330.78, 330.78, null],
  heavyWindup:          [null, null, null, null, 159.98],
  meleeDamageOnHeavy:   [null, null, null, null, 159.98],
  parryAngle:           [null, null, null, null, 108.26],
  slamDamage:           [null, null, null, null, 159.98],
};

test('coefficients reproduce every positive ++- spreadsheet cell', () => {
  for (const [id, row] of Object.entries(SHEET_PP_MINUS_MIN)) {
    const stat = STAT_BY_ID[id];
    CLASSES.forEach((cls, i) => {
      const expected = row[i];
      if (expected === null) {
        assert.equal(stat.b[cls], undefined, `${id}/${cls} should not roll`);
        return;
      }
      const got = sheetMin(stat, cls);
      // 0.006 absorbs display rounding without hiding a mistyped coefficient.
      assert.ok(Math.abs(got - expected) < 0.006, `${id}/${cls}: got ${got.toFixed(4)}, sheet ${expected}`);
    });
  }
});
