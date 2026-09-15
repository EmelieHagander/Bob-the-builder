# bob — V1 release plan

> **Status:** current V1 release contract  
> **Owns:** V1 product thesis, release boundary, slice sequence, release gates and golden-path acceptance  
> **Inputs:** `Docs/user-stories.md`, `Docs/building-model.md`, `Docs/function-inventory.md`, `Docs/function-scope.md`, `Docs/ui-index.md`

V1 is the next product release after bob's existing collaboration/coordination core. It adds the missing planning/evidence layer without rebuilding areas, tasks, people, shopping, build days, food or announcements.

Bob's AI work uses OpenAI directly throughout V1. The permanent provider decision,
project lookup and deployment contract are owned by [supabase/README.md](../supabase/README.md).

## Naming note

`Docs/function-scope.md` uses labels such as `V0-CORE`, `V0-AUTO` and `V0-STRETCH`. Those labels were created as **next-phase scope buckets before release naming was settled**. They are not historical app version numbers.

The release described here is now called **V1**. This plan consumes the relevant scope buckets without rewriting their original prioritisation vocabulary.

## Current execution position — 2026-09-15

The numbered slices describe the product dependency chain, but implementation has intentionally followed a **foundations-first execution lane**. Later manual foundations may therefore be live while earlier AI gates remain deliberately deferred.

**Deployed / live-verified foundations:**

- Slice 0 — trust foundation;
- Slice 1A — real project media;
- Slice 1B — manual illustrated task steps;
- Slice 2A — measurements/provenance/history;
- Slice 2B — existing components;
- Slice 2C — persistent Site/Building/Level/Space/BuildingElement context, spatial relationships, Project/Area physical scope and accepted/proposed history;
- Slice 3A — alternatives + scope-safe selected target;
- Slice 4A — manual plans/drawings with exact target and measurement lineage;
- Slice 4B1 — deterministic `stud_wall_opening_v1` artifact geometry;
- Slice 4B2a — manual material requirements, stock/reuse allocation, purchase arithmetic and explicit Shopping handoff;
- Slice 4B2b — deterministic `stud_wall_net_area` material base quantity in the same requirement/Shopping path;
- collaboration foundation — opt-in household Building editing, explicit household project sharing and registration-free name-only volunteers, with hosted authority/media/revocation proof;
- Project/Area lifecycle foundation — explicit `ProjectPhase` / `AreaPhase`, scope-safe Project/Area targets and phase-aware Project/Area/Account/Today/Task surfaces;
- executable-work readiness foundation — Task→Task/checkpoint dependencies, required tools/information, canonical material readiness, named blockers and explicit human-confirmed `ready` state.

4B1/4B2a/4B2b are runtime truth. The first deterministic material calculator remains deliberately narrow; broader fastener/consumable/catalogue/engineering rules stay unknown/manual until an explicit deterministic rule is modelled. `Docs/foundation-verification.md` owns exact migration, advisor, browser and hosted evidence.

Household/friend sharing and name-only volunteers are also runtime truth at the currently available hosted fidelity. PR #61 closed the rollout with the sharing migrations, hardening migration, deployed `volunteer-media`, rollback-safe household authority proof and ordinary hosted volunteer/media/revocation proof. The one explicit external-fixture limitation is the accepted-Hearth-friend **positive** production path: production currently has no accepted friendship to exercise without fabricating another app's data. Denial when friendship is absent is live-verified; the product contract still requires the positive path once a real accepted friendship exists.

Project/Area phases and scope-safe target ownership are runtime truth. PR #60 delivered the lifecycle/scoped-target stack, PR #62/#63 closed its hosted proof, and #64–#67 carried Area scope and lifecycle context through Material Plan, Account, Today and Task Detail.

Executable readiness is now runtime truth too. PR #68 delivered the domain/UI foundation; source migration `20260915073000_executable_work_readiness.sql` is hosted as `20260915091153_bob_executable_work_readiness`. PR #70 added the ordinary hosted verifier. PR #73 made the phase fixture self-contained and source-synced the checkpoint-FK covering index, hosted as `20260915143912_bob_executable_work_readiness_fk_index`; the specific advisor finding is gone. Pages run `34984705428` and live foundation run `34984705122` are green on release tree `59929f997741e41555d1faef0a95769df9eb86d9`. The live run proves phase/tool/information/dependency/checkpoint/material blockers, stale-write denial, explicit Ready confirmation, re-review after newer material truth, Today visibility, completion and raw/anonymous/project isolation. Its exact disposable project was nonce-checked, had zero media and was operator-deleted with zero project/material/stock/artifact/media rows remaining.

**Still open by deliberate deferral:**

- Slice 1C — Bob vision over authorised project images;
- full Slice 2 AI consumption of measurements/evidence and Bob-assisted whole-plan ingestion;
- Slice 3B generated visual proposals/mockups;
- broader deterministic material rules beyond `stud_wall_net_area` where explicit formulas/coverage rules exist;
- the remaining executable-work contract beyond readiness: richer task scope/expected result, explicit work ordering/sequence semantics and Bob-proposed **human-confirmed** work breakdowns;
- Slice 5 generated/project-specific guidance plus structured progress/as-built completion.

**Current next implementation milestone:** finish the remaining **manual executable-work contract** on top of the now-live readiness foundation: richer task scope / expected result plus explicit ordered-work semantics that humans can edit and confirm. Do not make AI-generated work breakdowns project truth until that manual persistence/authority boundary exists.

The separate Ask Bob behavior discovery in PR #53 remains a parallel design lane. It should consume the persisted project/phase/building/solution/artifact/material/readiness truth rather than becoming a competing source of truth.

Area → physical-target mapping is backend-built and live-verified. A dedicated Area-side mapping editor remains a narrow follow-up; it is not a reason to reopen the sparse Building/Space foundation.

**Execution order from here:**

1. finish richer task scope/expected-result and explicit ordered-work/work-breakdown persistence with human confirmation;
2. add the minimum Slice 5 progress/as-built memory and one supported project-specific **How do I?** loop;
3. extend deterministic material rules only where explicit formulas/coverage rules and provenance are defined;
4. let the separate AI lane consume the persisted foundations with the same proposal/confirmation boundaries;
5. exercise the accepted-friend positive hosted path when production Hearth naturally has an accepted friendship — never fabricate Hearth data solely for Bob verification.

This section is the current execution marker. Detailed built/partial/gap truth still belongs to `Docs/function-inventory.md`; release scope and gates remain in this plan.

---

# 1. V1 thesis

> **Show bob the real project, then let bob help turn that shared evidence into a trustworthy, buildable plan that the existing crew can actually execute together.**

Today bob is already useful once someone has manually created areas, tasks, materials, people and build days. V1 removes the hardest translation step before that point: turning photos, measurements, existing components and design decisions into the project truth that drives drawings, materials and work.

V1 also starts separating **the project** from **the physical place the project happens in**. A building, room or known wall should be able to outlive one renovation and become better understood over time. `Docs/building-model.md` owns that persistent physical-context contract.

### Primary value

A project owner should not need to be a construction planner before bob becomes useful.

They should be able to start with:

- photos of what exists;
- plain-language intent;
- measurements collected over time;
- components/materials they already have;
- an incomplete or existing model of the relevant building/space, when useful;
- decisions made together with bob.

Bob should then help preserve that evidence and transform it into a coherent shared plan without disguising assumptions as facts. When evidence belongs to a persistent building/space rather than only one project, Bob should be able to retain it for later work instead of forcing the next project to start from zero.

### V1 north-star experience

A real homeowner can go from:

> "Here is my porch. I want to enclose and extend it."

through:

> evidence → physical context → missing measurements → selected solution → measured/concept-labelled artifacts → calculated materials → ordered editable tasks → task guidance

and end with the same information usable by the people who are actually building, while useful knowledge about the house remains available for the next project.

### Anti-goals for V1

V1 is **not**:

- professional CAD/BIM authoring;
- structural-engineering certification;
- permit automation;
- arbitrary photo-to-survey-grade measurement;
- autonomous AI making high-consequence project decisions without human confirmation;
- a Gantt/critical-path construction-management suite;
- a replacement for bob's existing lightweight collaboration model;
- a real-time chat product;
- a hardware-store marketplace or purchasing integration.

---

# 2. The V1 golden path

The acceptance fixture for V1 is the real porch/entrance project that motivated this work. The product model must stay generic, but this project is the concrete proof that V1 is useful rather than merely architecturally complete.

A V1 user can:

1. Open/create **"Enclose the entrance / Build in the porch"** using the existing project shell.
2. Upload several real current-state photos and see them again after reload.
3. Ask bob about those photos in the explicitly active project.
4. Get a concrete request for missing evidence, e.g. a specific dimension or a photo underneath the porch.
5. Record verified measurements with provenance.
6. Record existing/reusable components, e.g. two windows with known dimensions, separately from items that still need buying.
7. Create or select the minimum persistent Building/Space context needed for the porch project without being forced to model the whole house.
8. Explore more than one proposed solution and keep the alternatives.
9. Mark one solution revision as the shared current target.
10. Preserve a target mockup as **illustrative**, not measured truth.
11. Produce a simple measured/concept-labelled artifact for a supported assembly, with assumed values visibly distinguished from verified ones.
12. Derive a transparent bill of materials from the same selected solution and measurements.
13. Deduct existing stock/components from what needs to be purchased.
14. Feed purchase requirements into the existing checkable Shopping surface rather than creating a second shopping system.
15. Generate an ordered, editable work breakdown with dependencies, tools, material requirements and readiness reasons.
16. Put the relevant photo/drawing/guidance image directly on the task where it is needed.
17. Open **"How do I?"** for at least one supported task and receive project-specific guidance, checkpoints and an explicit safety/professional-check boundary.
18. Assign the resulting tasks to people using bob's existing collaboration core.
19. Record at least a progress note/photo and an as-built observation so the project can continue from reality rather than only from the original plan, and accepted physical changes can later improve the persistent building context.

V1 is released only when this path works end to end with persisted data and honest state boundaries.

---

# 3. Deliberately narrow construction support

V1 domain objects should be generic, but deterministic construction generation/calculation does **not** need to understand every kind of build.

The first supported calculation/artifact fixtures should be narrow and explicit:

### Supported fixture A — ventilated porch/floor build-up

Enough to represent and reason about a simple layered floor assembly such as:

- existing/new joists;
- insulation;
- wind protection;
- underfloor ventilation/ground condition;
- structural subfloor;
- finish layer.

### Supported fixture B — simple timber stud wall with opening

Enough to represent:

- wall dimensions;
- stud spacing;
- a known window/door opening;
- side studs/header/sill framing concept;
- boards/insulation/basic layer quantities;
- linked framing guidance image.

These fixtures prove the architecture. V1 must not imply that unsupported arbitrary structures receive equally deterministic engineering output.

---

# 4. V1 release scope

## 4.1 Trust and authority foundation — MUST SHIP

- explicit active `projectId` through the Ask bob seam;
- server-side validation that the caller may access that project;
- membership-aware authority for all new V1 evidence objects;
- project-safe storage access for media;
- visible truth/provenance vocabulary: measured / provided spec / estimated / AI assessment / unknown;
- revision/supersession semantics for high-value V1 records;
- high-consequence AI output remains proposed until human confirmation;
- deterministic unit/domain tests for provenance and calculations;
- browser proof for the critical persisted flows.

## 4.2 Real project media — MUST SHIP

- real image upload;
- stable `MediaAsset` metadata + storage identity;
- purpose classification at minimum: current state, proposal/target, section/drawing, guidance, progress, as-built;
- project + optional area/task association;
- render/read-back after reload;
- full original image view without destructive thumbnail cropping;
- existing Area reference-image concept upgraded rather than replaced by a new top-level product silo;
- Ask bob can consume a selected authorised image as vision context;
- upload/loading/error/denied states are explicit and mobile-safe.

A separate top-level **Media** or **Design Studio** navigation item is not required for V1.

## 4.3 Measurements and existing conditions — MUST SHIP

- numeric measurement value + unit + subject;
- provenance/truth state;
- manual measurement entry from project/area context;
- estimate superseded by later verified measurement without destroying history;
- concrete missing-measurement/evidence requests from bob;
- existing component register with specification/quantity/condition;
- reuse / inspect / remove / replace intent;
- existing stock separated from purchase requirement.

Image-derived measurements may be suggested as estimates, but V1 does not promote them to verified geometry.

## 4.3A Persistent building context — MUST SHIP, NARROW

`Docs/building-model.md` owns the product/domain contract. V1 must establish enough persistent physical context that useful house/building knowledge is not trapped inside one Project, while staying well short of general CAD/BIM.

Minimum V1 capability:

- optional persistent Site and Building identity;
- optional Level grouping;
- partial Spaces that can exist before the rest of the building is modelled;
- a small extensible BuildingElement vocabulary for walls/openings/windows/doors/structural or service elements where known;
- explicit spatial relationships such as adjacency/shared boundary/above/below/connection;
- Project scope to a Site/Building/one or more Spaces/Elements, while projects with no physical association remain valid;
- optional mapping from project `Area` work zones to persistent physical targets without conflating the two concepts;
- existing truth/provenance vocabulary reused for physical claims and inferred conditions;
- current/as-is vs proposed vs accepted/as-built physical state retained without destructive overwrite;
- building-specific isolation so knowledge from one structure is not silently applied to another.

The physical model must support both **top-down** capture (whole floor/house drawing first) and **bottom-up** capture (one room first). Whole-plan image/PDF ingestion may arrive after the manual foundation, but it must populate the same model as a proposal for confirmation rather than creating a separate AI-only representation.

The four acceptance fixtures in `Docs/building-model.md` — whole-plan top-down, one-room bottom-up, separate-building isolation and major-remodel evolution — are part of the V1 architecture test.

## 4.4 Solutions and target decision — MUST SHIP

- named solution/proposal;
- multiple alternatives coexist;
- assumptions/evidence references on solution revision;
- one selected current target;
- selection/revision history;
- visual proposal/mockup based on real project evidence where available;
- known component proportions passed into visualisation context;
- visual result remains explicitly illustrative unless generated from measured geometry by a deterministic artifact path.

## 4.5 Drawings / project artifacts — MUST SHIP, NARROW

- revisioned artifact record tied to the selected solution;
- at least a simple section/elevation for a supported V1 fixture;
- explicit distinction between verified and assumed dimensions;
- conceptual vs measured/build-ready status;
- artifact linked to relevant area/task;
- cut-through assembly diagram where useful.

V1 does not promise general CAD, DXF/BIM or certified engineering drawings.

## 4.6 Material calculation and shopping integration — MUST SHIP, NARROW

- canonical numeric quantity + unit for calculated requirements;
- task/area material requirement relation;
- deterministic quantity derivation for supported V1 fixtures;
- stored calculation inputs/method/version/result;
- visible waste/spill allowance;
- existing stock/reused component deduction;
- calculated purchase need feeds the existing Shopping list;
- user can inspect why a quantity exists.

### Fasteners and consumables

For supported rules, V1 should calculate screws/nails/paint/other consumables from known geometry and a visible rule/coverage basis.

Bob must not claim an unknowable **exact number actually consumed on site**. The useful V1 promise is:

> calculated purchase requirement + formula/rule + allowance + assumptions.

If a supported rule does not exist, the value stays unknown/manual rather than receiving fake precision.

## 4.7 Executable work plan — MUST SHIP

- richer task scope/expected result;
- ordered sequence/phase;
- explicit dependencies;
- tools per task;
- canonical task-material requirements;
- structured blocker/readiness reason;
- readiness calculation from dependencies/material/evidence where modeled;
- bob can propose a work breakdown from selected solution;
- human can edit/reorder/add/remove before it becomes project truth;
- relevant media/artifact is reachable from the task.

## 4.8 "How do I?" guidance — MUST SHIP, NARROW

At least one supported V1 task type must have a complete guidance loop:

- open deeper guidance on demand from the task;
- use project-specific verified dimensions where available;
- distinguish generic recommendations from project-specific truth;
- show a linked or generated construction image;
- checkpoints before continuing;
- common mistakes;
- clear professional/site-specific safety boundary.

The default task card remains lightweight; deeper guidance is progressive disclosure.

## 4.9 Progress and as-built memory — MUST SHIP, MINIMUM

- per-task progress note;
- progress photo using `MediaAsset`;
- as-built observation with actor/date/media;
- ability to record a real deviation from the plan without losing the prior plan;
- old high-value revisions remain available;
- accepted building/space/element changes can be reconciled into the next current physical state without erasing the previous one.

Automatic propagation of every as-built change through all downstream drawings/BOM/tasks can remain post-V1 unless it is cheap for the supported fixture.

## 4.10 Existing collaboration integration — MUST KEEP WORKING

V1 outputs must land in bob's existing collaboration model:

- areas remain the work-zone container;
- areas may later map to persistent physical targets but are not replaced by Spaces;
- tasks remain assignable to existing people;
- skill levels remain visible;
- Shopping remains the shopping surface;
- build events/attendance continue to work;
- Today remains a lightweight field view;
- announcements and food remain unaffected.

V1 does **not** require smart attendee/task matching, event-specific scheduling or a rebuilt Today view to ship.

The owner-confirmed sharing extension adds opt-in household Building editing and
explicit household/project friend collaboration to this core. It reuses existing
shared households and friendships; the [sharing milestone below](#collaboration-foundation--household-and-friend-sharing)
owns its release gates without changing the later AI dependency chain.

---

# 5. V1 slice sequence

Each slice must be independently mergeable, useful and truthful. Do not hide unfinished foundations behind a giant feature branch.

## Slice 0 — Trust foundation

Slice 0 is deployed. Membership/RLS, bounded lookup and OpenAI tool wiring have
live proof, including an ordinary Auth/PostgREST/OpenAI round trip. The production
frontend's project-switch flow passes in CI at three widths. See
[the verification record](slice-0-verification.md) for the evidence and its limits.

**Goal:** make project identity, authority and provenance safe enough for V1 data.

Includes:

- explicit active project id through Ask bob;
- project access validation;
- V1 membership/RLS pattern;
- bounded read-only project lookup for Ask bob, with a fixed dataset/field
  allowlist; the [project lookup contract](../supabase/README.md#project-lookup-contract--slice-0)
  in `supabase/README.md` owns the detail;
- minimum truth/provenance vocabulary;
- test harness needed for denied/cross-project behavior.

**Exit:** a project-aware backend lookup proves authorised success, cross-project
denial and isolation after project switching, using only the allowed data. The
lookup contract is implemented and its deployed lookup/denial checks pass; browser
project-switch proof uses fixture HTTP services, as recorded in the verification owner.

## Collaboration foundation — Household and friend sharing

**Status:** specified / implementation in progress, owner decision 2026-09-13.

**Goal:** let a household maintain one shared Building model and collaborate on
chosen projects, while friends join only the projects to which they are invited.
BOB-US-038 and BOB-US-059 in `Docs/user-stories.md` own the user goals;
`Docs/building-model.md` §11.1A and `db/README.md` own physical and data authority.

Includes opt-in Building sharing with household editing, an explicit per-project
choice of no household/direct household/follow one linked Building, an additive
linked-project checklist, and accepted-friend in-app invitations. Household access
is evaluated dynamically; independent project memberships and accepted Bob grants
remain distinct. Existing confirmed-email invitations continue separately.

**Owner clarification, 2026-09-14:** volunteers must also be able to open a
project-specific invitation link and enter only their name, without email,
password or an Auth account. Allergies are optional and requested only when the
project has food planned. The separate, limited volunteer capability supports
project instructions, build days, own participation/progress and revocation;
it never supplies household or project-administration authority. Source is
prepared; [the data owner](../db/README.md#name-only-volunteer-access) owns the
exact rules and the verification owner records pending browser/hosted proof.

**Exit gates:**

- household users can edit shared accepted Building truth and work on explicitly shared projects; Building share management and actual deletion remain direct-member actions;
- physical association alone, a second Building, an unselected project and a pending friend invitation do not create project access;
- household inactivation, unsharing, relevant unlinking and Bob invitation revoke/leave remove the affected route without destroying independent grants;
- invitation and acceptance recheck accepted friendship, and acceptance rechecks the inviter's project access;
- private media, project lookup, crew/assignment identity and existing collaboration flows obey the effective backend authority;
- legacy `bob.account` / `bob.account_notes` receive a reviewed household boundary before new friends can access the shell; empty/default data must not justify guessing household ownership;
- browser proof covers household selection, explicit linked-project choices, friend acceptance/decline, reload, project/auth switching, denial and stale saves at 320/390/1280px;
- name-only volunteer proof shows no Auth signup, project-only participation, allergy collection only with food, own-actor writes, retained required checks, resume, expiry and revocation;
- hosted migration and normal Auth/PostgREST/Storage checks prove the new behavior separately from local tests/browser fixtures, with source/apply/deploy status recorded in `Docs/foundation-verification.md`.

This manual collaboration milestone requires no Bob AI trial and sends no email
or other external message.

## Slice 1 — Show bob the real project

Selected in `Docs/function-scope.md`. **Status: 1A real media and 1B manual
illustrated task steps are implemented and deployed; 1C vision remains planned.**
[Foundation verification](foundation-verification.md) records database, browser
and live Storage evidence. Full Slice 1 is still open until its vision gate passes.

**Goal:** persist a real current-state image and let bob reason about it in the correct authorised project.

### Delivery order — foundations first (owner decision, 2026-09-09)

Build useful, persistent project structures before adding the next AI interaction.
The owner does not want to test Bob now. Implementer-run database/storage and
browser verification remains required; an owner chat/vision trial is not a gate
for continuing foundation work.

1. **1A — Real project media — deployed.** Define the minimum media/storage/authority
   contract, then implement image upload, durable metadata, project/area/task
   attachment and image read-back. Record purpose, source/actor and timestamps.
   File access must follow project membership. The existing public app-asset
   bucket alone does not satisfy this contract.
2. **1B — Tasks with illustrated steps — deployed.** Add manually editable task instructions
   and ordered steps, each with instruction text, completion state and optional
   images using the same media model. Support completion checks, distinguish
   instruction images from recorded evidence, and preserve everything after
   reload. A step belongs to one task in the same authorised project as its
   attachments. Keep the normal task card concise; expand detail on demand.
3. **1C — Bob consumes the foundation — planned.** Connect selected authorised project
   images to OpenAI vision after 1A and 1B. Preserve the existing assessment/fact
   boundary and produce a concrete request for missing evidence.

**Foundation exit (1A + 1B):** create a task with ordered instructions, attach an
image to a step, record completion, reload, and recover the same image, order and
state; project switching and normal API access cannot expose another project's
records/files. This must work without an AI call.

These milestones are independently mergeable. Manual steps and their media
attachment are brought forward from the task-guidance journey; generated guidance,
solution-aware diagrams and the full progress/as-built workflow retain their
later slice gates. Apply the same delivery rule to later domains: establish
persisted manual records and relations before building AI consumers on them.

**Full Slice 1 exit:** upload → reload/read-back → Ask bob vision → concrete missing
evidence request, with assessment vs fact language preserved. Foundation completion
does not by itself close this later vision gate.

## Slice 2 — Measure what matters

**Manual foundation delivery (owner decision, 2026-09-09):** continue with 2A
measurements/provenance/history and 2B existing components before adding the next
AI consumer. The owner reaffirmed foundations first after 1A/1B. These manual
milestones are independently useful and do not require the pending 1C vision gate.
**2A and 2B are implemented, merged and deployed.** The
[project facts contract](project-facts.md) owns scope, relations and source-image
behavior; [foundation verification](foundation-verification.md) records the
release checks. Lengths, provenance, retained revisions, a manual To measure list,
existing parts and their dimensions/source images are available from Dashboard
and Area. Full Slice 2 still requires Bob to consume the verified values; it is
not closed by manual storage. The 1C vision gate also remains planned.

**Goal:** turn bob's missing-evidence request into durable, provenance-aware project truth and establish the minimum persistent physical context that can survive the project that discovered it.

Includes:

- Measurement;
- ExistingComponent / existing stock minimum;
- manual entry;
- Bob reads the new facts;
- estimate → verified supersession;
- persistent Building/Space context from `Docs/building-model.md`.

### 2C — Persistent building context — MANUAL FOUNDATION DEPLOYED + LIVE-VERIFIED (2026-09-13)

PR #42 implements the persistent physical-domain schema, RLS/authority, command boundary, revision/proposal model and `src/data/buildingContext.ts`. PR #43 adds the canonical `database.ts` integration, reachable **Building & spaces** UI and dedicated browser proof. Both are merged to `main`; the manual foundation is no longer merely planned.

Implemented/verified at the current narrow fidelity:

1. persistent Site/Building/optional Level/Space identities can exist without a complete house model;
2. BuildingElement records and explicit spatial relationships exist with the shared truth/provenance vocabulary;
3. Projects can scope to physical targets, and Area → physical-target mapping exists and is backend-tested without redefining Area as Space; a dedicated Area-side mapping editor is intentionally deferred;
4. measurements can be pinned by exact revision into physical context, preserving provenance/history;
5. current physical truth remains separate from proposed change, with explicit acceptance producing a new accepted revision rather than destructive overwrite;
6. manual UI reads/writes through `database.ts`, clears stale data on building/project switches, and exposes honest loading/empty/denied/error states;
7. Bob-assisted floor-plan/image ingestion remains deferred and must populate these same records as proposed/AI-assessed state rather than creating a separate representation.

The domain/RLS suite covers the four `Docs/building-model.md` acceptance fixtures: a whole structure can exist before a renovation scopes it; one room can gain pinned measurements and a later inferred neighbour without fake fact promotion; separate buildings stay isolated; and a remodel proposal does not replace current truth until explicit acceptance. The dedicated production-React browser fixture additionally proves create Building → add sparse Space → link Project → reload → add second Space/relation → switch Building → switch Project → denied-state handling at 320px, 390px and 1280px.

**2C verification status:** merged, deployed and live-verified. The hosted cleanup-order correction in PR #45 and the Auth/PostgREST/browser/Pages evidence are recorded in `Docs/foundation-verification.md`. The later household-sharing extension has its own unclosed gates.

**2C exit:** the four fixtures in `Docs/building-model.md` work at the agreed narrow fidelity: a whole-plan structure can be represented, one room can exist alone and later gain an adjacent room, separate buildings do not bleed physical knowledge, and a major remodel can preserve before/proposed/accepted history. Persisted manual data survives reload and honours backend project/building authority boundaries. The foundation verification owner records both CI/browser fidelity and the completed hosted-live proof.

**Full Slice 2 exit:** a user can answer a concrete measurement request, return later, and Bob uses the verified value while retaining provenance and the relevant persistent physical context. Manual 2C completion does not by itself close the later AI ingestion/consumption gate.

## Slice 3 — Choose the target

**Manual foundation 3A (deployed, 2026-09-10):** alternatives, revisioned
assumptions/evidence and an explicitly selected project target continue the
owner's foundations-first order. [Solutions](solutions.md) owns the contract;
[foundation verification](foundation-verification.md) records release evidence.
Images and exact measurement revisions reuse 1A/2A/2B. Editing an alternative
keeps the selected version until another explicit decision. AI proposal/mockup
generation remains the later 3B gate, so full Slice 3 and the V1 release remain
open. No owner Bob trial was required for 3A.

**Goal:** move design decisions out of ephemeral chat.

Includes:

- SolutionRevision;
- alternatives;
- assumptions/evidence links;
- selected target;
- illustrative mockup stored as proposal media.

**Exit:** A/B alternatives coexist, one is selected, and downstream work has one explicit target revision.

## Slice 4 — Turn target into work

**Manual foundation 4A (deployed and live-verified, 2026-09-13):** revisioned
manual plans/drawings now bind the exact selected target/solution and exact
measurement versions, with explicit concept/measured/build-ready status, optional
authorised drawing image, append-only history and stale-target protection.
[Plans and drawings](artifacts.md) owns the behavior and
[foundation verification](foundation-verification.md) owns release evidence.
This establishes the artifact truth boundary without AI. Deterministic drawing
generation, transparent BOM/calculation, stock deduction, Shopping propagation,
task-material/dependency/tool/readiness relations and Bob-proposed work remain
open, so full Slice 4 and V1 are not closed by 4A.

**The persistent-physical-target prerequisite is now satisfied in merged 2C code/CI.** Deterministic drawing generation may resume for the deliberately narrow supported fixtures. Generated geometry must reference the `Building` / `Space` / `BuildingElement` context it describes, preserve pinned measurement provenance and remain explicit about measured vs assumed/concept geometry instead of hard-coding project `Area` as the building model. Production/live verification of 2C is complete; exact evidence is recorded in `Docs/foundation-verification.md`.

**Goal:** produce the first coherent build package from the selected target.

Includes for the supported V1 fixture:

- measured/concept-labelled artifact;
- transparent deterministic BOM;
- stock deduction;
- shopping integration;
- task/material links;
- ordered dependencies;
- tools/readiness;
- Bob-proposed, human-confirmed work breakdown.

**Exit:** changing a verified input and regenerating produces a traceable new calculation/artifact revision rather than silently mutating unexplained values.

## Slice 5 — Help me build it

**Goal:** prove that the plan is genuinely useful while someone is doing the task.

Includes:

- relevant artifact/media on task;
- "How do I?";
- project-specific dimensions;
- construction image;
- checkpoints/common mistakes/safety boundary;
- progress note/photo;
- as-built observation.

**Exit:** a helper can open one task on a phone, understand what to build and what to check, complete it, and leave useful evidence for the next person/day.

### After V1

Natural follow-on work includes:

- event-specific task scheduling;
- smarter skill/readiness matching;
- true current-user "My tasks today";
- PDF/offline work packs;
- richer automatic change propagation;
- more supported construction assemblies;
- product/catalog integrations;
- a source-backed **Building Knowledge Library** for reusable construction methods, materials, assemblies, safety guidance and manufacturer/regulatory references.

#### Building Knowledge Library — planned later, not a V1 gate

Project context and general construction knowledge are different truth classes. The project/context system tells Bob what is currently true about *this* project, building, area, measurement, selected solution or drawing. A future Building Knowledge Library may give Bob reusable construction knowledge, but that material must never become evidence that a concrete project fact is true.

When this work starts, keep it as a separate knowledge/retrieval plane that can be combined with the screen-aware Ask bob runtime rather than seeding generic building text into project tables or the Project Catalog. Source identity, provenance, freshness/versioning and an honest distinction between general guidance and project truth are required properties.

The corpus, source selection, seeding/ingestion, curation, retrieval/reranking and maintenance architecture are intentionally **discovery pending**. This plan is only the scope marker; create a dedicated owning contract and index it when that work becomes implementation-driving rather than inventing those details now.

These should not expand the V1 release boundary.

---

# 6. V1 UI contract

V1 must extend bob's current UI instead of creating a parallel planning application.

### Dashboard — understand the project

May surface:

- project target/current phase;
- a small amount of current evidence;
- concrete missing evidence/questions from bob;
- relevant Building/Space scope where one exists;
- readiness/attention that helps the owner decide the next action.

It should remain scannable rather than becoming an editor.

### Area / Task — organise and execute

This is where:

- media;
- measurements/context;
- materials;
- artifacts;
- tasks;
- guidance;
- progress/as-built evidence

become useful to the work.

The existing Area `Reference images` concept should evolve into real media rather than being duplicated elsewhere. Area remains a project work-zone; where useful, it may point to persistent Building/Space/Element context defined in `Docs/building-model.md`.

### Building context — grow with need

The merged app now has a dedicated **Building & spaces** view for editing/visualising the sparse physical model without introducing a new bottom-navigation destination. It supports the bottom-up manual path where only the relevant room/space is known, and the same model is ready for later top-down plan ingestion. Production/live verification of this merged UI is still pending.

V1 still requires both capture directions:

- top-down capture from a whole-plan source, with AI/image extraction remaining a later proposal/review flow; and
- bottom-up capture where only the currently relevant room/space is modelled.

The Building view must continue to follow Vera's UI contract rather than becoming a parallel design system.

### Ask bob — reason and explain

Ask bob remains the conversational layer for:

- analysing project evidence;
- asking for missing evidence;
- comparing options;
- explaining calculations/plans;
- generating proposed work/guidance.

It should not become the only place project truth lives. Physical inferences from neighbouring Spaces/Elements remain visibly inferred/unknown until evidence upgrades them.

### Today — stay fast

Today remains field-first and minimal. V1 may expose a relevant task image/artifact link, but project-management detail should stay behind the task.

---

# 7. V1 truth and authority rules

These are release invariants, not optional polish.

1. **Unknown stays unknown.** Missing site facts are visible rather than auto-filled.
2. **AI observation is not measurement.** Image analysis cannot silently create verified dimensions.
3. **Inference is not a hidden fact.** Adjacency or a neighbouring outlet/pipe may justify a question or caution, not a verified service route.
4. **Human confirmation owns high-value truth.** Selected target, verified measurement and plan-changing AI proposals require explicit confirmation in V1.
5. **Every calculated quantity has a basis.** Formula/method/inputs/allowance can be inspected.
6. **Revision beats destructive overwrite.** High-value solution/artifact/calculation/building-state/as-built history remains explainable.
7. **Project context is explicit.** No V1 AI/read/write path may infer project identity by `limit(1)` or equivalent.
8. **Physical context is explicit.** A Building/Space/Element relationship must not be guessed from whichever Area/project happens to be open.
9. **Authorization lives at the real boundary.** UI hiding is never the only project-access protection.
10. **Generated beauty does not upgrade authority.** Mockups/diagrams/drawings carry their actual status.

---

# 8. V1 release gates

V1 is not "done" because all screens exist.

## Product gate

The golden porch journey can be completed end to end without maintaining a parallel spreadsheet/chat as the source of truth.

## Persistence gate

V1 evidence, measurements, persistent building context, selected target, artifacts, calculated requirements, richer tasks and progress/as-built records survive navigation/reload where promised.

## Security gate

- active project is explicit;
- cross-project reads/writes are denied at backend/storage boundaries;
- new V1 records follow membership-aware authority;
- building/site associations cannot be used to cross project/account authority boundaries.
- household sharing, friend acceptance and revocation obey the distinct effective-access routes; inherited crew rows do not become permanent grants;
- new friends cannot read legacy household account settings or notes through the account shell or normal API.

## Truth gate

A reviewer can tell, from the UI/data, whether a value is measured, provided, estimated, AI-assessed, calculated or unknown.

## Building-context gate

At the narrow V1 fidelity:

- one Building may contain only one known Space while everything else stays unknown;
- a later Space can be related to it without requiring a complete floor plan;
- an imported/photographed full plan may propose many Spaces for confirmation;
- a project scoped to another Building does not inherit house-specific facts;
- a remodel/extension keeps current, proposed and accepted/as-built physical history distinct;
- `Area` continues to work as a project work-zone rather than being silently redefined as `Space`.

## Calculation gate

Supported BOM/consumable calculations have deterministic tests and exposed derivation/allowance.

## UI gate

- follows Vera's review order;
- phone/one-hand usage works for upload, task, guidance and progress flows;
- no new top-level navigation is introduced without a demonstrated need;
- loading/error/denied/unknown states are honest;
- images can be viewed without losing important content to thumbnail cropping.

## Collaboration regression gate

Existing project, area, people, event, shopping, food, announcement and Today flows continue to work.

## Browser proof gate

At minimum, automated or repeatable browser verification covers:

- upload + reload;
- denied cross-project media access;
- measurement persistence/supersession;
- persistent Building/Space creation + reload and separate-building isolation;
- selected solution persistence;
- supported artifact/BOM generation + shopping handoff;
- task guidance on mobile-sized viewport;
- progress/as-built read-back.

---

# 9. Data concepts V1 is expected to introduce

This is a product/data-shape expectation, **not a migration specification**. Exact schema belongs to the owning implementation contracts for each slice.

Likely first-class concepts:

- `MediaAsset`;
- `Measurement`;
- `ExistingComponent` / existing stock;
- persistent `Site` / `Building` / optional `Level` / `Space` / `BuildingElement` identities;
- `SpatialRelationship` and project/Area-to-physical-target scope links;
- physical-state revision/change history for current / proposed / accepted-as-built context;
- `SolutionRevision`;
- `ArtifactRevision`;
- `MaterialRequirement` / `QuantityCalculation`;
- stable task-material relation;
- `TaskDependency` and richer task detail;
- progress/as-built observation;
- provenance/truth metadata.

Names here are conceptual. `Docs/building-model.md` owns the physical-domain meaning; the implementation milestone owns exact schema/RLS/API names.

All UI access continues through `src/data/database.ts` or an explicitly documented successor seam; V1 must not teach screens to query Supabase ad hoc.

---

# 10. V1 implementation discipline

For each slice:

1. write/confirm the narrow domain/authority contract;
2. add the schema/storage boundary if required;
3. expose the capability through `database.ts`;
4. build the smallest UI using existing bob patterns;
5. wire Ask bob only to persisted authorised truth;
6. add deterministic tests for high-consequence rules;
7. drive the real browser flow including reload/error/denial;
8. update inventory/docs only after runtime truth changes.

For persistent building context specifically, establish the manual sparse model and authority boundaries before AI plan ingestion. Reuse existing provenance/history seams instead of creating a second truth vocabulary.

Avoid large "platform first" refactors. Promote repeated UI/data patterns only when the slice demonstrates the repetition.

---

# 11. V1 definition of success

V1 succeeds when bob changes from:

> **a very good place to coordinate a build that somebody has already planned**

into:

> **a place where a real DIY/community build can become understandable, buildable and shareable from the evidence the people actually have — while the useful model of the place can keep improving across projects.**

The release is intentionally judged against one real project first. If the porch can move from photos and uncertain existing conditions to a transparent build package and usable crew tasks without fake precision or fragmented truth, and the resulting house knowledge can be reused rather than discarded with the project, V1 has proven the product direction.
