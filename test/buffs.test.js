// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUFFS, BUFF_GROUPS } from '../src/data/buffs.js';
import { buffPiece, buildOf, buildPower, buildSlug, buildsFor, defaultBuild, ownFromText, ownText } from '../src/buffs.js';
import { BLAST_ALONE, BLAST_SECONDS, blastPay, dpsOf, hitByType, critChanceOf } from '../src/sim.js';
import { fight } from '../src/fight.js';
import { sparkReach } from '../src/crowd.js';
import { worth } from '../src/build.js';

const near = (/** @type {number} */ a, /** @type {number} */ b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
/** @param {object} part @returns {any} */
const gun = (part = {}) => ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0,
  modes: [{ name: 'x', rate: 1, cost: 1, parts: [{ name: 'x', dmg: { impact: 32 }, cc: 0, cd: 2, sc: 0, ms: 1, ...part }] }] });
const none = { stats: {}, elements: [] };
const totals = (/** @type {string[]} */ ids, strength = 1, duration = 1) => { const p = buffPiece(ids, strength, duration); return { stats: p?.stats ?? {}, elements: p?.elements ?? [] }; };

test('the table: ids unique, groups known', () => {
  assert.equal(new Set(BUFFS.map(b => b.id)).size, BUFFS.length);
  for (const b of BUFFS) assert.ok(BUFF_GROUPS.includes(b.group), b.name);
  assert.equal(buffPiece([]), null);
});

test('strength and duration scale what they should', () => {
  near(totals(['vex'], 2).stats.damage, 5.5);
  near(totals(['gem'], 2, 1.5).stats.statusChance, 2);
  near(totals(['gem'], 2, 1.5).stats.statusDuration, 1.5);
  near(totals(['redline'], 2).stats.fireRate, 0.75);        // by the counter, not strength
});

test('Damage buffs add with Serration; multipliers and vulnerabilities multiply', () => {
  near(dpsOf(gun(), { stats: { damage: 1.65 + totals(['vex']).stats.damage }, elements: [] }), 32 * (1 + 1.65 + 2.75));
  // Eclipse and Molecular Prime: x3 and x2.
  near(totals(['eclipse', 'prime']).stats.allDamage, 5);
  near(dpsOf(gun(), totals(['eclipse', 'prime'])), 32 * 6);
});

test('multipliers reach DoTs once, Roar twice', () => {
  const g = gun({ dmg: { slash: 32 }, sc: 1 });
  const dot = (/** @type {any} */ t) => dpsOf(g, t) - dpsOf(gun({ dmg: { slash: 32 }, sc: 0 }), t);
  near(dot(totals(['eclipse'])) / dot(none), 3);
  // (32 x 1.5 + 1) x 0.35 x 1.5 against (32 + 1) x 0.35.
  near(dot(totals(['roar'])) / dot(none), 49 * 1.5 / 33);
});

test('Roar adds with a Bane mod, and works with no Bane to add to', () => {
  near(dpsOf(gun(), { stats: { grineer: 0.3, anyFaction: 0.5 }, elements: [] }, { enemy: 'grineer' }), 32 * 1.8);
  near(dpsOf(gun(), totals(['roar'])), 32 * 1.5);
});

test('a buff element never combines, and joins the same element', () => {
  const part = /** @type {any} */ ({ name: 'x', dmg: { impact: 32 }, cc: 0, cd: 1, sc: 0, ms: 1 });
  const m = () => 0;
  // Cold from a mod and Shock Trooper's Electricity stay apart: no Magnetic.
  const mixed = { stats: {}, elements: [{ type: 'cold', value: 1 }, ...totals(['shock']).elements] };
  assert.deepEqual(hitByType(part, mixed, m)?.byType, { impact: 32, cold: 32, electricity: 32 });
  // A riven's Viral and Nourish's sum.
  const viral = { stats: {}, elements: [{ type: 'cold', value: 0.5 }, { type: 'toxin', value: 0.5 }, ...totals(['nourish']).elements] };
  assert.equal(hitByType(part, viral, m)?.byType.viral, 32 * 1.75);
});

test('Nourish makes a Viral riven worth less', () => {
  const g = gun({ sc: 0.5 });
  const target = { health: 1e6, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const riven = { name: 'Riven', stats: {}, excl: [], elements: [{ type: 'cold', value: 0.6 }, { type: 'toxin', value: 0.6 }], riven: true };
  const gain = (/** @type {object} */ o) => worth(g, { slots: [riven], arcane: null }, { target, ...o }) / worth(g, { slots: [], arcane: null }, { target, ...o });
  assert.ok(gain({ buffs: buffPiece(['nourish']) }) < gain({}), `${gain({ buffs: buffPiece(['nourish']) })} against ${gain({})}`);
});

test('flat crit chance goes after the mods, Covenant more on heads; flat crit damage on the multiplier', () => {
  const p = /** @type {any} */ ({ cc: 0.1 });
  near(critChanceOf(p, 1, 0.5), 0.7);
  near(dpsOf(gun({ cc: 0.1 }), totals(['covenant'])), 32 * (1 + 0.6 * 1));
  near(dpsOf(gun({ cc: 0.1 }), totals(['covenant']), { weakpoint: 1, headMult: 1, headcrit: false }), 32 * (1 + 2.1 * 1));
  near(dpsOf(gun({ cc: 1 }), totals(['tenacious'])), 32 * 3.2);
});

test('a fight agrees with the closed form on buffs', () => {
  const target = { health: 32 * 6 * 5, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  near(fight(gun(), totals(['eclipse', 'prime']), { target }).shotsPerKill, 5);
  near(fight(gun(), totals(['roar']), { target: { ...target, health: 32 * 1.5 * 4 } }).shotsPerKill, 4);
});

test('a build carries its buffs', () => {
  const target = { health: 1e4, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const b = { slots: [], arcane: null };
  near(worth(gun(), b, { target, buffs: buffPiece(['eclipse']) }) / worth(gun(), b, { target }), 3);
});

test('Brightbonnet raises Ability Strength for the others, to its cap', () => {
  near(totals(['roar', 'bonnet']).stats.anyFaction, 0.5 * 1.3);
  near(totals(['roar', 'bonnet'], 2).stats.anyFaction, 0.5 * 2.6);
  near(totals(['roar', 'bonnet'], 6).stats.anyFaction, 0.5 * 7.5);          // +150% at most
  near(totals(['roar', 'bonnet-sub'], 6).stats.anyFaction, 0.5 * 7);        // +100% subsumed
});

test('Xata\'s Whisper: a share of the whole hit as Void, faction again, weak points again', () => {
  const t = totals(['xata']);
  near(dpsOf(gun(), t), 32 * 1.26);
  // Bane +30%: 32 x 1.3, then 26% of that x 1.3.
  const baned = { stats: { ...t.stats, grineer: 0.3 }, elements: [] };
  near(dpsOf(gun(), baned, { enemy: 'grineer' }), 32 * 1.3 * (1 + 0.26 * 1.3));
  const heads = { weakpoint: 1, headMult: 3, headcrit: false };
  near(dpsOf(gun(), t, heads), 32 * 3 * (1 + 0.26 * 3));
  const target = { health: 1e6, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  near(fight(gun(), t, { target }).dps, 32 * 1.26, 1e-3);
});

test('Breach Surge\'s sparks need another enemy nearby', () => {
  const crowd = { close: 6, clump: 0.5 };
  const near10 = 1 - Math.exp(-6 * (10 / 12.5) ** 2);
  // A kill in one shot sends a spark that kills another; a kill in 20 shots, 45% of one.
  near(sparkReach(0.9, crowd, 1), near10 * 1.9);
  near(sparkReach(0.9, crowd, 20), near10 * (0.9 + 0.45));
  const target = { health: 1e4, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const t = totals(['surge']);
  near(fight(gun(), t, { target, targets: 1, crowd }).dps, fight(gun(), none, { target, targets: 1 }).dps);
  assert.ok(fight(gun(), t, { target, targets: 20, crowd }).dps > 1.5 * fight(gun(), none, { target, targets: 20, crowd }).dps);
});

test('primers hold statuses on the target, doing no damage themselves', () => {
  const target = { health: 1e4, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const held = (/** @type {string} */ id, /** @type {number} */ stacks) => { const p = buffPiece([id], 1, 1, stacks); return { stats: p?.stats ?? {}, elements: [] }; };
  // One Viral stack doubles damage to health, five x 3.
  near(fight(gun(), held('panzer', 1), { target }).dps, 32 * 2);
  near(fight(gun(), held('panzer', 5), { target }).dps, 32 * 3);
  // Diriga's Puncture adds 5% crit chance a stack, to 25%: on a 2x gun, x 1.25 at 5 stacks.
  near(fight(gun(), held('diriga', 5), { target }).dps, 32 * 3 * 1.25);
  near(fight(gun(), held('diriga', 10), { target }).dps, 32 * 4.25 * 1.25);
});

test('Eclipse and Rift Torrent reach sparks again', () => {
  near(totals(['surge', 'eclipse']).stats.sparks, 0.9 * 3);
  near(totals(['surge', 'torrent', 'eclipse-sub']).stats.sparks, 0.9 * 4 * 1.3);
  assert.equal(totals(['eclipse']).stats.sparks, undefined);
  assert.equal(totals(['eclipse']).stats.sparkMore, undefined);
});

test('one companion: Diriga and the Panzer share a slot', () => {
  const only = BUFFS.filter(b => b.only === 'companion').map(b => b.id).sort();
  assert.deepEqual(only, ['diriga', 'panzer']);
});

test('primers count for Galvanized, Heat\'s strip and Puncture\'s crit chance', () => {
  const target = { health: 1e4, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const p = buffPiece(['diriga'], 1, 1, 1);
  const t = { stats: p?.stats ?? {}, elements: [] };
  const with8 = { stats: { ...t.stats, directDamagePerStatus: 0.1 }, elements: [] };
  // 8 types up: +80% Direct Damage, x 2 Viral, Puncture's crit chance.
  near(fight(gun(), with8, { target }).dps, 32 * 1.8 * 2 * 1.05);
  // 0.05 of crit chance from a stack of Puncture, on a 2x gun; none on an area attack.
  near(dpsOf(gun(), t), 32 * 2 * 1.05);
  near(dpsOf(gun({ aoe: 1 }), t), 32 * 2);
  // Heat's strip: half of the armor, as long as the primer holds it.
  const armored = { ...target, armor: 2700 };
  const kept = (/** @type {number} */ armor) => 1 - 0.9 * Math.sqrt(armor / 2700);
  near(fight(gun(), totals(['stars']), { target: armored }).dps, 32 * kept(1350), 1e-3);
});

test('Reinforced Bond isn\'t doubled on a bow', () => {
  near(dpsOf(gun(), totals(['reinforced']), { bow: true }), 32 * 1.6);
});

test('Blast and Xata\'s Whisper: the numbers worked in the video', () => {
  // Prisma Grinlok, modded base 496, whole hit 1700, Elementalist +90%, Xata at 51%, no faction:
  // a proc alone 282, its Xata hit 496.
  const blast = { name: 'x', dmg: { blast: 187 }, cc: 0, cd: 1, sc: 1, ms: 1 };
  const base = 187 * (1 + 1.65);
  near(base * BLAST_ALONE * 1.9, 282, 1);
  near(1700 * 0.51 * BLAST_ALONE * 1.9, 494, 3);
  // With Bane +30%: the proc's faction twice, the Xata hit's three times: 477 and 1085.
  near(base * 1.3 * BLAST_ALONE * 1.9 * 1.3, 477, 1);
  near(1700 * 1.3 * 0.51 * 1.3 * BLAST_ALONE * 1.9 * 1.3, 1085, 3);
  // In the model: one proc a second, so the proc pays `blastPay(1)`.
  const gunOf = /** @type {any} */ ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0, modes: [{ name: 'x', rate: 1, cost: 1, parts: [blast] }] });
  const pay = blastPay(1);
  const stats = { damage: 1.65, statusDamage: 0.9, extraVoid: 0.51, grineer: 0.3 };
  const hit = 187 * 2.65 * 1.3;
  const expected = hit + hit * 0.51 * 1.3 + base * 1.3 * pay * 1.9 * 1.3 + hit * 0.51 * 1.3 * pay * 1.9 * 1.3;
  near(dpsOf(gunOf, { stats, elements: [] }, { enemy: 'grineer' }), expected, 1);
  // A fight pays a stack alone when it runs out, 1.5 s on: of its first 20 s, the last 1.5 s's are
  // still waiting (a share of the Blast and its Xata hit; a whole proc or two, at one a second).
  const target = { health: 1e7, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const waiting = (base * 1.3 * pay * 1.9 * 1.3 + hit * 0.51 * 1.3 * pay * 1.9 * 1.3) * BLAST_SECONDS / 20;
  const fought = fight(gunOf, { stats, elements: [] }, { enemy: 'grineer', target }).dps;
  assert.ok(fought < expected && fought > expected - 2 * waiting, `${fought} vs ${expected}`);
});

test('Blast in a short fight: stacks wait for ten, and those still up when the target dies are lost', () => {
  // Ten procs a second, one a hit: the tenth detonates them all (3x each), not before.
  const gunOf = /** @type {any} */ ({ kind: 'Rifle', mag: 0, reload: 0, ammo: null, trigger: 'Auto', tags: [], main: 0,
    modes: [{ name: 'x', rate: 10, cost: 1, parts: [{ name: 'x', dmg: { blast: 100 }, cc: 0, cd: 1, sc: 1, ms: 1 }] }] });
  const totals = { stats: {}, elements: [] };
  const shotsFor = (/** @type {number} */ health) => fight(gunOf, totals, { target: { health, shields: 0, armor: 0, weak: {}, shieldWeak: {} } }).shotsPerKill;
  // Nine hits and no detonation: 900 of hits only; the tenth's 100 and its detonation, 3000 more
  // (of which src/sim.js's share that detonates at ten a second, 0.99, comes with the tenth).
  near(shotsFor(900), 9, 1e-9);
  assert.ok(shotsFor(3600) <= 10 && shotsFor(3900) > 9);
  // Paid at once (src/sim.js), 3000 would fall in under 8 hits; it takes the tenth.
  assert.ok(3000 / (100 * (1 + blastPay(10))) < 8 && shotsFor(3000) > 9);
});

test('the Xata hit from Blast takes no third head bonus', () => {
  const blast = { dmg: { blast: 100 }, sc: 1 };
  const gunOf = gun(blast);
  const stats = { extraVoid: 0.5 };
  const pay = blastPay(1);
  const opts = { weakpoint: 1, headMult: 3, headcrit: false };
  // The hit x 3; its Xata x 3 again; a proc's seed x 3; the proc's Xata as the hit's, no more.
  near(dpsOf(gunOf, { stats, elements: [] }, opts), 300 + 300 * 0.5 * 3 + 300 * pay + 300 * 0.5 * 3 * pay);
});

test('Blast detonations reach the crowd within 5 m', () => {
  const crowd = { close: 6, clump: 0.5 };
  const target = { health: 1e4, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const plain = gun({ dmg: { blast: 100 }, sc: 0 }), proccing = gun({ dmg: { blast: 100 }, sc: 3 });
  const o = { target, targets: 20 };
  const gain = (/** @type {any} */ g) => fight(g, none, { ...o, crowd }).dps / fight(g, none, o).dps;
  assert.equal(gain(plain), 1);
  assert.ok(gain(proccing) > 1);
});

test('Void\'s bubble: with procs coming, a fight turns to heads, by the setting', () => {
  const target = { health: 1e6, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  const proccing = gun({ sc: 1 }), none0 = gun({ sc: 0 });
  const at = (/** @type {number} */ heads) => { const p = buffPiece(['xata'], 1, 1, 5, heads); return { stats: p?.stats ?? {}, elements: [] }; };
  assert.ok(fight(proccing, at(0.9), { target }).dps > 2 * fight(proccing, at(0), { target }).dps);
  near(fight(none0, at(0.9), { target }).dps, fight(none0, at(0), { target }).dps);
  // A target dead in a shot never sees it.
  const small = { ...target, health: 1 };
  near(fight(proccing, at(0.9), { target: small }).shotsPerKill, fight(proccing, at(0), { target: small }).shotsPerKill);
});

test('Overguard goes first: no armor, Void 50% more, Magnetic multiplies, its break costs Electricity', () => {
  const base = { health: 32, shields: 0, armor: 2700, weak: {}, shieldWeak: {} };
  // 320 of Overguard at 32 a shot, armor doing nothing to it: 10 shots, then the health at 10%.
  const r = fight(gun(), none, { target: { ...base, overguard: 320 } });
  near(r.shotsPerKill, 20, 1e-3);
  // Void takes it down faster.
  const v = fight(gun({ dmg: { void: 32 } }), none, { target: { ...base, armor: 0, health: 32, overguard: 480 } });
  near(v.shotsPerKill, 11, 1e-3);
});

test('Overguard scales on its own curves', async () => {
  const { overguardMultiplier } = await import('../src/enemies.js');
  near(overguardMultiplier(1), 1);
  near(overguardMultiplier(11), 1 + 0.0015 * 10 ** 4);
  near(overguardMultiplier(50), 1 + 260 * 49 ** 0.9);
});

test('Toxic Lash: the wiki\'s Extra Hit, with Infected Clip, and its proc', () => {
  const target = { health: 1e7, shields: 0, armor: 0, weak: {}, shieldWeak: {} };
  // 100 base + 90% Toxin: 190 a hit, 57 extra, a tick of (57 + 1) x 1.9 x 0.5, 6 of them a proc.
  const g = gun({ dmg: { impact: 100 }, sc: 0 });
  const p = buffPiece(['lash']);
  const t = { stats: p?.stats ?? {}, elements: [{ type: 'toxin', value: 0.9 }] };
  const r = fight(g, t, { target });
  // Over the 20 s fought, the ticks ramp up towards 6 for each shot.
  near(r.perShot, 190 + 57, 1);
  assert.ok(r.dps > 190 + 57 + 0.8 * 6 * 58 * 1.9 * 0.5 && r.dps < 190 + 57 + 6 * 58 * 1.9 * 0.5, String(r.dps));
});

test('weak point buffs: Seek adds to the head, Prowl to headshot bonuses, Sonar multiplies, not on DoTs', () => {
  const opts = { weakpoint: 1, headMult: 3, headcrit: false };
  near(dpsOf(gun(), totals(['seek']), opts), 32 * 3.75);
  near(dpsOf(gun(), totals(['prowl']), opts), 32 * 3 * 1.4);
  near(totals(['prowl'], 5).stats.headshotMultiplier, 1);           // capped at +100%
  near(dpsOf(gun(), totals(['sonar']), opts), 32 * 3 * 5);
  const bleeding = gun({ dmg: { slash: 32 }, sc: 1 });
  const tick = (/** @type {any} */ t) => dpsOf(bleeding, t, opts) - dpsOf(gun({ dmg: { slash: 32 }, sc: 0 }), t, opts);
  near(tick(totals(['sonar'])), tick(none), 1e-6);
});

test('Valence Formation: one element at a time, +200%, never combining', () => {
  const only = BUFFS.filter(b => b.only === 'valence');
  assert.equal(only.length, 4);
  assert.deepEqual(totals(['valence-heat']).elements, [{ type: 'heat', value: 2, loose: true }]);
});

const buff = (/** @type {string} */ id) => /** @type {typeof BUFFS[number]} */ (BUFFS.find(b => b.id === id));

test('a buff is cast from the build named for it, else its frame\'s most-read one', () => {
  assert.equal(defaultBuild(buff('roar'))?.tab, 'Buff Bot');
  assert.equal(defaultBuild(buff('freeze'))?.tab, 'Xata');            // not 0 Forma, though it has more reads
  assert.equal(defaultBuild(buff('bonnet'))?.frame, 'Nokko');
  assert.equal(defaultBuild(buff('stars'))?.frame, 'Sirius & Orion');
  assert.equal(defaultBuild(buff('avenger')), null);                  // no frame
});

test('a subsumed ability takes any frame\'s build named for it', () => {
  assert.ok(buildsFor(buff('roar-sub')).every(b => /roar/i.test(b.tab)));
  assert.equal(defaultBuild(buff('nourish-sub'))?.frame, 'Revenant');
  assert.ok(buildsFor(buff('eclipse-sub')).some(b => b.frame === 'Ivara'));
  assert.deepEqual(buildsFor(buff('bonnet-sub')).map(b => b.tab), ['Bonnet']);
});

test('a chosen build, the default, or the boxes', () => {
  const list = buildsFor(buff('nourish'));
  const other = /** @type {typeof list[number]} */ (list.find(b => b.tab === 'Rollin\' Rollin\''));
  assert.equal(buildOf(buff('nourish'), buildSlug(other))?.strength, 234);
  assert.equal(buildOf(buff('nourish'), 'gone')?.tab, defaultBuild(buff('nourish'))?.tab);
  assert.equal(buildOf(buff('nourish'), 'x'), null);
});

test('every build a buff can use has its own name in a link', () => {
  for (const b of BUFFS) {
    const slugs = buildsFor(b).map(buildSlug);
    assert.equal(new Set(slugs).size, slugs.length, b.id);
  }
  const frost = buildsFor(buff('freeze')).map(buildSlug);
  assert.ok(frost.includes('frost0forma'));
});

test('Molt Augmented counts at its maximum', () => {
  const b = { frame: '', tab: '', strength: 145, duration: 100, reads: 1 };
  assert.deepEqual(buildPower(b), { strength: 1.45, duration: 1 });
  assert.equal(buildPower({ ...b, molt: 1 }).strength, 2.05);
});

test('each buff scales with its own Strength; Brightbonnet raises the others from its own', () => {
  const piece = (/** @type {string[]} */ ids, /** @type {any} */ each) => /** @type {any} */ (buffPiece(ids, 1, 1, 5, 0.9, each)).stats;
  assert.equal(piece(['roar'], { roar: { strength: 3, duration: 1 } }).anyFaction, 1.5);
  assert.equal(piece(['roar', 'vex'], { roar: { strength: 3, duration: 1 } }).anyFaction, 1.5);
  assert.equal(piece(['roar', 'vex'], { roar: { strength: 3, duration: 1 } }).damage, 2.75);
  const alone = piece(['roar', 'bonnet'], { roar: { strength: 2, duration: 1 }, bonnet: { strength: 1, duration: 1 } }).anyFaction;
  const boosted = piece(['roar', 'bonnet'], { roar: { strength: 2, duration: 1 }, bonnet: { strength: 2, duration: 1 } }).anyFaction;
  assert.ok(boosted > alone);
});

const mine = { frame: 'Rhino', tab: 'Mine', strength: 200, duration: 130, reads: 0, own: 1 };

test('your own build comes first, for its frame only', () => {
  assert.equal(defaultBuild(buff('roar'), [mine])?.tab, 'Mine');
  assert.equal(buildsFor(buff('roar'), [mine]).length, buildsFor(buff('roar')).length + 1);
  assert.equal(defaultBuild(buff('nourish'), [mine])?.tab, defaultBuild(buff('nourish'))?.tab);
  assert.equal(buildOf(buff('roar'), buildSlug(/** @type {any} */ (buildsFor(buff('roar'))[0])), [mine])?.own, undefined);
  assert.equal(buildSlug(mine), 'urhinomine');
});

test('a subsumed ability takes the build that subsumes it, with Precision Intensify from the 4th slot', () => {
  const sub = { ...mine, frame: 'Sevagoth', sub: 'Roar' };
  assert.equal(defaultBuild(buff('roar-sub'), [sub])?.strength, 200);
  assert.equal(defaultBuild(buff('roar-sub'), [{ ...sub, fourth: 1 }])?.strength, 290);
  assert.equal(defaultBuild(buff('nourish-sub'), [sub])?.own, undefined);
});

test('Arcane Bellicose counts at its maximum', () => assert.equal(buildPower({ ...mine, bellicose: 1 }).strength, 2.72));

test('your builds survive a link, without what would break it', () => {
  const builds = [{ ...mine, molt: 1, bellicose: 1, fourth: 1, sub: 'Roar' }, { ...mine, tab: 'Two' }];
  assert.deepEqual(ownFromText(ownText(builds)), builds);
  assert.equal(ownFromText(ownText([{ ...mine, tab: 'a~b|c' }]))[0].tab, 'a b c');
  assert.deepEqual(ownFromText(''), []);
  assert.deepEqual(ownFromText('Rhino~x~100~~~A'), []);
  assert.equal(ownFromText('Rhino~5000~100~~~A')[0].strength, 999);
});
