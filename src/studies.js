// @ts-check
// Precomputed riven studies (tools/precompute-studies.mjs): one file a weapon, each study keyed by the
// md5 of its input, so one is only ever used for exactly the input it was made from.

import { md5 } from './md5.js';

/** A weapon's studies file name: "Soma Prime" → "soma-prime". @param {string} name */
export const studySlug = name => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Whether studies ship with the site (PLAN.md, "Precomputed results"): until then, nothing is fetched. */
const SHIPPED = false;

/** @type {Map<string, Promise<Record<string, unknown>>>} */
const files = new Map();

/**
 * A weapon's precomputed studies, fetched once (none when there's no file, or it can't be fetched).
 * @param {string} weapon @returns {Promise<Record<string, unknown>>}
 */
export function studiesOf(weapon) {
  let f = files.get(weapon);
  if (!f) {
    f = !SHIPPED ? Promise.resolve({}) : fetch(new URL(`./data/studies/${studySlug(weapon)}.json`, import.meta.url))
      .then(r => (r.ok ? r.json() : {})).catch(() => ({}));
    files.set(weapon, f);
  }
  return f;
}

/** The key a study's input is stored under. @param {import('./study.js').StudyInput} input */
export const studyKey = input => md5(JSON.stringify(input));
