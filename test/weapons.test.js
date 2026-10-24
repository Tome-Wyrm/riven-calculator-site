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
  // IPS eligibility: what our own rivens and screenshots proved can roll must never be ruled out.
  const proven = { Obex: 0, Cinta: 1, Vinquibus: 1, 'Vinquibus (melee)': 1, Exergis: 1, Akarius: 1 };
  for (const [name, i] of Object.entries(proven)) assert.equal(byName.get(name)?.[3][i], 'y', `${name} IPS`);
  // Soma: thoroughly traded, and a full warframe.market search found no Impact riven.
  assert.equal(byName.get('Soma')?.[3][0], 'n');
  for (const [name, , , code] of WEAPONS) assert.match(code, /^[yn?]{3}$/, name);
  for (const name of ['Sirocco', 'Arquebex']) assert.equal(byName.has(name), false, `${name} takes no riven`);
});
