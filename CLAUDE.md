# Working on this repo

- **Commit and push straight to `main`. Don't make branches or pull requests.** One developer:
  branches only duplicate work. GitHub Pages serves `main` as-is, so what's pushed is live. The
  pre-push hook (`.githooks/pre-push`) runs `npm test` and stops a failing push; don't skip it.
- Plan and history: `PLAN.md` (open tasks), `docs/history.md` (what's done and why).
