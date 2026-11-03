# In-game checker: spec

A companion tool (a WFHelper extension, or part of the farm tracker) that turns "check it in game"
from screenshots in a chat into measurements RivenSite can read. The player plays; the tool tells
them what to set up, watches the screen, reads the numbers and writes a record.

## Ground rules

- **Read the screen only.** Screen capture, OCR and `EE.log`, as WFInfo and AlecaFrame do. No reading
  game memory, no injecting, no intercepting traffic, and **no automated input**: the tool never
  presses a key or clicks in the game. Those are what get accounts banned.
- **The site does the maths.** The tool records what it saw (raw numbers, colours, counts) plus the
  setup. RivenSite's tools turn records into conclusions, so a better model can re-read old records.
- **English client, any resolution.** Screen regions are calibrated per resolution and HUD scale,
  once, by the player marking them on a screenshot.

## Shared with the farm tracker

Both tools need the same base, so it's worth building once:

| Piece | Farm tracker | Checker |
|---|---|---|
| Screen capture of a region, on demand or at ~30 fps | reward screens, inventory | arsenal panel, damage numbers, HUD |
| OCR (Tesseract, as RivenSite already uses) with per-region calibration | item names, counts | stat values, damage numbers |
| `EE.log` tail | mission start/end, extraction | Simulacrum entered, loadout changes |
| Local store and JSON export | progress per farm | measurement records |
| Step-by-step overlay ("do this, then this") | what's left to farm | the experiment's steps |

## Check 1: arsenal readouts (static stats)

Confirms mod values at rank, element combination order, riven values and static arcane stats.

1. RivenSite exports a **check request**: weapon, mods in slot order with ranks, arcane, riven stats,
   and the values the model expects the arsenal to show.
2. The player builds it in the arsenal. The tool captures the weapon's stat panel, including the
   expanded damage breakdown (per-type damage), crit chance, crit multiplier, status chance, fire
   rate, multishot, magazine and reload.
3. The tool OCRs the panel and diffs it against the request, allowing for the arsenal's rounding
   (1 decimal for most stats, whole numbers for damage).

What it can't show: conditional bonuses (Galvanized stacks, on-kill buffs) aren't in the arsenal.
That's check 2.

## Check 2: Simulacrum damage per hit (GunCO, weak points, conditionals)

### Setup the tool asks for (and records)

- The Simulacrum, Steel Path off, one enemy type at a known level (name and level recorded).
  Preferably a target with **no shields and no armor** (or armor fully stripped), so a hit's
  number is the damage itself.
- **Show damage numbers** on. No frame abilities, no companion, no arcanes unless one is the subject.
- **Crit chance 0** (or exactly 100%) so every number is the same tier; **status chance 0** for
  hit-only tests, so no DoT numbers get in the way.

### What it has to read

- **Damage numbers** around the reticle: value and **colour** (crit tier: white, yellow, orange,
  red), and **when** each appears. A shot can show several numbers (direct hit, explosion, DoT
  ticks), and the timing and position tell them apart.
- **Shot boundaries**: the ammo counter dropping. One shot, then the numbers in the next ~0.5 s
  belong to it. A charged shot needs the charge to finish first.
- **Buff icons and stack counts** on the HUD (Galvanized stacks, timers), so a record says how many
  stacks were live.
- **Status icons on the target** (the row by its health bar), so a record says how many status
  types CO was counting.
- **Head or body**: the tool can't tell where a shot landed, so the player says which they're doing
  ("next 5 shots: heads"), and the headshot sound or number colour is a cross-check.

### Experiments

**GunCO, adding vs multiplying, per attack.** Four builds on the same weapon and target, a few shots
each:

| Build | Per-hit number |
|---|---|
| no damage mods | H0 |
| Serration (+S) | H_S = H0 (1 + S) |
| Galvanized, k stacks, n status types on the target | H_G |
| Serration + Galvanized, same k and n | H_SG |

With G = per-stack bonus × k × n: **adding** gives H_SG / H0 = 1 + S + c·G; **multiplying** gives
(1 + S)(1 + c·G). The two Galvanized builds pin down both the share c and which rule it follows.
Run it for every attack the weapon has (direct hit and explosion separately: an explosion should
show c = 0).

**Weak points.** The same build, body shots then head shots, crit at 0 then at 100%: gives the
target's weak point multiplier and whether it takes the critical headshot bonus. Then with Primary
Acuity or Deadhead, to check the formula ((head + 1.5·WPD) × (1 + headshot bonuses)).

**Conditionals and DoT (later).** On-kill stacks decaying, first-shot bonuses (Primed Chamber),
Slash, Heat and Toxin tick damage, Viral stacks.

### Things that will bite

- Damage numbers are **rounded** for display, and damage is **quantized** in game (the wiki's
  Zhuge Prime note: 50 shows as 48.4375). Several shots per build and the site fitting a model beat
  trusting one number.
- **Multiple numbers per shot** (pellets, explosions, procs) overlap. Fewer pellets and slow fire
  help; so does capturing the number's position, not only its value.
- **Level scaling**: the enemy's level must stay the same across a run.

## Records

One JSON record per run, appended to a file RivenSite's tools read (and that the user can commit
alongside `tools/data/in-game-checks.json`):

```json
{
  "checked": "2026-11-05",
  "kind": "simulacrum-hits",
  "weapon": "Burston Prime",
  "mode": "Incarnon Form",
  "build": [{ "mod": "Serration", "rank": 10 }, { "mod": "Galvanized Aptitude", "rank": 10, "stacks": 2 }],
  "target": { "name": "Grineer Target", "level": 1, "armor": "stripped", "statusTypes": 3 },
  "aim": "body",
  "shots": [{ "numbers": [{ "value": 1234, "tier": 0, "ms": 40, "x": 812, "y": 455 }] }],
  "screenshots": ["2026-11-05T21-14-03.png"]
}
```

Arsenal checks record the panel's values the same way (`"kind": "arsenal"`, `"stats": {...}`).

## What RivenSite adds for it

- **Check requests**: a "check this in game" export from the model page (the build and the expected
  arsenal values), and a list of the open questions (PLAN.md's "to check" items) as ready-made
  experiments.
- **An importer** (`tools/import-checks.mjs`) that reads records, fits the numbers (the CO share and
  rule per attack, weak point multipliers) and writes the conclusions into
  `tools/data/in-game-checks.json`, which already overrides every other source.

## First experiments to queue

- Burston Prime's incarnon radial attack CO (wiki 24%, Underframe 100%).
- Cernos Prime's own +50% on headshots.
- A weapon with no weak point bonus (Ignis, Arca Plasmor or Catchmoon): Acuity should do nothing.
- Coda Bassocyst's normal attack: multiplying CO, as both sources say (a known-good control).
