# bob — documentation index

> Navigation only. Domain truth belongs in the linked owner document/code. When sources disagree, use the precedence rules below and update stale guidance rather than keeping two current truths.

## Start here

| I need to understand… | Start with |
|---|---|
| what bob is / current app shape | `README.md` |
| original product intent and personas | `Docs/Mockups and initial plans/BuildCoord_PRD.md` |
| frontend/UI conventions | `Docs/ui-index.md` + `.claude/agents/vera.md` |
| documentation placement/precedence | `.claude/agents/archie.md` |
| data model, live/mock modes, auth membership | `db/README.md` + `src/data/database.ts` |
| Ask bob / Launchpad / OpenAI seams | `supabase/README.md` |
| how to verify a change | `.claude/skills/verify/SKILL.md` |
| session-wide invariants | `CLAUDE.md` |

## Product

- `README.md` — current repository/app overview and implemented route/architecture summary.
- `Docs/Mockups and initial plans/BuildCoord_PRD.md` — original BuildCoord product requirements, personas, user stories and scope.
- `Docs/Mockups and initial plans/bob-the-builder.html` — original visual/product mockup; use as historical composition reference, not runtime truth.

### Product-document status

The original PRD remains useful product intent, especially for the collaborative-build core (organiser, skilled/general/drop-in volunteers, food manager, areas/tasks/materials/build days). The runtime has evolved since that draft. New product decisions should be captured in a current owning product contract rather than silently editing historical intent into unrelated files.

## UI / design

- `Docs/ui-index.md` — frontend navigation, ownership and review contract.
- `src/theme.css` — canonical current design tokens, global layout primitives and responsive rules.
- `src/components/Layout.tsx` — app shell, desktop sidebar, mobile navigation and Ask bob entry point.
- `src/components/ui.tsx` — shared visual primitives.
- `src/components/form.tsx` and `src/components/Modal.tsx` — shared form/modal machinery.
- `.claude/agents/vera.md` — Vera's frontend/UX stewardship contract.

## Interaction / collaboration

Current collaboration behavior is primarily expressed in runtime code plus the original PRD:

- `src/pages/People.tsx` — crew, skills and dietary context.
- `src/pages/Events.tsx` + `src/pages/EventDetail.tsx` — build-day planning and attendance.
- `src/pages/Today.tsx` — day-of task surface.
- `src/pages/Announcements.tsx` — project-wide updates.
- `src/pages/Food.tsx` + `src/pages/FoodShopping.tsx` — meal/allergy coordination.
- `src/pages/AreaDetail.tsx` — tasks, materials, crew and reference-image surface.

When a new major journey is specified, give it one canonical success/failure path rather than encoding the contract only in component behavior.

## Data / auth

- `db/README.md` — database mapping, auth/membership and migration guidance.
- `db/migrations/` — canonical applied-schema intent; never rewrite an already-applied shared migration.
- `src/data/types.ts` — current frontend domain types.
- `src/data/database.ts` — single UI data-access seam, live/mock behavior and app-facing commands.

## AI / Ask bob

- `supabase/README.md` — AI backend modes and runtime setup.
- `supabase/functions/_shared/bob-context.ts` — project briefing supplied to the AI.
- `supabase/functions/_shared/ask-openai.ts` — direct OpenAI backend.
- `supabase/functions/_shared/launchpad.ts` and `supabase/functions/ask-launchpad/` — Launchpad seam.
- `src/components/AskBob.tsx` — frontend interaction contract for Ask bob.

## Quality / runtime

- `.claude/skills/verify/SKILL.md` — current browser-verification procedure and known interaction gotchas.
- `package.json` — current build/typecheck commands.

## Steward files

- `.claude/agents/vera.md` — stable Vera contract.
- `.claude/agents/vera-learnings.md` — durable frontend/UX lessons.
- `.claude/agents/vera-findings.md` — unresolved frontend/UX drift or follow-ups.
- `.claude/agents/archie.md` — stable Archie contract.
- `.claude/agents/archie-learnings.md` — durable documentation lessons.
- `.claude/agents/archie-findings.md` — unresolved documentation/product-contract drift.

## Precedence

When sources conflict, use this order:

1. **Verified runtime behavior + current schema/code** for claims about what is built today.
2. **Later explicit canonical decision** in the relevant owning contract.
3. **Domain-specific current contract** (data/auth/UI/AI/etc.).
4. **Original PRD** for product intent not explicitly superseded.
5. **Mockups/sample content** for visual or illustrative intent only.

A runtime bug is not a new product decision: fix the bug against the owning contract. Conversely, do not preserve stale documentation merely because old code still happens to implement it.

## Documentation rule

**One truth, one home.** Before adding a new markdown file, search this index and the repository for the existing owner. Extend the owner when the concern belongs there; split only when the new file has a stable independent job, then add it here.
