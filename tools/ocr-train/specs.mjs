// Random riven card contents for synthetic OCR data, drawn the way the game does: a real weapon,
// a shape, distinct stats from that weapon's pools, rolls across the full range, the riven's name
// from its positives, and every line formatted as the game shows it. render.py draws them.
//
//   node tools/ocr-train/specs.mjs 500 > tools/ocr-train/out/specs.jsonl
//   node tools/ocr-train/specs.mjs 500 42      (second number: random seed, for repeatable sets)

import { STAT_BY_ID, SHAPES, SPLICED } from '../../src/data/stats.js';
import { SHAPE_ORDER, displayValue } from '../../src/engine.js';
import { WEAPONS } from '../../src/data/weapons.js';
import { pools } from '../../src/cycle.js';

const count = Number(process.argv[2] ?? 100);
let seed = Number(process.argv[3] ?? Date.now()) >>> 0;
/** Small seeded generator (mulberry32), so a seed always gives the same set. */
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (/** @type {any[]} */ a) => a[Math.floor(rand() * a.length)];
const shuffle = (/** @type {any[]} */ a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** A number as the game shows it: up to `dp` decimals, trailing zeros dropped (60%, x0.6). */
const num = (/** @type {number} */ x, dp = 1) => String(Number(Math.abs(x).toFixed(dp)));

// Stats with a damage-type icon before their name.
export const ICONS = new Set(['heat', 'cold', 'toxin', 'electricity', 'corrosive', 'viral', 'radiation', 'magnetic',
  'gas', 'blast', 'impact', 'puncture', 'slash']);

// Where the game's wording differs from our stat names.
const GAME_NAMES = {
  weakpointDamage: 'Weak Point Damage',
  weakpointCrit: 'Weak Point Critical Chance',
  reloadWhileHolstered: 'Magazine Reloaded/s when Holstered',
};

/** One stat line as the game shows it. */
export function line(stat, cls, isBow, v) {
  const name = GAME_NAMES[stat.id] ?? ((cls === 'melee' && stat.meleeName) || stat.name);
  const extra = stat.id === 'critChance' && cls === 'melee' ? ' (x2 for Heavy Attacks)'
    : stat.id === 'fireRate' && cls !== 'melee' ? ' (x2 for Bows)' : '';   // on every gun, seen in game
  if (stat.unit === 'mult') return `x${num(v, 2)} ${name}${extra}`;
  const sign = v < 0 ? '-' : '+';
  const unit = stat.unit === 'sec' ? 's' : stat.unit === 'pct' || stat.unit === 'pctNeg' ? '%' : '';
  return `${sign}${num(v)}${unit} ${name}${extra}`;
}

/** The riven's name from its positives: 1–2 prefixes then the last one's suffix ("Toxi-vexipha"). */
export function rivenName(ids) {
  const st = ids.map(id => STAT_BY_ID[id]);
  const suffix = st[st.length - 1].suffix.toLowerCase();
  // One named positive (the rest spliced): its own prefix and suffix.
  const pre = (st.length > 1 ? st.slice(0, -1) : st).map(s => s.prefix.toLowerCase());
  const word = pre.length === 2 ? `${pre[0]}-${pre[1]}${suffix}` : `${pre[0]}${suffix}`;
  return word[0].toUpperCase() + word.slice(1);
}

function main() {
const out = [];
const rivenable = WEAPONS.filter(w => w[1]);
for (let n = 0; n < count; n++) {
  const [weapon, cls, isBow, ips] = pick(rivenable);
  const { positive, negative } = pools(cls, ips);
  const shape = pick(SHAPE_ORDER);
  const { positives: k, negatives: c } = SHAPES[shape];
  // Sometimes a spliced stat (a riven can carry one), in a random positive slot.
  const spliced = rand() < 0.15 ? pick(SPLICED.filter(s => s.b[cls] !== undefined)) : null;
  const pos = shuffle([...positive]).slice(0, k - (spliced ? 1 : 0));
  if (spliced) pos.splice(Math.floor(rand() * (pos.length + 1)), 0, spliced.id);
  const neg = c ? pick(negative.filter(id => !pos.includes(id))) : null;
  const rank = rand() < 0.75 ? 8 : rand() < 0.5 ? 0 : Math.floor(rand() * 9);
  const stats = [...pos.map(id => ({ id, sign: '+' })), ...(neg ? [{ id: neg, sign: '-' }] : [])].map(s => {
    const stat = STAT_BY_ID[s.id];
    const v = displayValue(stat, cls, shape, s.sign, rand(), rank);
    return { statId: s.id, sign: s.sign, text: line(stat, cls, isBow, v), icon: ICONS.has(s.id) ? s.id : null, locked: rand() < 0.12 };
  });
  // Name: the positives in a random order; a spliced stat's name parts aren't all known, so a
  // riven with one gets a name from the ordinary positives only (as if the name was rolled
  // before the splice, which is how the game keeps it).
  const named = shuffle(pos.filter(id => !STAT_BY_ID[id].spliced && STAT_BY_ID[id].prefix));
  const name = named.length ? rivenName(named.slice(0, 3)) : 'Visitio';
  out.push({
    // "(Zaw)" and "(Kitgun)" are our labels; the game does show "Vinquibus (melee)".
    weapon, cls, shape, rank, title: `${weapon.replace(/\s*\((Zaw|Kitgun)\)$/, '')} ${name}`,
    drain: 10 + rank, mr: 8 + Math.floor(rand() * 9), cycles: rand() < 0.2 ? 0 : 1 + Math.floor(rand() * 120),
    stats,
  });
}
for (const o of out) console.log(JSON.stringify(o));
}

if (import.meta.main) main();
