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
  // Phantasma (shotgun) riven with the weapon name unread: +99.4% Multishot only fits a shotgun.
  assert.equal(guessClass([{ statId: 'toxin', value: '+74.9' }, { statId: 'multishot', value: '+99.4' },
    { statId: 'ammoEfficiency', value: '+42.6' }, { statId: 'puncture', value: '-85.1' }]), 'shotgun');
});

test('fixes O-for-0, stray spaces and unsigned lines (from real screenshots)', () => {
  // Phone photo of a monitor: "x0.58" read as "XO. 58"
  assert.deepEqual(parseRivenText('Akarius Toxi-satido\n+111.2% & Toxin\n+145% Multishot\n+98.2% Cold\nXO. 58 Damage to Grineerg\nMR 11')
    .stats.map(s => [s.statId, s.value]), [['toxin', '+111.2'], ['multishot', '+145'], ['cold', '+98.2'], ['grineer', 'x0.58']]);
  // Four junk characters before the value
  assert.equal(parseRivenText('Cortege Plaga-\n+112.3% Critical Chance\n7%. X0.59 Damage to Infestedg\nMR 10').stats[1].value, 'x0.59');
  // Lost minus sign, and a lock icon read as digits: their own stats, values left blank
  assert.deepEqual(parseRivenText('Arca Titron\n+108.6% Critical Damage\n0 +109.8% Status\nDamage\n+2.1 Range\n102.7% Finisher Damage\nMR12')
    .stats.map(s => [s.statId, s.value]), [['critDamage', '+108.6'], ['statusDamage', '+109.8'], ['range', '+2.1'], ['finisher', '']]);
  assert.deepEqual(parseRivenText('Laetum Plaga-\nconcican\n+123.4% Multishot\n214109.7% Status Damage\n+96.6% Projectile Speed\n-146% Critical Chance\nMR 13')
    .stats.map(s => [s.statId, s.value]), [['multishot', '+123.4'], ['statusDamage', ''], ['projectileSpeed', '+96.6'], ['critChance', '-146']]);
});

test('matchStat rejects text that is not a stat', () => {
  assert.equal(matchStat('Visitio'), null);
  assert.equal(matchStat('MR'), null);
  assert.equal(matchStat('Damage to Grineer'), 'grineer');
  assert.equal(matchStat('Attack Speed'), 'fireRate');
});

test('garbled or wrapped weapon names are matched fuzzily, among classes the values fit (Phantasma)', () => {
  const stats = '+74.9% Toxin\n+99 4% Multishot\n+42.6% Ammo Efficiency\n-85.1% Puncture\nR15';
  const a = parseRivenText(`TA 4\nPhiitaem\na Parci-\ntoxican\n${stats}`);
  assert.equal(a.weapon?.name, 'Phantasma');
  assert.equal(a.stats[1].value, '+99.4');
  assert.equal(parseRivenText(`~\nPhant\nAsma\nai\ntoxican ©\n${stats}`).weapon?.name, 'Phantasma');
  // "Arca" read as "pu" is too far gone: no weapon rather than a wrong one (Acrid from "acritor", Detron from "titron").
  assert.equal(parseRivenText('pu Titr\non Plaga-\nacritor\n+108.6% Critical Damage\n+109.8% Status Damage\n+2.1 Range\nMR12').weapon, null);
  assert.equal(parseRivenText('Zzqxw\n+108.6% Critical Damage\nMR12').weapon, null);
});

test('a padlock read as "0" before the sign marks the stat locked (Sobek, Glaxion)', () => {
  const r = parseRivenText('Sobek Plaga-\nhexacan\n+101.6% Status Chance\n0 +103.6% Status\nDamage\n0 +128.5% Multishot\nw&.-87.3% Ammo Maximum\nMR 16');
  assert.deepEqual(r.stats.map(s => [s.statId, !!s.locked]),
    [['statusChance', false], ['statusDamage', true], ['multishot', true], ['ammoMax', false]]);
  const g = parseRivenText('Glaxion Cori-ignitox\n+93.7% ® Heat\n0+106.2% & Corrosive\n+93.5% 2 Toxin\n0 -58.4% Zoom\nMR 13');
  assert.deepEqual(g.stats.map(s => !!s.locked), [false, true, false, true]);
});
