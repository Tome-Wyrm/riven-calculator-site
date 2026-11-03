import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiplier, scaled, targetOf, SCALING } from '../src/enemies.js';
import * as E from '../src/data/enemies.js';
import { dpsOf } from '../src/sim.js';

const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test('level scaling: the low curve, the smoothstep between 70 and 80 levels up, then the high curve', () => {
  const armor = SCALING.armor.all;
  near(multiplier(armor, 0), 1);
  near(multiplier(armor, 50), 1 + 0.005 * 50 ** 1.75);
  near(multiplier(armor, 75), (1 + 0.005 * 75 ** 1.75) + ((1 + 0.4 * 75 ** 0.75) - (1 + 0.005 * 75 ** 1.75)) * 0.5);
  near(multiplier(armor, 100), 1 + 0.4 * 100 ** 0.75);
  near(multiplier(armor, -5), 1);                       // below its base level: as at its base level
});

test('a unit at a level: Steel Path x2.5 on health and shields (not armor), armor between 200 and 2700', () => {
  const lancer = { name: 'Lancer', types: 'Grineer', level: 1, health: 100, shields: 0, armor: 100 };
  const l2 = scaled(lancer, 2);
  assert.equal(l2.armor, 200);                          // an armored unit starts with at least 200
  const l200 = scaled(lancer, 200);
  near(l200.armor, 100 * (1 + 0.4 * 199 ** 0.75));
  assert.equal(scaled({ ...lancer, armor: 500 }, 200).armor, 2700);    // the cap
  const sp = scaled(lancer, 200, true);
  near(sp.health, 2.5 * l200.health);
  assert.equal(sp.armor, l200.armor);
  assert.equal(scaled({ ...lancer, armor: 0 }, 200).armor, 0);
  // Corpus health runs on its own curves.
  const crewman = { name: 'Crewman', types: 'Corpus', level: 1, health: 100, shields: 100, armor: 0 };
  near(scaled(crewman, 101).health, 100 * (1 + 13.4165 * 100 ** 0.55));
  near(scaled(crewman, 101).shields, 100 * (1 + 2 * 100 ** 0.76));
});

test('the generated data: Update 36 weaknesses and each faction’s default unit', () => {
  assert.deepEqual(E.WEAKNESSES.Grineer, { impact: 0.5, corrosive: 0.5 });
  assert.deepEqual(E.WEAKNESSES.Corpus, { puncture: 0.5, magnetic: 0.5 });
  assert.equal(E.SHIELD_WEAKNESSES.heat, -0.5);
  for (const [f, name] of Object.entries(E.DEFAULT_UNIT)) assert.ok(E.UNITS[f].some(u => u.name === name), f);
  const t = targetOf(E.UNITS.grineer.find(u => u.name === 'Heavy Gunner'), 150, true, true, E);
  assert.equal(t.armor, 0);
  assert.deepEqual(t.weak, E.WEAKNESSES.Grineer);
});

// One part, one damage type, no crits or status: easy numbers.
const gun = (/** @type {Record<string, number>} */ dmg, extra = {}) => ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0,
  modes: [{ name: 'Normal Attack', rate: 1, cost: 1, parts: [{ name: 'Normal Attack', dmg, cc: 0, cd: 1, sc: 0, ms: 1, ...extra }] }] });
const none = { stats: {}, elements: [] };

test('a target: weaknesses on health, shields first (Toxin skips them, Heat does half), effective DPS over both', () => {
  const plain = { health: 1000, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  near(dpsOf(gun({ impact: 100 }), none, { target: plain }), 100);
  near(dpsOf(gun({ impact: 100 }), none, { target: { ...plain, weak: { impact: 0.5 } } }), 150);
  // 1000 health + 1000 shields, 100 a second: 20 s, so 100 effective.
  const shielded = { ...plain, shields: 1000, shieldWeak: { heat: -0.5 } };
  near(dpsOf(gun({ impact: 100 }), none, { target: shielded }), 100);
  // Heat: 1000 / 50 = 20 s on shields, then 10 s on health: 2000 / 30.
  near(dpsOf(gun({ heat: 100 }), none, { target: shielded }), 2000 / 30);
  // Slash bleeds hit shields too (since Update 27.2): a proc a second, 35% x 6 ticks = 210 a second, plus 100.
  near(dpsOf(gun({ slash: 100 }, { sc: 1 }), none, { target: { ...plain, shields: 1000 } }), 310);
  // Primed: Magnetic at 10 stacks, x4.25 on shields; the break deals 3% x 10 of 1000 as Electricity
  // (x4.25 Viral = 1275), which finishes the 1000 health: 1000 / 425 s for 2000.
  near(dpsOf(gun({ impact: 100 }), none, { target: { ...plain, shields: 1000 }, primed: true }), 850);
  // Toxin never touches shields: 10 s for the health.
  near(dpsOf(gun({ toxin: 100 }), none, { target: shielded }), 200);
});

test('per status type bonuses count the status types up: none without status, all of them primed', () => {
  const galvanized = { stats: { directDamagePerStatus: 0.8 }, elements: [] };
  const target = { health: 1000, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  near(dpsOf(gun({ impact: 100 }), galvanized, { target }), 100);                 // no procs: no types up
  // Status chance 100% on one type, 1 shot a second, 6 s procs: 1 - e^-6 of a type up.
  const procs = dpsOf(gun({ impact: 100 }, { sc: 1 }), galvanized, { target });
  near(procs, 100 * (1 + 0.8 * (1 - Math.exp(-6))));
  // Primed: all 13 types (and Viral at 10 stacks: +100% then 9 x 25%, x4.25).
  near(dpsOf(gun({ impact: 100 }), galvanized, { target, primed: true }), 100 * (1 + 0.8 * 13) * 4.25);
});

test('every faction group: its default unit, its Bane faction, and the codex’s weaknesses (in game, 2026-11-03)', () => {
  const byId = Object.fromEntries(E.GROUPS.map(g => [g.id, g]));
  assert.deepEqual(E.GROUPS.map(g => g.id), ['grineer', 'kuva', 'corpus', 'amalgam', 'infested', 'deimos', 'orokin', 'sentient', 'narmer', 'zariman', 'scaldra', 'techrot', 'murmur', 'anarchs']);
  assert.deepEqual(['kuva', 'amalgam', 'deimos', 'sentient', 'anarchs'].map(id => byId[id].bane), ['grineer', 'corpus', 'infested', '', '']);
  // The codex: Anarch Grineer Lancer, Narmer Flameblade, Conculyst, Scaldra Jaeger, Techrot Skuzzi.
  assert.deepEqual(E.WEAKNESSES.Anarchs, { impact: 0.5, electricity: 0.5, radiation: -0.5 });
  assert.deepEqual(E.WEAKNESSES.Narmer, { slash: 0.5, toxin: 0.5, magnetic: -0.5 });
  assert.deepEqual(E.WEAKNESSES.Sentient, { cold: 0.5, corrosive: -0.5, radiation: 0.5 });
  assert.deepEqual(E.WEAKNESSES.Scaldra, { impact: 0.5, corrosive: 0.5, gas: -0.5 });
  assert.deepEqual(E.WEAKNESSES.Techrot, { cold: -0.5, gas: 0.5, magnetic: 0.5 });
  const lancer = E.UNITS.anarchs.find(u => u.name === 'Anarch Grineer Lancer');
  assert.deepEqual([lancer?.health, lancer?.armor], [125, 100]);
});
