// Reads a mod's max-rank stat lines (DE's Public Export text, e.g. "+165% Damage",
// "x1.55 Damage to Grineer", "On Kill:\n+40% Direct Damage per Status Type affecting the target for
// 20s. Stacks up to 2x.") into effects the damage model can use. Lines it can't read are kept as
// notes, so nothing is silently dropped.

/** Stat names as the game writes them → our ids (riven stat ids where they exist). */
const STATS = {
  'Damage': 'damage', 'Multishot': 'multishot', 'Status Chance': 'statusChance',
  'Critical Chance': 'critChance', 'Critical Damage': 'critDamage', 'Fire Rate': 'fireRate',
  'Magazine Capacity': 'magazine', 'Reload Speed': 'reloadSpeed', 'Ammo Maximum': 'ammoMax',
  'Punch Through': 'punchThrough', 'Projectile Speed': 'projectileSpeed',
  'Status Duration': 'statusDuration', 'Status Damage': 'statusDamage', 'Weapon Recoil': 'recoil',
  'Zoom': 'zoom', 'Heat': 'heat', 'Cold': 'cold', 'Electricity': 'electricity', 'Toxin': 'toxin',
  'Radiation': 'radiation', 'Magnetic': 'magnetic', 'Viral': 'viral', 'Corrosive': 'corrosive',
  'Gas': 'gas', 'Blast': 'blast', 'Impact': 'impact', 'Puncture': 'puncture', 'Slash': 'slash',
  'Weak Point Damage': 'weakpointDamage', 'Weak Point Critical Chance': 'weakpointCrit',
  'to Headshot Multiplier': 'headshotMultiplier', 'Charge Rate': 'chargeRate',
  'Direct Damage': 'directDamage', 'Accuracy': 'accuracy', 'Blast Range': 'blastRange',
  'Beam Range': 'beamRange', 'Range': 'range', 'Fire/Charge Rate': 'fireRate',
  'Combo Duration': 'comboDuration', 'Chance to Explode (Use with Caution)': 'explodeChance',
};

/**
 * @typedef {object} Effect
 * @property {string} stat
 * @property {number} value   raw: +165% → 1.65, x1.55 faction → 0.55, +2.2 m → 2.2
 * @property {string} [on]    trigger, e.g. "kill", "weak point hit", "reload from empty", "first shot"
 * @property {1} [aim]        only while aiming
 * @property {number} [seconds]
 * @property {number} [stacks]
 * @property {string} [per]   "status type": the value counts once per status type on the target
 */

/** The damage type a bare colour tag stands for, where no word follows it. */
const TAG_NAME = { SLASH: 'Slash', IMPACT: 'Impact', PUNCTURE: 'Puncture', FIRE: 'Heat', FREEZE: 'Cold', ELECTRICITY: 'Electricity', POISON: 'Toxin' };

/**
 * Strips the game's colour tags: "<DT_FIRE_COLOR>Heat" → "Heat". A tag with no word after it is the
 * word ("apply <DT_SLASH_COLOR> on Critical" → "apply Slash on Critical").
 * @param {string} s
 */
const plain = s => s
  .replace(/<DT_(\w+?)_COLOR>(?=\s+on\b|\s*$)/g, (m, t) => TAG_NAME[/** @type {keyof typeof TAG_NAME} */ (t)] ?? m)
  .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/**
 * One stat phrase, without trigger: "+90% Heat", "x1.55 Damage to Grineer", "-20% Fire Rate (x2 for Bows)".
 * @param {string} text @returns {Effect | null}
 */
function phrase(text) {
  // "+30% chance to apply Slash on Critical" (Hunter Munitions)
  const onCrit = plain(text).match(/^\+(\d+(?:\.\d+)?)% chance to apply (\w+) on Critical$/);
  if (onCrit) return { stat: `${onCrit[2].toLowerCase()}OnCrit`, value: Number(onCrit[1]) / 100 };
  const m = plain(text).replace(/\s*\(x2 for Bows\)$/, '').match(/^([+-]|x)(\d+(?:\.\d+)?)(%|m|s)?\s+(.+)$/);
  if (!m) return null;
  const [, sign, num, unit, name] = m;
  const n = Number(num);
  const faction = name.match(/^Damage to (?:the )?(\w+)$/i);
  if (sign === 'x' && faction) return { stat: faction[1].toLowerCase(), value: Math.round((n - 1) * 1e6) / 1e6 };
  const stat = STATS[/** @type {keyof typeof STATS} */ (name)];
  if (!stat || sign === 'x') return null;
  const value = (unit === '%' ? n / 100 : n) * (sign === '-' ? -1 : 1);
  return { stat, value: Math.round(value * 1e6) / 1e6 };
}

/**
 * A max-rank stat line (it may hold a trigger and several effects) → effects, or notes if unread.
 * @param {string} line @returns {{effects: Effect[], notes: string[]}}
 */
export function readLine(line) {
  // Line breaks come as real ones (DE's export) or as the two characters "\n" (WFCD's copy).
  const parts = line.split(/\r?\n|\\n/).map(s => s.trim()).filter(Boolean);
  /** @type {Effect[]} */
  const effects = [];
  const notes = [];
  /** @type {Partial<Effect>} */
  let ctx = {};
  let blockStart = 0;                                            // first effect under the current trigger
  for (const raw of parts) {
    if (/:$/.test(raw)) {                                        // "On Weak Point Kill:"
      ctx = { on: raw.slice(0, -1).replace(/^On /, '').toLowerCase() };
      blockStart = effects.length;
      continue;
    }
    if (/^\(.*\)$/.test(raw)) { notes.push(plain(raw)); continue; }   // "(Non-AOE Bows)"
    // Modifiers after the stat: "when Aiming", "for 20s", ". Stacks up to 2x.", "per Status Type…".
    let t = plain(raw);
    /** @type {Partial<Effect>} */
    const extra = {};
    const seconds = t.match(/ for (\d+(?:\.\d+)?)s\b/);
    if (seconds) { extra.seconds = Number(seconds[1]); t = t.replace(seconds[0], ''); }
    const stacks = t.match(/\.?\s*Stacks up to (\d+)x\.?/);
    if (stacks) { extra.stacks = Number(stacks[1]); t = t.replace(stacks[0], ''); }
    if (/ when Aiming/.test(t)) { extra.aim = 1; t = t.replace(/ when Aiming/, ''); }
    if (/ per Status Type affecting the target/.test(t)) { extra.per = 'status type'; t = t.replace(/ per Status Type affecting the target/, ''); }
    const first = t.match(/^(.*) on first shot in Magazine$/);
    if (first) { extra.on = 'first shot'; t = first[1]; }
    if (/ while Invisible$/.test(t)) { extra.on = 'invisible'; t = t.replace(/ while Invisible$/, ''); }
    // Movement triggers written around the stat: Motus Setup "100% Critical and Status Chance for 4s
    // after landing from a Double or Bullet Jump.", Proton Jet "During a Wall Latch gain +120% …".
    if (/ after landing from a Double or Bullet Jump\.?$/.test(t)) { extra.on = 'landing from a double or bullet jump'; t = t.replace(/ after landing from a Double or Bullet Jump\.?$/, ''); }
    if (/^During a Wall Latch gain /.test(t)) { extra.on = 'wall latch'; t = t.replace(/^During a Wall Latch gain /, ''); }
    // No sign means a bonus: "100% Critical and Status Chance" is +100% to each.
    t = t.replace(/^(\d)/, '+$1');
    // Acuity: "+350% Weak Point Critical Chance. Multishot cannot be modified." (a lock, as its own effect)
    /** @type {Effect[]} */
    const also = [];
    if (/\. Multishot cannot be modified\.?$/.test(t)) { also.push({ stat: 'multishotLocked', value: 1 }); t = t.replace(/\. Multishot cannot be modified\.?$/, ''); }
    t = t.replace(/\.$/, '').trim();
    // "+60% Critical Chance and Damage" (Critical Focus) is two stats.
    t = t.replace(/^([+-]\d+(?:\.\d+)?%) Critical Chance and Damage$/, '$1 Critical Chance and $1 Critical Damage')
      // …and so are "100% Critical and Status Chance" and "+120% Status Chance and Critical Chance".
      .replace(/^([+-]\d+(?:\.\d+)?%) Critical and Status Chance$/, '$1 Critical Chance and $1 Status Chance')
      .replace(/^([+-]\d+(?:\.\d+)?%) Status Chance and Critical Chance$/, '$1 Status Chance and $1 Critical Chance');
    // "+20% Projectile Speed and +20% Beam Range": both halves must read.
    const whole = phrase(t);
    const read = [...(whole ? [whole] : t.split(/ and (?=[+-]\d)/).map(phrase)), ...also];
    if (read.length && read.every(Boolean)) {
      for (const e of read) effects.push(/** @type {Effect} */ ({ ...e, ...ctx, ...extra }));
      // Duration and stacks at the end of a trigger's block cover the block's earlier lines too.
      if (ctx.on && (extra.seconds || extra.stacks)) {
        for (let i = blockStart; i < effects.length; i++) {
          if (extra.seconds) effects[i].seconds ??= extra.seconds;
          if (extra.stacks) effects[i].stacks ??= extra.stacks;
        }
      }
    } else {
      notes.push(plain(raw));
    }
    // A trigger covers the lines under it until the next "…:" line, except the rank-scaled
    // "Stacks up to" line ends its block.
    if (extra.stacks) ctx = {};
  }
  return { effects, notes };
}

/**
 * All of a mod's max-rank lines. A trigger line repeats unconditional stats the mod lists on their
 * own (Primary Merciless: "+30% Reload Speed" twice): duplicates are dropped.
 * @param {string[]} lines @returns {{effects: Effect[], notes: string[]}}
 */
export function readStats(lines) {
  /** @type {Effect[]} */
  const effects = [];
  const notes = [];
  for (const line of lines) {
    const r = readLine(line);
    for (const e of r.effects) {
      if (!effects.some(x => JSON.stringify(x) === JSON.stringify(e))) effects.push(e);
    }
    notes.push(...r.notes);
  }
  return { effects, notes };
}
