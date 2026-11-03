// @ts-check
// Recommended rolls: pick a weapon and see what the community recommends on its riven (the Rolls &
// Resources sheet), slot by slot, then plan any of them in the build planner. Below, for guns, what
// the damage model makes of each stat (src/ui/model.js).

import { STAT_BY_ID } from '../data/stats.js';
import { WEAPONS } from '../data/weapons.js';
import { PICKS_SOURCE, PICKS_UPDATED } from '../data/picks.js';
import { pools } from '../cycle.js';
import { picksFor, pickFamily, plannable, forWeapon, topRoll, toTarget, noteText } from '../picks.js';
import { el, statName, weaponPicker, copyLinkButton, ipsOf, recipeText } from './dom.js';
import { loadState, saveState } from './state.js';
import { loadTargetIntoPlanner } from './planner.js';
import { modelBlock, modelFields, restoreModel } from './model.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../picks.js').Pick} Pick */
/** @typedef {import('../picks.js').PickRow} PickRow */

const state = {
  weapon: '',
  cls: /** @type {WeaponClass} */ ('rifle'),
  /** The stat chosen in each row: [positive 1, 2, 3, negative], null for none. */
  chosen: /** @type {(string | null)[][]} */ ([]),
};

/** @type {HTMLElement} */
let root;

/** @param {string} weapon */
const classOf = weapon => /** @type {WeaponClass} */ (WEAPONS.find(w => w[0] === weapon)?.[1]);

/** The weapon's rows and stat pool. */
function current() {
  const rows = picksFor(state.weapon, state.cls);
  const { positive, negative } = pools(state.cls, ipsOf(state.weapon));
  return { rows, pool: { positive, negative } };
}

/** Sets the weapon and starts each row on its top roll. @param {string} weapon */
function setWeapon(weapon) {
  state.weapon = weapon;
  state.cls = classOf(weapon);
  const { rows, pool } = current();
  state.chosen = rows.map(row => {
    const top = topRoll(row, pool, state.cls, weapon);
    return [...top.positives, top.negative];
  });
}

/**
 * Picks a stat in one slot of a row (or clears it, picked again). A stat leaves any other slot that
 * has it, and a spliced stat leaves any other slot holding a spliced stat (one per riven).
 * @param {number} r @param {number} slot @param {string} id
 */
function choose(r, slot, id) {
  const row = state.chosen[r];
  if (row[slot] === id) { row[slot] = null; return; }
  if (slot < 3) {
    for (let i = 0; i < 3; i++) {
      const other = row[i];
      if (i !== slot && other && (other === id || (STAT_BY_ID[id].spliced && STAT_BY_ID[other].spliced))) row[i] = null;
    }
    if (row[3] === id) row[3] = null;
  } else if (row.slice(0, 3).includes(id)) {
    row[row.indexOf(id)] = null;
  }
  row[slot] = id;
}

/** The text on a chip: "Viral", "Electricity (for Melee Influence)", with stars. @param {Pick} p */
function chipLabel(p) {
  const name = p.stat === 'bane' ? 'Any faction damage' : STAT_BY_ID[p.stat ?? '']
    ? statName(STAT_BY_ID[/** @type {string} */ (p.stat)], state.cls) : p.code;
  return `${name}${p.mark}${p.note ? ` (${noteText(p.note)})` : ''}`;
}

/**
 * One slot's picks, in priority order: chips you can choose, "›" between tiers.
 * @param {PickRow['negatives']} tiers @param {number} r @param {number} slot @param {{positive: string[], negative: string[]}} pool
 */
function slotCell(tiers, r, slot, pool) {
  const negative = slot === 3;
  const kids = tiers.flatMap((tier, t) => [
    ...(t ? [el('span', { class: 'tier-sep', title: 'then', 'aria-label': 'then' }, ['›'])] : []),
    ...tier.map(p => {
      // ANY / NONE: any stat, or an empty slot.
      if (p.stat === 'any' || p.stat === 'none') {
        return el('span', { class: 'pick-chip open', title: p.stat === 'any' ? 'Any stat' : 'No stat: fewer positives is fine' },
          [`${p.stat === 'any' ? 'Any' : 'None'}${p.note ? ` (${p.note})` : ''}${p.mark}`]);
      }
      const ok = plannable(p, pool, state.cls, negative) && forWeapon(p, state.weapon);
      const stat = p.stat && p.stat !== 'bane' ? STAT_BY_ID[p.stat] : null;
      const why = !forWeapon(p, state.weapon) ? `For the ${p.note} variant only`
        : !ok ? (p.stat === 'bane' ? 'Any of the faction damage stats' : `Our data says ${state.weapon} can't roll this${negative ? ' as a negative' : ''}`)
          : stat?.spliced ? `Spliced, from ${recipeText(stat, state.cls, STAT_BY_ID)}` : '';
      const on = !!p.stat && state.chosen[r][slot] === p.stat;
      const b = el('button', {
        type: 'button', class: `pick-chip${negative ? ' neg' : ''}${stat?.spliced ? ' spliced' : ''}`,
        'aria-pressed': String(on), ...(why ? { title: why } : {}), ...(ok ? {} : { disabled: '' }),
      }, [chipLabel(p)]);
      b.addEventListener('click', () => { choose(r, slot, /** @type {string} */ (p.stat)); render(); });
      return b;
    }),
  ]);
  return el('td', {}, kids.length ? kids : [el('span', { class: 'pick-chip open' }, ['—'])]);
}

/**
 * One recommended row: its slots, its note, and a button to plan the chosen roll.
 * @param {PickRow} row @param {number} r @param {{positive: string[], negative: string[]}} pool
 */
function rowCard(row, r, pool) {
  const chosen = state.chosen[r];
  const target = toTarget(chosen.slice(0, 3), chosen[3]);
  const plan = el('button', { type: 'button', class: 'copy-link plan-roll', ...(target.positives.length || target.spliced ? {} : { disabled: '' }) }, ['Plan this roll']);
  plan.addEventListener('click', () => loadTargetIntoPlanner({ weapon: state.weapon, cls: state.cls, ...target }));
  const lines = [
    ...row.positives.map((slot, i) => /** @type {const} */ ([`Positive ${i + 1}`, slot, i])),
    /** @type {const} */ (['Negative', row.negatives, 3]),
  ].filter(([, slot], i) => slot.length || i < 2);
  return el('div', { class: 'pick-row' }, [
    el('div', { class: 'pick-head' }, [el('h3', {}, [r === 0 ? 'Roll 1 (best)' : `Roll ${r + 1}`]), plan]),
    el('table', { class: 'picks' }, [el('tbody', {}, lines.map(([label, slot, i]) =>
      el('tr', {}, [el('th', { scope: 'row' }, [label]), slotCell(slot, r, i, pool)])))]),
    ...row.notes.map(n => el('p', { class: 'note' }, [n])),
  ]);
}

function render() {
  const { rows, pool } = current();
  const family = state.weapon ? pickFamily(state.weapon) : undefined;
  const body = !state.weapon ? [el('p', { class: 'note' }, ['Pick a weapon to see the rolls the community recommends for its riven.'])]
    : !rows.length ? [el('p', { class: 'note' }, [`No recommendations for ${state.weapon} in the sheet yet.`])]
      : [
        el('p', { class: 'note' }, [
          `${family && family !== state.weapon ? `${state.weapon} shares the ${family} riven. ` : ''}`
          + 'Each slot lists its picks best first (› = then); picks in the same group are about as good. '
          + 'Dashed picks are spliced stats (hover for what splices into them). Click a pick to choose it, then plan that roll.']),
        ...rows.map((row, r) => rowCard(row, r, pool)),
      ];
  const credit = el('p', { class: 'note' }, ['From the ',
    el('a', { href: PICKS_SOURCE, target: '_blank', rel: 'noopener' }, ['Rolls & Resources sheet']),
    ` by Megrim, Valkyrial and Lia (based on the original by 44Bananas), copied ${PICKS_UPDATED}.`]);
  root.replaceChildren(
    el('div', { class: 'controls' }, [weaponPicker(WEAPONS, state.weapon, weapon => { setWeapon(weapon); render(); })]),
    ...body, credit, ...(state.weapon ? modelBlock(state.weapon, state.cls, render) : []), copyLinkButton('a'));
  saveState('a', { weapon: state.weapon, ...(state.weapon ? modelFields() : {}) });
}

/** @param {HTMLElement} container */
export function mountPicks(container) {
  root = container;
  const raw = loadState('a');
  if (raw.weapon && WEAPONS.some(w => w[0] === raw.weapon)) setWeapon(raw.weapon);
  restoreModel(raw);
  render();
}

/** Shows a weapon's recommended rolls: opens the section and scrolls to it. @param {string} weapon */
export function showPicks(weapon) {
  setWeapon(weapon);
  render();
  const details = /** @type {HTMLDetailsElement | null} */ (root.closest('details'));
  if (details) details.open = true;
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** A "Recommended rolls for X" link, for a weapon that has some. @param {string} weapon @returns {HTMLElement[]} */
export function picksLink(weapon) {
  if (!weapon || !pickFamily(weapon)) return [];
  const b = el('button', { type: 'button', class: 'link-button picks-link' }, [`Recommended rolls for ${weapon}`]);
  b.addEventListener('click', () => showPicks(weapon));
  return [b];
}
