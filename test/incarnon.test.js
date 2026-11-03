import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPerks, bestPerks, evolutionsOf } from '../src/incarnon.js';
import { dps, critScale } from '../src/sim.js';
import { WEAPON_STATS } from '../src/data/weapon-stats.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const perk = (weapon, name) => {
  const evos = evolutionsOf(weapon);
  return evos.map(e => e.perks.findIndex(p => p.name === name));
};

test('Felarx: its evolutions from Underframe', () => {
  const names = evolutionsOf('Felarx').map(e => e.perks.map(p => p.name));
  assert.deepEqual(names[2], ['Brutal Edge', 'Incarnon Catalyst', 'Wracking Wrath']);
  assert.equal(names[3][0], 'Devastating Attrition');
  assert.deepEqual(evolutionsOf('Felarx')[3].perks[0].effects, [{ kind: 'nonCrit', value: 20, chance: 0.5 }]);
  assert.deepEqual(evolutionsOf('Not A Gun'), []);
});

test('perks change the base numbers: crit and status per form, base damage to normal attacks', () => {
  const w = WEAPON_STATS.Felarx;
  const brutal = withPerks(w, 'Felarx', perk('Felarx', 'Brutal Edge'));
  const [normal, form] = [brutal.modes[0].parts[0], brutal.modes[1].parts[0]];
  near(normal.cc, w.modes[0].parts[0].cc + 0.1);
  near(normal.sc, w.modes[0].parts[0].sc + 0.025);        // +2.5% per projectile
  near(form.sc, w.modes[1].parts[0].sc + 0.1);            // +10% for Incarnon Form
  assert.equal(w.modes[0].parts[0].cc, 0.2);              // the original is untouched
  // Boar's Fortress Salvo: +16 damage, each type in proportion, normal attacks only.
  const b = WEAPON_STATS.Boar;
  const salvo = withPerks(b, 'Boar', perk('Boar', 'Fortress Salvo'));
  const sum = d => Object.values(d).reduce((x, y) => x + y, 0);
  near(sum(salvo.modes[0].parts[0].dmg), sum(b.modes[0].parts[0].dmg) + 16, 1e-6);
});

test('the non-crit bonus: 50% chance of +2000% on hits that don’t crit, gone at 100% crit', () => {
  const p = { nonCrit: { chance: 0.5, mult: 20 } };
  near(critScale(0, 2, p), 11);
  near(critScale(0.2, 2, p), 1 + 0.2 + 0.8 * 10);
  near(critScale(1, 2, p), 2);
  near(critScale(1.5, 2, p), 2.5);
});

test('Felarx: the best perks avoid crit, and a crit chance curse helps', () => {
  const w = WEAPON_STATS.Felarx;
  const o = { weakpoint: 0 };
  const picks = bestPerks(w, 'Felarx', 'shotgun', o);
  const names = evolutionsOf('Felarx').map((e, i) => e.perks[picks[i]]?.name);
  assert.equal(names[2], 'Wracking Wrath');
  assert.equal(names[3], 'Devastating Attrition');
  const ev = withPerks(w, 'Felarx', picks);
  const curse = x => dps(x, 'shotgun', { critChance: -0.5 }, o) / dps(x, 'shotgun', {}, o) - 1;
  assert.ok(curse(w) < 0, 'unevolved: crit chance helps');
  assert.ok(curse(ev) > 0, 'evolved: losing crit chance helps');
});
