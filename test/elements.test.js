import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineElements, rivenOrder } from '../src/elements.js';

const el = (type, value) => ({ type, value });

test('two base elements combine: Cold + Toxin = Viral', () => {
  assert.deepEqual(combineElements([el('cold', 90), el('toxin', 90)]), { viral: 180 });
});

test('slot order decides the pairs: Toxin, Cold, Electricity, Heat = Viral + Radiation', () => {
  assert.deepEqual(combineElements([el('toxin', 60), el('cold', 60), el('electricity', 90), el('heat', 90)]),
    { viral: 120, radiation: 180 });
  // The same four mods in another order make Corrosive + Blast.
  assert.deepEqual(combineElements([el('toxin', 60), el('electricity', 90), el('cold', 60), el('heat', 90)]),
    { corrosive: 150, blast: 150 });
});

test('a repeated element adds into its first place; a leftover stays base', () => {
  assert.deepEqual(combineElements([el('heat', 90), el('cold', 60), el('heat', 60)]), { blast: 210 });
  assert.deepEqual(combineElements([el('cold', 90), el('toxin', 90), el('heat', 60)]), { viral: 180, heat: 60 });
});

test('a combined element from a mod (spliced riven) stays as it is', () => {
  assert.deepEqual(combineElements([el('viral', 105), el('heat', 90), el('toxin', 90)]), { viral: 105, gas: 180 });
});

test('innate elements come after every mod', () => {
  // Ignis Wraith (innate Heat) + Cold, Toxin, Electricity: Viral from the mods, then Electricity + Heat.
  assert.deepEqual(combineElements([el('cold', 90), el('toxin', 90), el('electricity', 90)], { heat: 35 }),
    { viral: 180, radiation: 125 });
  // An innate element a mod already brought adds into it.
  assert.deepEqual(combineElements([el('heat', 90), el('cold', 90)], { heat: 35 }), { blast: 215 });
  // No elemental mods: the innate element stays.
  assert.deepEqual(combineElements([], { electricity: 62 }), { electricity: 62 });
});

test('a riven with several elements: they go in bottom-up (the wiki and in-game notes)', () => {
  const riven = rivenOrder([el('electricity', 100), el('cold', 100)]);      // listed Electricity, then Cold
  // On its own: Magnetic.
  assert.deepEqual(combineElements(riven), { magnetic: 200 });
  // Heat just before it pairs with the last-listed element: Blast + Electricity, not Radiation + Cold.
  assert.deepEqual(combineElements([el('heat', 90), ...riven]), { blast: 190, electricity: 100 });
  // Heat just after it leaves the Magnetic alone.
  assert.deepEqual(combineElements([...riven, el('heat', 90)]), { magnetic: 200, heat: 90 });
  // With 1 or 3 elements, a mod after the riven pairs with the first one listed.
  const three = rivenOrder([el('toxin', 100), el('cold', 100), el('heat', 100)]);
  assert.deepEqual(combineElements([...three, el('electricity', 90)]), { blast: 200, corrosive: 190 });
  // A Valence element acts like a mod after all the others.
  assert.deepEqual(combineElements(three, { electricity: 50 }), { blast: 200, corrosive: 150 });
});

// The Engineer, "Elemental priority" (youtube.com/watch?v=74LM3QPOkOw), tested in the Simulacrum.
test('non-mod elements go in Heat, Cold, Electricity, Toxin order after the mods (HCET)', () => {
  // Tenet Envoy: innate Cold, Toxin progenitor, a Heat mod, Shock Trooper's Electricity: Heat (mod),
  // then Cold, Electricity, Toxin: Blast + Corrosive.
  assert.deepEqual(combineElements([el('heat', 90)], { toxin: 40, cold: 100, electricity: 30 }),
    { blast: 190, corrosive: 70 });
  // Add an Electricity mod: Heat + Electricity from the mods (Radiation), Cold + Toxin after (Viral);
  // Shock Trooper's Electricity just adds to the Electricity already placed.
  assert.deepEqual(combineElements([el('heat', 90), el('electricity', 90)], { toxin: 40, cold: 100, electricity: 30 }),
    { radiation: 210, viral: 140 });
  // A Toxin weapon with an Electricity mod is Corrosive; an ability's Heat comes before Toxin in
  // HCET, so it takes the Electricity: Radiation + Toxin.
  assert.deepEqual(combineElements([el('electricity', 90)], { toxin: 50 }), { corrosive: 140 });
  assert.deepEqual(combineElements([el('electricity', 90)], { toxin: 50, heat: 40 }), { radiation: 130, toxin: 50 });
});

test('a riven in the order: Vermisplicer (innate Toxin), riven with Heat above Cold', () => {
  const riven = rivenOrder([el('heat', 100), el('cold', 100)]);
  assert.deepEqual(combineElements(riven, { toxin: 50 }), { blast: 200, toxin: 50 });
  // Electricity before the riven takes its bottom element (Cold); Heat goes to the innate Toxin.
  assert.deepEqual(combineElements([el('electricity', 90), ...riven], { toxin: 50 }), { magnetic: 190, gas: 150 });
});

test('combined elements from anywhere stay as they are; Toxic Lash stays apart', () => {
  // Kuva Sobek-style: innate Blast, Magnetic progenitor, Gas from mods, Radiation and Corrosive from
  // abilities: five combined elements at once.
  assert.deepEqual(combineElements([el('heat', 60), el('toxin', 60)], { blast: 50, magnetic: 30, radiation: 40, corrosive: 20 }),
    { blast: 50, magnetic: 30, radiation: 40, corrosive: 20, gas: 120 });
  // A base element never joins or splits an existing combined one.
  assert.deepEqual(combineElements([el('cold', 90)], { corrosive: 30 }), { corrosive: 30, cold: 90 });
  // Toxic Lash: plain Toxin, beside Viral from Cold + Toxin mods.
  assert.deepEqual(combineElements([el('cold', 90), el('toxin', 90)], {}, { toxin: 70 }), { viral: 180, toxin: 70 });
});

test('a mod with an element the weapon already has takes over its place (the user, 2026-11-02)', () => {
  // A Toxin weapon with Electricity and Toxin mods: the mods place Electricity and Toxin
  // (Corrosive), and the weapon's own Toxin adds into that Toxin instead of waiting in HCET.
  // An ability's Heat is then left over: it can't take the Toxin away.
  assert.deepEqual(combineElements([el('electricity', 90), el('toxin', 60)], { toxin: 50, heat: 40 }),
    { corrosive: 200, heat: 40 });
  // Without the Toxin mod, the ability's Heat comes first in HCET and takes the Electricity.
  assert.deepEqual(combineElements([el('electricity', 90)], { toxin: 50, heat: 40 }), { radiation: 130, toxin: 50 });
});
