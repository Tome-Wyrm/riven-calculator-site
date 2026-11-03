// @ts-check
// The damage model's view of a gun's riven, under its community picks: the best build without a
// riven, the best rivens (each with the build re-chosen around it), what each stat is worth in the
// riven's slot, and what each curse costs on the best riven, against a chosen target (a unit at a
// level, src/enemies.js). The work (src/study.js) runs in a worker, about a second per setting.

import { STAT_BY_ID, SPLICED, SHAPES } from '../data/stats.js';
import { WEAPONS } from '../data/weapons.js';
import { SHAPE_ORDER } from '../engine.js';
import { pools } from '../cycle.js';
import { FACTIONS } from '../sim.js';
import { targetOf } from '../enemies.js';
import { picksFor, communityFit } from '../picks.js';
import { el, statName, segmented, select, ipsOf } from './dom.js';
import { oneOf } from './state.js';
import { loadTargetIntoPlanner } from './planner.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */
/** @typedef {import('../sim.js').Enemy} Enemy */
/** @typedef {ReturnType<typeof import('../study.js').study>} Study */

/** The kinds of build (src/build.js SCENARIOS). Weak points are a build of their own: hitting them is hard. */
const SCENARIO = /** @type {[string, string][]} */ ([
  ['room', 'Room clearing (kills keep stacks up)'], ['single', 'Single target (no kill stacks)'],
  ['weak', 'Weak points (every direct hit)']]);
/** @type {Record<string, string>} */
const ENEMY_NAME = { grineer: 'Grineer', corpus: 'Corpus', infested: 'Infested', orokin: 'Corrupted (Orokin)', scaldra: 'Scaldra', techrot: 'Techrot', murmur: 'The Murmur' };

export const modelState = {
  shape: /** @type {Shape} */ ('+++-'),
  mode: -1,                                   // fire mode index, -1 = the weapon's main one
  scenario: /** @type {'room' | 'single' | 'weak'} */ ('room'),
  enemy: /** @type {Enemy} */ (''),
  unit: '',                                   // the faction's unit ('' = its default)
  level: 150,
  steelPath: false,
  armor: 0,                                   // 0 = stripped; else full (2700 without a faction)
  primed: false,                              // every status type on the target
  burst: false,
};

/** The URL fields for the model's settings (defaults left out). */
export function modelFields() {
  const s = modelState;
  return {
    shape: s.shape === '+++-' ? '' : s.shape, mode: s.mode < 0 ? '' : s.mode, sc: s.scenario === 'room' ? '' : s.scenario,
    enemy: s.enemy, unit: s.unit, lvl: s.level !== 150 ? s.level : '', sp: s.steelPath ? 1 : '',
    armor: s.armor || '', primed: s.primed ? 1 : '', burst: s.burst ? 1 : '',
  };
}

/** @param {Record<string, string>} raw  the section's URL fields */
export function restoreModel(raw) {
  const shape = oneOf(SHAPE_ORDER)(raw.shape ?? '');
  if (shape) modelState.shape = shape;
  if (raw.mode && Number.isInteger(Number(raw.mode))) modelState.mode = Number(raw.mode);
  if (raw.sc === 'single' || raw.sc === 'weak') modelState.scenario = raw.sc;
  if (FACTIONS.includes(raw.enemy ?? '')) modelState.enemy = /** @type {Enemy} */ (raw.enemy);
  if (raw.armor) modelState.armor = Number(raw.armor) > 0 ? 2700 : 0;
  modelState.unit = raw.unit ?? '';                        // checked against the faction's units when they're in
  const level = Number(raw.lvl);
  if (Number.isInteger(level) && level >= 1 && level <= 9999) modelState.level = level;
  modelState.steelPath = raw.sp === '1';
  modelState.primed = raw.primed === '1';
  modelState.burst = raw.burst === '1';
}

/** @type {Record<string, import('../data/weapon-stats.js').WeaponStats> | null} */
let stats = null;
/** @type {typeof import('../data/enemies.js') | null} */
let enemies = null;
/** @type {Promise<void> | null} */
let loading = null;

/** Studies by their input (JSON): the result, 'pending', or an error message. @type {Map<string, Study | 'pending' | {error: string}>} */
const studies = new Map();
/** @type {Worker | null} */
let worker = null;
/** @type {() => void} */
let onDone = () => {};

/**
 * A study's result, starting it in the worker when it isn't known yet ('pending' until it's in;
 * rerender is called then). Without workers, it runs on the page after a moment instead.
 * @param {import('../study.js').StudyInput} input @param {() => void} rerender
 */
function studyOf(input, rerender) {
  const key = JSON.stringify(input);
  onDone = rerender;
  const known = studies.get(key);
  if (known) return known;
  studies.set(key, 'pending');
  const done = (/** @type {Study | {error: string}} */ r) => { studies.set(key, r); onDone(); };
  try {
    worker ??= new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { studies.set(e.data.key, e.data.error ? { error: e.data.error } : e.data.result); onDone(); };
    worker.postMessage({ key, input });
  } catch {
    setTimeout(() => import('../study.js').then(m => done(m.study(input))).catch(e => done({ error: String(e) })), 30);
  }
  return 'pending';
}

/** A signed percentage: "+42%", "−8%", "±0%". @param {number} x */
const pct = x => {
  const r = Math.round(x * 100);
  return r === 0 ? '±0%' : `${r > 0 ? '+' : '−'}${Math.abs(r)}%`;
};

/** A big number, shortened: "1.2M", "34k". @param {number} x */
const big = x => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}k` : String(Math.round(x)));

/** A target's weaknesses as text: "; weak to Impact and Corrosive, resists Heat". @param {Record<string, number>} weak */
const weakText = weak => {
  const named = (/** @type {number} */ sign) => Object.entries(weak).filter(([, v]) => Math.sign(v) === sign)
    .map(([k]) => k[0].toUpperCase() + k.slice(1)).join(' and ');
  const parts = [named(1) && `weak to ${named(1)}`, named(-1) && `resists ${named(-1)}`].filter(Boolean);
  return parts.length ? `; ${parts.join(', ')}` : '';
};

/** A bar for a DPS change, scaled to the largest. @param {number} x @param {number} max */
const bar = (x, max) => el('span', { class: `dps-bar${x < 0 ? ' neg' : ''}`, style: `width: ${(Math.min(1, Math.abs(x) / max) * 100).toFixed(1)}%` });

/** A build as a grid of its eight slots (in order: top row, then bottom) and its arcane. @param {{mods: string[], arcane: string | null}} b */
const buildGrid = b => el('div', { class: 'build' }, [
  el('ol', { class: 'build-grid' }, b.mods.map(m => el('li', m === 'Riven' ? { class: 'riven' } : {}, [m]))),
  el('p', { class: 'note' }, [`Arcane: ${b.arcane ?? 'none helps'}`]),
]);

/**
 * The model's block for a weapon, or a note when it can't model it. Loads the weapon data on first
 * use and calls `rerender` when it's in, and again when each study finishes.
 * @param {string} weapon @param {WeaponClass} cls @param {() => void} rerender
 * @returns {HTMLElement[]}
 */
export function modelBlock(weapon, cls, rerender) {
  const head = el('h3', { class: 'model-title' }, ['Damage model']);
  if (cls === 'melee') return [head, el('p', { class: 'note' }, ['The damage model covers guns only: melee damage depends on combo, stance and heavy attacks more than on a riven’s numbers.'])];
  if (!stats || !enemies) {
    loading ??= Promise.all([import('../data/weapon-stats.js'), import('../data/enemies.js')])
      .then(([m, e]) => { stats = m.WEAPON_STATS; enemies = e; rerender(); });
    return [head, el('p', { class: 'note' }, ['Loading weapon stats…'])];
  }
  const w = stats[weapon];
  if (!w) return [head, el('p', { class: 'note' }, [`No stats for ${weapon} in the wiki data (kitgun chambers depend on their grip and loader).`])];

  const s = modelState;
  const gun = /** @type {Exclude<WeaponClass, 'melee'>} */ (cls);
  const set = (/** @type {Partial<typeof modelState>} */ patch) => { Object.assign(s, patch); rerender(); };
  if (s.mode >= w.modes.length) s.mode = -1;
  // The target: one of the faction's units at its level. Any faction: a Grineer unit's health and
  // armor without faction weaknesses (builds are judged by fights, src/fight.js, so there's always one).
  const pick = s.enemy || 'grineer';
  const units = enemies.UNITS[pick] ?? [];
  const unit = units.find(u => u.name === s.unit) ?? units.find(u => u.name === enemies.DEFAULT_UNIT[pick]) ?? null;
  const target = unit ? targetOf(s.enemy ? unit : { ...unit, types: '' }, s.level, s.steelPath, !s.armor, enemies) : null;
  const opts = {
    mode: s.mode < 0 ? w.main : s.mode, enemy: s.enemy, burst: s.burst, primed: s.primed,
    ...(target ? { target } : { armor: s.armor }),
    bow: WEAPONS.find(x => x[0] === weapon)?.[2] === 1,
  };
  const level = /** @type {HTMLInputElement} */ (el('input', { type: 'number', min: '1', max: '9999', step: '1', value: String(s.level), inputmode: 'numeric' }));
  level.addEventListener('change', () => {
    const v = Math.round(Number(level.value));
    if (v >= 1 && v <= 9999) set({ level: v }); else level.value = String(s.level);
  });
  const pool = pools(cls, ipsOf(weapon));
  const positives = [...pool.positive, ...SPLICED.filter(x => x.b[cls] !== undefined).map(x => x.id)];
  const rows = picksFor(weapon, cls);
  const name = (/** @type {string} */ id) => statName(STAT_BY_ID[id], cls);

  const controls = el('div', { class: 'controls model-controls' }, [
    el('div', { class: 'field' }, [el('span', {}, ['Shape']), segmented('Shape', SHAPE_ORDER, s.shape, v => set({ shape: /** @type {Shape} */ (v) }))]),
    ...(w.modes.length > 1 ? [select('Fire mode', w.modes.map((m, i) => /** @type {[string, string]} */ ([String(i), m.name])), String(opts.mode), v => set({ mode: Number(v) }))] : []),
    select('Build', SCENARIO, s.scenario, v => set({ scenario: /** @type {'room' | 'single' | 'weak'} */ (v) })),
    select('Enemy', [['', 'Any (no faction bonus)'], ...FACTIONS.map(id => /** @type {[string, string]} */ ([id, ENEMY_NAME[id] ?? id]))], s.enemy,
      v => set({ enemy: /** @type {Enemy} */ (v), unit: '' })),
    ...(unit ? [
      select('Target', units.map(u => /** @type {[string, string]} */ ([u.name, u.name])), unit.name, v => set({ unit: v })),
      el('label', { class: 'field' }, [el('span', {}, ['Level']), level]),
      el('div', { class: 'field' }, [el('span', {}, ['Mode']), segmented('Mode', ['normal', 'sp'], s.steelPath ? 'sp' : 'normal',
        v => set({ steelPath: v === 'sp' }), v => (v === 'sp' ? 'Steel Path' : 'Normal'))]),
    ] : []),
    select('Armor', [['0', 'Stripped'], ['2700', 'Full']], s.armor ? '2700' : '0', v => set({ armor: Number(v) })),
    el('div', { class: 'field' }, [el('span', {}, ['Statuses']), segmented('Statuses', ['own', 'primed'], s.primed ? 'primed' : 'own',
      v => set({ primed: v === 'primed' }), v => (v === 'primed' ? 'Primed (all)' : 'The weapon’s own'))]),
    el('div', { class: 'field' }, [el('span', {}, ['DPS']), segmented('DPS', ['sustained', 'burst'], s.burst ? 'burst' : 'sustained',
      v => set({ burst: v === 'burst' }), v => (v === 'burst' ? 'Burst' : 'With reloads'))]),
  ]);
  const about = el('p', { class: 'note' }, [
    `For each riven, the best build the search finds around it (eight slots, the riven taking one, and an arcane), `
    + `judged by fights against the target: the shots a kill takes, reloads included (twenty targets in a row for room clearing and weak points, one for single target). A gun that already kills in one shot gains nothing from more damage, only from shooting sooner. The percentages are kill speed, `
    + `against the best build without a riven, at median rolls on a ${s.shape} riven (spliced stats keep the better `
    + `of two rolls, so theirs is higher). ${{
      room: 'Room clearing: kills keep on-kill stacks (Galvanized mods, Merciless) at their maximum; body shots',
      single: 'Single target: no kills, so no on-kill stacks; body shots',
      weak: 'Weak points: every direct hit lands on one (explosions never do), and weak point kills keep stacks up. '
        + 'The weak point multiplier is the target\u2019s own (3x for most heads, 1.5x for the Murmur and Techrot) plus 1.5x Weakpoint Damage, '
        + 'times headshot bonuses; critical headshots double the crit multiplier where the enemy allows it (not Corpus humanoids)',
    }[s.scenario]}; aiming bonuses count. ${s.primed
      ? 'Primed target: every status type on it (a primer companion’s or the squad’s work), Viral and Corrosive at 10 stacks, Heat burning. '
      : 'Per status type bonuses (Galvanized) count the status types the weapon keeps up by itself. '}`
    + (unit && target ? `Target: ${unit.name}${s.enemy ? '' : ' (no faction weaknesses)'}, level ${s.level}${s.steelPath ? ' Steel Path' : ''}: ${big(target.health)} health`
      + `${target.shields ? `, ${big(target.shields)} shields (Toxin skips them; Magnetic procs multiply damage to them)` : ''}`
      + `, ${target.armor ? `${Math.round(target.armor)} armor` : 'armor stripped'}${weakText(target.weak)}. ` : '')
    + 'A guide, not gospel: a good build, not a proven best, and it can’t see ammo economy or your frame.'
    + (s.armor ? ' Against full armor, Heat and Corrosive lead because their procs strip it; most squads strip armor with abilities instead.' : '')]);

  const result = studyOf({ weapon, cls: gun, shape: s.shape, scenario: s.scenario, opts, positives, negatives: pool.negative }, rerender);
  if (result === 'pending') return [head, controls, about, el('p', { class: 'note busy' }, ['Working out the builds…'])];
  if ('error' in result) return [head, controls, el('p', { class: 'note warn' }, [`The model failed: ${result.error}`])];

  const community = (/** @type {string} */ id, /** @type {boolean} */ negative) => {
    const fit = rows.length ? communityFit(rows, id, negative, weapon) : null;
    return el('td', { class: `community ${fit?.fit ?? 'none'}` }, [!rows.length ? '' : !fit ? '—'
      : fit.fit === 'top' ? (negative ? 'Top curse' : 'Top pick') : fit.fit === 'listed' ? 'Listed' : `For ${name(/** @type {string} */ (fit.pick.stat))}`]);
  };
  const table = (/** @type {Study['singles']} */ list, /** @type {boolean} */ negative) => {
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

  const k = SHAPES[s.shape].positives;
  const setList = el('ol', { class: 'model-sets' }, result.sets.map(x => {
    const plan = el('button', { type: 'button', class: 'link-button' }, ['Plan']);
    plan.addEventListener('click', () => loadTargetIntoPlanner({
      weapon, cls, positives: x.ids.filter(id => !STAT_BY_ID[id].spliced), spliced: x.ids.find(id => STAT_BY_ID[id].spliced) ?? null, negative: null,
    }));
    return el('li', {}, [el('strong', {}, [pct(x.change)]), ` ${x.ids.map(name).join(' + ')} `, plan,
      el('details', { class: 'set-build' }, [el('summary', {}, ['Its build']), buildGrid(x.build)])]);
  }));
  const moving = result.singles.filter(e => Math.abs(e.change) >= 0.005);
  const still = result.singles.filter(e => Math.abs(e.change) < 0.005).map(e => name(e.id));
  const out = [head, controls, about,
    el('h4', {}, ['Best build without a riven']), buildGrid(result.none),
    el('h4', {}, [`Best rivens (${k} positives) over no riven`]), setList,
    el('h4', {}, ['Each positive in the riven slot']),
    el('p', { class: 'note' }, ['Against the riven slot left empty, with the other seven mods re-chosen each time.']),
    table(moving, false),
    ...(still.length ? [el('p', { class: 'note' }, [`No effect on damage: ${still.join(', ')}.`])] : []),
  ];
  if (SHAPES[s.shape].negatives && result.sets[0]) {
    const harmless = result.curses.filter(e => Math.abs(e.change) < 0.005).map(e => name(e.id));
    out.push(el('h4', {}, [`Curses on the best riven (${result.sets[0].ids.map(name).join(' + ')})`]),
      ...(harmless.length ? [el('p', { class: 'note' }, [`Harmless to damage here: ${harmless.join(', ')}.`])] : []),
      table(result.curses.filter(e => Math.abs(e.change) >= 0.005), true));
  }
  return out;
}
