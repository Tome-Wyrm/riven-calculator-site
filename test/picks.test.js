import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlot, parseRow, picksFor, pickFamily, forWeapon, topRoll, toTarget, communityFit, brozimePick } from '../src/picks.js';
import { BROZIME_PICKS } from '../src/data/brozime-picks.js';
import { STAT_BY_ID } from '../src/data/stats.js';
import { PICKS } from '../src/data/picks.js';
import { WEAPONS } from '../src/data/weapons.js';
import { pools } from '../src/cycle.js';

const ids = slot => slot.map(tier => tier.map(p => p.stat));

test('priority tiers (>) of equal picks (/)', () => {
  assert.deepEqual(ids(parseSlot('COR / VIR > TOX / FR / DMG / CC', 'shotgun')),
    [['corrosive', 'viral'], ['toxin', 'fireRate', 'damage', 'critChance']]);
});

test('notes and footnote stars: Felarx -CC*, Lacera ELEC(infl), Rumblejack PUNC(0%)', () => {
  const [cc] = parseSlot('CC* > PUNC', 'shotgun')[0];
  assert.deepEqual(cc, { code: 'CC', stat: 'critChance', note: '', mark: '*' });
  const elec = parseSlot('CD > ELEC(infl)', 'melee')[1][0];
  assert.equal(elec.stat, 'electricity');
  assert.equal(elec.note, 'infl');
  const punc = parseSlot('IMP > PUNC(0%) / SL(0%) > SLIDE / EFF / FIN', 'melee')[1];
  assert.deepEqual(punc.map(p => [p.stat, p.note]), [['puncture', '0%'], ['slash', '0%']]);
  const amm = parseSlot('Z > MC(inc) / REC / AMMO(inc)', 'rifle')[1];
  assert.deepEqual(amm.map(p => [p.stat, p.note]), [['magazine', 'inc'], ['recoil', ''], ['ammoMax', 'inc']]);
});

test('EFF is Ammo Efficiency on guns and Heavy Attack Efficiency on melee; AS and FR are one stat', () => {
  assert.equal(parseSlot('EFF', 'shotgun')[0][0].stat, 'ammoEfficiency');
  assert.equal(parseSlot('EFF', 'melee')[0][0].stat, 'heavyEfficiency');
  assert.equal(parseSlot('AS', 'melee')[0][0].stat, 'fireRate');
});

test('odd cells: a slash inside brackets, codes run together, ANY / NONE', () => {
  assert.deepEqual(parseSlot('ANY (not AS/CCC)', 'melee'), [[{ code: 'ANY', stat: 'any', note: 'not AS/CCC', mark: '' }]]);
  assert.deepEqual(ids(parseSlot('PUNC > IMP Z > REC', 'rifle')), [['puncture'], ['impact', 'zoom'], ['recoil']]);
  assert.deepEqual(ids(parseSlot('IC / NONE', 'melee')), [['initialCombo', 'none']]);
  assert.deepEqual(parseSlot('', 'rifle'), []);
});

test('every code in the sheet is known', () => {
  for (const [family, rows] of Object.entries(PICKS)) {
    for (const cells of rows) {
      const row = parseRow(cells, family.endsWith('(melee)') ? 'melee' : 'rifle');
      for (const p of [...row.positives, row.negatives].flat(2)) assert.ok(p.stat, `${family}: ${p.code}`);
    }
  }
});

test('weapons find their family: variants, Kuva weapons, the Vinquibus split', () => {
  assert.equal(pickFamily('Braton Prime'), 'Braton');
  assert.equal(pickFamily('Kuva Bramma'), 'Kuva Bramma');
  assert.equal(picksFor('Vinquibus (melee)', 'melee')[0].positives[0][0][0].stat, 'fireRate');
  assert.equal(picksFor('Vinquibus', 'rifle')[0].positives[0][0][0].stat, 'multishot');
  // Nearly every weapon is covered.
  const covered = WEAPONS.filter(w => pickFamily(w[0])).length;
  assert.ok(covered >= WEAPONS.length - 3, `${covered} of ${WEAPONS.length}`);
});

test('a variant note is for that variant only', () => {
  const [imp, punc] = parseSlot('IMP(Vandal) / PUNC(Prime) > Z > REC', 'rifle')[0];
  assert.ok(forWeapon(imp, 'Braton Vandal'));
  assert.ok(!forWeapon(imp, 'Braton Prime'));
  assert.ok(forWeapon(punc, 'Braton Prime'));
  assert.ok(forWeapon(parseSlot('AMMO(Inc)', 'rifle')[0][0], 'Braton'));
});

test('the top roll: Felarx MS / Viral / Toxin, -Crit Chance', () => {
  const [row] = picksFor('Felarx', 'shotgun');
  const pool = pools('shotgun', WEAPONS.find(w => w[0] === 'Felarx')?.[3]);
  const top = topRoll(row, pool, 'shotgun', 'Felarx');
  assert.deepEqual(top, { positives: ['multishot', 'viral', 'toxin'], negative: 'critChance' });
  assert.deepEqual(toTarget(top.positives, top.negative),
    { positives: ['multishot', 'toxin'], spliced: 'viral', negative: 'critChance' });
});

test('the top roll skips taken stats and a second spliced stat (Acceltra: COR, then CC not COR)', () => {
  const [row] = picksFor('Acceltra', 'rifle');
  const top = topRoll(row, pools('rifle', 'ynn'), 'rifle', 'Acceltra');
  assert.deepEqual(top.positives, ['multishot', 'corrosive', 'critChance']);
  // Impact is the first negative, and Acceltra rolls it (ynn).
  assert.equal(top.negative, 'impact');
});

test("the grader's community view: top pick, listed, splice parent, not listed", () => {
  const rows = picksFor('Felarx', 'shotgun');
  assert.equal(communityFit(rows, 'multishot', false, 'Felarx')?.fit, 'top');
  // Fire Rate is a first choice in roll 1's third slot; Crit Chance (positive) only after Corrosive / Viral in roll 2's.
  assert.equal(communityFit(rows, 'fireRate', false, 'Felarx')?.fit, 'top');
  assert.equal(communityFit(rows, 'critChance', false, 'Felarx')?.fit, 'listed');
  assert.equal(communityFit(rows, 'critChance', true, 'Felarx')?.fit, 'top');
  // Cold isn't listed, but splices into Viral (with Toxin), which is.
  const cold = communityFit(rows, 'cold', false, 'Felarx');
  assert.deepEqual([cold?.fit, cold?.pick.stat], ['parent', 'viral']);
  assert.equal(communityFit(rows, 'zoom', false, 'Felarx'), null);
});

test("a negative the weapon can't roll is skipped", () => {
  const row = parseRow(['MS', 'CD', 'CC', 'PUNC > Z', ''], 'rifle');
  assert.equal(topRoll(row, pools('rifle', 'ynn'), 'rifle', 'X').negative, 'zoom');
});

test("Brozime's roll: his weapon or one sharing its riven, the splice first, harmless negatives left open", () => {
  const acc = brozimePick('Acceltra');
  assert.equal(acc?.weapon, 'Acceltra Prime');
  assert.deepEqual([acc?.splice, acc?.harmless, acc?.page], [true, true, 'Rifle']);
  assert.deepEqual(acc?.row.positives.map(ids), [[['ammoEfficiency']], [['multishot']]]);
  assert.deepEqual(acc?.row.negatives, []);
  // "Critical Damage/Chance" is either; Phenmor names its negative.
  assert.deepEqual(ids(brozimePick('Kuva Grattler')?.row.positives[1] ?? []), [['critDamage', 'critChance']]);
  assert.deepEqual(ids(brozimePick('Phenmor')?.row.negatives ?? []), [['critChance']]);
  assert.equal(brozimePick('Tenet Glaxion')?.row.notes.length, 2);
  assert.equal(brozimePick('Braton'), null);
});

test("Brozime's picks: known weapons and stats, a spliced stat first exactly where he splices", () => {
  for (const [weapon, b] of Object.entries(BROZIME_PICKS)) {
    assert.ok(WEAPONS.some(w => w[0] === weapon), weapon);
    for (const id of [...b.positives.flat(), ...(b.negative ? [b.negative] : [])]) assert.ok(STAT_BY_ID[id], `${weapon}: ${id}`);
    assert.equal(!!STAT_BY_ID[b.positives[0][0]].spliced, b.splice, weapon);
  }
});
