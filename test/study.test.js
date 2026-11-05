// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { study, studyWith } from '../src/study.js';
import { arcanePool, runJob, worth, SCENARIOS } from '../src/build.js';
import { BATTLEGROUPS } from '../src/data/battlegroups.js';
import { fight } from '../src/fight.js';
import { roomOf } from '../src/enemies.js';
import * as enemies from '../src/data/enemies.js';

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
  assert.ok(Math.abs(worth(w, b, { target: at(0), spread: [{ target: at(2700) }] }) - Math.sqrt(one * other)) < 1e-6 * one);
});

test('battlegroups: 20 enemies each, every unit in the data', () => {
  for (const [id, group] of Object.entries(BATTLEGROUPS)) {
    assert.equal(group.members.reduce((s, [, n]) => s + n, 0), 20, id);
    for (const [name, , from] of group.members) assert.ok(enemies.UNITS[from ?? id].some(u => u.name === name), name);
  }
  // Borrowed units take the group's weaknesses.
  const room = roomOf('narmer', BATTLEGROUPS.narmer.members, 150, false, false, enemies);
  assert.deepEqual(room[4].target.weak, enemies.WEAKNESSES.Narmer);
  assert.deepEqual(roomOf('grineer', BATTLEGROUPS.grineer.members, 150, false, false, enemies, '')[0].target.weak, {});
});

test('a room: its health and shields over the time all of it takes', () => {
  const w = /** @type {any} */ ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0,
    modes: [{ name: 'x', rate: 1, cost: 1, parts: [{ name: 'x', dmg: { impact: 100 }, cc: 0, cd: 1, sc: 0, ms: 1 }] }] });
  const unit = (/** @type {number} */ health) => ({ health, shields: 0, armor: 0, weak: {}, shieldWeak: {} });
  // 3 of 100 health (a shot each), 1 of 1000 (ten): 1300 in 13 s; 4 kills in 13 shots.
  const r = fight(w, { stats: {}, elements: [] }, { target: unit(1), room: [{ n: 3, target: unit(100) }, { n: 1, target: unit(1000) }], targets: 20 });
  assert.ok(Math.abs(r.dps - 100) < 1e-6, String(r.dps));
  assert.ok(Math.abs(r.shotsPerKill - 13 / 4) < 1e-6, String(r.shotsPerKill));
  assert.ok(Math.abs(r.timePerKill - 13 / 4) < 1e-6, String(r.timePerKill));
});

test('Primary Overcharge: 35% of Max Energy as Multishot, to +350%; nothing without it', () => {
  const overcharge = (/** @type {number | undefined} */ maxEnergy) => arcanePool('shotgun', SCENARIOS.room, { maxEnergy }).find(p => p.name === 'Primary Overcharge');
  assert.equal(overcharge(undefined), undefined);
  assert.ok(Math.abs((overcharge(500)?.stats.multishot ?? 0) - 1.75) < 1e-9);
  assert.equal(overcharge(1000)?.stats.multishot, 3.5);
  assert.equal(overcharge(2500)?.stats.multishot, 3.5);
  // In game, with Hell's Chamber (+120%) on Boar Prime's 8 pellets: 45.6.
  assert.ok(Math.abs(8 * (1 + 1.2 + (overcharge(1000)?.stats.multishot ?? 0)) - 45.6) < 1e-9);
});
