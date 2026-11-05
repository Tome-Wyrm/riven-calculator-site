// @ts-check
// Buffs from outside the build, for guns: abilities, augments, passives, arcanes on the frame. Written
// by hand from the wiki's Universal Weapon Bonuses and each ability's page, against Underframe's table
// (where they differ the wiki is used: Grave Spirit 50%, where Underframe has 100%). Conditional ones
// are at their maximum (the user, 2026-11-03). Values are at 100% Ability Strength and Duration, raw.
//
// An effect is [what, value, scaling]: what is a stat of the build's totals, or:
// - 'more': multiplies all damage, DoTs included. Damage multipliers and vulnerabilities on the target
//   both are this, each multiplying the others (the wiki: "multiplicative to each other").
// - an element, after `element:`: added to that element and never combined with another.
// Scaling: 's' with Ability Strength, 'd' with Ability Duration, none: fixed.
// Stats: damage (adds with Serration), anyFaction (adds with Bane mods, twice on DoTs), critFlat and
// critFlatHead (added after the mods, on all hits or heads only), critDamageFlat (added to the
// multiplier), fireRateFlat (not doubled on bows), and the ordinary ones. And:
// - strength: raises Ability Strength for the others, at most the fourth entry (Brightbonnet).
// - extraVoid: an Extra Hit, a share of the whole hit as Void (the wiki's Extra Hit: faction again, and
//   weak points again, says Xata's Whisper's page).
// - sparks: Breach Surge's, in a crowd only (src/crowd.js): on 10% of hits and every kill, the damage dealt
//   x 2, as a 100% crit at 1.5x, homing on another enemy's head (x 3 on most): 0.9 of a hit on average.
//   sparkMore: what multiplies a spark again (the wiki: they're affected by Eclipse and Rift Torrent).
// - prime:<status>: stacks kept on the target by something else, doing no damage themselves (`stacks`
//   as the value: the Primer stacks setting). They count for Galvanized, Viral, Magnetic, Corrosive,
//   Heat's strip and Puncture's crit chance.
// `for`: 'guns' or 'melee', where a buff is only for those; `noArchgun` where it's not for archguns;
// `only`: one buff of those sharing it (one companion at a time).

/** @typedef {[what: string, value: number | 'stacks', scaling?: 's' | 'd' | '', cap?: number]} BuffEffect */
/** @typedef {{id: string, name: string, from: string, group: string, effects: BuffEffect[], for?: 'guns' | 'melee', noArchgun?: boolean, only?: string}} Buff */

/** The groups, in the page's order. */
export const BUFF_GROUPS = ['Ability Strength', 'Damage', 'Faction', 'Multipliers', 'Vulnerability', 'Elements', 'Extra hits', 'Critical', 'Status', 'Speed', 'Companion', 'Primers'];

/** @type {Buff[]} */
export const BUFFS = [
  { id: 'bonnet', name: 'Brightbonnet', from: 'Nokko', group: 'Ability Strength', effects: [['strength', 0.3, 's', 1.5]] },
  { id: 'bonnet-sub', name: 'Brightbonnet (subsumed)', from: 'Helminth', group: 'Ability Strength', effects: [['strength', 0.2, 's', 1]] },

  { id: 'vex', name: 'Vex Armor', from: 'Chroma', group: 'Damage', effects: [['damage', 2.75, 's']] },
  { id: 'ward', name: 'Elemental Ward (Toxin)', from: 'Chroma', group: 'Damage', effects: [['damage', 0.35, 's'], ['reloadSpeed', 0.35, 'd']] },
  { id: 'amp', name: 'Amp', from: 'Octavia', group: 'Damage', effects: [['damage', 2, 's']] },
  { id: 'deathbringer', name: 'Deathbringer', from: 'Jade', group: 'Damage', effects: [['damage', 1, 's']] },
  { id: 'gallery', name: 'Shooting Gallery', from: 'Mesa', group: 'Damage', effects: [['damage', 0.25, 's']] },
  { id: 'metamorphosis', name: 'Metamorphosis', from: 'Equinox', group: 'Damage', effects: [['damage', 0.25, 's']] },
  { id: 'torrent', name: 'Rift Torrent (10 enemies)', from: 'Limbo', group: 'Damage', effects: [['damage', 3, 's'], ['sparkMore', 3, 's']] },

  { id: 'roar', name: 'Roar', from: 'Rhino', group: 'Faction', effects: [['anyFaction', 0.5, 's']] },
  { id: 'roar-sub', name: 'Roar (subsumed)', from: 'Helminth', group: 'Faction', effects: [['anyFaction', 0.3, 's']] },

  { id: 'eclipse', name: 'Eclipse', from: 'Mirage', group: 'Multipliers', effects: [['more', 2, 's'], ['sparkMore', 2, 's']] },
  { id: 'eclipse-sub', name: 'Eclipse (subsumed)', from: 'Helminth', group: 'Multipliers', effects: [['more', 0.3, 's'], ['sparkMore', 0.3, 's']] },
  { id: 'garuda', name: 'Garuda’s passive', from: 'Garuda', group: 'Multipliers', effects: [['more', 1]] },
  { id: 'link', name: 'Parasitic Link', from: 'Nidus', group: 'Multipliers', effects: [['more', 0.25, 's']] },
  { id: 'vauban', name: 'Vauban’s passive', from: 'Vauban', group: 'Multipliers', effects: [['more', 0.25]] },
  { id: 'overdriver', name: 'Overdriver', from: 'Vauban', group: 'Multipliers', effects: [['more', 0.25, 's']] },

  { id: 'prime', name: 'Molecular Prime', from: 'Nova', group: 'Vulnerability', effects: [['more', 1]] },
  { id: 'chakram', name: 'Blazing Chakram', from: 'Nezha', group: 'Vulnerability', effects: [['more', 1, 's']] },
  { id: 'reap', name: 'Reap', from: 'Sevagoth', group: 'Vulnerability', effects: [['more', 0.5, 's']] },
  { id: 'webbed', name: 'Webbed Embrace', from: 'Oraxia', group: 'Vulnerability', effects: [['more', 0.5, 's']] },
  { id: 'demonium', name: 'Demonium', from: 'Uriel', group: 'Vulnerability', effects: [['more', 0.5, 's']] },

  { id: 'nourish', name: 'Nourish', from: 'Grendel', group: 'Elements', effects: [['element:viral', 0.75, 's']] },
  { id: 'nourish-sub', name: 'Nourish (subsumed)', from: 'Helminth', group: 'Elements', effects: [['element:viral', 0.45, 's']] },
  { id: 'plunder', name: 'Plunder', from: 'Hydroid', group: 'Elements', effects: [['element:corrosive', 2, 's']] },
  { id: 'venom', name: 'Venom Dose', from: 'Saryn', group: 'Elements', effects: [['element:corrosive', 1, 's']] },
  { id: 'shock', name: 'Shock Trooper', from: 'Volt', group: 'Elements', effects: [['element:electricity', 1, 's']] },
  { id: 'frenzy', name: 'Fireball Frenzy', from: 'Ember', group: 'Elements', effects: [['element:heat', 1, 's']] },
  { id: 'freeze', name: 'Freeze Force', from: 'Frost', group: 'Elements', effects: [['element:cold', 1, 's']] },

  { id: 'xata', name: 'Xata’s Whisper', from: 'Xaku', group: 'Extra hits', effects: [['extraVoid', 0.26, 's']] },
  { id: 'surge', name: 'Breach Surge', from: 'Wisp', group: 'Extra hits', effects: [['sparks', 0.9, 's']] },

  { id: 'covenant', name: 'Covenant', from: 'Harrow', group: 'Critical', effects: [['critFlat', 0.5], ['critFlatHead', 1.5]] },
  { id: 'haze', name: 'Shadow Haze', from: 'Sevagoth', group: 'Critical', effects: [['critFlat', 0.5, 's']] },
  { id: 'avenger', name: 'Arcane Avenger', from: 'Arcane', group: 'Critical', effects: [['critFlat', 0.45]] },
  { id: 'crepuscular', name: 'Arcane Crepuscular', from: 'Arcane', group: 'Critical', effects: [['critDamageFlat', 3]] },
  { id: 'frost', name: 'Biting Frost', from: 'Frost', group: 'Critical', effects: [['critChance', 2], ['critDamage', 2]] },
  { id: 'lethality', name: 'Tharros Lethality', from: 'Styanax', group: 'Critical', effects: [['critDamage', 1, 's']] },
  { id: 'spirit', name: 'Grave Spirit', from: 'Dagath', group: 'Critical', effects: [['critDamage', 0.5, 's']] },
  { id: 'quiver', name: 'Empowered Quiver', from: 'Ivara', group: 'Critical', effects: [['critDamage', 1, 's']] },
  { id: 'cyte', name: 'Cyte-09’s passive', from: 'Cyte-09', group: 'Critical', effects: [['weakpointCrit', 3]] },
  { id: 'wrathful', name: 'Wrathful Advance', from: 'Kullervo', group: 'Critical', for: 'melee', effects: [['critFlat', 2, 's']] },

  { id: 'gem', name: 'Prismatic Gem', from: 'Citrine', group: 'Status', effects: [['statusChance', 1, 's'], ['statusDuration', 1, 'd']] },
  { id: 'saryn', name: 'Saryn’s passive', from: 'Saryn', group: 'Status', effects: [['statusDuration', 0.25]] },
  { id: 'lavos', name: 'Lavos’s passive', from: 'Lavos', group: 'Status', effects: [['statusDuration', 1, 'd']] },

  { id: 'redline', for: 'guns', name: 'Redline', from: 'Gauss', group: 'Speed', effects: [['fireRate', 0.75], ['reloadSpeed', 0.5]] },
  { id: 'penance', for: 'guns', name: 'Penance', from: 'Harrow', group: 'Speed', effects: [['fireRate', 0.35, 's'], ['reloadSpeed', 0.7, 's']] },
  { id: 'haste', for: 'guns', name: 'Haste Mote', from: 'Wisp', group: 'Speed', effects: [['fireRate', 0.3, 's']] },
  { id: 'speed', for: 'guns', name: 'Speed', from: 'Nova', group: 'Speed', effects: [['reloadSpeed', 0.25, 's']] },
  { id: 'opera', for: 'guns', name: 'Opera', from: 'Octavia', group: 'Speed', effects: [['multishot', 0.3, 's']] },

  { id: 'tenacious', name: 'Tenacious Bond', from: 'Companion mod', group: 'Companion', effects: [['critDamageFlat', 1.2]] },
  { id: 'reinforced', name: 'Reinforced Bond', from: 'Companion mod', group: 'Companion', for: 'guns', noArchgun: true, effects: [['fireRateFlat', 0.6]] },

  // Diriga, as the user runs it: Manifold Bond keeps Arc Coil going, so its statuses stay up, and the
  // statuses are the point, not their damage.
  { id: 'diriga', name: 'Diriga, Arc Coil', from: 'Companion', group: 'Primers', only: 'companion', effects: [['prime:electricity', 'stacks'], ['prime:slash', 'stacks'], ['prime:puncture', 'stacks'], ['prime:impact', 'stacks'], ['prime:heat', 'stacks'], ['prime:radiation', 'stacks'], ['prime:magnetic', 'stacks'], ['prime:viral', 'stacks']] },
  { id: 'panzer', name: 'Panzer Vulpaphyla', from: 'Companion', group: 'Primers', only: 'companion', effects: [['prime:viral', 'stacks']] },
  // (A 500 Heat mote five times a second is nothing beside a gun at these levels: its Heat proc is the point.)
  { id: 'stars', name: 'Jade Stars', from: 'Sirius', group: 'Primers', effects: [['prime:heat', 1]] },
];
