---
name: verify
description: Build, launch and drive bob to verify changes end-to-end in the browser.
---

# Verifying bob

React + Vite SPA with automated Node/TypeScript tests, full-schema PGlite
fixtures, Edge type checks and Playwright browser flows. Use the relevant tests
for a change, then the required CI gates in `.github/workflows/ci.yml`.

## Verification cadence

**CI stop:** run focused tests and impacted type checks only. The full suite (`npm test`), every CI/CAD/PostgreSQL/dependency workflow and every live model check run **only on the owner's direct request**; it is too slow and costly per PR. All test and live workflows are manual-only (`workflow_dispatch`): use Actions → choose workflow → Run workflow → select the exact review branch, and verify the commit SHA and outcomes. Opening a PR, pushing a commit or merging starts nothing: every workflow, including Pages publication (`deploy.yml`) and the CAD worker deploy (`modal-cad.yml`), is manual-only. Nothing that costs money runs without the owner's explicit OK.

## Automated checks

The full set below is for an explicit owner request only.

```bash
npm ci
npm run check:vocabulary
npm test
npm run check:edge
npm run build
```

SQL tests apply both migration directories in an isolated database. They do not
apply migrations to the hosted project. For a focused iteration, run
`node --import tsx --test tests/<relevant-file>.test.ts`.

## Browser verification

The in-memory demo (`npm run dev`, no Supabase environment variables) is useful
for legacy collaboration screens. Writes reset on reload. The current Project
Plan and other connected-only surfaces require live-mode fixtures; demo mode
is not evidence for their rendering, persistence or authority.

Use the installed Chrome/Chromium through `CHROME_PATH` (for example
`command -v google-chrome`). Do not run `playwright install`. If no browser is
installed, run the PR workflow and inspect its screenshots and failures; report
that distinction rather than claiming a local browser pass.

For the shared Plan, drawings and participant flows, follow CI:

```bash
VITE_SUPABASE_URL=https://pwa-proof.invalid VITE_SUPABASE_ANON_KEY=installation-test-only npm run build
CHROME_PATH=/path/to/chrome node scripts/check-project-work-browser.mjs
CHROME_PATH=/path/to/chrome node scripts/check-volunteer-browser.mjs
```

These scripts intercept requests with deterministic fixtures. They do not use a
real account or write to production. Pick other affected scripts from CI, run
scripts sharing a preview port sequentially, and inspect 320/390 px and desktop
screenshots in `test-results/`. Test success, empty/loading/error, retry,
navigation and reload where the changed feature promises them.

Routes are hash-based: `/#/`, `/#/areas`, `/#/tasks/:id`, `/#/artifacts`.
Close the Ask bob drawer before interacting with obscured controls. After a
modal submit, wait for it to close and for the refreshed data before asserting.
Real model/CAD generation and named participant acceptance are separate from
intercepted browser fixtures; use the owning release contract for those checks.
