# bob — documentation index

> Navigation only. Domain truth belongs in the linked owner document/code. When sources disagree, use the precedence rules below and update stale guidance rather than keeping two current truths.

## Start here

| I need to understand… | Start with |
|---|---|
| what bob is / current app shape | `README.md` |
| install Bob on a phone / app icons / updates | `README.md` → Install Bob on a phone |
| current V1 release goal / scope / slice sequence | `Docs/v1-plan.md` |
| what is actually built vs missing today | `Docs/function-inventory.md` |
| current user goals / next-phase product stories | `Docs/user-stories.md` |
| function difficulty / scope buckets / first vertical slice | `Docs/function-scope.md` |
| original product intent and personas | `Docs/Mockups and initial plans/BuildCoord_PRD.md` |
| frontend/UI conventions | `Docs/ui-index.md` + `.claude/agents/vera.md` |
| documentation placement/precedence | `.claude/agents/archie.md` |
| data model, live/mock modes, auth membership | `db/README.md` + `src/data/database.ts` |
| Ask bob / Launchpad / OpenAI seams / scoped project lookup | `supabase/README.md` |
| how to verify a change | `.claude/skills/verify/SKILL.md` |
| session-wide invariants | `CLAUDE.md` |

## Product

- `README.md` — current repository/app overview and implemented route/architecture summary.
- `Docs/v1-plan.md` — **current V1 release contract**: V1 thesis, release boundary, golden-path acceptance, slice sequence and release gates. It consumes the accepted user stories/inventory/scope without duplicating their detailed function lists.
- `Docs/function-inventory.md` — **current implementation audit**: capabilities that are built, partial or absent, plus cross-cutting correctness/foundation gaps. Use this for claims about what bob actually supports today.
- `Docs/user-stories.md` — **current canonical user-story landscape** for planning, media, measurements, drawings, material calculations, work guidance and the existing build-together collaboration loop.
- `Docs/function-scope.md` — **current next-phase function-scope contract**: D1–D5 difficulty, BASE / V0-AUTO / V0-CORE / V0-STRETCH / POST-V0 scope buckets, selected first vertical slice and its pre-build blockers. The `V0-*` names are scope labels created before the next release was named V1; release naming is owned by `Docs/v1-plan.md`.
- `Docs/Mockups and initial plans/BuildCoord_PRD.md` — original BuildCoord product requirements, personas, user stories and scope; historical product intent where not superseded by a later current contract.
- `Docs/Mockups and initial plans/bob-the-builder.html` — original visual/product mockup; use as historical composition reference, not runtime truth.

### Product-document status

`Docs/user-stories.md` owns **what users should be able to achieve**. `Docs/function-inventory.md` owns the current **built/partial/gap audit**. `Docs/function-scope.md` owns **function difficulty/prioritisation and the first slice contract**. `Docs/v1-plan.md` owns **the V1 release thesis, boundary, ordering and release gates**. The original PRD remains valuable product history, especially for the collaborative-build core (organiser, skilled/general/drop-in volunteers, food manager, areas/tasks/materials/build days).

## UI / design

- `Docs/ui-index.md` — frontend navigation, ownership and review contract.
- `src/theme.css` — canonical current design tokens, global layout primitives and responsive rules.
- `src/components/Layout.tsx` — app shell, desktop sidebar, mobile navigation and Ask bob entry point.
- `src/components/ui.tsx` — shared visual primitives.
- `src/components/form.tsx` and `src/components/Modal.tsx` — shared form/modal machinery.
- `.claude/agents/vera.md` — Vera's frontend/UX stewardship contract.

## Interaction / collaboration

Current collaboration behavior is primarily expressed in runtime code plus the current product contracts:

- `Docs/v1-plan.md` — V1 release journey and integration boundary.
- `Docs/function-inventory.md` — current implementation coverage and known gaps.
- `Docs/user-stories.md` — current desired journeys and acceptance intent.
- `Docs/function-scope.md` — function prioritisation and selected first vertical slice.
- `src/pages/People.tsx` — crew, skills and dietary context.
- `src/pages/Events.tsx` + `src/pages/EventDetail.tsx` — build-day planning and attendance.
- `src/pages/Today.tsx` — day-of task surface.
- `src/pages/Announcements.tsx` — project-wide updates.
- `src/pages/Food.tsx` + `src/pages/FoodShopping.tsx` — meal/allergy coordination.
- `src/pages/AreaDetail.tsx` — tasks, materials, crew and reference-image surface.

When a new major journey moves toward implementation, give it one canonical success/failure path rather than encoding the contract only in component behavior.

## Data / auth

- `db/README.md` — database mapping, auth/membership and migration guidance.
- `db/migrations/` — canonical applied-schema intent; never rewrite an already-applied shared migration.
- `src/data/types.ts` — current frontend domain types.
- `src/data/database.ts` — single UI data-access seam, live/mock behavior and app-facing commands.

## AI / Ask bob

- `supabase/README.md` — AI backend modes, runtime setup and the specified Slice 0 project-lookup contract (allowed datasets/fields, authority and result semantics).
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
2. **`Docs/function-inventory.md`** as the maintained audit summary of that runtime.
3. **Later explicit canonical decision** in the relevant owning contract.
4. **`Docs/v1-plan.md`** for the current V1 release boundary/order/gates.
5. **`Docs/function-scope.md`** for function difficulty/prioritisation and selected-slice detail.
6. **`Docs/user-stories.md`** for current user-goal intent and acceptance intent.
7. **Original PRD** for product intent not explicitly superseded.
8. **Mockups/sample content** for visual or illustrative intent only.

A runtime bug is not a new product decision: fix the bug against the owning contract. Conversely, do not preserve stale documentation merely because old code still happens to implement it.

## Documentation rule

**One truth, one home.** Before adding a new markdown file, search this index and the repository for the existing owner. Extend the owner when the concern belongs there; split only when the new file has a stable independent job, then add it here.
