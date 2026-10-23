// @ts-check
// Riven stat coefficients and shape multipliers.
//
// Source: Warframe wiki "Riven Mods" base-coefficient tables (post Hotfix 44.1.3, dispositions
// removed). Sign rules cross-checked against warframe.market's riven attribute list; see the
// "Data decisions" section of PLAN.md for the discrepancies and how they were resolved.

/** @typedef {'rifle' | 'shotgun' | 'pistol' | 'archgun' | 'melee'} WeaponClass */
/** @typedef {'++' | '++-' | '+++' | '+++-'} Shape */

/**
 * How a raw value v is shown:
 * - pct     100v %         (most stats; Weapon Recoil has a negative b, so buffs show negative)
 * - pctNeg  -100v %        (Ammo Efficiency, Chance to Gain Combo Count)
 * - mult    x(1 + v)       (faction damage)
 * - sec / m / flat  raw v  (Combo Duration / Range, Punch Through / Initial Combo)
 * @typedef {'pct' | 'pctNeg' | 'mult' | 'sec' | 'm' | 'flat'} Unit
 */

/** @typedef {'both' | 'posOnly' | 'negOnly'} Polarity */

/**
 * @typedef {object} Stat
 * @property {string} id
 * @property {string} name
 * @property {string} [meleeName]   name shown on melee rivens, when it differs
 * @property {string | null} prefix
 * @property {string | null} suffix
 * @property {Partial<Record<WeaponClass, number>>} b   base coefficient; missing = can't roll
 * @property {Unit} unit
 * @property {Polarity} polarity
 * @property {boolean} spliced
 * @property {string[][]} [from]    spliced only: pairs of ordinary stat ids that splice into it
 */

/** @type {WeaponClass[]} */
export const CLASSES = ['rifle', 'shotgun', 'pistol', 'archgun', 'melee'];

export const DISPOSITION = 1.2;
export const MAX_RANK = 8;

/** Bonus/malus multipliers (L) per shape. `malus` is null when the shape has no negative. */
/** @type {Record<Shape, {positives: number, negatives: number, bonus: number, malus: number | null}>} */
export const SHAPES = {
  '++':   { positives: 2, negatives: 0, bonus: 0.99,   malus: null },
  '++-':  { positives: 2, negatives: 1, bonus: 1.2375, malus: -0.495 },
  '+++':  { positives: 3, negatives: 0, bonus: 0.75,   malus: null },
  '+++-': { positives: 3, negatives: 1, bonus: 0.9375, malus: -0.75 },
};

const _ = null;

/**
 * Builds the per-class coefficient map from a [rifle, shotgun, pistol, archgun, melee] row,
 * mirroring the wiki table's column order.
 * @param {(number | null)[]} row
 */
function perClass(row) {
  /** @type {Partial<Record<WeaponClass, number>>} */
  const b = {};
  CLASSES.forEach((cls, i) => { if (row[i] !== null) b[cls] = /** @type {number} */ (row[i]); });
  return b;
}

/**
 * @param {string} id
 * @param {string} name
 * @param {string | null} prefix
 * @param {string | null} suffix
 * @param {(number | null)[]} row
 * @param {Unit} unit
 * @param {Polarity} polarity
 * @param {Partial<Stat>} [extra]
 * @returns {Stat}
 */
function stat(id, name, prefix, suffix, row, unit, polarity, extra = {}) {
  return { id, name, prefix, suffix, b: perClass(row), unit, polarity, spliced: false, ...extra };
}

const ALL5 = (/** @type {number} */ x) => [x, x, x, x, x];
const ELEMENT = [0.01, 0.01, 0.01, 0.0133, 0.01];

/** The 32 ordinary (rollable) stats. */
export const ORDINARY = [
  //   id                   name                               prefix    suffix   rifle      shotgun    pistol     archgun    melee
  stat('damage',            'Damage',                          'Visi',   'Ata',   [0.0183333,0.0183,    0.0244,    0.0111,    0.0183],   'pct',    'both', { meleeName: 'Melee Damage' }),
  // Faction damage
  stat('corpus',            'Damage to Corpus',                'Manti',  'Tron',  ALL5(0.005),                                             'mult',   'both'),
  stat('grineer',           'Damage to Grineer',               'Argi',   'Con',   ALL5(0.005),                                             'mult',   'both'),
  stat('infested',          'Damage to Infested',              'Pura',   'Ada',   ALL5(0.005),                                             'mult',   'both'),
  // Base elements
  stat('cold',              'Cold',                            'Geli',   'Do',    ELEMENT,                                                 'pct',    'posOnly'),
  stat('electricity',       'Electricity',                     'Vexi',   'Tio',   ELEMENT,                                                 'pct',    'posOnly'),
  stat('heat',              'Heat',                            'Igni',   'Pha',   ELEMENT,                                                 'pct',    'posOnly'),
  stat('toxin',             'Toxin',                           'Toxi',   'Tox',   ELEMENT,                                                 'pct',    'posOnly'),
  // Physical damage
  stat('impact',            'Impact',                          'Magna',  'Ton',   [0.013333, 0.013333,  0.013333,  0.01,      0.0133],   'pct',    'both'),
  stat('puncture',          'Puncture',                        'Insi',   'Cak',   [0.01333,  0.01333,   0.01333,   0.01,      0.0133],   'pct',    'both'),
  stat('slash',             'Slash',                           'Sci',    'Sus',   [0.013333, 0.013333,  0.013333,  0.01,      0.0133],   'pct',    'both'),
  // Everything else, alphabetical (gun and melee)
  stat('additionalCombo',   'Additional Combo Count Chance',   'Laci',   'Nus',   [_,        _,         _,         _,         0.00653],  'pct',    'posOnly'),
  stat('ammoMax',           'Ammo Maximum',                    'Ampi',   'Bin',   [0.00555,  0.01,      0.01,      0.0111,    _],        'pct',    'both'),
  stat('chanceToGainCombo', 'Chance to Gain Combo Count',      null,     null,    [_,        _,         _,         _,         -0.01165], 'pctNeg', 'negOnly'),
  stat('comboDuration',     'Combo Duration',                  'Tempi',  'Nem',   [_,        _,         _,         _,         0.09],     'sec',    'both'),
  stat('critChance',        'Critical Chance',                 'Crita',  'Cron',  [0.016666, 0.01,      0.016666,  0.0111,    0.02],     'pct',    'both'),
  stat('slideCrit',         'Critical Chance for Slide Attack','Pleci',  'Nent',  [_,        _,         _,         _,         0.013334], 'pct',    'both'),
  stat('critDamage',        'Critical Damage',                 'Acri',   'Tis',   [0.013333, 0.01,      0.01,      0.0089,    0.01],     'pct',    'both'),
  stat('finisher',          'Finisher Damage',                 'Exi',    'Cta',   [_,        _,         _,         _,         0.0133],   'pct',    'both'),
  stat('fireRate',          'Fire Rate',                       'Croni',  'Dra',   [0.00667,  0.01,      0.0083,    0.00667,   0.0061],   'pct',    'both', { meleeName: 'Attack Speed' }),
  stat('heavyEfficiency',   'Heavy Attack Efficiency',         'Forti',  'Us',    [_,        _,         _,         _,         0.00816],  'pct',    'both'),
  stat('initialCombo',      'Initial Combo',                   'Para',   'Um',    [_,        _,         _,         _,         0.27224],  'flat',   'posOnly'),
  stat('magazine',          'Magazine Capacity',               'Arma',   'Tin',   [0.005555, 0.005555,  0.005555,  0.0067,    _],        'pct',    'both'),
  stat('multishot',         'Multishot',                       'Sati',   'Can',   [0.01,     0.0133,    0.0133,    0.0067,    _],        'pct',    'both'),
  stat('projectileSpeed',   'Projectile Speed',                'Conci',  'Nak',   [0.01,     0.01,      0.01,      _,         _],        'pct',    'both'),
  stat('punchThrough',      'Punch Through',                   'Lexi',   'Nok',   [0.03,     0.03,      0.03,      0.03,      _],        'm',      'posOnly'),
  stat('range',             'Range',                           'Locti',  'Tor',   [_,        _,         _,         _,         0.02158],  'm',      'both'),
  stat('reloadSpeed',       'Reload Speed',                    'Feva',   'Tak',   [0.005555, 0.005555,  0.005555,  0.0111,    _],        'pct',    'both'),
  stat('statusChance',      'Status Chance',                   'Hexa',   'Dex',   [0.01,     0.01,      0.01,      0.0067,    0.01],     'pct',    'both'),
  stat('statusDuration',    'Status Duration',                 'Deci',   'Des',   ALL5(0.01111),                                           'pct',    'both'),
  stat('recoil',            'Weapon Recoil',                   'Zeti',   'Mag',   [-0.01,    -0.01,     -0.01,     -0.01,     _],        'pct',    'both'),
  stat('zoom',              'Zoom',                            'Hera',   'Lis',   [0.006666, 0.004666,  0.0089,    0.006666,  _],        'pct',    'both'),
];

/**
 * @param {string} id
 * @param {string} name
 * @param {string} prefix
 * @param {string} suffix
 * @param {(number | null)[]} row
 * @param {Unit} unit
 * @param {string[][]} from
 * @returns {Stat}
 */
function spliced(id, name, prefix, suffix, row, unit, from) {
  return { ...stat(id, name, prefix, suffix, row, unit, 'posOnly'), spliced: true, from };
}

const MELEE_ONLY = (/** @type {number} */ x) => [_, _, _, _, x];
const RANGED = (/** @type {number} */ x) => [x, x, x, x, _];

/** The 18 spliced stats. Always positive; they inherit the higher roll of their two parents. */
export const SPLICED = [
  spliced('ammoEfficiency',      'Ammo Efficiency',              'Parci', 'Pia',  RANGED(-0.005),      'pctNeg', [['magazine', 'reloadSpeed'], ['recoil', 'ammoMax']]),
  spliced('heavyWindup',         'Heavy Attack Wind Up Speed',   'Veri',  'Lus',  MELEE_ONLY(0.0133),  'pct',    [['heavyEfficiency', 'comboDuration']]),
  spliced('meleeDamageOnHeavy',  'Melee Damage On Heavy Attack', 'Robi',  'Ndo',  MELEE_ONLY(0.0133),  'pct',    [['heavyEfficiency', 'additionalCombo']]),
  spliced('parryAngle',          'Parry Angle',                  'Defi',  'So',   MELEE_ONLY(0.009),   'pct',    [['fireRate', 'range']]),
  spliced('reloadWhileHolstered','Reload While Holstered',       'Auxi',  'Rro',  [0.01, 0.01, 0.01, _, _], 'pct', [['ammoMax', 'reloadSpeed'], ['ammoMax', 'magazine']]),
  spliced('slamDamage',          'Slam Attack Damage',           'Proci', 'Lam',  MELEE_ONLY(0.0133),  'pct',    [['damage', 'fireRate']]),
  spliced('statusDamage',        'Status Damage',                'Plaga', 'Mna',  ALL5(0.01),          'pct',    [['damage', 'statusChance']]),
  spliced('weakpointDamage',     'Weakpoint Damage',             'Eni',   'Vo',   RANGED(0.025),       'pct',    [['damage', 'zoom'], ['damage', 'multishot']]),
  spliced('weakpointCrit',       'Weakpoint Critical Chance',    'Exiti', 'Eus',  RANGED(0.0275),      'pct',    [['critChance', 'zoom'], ['critChance', 'multishot']]),
  // Combined elements
  spliced('blast',               'Blast',                        'Fraga', 'Tus',  ALL5(0.01),          'pct',    [['heat', 'cold']]),
  spliced('corrosive',           'Corrosive',                    'Cori',  'Or',   ALL5(0.01),          'pct',    [['toxin', 'electricity']]),
  spliced('gas',                 'Gas',                          'Cali',  'Fel',  ALL5(0.01),          'pct',    [['toxin', 'heat']]),
  spliced('magnetic',            'Magnetic',                     'Magni', 'Bra',  ALL5(0.01),          'pct',    [['electricity', 'cold']]),
  spliced('radiation',           'Radiation',                    'Radi',  'Lo',   ALL5(0.01),          'pct',    [['heat', 'electricity']]),
  spliced('viral',               'Viral',                        'Cari',  'Sco',  ALL5(0.01),          'pct',    [['toxin', 'cold']]),
  // Faction damage
  spliced('orokin',              'Damage to Orokin',             'Effi',  'Tas',  ALL5(0.005),         'mult',   [['grineer', 'corpus']]),
  spliced('scaldra',             'Damage to Scaldra',            'Exsi',  'Llo',  ALL5(0.005),         'mult',   [['infested', 'grineer']]),
  spliced('techrot',             'Damage to Techrot',            'Muti',  'Gia',  ALL5(0.005),         'mult',   [['corpus', 'infested']]),
];

export const STATS = [...ORDINARY, ...SPLICED];

/** @type {Record<string, Stat>} */
export const STAT_BY_ID = Object.fromEntries(STATS.map(s => [s.id, s]));

/**
 * Stats a weapon class can carry, in table order.
 * @param {WeaponClass} cls
 */
export function statsFor(cls) {
  return STATS.filter(s => s.b[cls] !== undefined);
}
