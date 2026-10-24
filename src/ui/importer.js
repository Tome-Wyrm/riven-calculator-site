// @ts-check
// Inventory import: grades every riven in a WFHelper/game inventory JSON or an AlecaFrame
// lastData.dat, using the exact rolls stored in each riven's fingerprint. Everything is read in
// the browser; the file never leaves the machine.

import { STAT_BY_ID } from '../data/stats.js';
import { displayValue, format, letterGrade, rollScore, shapeFor } from '../engine.js';
import { extractRivens, readInventoryFile, unwrapInventory } from '../import.js';
import { el, statName } from './dom.js';
import { loadIntoGrader } from './grader.js';
import { offerShare } from './share.js';

/** @typedef {import('../import.js').ImportedRiven} ImportedRiven */
/** @typedef {import('../import.js').ImportedStat} ImportedStat */

const signed = (/** @type {number} */ x) => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(1)}`;

/** @type {HTMLElement} */
let root;
/** @type {HTMLElement} */
let out;

/**
 * Display text and grade for each stat, at the riven's own rank.
 * @param {ImportedRiven} r @param {ImportedStat[]} stats
 */
function describe(r, stats) {
  const shape = shapeFor(stats.filter(s => s.sign === '+').length, stats.filter(s => s.sign === '-').length);
  return stats.map(s => {
    const stat = s.statId ? STAT_BY_ID[s.statId] : null;
    const score = rollScore(s.u, s.sign === '-');
    if (!stat || !r.cls || !shape || stat.b[r.cls] === undefined) {
      return { s, stat, text: `${s.sign}? ${s.tag}`, score, value: null };
    }
    const value = displayValue(stat, r.cls, shape, s.sign, s.u, r.rank);
    return { s, stat, text: `${format(stat, value)} ${statName(stat, r.cls)}`, score, value };
  });
}

/** @param {ImportedRiven[]} rivens @param {number} veiled */
function showRivens(rivens, veiled) {
  const graded = rivens.map(r => {
    const stats = describe(r, r.stats);
    const pos = stats.filter(d => d.s.sign === '+');
    const avg = pos.length ? pos.reduce((a, d) => a + d.score, 0) / pos.length : -Infinity;
    return { r, stats, avg };
  }).sort((a, b) => b.avg - a.avg);

  const statList = (/** @type {ReturnType<typeof describe>} */ stats) => el('ul', { class: 'stat-list' }, stats.map(d =>
    el('li', { class: d.s.sign === '+' ? 'pos-text' : 'neg-text' }, [
      `${d.text} `, el('b', { class: 'grade' }, [letterGrade(d.score)]), ` (${signed(d.score)}%)`])));

  const rows = graded.map(({ r, stats, avg }) => {
    const load = el('button', { type: 'button', class: 'copy-link' }, ['Open in grader']);
    load.addEventListener('click', () => loadIntoGrader({
      weapon: r.knownWeapon ? r.weapon : '',
      cls: r.cls ?? 'rifle',
      rank: r.rank,
      rows: stats.filter(d => d.stat && d.value !== null)
        .map(d => ({ statId: /** @type {any} */ (d.stat).id, value: (/** @type {number} */ (d.value)).toFixed(d.stat?.unit === 'mult' ? 2 : 1) })),
    }));
    const info = [`rank ${r.rank}`, r.mr ? `MR ${r.mr}` : '', `${r.rerolls} reroll${r.rerolls === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    const cells = [
      el('th', { scope: 'row' }, [r.weapon, el('span', { class: 'sub' }, [info])]),
      el('td', {}, [statList(stats), ...(r.pending
        ? [el('span', { class: 'sub' }, ['Pending cycle (not yet accepted):']), statList(describe(r, r.pending))]
        : [])]),
      el('td', { class: 'grade' }, [Number.isFinite(avg) ? `${letterGrade(avg)} (${signed(avg)}%)` : '—']),
      el('td', {}, [load]),
    ];
    return el('tr', {}, cells);
  });

  const unknown = graded.filter(g => !g.r.knownWeapon || g.stats.some(d => !d.stat)).length;
  const notes = [el('p', { class: 'summary' }, [
    `${rivens.length} riven${rivens.length === 1 ? '' : 's'}` + (veiled ? ` (+${veiled} veiled)` : '') + ', best average first. Grades use the exact rolls, so no rounding.'])];
  if (unknown) notes.push(el('p', { class: 'note warn' }, [`${unknown} riven(s) have a weapon or stat this site doesn't recognise yet.`]));
  const head = el('thead', {}, [el('tr', {}, ['Riven', 'Stats', 'Average', ''].map(h => el('th', { scope: 'col' }, [h])))]);
  out.replaceChildren(...notes, el('div', { class: 'table-wrap' }, [el('table', { class: 'ranges imports' }, [head, el('tbody', {}, rows)])]));
  // Only the rivens read (weapon, rank, cycles, exact rolls), never the inventory itself.
  offerShare({
    kind: 'import',
    summary: `${rivens.length} riven${rivens.length === 1 ? '' : 's'}: ${rivens.slice(0, 5).map(r => r.weapon).join(', ')}${rivens.length > 5 ? ', …' : ''}`,
    data: () => ({
      rivens: rivens.map(r => ({
        weapon: r.weapon, cls: r.cls, rank: r.rank, rerolls: r.rerolls, mr: r.mr,
        stats: r.stats.map(s => ({ tag: s.tag, statId: s.statId, sign: s.sign, u: s.u })),
        ...(r.pending ? { pending: r.pending.map(s => ({ tag: s.tag, statId: s.statId, sign: s.sign, u: s.u })) } : {}),
      })),
      page: location.origin + location.pathname,
    }),
  });
}

/** @param {any} inventory */
function useInventory(inventory) {
  const { rivens, veiled } = extractRivens(inventory);
  if (!rivens.length) {
    out.replaceChildren(el('p', { class: 'note warn' }, [`No unveiled rivens found${veiled ? ` (${veiled} veiled)` : ''}.`]));
    return;
  }
  showRivens(rivens, veiled);
}

/** @param {unknown} err */
const fail = err => out.replaceChildren(el('p', { class: 'note warn' }, [err instanceof Error ? err.message : String(err)]));

/** @param {HTMLElement} container */
export function mountImporter(container) {
  root = container;
  const file = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept: '.json,.dat,.txt', 'aria-label': 'Inventory file' }));
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    out.replaceChildren(el('p', { class: 'note' }, [`Reading ${f.name}…`]));
    try { useInventory(await readInventoryFile(await f.arrayBuffer())); } catch (e) { fail(e); }
  });
  const paste = /** @type {HTMLTextAreaElement} */ (el('textarea', {
    class: 'paste', rows: '3', placeholder: '…or paste inventory JSON here', 'aria-label': 'Inventory JSON',
  }));
  paste.addEventListener('input', () => {
    if (!paste.value.trim()) return;
    const inv = unwrapInventory(paste.value) ?? unwrapInventory(`{"Upgrades":[${paste.value.trim().replace(/,\s*$/, '')}]}`);
    if (inv) useInventory(inv); else fail('That doesn’t look like inventory JSON (or a list of its Upgrades entries).');
  });
  out = el('div', { 'aria-live': 'polite' });
  root.replaceChildren(
    el('h3', {}, ['Import your rivens']),
    el('p', { class: 'note' }, [
      'Load a WFHelper inventory export or game inventory JSON, or AlecaFrame’s lastData.dat ',
      '(in %LOCALAPPDATA%\\AlecaFrame). It’s read in your browser; nothing is uploaded.']),
    el('div', { class: 'controls' }, [el('label', { class: 'field' }, [el('span', {}, ['File']), file])]),
    paste,
    out);
}
