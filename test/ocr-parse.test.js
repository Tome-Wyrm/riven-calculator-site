import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRivenText, matchStat, inferRank, guessClass } from '../src/ocr-parse.js';

// Text as OCR might return it for the screenshots in this project's history, with typical noise:
// icons read as stray characters, wrapped names, a misread letter or two.
const CASES = [
  ['Soma rank 8', '18 -\nSoma Visitio\n+267.2% Damage\n+138.7% / Electricity\n-31.7% Ammo Maximum\nMR 13',
    { weapon: 'Soma', rank: 8, stats: [['damage', '+267.2'], ['electricity', '+138.7'], ['ammoMax', '-31.7']] }],
  ['Lacera rank 0', '10\nLacera Acridex\n+14.4% Critical Damage\n+13.6% Status Chance\n-7.2% Finisher Damage\nMR 16',
    { weapon: 'Lacera', rank: 0, stats: [['critDamage', '+14.4'], ['statusChance', '+13.6'], ['finisher', '-7.2']] }],
  ['Vinquibus melee, wrapped name', '18 V\nVinquibus (melee)\nLacicak\n+129.7% X Puncture\n+73.7% Additional Combo\nCount Chance\nMR 15',
    { weapon: 'Vinquibus (melee)', rank: 8, stats: [['puncture', '+129.7'], ['additionalCombo', '+73.7']] }],
  ['Cinta bow, (x2 for Bows) wrapped', '18 V\nCinta Toxi-zetidra\n-85.7% Weapon Recoil\n+49.7% Fire Rate (x2 for\nBows)\n+87.1% & Toxin\nMR 16 ©3',
    { weapon: 'Cinta', rank: 8, stats: [['recoil', '-85.7'], ['fireRate', '+49.7'], ['toxin', '+87.1']] }],
  ['misreads', '18\nObex Visipha\n+264.5% Melee Darnage\n+135.9% & Heat\n—77.8% \\ lmpact\nMR 16',
    { weapon: 'Obex', rank: 8, stats: [['damage', '+264.5'], ['heat', '+135.9'], ['impact', '-77.8']] }],
  // Warframe companion app: phone status bar and app title above the card; faction shown as "+0".
  ['companion app', '5:04 93\n< Soma Deciata\n10 -\nSoma Deciata\n+25.6% Damage\n+17.2% Status Duration\n+0 Damage to Corpus\nMR 13 ©1',
    { weapon: 'Soma', rank: 0, stats: [['damage', '+25.6'], ['statusDuration', '+17.2'], ['corpus', '+0']] }],
];

for (const [name, text, want] of CASES) {
  test(`parses OCR text: ${name}`, () => {
    const r = parseRivenText(text);
    assert.equal(r.weapon?.name, want.weapon);
    assert.equal(r.rank, want.rank);
    assert.deepEqual(r.stats.map(s => [s.statId, s.value]), want.stats);
  });
}

test('matchStat copes with icons glued onto names and merged MR text', () => {
  assert.equal(matchStat('MW Heat'), 'heat');
  assert.equal(parseRivenText('Obex Visipha\n+264.5% Melee Damage\n-77.8% Mlmpact _MR16_ >)').stats[1].statId, 'impact');
});

test('inferRank finds the rank the values come from', () => {
  const soma = [{ statId: 'damage', value: '+267.2' }, { statId: 'electricity', value: '+138.7' }, { statId: 'ammoMax', value: '-31.7' }];
  assert.equal(inferRank(soma, 'rifle'), 8);
  const lacera0 = [{ statId: 'critDamage', value: '+14.4' }, { statId: 'statusChance', value: '+13.6' }, { statId: 'finisher', value: '-7.2' }];
  assert.equal(inferRank(lacera0, 'melee'), 0);
  // The companion-app Soma: faction value unread; only ++- (faction as the negative) fits.
  const phone = [{ statId: 'damage', value: '+25.6' }, { statId: 'statusDuration', value: '+17.2' }, { statId: 'corpus', value: '' }];
  assert.equal(inferRank(phone, 'rifle'), 0);
  // Lacera at rank 8 also fits rank 7: prefer a readable drain, else 8.
  const lacera8 = [{ statId: 'critDamage', value: '+129.3' }, { statId: 'statusChance', value: '+122.5' }, { statId: 'finisher', value: '-65.1' }];
  assert.equal(inferRank(lacera8, 'melee'), 8);
  assert.equal(inferRank(lacera8, 'melee', 7), 7);
  assert.equal(inferRank(lacera8, 'melee', 2), 8);   // a misread drain the values rule out
});

test('weapon names survive a stray space; class is guessed from stats when no weapon is read', () => {
  assert.equal(parseRivenText('10+\nL acera Acridex\n+14.4% Critical Damage').weapon?.name, 'Lacera');
  assert.equal(guessClass(['critDamage', 'statusChance', 'finisher']), 'melee');
  assert.equal(guessClass(['damage', 'zoom']), 'rifle');
});

test('matchStat rejects text that is not a stat', () => {
  assert.equal(matchStat('Visitio'), null);
  assert.equal(matchStat('MR'), null);
  assert.equal(matchStat('Damage to Grineer'), 'grineer');
  assert.equal(matchStat('Attack Speed'), 'fireRate');
});
