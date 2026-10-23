// @ts-check
// Small DOM helpers shared by the UI views.

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

let pickerId = 0;

/**
 * Weapon search box (native datalist). Picking a known weapon calls onPick with its riven class.
 * @param {[string, WeaponClass, number][]} weapons @param {string} value
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

/**
 * Stat picker options for a class: ordinary then spliced, spliced ones tagged.
 * @param {Stat[]} stats @param {WeaponClass} cls @returns {[string, string][]}
 */
export function statOptions(stats, cls) {
  return stats
    .filter(s => s.b[cls] !== undefined)
    .map(s => [s.id, statName(s, cls) + (s.spliced ? ' (spliced)' : '')]);
}
