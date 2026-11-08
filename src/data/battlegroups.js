// @ts-check
// The Simulacrum's premade mixed groups, as the game lists them (the user's screenshots, 2026-11-05):
// 20 enemies each, by src/data/enemies.js's group id. Typed in, not generated: nothing publishes them.
// An entry is [unit, how many], and where the group's units don't have one, the group to take it from
// (Narmer's Shield Lancer and Scorpion: the Grineer's, as its Lancer and Heavy Gunner match theirs).

/** @typedef {[name: string, count: number, from?: string]} Member */

/** @type {Record<string, {name: string, members: Member[]}>} */
export const BATTLEGROUPS = {
  grineer: { name: 'Grineer', members: [['Heavy Gunner', 2], ['Bombard', 2], ['Lancer', 6], ['Butcher', 6], ['Scorpion', 4]] },
  corpus: { name: 'Corpus', members: [['Elite Crewman', 4], ['Crewman', 6], ['MOA', 6], ['Mine Osprey', 4]] },
  // Kill counts from four Zabala (Eris) survival runs (44,611 unit kills, 42,087 from one 3h50m run): Ancients 34%
  // (Toxic 12%, Disruptor 12%, Protector 5%, Healer 5%), Charger 20%, Runner 11%, Osprey 6%, crawlers of all kinds 6%,
  // Mutalist MOAs 6%, Leaper 5%, Volatile Runner 5%, Boiler 4%, Brood Mother 4%. The short runs alone were Charger 44%,
  // Ancients 2%: long runs bring far more Ancients. Left out: Maggots (Boilers spawn them; nothing to kill), turrets,
  // cameras, Acolytes. Eximus (listed by type, not unit: Frozen, Bioelectric, Volatile, Parasitic, Sanguine, Venomous,
  // Surge, Jade Light) were 1,427 kills, 3% of all: the Eximus setting, not a member here.
  infested: { name: 'Infested', members: [['Charger', 4], ['Runner', 2], ['Toxic Ancient', 2.5], ['Ancient Disruptor', 2.5], ['Ancient Protector', 1], ['Ancient Healer', 1], ['Mutalist Tar MOA', 0.5], ['Mutalist Swarm MOA', 0.75], ['Mutalist Osprey', 1.25], ['Crawler', 1], ['Leaper', 1], ['Volatile Runner', 1], ['Boiler', 0.75], ['Brood Mother', 0.75]] },
  orokin: { name: 'Orokin', members: [['Corrupted Heavy Gunner', 2], ['Corrupted Bombard', 4], ['Corrupted Lancer', 6], ['Corrupted Butcher', 8]] },
  sentient: { name: 'Sentient', members: [['Conculyst', 6], ['Battalyst', 6], ['Brachiolyst', 5], ['Summulyst', 2], ['Ortholyst', 1]] },
  narmer: { name: 'Narmer', members: [['Narmer Heavy Gunner', 2], ['Narmer Bombard', 2], ['Narmer Lancer', 6], ['Shield Lancer', 6, 'grineer'], ['Scorpion', 4, 'grineer']] },
  scaldra: { name: 'Scaldra', members: [['Scaldra Flayer', 7], ['Scaldra Jaeger', 7], ['Scaldra Barbican', 3], ['Scaldra Eradicator', 2], ['Scaldra Dedicant', 1]] },
  techrot: { name: 'Techrot', members: [['Techrot Galliflex', 8], ['Techrot Skuzzi', 3], ['Techrot Volatile Galliflex', 3], ['Techrot Obsolyte', 4], ['Techrot Matmas', 2]] },
  // Kill counts from three Steel Path Nex runs (1,036 kills): Culverin 36%, Arcocanid 30%, Shuffling 20%, Lumbering 7%.
  murmur: { name: 'Murmur', members: [['Rogue Culverin', 7.25], ['Rogue Arcocanid', 6], ['Shuffling Fragment', 4], ['Lumbering Fragment', 1.5], ['Hollow Vein', 0.75], ['Anatomizer', 0.5]] },
};
