// @ts-check
// Incarnon evolutions: the chosen perk of each evolution (II–V) applied to a gun's own numbers, so
// the rest of the model sees an evolved weapon. Perk data: src/data/incarnons.js (Underframe).
//
// How each effect lands (Underframe's upgrade types; the wiki's Incarnon page):
// - base damage ("Increase Damage by +16"): per pellet, every damage type in proportion. In normal
//   fire it counts twice: the Arsenal's lines show it once and elemental mods scale from that (Boar
//   Prime: 40 + 16 = 56, 165% Electricity 92.4), but its Total has it again, and that's what hits
//   (72: 236 on an unarmored head, 28.6 on a level 235 Heavy Gunner's). The Incarnon Form's hit takes
//   it once (Heat 30 + 16: 122.19 Radiation with that mod, exactly what its ticks land; its Total's
//   second +16 isn't real). A perk's conditional part (Reified Bane's reload bonus, which the
//   Arsenal gives the form) isn't counted.
// - crit and status chance, crit multiplier, multishot, magazine: added to the weapon's base
//   (status per form: "+2.5% per projectile, +10% for Incarnon Form"; not on a form's radial attack:
//   in game, Laetum's Elemental Excess shows 42% on the hit and 22.2% on the radial).
// - a flat crit chance after mods (Elemental Excess), a weapon headshot bonus, and the non-crit
//   bonus (Devastating Attrition): fields on each attack the damage model reads (src/sim.js).
// - fire rate and reload speed: added to the mods' bonus (WeaponStats.bonus; checked in game on
//   Laetum's Rapid Wrath).
// Conditional effects (on headshot, while sliding…) aren't applied.

import { INCARNONS, INCARNON_CHARGE } from './data/incarnons.js';
import { dps, referenceTotals } from './sim.js';
import { fight } from './fight.js';

/** @typedef {import('./data/weapon-stats.js').WeaponStats} WeaponStats */
/** @typedef {import('./data/incarnons.js').Perk} Perk */

/** A gun's evolutions, or [] for a gun without an incarnon. @param {string} weapon */
export const evolutionsOf = weapon => INCARNONS[weapon] ?? [];

/**
 * A gun's Incarnon cycle (src/fight.js): what fills its gauge, what the form holds, and the fire mode
 * it charges in. Null for a gun without one.
 * @param {string} weapon @param {WeaponStats} w
 */
export function cycleOf(weapon, w) {
  const charge = INCARNON_CHARGE[weapon];
  if (!charge) return null;
  return { ...charge, normal: isForm(w.modes[w.main]) ? w.modes.findIndex(m => !isForm(m)) : w.main };
}

/** Guns that are Incarnon by birth (the wiki's "natural" Incarnons): there's no adapter to leave out. */
const NATURAL = new Set(['Felarx', 'Laetum', 'Phenmor', 'Onos']);
/** Whether a gun takes an Incarnon Genesis adapter. @param {string} weapon */
export const takesAdapter = weapon => evolutionsOf(weapon).length > 0 && !NATURAL.has(weapon);

/** An Incarnon Form mode: its numbers are the evolved form's own. @param {{name: string}} mode */
export const isForm = mode => /incarnon/i.test(mode.name);

/**
 * The gun with these perks (one index per evolution, in order; -1 or missing for none).
 * @param {WeaponStats} w @param {string} weapon @param {number[]} picks
 * @returns {WeaponStats}
 */
export function withPerks(w, weapon, picks) {
  const chosen = evolutionsOf(weapon).flatMap((e, i) => (picks[i] >= 0 && e.perks[picks[i]] ? [e.perks[picks[i]]] : []));
  if (!chosen.length) return w;
  /** @type {WeaponStats} */
  const out = structuredClone(w);
  for (const { kind, value, incarnon, chance } of chosen.flatMap(p => p.effects)) {
    if (kind === 'mag') out.mag += value;
    // (These add to the mods: in game, Laetum's +20% with +100% from mods shows 2.5 x 2.2 = 5.5.)
    if (kind === 'fireRate' || kind === 'reloadSpeed') out.bonus = { ...out.bonus, [kind]: (out.bonus?.[kind] ?? 0) + value };
    for (const mode of out.modes) {
      const form = isForm(mode);
      for (const p of mode.parts) {
        if (kind === 'cc') p.cc = Math.max(0, p.cc + value);
        else if (kind === 'cd') p.cd += value;
        else if (kind === 'sc') { if (!form || !p.aoe) p.sc = Math.max(0, p.sc + (form ? incarnon ?? value : value)); }
        else if (kind === 'ccFlat') p.ccFlat = (p.ccFlat ?? 0) + value;
        else if (kind === 'hs') { if ((p.hs ?? 0) > -1) p.hs = (p.hs ?? 0) + value; }
        else if (kind === 'nonCrit') p.nonCrit = { chance: chance ?? 1, mult: value };
        else if (!form && kind === 'ms') p.ms += value;
        else if (kind === 'baseDamage' && !(form && p.aoe)) {
          const total = Object.values(p.dmg).reduce((a, b) => a + b, 0);
          if (total > 0) {
            p.base = (p.base ?? total) + value;
            for (const t of Object.keys(p.dmg)) p.dmg[t] *= (total + (form ? value : 2 * value)) / total;
          }
        }
      }
    }
  }
  return out;
}

/**
 * The perks that together do most for the gun with the reference build: every combination tried
 * (at most 3^4), since one perk can turn another around (Devastating Attrition makes crit chance a
 * cost, so Wracking Wrath's -10% beats Brutal Edge's +10%). Perks the model can't use count as one
 * choice; ties keep the earlier perks. They're for the fire mode in opts: normal fire gets what helps
 * normal fire, and the Incarnon cycle what helps the cycle, charging and form together.
 * @param {WeaponStats} w @param {string} weapon @param {Exclude<import('./data/stats.js').WeaponClass, 'melee'>} cls
 * @param {import('./sim.js').SimOptions} opts
 */
export function bestPerks(w, weapon, cls, opts) {
  const choices = evolutionsOf(weapon).map(e => {
    const idx = e.perks.map((p, k) => (p.effects.length ? k : -1)).filter(k => k >= 0);
    const inert = e.perks.findIndex(p => !p.effects.length);
    return inert >= 0 || !idx.length ? [...idx, inert] : idx;
  });
  let best = choices.map(c => c[0]), bestDps = -Infinity;
  const walk = (/** @type {number} */ i, /** @type {number[]} */ picks) => {
    if (i === choices.length) {
      const evolved = withPerks(w, weapon, picks);
      const d = opts.incarnon && opts.target ? fight(evolved, referenceTotals(cls, {}), { ...opts, target: opts.target }).dps : dps(evolved, cls, {}, opts);
      if (d > bestDps * (1 + 1e-9)) { best = picks; bestDps = d; }
      return;
    }
    for (const k of choices[i]) walk(i + 1, [...picks, k]);
  };
  walk(0, []);
  return best;
}
