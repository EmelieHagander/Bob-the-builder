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
| shared vocabulary, Area/Step/Task hierarchy and four project examples | `Docs/domain-dictionary.md` — shared meanings, generated runtime vocabulary and unified ownership model |
| five primary outcome use cases and their release acceptance | `Docs/user-stories.md` → Product mandate — 2026-09-24; UC-001–005 |
| baseline audit of Bob's actual context, models and tools | `Docs/bob-context-audit-2026-09-24.md` — dated findings before corrective implementation |
| dynamic project Steps, completion requirements, responsibility, evidence and replanning | `Docs/living-project-plan.md` — implemented foundation plus remaining product direction; hierarchy refinement in `Docs/domain-dictionary.md` |
| material-led assemblies, dynamic specifications and linked drawing/pick/Shopping use case | `Docs/material-assembly-use-case.md` — specified end-to-end target; not a complete implementation |
| reusable material/part definitions, dynamic profiles and catalog tools | `Docs/material-catalog.md` — slice A deployed 2026-09-22; live versioned material/part definitions and tools, no assembly geometry yet |
| generic CAD engine adapter / construction geometry seam | `Docs/cad-adapter.md` — hosted build123d/Open Cascade service, CAD assistant and versioned Artifact persistence; live design acceptance tracked separately |
| persistent site/building/space context and chat-driven narrative capture | `Docs/building-model.md` |
| function difficulty / scope buckets / first vertical slice | `Docs/function-scope.md` |
| original product intent and personas | `Docs/Mockups and initial plans/BuildCoord_PRD.md` |
| frontend/UI conventions | `Docs/ui-index.md` + `.claude/agents/vera.md` |
| documentation placement/precedence | `.claude/agents/archie.md` and `Docs/index.md` |
| data model, live/mock modes, auth membership | `db/README.md` + `src/data/database.ts` |
| share a Building or selected projects with a household / invite an existing friend | `Docs/user-stories.md` → BOB-US-038 / BOB-US-059 + `db/README.md` → Household and friend sharing |
| volunteers joining with only a name / optional allergies when food is planned | `Docs/user-stories.md` → BOB-US-038 + `db/README.md` → Name-only volunteer access |
| preserve old Areas through archive/restore | `db/README.md` → Area archive and volunteer drawing reader; `Docs/ui-index.md` |
| volunteer task drawing reader and its release boundary | `Docs/artifacts.md` → Volunteer task drawings; `db/README.md` → capability endpoints |
| deliberate organisation of older Tasks / preserved history | `Docs/living-project-plan.md` → Older work organisation and Area lifecycle |
| household physical-edit authority versus project collaboration | `Docs/building-model.md` → §11.1A + `db/README.md` → Effective authority and revocation |
| project image storage, attachments and manual task steps | `Docs/media-and-steps.md` |
| measurements, provenance history and existing components | `Docs/project-facts.md` |
| solution alternatives, evidence and selected target versions | `Docs/solutions.md` |
| drawings, source freshness, Project-home previews, work-Step links and exact lineage | `Docs/artifacts.md` |
| material requirements, deterministic quantities, stock/reuse and Shopping handoff | `Docs/material-planning.md` |
| Ask bob / OpenAI / scoped project lookup | `supabase/README.md` |
| Ask bob core/on-demand tools, phase preloads, exact schema loading and authority | `Docs/ask-bob-tools.md` |
| Ask bob runtime project-context selection / screen context / Project Catalog / Librarian | `Docs/ask-bob-context.md` + `Docs/ask-bob-context-implementation.md` + `supabase/README.md` |
| Ask bob bounded project writes, receipts and retry | `Docs/ask-bob-writes.md` |
| Ask bob conversation continuity, reset, provider context and compaction | `Docs/ask-bob-conversations.md` + `supabase/README.md` |
| how to verify a change | `.claude/skills/verify/SKILL.md` — automated tests, build and connected-mode browser fixtures |
| session-wide invariants | `CLAUDE.md` |

## Product

- `README.md` — current repository/app overview and implemented route/architecture summary.
- `Docs/v1-plan.md` — **current V1 release contract**: V1 thesis, release boundary, slice sequence, release gates and golden-path acceptance. It consumes the accepted user stories/inventory/scope without duplicating their detailed function lists.
- `Docs/function-inventory.md` — **current implementation audit**: capabilities that are built, partial or absent, plus cross-cutting correctness/foundation gaps. Use this for claims about what bob actually supports today.
- `Docs/user-stories.md` — **current canonical user-story landscape** for planning, media, measurements, drawings, material calculations, work guidance and the build-together collaboration loop, including specified household/friend-sharing goals in BOB-US-038 / BOB-US-059.
- `Docs/domain-dictionary.md` — **semantic owner and 2026-09-24 vocabulary review**: Project → optional Area → Step → Task; phases, physical place, underlag and collaboration stay distinct. Includes four scale cases, the baseline audit and the implemented ownership migration; compact shared entries reach Bob and specialists through their model-call context.
- `Docs/living-project-plan.md` — **living-plan behavior owner, foundation implemented**: completion requirements, evidence/responsibility, shared-current-state briefing, history and replanning. `Docs/domain-dictionary.md` owns the refined work hierarchy; the shared work model and parallel Step execution are implemented in PR #135.
- `Docs/material-assembly-use-case.md` — **specified end-to-end acceptance contract and proposed logical database design** for material/part reuse-or-create, typed dynamic properties, generic assemblies, derived drawing/part/pick outputs and many-to-many purchase allocation. Maps BOB-US-010 / BOB-US-018–026 to buildable acceptance cases and a staged implementation sequence. New names are proposals, not deployed tables or tools; existing domain owners remain authoritative for their shipped behavior.
- `Docs/material-catalog.md` — **slice A deployed implementation owner**: material/part definition kinds sharing version mechanics, dictionary/profile data, exact unit normalization, conservative ensure/revise, caller authority and catalog tool integration. Refines the usecase's proposed table names; no generic drawing/BOM/Shopping completion claim.
- `Docs/cad-adapter.md` — **CAD implementation owner**: hosted build123d/Open Cascade worker, bounded CAD assistant, versioned STEP/SVG artifacts and adapter failure boundary. Current project-home/work links are owned by `Docs/artifacts.md`; live model design quality, BOM and Shopping are separate acceptance concerns.
- `Docs/material-planning.md` — **deployed 4B2a + first 4B2b material-planning contract** for manual requirements, the narrow `stud_wall_net_area` deterministic quantity, stock/reuse allocation, transparent purchase arithmetic and explicit Shopping handoff. Broader BOM/fastener/consumable rules remain later scope until explicitly modelled.
- `Docs/building-model.md` — **current persistent physical-context contract**: Sites, Buildings, optional Levels, Spaces, BuildingElements, spatial relationships, project scope, uncertainty and physical-state history. It also owns the four top-down/bottom-up/isolation/evolution acceptance fixtures. The manual 2C foundation is implemented, deployed and live-verified; bounded chat intake is implemented on its separate, not-yet-deployed branch. The separate multi-floor coordinate-study branch consumes canonical identities through `Docs/artifacts.md`; broader geometry/import/AI fidelity remains planned.
- `Docs/function-scope.md` — **current next-phase function-scope contract**: D1–D5 difficulty, BASE / V0-AUTO / V0-CORE / V0-STRETCH / POST-V0 scope buckets, selected first vertical slice and its pre-build blockers. The `V0-*` names are scope labels created before the release was named V1; release naming is owned by `Docs/v1-plan.md`.
- `Docs/Mockups and initial plans/BuildCoord_PRD.md` — original BuildCoord product requirements, personas, stories and scope; historical product intent where not superseded by a later current contract.
- `Docs/Mockups and initial plans/bob-the-builder.html` — original visual/product mockup; use as historical composition reference, not runtime truth.

### Product-document status

`Docs/user-stories.md` owns **what users should be able to achieve** across the general project workflow. `Docs/domain-dictionary.md` owns **concept meanings and the refined work hierarchy**, separating implementation, baseline audit and remaining boundaries. `Docs/living-project-plan.md` owns **dynamic Steps, completion requirements, evidence, responsibility and replanning**; its versioned Steps now provide primary Task ownership. `Docs/material-assembly-use-case.md` owns the **specified cross-surface material/assembly success and failure path**, acceptance fixtures and proposed logical storage relationships; `Docs/material-catalog.md` owns the first definition-only implementation and its release limits, not the whole usecase. `Docs/building-model.md` owns the stable cross-project **physical-place model and its acceptance fixtures**. `Docs/function-inventory.md` owns the current **built/partial/gap audit**. `Docs/function-scope.md` owns **function difficulty/prioritisation and selected-slice detail**. `Docs/v1-plan.md` owns **the V1 release thesis, boundary, ordering and release gates**. The original PRD remains valuable product history, especially for the collaborative-build core (organiser, skilled/general/drop-in volunteers, food manager, areas/tasks/materials/build days).

### Physical place vs project organisation

The original product uses `Area` as a project-scoped physical/work zone. The persistent building model is a later product decision and does not rewrite that history. For current work, keep the distinction explicit:

- `Area` — project work-zone container used by current collaboration/runtime flows;
- `Site` / `Building` / `Space` / `BuildingElement` — implemented persistent physical context that may be reused across projects;
- Areas may map to physical targets through the shipped backend relation; the dedicated Area-side mapping editor remains a narrow UI follow-up, and the entities must not be silently conflated.

See `Docs/building-model.md` for the owning contract and `Docs/v1-plan.md` for delivery order.

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
- `Docs/material-assembly-use-case.md` — specified Bob-driven material → assembly → drawing/list → stock/pick/Shopping journey and change/recovery acceptance; no whole-runtime implementation claim.
- `db/README.md` → Household and friend sharing — deployed shared household/friend dependencies, explicit project access sources, invitation lifecycle, revocation and legacy account isolation; real participant acceptance is tracked separately.
- `Docs/building-model.md` — deployed persistent physical context that project/Area flows may target, with broader geometry/import/AI fidelity still planned.
- `Docs/function-scope.md` — function prioritisation and selected first vertical slice.
- `src/pages/People.tsx` — crew, skills and dietary context.
- `src/pages/Events.tsx` + `src/pages/EventDetail.tsx` — build-day planning and attendance.
- `src/pages/Today.tsx` — day-of task surface.
- `src/pages/Announcements.tsx` — project-wide updates.
- `src/pages/Food.tsx` + `src/pages/FoodShopping.tsx` — meal/allergy coordination.
- `src/pages/AreaDetail.tsx` — tasks, materials, crew and reference-image surface.
- `src/pages/Solutions.tsx` — manual alternatives and exact selected project target.
- `src/pages/Artifacts.tsx` — plans/drawings, the parametric 2D editor and exact target/measurement lineage; implementation vs hosted state is recorded in `Docs/artifacts.md`.

When a new major journey moves toward implementation, give it one canonical success/failure path rather than encoding the contract only in component behavior.

## Data / auth

- `db/README.md` — database mapping, auth/membership and migration guidance; owns the household/friend-sharing authority extension and its account-isolation gate, with deployment status stated explicitly.
- `db/migrations/` — canonical applied-schema intent; never rewrite an already-applied shared migration.
- `supabase/migrations/` — versioned migrations, applied after the legacy database bootstrap; preserve CLI/managed-ledger identities.
- `src/data/provenance.ts` — minimum V1 truth vocabulary and answer-source envelope.
- `Docs/material-assembly-use-case.md` → §4–9 — proposed relational identities, versioned dynamic specifications, assembly/source links, cut/pick separation and Shopping allocation evolution. This is a design target, not applied DDL; shipped schema truth remains in migrations and `db/README.md`.
- `Docs/material-catalog.md` + `supabase/migrations/20260921095817_material_catalog.sql` — deployed first catalog implementation schema/authority; hosted release evidence is recorded in the owner document. `catalog_items.kind` keeps material and part definitions distinct while sharing immutable revision mechanics.
- `Docs/building-model.md` — product/domain owner for the deployed manual 2C persistent physical model; `db/README.md` maps its current schema/RLS/commands, while broader future fidelity remains specified here.
- `Docs/media-and-steps.md` — owning media and manual-step contract: private files, same-project attachments, lifecycle/recovery, task checks and runtime consumption for milestones 1A/1B.
- `src/data/projectFiles.ts` — storage and step commands behind `database.ts`.
- `Docs/project-facts.md` — owning manual measurement/component contract: truth states, exact length units, revision history, source images, authority and recovery for milestones 2A/2B.
- `src/data/projectFacts.ts` — measurement/component reads and commands behind `database.ts`.
- `Docs/solutions.md` — owning alternative/revision, measurement-evidence and project-target decision contract for manual 3A.
- `src/data/solutions.ts` — solution and target reads/commands behind `database.ts`.
- `Docs/artifacts.md` — owning manual 4A, deployed narrow 4B1 geometry and implementation-branch parametric box and linked two-room/placement contracts, including exact target/solution/physical/measurement lineage.
- `src/data/artifacts.ts` — project-artifact reads and commands behind `database.ts`.
- `Docs/material-planning.md` + `src/data/materialPlanning.ts` — deployed manual 4B2a receiver and first narrow 4B2b deterministic material quantity, using the existing stock/reuse/Shopping path behind `database.ts`.
- `src/data/types.ts` — current frontend domain types.
- `src/data/database.ts` — single UI data-access seam, live/mock behavior and app-facing commands.
- `src/data/sharing.ts` — guarded household/project/friend-sharing adapter behind `database.ts`; its presence does not establish hosted RPC availability.
- `src/data/volunteers.ts` + `src/pages/VolunteerProject.tsx` — deployed project-only guest capability adapter and name-only participant view; no Auth account registration.

## AI / Ask bob

- `supabase/README.md` — current provider path, setup and the Slice 0 project-lookup contract (allowed datasets/fields, authority and result semantics).
- `Docs/ask-bob-tools.md` — **tool-system owner**: core/on-demand tiers, actual Project-phase preloads, browsable directory, exact schema/guide hydration, caller authority and execution fences. Supersedes fixed tool-array loading; does not claim the generic drawing engine is built. PR #91 owns release evidence.
- `Docs/material-catalog.md` + `supabase/functions/_shared/material-catalog.ts` — discoverable material/part search, exact profile reads and definition saves through the existing tool/claimed-turn seam; source implementation, not a new standalone provider or an assembly generator.
- `Docs/ask-bob-context.md` — **specified / pre-build** screen-aware runtime project-context contract: client navigation pointers, server-hydrated Current View, hierarchical Project Catalog, cheap category/scope + Process Lens routing, deterministic bounded manifests/open-by-ref, image-on-demand and Project Librarian research. Implemented image context is owned by `Docs/media-and-steps.md`; tool discovery is owned separately above.
- `Docs/ask-bob-context-implementation.md` — **planned / pre-build** technical landing sequence for that contract: frontend surface snapshot, strict screen-pointer wire shape, per-surface hydration, backend module seams, additive catalog RPC, adapters, router/lens shadow mode, list/open rollout, image vision, Librarian, deployment/rollback and verification gates.
- `Docs/ask-bob-conversations.md` — **conversation state owner**: private transcript, working memory, explicit reset, durable background turns and server-driven continuation; provider erasure remains planned; per-user/project privacy and release gates.
- `supabase/functions/_shared/project-lookup.ts` — bounded briefing/lookup dispatcher and source metadata.
- `supabase/functions/_shared/project-answer.ts` — scoped research/write loop, assembled tool surface and fixed cross-tool truth rules.
- `supabase/functions/_shared/project-tools/` — caller-scoped policy reader, exact handler registration and per-turn discovery/loading/dispatch.
- `supabase/functions/_shared/ask-openai.ts` — direct OpenAI backend.
- `supabase/functions/_shared/serve-bob.ts` and `supabase/functions/ask-bob/` — authenticated OpenAI endpoint for Bob. The old `ask-launchpad/` contains only a retirement response.
- `src/components/AskBob.tsx` — frontend interaction contract for Ask bob.

## Quality / runtime

- `.claude/skills/verify/SKILL.md` — current browser-verification procedure and known interaction gotchas.
- `package.json` — current build/typecheck commands.
- `tests/` — local Postgres/RLS, request/tool and project-response isolation tests.
- `Docs/slice-0-verification.md` — Slice 0 evidence, limits and remaining release gates.
- `Docs/foundation-verification.md` — media/steps, measurements/components, solution/target, plans/drawings, deterministic material planning and persistent building-context release evidence, deployed migrations, live Auth/PostgREST/Storage checks and limitations.

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

September 2026 context extension: `ask-bob-conversations.md` supersedes its earlier provider-only memory plan with five full recent messages, a private incremental older brief, exact history retrieval, paged construction records and compact/expandable chat. Deployment evidence belongs in the merged release PR, not a source-only status claim.
