import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRivenName, findPositivesInHeader, nameFitsStats, numberVariants, refineStats } from '../src/ocr-refine.js';

test('riven names decode to their positive stats (names from real screenshots)', () => {
  const cases = {
    Visitio: ['damage', 'electricity'],
    Acridex: ['critDamage', 'statusChance'],
    Lacicak: ['additionalCombo', 'puncture'],
    'Toxi-vexipha': ['toxin', 'electricity', 'heat'],
    'Hexa-gelicak': ['statusChance', 'cold', 'puncture'],
    'Plaga-acritor': ['statusDamage', 'critDamage', 'range'],
    'Acri-enidra': ['critDamage', 'weakpointDamage', 'fireRate'],
    Parcican: ['ammoEfficiency', 'multishot'],
    'Cori-ampinok': ['corrosive', 'ammoMax', 'punchThrough'],
    'Arma-zetitio': ['magazine', 'recoil', 'electricity'],
    'toxi zetidra': ['toxin', 'recoil', 'fireRate'],   // OCR dropped the hyphen
  };
  for (const [name, ids] of Object.entries(cases)) assert.deepEqual(decodeRivenName(name), ids, name);
  assert.equal(decodeRivenName('Soma'), null);
  assert.equal(decodeRivenName('Visitiox'), null);
});

test('the name is found at the end of a messy header, even split across lines', () => {
  assert.deepEqual(findPositivesInHeader(['18 -', 'Soma Visitio )']), ['damage', 'electricity']);
  assert.deepEqual(findPositivesInHeader(['pu Titr', 'on Plaga-', 'acritor']), ['statusDamage', 'critDamage', 'range']);
});

test('numberVariants offers look-alike digits, dropped junk digits and a restored decimal point', () => {
  const texts = numberVariants('214109.7').map(v => v.text);
  assert.ok(texts.includes('109.7'));
  assert.ok(numberVariants('1077').map(v => v.text).includes('107.7'));
  assert.ok(numberVariants('129.8').map(v => v.text).includes('129.3'));
});

test('refineStats: lost minus sign restored from the name (Arca Titron)', () => {
  const stats = [
    { statId: 'critDamage', value: '+108.6', text: '' }, { statId: 'statusDamage', value: '+109.8', text: '' },
    { statId: 'range', value: '+2.1', text: '' }, { statId: 'finisher', value: '', magnitude: '102.7', text: '' },
  ];
  const r = refineStats(stats, 'melee', ['statusDamage', 'critDamage', 'range'], null);
  assert.deepEqual(r.stats.map(s => [s.statId, s.value]),
    [['critDamage', '+108.6'], ['statusDamage', '+109.8'], ['range', '+2.1'], ['finisher', '-102.7']]);
  assert.equal(r.rank, 8);
});

test('refineStats: a lock icon read as digits is trimmed to the value that fits (Laetum)', () => {
  const stats = [
    { statId: 'multishot', value: '+123.4', text: '' }, { statId: 'statusDamage', value: '', magnitude: '214109.7', text: '' },
    { statId: 'projectileSpeed', value: '+96.6', text: '' }, { statId: 'critChance', value: '-146', text: '' },
  ];
  const r = refineStats(stats, 'pistol', ['statusDamage', 'multishot', 'projectileSpeed'], null);
  assert.equal(r.stats[1].value, '+109.7');
});

test("refineStats: an old out-of-range value doesn't drag the rank (Akarius from before dispositions changed)", () => {
  const r = refineStats([{ statId: 'toxin', value: '+96.2', text: '' }, { statId: 'electricity', value: '+92.3', text: '' },
    { statId: 'heat', value: '+80.2', text: '' }, { statId: 'zoom', value: '-66', text: '' }],
  'pistol', ['toxin', 'electricity', 'heat'], 8);
  assert.equal(r.rank, 8);
  assert.equal(r.stats[2].value, '+80.2');
  assert.match(r.notes.join(), /Heat/);
});

test('refineStats: a misread digit is corrected, a garbled name recovered', () => {
  // Lacera rank 8: "129.3" misread as "129.8" is still in range, so left alone; "6" for "5" is not.
  const stats = [
    { statId: 'critDamage', value: '+129.3', text: '' }, { statId: null, value: '+122.5', text: 'Stxtus Chxnce' },
    { statId: 'finisher', value: '-65.1', text: '' },
  ];
  const r = refineStats(stats, 'melee', ['critDamage', 'statusChance'], 8);
  assert.deepEqual(r.stats.map(s => s.statId), ['critDamage', 'statusChance', 'finisher']);
  // Soma: "267.2" read as "207.2" (6 → 0) is out of range; only 267.2 fits with one change.
  const soma = (v) => refineStats([{ statId: 'damage', value: v, text: '' }, { statId: 'electricity', value: '+138.7', text: '' },
    { statId: 'ammoMax', value: '-31.7', text: '' }], 'rifle', ['damage', 'electricity'], 8);
  assert.equal(soma('+207.2').stats[0].value, '+267.2');
  // "287.2" could be 267.2 or 237.2: left as read, with both offered.
  const amb = soma('+287.2');
  assert.equal(amb.stats[0].value, '+287.2');
  assert.match(amb.notes.join(), /\+267\.2.*\+237\.2|\+237\.2.*\+267\.2/);
});

test('a partly hidden name that decodes to too few positives is not trusted', () => {
  // "Phantasma P?ci-toxican" (cursor over "Parci"): "toxican" decodes, but 4 stats need 3 positives
  assert.deepEqual(decodeRivenName('toxican'), ['toxin', 'multishot']);
  assert.equal(nameFitsStats(['toxin', 'multishot'], 4), false);
  assert.equal(nameFitsStats(['ammoEfficiency', 'toxin', 'multishot'], 4), true);
  assert.equal(nameFitsStats(['toxin', 'multishot'], 3), true);
});
