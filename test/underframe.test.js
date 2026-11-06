// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ownBuild, panelPower, readLink } from '../src/underframe.js';

// Made on Underframe from a build written for this test, with its own Share button.
const LINK = 'https://www.underframe.site/share#v4.H4sIAAAAAAAACn1U247bNhD9FWOAPpUIZDdGAb05iffS1gvXu8ilC0MYU2OJXYoUyJGzRuD99oDUxVojiR8M8MzlzOVovsEB0qmAHaTfwEAKG8Kc3ITJMwhgSP8QoCCFl-vV3V_Vl6td8s8TCKggfXyEl89_31_d7vx-ebsAMd-KR3iZ7__XfLPOlrMExDSJWLZb72_-e9BXtujd_uWNXH7afV6XX1o302j907-tAIT0EVZW82TRFBUZphwELJxEQ5N3pLWS1hMETx-KSwT8Pp3_NlnslFZ8nNyzI1NwCWK6Fa01-YH1spCtgDIwbyw6EG-3AjgPs6psTpCCV6bQBAI8SVbWLJ9rNDnlkO5RexKADdtrMuSQKf9Ae2w0QxrTd8H3eKD8AV1BfIdVSNq79R6tMbDWjvzgdmdNYK5IlmiU9MHhQM4ra-JOkZlMg6Gslc1JQwqmDcmxwoJiQsKnbK-tdZAmAvLaj17RWNaZtl8pIG9m8zPY1PUZDHGXjh32yi8-Mk2HUM1UQE4Sj5knaU3uIZ0JwD2Ty6RTnPnSctGYTNqqJuNjIzHK0Z4cGUlZhc9ZWbelx56yqtGsaq0CZyCwfAmVhJyFMkrF3ZpOApSRtlKm-BDTrF6H-FKRzn9hukamdzY_jo3Jm2Q-tn8ifKqtMvzaaSZAVVVj6MEuXGXdhvJGtq12EvKM3Pj3WIcNn_r3bQhSrCiofSuANIWvAvXHRge5RWEP1mFkN_W9RK1M0YtwZFk0bM8TkY1nW62j4oJU9tiVBYVThsiBgB16iguYJknSPTF0AelsANoR-LilCNgDuaJBl5-hsSSi-Afk7fwkwOHXRZf2z5A3coRGqFX68FwpE5OOEHyOyJnBM5FeI5fDhOlZVY0fnudOr4dOQ5Oz0GX8dQR9OeMOXzdXEuZBx-Odh4vqbzrDQNp7LqRsHMpjnGkLv3eKlwZ3enRXevwj6oYGqoCcqYYYdg39yCF-ce2HsyGvPKORdMl0aV-Tk2Q4cg7SvAwaDH19JwFo21u3Hh-x861DS2excTx5nXjDDV07ZZ3iY9vM6RSWBun0dPoORrjydsIGAAA';

test('a real link: its mods, Arcanes, shards and Helminth', async () => {
  const read = await readLink(LINK);
  assert.equal(read.name, 'Reader test');
  assert.equal(read.frame, 'Sevagoth');
  assert.deepEqual(read.mods.map(m => m.name), ['Intensify', 'Transient Fortitude', 'Precision Intensify', 'Primed Continuity']);
  assert.deepEqual(read.arcanes, ['Molt Augmented', 'Arcane Bellicose']);
  assert.deepEqual(read.shards, ['+15% Ability Strength', '+10% Ability Strength']);
  assert.deepEqual(read.helminth, { name: 'Roar', slot: 4 });
  assert.equal(read.unknown, 0);
});

test('its Strength and Duration, conditionals apart', async () => {
  assert.deepEqual(ownBuild(await readLink(LINK)), { frame: 'Sevagoth', tab: 'Reader test', strength: 210, duration: 128, reads: 0, own: 1, molt: 1, bellicose: 1, sub: 'Roar', fourth: 1 });
});

test('a pasted token works without the rest of the link', async () => {
  assert.equal((await readLink(LINK.slice(LINK.indexOf('v4.')))).name, 'Reader test');
});

test('links it can\'t read say why', async () => {
  await assert.rejects(readLink('https://www.underframe.site/vshare/someone/build'), /short link/);
  await assert.rejects(readLink('https://example.com'), /isn’t an Underframe/);
  await assert.rejects(readLink(LINK.slice(0, 200)), /cut off/);
  const gun = `v4u.${btoa(JSON.stringify({ v: 1, b: { n: 'Gun', t: 0, i: 'Braton' } }))}`.replace(/=+$/, '');
  await assert.rejects(readLink(gun), /weapon or companion/);
});


test('a mod below max rank gives its share', () => {
  assert.equal(panelPower([{ name: 'Intensify', rank: 2 }], []).strength, 115);
  assert.equal(panelPower([{ name: 'Blind Rage', rank: 0 }], []).strength, 109);
});

test('the Umbral set raises Umbral Intensify', () => {
  const set = (/** @type {string[]} */ names) => panelPower(names.map(name => ({ name })), []).strength;
  assert.equal(set(['Umbral Intensify']), 144);
  assert.equal(set(['Umbral Intensify', 'Umbral Fiber']), 155);
  assert.equal(set(['Umbral Intensify', 'Umbral Fiber', 'Umbral Vitality']), 177);
  assert.equal(set(['Umbral Fiber', 'Umbral Vitality']), 100);
});

test('only the 4th slot with Precision Intensify gets the flag', async () => {
  const read = await readLink(LINK);
  assert.equal(ownBuild({ ...read, helminth: { name: 'Roar', slot: 1 } }).fourth, undefined);
  assert.equal(ownBuild({ ...read, mods: read.mods.filter(m => m.name !== 'Precision Intensify') }).fourth, undefined);
});

test('a frame goes by the builds\' name for it', async () => {
  const read = await readLink(LINK);
  assert.equal(ownBuild({ ...read, frame: 'Rhino Prime' }).frame, 'Rhino');
  assert.equal(ownBuild({ ...read, frame: 'Cyte' }).frame, 'Cyte-09');
});

test('the reference builds add up to their panels', () => {
  const rows = JSON.parse(fs.readFileSync(new URL('../tools/data/reference-builds.json', import.meta.url), 'utf8')).filter((/** @type {any} */ r) => r.addsUp);
  const off = rows.flatMap((/** @type {any} */ r) => {
    const shards = [...Array(r.shards.tau).fill('+15% Ability Strength'), ...Array(r.shards.plain).fill('+10% Ability Strength')];
    const ours = panelPower([...r.mods, ...r.guessed].map(name => ({ name })), shards).strength + r.bellicose;
    return Math.round(ours) === r.strength ? [] : [r.strength - Math.round(ours)];
  });
  assert.deepEqual(off, [22, 22, 22]);   // each with an Umbral mod the video reading missed
});
