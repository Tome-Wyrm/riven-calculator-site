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
  for (const name of ['Sirocco', 'Arquebex']) assert.equal(byName.has(name), false, `${name} takes no riven`);
});
