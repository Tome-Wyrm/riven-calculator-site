// @ts-check
// The damage model's view of a gun's riven, under its community picks: the best build without a
// riven, the best rivens (each with the build re-chosen around it), what each stat is worth in the
// riven's slot, and what each curse costs on the best riven, against a chosen target (a unit at a
// level, src/enemies.js). The work (src/study.js) runs in a worker, about a second per setting.

import { STAT_BY_ID, SHAPES } from '../data/stats.js';
import { SHAPE_ORDER } from '../engine.js';
import { VALENCE_TYPES } from '../sim.js';
import { takesAdapter } from '../incarnon.js';
import { defaultModel, modelInput, comboId, ROLES } from '../model-input.js';
import { SCENARIOS } from '../build.js';
import { studiesOf, studyKey } from '../studies.js';
import { VALENCE_PICKS } from '../data/valence-picks.js';
import { crowdRadius } from '../crowd.js';
import { BUFFS, BUFF_GROUPS } from '../data/buffs.js';
import { buildOf, buildSlug, buildsFor, ownFromText, ownText } from '../buffs.js';
import { picksFor, communityFit } from '../picks.js';
import { el, statName, segmented, select } from './dom.js';
import { oneOf } from './state.js';
import { loadTargetIntoPlanner } from './planner.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */
/** @typedef {ReturnType<typeof import('../study.js').study>} Study */

/** The kinds of build (src/build.js SCENARIOS). Weak points are a build of their own: hitting them is hard. */
/** @type {Record<string, string>} */
/** A damage type's name: "heat" → "Heat". @param {string} id */
const typeName = id => id[0].toUpperCase() + id.slice(1);
/** @type {Record<string, string>} */

export const modelState = defaultModel();

/** The URL fields for the model's settings (defaults left out). */
export function modelFields() {
  const s = modelState;
  return {
    shape: s.shape === '+++-' ? '' : s.shape, mode: s.mode < 0 ? '' : s.mode, sc: s.scenario === 'room' ? '' : s.scenario,
    enemy: s.enemy, unit: s.unit, lvl: s.level !== 150 ? s.level : '', sp: s.steelPath ? 1 : '',
    armor: s.armor || '', primed: s.primed ? 1 : '', burst: s.burst ? 1 : '', spread: s.spread ? 1 : '', en: s.energy || '', shd: s.shields || '', xp: s.exposure ? '' : '0',
    buffs: s.buffs.join('.'), bb: Object.entries(s.builds).filter(([id]) => s.buffs.includes(id)).map(e => e.join(':')).join('.'), own: ownText(s.own), str: s.strength === 100 ? '' : s.strength, dur: s.duration === 100 ? '' : s.duration, pz: s.panzer === 5 ? '' : s.panzer, ex: s.eximus === 5 ? '' : s.eximus, hd: s.heads === 90 ? '' : s.heads,
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
  if (raw.sc === 'single' || raw.sc === 'weak' || raw.sc === 'slam') modelState.scenario = raw.sc;
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
  modelState.shields = count(raw.shd, 9999) ?? 0;
  modelState.exposure = raw.xp !== '0';
  modelState.buffs = (raw.buffs ?? '').split('.').filter(id => BUFFS.some(b => b.id === id));
  modelState.builds = Object.fromEntries((raw.bb ?? '').split('.').map(e => e.split(':')).filter(e => e.length === 2));
  // A link from before buffs had builds keeps its numbers.
  if ((raw.str || raw.dur) && !raw.bb) modelState.builds = Object.fromEntries(modelState.buffs.map(id => [id, 'x']));
  modelState.own = ownFromText(raw.own ?? '');
  modelState.strength = count(raw.str, 999) ?? 100;
  modelState.duration = count(raw.dur, 999) ?? 100;
  modelState.panzer = count(raw.pz, 10) ?? 5;
  modelState.eximus = count(raw.ex, 20) ?? 5;
  modelState.heads = count(raw.hd, 100) ?? 90;
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
/** Whether the buff list is open. */
let buffsOpen = false;
/** The model's settings sections open (Target, Arcane…), kept as the page redraws. @type {Set<string>} */
const openSections = new Set();
/** What became of the last link pasted under Buffs. */
let ownNote = '';

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
  // A precomputed study for exactly this input (the default settings) is shown at once; else the search.
  studiesOf(input.weapon).then(stored => {
    const hit = stored[studyKey(input)];
    if (hit && !(/** @type {any} */ (hit)).error) { done(/** @type {Study} */ (hit)); return; }
    try {
      worker ??= new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => { studies.set(e.data.key, e.data.error ? { error: e.data.error } : e.data.result); onDone(); };
      worker.postMessage({ key, input });
    } catch {
      setTimeout(() => import('../study.js').then(m => done(m.study(input))).catch(e => done({ error: String(e) })), 30);
    }
  });
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
  const set = (/** @type {Partial<typeof modelState>} */ patch) => { Object.assign(s, patch); rerender(); };
  const m = /** @type {NonNullable<ReturnType<typeof modelInput>>} */ (modelInput(weapon, cls, s, { stats, enemies }));
  const { isMelee, role, evolutions, incarnon, modes, mode, isBeam, cycle, group, units, unit, target, battlegroup, mix, levels, arcanes, combos, chosen, comboName, usable, chosenBuffs, scales, each, opts, pool, input } = m;
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
    ...(combos.length ? [select('Stance combo', combos.map(c => /** @type {[string, string]} */ ([comboId(c), `${c.label} (${c.perSwing.toFixed(1)}x ${c.slam ? 'a slam' : 'a swing'})`])),
      chosen ? comboId(chosen) : '', v => set({ stanceCombo: v === comboId(combos[0]) ? '' : v }))] : []),
    el('div', { class: 'field' }, [el('span', {}, ['Combo counter']), segmented('Combo counter', ['initial', 'max', 'build'], s.combo,
      v => set({ combo: /** @type {'initial' | 'max' | 'build'} */ (v) }), v => ({ initial: 'Initial', max: 'Max (12x)', build: 'Built up' })[v] ?? v,
      () => 'Held at the initial combo, held at the max, or built up by the hits (room clearing carries it from kill to kill)')]),
    ...(w.melee?.heavy && role !== 'slam' ? [el('div', { class: 'field' }, [el('span', {}, ['Attacks']), segmented('Attacks', ['normal', 'heavy'], s.heavy ? 'heavy' : 'normal',
      v => set({ heavy: v === 'heavy' }), v => ({ normal: 'Normal', heavy: 'Heavy' })[v] ?? v,
      () => 'Normal attacks only, or heavy attacks: a built-up counter spends its combo at the tier below; a held one heavy attacks every time')])] : []),
    ...(w.melee?.heavy && s.heavy && s.combo === 'build' && role !== 'slam' ? [num('Heavy at tier', s.heavyAt, 12, v => set({ heavyAt: Math.max(1, v) }))] : []),
    num('In the swing', s.nearby, 20, v => set({ nearby: Math.max(1, v) })),
    num('Within 20 m', s.close, 40, v => set({ close: v })),
    num('Clumping %', s.clump, 100, v => set({ clump: v })),
  ] : [];
  const withBuild = chosenBuffs.filter(b => scales(b) && buildsFor(b, s.own).length);
  const buildLabel = (/** @type {import('../buffs.js').BuffBuild} */ x) => `${x.frame}: ${x.tab}, ${x.strength}%${x.molt ? ' +60 Molt' : ''}${x.bellicose ? ' +72 Bellicose' : ''}`;
  // A build of one's own, from an Underframe link.
  const link = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: 'underframe.site/share#v4…', spellcheck: 'false', autocomplete: 'off' }));
  const take = async () => {
    const text = link.value.trim();
    if (!text) return;
    link.value = '';
    try {
      const { ownBuild, readLink } = await import('../underframe.js');
      const read = await readLink(text);
      const b = ownBuild(read);
      const precision = read.mods.some(m => m.name === 'Precision Intensify');
      ownNote = [
        `Read ${b.tab} (${b.frame}): ${read.mods.length} mods${read.helminth ? `, ${read.helminth.name} subsumed` : ''}.`,
        read.unknown ? `${read.unknown} mods this page doesn’t know, so not counted.` : '',
        b.molt || b.bellicose ? `At their maximum: ${[b.molt && 'Molt Augmented +60', b.bellicose && 'Arcane Bellicose +72 at 3000 Health'].filter(Boolean).join(', ')}.` : '',
        precision ? (b.fourth ? `Precision Intensify’s +90 goes on ${read.helminth?.name} only.` : 'Precision Intensify’s +90 isn’t counted: this page only knows the 4th slot when an ability is subsumed there.') : '',
        `Tick a ${b.frame} buff${b.sub ? ` or ${b.sub} (subsumed)` : ''} to use it.`,
      ].filter(Boolean).join(' ');
      set({ own: [...s.own.filter(o => buildSlug(o) !== buildSlug(b)), b] });
    } catch (e) {
      ownNote = `Couldn’t read it: ${e instanceof Error ? e.message : e}.`;
      set({});
    }
  };
  link.addEventListener('change', take);
  link.addEventListener('paste', () => setTimeout(take));
  // Buffs, by group, each a tick box; the list stays open as the page redraws.
  const buffList = /** @type {HTMLDetailsElement} */ (el('details', { class: 'buffs', ...(buffsOpen ? { open: '' } : {}) }, [
    el('summary', {}, [`Buffs${chosenBuffs.length ? ` (${chosenBuffs.length})` : ''}`]),
    el('div', { class: 'controls' }, [num('Ability Strength %', s.strength, 999, v => set({ strength: v })), num('Ability Duration %', s.duration, 999, v => set({ duration: v })),
      ...(chosenBuffs.some(b => b.only === 'companion') ? [num('Primer stacks', s.panzer, 10, v => set({ panzer: v }))] : []),
      ...(chosenBuffs.some(b => b.id === 'xata') ? [num('Void bubble head hits %', s.heads, 100, v => set({ heads: v }))] : [])]),
    el('div', { class: 'controls own-builds' }, [
      el('label', { class: 'field own-link', title: 'From Share on Underframe, before Minify. Only the Strength and Duration it adds up to go in this page’s address.' }, [el('span', {}, ['Your build (Underframe link)']), link]),
      ...s.own.map(b => {
        const drop = el('button', { type: 'button', class: 'own-drop', 'aria-label': `Remove ${b.tab}` }, ['×']);
        drop.addEventListener('click', () => { ownNote = ''; set({ own: s.own.filter(o => o !== b) }); });
        return el('span', { class: 'own-build' }, [`${buildLabel(b)}, ${b.duration}% Duration`, drop]);
      }),
    ]),
    ...(ownNote ? [el('p', { class: 'note' }, [ownNote])] : []),
    ...BUFF_GROUPS.filter(group => usable.some(b => b.group === group)).map(group => el('fieldset', {}, [el('legend', {}, [group]), ...usable.filter(b => b.group === group).map(b => {
      const box = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', ...(s.buffs.includes(b.id) ? { checked: '' } : {}) }));
      // (One companion: taking one drops the other.)
      const others = BUFFS.filter(o => b.only && o.only === b.only).map(o => o.id);
      box.addEventListener('change', () => set({ buffs: box.checked ? [...s.buffs.filter(id => !others.includes(id)), b.id] : s.buffs.filter(id => id !== b.id) }));
      return el('label', { title: b.from }, [box, ` ${b.name}`]);
    })])),
    ...(withBuild.length ? [el('div', { class: 'controls buff-builds' }, withBuild.map(b => {
      const o = buildOf(b, s.builds[b.id], s.own);
      return select(`${b.name} from`, [
        ...buildsFor(b, s.own).map(x => /** @type {[string, string]} */ ([buildSlug(x), buildLabel(x)])),
        ['x', 'The boxes above'],
      ], o ? buildSlug(o) : 'x', v => set({ builds: { ...s.builds, [b.id]: v } }));
    }))] : []),
  ]));
  buffList.addEventListener('toggle', () => { buffsOpen = buffList.open; });
  // The settings most want up front: the riven's shape, the fire mode and what the build is for. The
  // rest in sections that stay shut unless opened (each says what it's set to), open as the page redraws.
  const section = (/** @type {string} */ id, /** @type {string} */ title, /** @type {string} */ now, /** @type {HTMLElement[]} */ fields) => {
    const d = /** @type {HTMLDetailsElement} */ (el('details', { class: 'buffs model-section', ...(openSections.has(id) ? { open: '' } : {}) }, [
      el('summary', {}, [title, ...(now ? [el('span', { class: 'section-now' }, [` · ${now}`])] : [])]),
      el('div', { class: 'controls' }, fields),
    ]));
    d.addEventListener('toggle', () => { if (d.open) openSections.add(id); else openSections.delete(id); });
    return d;
  };
  const roles = ROLES.filter(([id]) => id !== 'slam' || isMelee);
  const controls = el('div', { class: 'controls model-controls' }, [
    el('div', { class: 'field' }, [el('span', {}, ['Shape']), segmented('Shape', SHAPE_ORDER, s.shape, v => set({ shape: /** @type {Shape} */ (v) }))]),
    ...(evolutions.length ? [el('div', { class: 'field' }, [el('span', {}, ['Incarnon']), segmented('Incarnon', takesAdapter(weapon) ? ['normal', 'off', 'on'] : ['off', 'on'], incarnon,
      v => set({ incarnon: /** @type {'normal' | 'off' | 'on'} */ (v), mode: -1 }), v => ({ normal: 'No adapter', off: takesAdapter(weapon) ? 'Adapter, normal fire' : 'Normal fire', on: 'Incarnon' })[v] ?? v,
      v => ({ normal: 'The plain gun, no Incarnon Genesis adapter: no perks', off: 'The evolutions’ perks, never transforming', on: 'The evolutions’ perks: charge the gauge, transform, fire the form dry, again' })[v] ?? v)])] : []),
    ...(modes.length > 1 && role !== 'slam' ? [select('Fire mode', modes.map(i => /** @type {[string, string]} */ ([String(i), w.modes[i].name])), String(mode), v => set({ mode: Number(v) }))] : []),
    el('div', { class: 'field' }, [el('span', {}, ['Build for']), segmented('Build for', roles.map(([id]) => id), role,
      v => set({ scenario: /** @type {import('../model-input.js').Role} */ (v), stanceCombo: '' }), v => ROLES.find(([id]) => id === v)?.[1] ?? v,
      v => ({ room: 'Clearing rooms: kills keep on-kill stacks up', single: 'One tough target: no kill stacks', weak: 'Every direct hit on a weak point', slam: 'Slam attacks through rooms: Slam Attack Damage counts' })[v] ?? v)]),
  ]);
  const unitText = mix ? `${mix.name} battlegroup` : unit ? unit.name : group?.name ?? 'Any';
  const sections = [
    section('target', 'Target', `${unitText}, level ${s.level}${s.steelPath ? ' SP' : ''}, armor ${s.armor ? 'full' : 'stripped'}${s.primed ? ', primed' : ''}`, [
      select('Enemy', [['', 'Any (no faction bonus)'], ...enemies.GROUPS.map(g => /** @type {[string, string]} */ ([g.id, g.name]))], group?.id ?? '',
        v => set({ enemy: v, unit: '' })),
      ...(unit ? [
        ...(mix ? [num('Eximus of the 20', s.eximus, 20, v => set({ eximus: v }))] : []),
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
      ...(!isMelee && SCENARIOS[m.scenario].kills ? [num('Within 20 m', s.close, 40, v => set({ close: v })), num('Clumping %', s.clump, 100, v => set({ clump: v }))] : []),
    ]),
    ...(isMelee ? [section('melee', role === 'slam' ? 'Slam' : 'Stance and combo', `${comboName}, ${{ initial: 'initial combo', max: 'max combo', build: 'combo built up' }[s.combo]}${s.heavy && w.melee?.heavy ? ', heavy attacks' : ''}`, meleeControls)] : []),
    ...(arcanes.length ? [section('arcane', 'Arcane', s.arcane === null ? 'the best found' : s.arcane || 'none', [
      select('Arcane', [['*', 'Best (searched)'], ['-', 'None'], ...arcanes.map(a => /** @type {[string, string]} */ ([a, a]))],
        s.arcane === null ? '*' : s.arcane || '-', v => set({ arcane: v === '*' ? null : v === '-' ? '' : v })),
      ...(arcanes.includes('Primary Overcharge') ? [num('Max Energy', s.energy, 9999, v => set({ energy: v }))] : []),
      ...(arcanes.includes('Melee Retaliation') ? [num('Current shields', s.shields, 9999, v => set({ shields: v }))] : []),
      ...(arcanes.includes('Melee Exposure') ? [el('div', { class: 'field' }, [el('span', {}, ['Melee Exposure']), segmented('Melee Exposure', ['on', 'off'], s.exposure ? 'on' : 'off',
        v => set({ exposure: v === 'on' }), v => (v === 'on' ? 'Capped' : 'Off'),
        v => (v === 'on' ? 'Abilities cast often enough to keep its 240% Corrosive stacked' : 'Abilities cast too rarely to stack it: it counts for nothing'))])] : []),
    ])] : []),
    buffList,
    ...(w.adversary || !isMelee ? [section('weapon', 'Weapon', [w.adversary ? `Valence ${s.valence === 'best' ? 'best' : typeName(s.valence)} ${s.valencePct}%` : '', !isMelee ? (s.burst ? 'burst DPS' : 'with reloads') : ''].filter(Boolean).join(', '), [
      ...(w.adversary ? [
        select('Valence bonus', [['best', 'Best (each tried)'], ...VALENCE_TYPES.map(v => /** @type {[string, string]} */ ([v, typeName(v)]))], s.valence, v => set({ valence: v })),
        el('label', { class: 'field' }, [el('span', {}, ['Bonus %']), valencePct]),
      ] : []),
      ...(isMelee ? [] : [el('div', { class: 'field' }, [el('span', {}, ['DPS']), segmented('DPS', ['sustained', 'burst'], s.burst ? 'burst' : 'sustained',
        v => set({ burst: v === 'burst' }), v => (v === 'burst' ? 'Burst' : 'With reloads'))])]),
    ])] : []),
  ];
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
      slam: 'Slam: room clearing with slam attacks, kills keeping on-kill stacks at their maximum',
    }[role]}; aiming bonuses count. ${w.adversary
      ? `The Valence bonus (${s.valencePct}%${s.valence === 'best' ? ', the element whose best build does most' : ` ${typeName(s.valence)}`}) is the weapon’s own damage: elemental mods scale from the base with it, and a base element joins after the mods (Heat, Cold, Electricity, Toxin order), so it changes which elements the mods can make. `
      : ''}${s.primed
      ? 'Primed target: every status type on it (a primer companion’s or the squad’s work), Viral and Corrosive at 10 stacks, Heat burning. '
      : 'Per status type bonuses (Galvanized) count the status types the weapon keeps up by itself. '}`
    + (mix ? `Target: the Simulacrum’s ${mix.name} battlegroup${group ? '' : ' without its faction weaknesses'} (${mix.members.map(([name, n]) => `${n} ${name}`).join(', ')}), level ${s.level}${s.steelPath ? ' Steel Path' : ''}, ${s.armor ? 'full armor' : 'armor stripped'}, killed one after another, ${s.eximus} of them Eximus: DPS is their health, shields and Overguard over the time the 20 take, shots and seconds an average kill’s, the first shot on the toughest. ` : '')
    + (!mix && unit && target ? `Target: ${unit.name}${group ? (group.bane ? '' : ` (${group.name}: no riven faction stat applies)`) : ' (no faction weaknesses)'}, level ${s.level}${s.steelPath ? ' Steel Path' : ''}: ${big(target.health)} health`
      + `${target.shields ? `, ${big(target.shields)} shields (Toxin skips them; Magnetic procs multiply damage to them)` : ''}`
      + `, ${target.armor ? `${Math.round(target.armor)} armor` : 'armor stripped'}${weakText(target.weak)}. ` : '')
    + (isMelee ? `${s.heavy && w.melee?.heavy ? `Heavy attacks: ${w.melee.heavy} damage x the combo multiplier, one hit after the ${w.melee.windUp} s wind up (Wind Up Speed shortens it, attack speed doesn’t; no recovery counted), ${s.combo === 'build' ? `spending the combo at ${s.heavyAt}x, keeping Heavy Attack Efficiency’s share (at most 90%); spent Initial Combo returns at 40 a second` : 'every attack, the counter held'}; True Steel’s and rivens’ Critical Chance count twice. ` : ''}Melee: no finishers yet, ${opts.melee?.heavySlam ? `every attack the heavy slam (${comboName}): a heavy attack, so x the combo multiplier, spending the combo down to Heavy Attack Efficiency’s share, a built-up counter climbing back to the initial combo between slams at 40 a second; no wind up; its hits’ multipliers, slam hits times 1 + Slam Attack Damage` : chosen?.slam ? `every attack the slam (${comboName}): its hits’ multipliers and counts, slam hits times 1 + Slam Attack Damage (Seismic Wave, rivens), not its timing` : `a swing being the next attack of the stance combo (${comboName}): its hits’ multipliers and counts (slam hits in it times 1 + Slam Attack Damage), not its timing`}. `
      + `The combo counter is ${{ initial: 'held at the initial combo', max: 'held at 12x', build: 'built up by the hits (each hit adds its multiplier in points; room clearing carries it from kill to kill)' }[s.combo]}; Blood Rush and Weeping Wounds add theirs per tier past 1x. `
      + `Room clearing: ${s.nearby} enem${s.nearby === 1 ? 'y' : 'ies'} in each swing, each further one at ${Math.round((w.melee?.ft ?? 1) * 100)}% follow through of the one before; `
      + `Melee Influence spreads elemental procs to ${s.close} enem${s.close === 1 ? 'y' : 'ies'} within 20 m, each taking 1 + ${s.clump}% x the others as copies (clumped enemies pass it on to each other). ` : '')
    + (cycle && !s.burst ? `Incarnon: normal fire until the gauge fills (${cycle.hits} ${cycle.any ? 'hits' : `weak point hits, each pellet counting, ${role === 'weak' ? 'every hit' : '75% of hits'} on them while charging, which speeds the gauge but isn’t counted as damage`}), a reload’s time to transform, then the form’s ${cycle.ammo} ammo, and under a second back. ${s.scenario === 'single' ? 'The gauge starts full. ' : ''}` : '')
    + (incarnon === 'on' && s.burst ? 'Incarnon, burst: the whole fight in the form. ' : '')
    + (opts.spread ? `Judged at levels ${levels[0]}, ${s.level} and ${levels[1]}: DPS and percentages are the geometric mean of the three (each level counts the same); shots and seconds are level ${s.level}’s. ` : '')
    + (arcanes.includes('Melee Retaliation') ? (s.shields ? `Melee Retaliation at ${s.shields} current shields: +${Math.round(Math.min(420, 0.15 * s.shields))}% Melee Damage (420% takes 2,800; overshields don’t count). ` : 'Melee Retaliation counts for nothing until you give your current shields (under Arcane): its 420% takes 2,800, which few frames hold. ') : '')
    + (arcanes.includes('Primary Overcharge') ? (s.energy ? `Primary Overcharge at ${s.energy} Max Energy: +${Math.round(Math.min(350, 0.35 * s.energy))}% Multishot, taken to be always on (it wants 90% Energy or more). ` : 'Primary Overcharge counts for nothing until you give your Max Energy. ') : '')
    + (opts.crowd ? `A crowd of ${s.close} enem${s.close === 1 ? 'y' : 'ies'} around each target, within ${Math.round(crowdRadius(opts.crowd))} m at ${s.clump}% clumping: explosions, chains and Punch Through reach them, and the room falls that much faster. ` : '')
    + (opts.buffs ? `Buffs (conditional ones at their maximum): ${chosenBuffs.map(b => (each[b.id] ? `${b.name} at ${Math.round(each[b.id].strength * 100)}% Strength` : b.name)).join(', ')}${chosenBuffs.some(b => !each[b.id] && scales(b)) ? `; the others at ${s.strength}% Strength, ${s.duration}% Duration` : ''}. ` : '')
    + (isBeam ? `A beam: Multishot rolls to a whole number each tick and multiplies its damage and status chance, not its crits, so it counts twice in damage over time and Hunter Munitions rolls once a tick. It starts each target at ${Math.round(w.modes[mode].held * 100)}% damage, full after 0.6 s. ` : '')
    + 'A guide, not gospel: a good build, not a proven best, and it can’t see ammo economy or your frame.'
    + (s.armor ? ' Against full armor, Heat and Corrosive lead because their procs strip it; most squads strip armor with abilities instead.' : '')]);

  // How it all is judged, for those who want it.
  const aboutBox = /** @type {HTMLDetailsElement} */ (el('details', { class: 'buffs model-section', ...(openSections.has('about') ? { open: '' } : {}) }, [el('summary', {}, ['How builds are judged']), about]));
  aboutBox.addEventListener('toggle', () => { if (aboutBox.open) openSections.add('about'); else openSections.delete('about'); });
  const result = studyOf(input, rerender);
  if (result === 'pending') return [head, controls, ...sections, aboutBox, el('p', { class: 'note busy' }, ['Working out the builds…'])];
  if ('error' in result) return [head, controls, ...sections, el('p', { class: 'note warn' }, [`The model failed: ${result.error}`])];

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
  const out = [head, controls, ...sections, aboutBox, ...perkBlock, ...valenceBlock,
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
