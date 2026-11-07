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
  // Kill counts from three Zabala (Eris) runs (2,623 unit kills; eximus/specter tags, turret and camera left out):
  // Charger 44%, Runner 24%, Leaper 6%, Volatile 5%, Mutalist MOAs 5%, crawlers of all kinds 4%, Osprey 4%, Maggot 4%.
  infested: { name: 'Infested', members: [['Charger', 8.75], ['Runner', 4.75], ['Leaper', 1.25], ['Volatile Runner', 1], ['Mutalist Tar MOA', 0.5], ['Mutalist Swarm MOA', 0.5], ['Mutalist Osprey', 0.75], ['Maggot', 0.75], ['Crawler', 0.75], ['Boiler', 0.25], ['Brood Mother', 0.25], ['Ancient Healer', 0.5]] },
  orokin: { name: 'Orokin', members: [['Corrupted Heavy Gunner', 2], ['Corrupted Bombard', 4], ['Corrupted Lancer', 6], ['Corrupted Butcher', 8]] },
  sentient: { name: 'Sentient', members: [['Conculyst', 6], ['Battalyst', 6], ['Brachiolyst', 5], ['Summulyst', 2], ['Ortholyst', 1]] },
  narmer: { name: 'Narmer', members: [['Narmer Heavy Gunner', 2], ['Narmer Bombard', 2], ['Narmer Lancer', 6], ['Shield Lancer', 6, 'grineer'], ['Scorpion', 4, 'grineer']] },
  scaldra: { name: 'Scaldra', members: [['Scaldra Flayer', 7], ['Scaldra Jaeger', 7], ['Scaldra Barbican', 3], ['Scaldra Eradicator', 2], ['Scaldra Dedicant', 1]] },
  techrot: { name: 'Techrot', members: [['Techrot Galliflex', 8], ['Techrot Skuzzi', 3], ['Techrot Volatile Galliflex', 3], ['Techrot Obsolyte', 4], ['Techrot Matmas', 2]] },
  // Kill counts from three Steel Path Nex runs (1,036 kills): Culverin 36%, Arcocanid 30%, Shuffling 20%, Lumbering 7%.
  murmur: { name: 'Murmur', members: [['Rogue Culverin', 7.25], ['Rogue Arcocanid', 6], ['Shuffling Fragment', 4], ['Lumbering Fragment', 1.5], ['Hollow Vein', 0.75], ['Anatomizer', 0.5]] },
};
