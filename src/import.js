// @ts-check
// Reads rivens out of a Warframe inventory: the game's inventory JSON (as exported by WFHelper or
// warframe-api-helper, possibly wrapped in an envelope) or AlecaFrame's encrypted cache file
// (lastData.dat). Pure functions, no DOM; runs in the browser and in Node, and nothing leaves the
// machine. Envelope handling and AlecaFrame's key follow WFHelper (config/shared/inventoryPayload.ts,
// services/alecaFrameInventory.ts).

import { WEAPON_BY_PATH } from './data/paths.js';
import { WEAPONS } from './data/weapons.js';
import { fingerprintToU } from './engine.js';

/** @typedef {import('./data/stats.js').WeaponClass} WeaponClass */

/** Fingerprint tag → stat id. From WFHelper's config/shared/rivenStatDisplayNames.ts. */
export const TAG_TO_STAT = {
  WeaponCritChanceMod: 'critChance',
  WeaponCritDamageMod: 'critDamage',
  WeaponFireIterationsMod: 'multishot',
  WeaponFireRateMod: 'fireRate',
  WeaponDamageAmountMod: 'damage',
  WeaponMeleeDamageMod: 'damage',
  WeaponReloadSpeedMod: 'reloadSpeed',
  WeaponStunChanceMod: 'statusChance',
  WeaponProcTimeMod: 'statusDuration',
  WeaponPunctureDepthMod: 'punchThrough',
  WeaponClipMaxMod: 'magazine',
  WeaponAmmoMaxMod: 'ammoMax',
  WeaponRecoilReductionMod: 'recoil',
  WeaponZoomFovMod: 'zoom',
  WeaponProjectileSpeedMod: 'projectileSpeed',
  WeaponImpactDamageMod: 'impact',
  WeaponArmorPiercingDamageMod: 'puncture',
  WeaponSlashDamageMod: 'slash',
  WeaponFreezeDamageMod: 'cold',
  WeaponFireDamageMod: 'heat',
  WeaponElectricityDamageMod: 'electricity',
  WeaponToxinDamageMod: 'toxin',
  WeaponFactionDamageGrineer: 'grineer',
  WeaponFactionDamageCorpus: 'corpus',
  WeaponFactionDamageInfested: 'infested',
  WeaponMeleeRangeIncMod: 'range',
  ComboDurationMod: 'comboDuration',
  SlideAttackCritChanceMod: 'slideCrit',
  WeaponMeleeFinisherDamageMod: 'finisher',
  WeaponMeleeComboEfficiencyMod: 'heavyEfficiency',
  WeaponMeleeComboInitialBonusMod: 'initialCombo',
  WeaponMeleeComboPointsOnHitMod: 'chanceToGainCombo',
  WeaponMeleeComboBonusOnHitMod: 'additionalCombo',
};

/** Riven item type → class, for weapons the path map doesn't know. */
const TYPE_CLASS = /** @type {[RegExp, WeaponClass][]} */ ([
  [/LotusShotgunRandomMod/, 'shotgun'],
  [/LotusModularPistolRandomMod|LotusPistolRandomMod/, 'pistol'],
  [/LotusArchgunRandomMod/, 'archgun'],
  [/MeleeWeaponRandomMod|LotusModularMeleeRandomMod/, 'melee'],
  [/LotusRifleRandomMod/, 'rifle'],
]);

const ENVELOPE_KEYS = ['InventoryJson', 'inventoryJson', 'inventory_json', 'payload', 'data'];
const INVENTORY_KEYS = ['Suits', 'RawUpgrades', 'Upgrades', 'Arcanes', 'LevelKeys', 'MiscItems'];

/** @param {any} v */
const isInventory = v => !!v && typeof v === 'object' && INVENTORY_KEYS.some(k => Array.isArray(v[k]));

/**
 * Finds the inventory inside whatever wraps it (an object envelope, or JSON text inside JSON).
 * @param {unknown} value @returns {any | null}
 */
export function unwrapInventory(value) {
  let cur = /** @type {any} */ (value);
  for (let depth = 0; depth < 8; depth++) {
    if (typeof cur === 'string') {
      try { cur = JSON.parse(cur); } catch { return null; }
      continue;
    }
    if (isInventory(cur)) return cur;
    if (!cur || typeof cur !== 'object') return null;
    const next = ENVELOPE_KEYS.map(k => cur[k]).find(v => v !== undefined);
    if (next === undefined) return null;
    cur = next;
  }
  return null;
}

// AlecaFrame encrypts its cache with AES-128-CBC under a fixed key and IV (from WFHelper).
const ALECA_KEY = new Uint8Array([76, 69, 79, 45, 65, 76, 69, 67, 9, 69, 79, 45, 65, 76, 69, 67]);
const ALECA_IV = new Uint8Array([49, 50, 70, 71, 66, 51, 54, 45, 76, 69, 51, 45, 113, 61, 57, 0]);

/**
 * Decrypts AlecaFrame's lastData.dat to its JSON text.
 * @param {ArrayBuffer | Uint8Array} bytes
 */
export async function decryptAlecaFrame(bytes) {
  const key = await crypto.subtle.importKey('raw', ALECA_KEY, 'AES-CBC', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ALECA_IV }, key, bytes);
  return new TextDecoder().decode(plain);
}

/**
 * Reads an inventory from file bytes: plain JSON first, then AlecaFrame's encrypted format.
 * @param {ArrayBuffer} bytes @returns {Promise<any>} the inventory object
 */
export async function readInventoryFile(bytes) {
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
  if (/^\s*[[{"]/.test(text)) {
    const inv = unwrapInventory(text);
    if (inv) return inv;
  }
  let decrypted;
  try {
    decrypted = await decryptAlecaFrame(bytes);
  } catch {
    throw new Error("Couldn't read that file: it isn't inventory JSON or an AlecaFrame lastData.dat.");
  }
  const inv = unwrapInventory(decrypted);
  if (!inv) throw new Error('That AlecaFrame file decrypted, but no inventory was found inside it.');
  return inv;
}

/**
 * @typedef {object} ImportedStat
 * @property {string} tag
 * @property {string | null} statId   null for a tag this site doesn't know (e.g. a new spliced stat)
 * @property {'+' | '-'} sign
 * @property {number} u
 *
 * @typedef {object} ImportedRiven
 * @property {string} id
 * @property {string} weapon        weapon name, or the internal path when unknown
 * @property {boolean} knownWeapon
 * @property {WeaponClass | null} cls
 * @property {number} rank          mod rank (0–8)
 * @property {number | null} mr
 * @property {number} rerolls
 * @property {ImportedStat[]} stats
 * @property {ImportedStat[] | null} pending   an unaccepted cycle, if any
 */

const CLASS_BY_WEAPON = new Map(WEAPONS.map(w => [w[0], w[1]]));

/** @param {any} fp @returns {ImportedStat[]} */
function statsOf(fp) {
  /** @param {any[]} list @param {'+' | '-'} sign */
  const read = (list, sign) => (Array.isArray(list) ? list : []).map(b => ({
    tag: String(b.Tag),
    statId: TAG_TO_STAT[/** @type {keyof typeof TAG_TO_STAT} */ (b.Tag)] ?? null,
    sign,
    u: fingerprintToU(Number(b.Value)),
  }));
  return [...read(fp.buffs, '+'), ...read(fp.curses, '-')];
}

/** @param {unknown} s */
function parseFingerprint(s) {
  if (typeof s !== 'string') return /** @type {any} */ (s) ?? null;
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Every unveiled riven in an inventory. Veiled rivens (no stats yet) are counted separately.
 * @param {any} inventory @returns {{rivens: ImportedRiven[], veiled: number}}
 */
export function extractRivens(inventory) {
  const rivens = [];
  let veiled = 0;
  for (const item of inventory?.Upgrades ?? []) {
    if (!/\/Randomized\//.test(item?.ItemType ?? '')) continue;
    const fp = parseFingerprint(item.UpgradeFingerprint);
    if (!fp || !Array.isArray(fp.buffs)) { veiled++; continue; }
    const name = WEAPON_BY_PATH[fp.compat];
    const cls = (name && CLASS_BY_WEAPON.get(name)) || TYPE_CLASS.find(([re]) => re.test(item.ItemType))?.[1] || null;
    const pendingFp = parseFingerprint(item.PendingRerollFingerprint);
    rivens.push({
      id: item.ItemId?.$oid ?? item.ItemId?.$id ?? String(rivens.length),
      weapon: name ?? fp.compat ?? 'Unknown weapon',
      knownWeapon: !!name,
      cls,
      rank: Number(fp.lvl ?? 0),
      mr: fp.lvlReq ?? null,
      rerolls: Number(fp.rerolls ?? 0),
      stats: statsOf(fp),
      pending: pendingFp && Array.isArray(pendingFp.buffs) ? statsOf(pendingFp) : null,
    });
  }
  return { rivens, veiled };
}
