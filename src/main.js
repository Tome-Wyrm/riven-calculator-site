// @ts-check
// Entry point: wires the UI modules to the page.

import { WEAPONS_UPDATED } from './data/weapons.js';
import { mountRanges } from './ui/ranges.js';
import { mountCalculator } from './ui/calculator.js';
import { mountGrader } from './ui/grader.js';
import { mountImporter } from './ui/importer.js';

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// Read before mounting: each view writes its full state into the hash as it renders.
const linked = new Set([...new URLSearchParams(location.hash.slice(1)).keys()].map(k => k.split('.')[0]));

mountRanges(byId('ranges-body'));
mountCalculator(byId('calculator-body'));
mountGrader(byId('grader-body'));
mountImporter(byId('import-body'));
byId('weapons-updated').textContent = WEAPONS_UPDATED;

// Collapsible sections: remember which are closed (a per-viewer convenience, so failures are fine).
// A shared link to one section opens that section and scrolls to it.
const SECTIONS = { r: 'ranges', g: 'calculator', v: 'grader' };
const CLOSED_KEY = 'closedSections';
/** @type {string[]} */
let closed = [];
try { closed = JSON.parse(localStorage.getItem(CLOSED_KEY) || '[]'); } catch { /* storage unavailable */ }

const target = linked.size === 1 ? SECTIONS[/** @type {keyof typeof SECTIONS} */ ([...linked][0])] : undefined;

for (const id of Object.values(SECTIONS)) {
  const details = /** @type {HTMLDetailsElement} */ (byId(id));
  details.open = id === target || !closed.includes(id);
  details.addEventListener('toggle', () => {
    closed = Object.values(SECTIONS).filter(s => !(/** @type {HTMLDetailsElement} */ (byId(s))).open);
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify(closed)); } catch { /* storage unavailable */ }
  });
}
if (target) byId(target).scrollIntoView();
