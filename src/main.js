// @ts-check
// Entry point: wires the UI modules to the page.

import { mountRanges } from './ui/ranges.js';

mountRanges(/** @type {HTMLElement} */ (document.getElementById('ranges-body')));
