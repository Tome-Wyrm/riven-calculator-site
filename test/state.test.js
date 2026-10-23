import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, updateHash, pick, oneOf, num } from '../src/ui/state.js';

test('each view reads only its own prefix', () => {
  const hash = '#r.cls=melee&g.weapon=Felarx&g.t=70';
  assert.deepEqual(parseHash(hash, 'r'), { cls: 'melee' });
  assert.deepEqual(parseHash(hash, 'g'), { weapon: 'Felarx', t: '70' });
});

test('updating one view keeps the other and round-trips special characters', () => {
  const hash = updateHash('r.cls=melee&g.t=1', 'g', { weapon: 'Argo & Vel', op: 'gte', t: 70, stat: '' });
  assert.deepEqual(parseHash(hash, 'r'), { cls: 'melee' });
  assert.deepEqual(parseHash(hash, 'g'), { weapon: 'Argo & Vel', op: 'gte', t: '70' });
});

test('pick drops invalid values', () => {
  const rules = { op: oneOf(['gte', 'lte', 'near']), t: num(), rank: num(0, 8) };
  assert.deepEqual(pick({ op: 'gte', t: '70', rank: '3' }, rules), { op: 'gte', t: 70, rank: 3 });
  assert.deepEqual(pick({ op: 'bogus', t: 'abc', rank: '12' }, rules), {});
});
