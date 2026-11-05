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
  infested: { name: 'Infested', members: [['Ancient Healer', 2], ['Charger', 6], ['Crawler', 4], ['Volatile Runner', 4], ['Runner', 4]] },
  orokin: { name: 'Orokin', members: [['Corrupted Heavy Gunner', 2], ['Corrupted Bombard', 4], ['Corrupted Lancer', 6], ['Corrupted Butcher', 8]] },
  sentient: { name: 'Sentient', members: [['Conculyst', 6], ['Battalyst', 6], ['Brachiolyst', 5], ['Summulyst', 2], ['Ortholyst', 1]] },
  narmer: { name: 'Narmer', members: [['Narmer Heavy Gunner', 2], ['Narmer Bombard', 2], ['Narmer Lancer', 6], ['Shield Lancer', 6, 'grineer'], ['Scorpion', 4, 'grineer']] },
  scaldra: { name: 'Scaldra', members: [['Scaldra Flayer', 7], ['Scaldra Jaeger', 7], ['Scaldra Barbican', 3], ['Scaldra Eradicator', 2], ['Scaldra Dedicant', 1]] },
  techrot: { name: 'Techrot', members: [['Techrot Galliflex', 8], ['Techrot Skuzzi', 3], ['Techrot Volatile Galliflex', 3], ['Techrot Obsolyte', 4], ['Techrot Matmas', 2]] },
  murmur: { name: 'Murmur', members: [['Rogue Culverin', 6], ['Rogue Arcocanid', 6], ['Shuffling Fragment', 3], ['Lumbering Fragment', 2], ['Hollow Vein', 1], ['Anatomizer', 2]] },
};
