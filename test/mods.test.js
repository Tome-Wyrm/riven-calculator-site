import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLine, readStats } from '../tools/lib/mod-text.mjs';
import { GUN_MODS } from '../src/data/mods.js';

const mod = (name, compat) => GUN_MODS.find(m => m.name === name && (!compat || m.compat === compat));
const value = (name, stat, compat) => mod(name, compat)?.effects.find(e => e.stat === stat)?.value;

test('plain stats, faction multipliers and colour tags', () => {
  assert.deepEqual(readLine('+165% Damage').effects, [{ stat: 'damage', value: 1.65 }]);
  assert.deepEqual(readLine('x1.55 Damage to Grineer').effects, [{ stat: 'grineer', value: 0.55 }]);
  assert.deepEqual(readLine('x1.3 Damage to the Murmur').effects, [{ stat: 'murmur', value: 0.3 }]);
  assert.deepEqual(readLine('+90% <DT_FIRE_COLOR>Heat').effects, [{ stat: 'heat', value: 0.9 }]);
  assert.deepEqual(readLine('-20% Fire Rate (x2 for Bows)').effects, [{ stat: 'fireRate', value: -0.2 }]);
  assert.deepEqual(readLine('+30% chance to apply <DT_SLASH_COLOR> on Critical').effects, [{ stat: 'slashOnCrit', value: 0.3 }]);
});

test('triggers: stacks, duration, aiming, per status type; both kinds of line break', () => {
  assert.deepEqual(readLine('On Kill:\r\n+40% Direct Damage per Status Type affecting the target for 20s. Stacks up to 2x.').effects,
    [{ stat: 'directDamage', value: 0.4, on: 'kill', seconds: 20, stacks: 2, per: 'status type' }]);
  assert.deepEqual(readLine('On Weak Point Hit:\\n+135% Critical Chance when Aiming for 9s').effects,
    [{ stat: 'critChance', value: 1.35, on: 'weak point hit', seconds: 9, aim: 1 }]);
  // Merciless: the trigger covers the stacking line; the reload line after it is plain (and listed twice).
  assert.deepEqual(readStats(['On Kill:\r\n+30% Damage for 4s. Stacks up to 12x.\r\n+30% Reload Speed', '+30% Reload Speed']).effects,
    [{ stat: 'damage', value: 0.3, on: 'kill', seconds: 4, stacks: 12 }, { stat: 'reloadSpeed', value: 0.3 }]);
  // Split Flights: the block's last line sets duration and stacks for the line above too.
  assert.deepEqual(readLine('On Hit:\\n+100% Multishot\\n-180% Accuracy for 2s. Stacks up to 4x.\\n(Non-AOE Bows)').effects[0],
    { stat: 'multishot', value: 1, on: 'hit', seconds: 2, stacks: 4 });
});

test('odd phrasings: two stats in one, a lock, invisibility', () => {
  assert.deepEqual(readLine('+60% Critical Chance and Damage when Aiming').effects,
    [{ stat: 'critChance', value: 0.6, aim: 1 }, { stat: 'critDamage', value: 0.6, aim: 1 }]);
  assert.deepEqual(readLine('+350% Weak Point Critical Chance. Multishot cannot be modified.').effects,
    [{ stat: 'weakpointCrit', value: 3.5 }, { stat: 'multishotLocked', value: 1 }]);
  assert.deepEqual(readLine('+330% Damage while Invisible').effects, [{ stat: 'damage', value: 3.3, on: 'invisible' }]);
  // Motus Setup (checked in game): no sign, two stats, the trigger after them.
  assert.deepEqual(readLine('100% Critical and Status Chance for 4s after landing from a Double or Bullet Jump.').effects, [
    { stat: 'critChance', value: 1, on: 'landing from a double or bullet jump', seconds: 4 },
    { stat: 'statusChance', value: 1, on: 'landing from a double or bullet jump', seconds: 4 }]);
  assert.deepEqual(readLine('During a Wall Latch gain +120% Status Chance and Critical Chance.').effects, [
    { stat: 'statusChance', value: 1.2, on: 'wall latch' }, { stat: 'critChance', value: 1.2, on: 'wall latch' }]);
  // What it can't read is kept, not dropped.
  assert.deepEqual(readLine('Reduces the chance an enemy will hear gunfire by 100%.').notes, ['Reduces the chance an enemy will hear gunfire by 100%.']);
});

test('the table: max-rank values as the game shows them (Underframe agrees)', () => {
  assert.equal(value('Serration', 'damage'), 1.65);
  assert.equal(value('Split Chamber', 'multishot'), 0.9);            // not the unreleased 10-rank copy (1.65)
  assert.equal(value('Point Strike', 'critChance'), 1.5);
  assert.equal(value('Vital Sense', 'critDamage'), 1.2);
  assert.equal(value('Hellfire', 'heat'), 0.9);
  assert.equal(value('Primed Bane Of Grineer', 'grineer'), 0.55);
  assert.equal(value('Primary Acuity', 'weakpointDamage'), 3.5);
  assert.equal(value('Hunter Munitions', 'slashOnCrit'), 0.3);
  const chamber = mod('Galvanized Chamber')?.effects.find(e => e.on === 'kill');
  assert.deepEqual(chamber, { stat: 'multishot', value: 0.3, on: 'kill', seconds: 20, stacks: 5 });
});

test('the table: unreleased entries are out; in-game confirmations are marked', () => {
  // Not in the game (checked 2026-11-02), though DE's export lists them.
  assert.equal(mod('Primed Blunderbuss'), undefined);
  assert.equal(mod('Primed Charged Chamber'), undefined);
  // Plain Cannonade (explosion chance) isn't in the game, though Underframe lists it; the three
  // Semi- Cannonades are.
  assert.equal(mod('Cannonade'), undefined);
  assert.ok(mod('Semi-Rifle Cannonade') && mod('Semi-Shotgun Cannonade') && mod('Semi-Pistol Cannonade'));
  assert.equal(mod('Tainted Mag')?.ingame, 1);
  assert.equal(mod('Charged Chamber')?.ingame, 1);
  assert.equal(mod('Serration')?.ingame, undefined);              // not checked in game: not marked
});

test('the table: one entry per mod, and mods that exclude each other', () => {
  const keys = GUN_MODS.map(m => `${m.name}|${m.compat}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(mod('Serration')?.excl?.includes('Amalgam Serration'));
  assert.ok(mod('Primed Bane Of Grineer')?.excl?.includes('Bane Of Grineer'));
  assert.ok(GUN_MODS.length > 250, String(GUN_MODS.length));
});
