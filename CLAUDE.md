# CLAUDE.md — bob

> **What this repo is:** bob is a mobile-friendly build companion for planning and coordinating real renovation and community-build projects. It helps organisers, skilled builders, volunteers and food coordinators share one project truth and know what needs doing.
>
> **Audience:** coding/agent sessions working in this repository.
>
> **Living contract:** keep this file short. Detailed truth belongs in the owning documents linked from `Docs/index.md`.

## Session start

1. Read `Docs/index.md`.
2. Classify the work:
   - UI/frontend → read `.claude/agents/vera.md`, `Docs/ui-index.md`, `src/theme.css`, and the relevant page/component.
   - documentation/product-contract work → read `.claude/agents/archie.md` and `Docs/index.md`.
   - data/auth/RLS → read `db/README.md` and the relevant migrations/data layer.
   - AI / Ask bob → read `supabase/README.md`, `src/components/AskBob.tsx`, and the shared AI context code.
   - verification → read `.claude/skills/verify/SKILL.md`.
3. Inspect current runtime/code before changing a contract. Do not work from remembered chat context when a canonical repo source exists.

## Product north stars

- **Build together.** bob exists to make a real build understandable and actionable for the people doing it together.
- **The next useful action should be obvious.** On build days, a participant should quickly understand what they are doing, with whom, and what they need.
- **Unknown stays unknown.** AI may analyse, explain and propose, but must not disguise assumptions as measured or verified project truth.
- **Practical beats performative.** Mobile, field use, legibility, checklists and recovery matter more than decorative complexity.
- **One shared project truth.** Plans, people, materials, events and progress should converge rather than fragment into parallel sources.

## Hard invariants

- Screens/components read and write project data through `src/data/database.ts`; do not import mock data directly into UI.
- Authentication identity is not the same thing as project authority. Normal-user access must be enforced by backend/RLS/domain rules, not only hidden or disabled controls.
- Project context must remain explicit. A user must not receive or mutate data from a different project because a helper selected an arbitrary project row.
- `src/theme.css` is the current canonical visual-token source. Do not create a parallel color/control/card language casually.
- Mobile and on-site use are first-class. Preserve reachable controls, generous touch targets, readable states and the mobile navigation contract.
- A file being uploaded or a migration being committed does not prove runtime consumption. Verify the browser/runtime path that the feature promises.
- High-consequence AI output is a proposal/assessment unless the product contract explicitly says otherwise and provenance is preserved.

## Steward routing

- **Vera** — Frontend & UX Steward. Owns rendered UI quality, reuse, responsive behavior, accessibility, honest UI state and design-system consistency. Start at `.claude/agents/vera.md`.
- **Archie** — Documentation Steward. Owns documentation placement, indexes, precedence, supersession and duplicate-current-truth prevention. Start at `.claude/agents/archie.md`.

The stewards review and route work; they do not invent authority outside their domain.

## Before saying done

1. Did I use the owning contract instead of creating a second source of truth?
2. If state is persisted, is it actually read back after navigation/reload where promised?
3. Is authorization enforced at the real backend boundary?
4. Are unknown, loading, failure and partial-success states honest?
5. Did I reuse bob's existing data/UI seams instead of creating a parallel implementation?
6. For UI changes, did I follow Vera's review order and run the relevant browser verification?
7. For documentation changes, did I update the owning index and mark superseded guidance clearly?
8. Am I describing verified runtime truth, or merely planned/committed state?
