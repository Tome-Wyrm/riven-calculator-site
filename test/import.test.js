import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapInventory, readInventoryFile, extractRivens, TAG_TO_STAT } from '../src/import.js';
import { STAT_BY_ID } from '../src/data/stats.js';
import { displayValue, format, shapeFor } from '../src/engine.js';

// Entries from the player data pasted in this project's history (fingerprints verified in game).
const fp = obj => JSON.stringify(obj);
const UPGRADES = [
  { ItemType: '/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare', ItemId: { $oid: 'soma' },
    UpgradeFingerprint: fp({ compat: '/Lotus/Weapons/Tenno/Rifle/TennoAR', lvlReq: 13, buffs: [
      { Tag: 'WeaponDamageAmountMod', Value: 1023126307 }, { Tag: 'WeaponElectricityDamageMod', Value: 741268739 }],
      curses: [{ Tag: 'WeaponAmmoMaxMod', Value: 910199365 }] }) },
  { ItemType: '/Lotus/Upgrades/Mods/Randomized/PlayerMeleeWeaponRandomModRare', ItemId: { $oid: 'obex' },
    UpgradeFingerprint: fp({ compat: '/Lotus/Weapons/Corpus/Melee/KickAndPunch/KickPunchWeapon', lvlReq: 16, buffs: [
      { Tag: 'WeaponMeleeDamageMod', Value: 973737259 }, { Tag: 'WeaponFireDamageMod', Value: 625524962 }],
      curses: [{ Tag: 'WeaponImpactDamageMod', Value: 1046153858 }] }) },
  { ItemType: '/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare', ItemId: { $oid: 'bow' },
    UpgradeFingerprint: fp({ compat: '/Lotus/Weapons/Grineer/Bows/GrnBow/GrnBowWeapon', rerolls: 1, buffs: [
      { Tag: 'WeaponStunChanceMod', Value: 662069165 }, { Tag: 'WeaponFireIterationsMod', Value: 221099891 },
      { Tag: 'WeaponClipMaxMod', Value: 493595040 }], curses: [{ Tag: 'WeaponCritChanceMod', Value: 1011786189 }] }),
    PendingRerollFingerprint: fp({ compat: '/Lotus/Weapons/Grineer/Bows/GrnBow/GrnBowWeapon', buffs: [
      { Tag: 'WeaponClipMaxMod', Value: 813320787 }, { Tag: 'WeaponRecoilReductionMod', Value: 749849365 }],
      curses: [{ Tag: 'WeaponReloadSpeedMod', Value: 512600595 }] }) },
  { ItemType: '/Lotus/Upgrades/Mods/Randomized/LotusModularPistolRandomModRare', ItemId: { $oid: 'kit' },
    UpgradeFingerprint: fp({ compat: '/Lotus/Weapons/Infested/Pistols/InfKitGun/Barrels/InfBarrelEgg/InfModularBarrelEggPart',
      buffs: [{ Tag: 'WeaponClipMaxMod', Value: 122950073 }, { Tag: 'WeaponAmmoMaxMod', Value: 587103112 }] }) },
  { ItemType: '/Lotus/Upgrades/Mods/Randomized/RawRifleRandomMod', ItemId: { $oid: 'veiled' },
    UpgradeFingerprint: fp({ challenge: { Type: 'x' } }) },
  { ItemType: '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod', ItemId: { $oid: 'serration' } },
];
const INVENTORY = { Upgrades: UPGRADES, Suits: [] };

test('every fingerprint tag maps to a real stat', () => {
  for (const [tag, id] of Object.entries(TAG_TO_STAT)) assert.ok(STAT_BY_ID[id], `${tag} -> ${id}`);
});

test('unwrapInventory finds the inventory inside envelopes and JSON-in-JSON', () => {
  assert.equal(unwrapInventory(INVENTORY), INVENTORY);
  assert.deepEqual(unwrapInventory({ payload: { InventoryJson: JSON.stringify(INVENTORY) } }), INVENTORY);
  assert.equal(unwrapInventory({ nothing: 1 }), null);
});

test('extractRivens reads weapons, classes, stats and pending cycles', () => {
  const { rivens, veiled } = extractRivens(INVENTORY);
  assert.equal(veiled, 1);
  assert.deepEqual(rivens.map(r => [r.weapon, r.cls]),
    [['Soma', 'rifle'], ['Obex', 'melee'], ['Kuva Bramma', 'rifle'], ['Sporelacer (Kitgun)', 'pistol']]);
  const soma = rivens[0];
  assert.equal(soma.mr, 13);
  assert.equal(shapeFor(2, 1), '++-');
  // The imported rolls reproduce the in-game text at rank 8.
  const text = soma.stats.map(s => format(STAT_BY_ID[s.statId], displayValue(STAT_BY_ID[s.statId], 'rifle', '++-', s.sign, s.u)));
  assert.deepEqual(text, ['+267.2%', '+138.7%', '-31.7%']);
  assert.equal(rivens[2].rerolls, 1);
  assert.deepEqual(rivens[2].pending?.map(s => s.statId), ['magazine', 'recoil', 'reloadSpeed']);
});

test('readInventoryFile reads plain JSON and AlecaFrame-encrypted files', async () => {
  const json = new TextEncoder().encode(JSON.stringify({ data: INVENTORY }));
  assert.deepEqual(await readInventoryFile(json.buffer), INVENTORY);

  // Encrypt the same way AlecaFrame does, then read it back.
  const key = await crypto.subtle.importKey('raw',
    new Uint8Array([76, 69, 79, 45, 65, 76, 69, 67, 9, 69, 79, 45, 65, 76, 69, 67]), 'AES-CBC', false, ['encrypt']);
  const iv = new Uint8Array([49, 50, 70, 71, 66, 51, 54, 45, 76, 69, 51, 45, 113, 61, 57, 0]);
  const enc = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new TextEncoder().encode(JSON.stringify(INVENTORY)));
  assert.deepEqual(await readInventoryFile(enc), INVENTORY);

  await assert.rejects(readInventoryFile(new TextEncoder().encode('not an inventory').buffer));
});
