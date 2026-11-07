// @ts-check
// The damage model's settings (the page's model section, src/ui/model.js) turned into a riven study's
// input (src/study.js), with what the page shows about them. Pure: the page and the precomputed
// studies (tools/precompute-studies.mjs) build their inputs here, so a precomputed study is found by
// the same input the page would run.

import { WEAPONS } from './data/weapons.js';
import { SPLICED } from './data/stats.js';
import { pools } from './cycle.js';
import { cycleOf, evolutionsOf, isForm, takesAdapter } from './incarnon.js';
import { combosFor, PLAIN } from './melee.js';
import { arcaneNames, SCENARIOS } from './build.js';
import { targetOf, roomOf } from './enemies.js';
import { BATTLEGROUPS } from './data/battlegroups.js';
import { BUFFS } from './data/buffs.js';
import { buffPiece, buildOf, buildPower } from './buffs.js';

/** @typedef {import('./data/stats.js').Shape} Shape */
/** @typedef {'room' | 'single' | 'weak' | 'slam'} Role */
/** @typedef {import('./data/weapon-stats.js').WeaponStats['modes'][number]} WeaponMode */

/** The roles a weapon's rivens are judged for: what the build is for. Slam is melee's alone. */
export const ROLES = /** @type {[Role, string][]} */ ([
  ['room', 'Fodder clear'], ['single', 'Single target'], ['weak', 'Weak points'], ['slam', 'Slam']]);

/** The model's settings, as the page starts. */
export const defaultModel = () => ({
  shape: /** @type {Shape} */ ('+++-'),
  mode: -1,                                   // fire mode index, -1 = the weapon's main one
  scenario: /** @type {Role} */ ('room'),     // the role (slam: melee's slams in room clearing)
  enemy: '',                                  // the target's faction group (src/data/enemies.js GROUPS; '' = any)
  unit: '',                                   // the faction's unit ('' = its default)
  level: 150,
  steelPath: false,
  armor: 0,                                   // 0 = stripped; else full (2700 without a faction)
  primed: false,                              // every status type on the target
  buffs: /** @type {string[]} */ ([]),        // buffs from outside the build (src/data/buffs.js)
  eximus: 5,                                  // how many of a battlegroup's 20 are Eximus
  panzer: 5,                                  // the stacks a primer companion keeps on the target
  heads: 90,                                  // the share of hits on heads in Void's bubble, %
  builds: /** @type {Record<string, string>} */ ({}), // a buff's build, where it isn't the default ('x': the two below)
  own: /** @type {import('./buffs.js').BuffBuild[]} */ ([]), // the person's builds, read from Underframe links
  strength: 100,                              // Ability Strength and Duration, %, for buffs without a build
  duration: 100,
  energy: 0,                                  // the frame's Max Energy (Primary Overcharge; 0: not counted)
  shields: 0,                                 // the frame's current shields (Melee Retaliation; 0: not counted)
  exposure: true,                             // Melee Exposure kept at its cap (abilities cast often), or not
  spread: false,                              // judge builds on a third of the level and three times it too
  burst: false,
  valence: 'best',                            // an adversary weapon's Valence bonus: its element ('best': each tried)
  valencePct: 60,                             // and its size, 25–60%
  // An Incarnon gun: no adapter, evolved but never transforming, or the charge and form cycle.
  incarnon: /** @type {'normal' | 'off' | 'on'} */ ('off'),
  perks: /** @type {number[] | null} */ (null), // an incarnon's perk per evolution; null = the best combination
  perksOf: '',                                // the weapon those perks are for
  arcane: /** @type {string | null} */ (null), // the arcane builds carry: null = the best found, '' = none
  // Melee:
  combo: /** @type {'initial' | 'max' | 'build'} */ ('build'), // the combo counter
  stanceCombo: '',                            // "Stance|Key|Combo" ('' = the best per swing, or the best slam)
  heavy: false,                               // heavy attacks, not only normal ones
  heavyAt: 6,                                 // the combo tier a built-up counter spends at
  nearby: 3,                                  // enemies inside a swing (room clearing)
  close: 6,                                   // enemies within 20 m of the target (Melee Influence)
  clump: 50,                                  // clumping, %: how many of those stand within 20 m of each other
});

/** @typedef {ReturnType<typeof defaultModel>} ModelState */

/** A unique slam's pulses that land on one enemy, on average (seen in game). @type {Record<string, number>} */
const SLAM_PULSES = { Sampotes: 1.5 };
/** A slam pulse's damage at its average distance, against its full (seen: 70-100%). */
const SLAM_FALLOFF = 0.85;

/**
 * The slams a melee weapon can be judged by, the heavy slam first: its own Heavy Slam Attack and Slam
 * Attack (the wiki's damage and type: Blast at three times the normal attack's, Impact at twice), or
 * a unique stance's own (Sampotes, Tenet Exec: multiples of the normal attack) in their place.
 * @param {import('./data/weapon-stats.js').WeaponStats} w @param {string} weapon
 */
export function slamsFor(w, weapon) {
  const listed = combosFor(w.kind, weapon).filter(c => c.slam);
  const normal = Object.values(w.modes[w.main]?.parts[0]?.dmg ?? {}).reduce((a, b) => a + b, 0) || 1;
  const own = (/** @type {string} */ key, /** @type {string} */ modeName) => {
    const unique = listed.find(c => c.stance && c.combo.key === key);
    const i = w.modes.findIndex(m => m.name === modeName);
    const total = i < 0 ? 0 : Object.values(w.modes[i].parts[0]?.dmg ?? {}).reduce((a, b) => a + b, 0);
    if (unique && i >= 0) {
      // A unique slam's pulses each do the weapon's own slam damage, less with distance (in game, a
      // Sampotes heavy slam's pulses read 70-100% of its arsenal Heavy Slam Attack on unarmored
      // Infested); one target takes a few of them (Sampotes: 3 lines of 4, about 1.5 on each enemy).
      // (The wiki's 500% a pulse isn't of the normal attack.)
      const hits = unique.combo.attacks.flat();
      const pulses = hits.reduce((n, h) => n + h[1], 0);
      const onTarget = SLAM_PULSES[weapon] ?? pulses;
      /** @type {import('./data/stances.js').Hit[][]} */
      const attacks = [[[SLAM_FALLOFF, onTarget, hits[0]?.[2] ?? '', 'slam']]];
      return { ...unique, combo: { ...unique.combo, attacks }, perSwing: total / normal * SLAM_FALLOFF * onTarget, mode: i, heavy: key === 'Heavy Slam' };
    }
    if (unique) return { ...unique, mode: w.main, heavy: key === 'Heavy Slam' };
    const shared = listed.find(c => !c.stance && c.combo.key === key);
    if (i < 0) return shared ? { ...shared, mode: -1, heavy: false } : null;
    /** @type {import('./data/stances.js').Hit[][]} */
    const attacks = [[[1, 1, '', 'slam']]];
    return { stance: '', combo: { key, name: key, attacks }, slam: true, label: key, perSwing: total / normal, mode: i, heavy: key === 'Heavy Slam' };
  };
  return [own('Heavy Slam', 'Heavy Slam Attack'), own('Slam', 'Slam Attack')].filter(c => c !== null);
}

/** A combo's id in links: stance, key and name. @param {ReturnType<typeof combosFor>[number]} c */
export const comboId = c => `${c.stance}|${c.combo.key}|${c.combo.name}`;

/**
 * A weapon's study input under these settings, and what the page shows about them. Settings that
 * don't fit the weapon are put right in `s` (a fire mode it lacks, another weapon's perks or arcane).
 * @param {string} weapon @param {string} cls @param {ModelState} s
 * @param {{stats: Record<string, import('./data/weapon-stats.js').WeaponStats>, enemies: typeof import('./data/enemies.js')}} data
 */
export function modelInput(weapon, cls, s, { stats, enemies }) {
  const w = stats[weapon];
  if (!w) return null;
  const isMelee = cls === 'melee' && !!w.melee;
  // Slam is a melee role: a gun takes it as fodder clearing.
  const role = s.scenario === 'slam' && !isMelee ? 'room' : s.scenario;
  const scenario = /** @type {keyof typeof SCENARIOS} */ (role === 'slam' ? 'room' : role);
  if (s.mode >= w.modes.length) s.mode = -1;
  // Chosen perks belong to one weapon (a link's to the weapon it opens with); another starts at the best.
  const evolutions = evolutionsOf(weapon);
  if (s.perksOf === '?') s.perksOf = weapon;
  if (s.perksOf !== weapon || s.perks?.length !== evolutions.length) { s.perks = null; s.perksOf = weapon; }
  // No adapter, normal fire or Incarnon: the choice decides the perks and which fire modes there are.
  // (A link from before the choice names the Incarnon Form as its fire mode.)
  if (w.modes[s.mode] && isForm(w.modes[s.mode])) s.incarnon = 'on';
  const incarnon = !evolutions.length ? 'normal' : s.incarnon === 'normal' && !takesAdapter(weapon) ? 'off' : s.incarnon;
  // A melee weapon's slam attacks are its slams' (the Slam role), not fire modes to pick for combos.
  const slamMode = (/** @type {WeaponMode} */ m) => isMelee && /slam/i.test(m.name);
  const modes = w.modes.flatMap((m, i) => (isForm(m) === (incarnon === 'on') && !slamMode(m) ? [i] : []));
  let mode = modes.includes(s.mode) ? s.mode : modes.includes(w.main) ? w.main : modes[0];
  const isBeam = w.modes[mode]?.held != null;
  const cycle = incarnon === 'on' ? cycleOf(weapon, w) : null;
  // The target: one of the faction's units at its level. Any faction: a Grineer unit's health and
  // armor without faction weaknesses (builds are judged by fights, src/fight.js, so there's always one).
  const group = enemies.GROUPS.find(g => g.id === s.enemy) ?? null;
  const pick = group?.id ?? 'grineer';
  const units = enemies.UNITS[pick] ?? [];
  const unit = units.find(u => u.name === s.unit) ?? units.find(u => u.name === enemies.DEFAULT_UNIT[pick]) ?? null;
  const targetAt = (/** @type {number} */ lvl) => (unit ? targetOf(group ? unit : { ...unit, types: '' }, lvl, s.steelPath, !s.armor, enemies) : null);
  const target = targetAt(s.level);
  // Room clearing fights the faction's battlegroup, unless a unit is chosen.
  const battlegroup = SCENARIOS[scenario].kills ? BATTLEGROUPS[pick] ?? null : null;
  const mix = battlegroup && !s.unit ? battlegroup : null;
  const roomAt = (/** @type {number} */ lvl) => (mix ? { room: roomOf(pick, mix.members, lvl, s.steelPath, !s.armor, enemies, group ? undefined : '', s.eximus) } : {});
  // A third of the level and three times it: 150 is judged at 50 and 450 as well.
  const levels = [Math.max(1, Math.round(s.level / 3)), Math.min(9999, s.level * 3)];
  // The arcane: one of this weapon's slot, or the best found.
  const arcanes = arcaneNames(cls);
  if (s.arcane && !arcanes.includes(s.arcane)) s.arcane = null;
  // Melee: the stance combos (the best per swing unless chosen), or for slamming the slams (the heavy
  // slam unless chosen); then the combo counter and the crowd.
  const combos = !isMelee ? [] : role === 'slam' ? slamsFor(w, weapon) : combosFor(w.kind, weapon).filter(c => !c.slam);
  const chosen = combos.find(c => comboId(c) === s.stanceCombo) ?? combos.find(c => `${c.stance}|${c.combo.name}` === s.stanceCombo) ?? combos[0] ?? null;
  // (Slamming always slams: a 200% slam when there are no slam data.)
  const attacks = chosen?.combo.attacks ?? (role === 'slam' ? [[[2, 1, '', 'slam']]] : PLAIN);
  if (chosen && 'mode' in chosen && chosen.mode >= 0) mode = chosen.mode;
  const heavySlam = chosen && 'heavy' in chosen && chosen.heavy ? chosen.combo.attacks[0] : null;
  const comboName = chosen ? chosen.label : role === 'slam' ? 'a 200% slam' : 'none in the wiki’s data: plain hits';
  // The buffs this weapon can use, and those chosen.
  const usable = BUFFS.filter(b => (b.for ?? (isMelee ? 'melee' : 'guns')) === (isMelee ? 'melee' : 'guns') && !(b.noArchgun && cls === 'archgun'));
  const chosenBuffs = usable.filter(b => s.buffs.includes(b.id));
  // What each is cast with, from its build.
  const scales = (/** @type {typeof BUFFS[number]} */ b) => b.effects.some(e => e[2] === 's' || e[2] === 'd');
  const each = Object.fromEntries(chosenBuffs.filter(scales).flatMap(b => { const o = buildOf(b, s.builds[b.id], s.own); return o ? [[b.id, buildPower(o)]] : []; }));
  const opts = {
    mode, ...(cycle ? { incarnon: cycle } : {}), enemy: group?.bane ?? '', burst: s.burst, primed: s.primed,
    ...(s.arcane !== null ? { arcane: s.arcane } : {}),
    ...(isMelee ? { melee: heavySlam
      // A heavy slam every attack: it spends the combo (keeping Heavy Attack Efficiency's share), and
      // a built-up counter only climbs back to the initial combo between them.
      ? { attacks, combo: s.combo, heavySlam, heavyAt: 1, nearby: s.nearby, close: s.close, clump: s.clump / 100 }
      : { attacks, combo: s.combo, heavy: s.heavy, heavyAt: s.heavyAt, nearby: s.nearby, close: s.close, clump: s.clump / 100 } } : {}),
    ...(target ? { target, ...roomAt(s.level) } : { armor: s.armor }),
    ...(target && s.spread ? { spread: levels.map(l => ({ target: /** @type {import('./sim.js').Target} */ (targetAt(l)), ...roomAt(l) })) } : {}),
    ...(s.energy ? { maxEnergy: s.energy } : {}),
    ...(s.shields && isMelee ? { shields: s.shields } : {}),
    ...(!s.exposure && isMelee ? { exposure: false } : {}),
    ...(chosenBuffs.length ? { buffs: buffPiece(chosenBuffs.map(b => b.id), s.strength / 100, s.duration / 100, s.panzer, s.heads / 100, each) } : {}),
    ...(!isMelee && SCENARIOS[scenario].kills ? { crowd: { close: s.close, clump: s.clump / 100 } } : {}),
    bow: WEAPONS.find(x => x[0] === weapon)?.[2] === 1,
    ...(w.adversary ? { valence: { type: s.valence, value: s.valencePct / 100 } } : {}),
  };
  const pool = pools(cls, WEAPONS.find(x => x[0] === weapon)?.[3]);
  const positives = [...pool.positive, ...SPLICED.filter(x => x.b[cls] !== undefined).map(x => x.id)];
  /** @type {import('./study.js').StudyInput} */
  const input = { weapon, cls: /** @type {import('./study.js').StudyInput['cls']} */ (cls), shape: s.shape, scenario, opts, positives, negatives: pool.negative, perks: s.perks ?? 'best', adapter: incarnon !== 'normal' };
  return {
    w, isMelee, role, scenario, evolutions, incarnon, modes, mode, isBeam, cycle, group, units, unit, target, battlegroup, mix,
    levels, arcanes, combos, chosen, comboName, usable, chosenBuffs, scales, each, opts, pool, positives, input,
  };
}
