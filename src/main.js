// @ts-check
// Entry point: wires the UI modules to the page.

import { WEAPONS_UPDATED } from './data/weapons.js';
import { mountRanges } from './ui/ranges.js';
import { mountCalculator } from './ui/calculator.js';
import { mountGrader } from './ui/grader.js';

mountRanges(/** @type {HTMLElement} */ (document.getElementById('ranges-body')));
mountCalculator(/** @type {HTMLElement} */ (document.getElementById('calculator-body')));
mountGrader(/** @type {HTMLElement} */ (document.getElementById('grader-body')));
/** @type {HTMLElement} */ (document.getElementById('weapons-updated')).textContent = WEAPONS_UPDATED;
