// @ts-check
// Small DOM helpers shared by the UI views.

import { WEAPONS } from '../data/weapons.js';
import { weaponCanRoll } from '../engine.js';

/** @typedef {import('../data/stats.js').Stat} Stat */
/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */

export const CLASS_LABEL = { rifle: 'Rifle', shotgun: 'Shotgun', pistol: 'Pistol', archgun: 'Archgun', melee: 'Melee' };

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node | string)[]} [kids] */
export function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

/** @param {Stat} stat @param {WeaponClass} cls */
export const statName = (stat, cls) => (cls === 'melee' && stat.meleeName) || stat.name;

/** @param {string} name @param {string[]} options @param {string} value @param {(v: string) => void} onChange @param {(v: string) => string} [label] */
export function segmented(name, options, value, onChange, label = v => v) {
  return el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    options.map(opt => {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(opt === value) }, [label(opt)]);
      b.addEventListener('click', () => onChange(opt));
      return b;
    }));
}

/** @param {string} labelText @param {[string, string][]} options @param {string} value @param {(v: string) => void} onChange */
export function select(labelText, options, value, onChange) {
  const s = /** @type {HTMLSelectElement} */ (el('select', {},
    options.map(([v, text]) => el('option', v === value ? { value: v, selected: '' } : { value: v }, [text]))));
  s.addEventListener('change', () => onChange(s.value));
  return el('label', { class: 'field' }, [el('span', {}, [labelText]), s]);
}

/** Copies the current URL (which carries every view's state) to the clipboard. */
export function copyLinkButton() {
  const b = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'copy-link' }, ['Copy link']));
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      b.textContent = 'Copied!';
    } catch {
      b.textContent = 'Copy failed: use the address bar';
    }
    setTimeout(() => { b.textContent = 'Copy link'; }, 1500);
  });
  return b;
}

let pickerId = 0;

/**
 * Weapon search box (native datalist). Picking a known weapon calls onPick with its riven class.
 * @param {[string, WeaponClass, number, string][]} weapons @param {string} value
 * @param {(name: string, cls: WeaponClass) => void} onPick
 */
export function weaponPicker(weapons, value, onPick) {
  const id = `weapons-${++pickerId}`;
  const input = /** @type {HTMLInputElement} */ (el('input', {
    type: 'search', list: id, value, placeholder: 'e.g. Felarx', autocomplete: 'off', 'aria-label': 'Weapon',
  }));
  const byName = new Map(weapons.map(w => [w[0].toLowerCase(), w]));
  input.addEventListener('change', () => {
    const w = byName.get(input.value.trim().toLowerCase());
    if (w) onPick(w[0], w[1]);
  });
  const list = el('datalist', { id }, weapons.map(w => el('option', { value: w[0] })));
  return el('label', { class: 'field weapon' }, [el('span', {}, ['Weapon']), input, list]);
}

const WEAPON_BY_NAME = new Map(WEAPONS.map(w => [w[0], w]));

/** The picked weapon's IPS code, or undefined when no weapon is picked. @param {string} name */
export const ipsOf = name => WEAPON_BY_NAME.get(name)?.[3];

/** @param {string} name */
export const isBow = name => WEAPON_BY_NAME.get(name)?.[2] === 1;

/**
 * Stat picker options for a class: ordinary then spliced, spliced ones tagged. With a weapon's
 * IPS code, physical stats it can't roll are dropped and unsure ones are tagged.
 * @param {Stat[]} stats @param {WeaponClass} cls @param {string} [ipsCode] @returns {[string, string][]}
 */
export function statOptions(stats, cls, ipsCode) {
  return stats
    .filter(s => s.b[cls] !== undefined && weaponCanRoll(s, ipsCode) !== 'n')
    .map(s => [s.id, statName(s, cls) + (s.spliced ? ' (spliced)' : '')
      + (weaponCanRoll(s, ipsCode) === '?' ? ' (may not roll)' : '')]);
}
