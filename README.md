# Riven Calculator

A Warframe riven tool: stat ranges by weapon class and riven shape (`++`, `++-`, `+++`, `+++-`),
plus a goal calculator ("can a Felarx riven roll ≥ 70% Ammo Efficiency, and how likely is it?").

Static site with no build step and no dependencies. GitHub Pages serves the repo as-is.
See [PLAN.md](PLAN.md) for the roadmap.

## Run locally

ES modules don't load from `file://`, so serve the folder:

```
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Test

```
node --test
```

## Layout

| Path | Contents |
|---|---|
| `index.html`, `style.css` | Page shell and styles |
| `src/` | Browser modules (`main.js` entry; data, engine and UI added per phase) |
| `test/` | `node --test` suites |
| `tools/` | One-off scripts, e.g. regenerating the weapon list |
| `tools/data/` | Raw inputs for tools (`internal_names.csv`: internal path → display name) |
