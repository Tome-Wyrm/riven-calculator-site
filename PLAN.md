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
- [x] Create the GitHub repo, push, and enable Pages (`main` / root). Do this early so every
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
- [x] Re-run `tools/build-weapons.mjs` when the full scan finishes (102 of ~420 families so far)
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
  - [x] **Done, as far as seen (2026-11-03):** spliced traits look different by screen: marked on the
        splice screen, normal (or locked) on the cycle screen, and the arsenal shows no locks at all.
        Earlier note: find how spliced traits appear in
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
- [x] For each recipe (`from` pairs in `stats.js`): the u needed on the spliced trait, converted back to
      the displayed value each parent would need (the spliced trait keeps the *higher* parent roll,
      so either parent reaching it is enough)
- [x] Shape is locked by splicing, so show results per shape and note that the riven keeps its layout
- [ ] Negative parents: the wiki says the "true" u of a curse is used. Confirm the direction in game with
      one splice (predict first, then compare, as we did for curses). Still open: the page ranks a curse parent by
      its size.
- [x] Odds of a target spliced value from fresh parents (max-of-two), reusing `probability(…, spliced)`

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
- [x] Combine with roll quality (Phase 11): "and Cold ≥ 100%"
- [x] "Plan from this riven" button in the grader / importer (fill the start state automatically)
- [x] **Either-or slots** (a request from the Discord, 2026-11-03): a positive slot can take several
      stats ("Cold or Toxin", "Range or Attack Speed"); any one fills it. The engine tracks every
      alternative and counts the riven done once each slot is filled by a different stat (so
      overlapping slots can't share one). At most 6 tracked stats, splice parents included. Panel:
      "+ or" beside a pick; links store a slot as `cold|toxin`. Felarx-style melee example (Status
      Damage spliced, -Slash): Cold + Range ~1.74M Kuva, Cold/Toxin + Range/Attack Speed ~0.54M.
      The curse takes alternatives too ("-Zoom or -Recoil"; links: `neg=zoom|recoil`): any one of
      them counts, with the curse's value goal on whichever lands.

- [x] **Recommended rolls gated** (2026-11-03, still under construction): 🚧 in its title, closed on
      every load; opening it asks for a name, and only names whose MD5 is in `src/data/allowlist.js`
      open it. The names live in the git-ignored `tools/data/allowlist.txt`
      (`node tools/build-allowlist.mjs` fills in hashes and rebuilds the published list). Not
      security: it keeps the panel out of casual view.

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

**13b — Optimiser** — done (2026-11-02)
- [x] The damage maths takes a build's **totals** (`dpsOf` in `src/sim.js`): each stat summed, elements in
      slot order, combined with the weapon's own by `combineElements`. The old reference build is now
      just one set of totals (`dps`), so 12c's numbers and the community score are unchanged (79%).
      New stats: Galvanized's **Direct Damage** (added to Damage on direct hits only, not DoT),
      Hunter Munitions' **Slash on crit**, **multishot / fire-rate locks** (Acuity, Semi- Cannonades),
      Deadhead's **headshot multiplier**.
- [x] `src/build.js`: which mods fit (Rifle mods on every rifle-class primary; Assault Rifle mods on the
      wiki's "Rifle" kind only; Sniper, Bow (bows and crossbows) and PRIMARY mods; and the **weapon tags**
      a mod needs or can't go with, from PE++: SEMI_AUTO, BEAM, ASSAULT_AMMO, NO_AIM…). Weapon stats now
      keep every wiki tag and the wiki's class; a weapon whose only trigger is semi-auto counts as
      SEMI_AUTO (the wiki tags only 2).
- [x] **Scenarios** (a first cut of 13c): **fodder** (kills keep on-kill stacks at max: Galvanized,
      Merciless) and **single target** (no kill stacks); aiming bonuses count; 4 status types on the
      target for "per status type" bonuses. Triggers not followed (reload from empty, first shot,
      invisibility, ability cast, movement, chance procs) count as off.
- [x] **Search**: fill the 8 slots greedily, then the single best change until none helps: swap a mod,
      **swap two slots** (slot order decides elements), or **put in two elemental mods at once** (a
      combined element needs both halves: without this, Laetum's build without a riven never found
      Viral, and a lone Toxin riven looked worth +308%). Then the arcane, then the mods again around it.
      Exilus left empty: no gun exilus mod changes damage. About 17 ms a build.
- [x] **Riven worth** (`src/study.js`, run in a worker, ~1-1.5 s a gun): the best build without a
      riven; each positive alone in the riven slot (against the slot empty, the other 7 re-chosen);
      the best rivens (sets from the top 7 singles, at most one spliced) against no riven; each curse
      on the best riven. The page shows the builds (8 slots + arcane) and a scenario picker (URL `sc`).
- What the first runs caught: the Laetum local optimum (the pair move); crossbows missing Bow mods (a
  case-sensitive match); Semi- Cannonades offered to Felarx (their "Only compatible with Semi-Auto
  Trigger. Fire Rate cannot be modified." is in the description and PE++'s tags, not the stat lines).
- [x] **Build types instead of a weak point share** (the user, 2026-11-02: hitting weak points is
      hard, so it's a build of its own): **room clearing** (kills keep stacks up, body shots), **single
      target** (no kill stacks, body shots), **weak points** (every direct hit on one, weak point kills
      keep stacks up). Weak point triggers (Galvanized Scope, Argon Scope, Deadhead's stacks) only live
      in the weak point build. URL `sc` = room / single / weak; the weak point slider is gone.
- [x] **Weak point maths from the wiki** (Enemy Body Parts, Update 44, Narin's Sonar rework): the
      target's own multiplier (3x for most heads; 1.5x for the Murmur and Techrot) **plus 1.5 x Weakpoint
      Damage** (heads; 1x on a non-head weak point, not modelled), then **x (1 + headshot multiplier
      bonuses)** (Deadhead, Target Acquired); the **critical headshot bonus doubles the crit multiplier**
      where the enemy allows it (not Corpus humanoids, the Murmur, Techrot); **explosions are never weak
      point hits**. Enemy profiles by faction (`HEADS` in `src/sim.js`; the Murmur added to the enemy
      list). Tested on the page's examples: Acuity + Seek on a 3x head = 9.375x; with Deadhead and Prowl
      15.9375x. Before this: x2 x (1 + WPD), no headcrit, explosions counted.
- [x] **Gun CO per attack, from Underframe's `co_data`** (kept in `weapon-stats.js` as `co`: [share,
      1 if it multiplies]): Galvanized's Direct Damage adds to Damage by default, **multiplies** on 114
      attacks (Coda Bassocyst's normal attack, Tenet Arca Plasmor, Cinta…), applies at a partial share on
      38, and not at all on 164 (explosions mostly; one Underframe doesn't list gets none, per its notes).
- What changed in practice: Weakpoint Damage only leads in the weak point build (Rubico Prime there
  adds Galvanized Scope and Target Acquired); against the Murmur's 1.5x weak points the build takes
  Primary Acuity (+5.25 on the multiplier) and Multishot on the riven becomes worthless (Acuity locks it).
- [x] **CO cross-checked against the wiki's Condition Overload (Mechanic) catalogue** (a local copy
      at `tools/data/ConditionOverload.wiki`, git-ignored with any `tools/data/*.wiki`;
      `tools/lib/co-wiki.mjs` reads it, `build-weapon-stats` prints the comparison): 162 rows agree, 13
      differ, none changing the data (Underframe's rows are newer; each difference is explained in the
      build script). Worth an in-game look: Burston (Prime)'s incarnon radial attack (wiki 24%,
      Underframe 100%). Tried 2026-11-03 (Galvanized Aptitude alone, Simulacrum): not settled. The
      radial attack's 100% falloff over 2 m moves the numbers as much as the bonus would, and the
      targets' status types weren't visible (orange hits 735 with 2 stacks vs 327-329 without: 2.25x,
      which fits 100% with ~1.5 types or 24% with ~6.5).
- [x] "Auto / Semi" weapons (Felarx, Laetum) **can't** take the Semi- Cannonades (the user, in game,
      2026-11-02; recorded in `in-game-checks.json`). That's what `weaponTags` already did.
- Sonar is left out on purpose (the user: whoever uses Sonar knows to build for weak points).
- [ ] **CO not modelled**: Secondary Shiver (+45% Direct Damage per Cold stack, pistols and archguns:
      needs Cold stacks on the target); Tenet Detron's CO at 65% on multishot projectiles; incarnon
      evolutions that raise base damage without raising CO (the wiki: Atomos, Cestra, Despair…: the
      share isn't in Underframe's table for every one); melee Condition Overload (guns only so far).
- [ ] **To check**: Catchmoon (not in the wiki's -2 list; no gun to test with); whether Deadhead still
      applies on the -2 weapons (assumed); per-unit weak points (MOA rears 3x non-head, Bursa consoles,
      Juggernaut maws) are averaged away by the faction profile.
- [x] **Checked in game (2026-11-03, Simulacrum):** the Ignis Wraith *does* take the weak point bonus
      (unmodded, armor stripped by Gaze, level 150 Heavy Gunner: body 35, head 105 = 3x, body crit 88 =
      35 x 2.5). Cernos Prime's +50% on headshots multiplies (Rogue Arcocanid, a 1.5x Murmur head: body
      236, head 530 = 2.25 = 1.5 x 1.5; head crit 2,122 = 530 x 2 x the 2x critical headshot bonus).
      Tenet Arca Plasmor: 1,047 on head and body alike (1x). All three agree with HEADS in `src/sim.js`
      plus the wiki's per-attack ExtraHeadshotDmg, now in the weapon data as `hs` (`weakPointMult`):
      +0.5 Cernos Prime and Kuva Chakkhurr, +0.2 Sybaris Prime and Coda Synapse, added to the headshot
      multiplier bonuses; -2 (Arca Plasmor, Flux Rifle, Fulmin Prime, Afentis, Alternox, Nagantaka
      Prime) means no weak point bonus.
- [x] **The optimiser scored against the community** (`tools/score-optimiser.mjs`, 2026-11-03: 235 gun
      families, one per pick family, +++- at median rolls, 11 worker threads, ~1 min a setting;
      results cached in `tools/data/cache/score-optimiser.json`). Old reference build: 58% of first
      choices in the top 6, 79% of slot-1 first choices in the top 3.

      | Setting | Top 6 | Slot 1 in top 3 | In the best riven | Curse ok |
      |---|---|---|---|---|
      | Single target, any, stripped | **59%** | **84%** | 53% | 51% |
      | Room clearing, any, stripped (page default) | 53% | 27% | 43% | 44% |
      | Room clearing, burst | 49% | 15% | 43% | 44% |
      | Room clearing, primed target | 52% | 33% | 39% | 48% |
      | Weak points | 40% | 9% | 27% | 42% |
      | Room clearing, Heavy Gunner 150 SP, full armor | 50% | 7% | 42% | 45% |
      | Room clearing, Elite Crewman 150 SP | 41% | 14% | 38% | 46% |

      ("Curse ok": the community's first-choice curse costs at most 2 points more than the most
      harmless one.) What drives the gaps:
  - **Single target agrees best, better than the old model.** The community's picks read like a build
    without kill stacks.
  - **Galvanized Chamber dilutes a Multishot riven in room clearing**: at 5 kill stacks it's +230%
    Multishot, so the riven's adds little (Soma +32%, Nataruk +23%; with Split Chamber in single
    target, +82% and +86%, the top stat). Multishot is the most missed pick in every room setting.
  - **Galvanized Aptitude makes every status type worth ~8%** at full stacks: riven elements look
    strong (Soma's Toxin +58% with it, +41% without), and Impact / Puncture curses look costly (a
    median −108% Puncture curse removes Soma's Puncture, 40% of its physical damage, and a status
    type: −17%). True in game; the community's picks don't count it.
  - **Reloads**: Ammo Efficiency is worth 0% in burst, 23–35% with reloads; burst agrees less overall.
  - **Targets** pull the advice where expected: full-armor Grineer → Viral, Corrosive, Damage to
    Grineer; shielded Corpus → Magnetic; weak points → Weakpoint Damage and Weakpoint Crit Chance.
    Corrosive is the community's most missed pick against stripped armor and isn't missed at all
    against full armor: the sheet assumes armor.
- [x] **DoT ticks now scale with their own element's mods** (2026-11-03; the wiki's Damage/Calculation:
      Heat, Toxin and Electricity ticks x (1 + that element's mods, counted even once combined), Gas
      ticks x (1 + Gas bonuses); the model had left it out). Re-scored: room clearing 51% / 26%, single
      target 53% / 72% (was 59% / 84%); curses agree more (56%, 67%). Status Duration and Status
      Damage now rank high, exposing the next bias:
- [x] **DoT against the time to kill.** The closed form gave every proc its full ticks, as if the
      target lived forever, so Status Duration (more ticks) was overrated. Solved by the fight below.
      Blast procs aren't modelled yet (10 stacks detonate for 3x the stored hits).
      **Heat's armor strip takes time, and Status Duration slows it** (the user, 2026-11-03; the wiki's
      Damage/Heat Damage): 15%, 30%, 40%, then 50% stripped, a step every 0.5 s x (1 + Status
      Duration), so full strip takes 2 s, 4 s at +100%, 1 s with a −50% curse; when the proc ends,
      armor comes back over 6 s. So Status Duration both helps (longer DoTs) and hurts (slower strip).
- [x] **The fight** (`src/fight.js`, 2026-11-03; the user: step by the fire rate, not engine ticks,
      and the questions are "is it dead yet?" and "how many shots did it take?"). A build against its
      target, shot by shot: each shot's expected damage (crits, weak points, procs as averages), DoTs
      running as rates between shots (a DoT kill between shots is placed where it happens), procs with
      their own timers, Heat stacks on one timer that whole procs reset (they ramp), Heat's stepped
      strip slowed by Status Duration, Corrosive, Viral and Magnetic stacks, shields first with
      spill-over, Galvanized counting the status types on *this* target (a fresh enemy has none).
      - **Shots to kill, smoothed**: the killing shot counts for the share of it the kill needed
        (2.5 shots, not 3: the average of what crit rolls spread), never less than one shot. Pure
        breakpoints made every stat that saved the same shot tie.
      - **Room clearing** (and weak points): identical targets, so one fight stands for them all.
        **Single target**: one fight. Both at the gun's sustained rate (see below). A target alive
        after 20 s is finished at its rate so far.
      - The optimiser scores builds by the fight whenever there's a target, which is always on the
        page now ("any faction": a unit without faction weaknesses, Heavy Gunner by default). The
        result reads as an effective DPS (health and shields over the time per kill); the closed
        form (`dpsOf`) stays for the old reference model and tools.
      - Speed: queues with running totals (everything a build applies lasts the same time, so it
        expires in order) and the one-fight room: ~2 s a study (was 0.6–1.4 s with the closed form).
      - **Felarx**, the user's example: against a level 150 Heavy Gunner it kills in about a shot, so
        its best riven stats are Ammo Efficiency, Fire Rate, Reload Speed and Magazine, ahead of any
        damage stat; Rubico Prime against a level 100 Steel Path Lancer fills its build with
        Primed Fast Hands, Speed Trigger and Magnetic Capacity.
      - **Re-scored with fights** (`tools/score-optimiser.mjs`; "any faction" settings fight a level
        150 Steel Path Heavy Gunner without weaknesses, armor stripped). Top 6 / slot 1 in top 3 /
        in the best riven / curse ok:

        | Setting | Fights | Closed form (after the DoT fix) |
        |---|---|---|
        | Single target | 54% / **78%** / 45% / 50% | 53% / 72% / 43% / 67% |
        | Room clearing | 51% / **40%** / 38% / 48% | 51% / 26% / 36% / 56% |
        | Room, burst | 49% / 32% / 36% / 47% | — |
        | Weak points | 28% / 8% / 20% / 55% | — |
        | Primed target | 28% / 18% / 17% / 64% | — |
        | Heavy Gunner, full armor | 58% / 23% / 52% / 26% | — |
        | Elite Crewman | 42% / 27% / 32% / 51% | — |

        Status Duration no longer tops anything. Where a build kills the target in about a shot
        (primed targets, weak point builds), damage stats stop mattering and Ammo Efficiency,
        Magazine and Reload Speed lead: the Felarx effect, which the community's picks (made for
        damage) don't share. Against full armor, Corrosive and Viral lead, as before. The odd "Zoom
        curse is costly" (45 against full armor) is the search finding a slightly better build with
        a curse than without: noise of a greedy search, not a real cost.
      - **Tick timing** (the user asked, 2026-11-03; the wiki's Damage over Time table): Slash, Heat
        and Toxin wait a second, then tick each second up to the end (6 ticks at 6 s); Electricity
        and Gas tick at once and each second before the end (6 ticks, none at 6 s). Both the closed
        form and the fight had given every proc **7** ticks, one too many. With Status Duration the
        two kinds round differently (`ticksOf`): at 7.8 s Toxin ticks 7 times, Electricity 8 (read
        off the table's pattern; **confirmed in game** 2026-11-03 at +30%: Electricity 8, Toxin 7). In the fight, Electricity's first tick
        lands with the shot, and the rest of the ticks run spread over the second around each
        tick's time, so a Toxin proc kills later than the same Electricity proc (a test).
      - **No cliffs in the ranking** (the user, 2026-11-04: −Magazine showed +5% on Felarx at level
        9999, and breakpoints are footguns). Felarx single target swung from 1.4 s a kill to 5 s on
        whether the kill fit one magazine, so one-swap searches stuck, and each curse's search that
        fell off and came back found better mods than the baseline. Now:
        - Every shot carries its share of the reload (`interval` in `src/fight.js`), single target
          as well as rooms: the fight runs at the sustained rate. Average DPS with the ramp-up
          (stacks building, armor falling) kept: the closed form has no ramp-up.
        - A kill's time: the last interval and the shot ending it count for the share needed, DoT
          and hit alike. A kill by a DoT just after a shot used to be charged less than the shot
          kill a little more damage made it: +1% Damage took Hek from 0.79 s to 1.46 s a kill.
        - Heat's strip steps are averaged over where shots fall against them: a faster reload could
          land a shot just before a step and cost 15%.
        - `study`: a curse's better mods go to the riven without it too, and each best riven takes
          the best mods any of them found (`orBetter`). Multishot + Viral, −Critical Chance now
          leads, the community's Roll 1.
        - Left on purpose: Magazine moves in whole rounds (up to 35% on a small magazine), and
          Status Duration's tick counts.
      - **Overkill counts** (the user, 2026-11-04; this ends the "Felarx effect" above). The
        community picks make a weapon worth more in more places, and content runs from low levels
        to the level cap, so a riven isn't judged on one target's health. Past a one-shot kill the
        DPS goes on rising with damage (`pace` in `src/fight.js`); the shots and seconds shown still
        stop at one shot. Multishot now leads Felarx at most levels, Viral where armor stays on.
        Still one target at a time: on a target it one-shots, a build gets nothing for its statuses.
      - **Ammo Efficiency stops at 75%** (the user, 2026-11-04), unless a source sets it to 100%
        (none the model follows). Mods' and arcanes' values now take off the cost like a riven's:
        Primary Crux had been shrinking the magazine.
      - [ ] Show the shots per kill on the page; Blast stacks; a random (Monte Carlo) run to check
            the averages.
- **Decided** (the user, 2026-11-03): room clearing keeps Galvanized stacks at their maximum. They
  are up most of the time, and they decay one at a time, so getting them back is usually trivial.

**13c — Scenarios**
- **Single target** (a boss: no kills, so on-kill stacks decay; status stacks build over time),
  **fodder** (kills everywhere: Galvanized / Merciless maxed, multishot and punch through count, weak
  points rarer), **status capped** (every status type on the target: Galvanized Aptitude and similar
  maxed). Each sets the weak point share, the stack counts and the target.
- **Factions**: Grineer, Corpus, Infested, Corrupted, Murmur, Scaldra, Techrot… each with its health,
  armor and shield profile and damage-type weaknesses (post-rework values, from the wiki), at a chosen
  level / Steel Path. Faction damage on the riven then counts against its own faction only.
- [x] **Done (first pass, 2026-11-03).** Scenarios are the three build types (13b) plus a **primed
      target** toggle (status capped: every status type up, Viral and Corrosive at 10 stacks, Heat
      burning). **Targets**: `tools/build-enemies.mjs` → `src/data/enemies.js` (648 units from
      Underframe's codex-based presets, base level / health / shields / armor; each faction's
      Update 36 weaknesses from the wiki's `Module:DamageTypes/data`, ±50%, Heat −50% on shields).
      `src/enemies.js` scales them (the wiki's Enemy Level Scaling: per-faction health and shield
      curves, smoothstep 70–80 levels up, armor 200 floor / 2700 cap, Steel Path x2.5 health and
      shields; the builder checks every coefficient against the page). The model kills the target:
      shields first (no armor; Toxin skips them, Slash bleeds don't since Update 27.2: the user caught
      it, 2026-11-03), then health; the result is health +
      shields over the time taken. **Per status type** bonuses (Galvanized) now count the status types
      the weapon keeps up itself (each type 1 − e^(−procs/s × 6 s)), not a fixed 4. UI: target unit
      (each faction's default: Heavy Gunner, Elite Crewman, Ancient Healer, Corrupted Heavy Gunner,
      Scaldra Screamer, Techrot Scaart, Lumbering Fragment), level (default 150), Normal / Steel Path,
      armor stripped / full, statuses own / primed; URL `unit`, `lvl`, `sp`, `armor`, `primed`.
      A study takes 0.9–1.9 s (was 0.6–1.4 s).
- [x] **Magnetic** (the wiki's Damage/Magnetic page and the in-game tooltip): shields take x2 at one
      stack, +25% each more, x4.25 at 10; when they break, 3% of the max shields per stack as
      Electricity to health.
- Shield regeneration is left out on purpose (the user: if the enemy regenerates shields, the build
  is doing it wrong).
- [ ] **Not modelled yet**: Overguard and Eximus units; per-unit weak points. (Every faction is a
      target since 2026-11-03: Kuva, Amalgam, Deimos, Sentient, Narmer, Zariman and Anarchs too.)
- [x] **Grineer Bane doesn't apply to Narmer** (in game 2026-11-03): Rubico with Primed Bane of Grineer
      (x1.45), level 235, white hits: Lancer 99, Narmer Lancer 50. Same base armor and level, so the
      ratio is the weaknesses and the Bane: (144 x 1.5 + 36) x 1.45 / (144 + 27 + 9 x 1.5) = 1.98
      exactly, against 1.37 if the Bane applied to both. Narmer's Bane faction stays '' as modelled.

**13d — moved to Phase 14** (frames, abilities, subsumes and companions; the user, 2026-11-03).

**13f — Valence bonus (adversary weapons: Kuva, Tenet, Coda)** — done 2026-11-03
- [x] The bonus is the weapon's own damage: a share of its listed damage (25–60%) of one element,
      joining after the mods (HCET); it's part of the base that elemental mods and DoTs scale from
      (in game: Coda Bassocyst, 60% Heat, with and without Incendiary Coat; `in-game-checks.json`).
      DoT ticks include it too (in game 2026-11-03: a yellow Heat tick of 2,707 on an unarmored,
      unweakened target = 0.5 x 1,292.8 x 1.9 x 2.2 crit = 2,702; without the bonus it'd be 1,689).
- [x] Adversary guns marked from the wiki's traits (40, as Underframe's `is_progenitor` has).
- [x] "Best" (the default): the study tries every element, each by its best build without a riven,
      and studies rivens with the winner. The search sticks on poor builds (Chakkhurr's Heat build
      was 60% off), so each element's search restarts from every other's build (`optimiseEach`).
- [x] The usual picks beside it: Brozime's Lich Weapons note and the Community sheet of the user's
      workbook (`tools/build-valence-picks.mjs` → `src/data/valence-picks.js`).
- Agreement (the model's best, within 0.5%, includes the pick), level 150 Steel Path Heavy Gunner
  without weaknesses, room clearing: armor stripped, 14/40 Brozime and 15/40 community (before
  the restarts); full armor, 23/40 and 21/40. Heat's armor strip and Magnetic's work on shields and
  Overguard (Eximus) are why players pick them; a stripped, unshielded target values neither.
- [ ] Score per faction (Corpus shields for Magnetic) and with Overguard once it's modelled.
- [ ] Ties: Impact, Magnetic and Radiation often tie exactly against one unshielded unit (none
      combines and their procs do little there).

**13g — Incarnon evolutions** — 2026-11-03 (the user: Felarx's Devastating Attrition makes a crit
chance curse good, and the model had it as a cost)
- [x] Perks from Underframe's incarnon data (`tools/build-incarnons.mjs` → `src/data/incarnons.js`,
      69 guns), applied to the gun's own numbers before anything else sees it (`src/incarnon.js`):
      base damage to normal attacks (each type in proportion), crit / status chance (status per
      form), crit multiplier, multishot, magazine, flat crit after mods (Elemental Excess), headshot
      bonuses, fire rate and reload; and the non-crit bonus (`critScale` in `src/sim.js`: a 50% chance
      of +2000% on each hit that doesn't crit, so it fades as crit chance rises).
- [x] **Normal, Incarnoff, Incarnon** (the user, 2026-11-04): a gun that takes a Genesis adapter can go
      without one (Normal: no perks), have it and fire normally (Incarnoff), or be in its form
      (Incarnon). Natural Incarnons (the wiki: Felarx, Laetum, Phenmor, Onos) have no Normal. Akimbo
      and Dual weapons can't take an adapter (the wiki), so Dual Cestra has none. The form counts the
      whole fight in the form: its charge and ammo aren't modelled.
- [x] "Best" (the default): every combination of perks tried with the reference build (at most 81);
      one at a time picked Brutal Edge (+10% crit) before seeing Devastating Attrition. The page
      lists each evolution's perk and lets you change any ("Back to the best").
- Felarx, level 200 Steel Path Heavy Gunner, room clearing: a Critical Chance curse went from -30%
  (unevolved) to +2.9%. At level 150 the evolved Felarx one-shots, so crit stops mattering at all.
- [x] Devastating Attrition is x21 (+2000%), rolled per pellet (in game 2026-11-03, unmodded Felarx:
      pellets 27, a boosted one 561 = 26.7 x 21; x20 would show 561 next to 28s).
- [x] "Increase Damage by +X" is per shot: a shotgun's pellets share it (in game 2026-11-03, Boar at
      level 235: Fortress Salvo +16 and Reified Bane +10 both show pellets of 10 and crits of 24; per
      pellet, +16 would be 19% more).
- [x] Perk fire rate adds to the mods (in game 2026-11-03: Laetum with +100% from mods shows 5 without
      Rapid Wrath, 5.5 with it = 2.5 x (1 + 1 + 0.2); a separate x1.2 would be 6). Reload speed is
      taken the same way (`WeaponStats.bonus`). Shotgun splits go by base pellets (the user: Multishot
      only adds pellets; each keeps the same chances).
- [x] Best rivens on a shape with a curse carry one (the user, 2026-11-03: no curse is never better,
      since a curse raises the positives and some curse is always harmless): each takes the kindest
      curse measured on the top riven (the next one where it rolls that stat), re-scored with it;
      "Plan" passes it on. Shapes without a curse show no curse section.
- Felarx at level 9999 Steel Path (stripped Heavy Gunner, 6.1M health): its best build does ~8.9M
  DPS, so kills take under a second. Status Duration does nothing (no DoT runs out first);
  Reload Speed +15% in Normal Attack mode, 0 in Incarnon Form (no reload).
- [ ] Conditional perks aren't applied (on headshot, per Electricity proc, Overwhelming Attrition's
      +400% stacks…), nor perks that change other modes' numbers beyond those above.

**13e — UI and checks**
- The model block gets: scenario, faction / level, frame, companion, arcane (or "best"). Results: the
  riven's value per stat and the best sets, now as best-with − best-without, plus both builds.
- Checks: arsenal numbers for a few builds (damage per shot, crit, status), Underframe by hand for ~10
  guns, and the community score (`tools/score-optimiser.mjs`) per scenario.

### Phase 14 — Frames, abilities and companions

Buffs from Warframe abilities, augments, subsumes, passives and primer companions, so the optimiser
builds around them. Guns only; melee buffs wait for a melee model.

**Sources (2026-11-03)**
- **Underframe's `external_weapon_buffs`**: 62 abilities, 24 passives, 14 subsumes, 16 arcanes, 8
  Archon Shards, a few set mods. Each has a buff kind, a value, what it scales with (strength or
  duration), the augment it needs and the weapon classes it applies to. The base layer.
- **The wiki**, cached by `tools/fetch-wiki.mjs` (`tools/data/cache/wiki-*`, not in git):
  `Universal Weapon Bonuses` (which bucket each buff is in), `Extra Hit`, `Damage Vulnerability`,
  `Module:Ability/data`, `Module:Warframes/data` (passives), `Module:Mods/data` (augments), and one
  page per ability or augment the user named (45 pages): numbers per rank and the stacking notes.
- **The user's Nova guide** (Google Doc, cached as `tools/data/cache/nova-guide.txt`).

**What changes a riven's value.** A buff that multiplies all damage the same way changes the DPS, not
which riven is best. What matters is the bucket a buff joins: the riven stat in that bucket is worth
less, and the stats it multiplies are worth more.

| Bucket | Buffs (value at 100% strength) | Effect on rivens |
|---|---|---|
| **Base damage** (adds with Serration) | Vex Armor Fury 275%, Amp 25–200% (sound), Shooting Gallery 25%, Toxin Elemental Ward 35%, Deathbringer 100%, Metamorphosis 25% (decays), Rift Surge + Rift Torrent 30% per enemy, Absorb up to 400%, Airburst Rounds 40% per enemy hit up to 500% (secondaries), Arcane Arachne | Damage rivens worth less |
| **Faction** (adds with Bane mods; twice on DoT) | Roar 50% (30% subsumed) | Faction rivens worth less |
| **Separate multipliers** | Eclipse 200% (30% subsumed), Garuda's passive up to 100%, Parasitic Link 25%, Vauban's passive and Overdriver 25% | None, except additive CO stays additive beside Eclipse |
| **Damage vulnerability** (on the target; multiplicative; not doubled on DoT) | Molecular Prime 100%, Blazing Chakram 100%, Webbed Embrace 50%, Demonium 50%, Reap 50%, The Vast Untime 50% (Void only), Hakchum (Cold only), Paralysis (melee only); Jade's Judgments and Prey of Dynar add among themselves | None, unless type-specific (Vast Untime lifts Xata's Void) |
| **Extra hits** (a separate hit for a share of the weapon's hit; Bane twice on it, three times on its DoT; its proc is guaranteed except Xata's) | Toxic Lash 30% Toxin; Xata's Whisper 26% Void (procs at the weapon's status chance; works on Incarnon forms); Resupply 25% any element (x2 snipers; no Incarnon, battery weapons or archguns); Silken Stride 40% Toxin (x2 wall-latched; no Incarnon); Uriel's Demonium rune 30% Heat (+30% fire rate); Narin's Sangodae 50% Cold | Everything that multiplies the hit gains, Multishot too (each pellet triggers one); one more status type |
| **Elements** | Venom Dose, Shock Trooper, Freeze Force, Fireball Frenzy +100% (never combine; add to mods of the same element); Nourish 75% Viral (45% subsumed); Plunder up to 200% Corrosive; Valence Formation | Riven elements and status types |
| **Crit, flat after mods** | Covenant 5% + 1.5% per 100 damage blocked (cap 50% body, 200% weak points); Shadow Haze 50%; Zephyr's passive +150% airborne; Nyx's passive +40% per confused enemy (to 200%); Yareli's +200% (secondaries, moving); Cyte-09's +300% Weakpoint Crit Chance | Crit Chance rivens worth less on low-crit guns, more on Crit Damage |
| **Crit damage** | Tharros Lethality +100% (adds with Vital Sense; x2 spearguns), Grave Spirit 50%, Empowered Quiver 100% | Crit Damage rivens worth less |
| **Status** | Prismatic Gem +100% status chance and +100% duration (add to mods); Saryn's passive +25% duration; Dante's +50% chance on scanned targets; Banshee's passive (max Puncture stacks on targets) | Status rivens worth less; status types up |
| **Fire rate, multishot, reload** | Redline up to 75% fire rate; Penance 35% fire rate, 70% reload; Haste Mote 30% fire rate; Metronome's Opera 30% Multishot (adds with Split Chamber); Mesa's passive | Those riven stats worth less |
| **Weak points** | Sonar x5 per spot (multiplies a head's own multiplier; crits on Sonar spots are never headcrits; extra hits get it too); Seek +75% (adds into the weak point formula); Cyte-09's passive | Weakpoint rivens; a weak point build without heads |

**Needs its own model** (research first): Hall of Mirrors (2 clones at 40% of the weapon, crit and
status chance cut by the same factor), Tornado (spreads each hit to every trapped enemy; crits on
them x2), Breach Surge (sparks of 2x the proccing hit as Radiation, 100% crit at 1.5x, 20% status),
Crystallize (sets crit chance on crystals; hitscan crits x2), Prismatic Gem's beams, Molecular Prime's
chaining explosions (they inherit extra hits), Divine Retribution (spreads statuses, bursts the
rest), The Lost's Gaze, Null Star, Antimatter Drop (no longer weapon-coded).

**Melee only, for a melee model**: Valkyr (Warcry attack speed, Rage, Paralysis), Voruna (Shroud and
Prey of Dynar, Lycath's Hunt's Heavy Attack Efficiency; combo needs modelling).

**Primer companions** (the user's list): Diriga (close-range AoE electric), Panzer Vulpaphyla
(Viral), and Tazicor or Helstrum on a sentinel stacking status chance, status variety (rainbow) and
fire rate. Modelled as the statuses their weapons keep on the target (their own status chance, fire
rate and elements), feeding status types and Viral / Corrosive stacks: the "primed (all)" switch
becomes a choice of primer.

**Steps**
- **14a Data**: `tools/build-buffs.mjs` → `src/data/buffs.js` from Underframe's buffs, each with its
  bucket, value per rank at 100% strength, what it scales with, its augment and the classes it
  applies to; checked against the wiki pages, disagreements listed for in-game checks.
- **14b Model**: the buckets above in `dpsOf` (faction-like, separate multipliers, type-specific
  vulnerability, extra hits with their own procs, flat crit after mods with caps, weak point
  additions, Sonar spots).
- **14c UI**: pick a frame (its abilities, augments, a subsume), ability strength and duration; the
  optimiser builds around them.
- **14d Primers**: companion weapons as status sources.
- **14e The hard ones** listed above.
- **14f The second list** (the user's other frames with buffs): Ash, Caliban, Dagath, Dante, Ember,
  Equinox, Excalibur, Frost, Grendel, Gyre, Hydroid, Ivara, Jade, Koumei, Kullervo, Lavos, Limbo,
  Mag, Nidus, Nyx, Rhino, Sirius and Orion, Temple, Vauban, Volt, Yareli. Narin later (not owned yet).

**Decided** (the user, 2026-11-03)
- **Ability strength** varies per frame: the user will give the relevant builds.
- **Conditional buffs and passives** (airborne Zephyr, moving Yareli, Nyx's confused enemies, Vex
  Armor's Fury, Covenant's blocked damage…) are at their maximum.
- The "weird" one is **Biting Frost** (not Freeze Force): +200% Critical Chance and +200% Critical
  Damage against frozen enemies (10 Cold stacks), adding with Point Strike and Vital Sense, not
  scaled by strength, on every weapon type.

**Heat** (the wiki's Damage/Heat Damage and a Cool Kid video the user shared, 2026-11-03)
- **Stacks ramp**: a Heat proc adds a stack and resets every stack's timer, and all stacks tick
  together once a second, so Heat damage grows linearly for as long as procs keep coming. (The model
  still gives each proc its 7 ticks.)
- **Heat inherit**: the first Heat proc on a target fixes the Heat-mod and faction multipliers for
  every later proc. A first proc from an ability (Ember's Fire Blast and Inferno, Temple's
  Pyrotechnics, Uriel's Infernalis, Demonium with Infernalis and Gulphagor, Nezha's Fire Walker and
  Blazing Chakram; Chroma, Gauss, Koumei, Protea…) or Manifold Bond carries neither, so the weapon's
  Heat ticks lose its Heat mods, Fireball Frenzy and Ripper's Wail, and faction applies once. Status
  Damage (Elementalist) still counts; the longest Status Duration wins. A primer that procs Heat
  first (Tazicor) turns it around: abilities then inherit the weapon's bonuses.
- **Extra hits are apart**: an elemental-ammo extra hit (Demonium runes, Resupply, Silken Stride,
  Toxic Lash too) is a share of the whole hit, so every elemental mod raises it, and faction applies
  three times (the hit, the extra hit, its tick). Under an ability's Heat inherit its ticks lose the
  Heat and faction factors but the extra hit keeps the rest: on Uriel, non-Heat elements are worth
  more than Heat mods.
- Faction damage double dips on DoT (once in the hit, again in the tick); the model already does, and
  reproduces the wiki's example exactly (100 Slash, Serration, Bane of Grineer, +90% Status Damage:
  a bleed tick of 297.82; a test). Riven faction stats: base 45%, through the usual roll formula.

**What a DoT inherits from its hit** (the wiki's Damage over Time, "DoT Damage Scaling", the user,
2026-11-03), for 14b:
- **Yes**: base damage buffs (Serration, Vex Armor), total multipliers (Eclipse, Furious Javelin),
  enemy debuffs (Molecular Prime, Rest & Rage: once, not twice), crits and the stealth bonus, Status
  Damage, combo counters, body part multipliers, faction (twice; Roar too).
- **Matching element only**: a Heat, Toxin or Electricity tick counts that element's mods even once
  combined (Toxic Lash's Toxin with Infected Clip in a Corrosive); Gas and Blast ticks only count
  literal Gas or Blast (Leaded Gas, Valence Formation); physical mods (Sawtooth Clip) never count.
- **No**: Sonar's and Detect Vulnerability's weak spots (the hit only).


---

### Phase 15 — Melee model (started 2026-11-03)
The damage model for melee: normal attacks first, judged by fights like the guns (src/fight.js).
Decisions (the user's, 2026-11-03):
- **Attacks**: normal attacks (light combo hits). Heavy attacks, slams and finishers later.
- **Stances**: their damage multipliers and hit counts count, their timing doesn't (each attack of
  a combo takes one swing at the weapon's attack speed). Disclosed in the "swings to kill" hover.
  Data: the wiki's Module:Stances/data (tools/build-stances.mjs → src/data/stances.js: per weapon
  type, each stance's combos, each attack's hits as [multiplier, hits, knockdown/lifted proc?]).
- **Combo counter**: a toggle: clamped to the initial combo, clamped to the max, or built up over
  the fight (each hit counts; room clearing carries it from kill to kill within the combo duration).
- **Crowd** (for follow through and Melee Influence):
  - *Nearby*: enemies inside the swing. Follow through (most melee: each further enemy keeps a share)
    or falloff (glaive throws, gunblade shots, Corufell's projectile: their attacks' own falloff).
  - *Close*: enemies within 20 m of the target, where Melee Influence can spread.
  - *Clumping*: how tightly they stand. An enemy that Influence reaches spreads to everyone within
    20 m of it too, so tight groups chain: damage climbs fast with clumping.
- **Arcane selector** (melee and guns): "Best (searched)" or a named arcane. Melee Influence and
  Melee Afflictions change how a weapon works, so they're modelled, not just their stats:
  - *Melee Influence*: an Electricity proc has a 20% chance to grant 18 s (rank 5; not refreshed) in
    which every elemental proc (Cold, Electricity, Heat, Toxin, Blast, Corrosive, Gas, Magnetic,
    Radiation, Viral; not physical) spreads to enemies within 20 m, dealing that element's damage
    from the original hit (after quantization, crits and Condition Overload on the struck target).
  - *Melee Afflictions*: on enemies knocked down or flung by melee (the stance's knockdown / lifted /
    ragdoll / knockback hits), +6 stacks (rank 5) of every status already on them.
- Data so far: melee weapons in src/data/weapon-stats.js (every attack a mode, the normal attack the
  default; a `melee` block: follow through, range, sweep radius, combo duration, heavy attack damage
  and wind up; attacks' falloff). Zaws, like kitguns, have no stats of their own (their parts decide);
  Dark Split-Sword is missing from the wiki module.
- [x] Melee weapon stats and stances
- [x] Melee mods: tools/build-mods.mjs takes the Melee compat; Melee Damage reads as damage, Attack
      Speed as fireRate; melee Condition Overload (+80% Melee Damage per status type) as Direct Damage
      per status type, like the guns' Galvanized; Blood Rush / Weeping Wounds per combo tier past 1x
      (the wiki's worked examples: additive, 0.4 x (tier - 1)); "(x2 for Heavy Attacks)" crit mods at
      their normal value; Initial Combo, Combo Count Chance. Underframe's melee upgrade types mapped
      for the cross-check (its True / Sacrificial Steel values are the heavy-attack doubles).
- [x] Melee arcanes (slot "melee") and the arcane selector on every weapon ("Best (searched)", "None",
      or one by name: the build always carries a chosen one). Melee arcanes' text isn't plain stats,
      so tools/build-arcanes.mjs gives them by hand, each with its assumption: Exposure at its 240%
      Corrosive cap (abilities keep it up), Retaliation at its 420% cap (2,800+ shields), Duplicate (a
      base crit strikes again: chance 1 - (CC - 1) between 100% and 200%), Doughty (+1x Critical Damage
      per whole 10% Puncture status chance), Influence, Afflictions. Heavy / finisher / roll / kill
      arcanes (Animosity, Assimilation, Crescendo, Careen, Vortex) stay out. The search also builds
      around each arcane that changes how the weapon works (Influence needs an Electricity mod first).
- [x] Melee in the fight (src/fight.js, src/melee.js): a swing is the next attack of the stance combo
      (best damage per swing unless chosen), at the attack speed; the combo counter held at the
      initial combo, at 12x, or built up (each hit adds its multiplier; room clearing carries it);
      room clearing's enemies in the swing fall together at the follow through.
- [x] Melee Influence: buff uptime from the Electricity procs (20% chance of 18 s, steady share
      18l / (1 + 18l)); each elemental proc spreads its element's damage and status ticks to the close
      enemies, each taking 1 + clumping x (close - 1) copies; the damage spread to the room counts as
      more kills (at most the close enemies). The others' armor is the target's before any strip.
      Melee Afflictions: a swing with knockdown / launching hits adds 6 stacks to each status up, their
      ticks the average of that type's running ones.
- [x] The page: melee in the model; Stance combo, Combo counter (Initial / Max / Built up), In the
      swing, Within 20 m, Clumping %; "swings to kill" with the stance's timing disclosed on hover.
- [ ] In game: Melee Duplicate's yellow-crit chance, Doughty's steps, Influence's spread (does a spread
      proc spread again?), Afflictions' added ticks; Blood Rush additive vs multiplicative (the wiki's
      formula line and its example disagree; the example is used).
- [ ] Speed: a built-up room study went from 24-29 s to 8-11 s with identical results (targets within
      one combo tier aren't re-fought; tier volleys share their hit). Next: pre-screen the mechanic
      arcanes' searches and the riven candidates (both trade a little search quality), parallel workers.
- [x] Heavy attacks (the wiki's Heavy Attack and Melee Combo pages; the page's Attacks toggle, Heavy at
      tier): the weapon's heavy damage x the combo multiplier, one hit after the wind up (Wind Up Speed
      only), adding no combo. A built-up counter swings to the chosen tier, then spends the combo,
      keeping Heavy Attack Efficiency (cap 90%); spent Initial Combo returns at 40 a second. A held
      counter heavy attacks every time. True Steel's, Sacrificial Steel's and rivens' crit chance count
      twice; Melee Damage On Heavy Attack (Killing Blow, rivens) adds to Melee Damage; Melee Animosity
      adds 42% per normal hit since the last heavy, additive, all 420% when held. Assimilation stays
      out (needs a shield break).
- [ ] In game, heavy attacks: the recovery after a heavy (none counted), its follow through, and its
      forced procs by weapon type (none modelled; Afflictions doesn't trigger on it).
- [ ] Slams, glaive throws, gunblade shots; Gladiator set bonus; melee incarnons;
      zaws (parts) and Dark Split-Sword.

### Speed and pruning (the user's ideas, 2026-11-04; not started)

A study takes 1–6 s on most guns and up to 38 s on fast ones against full armor (Soma Prime: ~300
shots a fight, thousands of fights). In order:
- **Prune mods before the search.** Drop mods another beats outright, then score the rest once per
  weapon and setting and keep the best few. Elemental mods stay in (a combined element needs both
  halves, so either alone looks poor). Check that a pruned search finds the same builds as a full one.
- **Workers.** The candidates in a search round don't depend on each other: split them over the cores.
- **Precomputed results.** Ship the default settings' studies as data, so common weapons open at once.
- **GPU: not now.** The fight is a branching, per-shot loop with queues: it would need rewriting in
  WGSL and keeping in step with the JavaScript, and WebGPU isn't everywhere. Reconsider if the above
  isn't enough.
- **Score across levels** (from "overkill counts"): judge a build on a spread of target levels, not
  one, so statuses count for builds that one-shot this target. Costs a fight per level, so it wants
  the speed-ups first.

- **A faction's mix of units in room clearing** (the user, 2026-11-04). Twenty Heavy Gunners isn't a
  real room: use a composition per faction (fodder, heavies, the odd tough unit), each unit's share
  of the kills, health and armor. It also matters for weapons that hit several targets at once: they
  build kill stacks faster, and not every part of a hit gets every bonus (explosions don't count gun
  Condition Overload), so what a kill-stacking buff is worth depends on the room.

External buffs and companions are Phase 14. The first step there is buffs as pieces added to a
build's totals (Nourish's Viral makes a riven's Viral worth less without any change to the fight).

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