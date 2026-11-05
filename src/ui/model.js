// @ts-check
// The damage model's view of a gun's riven, under its community picks: the best build without a
// riven, the best rivens (each with the build re-chosen around it), what each stat is worth in the
// riven's slot, and what each curse costs on the best riven, against a chosen target (a unit at a
// level, src/enemies.js). The work (src/study.js) runs in a worker, about a second per setting.

import { STAT_BY_ID, SPLICED, SHAPES } from '../data/stats.js';
import { WEAPONS } from '../data/weapons.js';
import { SHAPE_ORDER } from '../engine.js';
import { pools } from '../cycle.js';
import { VALENCE_TYPES } from '../sim.js';
import { cycleOf, evolutionsOf, isForm, takesAdapter } from '../incarnon.js';
import { combosFor, PLAIN } from '../melee.js';
import { arcaneNames, SCENARIOS } from '../build.js';
import { VALENCE_PICKS } from '../data/valence-picks.js';
import { targetOf, roomOf } from '../enemies.js';
import { BATTLEGROUPS } from '../data/battlegroups.js';
import { crowdRadius } from '../crowd.js';
import { picksFor, communityFit } from '../picks.js';
import { el, statName, segmented, select, ipsOf } from './dom.js';
import { oneOf } from './state.js';
import { loadTargetIntoPlanner } from './planner.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */
/** @typedef {ReturnType<typeof import('../study.js').study>} Study */

/** The kinds of build (src/build.js SCENARIOS). Weak points are a build of their own: hitting them is hard. */
const SCENARIO = /** @type {[string, string][]} */ ([
  ['room', 'Room clearing (kills keep stacks up)'], ['single', 'Single target (no kill stacks)'],
  ['weak', 'Weak points (every direct hit)']]);
/** @type {Record<string, string>} */
/** A damage type's name: "heat" → "Heat". @param {string} id */
const typeName = id => id[0].toUpperCase() + id.slice(1);
/** @type {Record<string, string>} */

export const modelState = {
  shape: /** @type {Shape} */ ('+++-'),
  mode: -1,                                   // fire mode index, -1 = the weapon's main one
  scenario: /** @type {'room' | 'single' | 'weak'} */ ('room'),
  enemy: '',                                  // the target's faction group (src/data/enemies.js GROUPS; '' = any)
  unit: '',                                   // the faction's unit ('' = its default)
  level: 150,
  steelPath: false,
  armor: 0,                                   // 0 = stripped; else full (2700 without a faction)
  primed: false,                              // every status type on the target
  energy: 0,                                  // the frame's Max Energy (Primary Overcharge; 0: not counted)
  spread: false,                              // judge builds on a third of the level and three times it too
  burst: false,
  valence: 'best',                            // an adversary weapon's Valence bonus: its element ('best': each tried)
  valencePct: 60,                             // and its size, 25–60%
  // An Incarnon gun: no adapter, evolved but never transforming, or the charge and form cycle.
  incarnon: /** @type {'normal' | 'off' | 'on'} */ ('off'),
  perks: /** @type {number[] | null} */ (null), // an incarnon's perk per evolution; null = the best combination
  perksOf: '',                                // the weapon those perks are for
  arcane: /** @type {string | null} */ (null), // the arcane builds carry: null = the best found, '' = none
  // Melee:
  combo: /** @type {'initial' | 'max' | 'build'} */ ('build'), // the combo counter
  stanceCombo: '',                            // "Stance|Combo" ('' = the best per swing)
  heavy: false,                               // heavy attacks, not only normal ones
  heavyAt: 6,                                 // the combo tier a built-up counter spends at
  nearby: 3,                                  // enemies inside a swing (room clearing)
  close: 6,                                   // enemies within 20 m of the target (Melee Influence)
  clump: 50,                                  // clumping, %: how many of those stand within 20 m of each other
};

/** The URL fields for the model's settings (defaults left out). */
export function modelFields() {
  const s = modelState;
  return {
    shape: s.shape === '+++-' ? '' : s.shape, mode: s.mode < 0 ? '' : s.mode, sc: s.scenario === 'room' ? '' : s.scenario,
    enemy: s.enemy, unit: s.unit, lvl: s.level !== 150 ? s.level : '', sp: s.steelPath ? 1 : '',
    armor: s.armor || '', primed: s.primed ? 1 : '', burst: s.burst ? 1 : '', spread: s.spread ? 1 : '', en: s.energy || '',
    val: s.valence === 'best' ? '' : s.valence, valp: s.valencePct === 60 ? '' : s.valencePct,
    inc: s.incarnon === 'off' ? '' : s.incarnon, perks: s.perks ? s.perks.join('.') : '',
    arc: s.arcane === null ? '' : s.arcane || '-', combo: s.combo === 'build' ? '' : s.combo, sc2: s.stanceCombo,
    hv: s.heavy ? 1 : '', hvat: s.heavyAt === 6 ? '' : s.heavyAt,
    near: s.nearby === 3 ? '' : s.nearby, close: s.close === 6 ? '' : s.close, clump: s.clump === 50 ? '' : s.clump,
  };
}

/** @param {Record<string, string>} raw  the section's URL fields */
export function restoreModel(raw) {
  const shape = oneOf(SHAPE_ORDER)(raw.shape ?? '');
  if (shape) modelState.shape = shape;
  if (raw.mode && Number.isInteger(Number(raw.mode))) modelState.mode = Number(raw.mode);
  if (raw.sc === 'single' || raw.sc === 'weak') modelState.scenario = raw.sc;
  if (/^[a-z]+$/.test(raw.enemy ?? '')) modelState.enemy = raw.enemy;      // checked against the groups when they're in
  if (raw.armor) modelState.armor = Number(raw.armor) > 0 ? 2700 : 0;
  modelState.unit = raw.unit ?? '';                        // checked against the faction's units when they're in
  const level = Number(raw.lvl);
  if (Number.isInteger(level) && level >= 1 && level <= 9999) modelState.level = level;
  modelState.steelPath = raw.sp === '1';
  modelState.primed = raw.primed === '1';
  modelState.burst = raw.burst === '1';
  modelState.spread = raw.spread === '1';
  if (VALENCE_TYPES.includes(raw.val ?? '')) modelState.valence = raw.val;
  const pct = Number(raw.valp);
  if (raw.valp && pct >= 25 && pct <= 60) modelState.valencePct = pct;
  if (raw.inc === 'normal' || raw.inc === 'on') modelState.incarnon = raw.inc;
  // "0.2.2.0": checked against the weapon's evolutions when it's shown.
  if (/^-?\d(\.-?\d){0,3}$/.test(raw.perks ?? '')) { modelState.perks = raw.perks.split('.').map(Number); modelState.perksOf = '?'; }
  // The arcane is checked against the weapon's slot when it's shown ('-': none).
  if (raw.arc) modelState.arcane = raw.arc === '-' ? '' : raw.arc;
  if (raw.combo === 'initial' || raw.combo === 'max') modelState.combo = raw.combo;
  if (raw.sc2) modelState.stanceCombo = raw.sc2;
  if (raw.hv === '1') modelState.heavy = true;
  const count = (/** @type {string | undefined} */ v, /** @type {number} */ max) => (v && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : null);
  modelState.energy = count(raw.en, 9999) ?? 0;
  modelState.nearby = count(raw.near, 20) || modelState.nearby;
  modelState.heavyAt = count(raw.hvat, 12) || modelState.heavyAt;
  modelState.close = count(raw.close, 40) ?? modelState.close;
  modelState.clump = count(raw.clump, 100) ?? modelState.clump;
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

/**
 * A build's shots (melee: swings) to kill: a button that shows its DPS, kill time and per-shot damage
 * on a line below (a tap on a phone, where there's no hover), and hides them again. Nothing without a fight.
 * @param {{dps: number, fight: {shots: number, seconds: number, perShot: number, tier?: number, inForm?: number} | null}} b
 * @param {boolean} [melee] @param {boolean} [beam]
 */
const killText = (b, melee = false, beam = false) => {
  const f = b.fight;
  if (!f) return [];
  const shots = f.shots < 10 ? f.shots.toFixed(1).replace(/\.0$/, '') : String(Math.round(f.shots));
  const word = melee ? 'swing' : 'shot';
  const detail = el('span', { class: 'kill-detail', hidden: '' }, [melee
    ? `${big(b.dps)} DPS · first swing ${big(f.perShot)} · ${f.seconds.toFixed(2)} s a kill · ${f.tier ?? 1}x combo at the kill`
    : `${big(b.dps)} DPS · ${big(f.perShot)} a ${beam ? 'tick at full damage' : 'shot (the first, on a fresh target)'} · ${f.seconds.toFixed(2)} s a kill at the sustained rate${f.inForm === undefined ? '' : ` · ${Math.round(f.inForm * 100)}% of the time in the form`}`]);
  const button = el('button', { type: 'button', class: 'kill-shots', 'aria-expanded': 'false' }, [`${shots} ${word}${shots === '1' ? '' : 's'} to kill`]);
  button.addEventListener('click', () => {
    const open = detail.hidden;
    detail.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
  return [button, detail];
};

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
  if (!stats || !enemies) {
    loading ??= Promise.all([import('../data/weapon-stats.js'), import('../data/enemies.js')])
      .then(([m, e]) => { stats = m.WEAPON_STATS; enemies = e; rerender(); });
    return [head, el('p', { class: 'note' }, ['Loading weapon stats…'])];
  }
  const w = stats[weapon];
  if (!w) return [head, el('p', { class: 'note' }, [`No stats for ${weapon} in the wiki data (kitgun chambers and zaw strikes depend on their other parts).`])];

  const s = modelState;
  const isMelee = cls === 'melee' && !!w.melee;
  const set = (/** @type {Partial<typeof modelState>} */ patch) => { Object.assign(s, patch); rerender(); };
  if (s.mode >= w.modes.length) s.mode = -1;
  // Chosen perks belong to one weapon (a link's to the weapon it opens with); another starts at the best.
  const evolutions = evolutionsOf(weapon);
  if (s.perksOf === '?') s.perksOf = weapon;
  if (s.perksOf !== weapon || s.perks?.length !== evolutions.length) { s.perks = null; s.perksOf = weapon; }
  // No adapter, normal fire or Incarnon: the choice decides the perks and which fire modes there are.
  // (A link from before the choice names the Incarnon Form as its fire mode.)
  if (w.modes[s.mode] && isForm(w.modes[s.mode])) s.incarnon = 'on';
  const incarnon = !evolutions.length ? 'normal' : s.incarnon === 'normal' && !takesAdapter(weapon) ? 'off' : s.incarnon;
  const modes = w.modes.flatMap((m, i) => (isForm(m) === (incarnon === 'on') ? [i] : []));
  const mode = modes.includes(s.mode) ? s.mode : modes.includes(w.main) ? w.main : modes[0];
  const isBeam = w.modes[mode]?.held != null;
  const cycle = incarnon === 'on' ? cycleOf(weapon, w) : null;
  // The target: one of the faction's units at its level. Any faction: a Grineer unit's health and
  // armor without faction weaknesses (builds are judged by fights, src/fight.js, so there's always one).
  const group = enemies.GROUPS.find(g => g.id === s.enemy) ?? null;
  const pick = group?.id ?? 'grineer';
  const units = enemies.UNITS[pick] ?? [];
  const unit = units.find(u => u.name === s.unit) ?? units.find(u => u.name === enemies.DEFAULT_UNIT[pick]) ?? null;
  const targetAt = (/** @type {number} */ lvl) => (unit ? targetOf(group ? unit : { ...unit, types: '' }, lvl, s.steelPath, !s.armor, enemies) : null);
  const target = targetAt(s.level);
  // Room clearing fights the faction's battlegroup, unless a unit is chosen.
  const battlegroup = SCENARIOS[s.scenario].kills ? BATTLEGROUPS[pick] ?? null : null;
  const mix = battlegroup && !s.unit ? battlegroup : null;
  const roomAt = (/** @type {number} */ lvl) => (mix ? { room: roomOf(pick, mix.members, lvl, s.steelPath, !s.armor, enemies, group ? undefined : '') } : {});
  // A third of the level and three times it: 150 is judged at 50 and 450 as well.
  const levels = [Math.max(1, Math.round(s.level / 3)), Math.min(9999, s.level * 3)];
  // The arcane: one of this weapon's slot, or the best found.
  const arcanes = arcaneNames(cls);
  if (s.arcane && !arcanes.includes(s.arcane)) s.arcane = null;
  // Melee: the stance combo (the best per swing unless chosen), the combo counter and the crowd.
  const combos = isMelee ? combosFor(w.kind) : [];
  const chosen = combos.find(c => `${c.stance}|${c.combo.name}` === s.stanceCombo) ?? combos[0] ?? null;
  const comboName = chosen ? `${chosen.stance}, ${chosen.combo.name}` : 'none in the wiki’s data: plain hits';
  const opts = {
    mode, ...(cycle ? { incarnon: cycle } : {}), enemy: group?.bane ?? '', burst: s.burst, primed: s.primed,
    ...(s.arcane !== null ? { arcane: s.arcane } : {}),
    ...(isMelee ? { melee: { attacks: chosen?.combo.attacks ?? PLAIN, combo: s.combo, heavy: s.heavy, heavyAt: s.heavyAt, nearby: s.nearby, close: s.close, clump: s.clump / 100 } } : {}),
    ...(target ? { target, ...roomAt(s.level) } : { armor: s.armor }),
    ...(target && s.spread ? { spread: levels.map(l => ({ target: /** @type {import('../sim.js').Target} */ (targetAt(l)), ...roomAt(l) })) } : {}),
    ...(s.energy ? { maxEnergy: s.energy } : {}),
    ...(!isMelee && SCENARIOS[s.scenario].kills ? { crowd: { close: s.close, clump: s.clump / 100 } } : {}),
    bow: WEAPONS.find(x => x[0] === weapon)?.[2] === 1,
    ...(w.adversary ? { valence: { type: s.valence, value: s.valencePct / 100 } } : {}),
  };
  const level = /** @type {HTMLInputElement} */ (el('input', { type: 'number', min: '1', max: '9999', step: '1', value: String(s.level), inputmode: 'numeric' }));
  level.addEventListener('change', () => {
    const v = Math.round(Number(level.value));
    if (v >= 1 && v <= 9999) set({ level: v }); else level.value = String(s.level);
  });
  const valencePct = /** @type {HTMLInputElement} */ (el('input', { type: 'number', min: '25', max: '60', step: '0.1', value: String(s.valencePct), inputmode: 'decimal' }));
  valencePct.addEventListener('change', () => {
    const v = Math.round(Number(valencePct.value) * 10) / 10;
    if (v >= 25 && v <= 60) set({ valencePct: v }); else valencePct.value = String(s.valencePct);
  });
  const pool = pools(cls, ipsOf(weapon));
  const positives = [...pool.positive, ...SPLICED.filter(x => x.b[cls] !== undefined).map(x => x.id)];
  const rows = picksFor(weapon, cls);
  const name = (/** @type {string} */ id) => statName(STAT_BY_ID[id], cls);

  const num = (/** @type {string} */ label, /** @type {number} */ value, /** @type {number} */ max, /** @type {(v: number) => void} */ apply) => {
    const input = /** @type {HTMLInputElement} */ (el('input', { type: 'number', min: '0', max: String(max), step: '1', value: String(value), inputmode: 'numeric' }));
    input.addEventListener('change', () => {
      const v = Math.round(Number(input.value));
      if (v >= 0 && v <= max) apply(v); else input.value = String(value);
    });
    return el('label', { class: 'field' }, [el('span', {}, [label]), input]);
  };
  const meleeControls = isMelee ? [
    ...(combos.length ? [select('Stance combo', combos.map(c => /** @type {[string, string]} */ ([`${c.stance}|${c.combo.name}`, `${c.stance}: ${c.combo.name} (${c.perSwing.toFixed(1)}x a swing)`])),
      chosen ? `${chosen.stance}|${chosen.combo.name}` : '', v => set({ stanceCombo: v === `${combos[0].stance}|${combos[0].combo.name}` ? '' : v }))] : []),
    el('div', { class: 'field' }, [el('span', {}, ['Combo counter']), segmented('Combo counter', ['initial', 'max', 'build'], s.combo,
      v => set({ combo: /** @type {'initial' | 'max' | 'build'} */ (v) }), v => ({ initial: 'Initial', max: 'Max (12x)', build: 'Built up' })[v] ?? v,
      () => 'Held at the initial combo, held at the max, or built up by the hits (room clearing carries it from kill to kill)')]),
    ...(w.melee?.heavy ? [el('div', { class: 'field' }, [el('span', {}, ['Attacks']), segmented('Attacks', ['normal', 'heavy'], s.heavy ? 'heavy' : 'normal',
      v => set({ heavy: v === 'heavy' }), v => ({ normal: 'Normal', heavy: 'Heavy' })[v] ?? v,
      () => 'Normal attacks only, or heavy attacks: a built-up counter spends its combo at the tier below; a held one heavy attacks every time')])] : []),
    ...(w.melee?.heavy && s.heavy && s.combo === 'build' ? [num('Heavy at tier', s.heavyAt, 12, v => set({ heavyAt: Math.max(1, v) }))] : []),
    num('In the swing', s.nearby, 20, v => set({ nearby: Math.max(1, v) })),
    num('Within 20 m', s.close, 40, v => set({ close: v })),
    num('Clumping %', s.clump, 100, v => set({ clump: v })),
  ] : [];
  const controls = el('div', { class: 'controls model-controls' }, [
    el('div', { class: 'field' }, [el('span', {}, ['Shape']), segmented('Shape', SHAPE_ORDER, s.shape, v => set({ shape: /** @type {Shape} */ (v) }))]),
    ...(evolutions.length ? [el('div', { class: 'field' }, [el('span', {}, ['Incarnon']), segmented('Incarnon', takesAdapter(weapon) ? ['normal', 'off', 'on'] : ['off', 'on'], incarnon,
      v => set({ incarnon: /** @type {'normal' | 'off' | 'on'} */ (v), mode: -1 }), v => ({ normal: 'No adapter', off: takesAdapter(weapon) ? 'Adapter, normal fire' : 'Normal fire', on: 'Incarnon' })[v] ?? v,
      v => ({ normal: 'The plain gun, no Incarnon Genesis adapter: no perks', off: 'The evolutions’ perks, never transforming', on: 'The evolutions’ perks: charge the gauge, transform, fire the form dry, again' })[v] ?? v)])] : []),
    ...(modes.length > 1 ? [select('Fire mode', modes.map(i => /** @type {[string, string]} */ ([String(i), w.modes[i].name])), String(mode), v => set({ mode: Number(v) }))] : []),
    ...(w.adversary ? [
      select('Valence bonus', [['best', 'Best (each tried)'], ...VALENCE_TYPES.map(v => /** @type {[string, string]} */ ([v, typeName(v)]))], s.valence, v => set({ valence: v })),
      el('label', { class: 'field' }, [el('span', {}, ['Bonus %']), valencePct]),
    ] : []),
    select('Build', SCENARIO, s.scenario, v => set({ scenario: /** @type {'room' | 'single' | 'weak'} */ (v) })),
    ...(arcanes.length ? [select('Arcane', [['*', 'Best (searched)'], ['-', 'None'], ...arcanes.map(a => /** @type {[string, string]} */ ([a, a]))],
      s.arcane === null ? '*' : s.arcane || '-', v => set({ arcane: v === '*' ? null : v === '-' ? '' : v }))] : []),
    ...(arcanes.includes('Primary Overcharge') ? [num('Max Energy', s.energy, 9999, v => set({ energy: v }))] : []),
    ...meleeControls,
    ...(!isMelee && SCENARIOS[s.scenario].kills ? [num('Within 20 m', s.close, 40, v => set({ close: v })), num('Clumping %', s.clump, 100, v => set({ clump: v }))] : []),
    select('Enemy', [['', 'Any (no faction bonus)'], ...enemies.GROUPS.map(g => /** @type {[string, string]} */ ([g.id, g.name]))], group?.id ?? '',
      v => set({ enemy: v, unit: '' })),
    ...(unit ? [
      select('Target', [...(battlegroup ? [/** @type {[string, string]} */ (['', 'Battlegroup (mixed)'])] : []), ...units.map(u => /** @type {[string, string]} */ ([u.name, u.name]))],
        mix ? '' : unit.name, v => set({ unit: v })),
      el('label', { class: 'field' }, [el('span', {}, ['Level']), level]),
      el('div', { class: 'field' }, [el('span', {}, ['Judged at']), segmented('Judged at', ['one', 'spread'], s.spread ? 'spread' : 'one',
        v => set({ spread: v === 'spread' }), v => (v === 'spread' ? 'A spread' : 'This level'),
        v => (v === 'spread' ? `Builds are judged at levels ${levels[0]}, ${s.level} and ${levels[1]} together` : 'Builds are judged at this level alone'))]),
      el('div', { class: 'field' }, [el('span', {}, ['Mode']), segmented('Mode', ['normal', 'sp'], s.steelPath ? 'sp' : 'normal',
        v => set({ steelPath: v === 'sp' }), v => (v === 'sp' ? 'Steel Path' : 'Normal'))]),
    ] : []),
    select('Armor', [['0', 'Stripped'], ['2700', 'Full']], s.armor ? '2700' : '0', v => set({ armor: Number(v) })),
    el('div', { class: 'field' }, [el('span', {}, ['Statuses']), segmented('Statuses', ['own', 'primed'], s.primed ? 'primed' : 'own',
      v => set({ primed: v === 'primed' }), v => (v === 'primed' ? 'Primed (all)' : 'The weapon’s own'))]),
    ...(isMelee ? [] : [el('div', { class: 'field' }, [el('span', {}, ['DPS']), segmented('DPS', ['sustained', 'burst'], s.burst ? 'burst' : 'sustained',
      v => set({ burst: v === 'burst' }), v => (v === 'burst' ? 'Burst' : 'With reloads'))])]),
  ]);
  const about = el('p', { class: 'note' }, [
    `For each riven, the best build the search finds around it (eight slots, the riven taking one, and an arcane), `
    + `judged by fights against the target at the gun’s sustained rate: each shot carries its share of the reload, so a kill that only just fits a magazine counts for no more than one that doesn’t (twenty targets in a row for room clearing and weak points, one for single target). Damage past a one-shot kill still counts: a riven serves on tougher targets than this one too. The percentages are DPS, `
    + `against the best build without a riven, at median rolls on a ${s.shape} riven (spliced stats keep the better `
    + `of two rolls, so theirs is higher). ${{
      room: 'Room clearing: kills keep on-kill stacks (Galvanized mods, Merciless) at their maximum; aimed at bodies, one hit in fifty on a weak point by accident',
      single: 'Single target: no kills, so no on-kill stacks; aimed at bodies, one hit in fifty on a weak point by accident',
      weak: 'Weak points: every direct hit lands on one (explosions never do), and weak point kills keep stacks up. '
        + 'The weak point multiplier is the target\u2019s own (3x for most heads, 1.5x for the Murmur and Techrot) plus 1.5x Weakpoint Damage, '
        + 'times headshot bonuses; critical headshots double the crit multiplier where the enemy allows it (not Corpus humanoids)',
    }[s.scenario]}; aiming bonuses count. ${w.adversary
      ? `The Valence bonus (${s.valencePct}%${s.valence === 'best' ? ', the element whose best build does most' : ` ${typeName(s.valence)}`}) is the weapon’s own damage: elemental mods scale from the base with it, and a base element joins after the mods (Heat, Cold, Electricity, Toxin order), so it changes which elements the mods can make. `
      : ''}${s.primed
      ? 'Primed target: every status type on it (a primer companion’s or the squad’s work), Viral and Corrosive at 10 stacks, Heat burning. '
      : 'Per status type bonuses (Galvanized) count the status types the weapon keeps up by itself. '}`
    + (mix ? `Target: the Simulacrum’s ${mix.name} battlegroup${group ? '' : ' without its faction weaknesses'} (${mix.members.map(([name, n]) => `${n} ${name}`).join(', ')}), level ${s.level}${s.steelPath ? ' Steel Path' : ''}, ${s.armor ? 'full armor' : 'armor stripped'}, killed one after another: DPS is their health and shields over the time the 20 take, shots and seconds an average kill’s, the first shot on the toughest. ` : '')
    + (!mix && unit && target ? `Target: ${unit.name}${group ? (group.bane ? '' : ` (${group.name}: no riven faction stat applies)`) : ' (no faction weaknesses)'}, level ${s.level}${s.steelPath ? ' Steel Path' : ''}: ${big(target.health)} health`
      + `${target.shields ? `, ${big(target.shields)} shields (Toxin skips them; Magnetic procs multiply damage to them)` : ''}`
      + `, ${target.armor ? `${Math.round(target.armor)} armor` : 'armor stripped'}${weakText(target.weak)}. ` : '')
    + (isMelee ? `${s.heavy && w.melee?.heavy ? `Heavy attacks: ${w.melee.heavy} damage x the combo multiplier, one hit after the ${w.melee.windUp} s wind up (Wind Up Speed shortens it, attack speed doesn’t; no recovery counted), ${s.combo === 'build' ? `spending the combo at ${s.heavyAt}x, keeping Heavy Attack Efficiency’s share (at most 90%); spent Initial Combo returns at 40 a second` : 'every attack, the counter held'}; True Steel’s and rivens’ Critical Chance count twice. ` : ''}Melee: no slams or finishers yet, a swing being the next attack of the stance combo (${comboName}): its hits’ multipliers and counts, not its timing. `
      + `The combo counter is ${{ initial: 'held at the initial combo', max: 'held at 12x', build: 'built up by the hits (each hit adds its multiplier in points; room clearing carries it from kill to kill)' }[s.combo]}; Blood Rush and Weeping Wounds add theirs per tier past 1x. `
      + `Room clearing: ${s.nearby} enem${s.nearby === 1 ? 'y' : 'ies'} in each swing, each further one at ${Math.round((w.melee?.ft ?? 1) * 100)}% follow through of the one before; `
      + `Melee Influence spreads elemental procs to ${s.close} enem${s.close === 1 ? 'y' : 'ies'} within 20 m, each taking 1 + ${s.clump}% x the others as copies (clumped enemies pass it on to each other). ` : '')
    + (cycle && !s.burst ? `Incarnon: normal fire until the gauge fills (${cycle.hits} ${cycle.any ? 'hits' : `weak point hits, each pellet counting, ${s.scenario === 'weak' ? 'every hit' : '75% of hits'} on them while charging, which speeds the gauge but isn’t counted as damage`}), a reload’s time to transform, then the form’s ${cycle.ammo} ammo, and under a second back. ${s.scenario === 'single' ? 'The gauge starts full. ' : ''}` : '')
    + (incarnon === 'on' && s.burst ? 'Incarnon, burst: the whole fight in the form. ' : '')
    + (opts.spread ? `Judged at levels ${levels[0]}, ${s.level} and ${levels[1]}: DPS and percentages are the geometric mean of the three (each level counts the same); shots and seconds are level ${s.level}’s. ` : '')
    + (arcanes.includes('Primary Overcharge') ? (s.energy ? `Primary Overcharge at ${s.energy} Max Energy: +${Math.round(Math.min(350, 0.35 * s.energy))}% Multishot, taken to be always on (it wants 90% Energy or more). ` : 'Primary Overcharge counts for nothing until you give your Max Energy. ') : '')
    + (opts.crowd ? `A crowd of ${s.close} enem${s.close === 1 ? 'y' : 'ies'} around each target, within ${Math.round(crowdRadius(opts.crowd))} m at ${s.clump}% clumping: explosions, chains and Punch Through reach them, and the room falls that much faster. ` : '')
    + (isBeam ? `A beam: Multishot rolls to a whole number each tick and multiplies its damage and status chance, not its crits, so it counts twice in damage over time and Hunter Munitions rolls once a tick. It starts each target at ${Math.round(w.modes[mode].held * 100)}% damage, full after 0.6 s. ` : '')
    + 'A guide, not gospel: a good build, not a proven best, and it can’t see ammo economy or your frame.'
    + (s.armor ? ' Against full armor, Heat and Corrosive lead because their procs strip it; most squads strip armor with abilities instead.' : '')]);

  const result = studyOf({ weapon, cls: /** @type {import('../study.js').StudyInput['cls']} */ (cls), shape: s.shape, scenario: s.scenario, opts, positives, negatives: pool.negative, perks: s.perks ?? 'best', adapter: incarnon !== 'normal' }, rerender);
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
      el('thead', {}, [el('tr', {}, ['Stat', 'Median roll', negative ? 'DPS change' : 'DPS gained', '', ...(rows.length ? ['Community'] : [])]
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

  // The Valence elements, each by its best build without a riven, beside the usual picks.
  /** @type {HTMLElement[]} */
  const valenceBlock = [];
  if (w.adversary) {
    const picks = VALENCE_PICKS[weapon];
    const listed = (/** @type {string[] | undefined} */ l) => (l ? l.map(typeName).join(' or ') : 'none listed');
    const usual = el('p', { class: 'note' }, [`Brozime’s pick: ${listed(picks?.brozime)}${picks?.tier ? ` (his tier: ${picks.tier})` : ''}; the community’s: ${listed(picks?.community)}.`]);
    if (result.valences) {
      const ties = result.valences.filter(v => v.change > -0.005).map(v => typeName(v.type));
      const max = Math.max(0.01, ...result.valences.map(v => Math.abs(v.change)));
      const mark = (/** @type {string[] | undefined} */ l, /** @type {string} */ type) => (l?.includes(type) ? 'Yes' : '');
      valenceBlock.push(el('h4', {}, ['Valence element']),
        el('p', { class: 'note' }, [ties.length > 1
          ? `${ties.join(', ')} do about as well (within 0.5%); the study below uses ${typeName(result.valence?.type ?? '')}.`
          : `${ties[0]} does best; the study below uses it.`]),
        usual,
        el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals model' }, [
          el('thead', {}, [el('tr', {}, ['Element', 'Against the best', '', 'Brozime', 'Community'].map(h => el('th', { scope: 'col' }, [h])))]),
          el('tbody', {}, result.valences.map(v => el('tr', {}, [
            el('th', { scope: 'row' }, [typeName(v.type)]),
            el('td', { class: v.change < -0.005 ? 'neg-text' : '' }, [pct(v.change)]),
            el('td', { class: 'bar-cell' }, [bar(v.change, max)]),
            el('td', {}, [mark(picks?.brozime, v.type)]),
            el('td', {}, [mark(picks?.community, v.type)]),
          ]))),
        ])]));
    } else valenceBlock.push(el('h4', {}, ['Valence element']), usual);
  }

  const k = SHAPES[s.shape].positives;
  const setList = el('ol', { class: 'model-sets' }, result.sets.map(x => {
    const plan = el('button', { type: 'button', class: 'link-button' }, ['Plan']);
    plan.addEventListener('click', () => loadTargetIntoPlanner({
      weapon, cls, positives: x.ids.filter(id => !STAT_BY_ID[id].spliced), spliced: x.ids.find(id => STAT_BY_ID[id].spliced) ?? null, negative: x.curse?.id ?? null,
    }));
    return el('li', {}, [el('strong', {}, [pct(x.change)]), ` ${x.ids.map(name).join(' + ')}${x.curse ? `, −${name(x.curse.id)}` : ''} `, ...killText(x.build, isMelee, isBeam), ' ', plan,
      el('details', { class: 'set-build' }, [el('summary', {}, ['Its build']), buildGrid(x.build),
        ...(isMelee ? [el('p', { class: 'note' }, [`Stance: ${comboName}. Its hits’ damage multipliers and counts count; its timing doesn’t (each attack is one swing at the weapon’s attack speed).`])] : [])])]);
  }));
  const moving = result.singles.filter(e => Math.abs(e.change) >= 0.005);
  const still = result.singles.filter(e => Math.abs(e.change) < 0.005).map(e => name(e.id));
  // An incarnon's evolutions: the perks the study used (the best combination unless you chose).
  /** @type {HTMLElement[]} */
  const perkBlock = [];
  if (evolutions.length && incarnon !== 'normal') {
    const used = result.perks;
    const roman = ['', '', 'II', 'III', 'IV', 'V'];
    const reset = el('button', { type: 'button', class: 'copy-link' }, ['Back to the best']);
    reset.addEventListener('click', () => set({ perks: null }));
    perkBlock.push(el('h4', {}, ['Incarnon evolutions']),
      el('p', { class: 'note' }, [s.perks ? 'Your choice of perks.'
        : 'The perks that do most together with a typical build (every combination tried); change any to see another. '
          + 'Only what a perk always does counts; conditional parts (on headshot, while sliding…) don’t.']),
      el('div', { class: 'controls' }, [
        ...evolutions.map((e, i) => select(`Evolution ${roman[e.evolution]}`,
          e.perks.map((p, k) => /** @type {[string, string]} */ ([String(k), p.name + (p.effects.length ? (p.partly ? ' (partly)' : '') : ' (no damage)')])),
          String(used[i] ?? 0), v => set({ perks: used.map((x, j) => (j === i ? Number(v) : x)), perksOf: weapon }))),
        ...(s.perks ? [reset] : []),
      ]),
      el('ul', { class: 'note perk-list' }, evolutions.flatMap((e, i) => {
        const p = e.perks[used[i]];
        return p ? [el('li', {}, [el('strong', {}, [`${roman[e.evolution]}: ${p.name}`]), ` ${p.text}`])] : [];
      })));
  }
  const out = [head, controls, about, ...perkBlock, ...valenceBlock,
    el('h4', {}, ['Best build without a riven']), ...(result.none.fight ? [el('p', {}, killText(result.none, isMelee, isBeam))] : []), buildGrid(result.none),
    el('h4', {}, [`Best rivens (${k} positives${SHAPES[s.shape].negatives ? ' and a curse' : ''}) over no riven`]), setList,
    el('h4', {}, ['Each positive in the riven slot']),
    el('p', { class: 'note' }, ['Against the riven slot left empty, with the other seven mods re-chosen each time.']),
    table(moving, false),
    ...(still.length ? [el('p', { class: 'note' }, [`No effect on damage: ${still.join(', ')}.`])] : []),
  ];
  if (SHAPES[s.shape].negatives && result.sets[0]) {
    const harmless = result.curses.filter(e => Math.abs(e.change) < 0.005).map(e => name(e.id));
    out.push(el('h4', {}, [`Curses on ${result.cursesOn.map(name).join(' + ')}`]),
      ...(harmless.length ? [el('p', { class: 'note' }, [`Harmless to damage here: ${harmless.join(', ')}.`])] : []),
      table(result.curses.filter(e => Math.abs(e.change) >= 0.005), true));
  }
  return out;
}
