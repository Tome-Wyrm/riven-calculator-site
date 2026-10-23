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
- [ ] Skeleton: `index.html`, `style.css`, `src/`, `test/`, `.gitignore`, short `README.md`
- [ ] Create the GitHub repo, push, and enable Pages (`main` / root). Do this early so every
      later phase is visible live.

### Phase 1 — Stat data (`src/data/stats.js`)
- [ ] Define the stat schema: `id`, display name, prefix/suffix, `b` per class
      (rifle/shotgun/pistol/archgun/melee, `null` = not rollable), `unit`
      (`pct` | `pctNeg` | `mult` | `sec` | `m` | `flat`), `polarity`
      (`both` | `posOnly` | `negOnly`), `spliced: boolean`, splice recipe(s)
- [ ] Enter the 32 ordinary + 18 spliced coefficients from the wiki tables
- [ ] Shape table (`L` bonus/malus) as data, not code
- [ ] **Reconcile discrepancies** between the wiki footnotes and the spreadsheet before trusting either:
  - Wiki marks Damage/Melee Damage "positive only", but the sheet shows negatives
  - Sheet shows no negative for melee Attack Speed or Initial Combo
  - Sheet merges "Additional Combo Count Chance" (+) and "Chance to Gain Combo Count" (−)
    into one row. These are different stats with different `b`, so keep them separate.

### Phase 2 — Math engine (`src/engine.js`, pure functions, no DOM)
- [ ] `rollValue(stat, class, shape, rank, sign, u)` → raw `v` (fround, step by step)
- [ ] `range(...)` → `{min, max}` for u = 0 and u = 1
- [ ] `format(stat, v)` → display string per unit (handles the `−100v` and `×(1+v)` cases)
- [ ] `solveU(stat, class, shape, rank, sign, displayTarget)` → the u that hits a displayed value
- [ ] `evaluateGoal(goal)` for comparators `≥`, `≤`, `≈`, returning per shape:
      feasible?, value range, required u-interval, probability, best achievable / closest value
- [ ] **Golden tests:** every cell of both screenshots (`++-`, `+++-`), plus the three examples above.
      Hand-generate `++` / `+++` expectations from the formula, or from more sheets if you have them.

### Phase 3 — Range viewer (spreadsheet replacement)
- [ ] Controls: weapon class, shape (`++`, `++-`, `+++`, `+++-`), rank (0–8, default 8)
- [ ] Table: stat | positive range | negative range; hide stats the class can't roll
- [ ] Separate sections for ordinary / faction / spliced stats (matching the sheet's layout)
- [ ] Optional "compare shapes" mode: one stat × all 4 shapes side by side

### Phase 4 — Goal calculator (the new feature)
- [ ] Inputs: class (or weapon, Phase 5), stat, comparator (`at least` / `at most` / `closest to`), target value
- [ ] Output: per-shape result card/table (✓/✗, range, required roll %, chance), best shape highlighted
- [ ] Explain the "why" in one line (e.g. "needs a top 26% roll; only `++-` reaches it")
- [ ] Input validation: units shown next to the target box, sign handling for negative-only stats

### Phase 5 — Weapon lookup (Felarx → Shotgun)
- [ ] A one-off script in `tools/` (run by hand) pulls the weapon list from WFCD
      `warframe-items` or the Public Export and writes a compact `src/data/weapons.js`
      (`{name: class}`). That snapshot is committed, so there is **no runtime fetch**.
      Re-run it when new weapons release.
- [ ] Map weapon → riven class, including special cases: Kitguns → Pistol coefficients,
      Sentinel/Robotic weapons → associated class, Zaws → Melee, archgun variants
- [ ] Display quirks: Fire Rate ×2 for bows, melee Critical Chance ×2 on heavy attacks
- [ ] (Later) per-weapon IPS eligibility (<25% physical type can't roll it). Exceptions are case
      by case, so maybe just show a warning.

### Phase 6 — Polish
- [ ] Shareable state in the URL hash (`#class=shotgun&shape=++-&stat=ammoEff&op=gte&t=70`)
- [ ] Responsive layout (phone-friendly); light/dark following `prefers-color-scheme`
- [ ] Footer: data source + "last updated" for the weapon snapshot

### Stretch (not planned yet)
- Riven grader: enter an existing riven's values → back-solve u for each stat ("roll quality")
- Multi-stat goals (e.g. ≥X CC **and** ≥Y CD) with combined probability
- Stat-pool odds: chance of the stats appearing at all when cycling, plus Kuva cost estimates
- Splice planner: which pair of traits to splice for a target spliced value

---

## Open questions (decide before Phase 2)

1. **Are rolls continuous or discrete?** The wiki says the value is "a base 30 integer mapped onto
   that range", which suggests 31 discrete steps. That changes the probability output slightly
   and changes "closest to" into "nearest achievable step". Needs confirming.
2. **Spliced-stat probability.** A spliced trait takes the *higher* u of its two parents, so
   P(u ≥ x) = 1 − x² rather than 1 − x (for Ammo Efficiency ≥ 70%: ~46% instead of ~26%).
   The wiki also says a negative parent's "true" u is used, which may make the math more involved.
   Do we show both numbers, or the spliced one only?
3. **Rank selector:** keep it (the sheet has one) or assume rank 8 always?
4. **Repo name / visibility:** the Pages URL will be `https://<user>.github.io/<repo>/`.
   GitHub Pages needs a public repo unless you're on a paid plan.
