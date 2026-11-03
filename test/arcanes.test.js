import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUN_ARCANES } from '../src/data/arcanes.js';

const arcane = name => GUN_ARCANES.find(a => a.name === name);

test('max-rank arcanes (Underframe agrees)', () => {
  assert.deepEqual(arcane('Primary Merciless')?.effects, [
    { stat: 'damage', value: 0.3, on: 'kill', seconds: 4, stacks: 12 }, { stat: 'reloadSpeed', value: 0.3 }]);
  assert.deepEqual(arcane('Primary Deadhead')?.effects, [
    { stat: 'damage', value: 1.2, on: 'headshot kill', seconds: 24, stacks: 3 },
    { stat: 'headshotMultiplier', value: 0.3 }, { stat: 'recoil', value: -0.5 }]);
  assert.deepEqual(arcane('Arcane Avenger')?.effects, [{ stat: 'critChance', value: 0.45, on: 'damaged', seconds: 12, chance: 0.21 }]);
  assert.equal(arcane('Arcane Rage')?.effects[0].to, 'primary');
  assert.equal(arcane('Secondary Merciless')?.slot, 'secondary');
});

test('special arcanes are kept as notes, not dropped', () => {
  assert.deepEqual(arcane('Secondary Encumber')?.effects, []);
  assert.ok(arcane('Secondary Encumber')?.notes?.[0].includes('second random Status Effect'));
});
