// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { study, studyWith } from '../src/study.js';
import { runJob, worth } from '../src/build.js';

/** As a worker would: copies in and out, the searches finishing in reverse order. @param {import('../src/build.js').Searches} batch */
const elsewhere = async batch => {
  const { jobs, ...searches } = batch;
  const builds = new Array(jobs.length);
  for (let i = jobs.length - 1; i >= 0; i--) builds[i] = structuredClone(runJob(structuredClone(searches), structuredClone(jobs[i])));
  return builds;
};

test('a study with its searches run elsewhere gives the same results', async () => {
  const target = { health: 40000, shields: 0, armor: 300, weak: {}, shieldWeak: {} };
  /** @type {import('../src/study.js').StudyInput[]} */
  const inputs = [
    { weapon: 'Soma Prime', cls: 'rifle', shape: '++-', scenario: 'room', opts: { target }, positives: ['damage', 'multishot', 'critChance', 'critDamage'], negatives: ['zoom', 'recoil', 'statusChance'] },
    { weapon: 'Kuva Nukor', cls: 'pistol', shape: '++', scenario: 'single', opts: { target, valence: { type: 'best', value: 0.6 } }, positives: ['multishot', 'statusChance'], negatives: [] },
  ];
  for (const input of inputs) assert.deepEqual(await studyWith(input, elsewhere), study(input));
});

test('a spread of levels: a build is worth the geometric mean of its DPS on each', () => {
  const w = /** @type {any} */ ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0,
    modes: [{ name: 'x', rate: 1, cost: 1, parts: [{ name: 'x', dmg: { impact: 100 }, cc: 0, cd: 1, sc: 0, ms: 1 }] }] });
  const at = (/** @type {number} */ armor) => ({ health: 1e6, shields: 0, armor, weak: {}, shieldWeak: {} });
  const b = { slots: [], arcane: null };
  const one = worth(w, b, { target: at(0) }), other = worth(w, b, { target: at(2700) });
  assert.ok(Math.abs(worth(w, b, { target: at(0), spread: [at(2700)] }) - Math.sqrt(one * other)) < 1e-6 * one);
});
