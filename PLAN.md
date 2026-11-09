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
- [ ] **Enter your own build without a link**: typing one in, with the reference builds as starting points.
- [ ] **Auras as buffs**: Corrosive Projection, Rifle / Pistol / Shotgun Amp, Dead Eye, Worthy Comradery, Swift
      Momentum; Empowered Blades needs status on heavy attacks only.

## 3. Gun model gaps

Doesn't need section 2, and can run alongside it. The checks come first: the rest is judged by them.

- [ ] **A random (Monte Carlo) fight** against the averages in `src/fight.js`, all of them together: smoothed kills,
      `chargedPellets`, `blastPay`, Heat's averaged strip.
- [ ] **Checks against the game**: ~10 guns' builds recorded and read with `tools/read-clip.py`, and Arsenal numbers
      for a few builds. (The Sampotes heavy slam runs against the Murmur showed the room's mix was wrong this way.)
- [ ] **Conditional Incarnon perks** (13g): on headshot, per Electricity proc, Overwhelming Attrition's stacks, and
      perks changing other modes' numbers.
- [ ] **Condition Overload not modelled** (13b): Secondary Shiver, Tenet Detron's 65% on multishot projectiles,
      evolutions raising base damage without raising CO.
- [ ] **Per-unit weak points** (13c): MOA rears, Bursa consoles, Juggernaut maws, averaged away by the faction profile.
- [ ] **Beams**: zones once measured (see the in-game list); Boar's form with the room's mix of units.
- [ ] **Crowds**: the other enemies' armor and statuses, and kill stacks building faster.
- [ ] **Valence** (13f): score per faction and with Overguard; Impact, Magnetic and Radiation often tie.
- [ ] **Look at what the community doesn't list**: Ammo Efficiency and spliced Blast in the model's top 3.
- [ ] **Multishot against full armor**: the most missed pick there (131), while Viral, Corrosive and Blast crowd the top 3.
- [ ] **Show shots per kill** on the page.
- [ ] **"Judged at: A spread"**: decide its default once tried.
- [ ] **Ammo**: Ammo Max, running dry and damage per ammo, so Ammo Efficiency and the like count for more than the
      reload they save. Time with nothing to shoot isn't a weapon's doing: an uptime setting, as Galvanized uptime is.

## 4. Enemies and rooms

Guns and melee both fight these. Doesn't need sections 2 or 3.

- [ ] **Eximus share**: decide the default. It's 5 of 20 (25%); the Murmur runs had 3%, the Zabala (Infested) runs 3%.
- [ ] **Kill counts for the other battlegroups**: the end-of-mission kill list gives each faction's real mix (the
      Murmur's is from three runs). The rest of `src/data/battlegroups.js` is estimated.
- [ ] **The four Murmur missions' gaps**: Corrupt Charge 5 under the recordings, Melee Duplicate 4 over.

## 5. Melee

Builds on the gun fight (15).

- [ ] Slams' timing and radial damage (a slam counts as one swing on the target), heavy slams for
      every class (only unique ones are in the wiki's data), forced Bleed procs on hits, Impact
      multipliers on hits.
- [ ] Glaive throws and gunblade shots.
- [ ] Gladiator set bonus, melee Incarnons, Dark Split-Sword.
- [ ] Melee buffs: Valkyr, and Voruna's (needs combo modelling).
- [ ] Speed: pre-screen the mechanic arcanes' searches and the riven candidates; parallel workers.
- [ ] **Mods the builder leaves out**: it takes class mods only. Thrown Melee (glaives, 11), the weapon-only ones by
      compat (some 100: Amalgam, augments, the Polearms / Whips / Daggers set mods), Pistol and Rifle (No Aoe).
- [ ] Melee Assimilation's +150% Melee Damage on Heavy Attack (on shield break) isn't read.

## 6. Kitguns and zaws

Built from parts, so a weapon's stats are a choice of parts and not one row of data.

- [ ] **Kitguns**: the grip makes one a primary or a secondary, which changes how it works (its mods, its riven class),
      and the other two parts change its stats too. Pax and Residual arcanes.
- [ ] **Zaws**: melee weapons with odd stats: the melee model as it stands, once the parts give their stats. Exodia arcanes.

## 7. Using the model

Needs sections 2 and 3 far enough along to trust the results.

- [ ] **Say what "far enough" is**: which checks must pass and what score against the community, so opening
      Recommended rolls and the precomputed results have a bar to meet.
- [ ] **QoL rules** (12d): ammo economy, beams, charge weapons and harmless curses, each with its reason shown.
- [ ] **Pick marks in the grader and importer** (12e), and how good a riven is for its weapon.
- [ ] **Melee in the advisor** (12e): the sheet's melee rows lean on builds a DPS model may not capture.
- [ ] **Open up Recommended rolls**, gated as under construction.
- [ ] **Precomputed results**: ship the default studies as data (then set `SHIPPED` in `src/studies.js`). Paused until the simulation is decent.
- [ ] **GPU**: not now. Only if the above isn't fast enough.

## 8. Any time

Needs nothing above.

- [ ] **Underframe's data from the wiki or the game instead**, before Recommended rolls opens: what's built from
      it (`src/data/incarnons.js`, `src/data/enemies.js`, the weapons' `co`), each rebuilt from the wiki or
      checked in game, so nothing shipped is theirs. (Reading their links stays: that's interoperability. Short
      links aren't planned.)
- [ ] **Go over the community picks by hand** (the user), towards the site's own picks in place of the sheet's.
- [ ] **Multi-stat goals** (11): several goal rows at once, the chance of all of them per shape, optionally with
      the pool odds for chance per cycle and expected Kuva; reject impossible combos.
- [ ] **Type checking**: a `jsconfig.json` and `npm run check` (`tsc`), then clear what it finds (`heavySlam` missing
      from the melee options, `heavyDouble` from `Effect`, strings compared to numbers in `src/ui/model.js`).
- [ ] **Tests for `src/model-input.js`** (37% covered), and a check that the page loads without errors.
- [ ] **One command to refresh the data**: every builder in order, with a summary of what changed.
- [ ] Put `build-weapons` and `build-picks` on the local cache.
- [ ] Bring the README up to date; retire the closed-form reference model (`dps`, `statEffects`, `bestSets`,
      `tools/score-sim.mjs`) or mark it as kept for tools.
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
- [ ] **Heavy slam crit chance.** 18 of 24 hits crit at 12x with Galvanized Steel, against the model's 54%. A longer
  clip at a fixed counter would show whether heavy slams get more crit chance than the model gives.
- [ ] **Heavy attacks.** The recovery after one (none counted), its follow through, and its forced procs by weapon
  type (none modelled).

Rivens:
- [ ] **Splicing a curse parent.** The wiki says a curse's "true" roll is used. Predict one splice, then compare;
  the page ranks a curse parent by its size, and the odds may change with it.
- [ ] **Slash and Range on Lacera.** Neither came up as a positive in 48 cycles (about a 0.2% chance if draws are
  even). More cycles on it, or another melee riven, would settle whether they're rarer.
