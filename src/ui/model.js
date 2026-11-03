// @ts-check
// The damage model's view of a gun's riven, under its community picks: each stat's DPS gain at its
// median roll, the best sets of positives together, and what each curse costs.

import { STAT_BY_ID, SPLICED, SHAPES } from '../data/stats.js';
import { WEAPONS } from '../data/weapons.js';
import { SHAPE_ORDER } from '../engine.js';
import { pools } from '../cycle.js';
import { statEffects, bestSets, NO_DPS, FACTIONS, BUILDS } from '../sim.js';
import { picksFor, communityFit } from '../picks.js';
import { el, statName, segmented, select, ipsOf } from './dom.js';
import { oneOf } from './state.js';
import { loadTargetIntoPlanner } from './planner.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */
/** @typedef {import('../sim.js').Enemy} Enemy */

/** Share of hits on weak points, as offered. */
const WEAKPOINT = /** @type {[string, string][]} */ ([['0', 'None'], ['0.25', 'A quarter'], ['0.5', 'Half'], ['1', 'All']]);
// (Weak points: heads and any other weak point; Weakpoint Damage multiplies their x2.)

export const modelState = {
  shape: /** @type {Shape} */ ('+++-'),
  mode: -1,                                   // fire mode index, -1 = the weapon's main one
  enemy: /** @type {Enemy} */ (''),
  weakpoint: 0.25,
  armor: 0,
  burst: false,
};

/** The URL fields for the model's settings (defaults left out). */
export function modelFields() {
  const s = modelState;
  return {
    shape: s.shape === '+++-' ? '' : s.shape, mode: s.mode < 0 ? '' : s.mode, enemy: s.enemy,
    wp: s.weakpoint === 0.25 ? '' : s.weakpoint, armor: s.armor || '', burst: s.burst ? 1 : '',
  };
}

/** @param {Record<string, string>} raw  the section's URL fields */
export function restoreModel(raw) {
  const shape = oneOf(SHAPE_ORDER)(raw.shape ?? '');
  if (shape) modelState.shape = shape;
  if (raw.mode && Number.isInteger(Number(raw.mode))) modelState.mode = Number(raw.mode);
  if (FACTIONS.includes(raw.enemy ?? '')) modelState.enemy = /** @type {Enemy} */ (raw.enemy);
  if (WEAKPOINT.some(([k]) => k === raw.wp)) modelState.weakpoint = Number(raw.wp);
  if (raw.armor) modelState.armor = Number(raw.armor) > 0 ? 2700 : 0;
  modelState.burst = raw.burst === '1';
}

/** @type {Record<string, import('../data/weapon-stats.js').WeaponStats> | null} */
let stats = null;
/** @type {Promise<void> | null} */
let loading = null;

/** A signed percentage: "+42%", "−8%", "±0%". @param {number} x */
const pct = x => {
  const r = Math.round(x * 100);
  return r === 0 ? '±0%' : `${r > 0 ? '+' : '−'}${Math.abs(r)}%`;
};

/** A bar for a DPS change, scaled to the largest. @param {number} x @param {number} max */
const bar = (x, max) => el('span', { class: `dps-bar${x < 0 ? ' neg' : ''}`, style: `width: ${(Math.min(1, Math.abs(x) / max) * 100).toFixed(1)}%` });

/**
 * The model's block for a weapon, or a note when it can't model it. Loads the weapon data on first
 * use and calls `rerender` when it's in.
 * @param {string} weapon @param {WeaponClass} cls @param {() => void} rerender
 * @returns {HTMLElement[]}
 */
export function modelBlock(weapon, cls, rerender) {
  const head = el('h3', { class: 'model-title' }, ['Damage model']);
  if (cls === 'melee') return [head, el('p', { class: 'note' }, ['The damage model covers guns only: melee damage depends on combo, stance and heavy attacks more than on a riven’s numbers.'])];
  if (!stats) {
    loading ??= import('../data/weapon-stats.js').then(m => { stats = m.WEAPON_STATS; rerender(); });
    return [head, el('p', { class: 'note' }, ['Loading weapon stats…'])];
  }
  const w = stats[weapon];
  if (!w) return [head, el('p', { class: 'note' }, [`No stats for ${weapon} in the wiki data (kitgun chambers depend on their grip and loader).`])];

  const s = modelState;
  const gun = /** @type {Exclude<WeaponClass, 'melee'>} */ (cls);
  const set = (/** @type {Partial<typeof modelState>} */ patch) => { Object.assign(s, patch); rerender(); };
  if (s.mode >= w.modes.length) s.mode = -1;
  const opts = {
    mode: s.mode < 0 ? w.main : s.mode, enemy: s.enemy, weakpoint: s.weakpoint, armor: s.armor, burst: s.burst,
    bow: WEAPONS.find(x => x[0] === weapon)?.[2] === 1,
  };
  const pool = pools(cls, ipsOf(weapon));
  const spliced = SPLICED.filter(x => x.b[cls] !== undefined).map(x => x.id);
  const positives = [...pool.positive, ...spliced];
  const rows = picksFor(weapon, cls);
  const name = (/** @type {string} */ id) => statName(STAT_BY_ID[id], cls);

  const controls = el('div', { class: 'controls model-controls' }, [
    el('div', { class: 'field' }, [el('span', {}, ['Shape']), segmented('Shape', SHAPE_ORDER, s.shape, v => set({ shape: /** @type {Shape} */ (v) }))]),
    ...(w.modes.length > 1 ? [select('Fire mode', w.modes.map((m, i) => /** @type {[string, string]} */ ([String(i), m.name])), String(opts.mode), v => set({ mode: Number(v) }))] : []),
    select('Enemy', [['', 'Any (no faction bonus)'], ...FACTIONS.map(id => /** @type {[string, string]} */ ([id, name(id).replace('Damage to ', '')]))], s.enemy,
      v => set({ enemy: /** @type {Enemy} */ (v) })),
    select('Weak point hits', WEAKPOINT, String(s.weakpoint), v => set({ weakpoint: Number(v) })),
    select('Armor', [['0', 'Stripped'], ['2700', 'Steel Path (2700)']], String(s.armor), v => set({ armor: Number(v) })),
    el('div', { class: 'field' }, [el('span', {}, ['DPS']), segmented('DPS', ['sustained', 'burst'], s.burst ? 'burst' : 'sustained',
      v => set({ burst: v === 'burst' }), v => (v === 'burst' ? 'Burst' : 'With reloads'))]),
  ]);

  const community = (/** @type {string} */ id, /** @type {boolean} */ negative) => {
    const fit = rows.length ? communityFit(rows, id, negative, weapon) : null;
    return el('td', { class: `community ${fit?.fit ?? 'none'}` }, [!rows.length ? '' : !fit ? '—'
      : fit.fit === 'top' ? (negative ? 'Top curse' : 'Top pick') : fit.fit === 'listed' ? 'Listed' : `For ${name(/** @type {string} */ (fit.pick.stat))}`]);
  };

  // The best positives together.
  const k = SHAPES[s.shape].positives;
  const sets = bestSets(w, gun, s.shape, positives, opts, 5);
  const setList = el('ol', { class: 'model-sets' }, sets.map(x => {
    const plan = el('button', { type: 'button', class: 'link-button' }, ['Plan']);
    plan.addEventListener('click', () => loadTargetIntoPlanner({
      weapon, cls, positives: x.ids.filter(id => !STAT_BY_ID[id].spliced), spliced: x.ids.find(id => STAT_BY_ID[id].spliced) ?? null, negative: null,
    }));
    return el('li', {}, [el('strong', {}, [pct(x.change)]), ` ${x.ids.map(name).join(' + ')} `, plan]);
  }));

  // Each positive alone.
  const effects = statEffects(w, gun, s.shape, '+', positives, opts);
  const moving = effects.filter(e => Math.abs(e.change) >= 0.005);
  const still = effects.filter(e => Math.abs(e.change) < 0.005).map(e => name(e.id));
  const table = (/** @type {typeof effects} */ list, /** @type {boolean} */ negative) => {
    const max = Math.max(0.01, ...list.map(e => Math.abs(e.change)));
    return el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals model' }, [
    el('thead', {}, [el('tr', {}, ['Stat', 'Median roll', negative ? 'DPS lost' : 'DPS gained', '', ...(rows.length ? ['Community'] : [])]
      .map(h => el('th', { scope: 'col' }, [h])))]),
    el('tbody', {}, list.map(e => el('tr', {}, [
      el('th', { scope: 'row' }, [name(e.id) + (STAT_BY_ID[e.id].spliced ? ' (spliced)' : '')]),
      el('td', {}, [e.shown]),
      el('td', { class: negative ? 'neg-text' : '' }, [pct(e.change)]),
      el('td', { class: 'bar-cell' }, [bar(e.change, max)]),
      ...(rows.length ? [community(e.id, negative)] : []),
    ]))),
  ])]);
  };

  const out = [head, controls,
    el('p', { class: 'note' }, [
      `What each stat adds to ${weapon}'s damage per second over a reference build (`
      + `+${Math.round(BUILDS[gun].damage * 100)}% Damage including an arcane, +${Math.round(BUILDS[gun].multishot * 100)}% Multishot, `
      + `+${Math.round(BUILDS[gun].critChance * 100)}% Crit Chance, +${Math.round(BUILDS[gun].critDamage * 100)}% Crit Damage, `
      + `+${Math.round(BUILDS[gun].element * 100)}% Viral), at the median roll on a ${s.shape} riven `
      + '(spliced stats keep the better of two rolls, so theirs is higher). A guide, not gospel: it can’t see '
      + 'mod slots a riven frees, ammo economy, or what your build already has.'
      + (s.armor ? ' Against full Steel Path armor, Heat and Corrosive lead because their procs strip it; '
        + 'most squads strip armor with abilities instead.' : '')]),
    el('h4', {}, [`Best ${k} positives together`]), setList,
    el('h4', {}, ['Each positive alone']), table(moving, false),
    ...(still.length ? [el('p', { class: 'note' }, [`No effect on damage: ${still.join(', ')}.`])] : []),
  ];
  if (SHAPES[s.shape].negatives) {
    const curses = statEffects(w, gun, s.shape, '-', pool.negative, opts);
    const harmless = curses.filter(e => Math.abs(e.change) < 0.005).map(e => name(e.id));
    out.push(el('h4', {}, ['Curses']),
      ...(harmless.length ? [el('p', { class: 'note' }, [`Harmless to damage here: ${harmless.join(', ')}.`])] : []),
      table(curses.filter(e => Math.abs(e.change) >= 0.005), true));
  }
  return out;
}
