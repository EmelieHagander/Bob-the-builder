# Archie — durable learnings

> Reusable documentation lessons discovered while working on bob. Promote recurring rules only; unresolved drift belongs in findings.

## 2026-09-09 — Keep the existing `Docs/` casing

**Lesson:** bob already uses a capitalised `Docs/` directory.

**Rule:** keep current repo casing rather than introducing a parallel lowercase `docs/` tree just because a reusable template used that spelling.

## 2026-09-09 — Historical product intent and current runtime are different truth classes

**Lesson:** `Docs/Mockups and initial plans/BuildCoord_PRD.md` remains valuable for product intent/personas, but bob has evolved materially in code and README since the draft.

**Rule:** do not rewrite history or pretend the PRD is a complete current implementation contract. Use explicit precedence and create/update a current owner when a new product decision needs to guide implementation.

## 2026-09-09 — Technical truth already has good local owners

**Lesson:** bob has useful focused owners: `db/README.md` for database/auth setup, `supabase/README.md` for AI seams, `src/data/database.ts` for the app-facing data boundary, and `.claude/skills/verify/SKILL.md` for current verification.

**Rule:** documentation should route to these owners instead of duplicating their details into a mega design document.

## 2026-09-09 — Repo memory should replace chat memory for durable decisions

**Lesson:** bob's next product phase is being discovered conversationally (photos, measurements, drawings, material calculation, step guidance) while the existing repo reflects an earlier coordination-first phase.

**Rule:** once a decision becomes implementation-driving, capture it in a canonical repo contract and link it from `Docs/index.md`; do not rely on old chat transcripts as the only source.
