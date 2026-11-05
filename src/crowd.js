// @ts-check
// A crowd: the other enemies an attack reaches in a room, for guns (melee: src/fight.js's swings). Pure.
//
// The crowd is `close` enemies around the target, spread evenly over a disc: 20 m across its radius
// when not clumped at all, 5 m when fully. What each attack reaches, as enemies' worth of its damage on
// top of the target:
// - An explosion: those inside its radius, each at the average its falloff leaves over the disc. An
//   area attack without a falloff in the wiki's data has no known radius: nothing.
// - A beam that chains (mode.chain, the weapons' wiki pages): each link needs an enemy in range, taking
//   the share of the one before, or of the main beam (`flat`). Boar's form fires up to 3 beams, the
//   others taken to need a further target in the crowd and to do what the first does.
// - Punch Through, on other direct hits: the enemies in line behind the target, in a path 1.5 m wide
//   from it to the edge of the crowd. A body uses about 0.6 m (the wiki's Punch Through: 1.2 m passes two
//   Butchers, 2.1 m four), no damage is lost, and air costs nothing. It wears off smoothly as it nears
//   what's there to hit. Nothing for area attacks (they burst on contact) or beams (it only moves a
//   chain's targets around, the wiki's Continuous Weapon).

/** @typedef {{close: number, clump: number}} Crowd */
/** @typedef {import('./data/weapon-stats.js').Part} Part */
/** @typedef {import('./data/weapon-stats.js').Mode} Mode */

/** Metres of Punch Through a body uses, and the width of the path a shot sweeps. */
const BODY = 0.6, PATH = 1.5;

/** The crowd's radius, m. @param {Crowd} crowd */
export const crowdRadius = crowd => 20 * (1 - 0.75 * Math.min(1, Math.max(0, crowd.clump)));

/** Enemies of the crowd within `metres` of the target. @param {Crowd} crowd @param {number} metres */
const within = (crowd, metres) => crowd.close * Math.min(1, (metres / crowdRadius(crowd)) ** 2);

/**
 * What's left of an explosion on average over its disc: full to `from`, down by `cut` at `to`.
 * @param {{from: number, to: number, cut: number}} f
 */
export const discMean = ({ from: a, to: b, cut }) => 1 - cut * (2 * b * b - a * b - a * a) / (3 * b * b);

/**
 * What a beam's chains reach. @param {NonNullable<Mode['chain']>} c @param {Crowd} crowd
 */
function chained(c, crowd) {
  const link = 1 - Math.exp(-within(crowd, c.range));
  let links = 0;
  for (let k = 1; k <= c.links; k++) links += link ** k * (c.flat ? c.share : c.share ** k);
  const more = ((c.beams ?? 1) - 1) * (1 - Math.exp(-crowd.close));
  return (1 + links) * (1 + more) - 1;
}

/**
 * The enemies' worth of damage an attack adds beyond its target.
 * @param {Part} p @param {Mode} mode @param {number} punchThrough  the build's, m @param {Crowd} crowd
 */
export function reachOf(p, mode, punchThrough, crowd) {
  if (crowd.close <= 0) return 0;
  if (p.aoe) return p.falloff ? within(crowd, p.falloff.to) * discMean(p.falloff) : 0;
  if (mode.chain) return chained(mode.chain, crowd);
  if (mode.held != null || mode.parts.some(q => q.aoe)) return 0;
  const line = PATH * crowd.close / (Math.PI * crowdRadius(crowd));
  return line * (1 - Math.exp(-Math.max(0, (p.pt ?? 0) + punchThrough) / BODY / line));
}
