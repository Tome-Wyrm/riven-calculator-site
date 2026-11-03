# Riven Calculator — Plan

A static web page on **GitHub Pages** that replaces the riven range spreadsheet (one sheet per
shape) with selectors, and adds a goal calculator ("can I get X, and how likely?").

## Core insight (verified)

Every number in the spreadsheet comes from one formula (wiki, post-disposition-removal):

```
v = b × 10 × (rank + 1) × 1.2 × L × W        W = 0.9 + 0.2u,  u ∈ [0, 1]
```

- `b` = per-stat, per-weapon-class coefficient (32 ordinary + 18 spliced stats)
- `L` = shape multiplier: `++` 0.99 · `++-` 1.2375 / −0.495 · `+++` 0.75 · `+++-` 0.9375 / −0.75
- Computed step by step in 32-bit float (`Math.fround`), then display-rounded
- Display: `100v %` normally; `−100v %` for Ammo Efficiency and Chance to Gain Combo Count;
  `×(1+v)` for faction; raw `v` for seconds (Combo Duration), metres (Range, Punch Through)
  and flat (Initial Combo)

Checked against the screenshots: Rifle Ammo Max `++-` → 66.76–81.59 / −26.70 to −32.64,
faction `++-` → 1.60x–1.74x, Combo Duration `+++-` → 8.20–10.02s / −6.56 to −8.02s. All exact.

**Consequence:** no spreadsheet data needs transcribing. We need the coefficient table + the
math engine; the range table and the calculator are both just views over that.

## Architecture: static, no build, no dependencies

- Plain HTML + CSS + vanilla JS **ES modules**, with JSDoc `// @ts-check` for editor type hints.
  No framework, no bundler and no `npm install`; the UI is two forms and two tables.
- GitHub Pages serves the repo as-is ("Deploy from branch", `main` / root). **What's committed is
  what's live.** No build step and no Actions workflow needed.
- The same modules are imported by the browser and by tests (`node --test`), so the engine
  is tested exactly as shipped.
- All data (stat coefficients, weapon list) is committed as JS modules, with **no runtime fetches**.
- Local dev: ES modules don't load from `file://`, so serve the folder with something like
  `python -m http.server` and open `localhost:8000`.

```
index.html            page shell
style.css
src/
  data/stats.js       coefficient table + shape multipliers
  data/weapons.js     generated snapshot: weapon name → class
  engine.js           pure math (no DOM)
  ui/ranges.js        range viewer
  ui/calculator.js    goal calculator
  ui/state.js         URL-hash state
test/                 node --test files (golden values from the screenshots)
tools/                one-off scripts, e.g. regenerate weapons.js
```

## Calculator examples (acceptance criteria, rank 8)

| Goal | `++` | `++-` | `+++` | `+++-` | Answer |
|---|---|---|---|---|---|
| Felarx (Shotgun) **≥ 70% Ammo Efficiency** | 48.11–58.81 ✗ | 60.14–73.51 ✓ needs u ≥ 0.738 (~26%) | 36.45–44.55 ✗ | 45.56–55.69 ✗ | Only `++-`, top ~26% of rolls |
| Melee **< 180% Heavy Attack Wind Up** | 127.98–156.42 ✓ always | 159.98–195.53 ✓ u < 0.563 (~56%) | 96.96–118.50 ✓ always | 121.20–148.13 ✓ always | 3 shapes always, `++-` sometimes |
| Melee **≈ 105% Parry Angle** | 86.61–105.85 ✓ exact at u ≈ 0.956 | min 108.26 (Δ 3.26) | max 80.19 | max 100.24 (Δ 4.76) | `++`, high roll |

("~%" assumes u is uniform and the stat was rolled normally; see the open questions on splicing.)

---

## Tasks

### Phase 0 — Project setup
- [x] `git init`
- [x] Skeleton: `index.html`, `style.css`, `src/`, `test/`, `.gitignore`, short `README.md`
- [ ] Create the GitHub repo, push, and enable Pages (`main` / root). Do this early so every
      later phase is visible live.

### Phase 1 — Stat data (`src/data/stats.js`)
- [x] Define the stat schema: `id`, display name, prefix/suffix, `b` per class
      (rifle/shotgun/pistol/archgun/melee, missing = not rollable), `unit`
      (`pct` | `pctNeg` | `mult` | `sec` | `m` | `flat`), `polarity`
      (`both` | `posOnly` | `negOnly`), `spliced: boolean`, splice recipe(s)
- [x] Enter the 32 ordinary + 18 spliced coefficients from the wiki tables
- [x] Shape table (`L` bonus/malus) as data, not code
- [x] Reconcile the discrepancies between the wiki and the spreadsheet (see **Data decisions** below)
- [x] Transcription test: every positive `++-` cell of the spreadsheet is reproduced from the coefficients
- [x] Confirm melee Attack Speed can roll negative (decision 3)

#### Data decisions

Sources weighed: the wiki's coefficient tables and footnotes; your spreadsheet; the
[warframe.market riven attribute list](https://api.warframe.market/v2/riven/attributes), which is
current (it already lists the 44.1 splice stats) and flags `positiveOnly` / `negativeOnly` per stat;
and the [wiki patch history](https://wiki.warframe.com/w/Riven_Mods/Patch_History).

1. **Damage / Melee Damage can roll negative.** The wiki's "positive only" footnote looks wrong:
   warframe.market doesn't flag it as positive-only, the patch notes repeatedly fix bugs with
   "negative Damage Rivens" (19.5.4, 25.0.4, 32.3), and your sheet shows the negatives.
2. **Initial Combo is positive only.** The wiki's coefficient table, warframe.market and your sheet all agree.
3. **Melee Attack Speed can roll negative (confirmed).** Your sheet leaves it blank, but
   warframe.market has Lacera rivens listed with −6.2%, −6.1% and −4.1% Attack Speed (unranked).
   Those values sit outside today's ranges, so they were probably rolled under the old dispositions,
   but they prove a melee Attack Speed curse existed. Caveat: that evidence may predate splicing
   (Update 44.1), which could have changed the curse pool. Keep it unless a large sample of
   post-44.1 melee cycles shows it never appears.
4. **The combo row is split in two.** "Additional Combo Count Chance" (positive only, b 0.00653) and
   "Chance to Gain Combo Count" (negative only, b −0.01165, shown as −100v) are separate stats.
   warframe.market confirms this. The sheet's merged row is just a layout choice.
5. **Spliced stats are positive only.** The wiki's splicing rules say a spliced trait is always a
   buff. warframe.market just doesn't flag them, since they can't be cycled into anyway.
6. **Impact / Puncture / Slash have different coefficients** (0.013333 vs 0.01333 on guns; melee
   puncture 0.0133). The sheet's merged row matches Impact and Slash, while Puncture comes out
   about 0.04 lower. Each stat keeps its own wiki value.
7. **Elements and Punch Through are positive only** (all sources agree). **Weapon Recoil** has a
   negative coefficient, so a buff shows as a negative %.

### Phase 2 — Math engine (`src/engine.js`, pure functions, no DOM)
- [x] `rawValue` / `displayValue` (fround, step by step), `range`, `format` (game-style, 1 decimal),
      `solveU`, `canRoll`, `probability`, `fingerprintToU`
- [x] `evaluateGoal(goal)` for `gte` / `lte` / `near`: per shape, possible?, feasible?, range,
      u-interval, probability, closest value; best shape marked. The sign is inferred from which
      side of zero the target is on (so recoil buffs, which display negative, work).
- [x] **Golden tests:** 25 range rows from both sheets (both ends, buffs and curses, every unit),
      9 in-game screenshot values (exact text match), the three goal examples
- Spliced stats use max-of-two odds (P = b² − a²). This is the working assumption from the wiki's
  "inherits the higher value" rule, and it isn't verified in game.

### Phase 3 — Range viewer (spreadsheet replacement)
- [x] Controls: weapon class, shape (`++`, `++-`, `+++`, `+++-`), rank (0–8, default 8)
- [x] Table: stat | positive range | negative range; hide stats the class can't roll
- [x] Separate sections for ordinary / faction / spliced stats (matching the sheet's layout)
- [x] "Compare shapes" mode: one stat × all 4 shapes side by side

### Phase 4 — Goal calculator (the new feature)
- [x] Inputs: class (weapon lookup comes in Phase 5), stat, comparator (`at least` / `at most` / `closest to`), target value, rank
- [x] Output: per-shape table (range, meets goal, roll needed, chance), best shape starred
- [x] One-line summary, a note for spliced odds, and a note when the target reads as a curse
- [x] Unit shown next to the target box; the sign is inferred by the engine

### Phase 5 — Weapon lookup (Felarx → Shotgun)
- [x] Weapon search box on both views (native datalist; picking a weapon sets the class)
- [x] Bow note on Fire Rate goals. Kitguns → Pistol, zaw strikes → Melee, Vinquibus (melee) added by hand
- [x] `DaxDuviriAsymmetricalLongBowPlayerWeapon` is the **Cinta** (already listed as a rifle/bow)
- [x] Robotic weapons (25 including Prime/Prisma variants) with their associated class
- [x] Corrections: Corufell Prime added (melee, missing from WFCD); Sirocco (an amp) and Arquebex
      (an exalted weapon) excluded, since neither takes rivens
- Single and dual pistols use the same riven class (Pistol) but are separate families (Furis vs Afuris)
- CSV `family` column = which riven a weapon takes (Braton Prime → Braton, Dex Furis → Afuris).
  It came from your hand-made family lists; weapons not in them (archguns, zaws) default to
  their own name, with a few archgun variants mapped by hand.
- `tools/data/internal_names.csv` (`path,name,family`): internal path → name for every riven weapon in
  the WFCD list (601 rows). Gaps were filled from WFCD `uniqueName`, and the Vinquibus paths came
  from your player data. Kitgun `compat` points at the chamber part, and primary and secondary
  share one path. All six chambers are mapped. The future player-JSON import uses this to name `compat`.
- [x] A one-off script in `tools/` (run by hand) pulls the weapon list from WFCD
      `warframe-items` or the Public Export and writes a compact `src/data/weapons.js`
      (`{name: class}`). That snapshot is committed, so there is **no runtime fetch**.
      Re-run it when new weapons release.
- [x] Map weapon → riven class, including special cases: Kitguns → Pistol coefficients,
      Sentinel/Robotic weapons → associated class, Zaws → Melee, archgun variants

### Phase 6 — Polish
- [x] Shareable state in the URL hash, one prefix per view (`#r.cls=melee&g.weapon=Felarx&g.op=gte&g.t=70`),
      validated on load, plus a "Copy link" button on each panel
- [x] Responsive layout (checked at 375px, no sideways scroll); light/dark following `prefers-color-scheme`
- [x] Footer: data source + "last updated" for the weapon snapshot

### Phase 7 — Weapon-specific rules (next)
- [x] **Display quirks** via `quirks()` in the engine: an extra "Heavy attacks" line for melee Critical
      Chance and an "On bows" line for Fire Rate on bows, in the range table and as a calculator note
  - [x] Confirmed: a bow riven shows the **undoubled** number with a "(x2 for Bows)" label. A Cinta
        `+++` riven shows +49.7% Fire Rate, inside the normal rifle range of 48.6–59.4%, so the
        effect is doubled but the text isn't. The range table already works this way.
- [x] **IPS eligibility**: a 4th weapon field, one letter each for Impact/Puncture/Slash (`y` can roll,
      `n` can't, `?` may not roll). Picking a weapon hides `n` stats and marks `?` ones; class-only
      views show everything.
  - **Sources, most trusted first** (`tools/build-weapons.mjs`):
    1. Rivens seen in game (screenshots, player data): `IPS_OVERRIDES`, per family. Currently Obex
       Impact; Cinta, Vinquibus, Vinquibus (melee) and Exergis Puncture.
    2. The wiki's >25% rule on the weapon's **first attack**: a yes is a yes. Scored against the first
       102 scanned families it beat the whole-weapon and physical-share variants (259 agreements vs
       251 / 235 / 229), but it said "can't" for 39 stats that are listed, so a no is only `?`
       unless the listings agree.
    3. warframe.market listings (`tools/wfm-ips-scan.mjs` → `tools/data/wfm-ips.json`), lowest:
       nothing in game verifies them. They only turn the rule's no into `n` (none in a full
       filtered search of a family with ≥ 20 listings), or decide alone without damage data.
       The scan must go slowly (1 request / 2.5 s still trips the rate limit now and then).
  - **Reports:** when the grader finds an impossible value, or an IPS stat the data rules out, it
    offers a pre-filled GitHub issue (`.github/ISSUE_TEMPLATE/riven-report.yml`) asking for a
    screenshot. Confirmed reports become `IPS_OVERRIDES` entries.
- [x] Tests: `quirks`, `weaponCanRoll`; IPS stats our own rivens proved are never ruled out
- [ ] Re-run `tools/build-weapons.mjs` when the full scan finishes (102 of ~420 families so far)
- [x] **Families checked against warframe.market's 420 riven weapons** (names + internal paths):
      Mutalist Quanta is its own family (not Quanta, as the wiki also says); zaw rows renamed to
      "X (Zaw)" to match the weapon list; warframe.market's alternate Plague Keewar/Kripath paths
      added. Only naming differences remain: our "(Kitgun)" labels, and warframe.market's own path
      for Vinquibus (Melee) (ours comes from a real riven's data).

### Phase 8 — Riven grader
Back-solve the roll quality u for each stat on a riven you already own.
- [x] **Manual entry:** weapon, then up to 4 stat rows (stat + displayed value). The sign of each value
      sets positive/negative (recoil handled), and the shape follows from the counts. Rank picker, default 8.
- [x] Output per stat: range for that shape/rank, the roll on the community ±10% scale (the negative
      scored by mildness, 1 − u), shown as an interval when rounding leaves doubt, and a letter grade.
      Grade thresholds come from RivenParser.js via WFHelper (`services/rivenGrading.ts`): S ≥ 9.5,
      A+ ≥ 7.5, A ≥ 5.5, A- ≥ 3.5, B+ ≥ 1.5, B ≥ −1.5, B- ≥ −3.5, C+ ≥ −5.5, C ≥ −7.5, C- ≥ −9.5, else F
      (no D grade). Note RivenLens grades negatives the other way (higher = stronger penalty).
      `gradeRoll` / `shapeFor` in the engine; tests check all 18 in-game values' true u lands in the interval.
- [x] Flags: impossible values (typo or wrong rank), invalid stat counts, duplicate stats, a sign the shape can't have
- [x] Shareable state in the URL hash (prefix `v.`)
- [x] **Inventory import** (`src/import.js`, `src/ui/importer.js`), modelled on WFHelper: a file (game
      inventory JSON / WFHelper export, envelopes unwrapped; or AlecaFrame's `lastData.dat`, decrypted
      in the browser with AES-128-CBC and AlecaFrame's fixed key) or pasted JSON (whole inventory or
      just `Upgrades` entries). Every unveiled riven is graded from its exact rolls, best first, with
      its pending cycle if any and an "Open in grader" button.
  - Tag → stat map from WFHelper's `rivenStatDisplayNames.ts`; `compat` path → weapon via
    `src/data/paths.js` (generated by `tools/build-paths.mjs` from the CSV)
  - Checked on a real AlecaFrame cache: 19 rivens, every weapon and tag recognised
  - [ ] **TODO (blocked: needs a spliced riven, from The Icebind):** find how spliced traits appear in
        a fingerprint (their tag names, and whether they sit in `buffs` or somewhere else), then add
        them to `TAG_TO_STAT` in `src/import.js` and add a test. Until then they show as unrecognised.
- [x] **OCR from screenshots** (`src/ocr-parse.js`, `src/ui/ocr.js`): drop, paste (Ctrl+V) or choose
      an image; the result fills the grader, which acts as the editable check.
  - Tesseract.js 5.1.1 from jsDelivr, loaded only on first use (the image itself stays in the browser).
    Sparse-text mode (PSM 11).
  - Preprocess: upscale (up to 4x, ~2400px wide) and invert to greyscale. A hard black/white threshold
    was tried first and lost the decimal points.
  - Parser: values with up to 3 junk characters before them; fuzzy stat-name matching (edit
    distance ≤ 25%), also trying without a glued-on icon; wrapped names; MR line merged or not.
  - Weapon: longest weapon name at the start of a header line, also without stray short tokens.
    No weapon → class guessed from which class can roll every stat read.
  - Rank: the drain number (10 + rank) if read and consistent; otherwise from the values (the
    ranks at which every value is possible, preferring 8, then 0).
  - Companion app quirk: faction stats show as "+0". The row is kept blank, and both the grader and
    the rank logic try it as positive and as negative (`fittingShapes`). On the example it's the negative.
  - Real-image check on 21 screenshots (in-game cards, the mod screen, the cycle screen with two
    cards, phone photos of a monitor, the companion app): all values and ranks read; one weapon
    name missed (split across lines), and two values left blank where OCR lost the sign.
    Fixes along the way: O-for-0 and stray spaces in numbers, up to 5 junk characters before a
    value, unsigned lines kept as their own stat with a blank value.
  - They also caught an IPS data error: an Exergis riven with Puncture, which our data says it
    can't roll. The grader now keeps such a stat (marked "not expected") instead of swapping it. The images live in `test/fixtures/local/`
    (git-ignored); the parser tests use their transcribed text.
  - [x] **Second pass using what must be there** (`src/ocr-refine.js`):
    - The riven's name encodes its positives (1–2 prefixes + the last positive's suffix:
      "Toxi-vexi·pha" = Toxin, Electricity, Heat). It confirms which stats are positive, restores
      lost signs (the stat not in the name is the negative) and fills in one garbled stat name.
    - Range check: the rank is the one where the most values fit as read. Impossible values are
      corrected (look-alike digit, stray leading digits, lost decimal point) only when exactly
      one fewest-change reading fits; otherwise kept as read, with the candidates listed. Values
      nothing fixes are flagged as out of range (seen on an Akarius riven from before the
      disposition change).
    - Result on the 21 screenshots: every stat and value correct; still missing are one weapon name
      (split across lines) and the companion app's "+0" faction values.
  - [ ] Possible upgrade: WFHelper uses a YOLO text detector + PaddleOCR recogniser (ONNX), with a
        stat-band crop and retries. Much heavier (tens of MB of models), but more robust on full
        screenshots. Worth it only if Tesseract struggles on real-world uploads.
  - [x] Drain = 10 + rank confirmed at a middle rank: a Phantasma riven at rank 6 (from its values)
        shows a green 8, i.e. 16 halved because the riven's polarity matches the slot. Halved drains
        (green, 5–9) aren't parsed as a rank; the values decide.
  - Two more fixes from Phantasma screenshots (one with the cursor over the name):
    - A partly hidden name can decode to too few positives ("P?ci-toxican" → "toxican" = 2): a
      decode is only trusted if it fits the stat count (4 stats → 3 positives).
    - With no weapon name, the class is the one where the values fit (+99.4% Multishot fits a
      shotgun riven, not a rifle one), not just the first that can roll the stats.
  - [x] Splice screen seen (Felarx Insi-visidex, and a Mausolon one): the two parents are marked
        red, the preview shows the spliced stat's value and "???" for the random replacement, and
        the other stats keep their exact values (Puncture +70.3%, -44.5% Critical Chance) — so the
        planner's "survivors keep their values" assumption holds. That Felarx riven's values are all
        about 0.5x today's rank-8 ranges (an old riven, like the Akarius one), and the spliced
        Status Damage (+52.5%) came in at the same scale. The Mausolon splice (Critical Chance +
        -Zoom → Weak Point Critical Chance +291.7%) fits today's ranges.
  - [x] Splice locks (2026-10-25, from in-game use): the spliced stat stays locked in a slot of its
        own, and cycling with only it locked is the normal price (3,500). One other stat (blessing
        or curse) can be locked beside it, never two ordinary ones; any ordinary lock makes it the
        locked price (7,000), with or without the splice. Locking any curse holds the shape (more
        positive slots for a positive-only stat). Splicers are scarce (about three a week), so the
        planner only splices when the target has a spliced stat.
  - [x] "Keeps the better parent roll" confirmed (2026-10-25, a Hirudo +++- splice screen): Status
        Chance +110.3% (u 0.944–0.949) + Melee Damage +202.2% (u 0.955–0.958) → Status Damage +110.5%
        (u 0.954–0.959), i.e. Melee Damage's roll. The game also writes weapon names in title case on
        rivens ("Efv-5 Jupiter"); weapon matching ignores case.
  - [x] First cycle log (2026-10-23): one Lacera riven, 48 unlocked cycles (screenshots x77–x124).
        - Shapes: ++ 13, ++- 12, +++ 13, +++- 10 (12 each expected; chi² 0.5, df 3): fits 25% each.
        - Rolls: all 141 values fit today's rank-8 ranges. Spread by fifths 27/20/35/21/38, mean
          0.54 (0.50 expected, 1.6 standard errors high; chi² 9.3, df 4, p ≈ 0.05): even rolls,
          perhaps a slight lean high; needs more data.
        - Stats: 119 positive draws over a 21-stat pool; chi² 26.9, df 20 (p ≈ 0.14), so roughly even,
          but Slash and Range never came up as positives (5.7 each expected; even draws would leave
          both at zero about 0.2% of the time). A lead to check: maybe they're excluded or rarer on
          Lacera. More cycles on this riven, or another melee riven, would settle it.

### Phase 9 — Splice planner
Answer "which traits do I splice, and how good must they be, to get spliced stat X ≥ target?"
- [ ] For each recipe (`from` pairs in `stats.js`): the u needed on the spliced trait, converted back to
      the displayed value each parent would need (the spliced trait keeps the *higher* parent roll,
      so either parent reaching it is enough)
- [ ] Shape is locked by splicing, so show results per shape and note that the riven keeps its layout
- [ ] Negative parents: the wiki says the "true" u of a curse is used. Confirm the direction in game with
      one splice (predict first, then compare, as we did for curses).
- [ ] Odds of a target spliced value from fresh parents (max-of-two), reusing `probability(…, spliced)`

### Phase 10 — Build planner (replaced the cycle planner)
Pick the riven you want (up to 3 positives, an optional spliced stat, a negative, a shape) and get
the cheapest route: what to cycle for, what to lock in each situation, when to splice, and the Kuva
it's likely to cost. `src/planner.js` (engine), `src/ui/planner.js` (panel, URL prefix `p.`),
`src/cycle.js` (pools and cycle costs).
- [x] Model: a state is the stage (before/after the splice), which wanted traits the riven has, the
      wanted negative, and the shape. Actions: cycle unlocked, or lock one wanted trait (keeps it and
      the shape, double cost). Both splice parents on the target shape → splice (free): parents
      consumed, a random positive replaces them, the spliced trait stays, the shape is frozen.
- [x] Exact transition probabilities by counting (hypergeometric), policy iteration for the
      cheapest action everywhere, expected Kuva and cycles exactly, 50% / 90% by stepping the
      distribution forward. Tries each splice recipe and reports the alternatives.
- [x] "Start from the riven I have": its stage, shape and which wanted traits it has → "your next move"
- [x] Pools per class and weapon (`n` IPS stats excluded, `?` kept); match the wiki's counts
      (24 rifle positives, 19 possible negatives)
- [x] Checked on the Felarx Viral + Cold + Toxin + −Crit Chance example: lock an element before
      splicing, lock −CC after; ~1.95M Kuva on average from a fresh riven, 1,771,000 (exactly
      253 cycles) from a spliced riven that already has −CC
- **Assumptions, not verified:** the community odds model (each shape 25% unlocked, stats drawn
  evenly without repeats), the wiki's splice rules, and a flat 3,500 / 7,000 per cycle (exact once
  a riven is past its 10th cycle). Revisit if real data turns up.
- [ ] Combine with roll quality (Phase 11): "and Cold ≥ 100%"
- [ ] "Plan from this riven" button in the grader / importer (fill the start state automatically)

### Phase 11 — Multi-stat goals
- [ ] Several goal rows (stat + op + target) at once, e.g. ≥X Crit Chance **and** ≥Y Crit Damage
- [ ] Per shape: P(all rolls meet their targets) = product of each stat's roll odds (rolls are independent)
- [ ] Optionally × the stat-pool odds from Phase 10, giving "chance per cycle" and expected Kuva
- [ ] Reject impossible combos (same stat twice, more stats than the shape has slots, spliced +
      its own parents)

### Phase 12 — Riven advisor ("which stats should I want on this weapon?")
Asked on Discord: "a site where you can see what people recommend for riven stats / which spliced
stat to go for". Two answers side by side, so each checks the other: what the community recommends,
and what a damage model says each stat is worth on that weapon. The grader then rates the stat
*picks* on a riven, not just the rolls.

**12a — Community picks (first; answers the question as asked)** — done
- Source: the Rolls & Resources sheet's main tab (gid 0, same sheet as the IPS/Vintage tabs): 419
  families, each with one or more rows "ordered by usability": positive slots 1–3, negatives, notes.
  Abbreviations are defined at the top of the tab (MS, CD, COR, EFF = Ammo Efficiency, WPC, SDMG…).
- [x] `tools/build-picks.mjs` fetches the tab's CSV and writes `src/data/picks.js`: the cells as
      written, by family, plus weapon → family where the names differ. 630 of 631 weapons matched
      (Dex Nikana isn't in the sheet). "[Vinquibus] (Melee)" is our "Vinquibus (melee)".
- [x] `src/picks.js` reads the shorthand at runtime: `>` priority, `/` equal (not inside brackets:
      "ANY (not AS/CCC)"), codes run together ("IMP Z"), `ANY` / `NONE`, notes in brackets (`infl`,
      `inc`, `0%`, and variants: "IMP(Vandal)" is for the Vandal only), `*` footnote marks. EFF is
      Ammo Efficiency on guns, Heavy Attack Efficiency on melee. Every code in the sheet is known (tested).
- [x] "Recommended rolls" section (URL prefix `a.`): each row's slots as chips, best first; the top
      roll is pre-chosen (rollable on the weapon, one spliced stat at most); click to choose
      another; "Plan this roll" fills the build planner's target. Spliced picks are dashed, with their
      recipes on hover; picks the weapon can't roll are struck through. Credits the sheet's authors.
- [x] Grader: a "Community" column (Top pick / Listed / Splices into Viral / Not listed; Top curse
      for the negative), also on the "Splices into" rows. Planner and grader link to the weapon's picks.
- [ ] Consider telling megrims (Discord) the sheet is used here.

**12b — Weapon stats** (the model's input) — done
- [x] `tools/build-weapon-stats.mjs` reads the wiki's `Module:Weapons/data/{primary,secondary,archwing,companion}`
      (`?action=raw`, a small Lua table parser) into `src/data/weapon-stats.js` (~150 KB, loaded
      with a dynamic import only when the model shows). 383 guns. Per gun: magazine, reload, max
      ammo, trigger, a few tags (BEAM, AOE…), and fire modes: a top-level attack plus the attacks
      hanging off it (`AttackParentIndex`: a projectile's explosion), each part with damage by type,
      crit, status, multishot, forced procs. Incarnon forms are modes of their own.
  - Charge weapons listing an unlimited fire rate (Lanka) get 1 / charge time. "Vinquibus (Primary)"
    is our Vinquibus. Kitgun chambers have no stats of their own (grip and loader decide): left out.
  - Melee isn't included (the model covers guns only).
- **Underframe** (underframe.site; the user's "overframe" was this) has a build simulator: use it to
  cross-check numbers by hand. Looked at 2026-11-02: it all runs in the browser, but the damage engine
  is compiled WebAssembly (`/static/dps_calculator.wasm`, Emscripten), so it can't be read as source;
  `script.js` (2.2 MB, readable) is the UI and the optimiser's plumbing. Its data is one JSON
  (`/api/data`, 5.3 MB): 1,376 mods with the game's upgrade types and per-rank values, 139 arcanes,
  conditionals (Galvanized stacks…), 62 frame abilities as weapon buffs (Roar, Nourish, Eclipse,
  Xata's Whisper…), 35 companions, 736 enemy presets (armor, shields, health resistance), incarnons.
  **No license anywhere: all rights reserved.** Learning mechanics from it is fine; copying its code or
  shipping its curated data isn't, without the author's permission (their Discord is on the site).
  It already does riven work too: "Auto Riven" and "Get Rolls Data" (a rolls scan with protected
  mods, forced stats, small build tweaks and the elemental combo kept), on a time-stepped simulation
  (sim time, samples, a combat log, "luck averaged").

**12c — Damage model** (`src/sim.js`, pure, no DOM) — done
- [x] Per part: (1 + Damage) × (physical × (1 + IPS) + innate elements + base × elements) × faction ×
      average crit 1 + CC·(CD − 1) × multishot × fire rate; DoT from Slash (35%/tick), Heat, Toxin,
      Electricity, Gas (50%) × 7 ticks × (1 + Status Duration) × (1 + Status Damage), weighted by each
      type's share of the hit, faction twice; sustained over magazine + reload (Ammo Efficiency
      stretches the magazine; one-arrow magazines and Incarnon modes ignore the magazine stats).
- [x] **Viral stacks**: the build's elements are Viral; procs/s × 6 s × (1 + Status Duration), capped at
      10, +100% then +25% each. This was the big step: before it, Viral and Status Chance counted for
      nothing and the model agreed far less with the community (below).
- [x] Weak points (share of hits, default a quarter; heads or any other weak point): the ×2 weak point
      multiplier, which **Weakpoint Damage multiplies** (×2 × (1 + WPD)); **Weakpoint Critical Chance is
      Crit Chance's bucket**, on weak point hits only, so never better than the same Crit Chance
      (confirmed by the user, 2026-11-02; Narin changed how weak points work since the Banshee rework).
  - As a multiplier, a median spliced WPD (+264%) roughly doubles DPS at a quarter of hits on weak
    points: it tops 234 of 235 gun families, and agreement with the sheet falls with the share
    (slot 1 in top 3: 78% at 0, 73% at 0.1, 69% at 0.25, 61% at 0.5). The sheet lists WPD once and may
    predate splicing. The scenarios in Phase 13 should decide the share, not one global default.
- [x] Optional armor (Steel Path 2700): Corrosive stacks (26% then 6% each, 80% at 10) and a burning
      Heat proc (halves it) strip it; damage reduction 0.9·√(armor / 2700); Slash bleeds ignore it.
- [x] Reference build per class, with a +360% Merciless/Deadhead arcane in the Damage total (without it
      a riven's Damage topped every gun, against the community's view). Rifle: +525% Damage, +150%
      Multishot, +150% CC, +180% CD, +180% Viral. Shotgun and pistol likewise; archgun without arcane.
- [x] Output (Recommended rolls, under the community picks; URL fields shape, mode, enemy, wp, armor,
      burst): the best positive sets (brute force, at most one spliced; each with "Plan"), each
      positive alone with a bar and the community's view, stats with no effect on damage, and curses
      from harmless to costly. Spliced stats at their median of the better of two rolls (u = √½).
- [x] **Score against the community** (`tools/score-sim.mjs`, 235 gun families, `+++-`, median rolls):

      | Model | Slot 1 first choice in the model's top 3 | All first choices in its top 6 |
      |---|---|---|
      | Arcane build, Viral as plain damage | 56% | 40% |
      | + Viral stacks (current default) | **78%** | **57%** |
      | + armor 1000 | 66% | 58% |
      | + Steel Path armor (2700) | 43% | 57% |

      With armor, Heat leads (a Heat proc halves it), which the community doesn't pick: armor stays
      optional and off by default.
      Still missed most: **Corrosive** (113: it's for armor, which the default strips) and **Critical
      Damage** (94: the sheet lists MS / CD / CC on low-crit guns like Afuris at 5%, "for sale value
      regardless of weapon CC being useless", its own note). The model's picks the community never
      lists: Gas (47), Ammo Efficiency (29, on short-magazine guns), Electricity, Status Duration.
- [ ] Cross-check ~10 guns against Underframe by hand.
- [ ] Open: the reference build is fixed. A riven that supplies Viral / Corrosive lets a real build drop
      an elemental mod; the model can't see that slot saving, which is much of why the community
      prefers combined elements.

**12d — QoL rules** (`src/data/qol.js`, a declarative table: condition on weapon data → effect on a stat)
- Ammo economy: seconds of fire from full = (AmmoMax + Magazine) / (FireRate × AmmoCost). Tight →
  Fire Rate marked down (empties the reserve faster), Ammo Max / Ammo Efficiency / Reload While
  Holstered marked up.
- Beams (BEAM tag): Fire Rate also burns ammo; Punch Through / Projectile Speed do nothing.
- Charge weapons and bows: Fire Rate is charge speed (feel, not just DPS); bow Fire Rate doubled (exists).
- Negatives with no effect: −Magazine on one-arrow bows, −Ammo Max / −Magazine in Incarnon mode,
  −Zoom on snipers (often wanted), −Projectile Speed on hitscan.
- Each rule shows its reason as a note, so a mark-down is explained, not silent.

**12e — Grader + importer**
- Next to each stat's roll grade, a "pick" mark (core / good / filler / dead) from the model, with
  the community's view, and an overall "how good is this riven *for this weapon*".
- [ ] Open: Melee. The sheet's melee rows lean on builds (Melee Influence, heavy attacks, Covert
      Lethality) that a DPS model won't capture; melee may stay community-picks only at first.

### Phase 13 — Build simulator (replaces 12c's fixed reference build)
12c showed the limit of a fixed build: a riven's worth depends on **what the build can do without
it**. A riven Viral lets the build drop its two 60/60 Viral elementals for damage mods; an arcane
changes which bucket is crowded; a frame can bring a whole element. So:

> **A riven's value = the best build with it − the best build without it**, for one scenario.

Both builds are optimised over the same mod pool, so slot saving, arcanes and frame buffs show up
by themselves instead of being guessed. 12c's bucket maths stays as the evaluator; the fixed
`BUILDS` table goes.

**13a — Mods and arcanes (`src/data/mods.js`, generated)**
- **Sources** (decided 2026-11-02): game facts, so any faithful copy will do; where two disagree,
  check in game.
  - Mod numbers: **DE's Public Export** (ExportUpgrades: every rank's stat text), read through WFCD's
    copy (`Mods.json`, no LZMA to unpack). warframe-public-export-plus (calamity-inc, MIT) has
    no stat values for ordinary mods (only names, drain, polarity), so it serves arcanes, enemies,
    abilities and weapons instead (13c, 13d).
  - **Underframe's game data** (`/api/data`): which mods can't be equipped together
    (`incompatible_mods`), and a second copy of every value to check ours against.
  - Every source is kept locally by `tools/lib/cache.mjs` (`tools/data/cache/`, **not in git**,
    with `sources.json` saying when each was fetched): a build uses the cached copy when a fetch
    fails or the data no longer looks right, and `--offline` uses only the copies. An outdated copy
    beats nothing, and it's something to compare against.
- [x] `tools/build-mods.mjs` → `src/data/mods.js`: class-level gun mods (Rifle, Assault Rifle,
      Sniper, Bow, PRIMARY, Shotgun, Pistol, Archgun) at max rank, Conclave / Flawed / riven entries
      left out. `tools/lib/mod-text.mjs` reads the stat text into effects: plain and dual-stat, faction
      multipliers, elements (colour tags stripped), triggers with duration / stacks / aiming / per
      status type, Hunter Munitions' slash on crit (its "Slash" is a bare colour tag), Acuity's
      multishot lock. Lines it can't read stay as notes (31: movement, ammo conversion, Hush…).
- [x] **Cross-check against Underframe** (per-rank values × (max rank + 1); conditionals against its
      conditionals table): **all agree** except Motus Setup (a movement trigger we don't read).
      7 mods aren't in Underframe's data; 6 conditionals it has nothing on (Charged / Primed Chamber,
      accuracy ones). What the check caught on the way:
  - DE's export has **unreleased 10-rank "Expert" copies under ordinary names** ("Split Chamber"
    +165%, "Point Strike" +275%, "Vital Sense" +220%, every 90% elemental at +165%). Released Expert
    mods are named "Primed …"; the others are dropped. Before that, ~30 core mods were wrong.
  - WFCD's level lists can run past the max rank: the max rank's entry is used, not the last.
  - WFCD writes line breaks as the two characters "\n"; Underframe calls Orokin "corrupted" and the
    Murmur "murmurs", and spells "Bane of" where DE spells "Bane Of" (names match ignoring case).
- [x] **Checked in game** (2026-11-02, the 13 Underframe couldn't check), recorded in
      `tools/data/in-game-checks.json` (committed; overrides every source): **Primed Blunderbuss and
      Primed Charged Chamber don't exist** (more unreleased Expert entries, this time under "Primed"
      names). Confirmed at our values: Tainted Mag, Spring-Loaded Chamber, Guided Ordnance, Rifle Ammo
      Mutation, Primed Rifle Ammo Mutation, Primed Chamber, Split Flights (+100% Multishot and −180%
      Accuracy per stack: +400% / −720% at 4), Narrow Barrel, Targeting Subsystem, Resolute Focus.
      Tainted Mag really is a 10-rank Assault Rifle mod; Spring-Loaded Chamber is +75% at max. Charged
      Chamber exists, stats unchecked (not owned). Confirmed mods carry `ingame: 1` in the table.
- [x] **Released or not**: PE++ marks both fakes (`isFrivolous`, no `introducedAt`), but those flags
      alone would also drop real mods (Thunderbolt is frivolous; Primed Deadly Efficiency has no date).
      Rule: dropped only when PE++ flags it **and** Underframe doesn't list it; flagged ones Underframe
      lists are kept and printed as worth a look in game. The first five were checked (2026-11-02):
      Magnetic Strafe, Primed Deadly Efficiency, Primed Stabilizer and Primed Steady Hands exist, but
      **plain "Cannonade" doesn't** (only the Semi-Rifle / Semi-Shotgun / Semi-Pistol Cannonades do),
      though Underframe lists it: Underframe's list isn't proof a mod exists either. Only the in-game
      check is final. 286 mods now; nothing flagged is left unchecked.
- [x] **No disagreements left with Underframe.** The last, Motus Setup, was settled in game (2026-11-02):
      "100% Critical and Status Chance for 4s after landing from a Double or Bullet Jump" at max
      (25% for 1s at rank 0), i.e. +100% to each, as Underframe has it. The parser now reads unsigned
      bonuses, "Critical and Status Chance" as two stats, and triggers written after the stat (jump
      landing) or before it (Proton Jet's wall latch). Also confirmed in game (screenshots): Magnetic
      Strafe, Primed Deadly Efficiency, Primed Stabilizer, Primed Steady Hands, Charged Chamber (+40% on
      the first shot; Primed Chamber is the same effect, +25% a rank, an old rank-3 event "Primed").
      Only Proton Jet is left unchecked by anything (Underframe has no numbers for it).
- [x] **Arcanes** (`tools/build-arcanes.mjs` → `src/data/arcanes.js`): 36 that change gun damage
      (primary, secondary, and warframe arcanes whose bonus goes to guns: Avenger, Rage, Precision,
      Velocity, Acceleration, Tempo, Awakening, Momentum, Arachne, Pistoleer). PE++'s ExportArcanes keeps
      each rank as a text template plus values; dict.en fills the template, and the mods' reader reads
      the text. The reader now also takes a trigger's chance ("21% chance for …"), the weapons a bonus
      goes to ("to Primary Weapons (Excludes Shotguns)" → `to`), and a trigger sharing its line
      (Primary Crux). **Underframe agrees on every one**; its Pistoleer text ("Infinite Ammo") just
      can't be compared. 15 special mechanics stay as notes, for hand-written rules in the simulator:
      Bulwark, Compression, Debilitate, Obstruct, Overcharge, Plated Round, Cryogenic, Encumber,
      Enervate, Fortifier, Irradiate, Kinship, Outburst, Shiver, Surge.
- [x] **Element combination** (`src/elements.js`, tested): mods in slot order; a repeated base element
      adds into its first place; base elements pair in order (1st + 2nd, 3rd + 4th), a leftover stays;
      combined elements from mods (a spliced riven's Viral) stay as they are; the weapon's innate
      elements join after every mod. From the wiki: **to check in the arsenal**.
  - **Slot order**: the eight main slots in reading order, top row left to right (1-4), then the
    bottom row (5-8). The exilus slot can't matter: none of the 37 gun exilus mods adds an element
    (tested). Nor can the stance slot (melee) or the arcane slot. The mods' `exilus` flag was empty
    until now (it read WFCD's `isExilus`; the field is `isUtility`), which the optimiser will need.
  - **A riven with several elements** puts them in bottom-up (the user, 2026-11-02, from the wiki's
    riven page): a mod before it pairs with its last-listed element; a mod after it pairs only with an
    odd one out (1 or 3 elements: the first listed). Heat + riven (Electricity, Cold) = Blast +
    Electricity; riven + Heat keeps Magnetic. `rivenOrder()`, tested on those examples.
  - **Every non-mod base element goes into a fixed "third row" after the mods, in Heat, Cold,
    Electricity, Toxin order ("Harrow Chassis Every Time")**: the weapon's own elements, a progenitor /
    Valence bonus, ability buffs (even an augment's, like Shock Trooper, since the mod isn't on the
    weapon). Its order doesn't depend on the source or timing. Combined elements from anywhere never
    combine or split; Toxic Lash's Toxin stays apart from it all. From The Engineer's "Elemental
    priority" video (youtube.com/watch?v=74LM3QPOkOw, tested in the Simulacrum). Before this the
    function added innate elements in the data's order: wrong whenever two non-mod elements meet
    (Tenet Envoy: innate Cold + Toxin progenitor + a Heat mod + Shock Trooper = Blast + Corrosive).
    The video's examples are tests.
- [ ] Put the other builders (weapons, weapon stats, picks) on the same local cache.
- Effects: plain (Serration +165% Damage), dual-stat (Hammer Shot +60% CD +80% SC), elementals
  (90% and the 60/60 dual-stats, in **slot order**, which decides combinations), conditional (Galvanized
  on-kill stacks, Bladed Rounds / Argon Scope aiming, Hunter Munitions slash on crit), exclusive groups
  (Serration / Amalgam Serration, Primed vs normal, one per family), exilus-only mods.
- Arcanes: weapon (Merciless, Deadhead with its +30% headshot multiplier, Dexterity, Frostbite…) and
  warframe ones that touch guns (Avenger…), with their stacks tied to the scenario.
- Elemental combination rules (mod order, then the weapon's innate elements) written down with a
  source, and tested on in-game arsenal numbers.

**13b — Optimiser**
- Pick the 8 slots (one is the riven when there is one) + exilus + arcane to maximise the scenario's
  DPS. Too many combinations to brute-force (≈ C(40, 7)), so greedy + swap search, seeded with the
  community's usual build; elementals searched as combination targets (Viral, Corrosive, Viral + Heat…)
  rather than mod by mod. Must stay fast in the browser: ~30 stats × 2 builds per weapon view.
- Show the build it picked, with and without the riven, so a reader can disagree with it.

**13c — Scenarios**
- **Single target** (a boss: no kills, so on-kill stacks decay; status stacks build over time),
  **fodder** (kills everywhere: Galvanized / Merciless maxed, multishot and punch through count, weak
  points rarer), **status capped** (every status type on the target: Galvanized Aptitude and similar
  maxed). Each sets the weak point share, the stack counts and the target.
- **Factions**: Grineer, Corpus, Infested, Corrupted, Murmur, Scaldra, Techrot… each with its health,
  armor and shield profile and damage-type weaknesses (post-rework values, from the wiki), at a chosen
  level / Steel Path. Faction damage on the riven then counts against its own faction only.

**13d — Frames, subsumes and companions (curated buffs)**
- Frames and subsumes that warp a build, as buffs in the same effect format: Narin (weak points, for
  Tenet Glaxion and the like), Nourish (Toxin and Viral), Saryn and Oraxia (Toxin), Roar, Eclipse,
  Xata's Whisper, Chroma, Harrow… Each needs its numbers at a stated ability strength.
- **Primer companions**: statuses they keep on the target (feeding Galvanized Aptitude-style bonuses and
  status-capped scenarios), and their own damage left out.
- Picked in the UI next to the scenario; the optimiser then builds around them.

**13e — UI and checks**
- The model block gets: scenario, faction / level, frame, companion, arcane (or "best"). Results: the
  riven's value per stat and the best sets, now as best-with − best-without, plus both builds.
- Checks: arsenal numbers for a few builds (damage per shot, crit, status), Underframe by hand for ~10
  guns, and the community score (`tools/score-sim.mjs`) per scenario.
- Open questions for the user before 13d: Narin's exact weak point effects; which frames and
  companions matter most; the primer companions to start with.



---

## Verified in game (2026-10-23)

The player-data fingerprint `Value` is a 30-bit roll: **u = Value / 2³⁰**, and W = 0.9 + 0.2u.
For curses, a **higher u means a bigger negative** (no flip). In-game display is **1 decimal**.
Predicted before seeing the screenshots, all matched:

| Riven (internal name) | Rank 8 | Rank 0 |
|---|---|---|
| Soma (`TennoAR`) ++- | +267.2% Damage, +138.7% Electricity, −31.7% Ammo Max | — |
| Lacera (`StalkerMios`) ++- | +129.3% Crit Dmg, +122.5% Status, −65.1% Finisher | +14.4%, +13.6%, −7.2% |

Later batch, also all exact: Vinquibus melee `++`, Obex `++-` and Vinquibus rifle `+++-`. That
confirms the melee Impact/Puncture coefficient of **0.0133** (−77.8% and +129.7%, where 0.013333
would show −78.0% and +130.0%). A Dax bow `+++-` riven at +138.4% Puncture confirms the gun value
**0.01333** (0.013333 would show +138.5%). The wiki's Impact/Puncture/Slash split is correct. These are all Phase 2 golden tests. Fingerprint tags seen so far: `WeaponDamageAmountMod` (damage),
`WeaponElectricityDamageMod`, `WeaponAmmoMaxMod`, `WeaponCritDamageMod`, `WeaponStunChanceMod`
(status chance), `WeaponMeleeFinisherDamageMod`.

## Open questions

1. ~~Continuous or discrete rolls?~~ Settled: 2³⁰ steps, so effectively continuous.
2. **Spliced-stat probability.** A spliced trait takes the *higher* u of its two parents, so
   P(u ≥ x) = 1 − x² rather than 1 − x (for Ammo Efficiency ≥ 70%: ~46% instead of ~26%).
   The wiki also says a negative parent's "true" u is used, which may make the math more involved.
   Currently: the spliced odds only, with a note. To be confirmed in Phase 9.
3. ~~Rank selector~~: kept (0–8).
4. ~~Repo~~: `Tome-Wyrm/riven-calculator-site`, public, Pages from `main`.
5. ~~OCR library delivery~~: CDN on demand (jsDelivr, pinned version).












### User Added Tasks
- [x] Make the curse grading flip a toggle button. (Grader: "Curse grading", bigger or smaller is better; saved in the link.)
- [x] In the Stat Ranges section, collapse the Heat/Cold/Electric/Toxin and Impact/Slash/Puncture and Faction Damage and Other Stats (which also share the same values, like the previous). Rows whose ranges show exactly the same share one row; Puncture keeps its own, since its coefficient shows ~0.04 lower.
- [x] In the Stat Ranges section, there does not need to be so much whitespace between Stat and Positive. In narrower browser windows, it overflows the side of the display port.
- [x] In the Build Planner section, Spliced should have the same selectors as the positive stats, as should the negative. It should go LessThanOrEqualTo, EqualTo, GreaterThanOrEqualTo. They should also have hover tips that say "at most", "exactly", and "at least" respectively.