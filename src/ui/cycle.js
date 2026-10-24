// @ts-check
// Cycle planner: the chance a Kuva cycle gives the stats you want, and the Kuva it's likely to cost.

import { CLASSES, ORDINARY, SHAPES, STAT_BY_ID } from '../data/stats.js';
import { SHAPE_ORDER } from '../engine.js';
import { WEAPONS } from '../data/weapons.js';
import { cycleChance, kuvaPlan, pools } from '../cycle.js';
import { CLASS_LABEL, el, statName, segmented, select, weaponPicker, copyLinkButton, ipsOf } from './dom.js';
import { loadState, saveState, pick, oneOf, num } from './state.js';

/** @typedef {import('../data/stats.js').WeaponClass} WeaponClass */
/** @typedef {import('../data/stats.js').Shape} Shape */

const NONE = '';
const state = {
  weapon: 'Felarx',
  cls: /** @type {WeaponClass} */ ('shotgun'),
  want: ['multishot', 'critChance', NONE],
  negMode: /** @type {'any' | 'none' | 'pick'} */ ('any'),
  negPick: /** @type {string[]} */ ([]),
  lockStat: NONE,
  lockSign: /** @type {'+' | '-'} */ ('+'),
  lockShape: /** @type {Shape} */ ('++-'),
  rerolls: 0,
};

const pct = (/** @type {number} */ x) => (x === 0 ? '0%' : x < 0.001 ? `${(x * 100).toPrecision(2)}%` : `${(x * 100).toFixed(x < 0.1 ? 2 : 1)}%`);
const kuva = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-US');

function controls() {
  const set = (/** @type {Partial<typeof state>} */ patch) => { Object.assign(state, patch); render(); };
  const { positive, negative } = pools(state.cls, ipsOf(state.weapon));
  const nameOf = (/** @type {string} */ id) => statName(STAT_BY_ID[id], state.cls);
  const posOptions = /** @type {[string, string][]} */ ([[NONE, '—'], ...positive.map(id => [id, nameOf(id)])]);
  state.want = state.want.map(id => (id === NONE || positive.includes(id) ? id : NONE));
  state.negPick = state.negPick.filter(id => negative.includes(id));

  const wantSelects = state.want.map((id, i) => select(`Want ${i + 1}`, posOptions, id, v => {
    const want = [...state.want];
    want[i] = v;
    set({ want });
  }));

  const negBoxes = state.negMode === 'pick'
    ? el('div', { class: 'checks' }, negative.map(id => {
      const box = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', ...(state.negPick.includes(id) ? { checked: '' } : {}) }));
      box.addEventListener('change', () => set({ negPick: box.checked ? [...state.negPick, id] : state.negPick.filter(x => x !== id) }));
      return el('label', { class: 'check' }, [box, nameOf(id)]);
    }))
    : null;

  const lockOptions = /** @type {[string, string][]} */ ([[NONE, 'No lock'], ...ORDINARY.filter(s => s.b[state.cls] !== undefined).map(s => [s.id, nameOf(s.id)])]);
  const rerolls = /** @type {HTMLInputElement} */ (el('input', { type: 'number', min: '0', step: '1', value: String(state.rerolls), 'aria-label': 'Cycles done so far' }));
  rerolls.addEventListener('input', () => {
    const n = Number(rerolls.value);
    if (Number.isInteger(n) && n >= 0) { state.rerolls = n; renderResults(); }
  });

  return el('div', {}, [
    el('div', { class: 'controls' }, [
      weaponPicker(WEAPONS, state.weapon, (weapon, cls) => set({ weapon, cls })),
      segmented('Weapon class', CLASSES, state.cls, v => set({ cls: /** @type {WeaponClass} */ (v), weapon: '' }),
        v => CLASS_LABEL[/** @type {WeaponClass} */ (v)]),
    ]),
    el('div', { class: 'controls' }, wantSelects),
    el('div', { class: 'controls' }, [
      el('span', { class: 'field' }, ['Negative']),
      segmented('Negative', ['any', 'none', 'pick'], state.negMode, v => set({ negMode: /** @type {any} */ (v) }),
        v => ({ any: "Don't care", none: 'No negative', pick: 'Only these…' })[/** @type {'any'} */ (v)]),
    ]),
    ...(negBoxes ? [negBoxes] : []),
    el('div', { class: 'controls' }, [
      select('Locked trait', lockOptions, state.lockStat, v => set({ lockStat: v })),
      ...(state.lockStat
        ? [segmented('Locked as', ['+', '-'], state.lockSign, v => set({ lockSign: /** @type {'+' | '-'} */ (v) }), v => (v === '+' ? 'Positive' : 'Negative')),
          select('Shape', SHAPE_ORDER.map(s => /** @type {[string, string]} */ ([s, s])), state.lockShape, v => set({ lockShape: /** @type {Shape} */ (v) }))]
        : []),
      el('label', { class: 'field target' }, [el('span', {}, ['Cycles done']), rerolls]),
    ]),
  ]);
}

function results() {
  const want = state.want.filter(Boolean);
  const lock = state.lockStat ? { statId: state.lockStat, sign: state.lockSign, shape: state.lockShape } : null;
  const negative = state.negMode === 'pick' ? state.negPick : state.negMode;
  const problems = [];
  if (new Set(want).size !== want.length) problems.push('The same stat is wanted twice.');
  if (state.negMode === 'pick' && !state.negPick.length) problems.push('Tick at least one acceptable negative.');
  if (lock) {
    const slots = SHAPES[lock.shape].positives;
    const wanted = new Set([...want, ...(lock.sign === '+' ? [lock.statId] : [])]);
    if (wanted.size > slots) problems.push(`A ${lock.shape} riven only has ${slots} positives.`);
    if (lock.sign === '-' && want.includes(lock.statId)) problems.push('A stat locked as the negative can\'t also be wanted as a positive.');
    if (lock.sign === '-' && SHAPES[lock.shape].negatives === 0) problems.push(`A ${lock.shape} riven has no negative to lock.`);
  }
  if (!want.length) problems.push('Pick at least one stat you want.');
  if (problems.length) return el('div', {}, problems.map(p => el('p', { class: 'note warn' }, [p])));

  const odds = cycleChance({ cls: state.cls, ipsCode: ipsOf(state.weapon), want, negative, lock });
  const plan = kuvaPlan(odds.total, state.rerolls, !!lock);
  const rows = Object.entries(odds.byShape).map(([shape, p]) => el('tr', {}, [el('th', { scope: 'row' }, [shape]), el('td', {}, [pct(p)])]));
  const summary = plan
    ? `${pct(odds.total)} per cycle: about ${plan.expectedCycles < 10 ? plan.expectedCycles.toFixed(1) : Math.round(plan.expectedCycles).toLocaleString('en-US')} cycles (${kuva(plan.expectedKuva)} Kuva) on average.`
    : "That combination can't come up.";
  return el('div', {}, [
    el('p', { class: 'summary' }, [summary]),
    ...(plan ? [el('p', { class: 'note' }, [
      `50% chance within ${plan.median.cycles.toLocaleString('en-US')} cycles (${kuva(plan.median.kuva)} Kuva); `
      + `90% within ${plan.likely.cycles.toLocaleString('en-US')} (${kuva(plan.likely.kuva)} Kuva). `
      + `Costs start from cycle ${state.rerolls + 1}${lock ? ', doubled for the locked trait' : ''}.`])] : []),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges goals' }, [
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col' }, ['Shape']), el('th', { scope: 'col' }, ['Chance if this shape rolls'])])]),
      el('tbody', {}, rows)])]),
    el('p', { class: 'note' }, [
      'Assumes the community model: each shape equally likely when unlocked, stats drawn evenly with no repeats. ',
      'Rolls aren\'t counted here; the goal calculator covers how high a stat rolls.']),
  ]);
}

/** @type {HTMLElement} */
let root;
/** @type {HTMLElement} */
let resultsBox;

function renderResults() {
  resultsBox.replaceChildren(results());
  saveState('c', {
    weapon: state.weapon, cls: state.cls, want: state.want.filter(Boolean).join(','),
    neg: state.negMode === 'pick' ? state.negPick.join(',') : state.negMode,
    lock: state.lockStat ? `${state.lockStat}:${state.lockSign}:${state.lockShape}` : '', rerolls: state.rerolls,
  });
}

function render() {
  resultsBox = el('div', { 'aria-live': 'polite' });
  root.replaceChildren(controls(), resultsBox, copyLinkButton('c'));
  renderResults();
}

function restore() {
  const saved = pick(loadState('c'), {
    weapon: v => WEAPONS.find(w => w[0] === v)?.[0],
    cls: oneOf(CLASSES),
    want: v => v.split(',').filter(id => STAT_BY_ID[id]).slice(0, 3),
    neg: v => v,
    lock: v => v,
    rerolls: num(0, 100000),
  });
  if (saved.weapon !== undefined) {
    state.weapon = saved.weapon;
    state.cls = /** @type {WeaponClass} */ (WEAPONS.find(w => w[0] === saved.weapon)?.[1]);
  } else if (saved.cls) { state.weapon = ''; state.cls = saved.cls; }
  if (saved.want) state.want = [...saved.want, NONE, NONE, NONE].slice(0, 3);
  if (saved.neg === 'any' || saved.neg === 'none') state.negMode = saved.neg;
  else if (saved.neg) { state.negMode = 'pick'; state.negPick = saved.neg.split(',').filter(id => STAT_BY_ID[id]); }
  if (saved.lock) {
    const [id, sign, shape] = saved.lock.split(':');
    if (STAT_BY_ID[id] && (sign === '+' || sign === '-') && SHAPE_ORDER.includes(/** @type {Shape} */ (shape))) {
      Object.assign(state, { lockStat: id, lockSign: sign, lockShape: shape });
    }
  }
  if (saved.rerolls !== undefined) state.rerolls = Math.round(saved.rerolls);
}

/** @param {HTMLElement} container */
export function mountCycle(container) {
  root = container;
  restore();
  render();
}
