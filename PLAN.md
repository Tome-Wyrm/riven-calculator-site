# Riven Calculator — Plan

Open work only, in rough dependency order: each section needs the ones before it unless it says otherwise.
Background, decisions and everything finished are in [docs/history.md](docs/history.md), under the phase
names given in brackets here.

## 1. In progress

- [ ] **Brozime reference builds** ([table](docs/reference-builds.md), drafted from the clips): check the Strength
      shards it infers, and the defaults that look off (Grendel's Nourish at 408, Equinox at 40).
  - [ ] Jade: find the builds in the video's showcase.
  - [ ] Excalibur: 185 on the panel, 95 from its mods. Possibly an old Arsenal or Simulacrum bug.
- [ ] **New submissions.** Check x332–x346 against their images, then run `tools/ocr-check.html`. The weapon is
      missing on x334, x337 and x343.

## 2. Frames and buffs

Needs the reference builds.

- [ ] **Strength the builds don't show yet** (14): Precision Intensify's +90 for a frame's own 4th ability (needs each
      ability's slot; a subsumed one is done), and Arcane Bellicose rising with Health in play.
- [ ] **Pick a frame** (14c): its abilities, augments and a subsume, with the optimiser building around them.
- [ ] **Primers from the companions' own weapons** (14d), replacing the "Primer stacks" setting.
- [ ] **Buffs still missing**: Demonium's Vythelas rune; Resupply's other elements; the second list of frames (14f).
- [ ] **The hard ones** (14e), each needing research first: Hall of Mirrors, Tornado, Crystallize, Prismatic Gem's
      beams, Molecular Prime's chaining explosions, Divine Retribution, The Lost's Gaze, Null Star, Antimatter Drop.
- [ ] **Ask Underframe's author** whether reading their links is fine, and whether short links could be opened from
      other sites.
- [ ] **Enter your own build without a link**: typing one in, with the reference builds as starting points.

## 3. Gun model gaps

Doesn't need section 2, and can run alongside it.

- [ ] **Conditional Incarnon perks** (13g): on headshot, per Electricity proc, Overwhelming Attrition's stacks, and
      perks changing other modes' numbers.
- [ ] **Condition Overload not modelled** (13b): Secondary Shiver, Tenet Detron's 65% on multishot projectiles,
      evolutions raising base damage without raising CO.
- [ ] **Per-unit weak points** (13c): MOA rears, Bursa consoles, Juggernaut maws, averaged away by the faction profile.
- [ ] **Beams**: zones once measured (see the in-game list); Boar's form with the room's mix of units.
- [ ] **Crowds**: the other enemies' armor and statuses, and kill stacks building faster.
- [ ] **Valence** (13f): score per faction and with Overguard; Impact, Magnetic and Radiation often tie.
- [ ] **Checks**: a random (Monte Carlo) run against the averages; ~10 guns against Underframe by hand; Arsenal
      numbers for a few builds.
- [ ] **Look at what the community doesn't list**: Ammo Efficiency and spliced Blast in the model's top 3.
- [ ] **Multishot against full armor**: the most missed pick there (131), while Viral, Corrosive and Blast crowd the top 3.
- [ ] **Show shots per kill** on the page.
- [ ] **"Judged at: A spread"**: decide its default once tried.

## 4. Melee

Builds on the gun fight (15).

- [ ] Slams, glaive throws and gunblade shots.
- [ ] Gladiator set bonus, melee Incarnons, zaws (by parts), Dark Split-Sword.
- [ ] Melee buffs: Valkyr, and Voruna's (needs combo modelling).
- [ ] Speed: pre-screen the mechanic arcanes' searches and the riven candidates; parallel workers.

## 5. Using the model

Needs sections 2 and 3 far enough along to trust the results.

- [ ] **QoL rules** (12d): ammo economy, beams, charge weapons and harmless curses, each with its reason shown.
- [ ] **Pick marks in the grader and importer** (12e), and how good a riven is for its weapon.
- [ ] **Melee in the advisor** (12e): the sheet's melee rows lean on builds a DPS model may not capture.
- [ ] **Open up Recommended rolls**, gated as under construction.
- [ ] **Precomputed results**: ship the default studies as data. Paused until the simulation is decent.
- [ ] **GPU**: not now. Only if the above isn't fast enough.

## 6. Any time

Needs nothing above.

- [ ] **Multi-stat goals** (11): several goal rows at once, the chance of all of them per shape, optionally with
      the pool odds for chance per cycle and expected Kuva; reject impossible combos.
- [ ] Put `build-weapons` and `build-picks` on the local cache.
- [ ] Webhook relay, if the spam comes back: keeps the webhook out of the page altogether.
- [ ] Consider telling megrims (Discord) the sheet is used here.
- [ ] OCR upgrade (YOLO + PaddleOCR), only if Tesseract struggles on real uploads.

## To test in game (the user)

What the model assumes or takes from the wiki and no in-game test has checked yet, biggest effect first.
Each says what it would change.

Beams:
- [ ] **Boar's form, its other beams.** Does a second or third beam do what the first does, and does each
  need a further target? The model says yes to both, which gives 7x in a crowd of 6 (`src/crowd.js`).
- [ ] **Multishot twice in DoTs.** Does a Heat or Slash tick on a single-beam gun scale with Multishot
  twice, as the wiki says (`procsOf`)? Same gun, with and without a Multishot mod, against a target
  that doesn't die.
- [ ] **Innate beams.** Do Phage's 7 and Convectrix's 2 merge into one tick as Quanta's are said to, and does
  Multishot then count twice on them? The wiki contradicts itself on Quanta and doesn't say for the others.
- [ ] **The ramp on procs.** Do procs from the first ticks start as weak as the hits (`mode.held`)?
- [ ] **Incarnon gauge on beams.** Does a beam's tick charge once, whatever Multishot rolled? Only pellets
  were tested. Atomos or Gammacor in normal fire.
- [ ] **Beam zones.** How far do the zones of Ignis Wraith, Glaxion Vandal, Embolist, Catabolyst and Cortege
  reach, and how much do they do? They aren't in the wiki's attack data, so the model has none.

Crowds:
- [ ] **Area attacks with no radius in the data** (11: Sonicor and Helstrum's explosions, Phantasma's cluster
  bombs, Ferrox's Attraction Field, Neutralizer's Cryo Grenade, Simulor's orb merging, Glory's alt fire,
  Scyotid, Mausolon's charged shot). Their radius and falloff, for the guns you care about.
- [ ] **Punch Through.** 0.6 m a body is from the wiki's Butchers. Does it hold for heavies, and is any
  damage really lost? The 1.5 m path behind the target is an estimate.
- [ ] **A real room against the settings.** How many enemies are usually within 20 m of a target, and how
  tight? Six at 50% clumping (within about 12.5 m) is an estimate.

Damage:
- [ ] **Weak points with Weakpoint Damage.** A head hit with an Acuity mod. The wiki's pages disagree:
  (multiplier + bonus), or (head + 1.5 x bonus) x (1 + headshot bonuses), which `weakPointMult` follows.
- [ ] **Weak point edge cases.** Catchmoon isn't in the wiki's -2 list; does Deadhead still apply on the -2 weapons?
- [ ] **Base damage perks elsewhere.** Soma Prime's Arsenal should show lines 24, Total 36 (needs its adapter).
  Proven on Boar Prime only.
- [ ] **Reified Bane's +14 in form**, not modelled.
- [ ] **Burston's Incarnon radial attack.** Condition Overload at 24% (wiki) or 100% (Underframe). One try wasn't
  conclusive: its falloff moves the numbers as much as the bonus would.

Buffs:
- [ ] **Do buff elements stay apart?** Shock Trooper with a Cold mod should show Cold and Electricity, not
  Magnetic. And does a buff's element sum with a combined element of the same name (Nourish and a Viral build)?
- [ ] **Covenant.** 50% added after the mods, 200% on heads, as the wiki has it.
- [ ] **Breach Surge's sparks with Eclipse.** The damage rule is the wiki's. Does Eclipse multiply a spark again,
  on top of the hit it already raised? A spark's number with and without it.

Melee:
- [ ] **Arcanes and combos.** Melee Duplicate's yellow-crit chance, Doughty's steps, Influence's spread (does a
  spread proc spread again?), Afflictions' added ticks. Blood Rush additive or multiplicative: the wiki's formula
  and its example disagree, and the example is used.
- [ ] **Heavy attacks.** The recovery after one (none counted), its follow through, and its forced procs by weapon
  type (none modelled).

Rivens:
- [ ] **Splicing a curse parent.** The wiki says a curse's "true" roll is used. Predict one splice, then compare;
  the page ranks a curse parent by its size, and the odds may change with it.
- [ ] **Slash and Range on Lacera.** Neither came up as a positive in 48 cycles (about a 0.2% chance if draws are
  even). More cycles on it, or another melee riven, would settle whether they're rarer.
