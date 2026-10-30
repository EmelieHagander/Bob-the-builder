# bob — documentation index

> Navigation only. Domain truth belongs in the linked owner document/code. When sources disagree, use the precedence rules below and update stale guidance rather than keeping two current truths.

- [Shared AI background calls](shared-ai-background.md) — opt-in Responses jobs, webhook recovery, content-free failure diagnostics, app receivers and Bob unread delivery; [failed drawing jobs](ask-bob-conversations.md#failed-drawing-background-jobs--2026-10-12) own failure status/notices; full model/CAD acceptance remains.

## Start here

- [Cost and retrieval analysis, 2026-10-28](archive/bob-cost-and-retrieval-audit-2026-10-28.md)
  — dated findings behind the owner-approved [coherent construction operations](ask-bob-tools.md#coherent-construction-work).
  [Technical installation](foundation-verification.md#construction-work-2026-10-28)
  and [one paid test](foundation-verification.md#construction-work-paid-2026-10-29)
  are separate: width change passes, final drawing fails. The
  [CAD schema correction and runtime-fault recovery are installed](foundation-verification.md#cad-runtime-recovery-2026-10-29).
  [Creation preparation and scoped read recovery are installed](foundation-verification.md#creation-preparation-2026-10-29);
  [the paid run after it failed acceptance](foundation-verification.md#construction-work-paid-run3-2026-10-29) and
  [controlled completion, exact lookup and write state are installed](foundation-verification.md#controlled-completion-2026-10-29);
  [the seven remaining causes are closed and installed](foundation-verification.md#open-issues-closed-2026-10-29).
  [Owner follow-ups before the next paid run are installed](foundation-verification.md#follow-ups-2026-10-29), and an
  [independent material-table review](archive/material-tables-review-2026-10-29.md) shaped
  [follow-up 1, installed](foundation-verification.md#follow-up-1-2026-10-29).
  [State](bob-delivery-flow.md#state) owns the next release
  and remaining acceptance. The retrieval helper remains deferred.

- [Bob cost corrections, 2026-10-28](foundation-verification.md#bob-cost-controls-2026-10-28)
  — approved six catalog-owned core tools, GPT-5.4 medium and same-construction
  source reconciliation; technical installation and live acceptance are separate.

- [Selective tools and methods](ask-bob-tools.md#selective-methods-and-tools--prepared-2026-10-19)
  and [canonical repetition / natural pieces](artifacts.md#compact-repetition-and-natural-pieces--prepared-2026-10-19)
  — construction/tool support is technically installed; [hosted release evidence](foundation-verification.md#hosted-bob-release--2026-10-19)
  supersedes the dated preparation notes. Remaining model acceptance and the
  next FORM increments live in [State](bob-delivery-flow.md#state).

| I need to understand… | Start with |
|---|---|
| what bob is / current app shape | `README.md` |
| install Bob on a phone / app icons / updates | `README.md` → Install Bob on a phone |
| current V1 release goal / scope / slice sequence | `Docs/v1-plan.md` |
| what is actually built vs missing today | `Docs/function-inventory.md` |
| current user goals / next-phase product stories | `Docs/user-stories.md` |
| shared vocabulary, Area/Step/Task hierarchy and four project examples | `Docs/domain-dictionary.md` — shared meanings, generated runtime vocabulary and unified ownership model |
| FORM: conversational 2D/3D feedback, detailed Construction and final drawings/lists | [Flow](bob-delivery-flow.md#form-flow) — specified decision 2026-10-27: [natural conversation without approval buttons](bob-delivery-flow.md#form-dialogue), [separate technical responsibility](bob-delivery-flow.md#form-technical-checks), early illustration and exact-model 3D preview; [implementation order and acceptance](bob-delivery-flow.md#form-next). The first [Solution concept model](solutions.md#early-concept-geometry-form--source-implementation-2026-10-26) is technically installed with [release evidence](foundation-verification.md#form-concept-loop--local-synthetic-verification-2026-10-26); [2D conversational feedback](solutions.md#form-shown-feedback), scoped refinement and durable checks are technically installed with [full CI, browser and hosted evidence](foundation-verification.md#form-hosted-release-2026-10-27); the first exact box-solid [3D preview is installed](foundation-verification.md#form-construction-preview-2026-10-27), while real-model acceptance, final delivery and CAD-review replacement remain. The [dated proposal](form-design-loop-review-2026-10-26.md) remains historical input |
| planned PR for smoother task edits, status, completion and model upgrade | [Task-work PR plan](bob-delivery-flow.md#bob-task-pr-plan) — specified 2026-10-17; [investigation and status proof](foundation-verification.md#bob-task-investigation-2026-10-17) distinguish observed behavior from remaining acceptance |
| Bob plans the work himself, designs in parts and uses more code checks with targeted AI | [Next-level implementation plan](bob-delivery-flow.md#form-next) and [active next work](bob-delivery-flow.md#state). [Scoped checkpoints](solutions.md#form-refinement), [property checks](artifacts.md#form-scoped-checks), [shown-model decisions](solutions.md#form-shown-feedback) and the exact 3D box preview are technically installed. The [targeted CAD review](cad-adapter.md#targeted-cad-review), [`read_task_sources`](ask-bob-context.md#read-task-sources) and [small source reader](ask-bob-context.md#source-reader) are installed but inactive. The [first paid baseline exposed cost and revision/identity problems](foundation-verification.md#form-package5-release-2026-10-28); further paid comparison is paused. Broader semantic requirement proof, unsupported geometry and complete delivery remain |
| active memory, autonomous continuation and removed Bob application quotas | [Conversation owner](ask-bob-conversations.md#active-memory-and-continued-work--2026-10-17) — policy pinning, genuine blockers, cancellation and session renewal |
| resume without historical main-loop replay, self-contained prompts and the Launchpad migration | [Migration contract](ask-bob-conversations.md#launchpad-migration) — PR1 merged and technically deployed through #281; member/model and long-image acceptance remain open; full CI after final-stage behavior acceptance; [2026-10-19 audit and release readback](bob-launchpad-migration-audit-2026-10-19.md) record CPU/replay/cache evidence and actual Launchpad differences |
| job tools native again, only late-loaded tools behind use_tool (after paid box run 5 failed) | [Tool sheets version 2](ask-bob-tools.md#tool-sheets-v2) — built 2026-10-30, not installed; [run 5 evidence](foundation-verification.md#box-paid-run5-2026-10-30) |
| prompt ordered by how often parts change, locked project snapshot and a stair of summaries with sources | [Prompt tiers and memory stair](ask-bob-conversations.md#memory-stair) — installed 2026-10-30; [installation record](foundation-verification.md#memory-stair-install-2026-10-30) |
| memory/prompt strategy, hybrid recall and long-work context checkpoints | [Context strategy](ask-bob-conversations.md#context-strategy--2026-10-18) — published and activated; [release evidence](foundation-verification.md#bob-context-strategy-release--2026-10-18) separates technical proof from remaining ordinary owner/long-memory acceptance in State |
| context-strategy coverage across colleagues and tools | [Coverage corrections](foundation-verification.md#bob-context-coverage-corrections--2026-10-18) — all five findings corrected and activated; [dated audit](bob-context-coverage-audit-2026-10-18.md) preserves the original evidence; ordinary owner/model acceptance remains in [State](bob-delivery-flow.md#state) |
| next work on Bob's end-to-end delivery | [State and next action](bob-delivery-flow.md#state) — remaining work and open gates; [six data-driven outcomes in five releases](bob-delivery-flow.md#six-outcomes-in-five-releases); the active stage lives there, not in this index |
| expensive construction rewrites and the staged correction | [Remediation plan](bob-green-release-plan-2026-10-19.md) — audit-linked delivery sequence, soft cost target and final CI gate; [bounded edits](artifacts.md#bounded-part-changes--prepared-2026-10-19), [small views and exact results](artifacts.md#construction-views-and-observed-results--prepared-2026-10-19) and [local evidence](foundation-verification.md#construction-views--2026-10-19) distinguish preparation from deployment |
| end-to-end delegated delivery, source lineage, handoffs and implementation priorities | [Docs/bob-delivery-flow.md](bob-delivery-flow.md) — cross-domain target, remaining P3 named-member acceptance and P4 cases; actual implemented/released scope lives with domain owners |
| data-driven handoff gaps and server-owned changes/status | [Data boundary review](bob-delivery-flow.md#kvarstående-datagränser--kodgranskning-2026-10-10) — reviewed gaps, existing guards and domain routing; remaining implementation is in State |
| exact instance roles and persisted affected-output continuation | [Artifact role/work owner](artifacts.md#instance-roles-and-affected-outputs--release-d) — manufacturing policy, retries and preserved work; [installation evidence](foundation-verification.md#construction-instance-roles-and-consequences--release-d) |
| AI-designed models with code-executed mathematics; calculator and formula versions | [Calculator contract](ask-bob-tools.md#calculator-and-saved-calculation-models--specified-2026-10-11) — common calculator v1 code boundary, existing stair/construction/material evaluators and domain-owned persistence; release and remaining scope are in State |
| five primary outcome use cases and their release acceptance | `Docs/user-stories.md` → Product mandate — 2026-09-24; UC-001–005 |
| baseline audit of Bob's actual context, models and tools | `Docs/bob-context-audit-2026-09-24.md` — dated findings before corrective implementation |
| existing small-model helpers versus a project librarian | [2026-10-26 audit](archive/bob-project-context-audit-2026-10-26.md) — dated code, active catalog and usage readback; existing memory/readers, missing source selection and timing limits; proposals only |
| general audit of Bob's tool use and unfinished work after PR #146 | `Docs/bob-tool-autonomy-audit-2026-09-25.md` — live configuration, reproducible runtime findings, test-policy drift and outcome acceptance |
| request path, model roles and Launchpad comparison for Ask bob; why Bob stalled and over-asked | `Docs/bob-ai-runtime-review-2026-09-27.md` — dated review after PR #149, with the implementation status of each finding |
| dynamic project Steps, completion requirements, responsibility, evidence and replanning | `Docs/living-project-plan.md` — implemented foundation plus remaining product direction; hierarchy refinement in `Docs/domain-dictionary.md` |
| material-led assemblies, tools/model roles and linked drawing/cut/assembly/Shopping implementation plan | [Material assembly use case](material-assembly-use-case.md#assembly-chain-plan) — K2–K5 revised 2026-10-03: measured context, construction checks, exact-revision outputs and recovery; active next action in [State](bob-delivery-flow.md#state), not a complete implementation |
| reusable material/part definitions, dynamic profiles and catalog tools | `Docs/material-catalog.md` — slice A deployed 2026-09-22; live versioned material/part definitions and tools, no assembly geometry yet |
| standard materials, sizes, aliases, household stock, stores and price history, Bob's combined material lookup | [Normalized material model](material-catalog.md#normalized-material-model) — installed 2026-10-29 with the owner-approved seed list; [optional properties](material-catalog.md#optional-dimensions) installed 2026-10-29 |
| database load, statement timeouts, repeated Bob lookups | [Database load relief](../db/README.md#db-load-relief) and [in-turn lookup reuse](../supabase/README.md#in-turn-lookup-reuse-and-database-load-relief--source-2026-10-29) — installed 2026-10-29 |
| generic CAD engine adapter / construction geometry seam | `Docs/cad-adapter.md` — hosted build123d/Open Cascade service, whole drawing intake, complements and versioned Artifact persistence; live design acceptance tracked separately |
| persistent site/building/space context and chat-driven narrative capture | `Docs/building-model.md` |
| function difficulty / scope buckets / first vertical slice | `Docs/function-scope.md` |
| original product intent and personas | `Docs/Mockups and initial plans/BuildCoord_PRD.md` |
| frontend/UI conventions | `Docs/ui-index.md` + `.claude/agents/vera.md` |
| documentation placement/precedence | `.claude/agents/archie.md` and `Docs/index.md` |
| data model, live/mock modes, auth membership | `db/README.md` + `src/data/database.ts` |
| existing construction/version relationships versus remaining schema and workflow gaps | [Database authority assessment](../db/README.md#construction-data-authority-and-remaining-extensions) — deployed bounded changes and typed drawing lineage; remaining targeted extensions |
| share a Building or selected projects with a household / invite an existing friend | `Docs/user-stories.md` → BOB-US-038 / BOB-US-059 + `db/README.md` → Household and friend sharing |
| volunteers joining with only a name / optional allergies when food is planned | `Docs/user-stories.md` → BOB-US-038 + `db/README.md` → Name-only volunteer access |
| preserve old Areas through archive/restore | `db/README.md` → Area archive and volunteer drawing reader; `Docs/ui-index.md` |
| volunteer task drawing reader and its release boundary | `Docs/artifacts.md` → Volunteer task drawings; `db/README.md` → capability endpoints |
| deliberate organisation of older Tasks / preserved history | `Docs/living-project-plan.md` → Older work organisation and Area lifecycle |
| household physical-edit authority versus project collaboration | `Docs/building-model.md` → §11.1A + `db/README.md` → Effective authority and revocation |
| project image storage, chat photos/reference mockups, attachments and manual task steps | `Docs/media-and-steps.md` |
| measurements, provenance history and existing components | `Docs/project-facts.md` |
| solution alternatives, evidence and selected target versions | `Docs/solutions.md` |
| construction checkpoints, drawings, source freshness, Project-home previews, work-Step links and exact lineage | `Docs/artifacts.md`; [parameter changes and version ownership](artifacts.md#parameter-changes-before-drawing--specified-2026-10-10) are deployed in B; [legacy transition](artifacts.md#legacy-drawing-transition--release-c) is deployed in C; D is technically installed; real acceptance remains in State |
| material requirements, deterministic quantities, construction cut plans, fastener and glue needs, stock/reuse, supplier articles, pack purchases and Shopping handoff | `Docs/material-planning.md` |
| saved outputs for one exact Construction revision, interruption and missing work links | [Artifact delivery discovery](artifacts.md#construction-delivery-discovery) — technically installed with [hosted recovery evidence](foundation-verification.md#form-delivery-release-2026-10-27); full browser/model acceptance remains |
| preliminary cut list & purchasing page (`#/build-lists`): role-aware parts, exact screw/glue counts, CSV, project next step | `Docs/project-build-preparation-2026-10-23.md` — a read-only preview, never an approved cut plan |
| Ask bob / OpenAI / scoped project lookup | `supabase/README.md` |
| AI personas, colleague titles/purposes, tool contracts, tiers, activation and pinned definition manifests | [AI definition catalog](../supabase/README.md#ai-definition-catalog-and-model-tiers) — versioned DB authority; release installation and real-model acceptance tracked separately |
| Ask bob's tool/colleague cards, instruction loading, authority and common calculator | `Docs/ask-bob-tools.md` — activated card strategy and pinned whole-bench compatibility; existing calculation owners and first common-tool boundary |
| Ask bob runtime context and evidence for the next task | [Context owner](ask-bob-context.md) — implemented startup facts, screen seam and image-only catalog; [task-specific source packet](ask-bob-context.md#task-source-packet) is the next specified reader scope; [dated audit](archive/bob-project-context-audit-2026-10-26.md) records active helpers and limitations |
| Ask bob bounded project writes, receipts and retry | `Docs/ask-bob-writes.md` |
| no IDs or codes in human text: writer rejection, notices, labels | [Human text rule](ask-bob-writes.md#human-text-holds-only-prose--owner-decision-2026-10-26) — owner decision 2026-10-26, live 2026-10-26 |
| Ask bob conversation continuity, reset, provider context and compaction | `Docs/ask-bob-conversations.md` + `supabase/README.md` |
| Drawing continuation ownership and preserved cost history | [Atomic database transition](../db/README.md#atomic-drawing-continuation--2026-10-18); [current work policy](ask-bob-conversations.md#active-memory-and-continued-work--2026-10-17) |
| how to verify a change | `.claude/skills/verify/SKILL.md` — automated tests, build and connected-mode browser fixtures |
| session-wide invariants | `CLAUDE.md` |

## Product

The [September 24 work/drawing release](foundation-verification.md#september-24-work-and-drawing-release) records deployed archive/restore, participant drawings, source freshness and the hosted query-planning correction.

- `README.md` — current repository/app overview and implemented route/architecture summary.
- `Docs/v1-plan.md` — **current V1 release contract**: V1 thesis, release boundary, slice sequence, release gates and golden-path acceptance. It consumes the accepted user stories/inventory/scope without duplicating their detailed function lists.
- `Docs/function-inventory.md` — **current implementation audit**: capabilities that are built, partial or absent, plus cross-cutting correctness/foundation gaps. Use this for claims about what bob actually supports today.
- `Docs/user-stories.md` — **current canonical user-story landscape** for planning, media, measurements, drawings, material calculations, work guidance and the build-together collaboration loop, including specified household/friend-sharing goals in BOB-US-038 / BOB-US-059.
- `Docs/domain-dictionary.md` — **semantic owner and 2026-09-24 vocabulary review**: Project → optional Area → Step → Task; phases, physical place, underlag and collaboration stay distinct. Includes four scale cases, the baseline audit and the implemented ownership migration; compact shared entries reach Bob and specialists through their model-call context.
- `Docs/living-project-plan.md` — **living-plan behavior owner, foundation implemented**: completion requirements, evidence/responsibility, shared-current-state briefing, history, focused edits with evidence continuity and replanning. `Docs/domain-dictionary.md` owns the refined work hierarchy; the shared work model and parallel Step execution are implemented in PR #135.
- `Docs/material-assembly-use-case.md` — **specified end-to-end acceptance contract and proposed logical database design** for material/part reuse-or-create, typed dynamic properties, generic assemblies, derived drawing/part/pick outputs and many-to-many purchase allocation. Maps BOB-US-010 / BOB-US-018–026 to buildable acceptance cases and a staged implementation sequence. New names are proposals, not deployed tables or tools; existing domain owners remain authoritative for their shipped behavior.
- `Docs/material-catalog.md` — **slice A deployed implementation owner**: material/part definition kinds sharing version mechanics, dictionary/profile data, exact unit normalization, conservative ensure/revise, caller authority and catalog tool integration. Refines the usecase's proposed table names; no generic drawing/BOM/Shopping completion claim.
- `Docs/cad-adapter.md` — **CAD implementation owner**: hosted build123d/Open Cascade worker, bounded CAD assistant, versioned STEP/SVG artifacts and adapter failure boundary. Current project-home/work links are owned by `Docs/artifacts.md`; live model design quality, BOM and Shopping are separate acceptance concerns.
- `Docs/material-planning.md` — **deployed 4B2a + first 4B2b material-planning contract** for manual requirements, the narrow `stud_wall_net_area` deterministic quantity, stock/reuse allocation, transparent purchase arithmetic and explicit Shopping handoff. Broader BOM/fastener/consumable rules remain later scope until explicitly modelled.
- `Docs/building-model.md` — **current persistent physical-context contract**: Sites, Buildings, optional Levels, Spaces, BuildingElements, spatial relationships, project scope, uncertainty and physical-state history. It also owns the four top-down/bottom-up/isolation/evolution acceptance fixtures. The manual 2C foundation is implemented, deployed and live-verified; bounded chat intake and multi-floor coordinate studies were merged and deployed through release #88 (see the capability inventory release delta). The separate multi-floor coordinate-study branch consumes canonical identities through `Docs/artifacts.md`; broader geometry/import/AI fidelity remains planned.
- `Docs/function-scope.md` — **current next-phase function-scope contract**: D1–D5 difficulty, BASE / V0-AUTO / V0-CORE / V0-STRETCH / POST-V0 scope buckets, selected first vertical slice and its pre-build blockers. The `V0-*` names are scope labels created before the release was named V1; release naming is owned by `Docs/v1-plan.md`.
- `Docs/Mockups and initial plans/BuildCoord_PRD.md` — original BuildCoord product requirements, personas, stories and scope; historical product intent where not superseded by a later current contract.
- `Docs/Mockups and initial plans/bob-the-builder.html` — original visual/product mockup; use as historical composition reference, not runtime truth.

### Product-document status

`Docs/user-stories.md` owns **what users should be able to achieve** across the general project workflow. `Docs/domain-dictionary.md` owns **concept meanings and the refined work hierarchy**, separating implementation, baseline audit and remaining boundaries. `Docs/living-project-plan.md` owns **dynamic Steps, completion requirements, evidence, responsibility and replanning**; its versioned Steps now provide primary Task ownership. `Docs/material-assembly-use-case.md` owns the **specified cross-surface material/assembly success and failure path**, acceptance fixtures and proposed logical storage relationships; `Docs/material-catalog.md` owns the first definition-only implementation and its release limits, not the whole usecase. `Docs/building-model.md` owns the stable cross-project **physical-place model and its acceptance fixtures**. `Docs/function-inventory.md` owns the current **built/partial/gap audit**. `Docs/function-scope.md` owns **function difficulty/prioritisation and selected-slice detail**. `Docs/v1-plan.md` owns **the V1 release thesis, boundary, ordering and release gates**. The original PRD remains valuable product history, especially for the collaborative-build core (organiser, skilled/general/drop-in volunteers, food manager, areas/tasks/materials/build days).

### Physical place vs project organisation

The original product uses `Area` as a project-scoped physical/work zone. The persistent building model is a later product decision and does not rewrite that history. For current work, keep the distinction explicit:

- `Area` — project work-zone container used by current collaboration/runtime flows;
- `Site` / `Building` / `Space` / `BuildingElement` — implemented persistent physical context that may be reused across projects;
- Areas may map to rooms of a Building the Project links as a whole (Area **Rooms** panel, live 2026-10-25; [building model](building-model.md#project-rooms-and-area-rooms--owner-decision-2026-10-25)); Area and Space must not be silently conflated.
- A room's length × width × height comes from typed measurements through one shared view for the app and Bob (**live 2026-10-26**; [building model](building-model.md#room-dimensions--owner-decisions-2026-10-26), [database](../db/README.md#room-dimensions--2026-10-26)).

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

- [Prompt craft](prompt-craft.md) — the owner's three authoring principles for this `CLAUDE.md`, coding subagents and Bob's runtime prompts. On-demand craft only; tools, working context and result acceptance keep their own owners.

- [Server-bound edits and canonical data reuse](ask-bob-writes.md#server-bound-edits-and-canonical-data-reuse--owner-decision-2026-10-14) — **owner decision 2026-10-14; description/solution/alternative/selection/evidence adapters technically deployed; work-record core/runtime installed with catalog blocked; plan focus/Task links in source; broader migration and member/model acceptance remaining**: Bob reads and changes data while the runtime owns identities, concurrency and reuse of canonical values. Includes create/revise separation, preservation rules and acceptance gates.

- [Bob building scope](ask-bob-writes.md#fifth-implementation-building-and-room-scope--source-2026-10-25) — **live 2026-10-25** ([evidence](foundation-verification.md#building-and-room-links--2026-10-25); not yet exercised in a live turn): Bob finds the caller's own Buildings, links or unlinks one and marks rooms and Area mappings through the unchanged physical scope command. Owner decisions in the [building model](building-model.md#bob-building-scope--owner-decisions-2026-10-25); release order in [supabase/README](../supabase/README.md#bob-building-scope--source-2026-10-25).

- [Docs/bob-delivery-flow.md](bob-delivery-flow.md) — **cross-domain delivery contract and active State**: parallel source flow, Bob/collector/designer/reviewer handoffs, just-in-time context, source lineage, resume/error outcomes and staged delivery. Domain owners distinguish implemented, deployed and remaining target scope. Its [State](bob-delivery-flow.md#state) contains only remaining work; dated evidence lives in PR/CI or the archive below.
- `supabase/README.md` — provider path, versioned AI definition catalog, per-app model tiers, pinned manifests, activation/rollback, setup and the Slice 0 project-lookup contract (allowed datasets/fields, authority and result semantics).
- `Docs/ask-bob-tools.md` — **tool-system owner**: since 2026-09-27 the whole permitted toolbox is offered every step on named shelves, with waiting/used-up tools listed and no forced tool choice; caller authority and execution fences are unchanged. The earlier core/on-demand tiers and list/load discovery are kept as history. Does not claim the generic drawing engine is built.
- `Docs/bob-tool-autonomy-audit-2026-09-25.md` — **dated audit after PR #146**: actual models/loadout, general completion gaps, discovery and budget failures, CAD feedback and behavioural verification; follow the domain owners for implementation contracts.
- `Docs/bob-ai-runtime-review-2026-09-27.md` — **dated review after PR #149, compared with Launchpad**: the path of one request, every model role in a turn, the tool surface per phase, the background-hop budget, and ranked findings (answer replaced by a notice, quote-as-authorisation, approval chains, forced continuation, missing archive tools) with an ordered fix list; a review, not a contract.
- [Launchpad migration audit — 2026-10-19](bob-launchpad-migration-audit-2026-10-19.md) — **dated source/live baseline evidence**: growing historical replay, CPU shutdowns, observed cache share and the actual Launchpad resume/prompt/demotion boundaries. The [conversation owner](ask-bob-conversations.md#launchpad-migration) owns the corrected three-stage contract; this audit is not deployment proof.
- `Docs/material-catalog.md` + `supabase/functions/_shared/material-catalog.ts` — discoverable material/part search, exact profile reads and definition saves through the existing tool/claimed-turn seam; source implementation, not a new standalone provider or an assembly generator.
- `Docs/ask-bob-context.md` — **mixed implemented/source/target** context owner: current startup facts, screen pointers, server-hydrated Current View and image-only catalog; [task-specific source packet](ask-bob-context.md#task-source-packet) specifies the next reader increment. The older general router/catalog sketches remain historical target context; code-read startup facts supersede the automatic model router. Ordinary member/model acceptance remains open.
- `Docs/ask-bob-context-implementation.md` — **technical landing plan with precedence notes**: current screen/image implementation and older broader rollout sketches. Later startup-facts and source-packet decisions take precedence; [FORM State](bob-delivery-flow.md#form-next) owns the next implementation order.
- `Docs/ask-bob-conversations.md` — **conversation state owner**: private transcript, working memory, explicit reset, durable background turns and server-driven continuation; provider erasure remains planned; per-user/project privacy and release gates.
- `supabase/functions/_shared/project-lookup.ts` — bounded briefing/lookup dispatcher and source metadata.
- `supabase/functions/_shared/project-answer.ts` — scoped research/write loop and assembled catalog-backed tool/prompt surface.
- `supabase/functions/_shared/ai-catalog.ts` — pinned definition manifest and role/profile/tier/tool/output resolution; owning contract in `supabase/README.md`.
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
- [.claude/agents/archie.md](../.claude/agents/archie.md) — stable Archie contract, including forward-looking State and archive placement.
- `.claude/agents/archie-learnings.md` — durable documentation lessons.
- [.claude/agents/archie-findings.md](../.claude/agents/archie-findings.md) — unresolved documentation/product-contract drift only; resolved entries belong in the archive.

## Archives — historical evidence, not active work

- [Material tables review, 2026-10-29](archive/material-tables-review-2026-10-29.md) — independent findings on the new material tables; corrections before application are in [verification](foundation-verification.md#follow-ups-2026-10-29), the remainder in [State](bob-delivery-flow.md#state).
- [Project context and small-model audit, 2026-10-26](archive/bob-project-context-audit-2026-10-26.md) — existing helpers, active models, usage and remaining reader/review gaps; [project context](ask-bob-context.md) owns the current contract and [State](bob-delivery-flow.md#state) owns remaining implementation work.
- [K2 live acceptance report, 2026-10-04](archive/k2-live-acceptance-2026-10-04.json) — synthetic saved revisions from the successful three-turn concept test; [verification](foundation-verification.md#k2-live-construction-acceptance--2026-10-04) owns release evidence and limits, and [State](bob-delivery-flow.md#state) owns remaining work.
- [Delivery-flow review, 2026-09-29](archive/bob-delivery-flow-review-2026-09-29.md) — dated code/data findings, verification limits and the superseded handoff snapshot. Open actions remain in [State](bob-delivery-flow.md#state); archiving this record does not close them.
- [Archie's resolved findings](../.claude/agents/archive/archie-findings-2026-09-29.md) — historical FINDING-A01–A03 closure records, removed from the open-findings reading path.

Task-workflow release scope (2026-10-17): [parts 1–3 decision](bob-delivery-flow.md#bob-task-pr-plan), [write compatibility](ask-bob-writes.md#native-work-values-and-task-feedback--2026-10-17), [bounded completion](ask-bob-conversations.md#delegated-task-completion--2026-10-17) and [release evidence](foundation-verification.md#bob-task-workflow-release-2026-10-17). Model and UI changes are deferred.

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

For State, handoff and open-finding maintenance, follow [Archie's forward-looking State/archive rules](../.claude/agents/archie.md#forward-looking-state-and-archives). Current contracts stay with their owners; completed-work history is not an active task list.

September 2026 context extension: `ask-bob-conversations.md` supersedes its earlier provider-only memory plan with five full recent messages, a private incremental older brief, exact history retrieval, paged construction records and compact/expandable chat. Deployment evidence belongs in the merged release PR, not a source-only status claim.

- [Plain-language drawing sheets](cad-adapter.md#plain-language-drawing-sheets--2026-10-30) — words and direction arrows for X/Y/Z, grouped parts; source only, not deployed.
- [K3 exact construction drawings](cad-adapter.md#k3-checked-construction-drawings--2026-10-04) — checked checkpoint rendering, annotations and revision pins; [release/acceptance evidence](foundation-verification.md#k3-checked-construction-drawings--2026-10-04).
