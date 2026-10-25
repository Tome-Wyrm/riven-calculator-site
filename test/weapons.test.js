import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../src/data/weapons.js';
import { CLASSES } from '../src/data/stats.js';

const byName = new Map(WEAPONS.map(w => [w[0], w]));

test('every weapon has a known riven class and a unique name', () => {
  assert.ok(WEAPONS.length > 500);
  assert.equal(byName.size, WEAPONS.length);
  for (const [name, cls] of WEAPONS) assert.ok(CLASSES.includes(cls), name);
});

test('known weapons map to the right class', () => {
  const expect = {
    Felarx: 'shotgun', Soma: 'rifle', Lacera: 'melee', Obex: 'melee', Imperator: 'archgun',
    'Catchmoon (Kitgun)': 'pistol', 'Balla (Zaw)': 'melee', Vinquibus: 'rifle', 'Vinquibus (melee)': 'melee',
    'Corufell Prime': 'melee', Vulklok: 'rifle', Sweeper: 'shotgun', 'Deconstructor Prime': 'melee', 'Prisma Burst Laser': 'pistol',
    'MK1-Braton': 'rifle',
  };
  for (const [name, cls] of Object.entries(expect)) assert.equal(byName.get(name)?.[1], cls, name);
  assert.equal(byName.get('Paris')?.[2], 1, 'Paris is a bow');
  // IPS eligibility: rivens seen in game (screenshots, player data) beat everything.
  const proven = { Obex: 0, Cinta: 1, Vinquibus: 1, 'Vinquibus (melee)': 1, Exergis: 1 };
  for (const [name, i] of Object.entries(proven)) assert.equal(byName.get(name)?.[3][i], 'y', `${name} IPS`);
  // Soma Impact: the rule says no and a full warframe.market search agrees.
  assert.equal(byName.get('Soma')?.[3][0], 'n');
  // The community sheet beats the damage rule: Lacera Slash (rule yes, sheet no, and a 48-cycle
  // log never rolled it); Akarius Puncture (rule no, listings said maybe, sheet no).
  assert.equal(byName.get('Lacera')?.[3][2], 'n');
  assert.equal(byName.get('Akarius')?.[3][1], 'n');
  for (const [name, , , code] of WEAPONS) assert.match(code, /^[yn?v]{3}([ynv?]{5})?$/, name);
  // Vintage (community sheet): Stinger's Zoom only on older rivens, Sobek's Projectile Speed too.
  assert.equal(byName.get('Stinger')?.[3][3], 'v');
  assert.equal(byName.get('Sobek')?.[3][7], 'v');
  for (const name of ['Sirocco', 'Arquebex']) assert.equal(byName.has(name), false, `${name} takes no riven`);
});
