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

## Current execution position — 2026-09-13

The numbered slices describe the product dependency chain, but implementation has intentionally followed a **foundations-first execution lane**. That means later manual foundations have been delivered while some earlier AI gates remain open.

**Deployed / live-verified foundations:**

- Slice 0 — trust foundation;
- Slice 1A — real project media;
- Slice 1B — manual illustrated task steps;
- Slice 2A — measurements/provenance/history;
- Slice 2B — existing components;
- Slice 3A — alternatives + selected target;
- Slice 4A — manual plans/drawings with exact target and measurement lineage.

**Still open by deliberate deferral:**

- Slice 1C — Bob vision over authorised project images;
- full Slice 2 AI consumption of measurements/evidence;
- Slice 3B generated visual proposals/mockups;
- deterministic generated geometry, BOM/calculations, stock/shopping propagation and richer executable work planning after 4A;
- Slice 5 generated/project-specific guidance and structured progress/as-built completion.

**Current next foundation:** **Slice 2C — persistent building context.** Although its number is 2C, it is the next implementation milestone from the current repository state. 4A could safely establish manual drawing truth using project/Area scope, but deterministic geometry and calculations should not expand until Bob has persistent physical targets (`Building` / `Space` / `BuildingElement`) that survive individual projects.

**Active implementation ownership (2026-09-13):** PR #42 (`feat/persistent-building-context`) owns the 2C schema/authority/domain foundation. PR #43 (`feat/building-context-ui`) is reserved to the current implementation session for the app-facing `database.ts` seam, reachable manual Building/Spaces UI, navigation, browser verification and honest loading/empty/denied/error states. Do not start overlapping 2C UI/integration work in another session unless #43 is explicitly handed off or this marker is cleared. Update or remove this coordination marker when #43 merges or ownership changes.

**Execution order from here:**

1. deliver the manual 2C building-context foundation and its four acceptance fixtures;
2. resume Slice 4 beyond manual 4A: deterministic artifact geometry for the narrow supported fixtures, then transparent quantity/BOM + stock/shopping integration, then richer task/dependency/tool/readiness relations;
3. add the deferred AI consumers on top of the persisted foundations rather than making AI output the only place those concepts exist;
4. complete Slice 5 guidance and progress/as-built loops against the same persisted project + physical context.

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

### 2C — Persistent building context — NEXT MANUAL FOUNDATION (planned; owner decision, 2026-09-13)

Implement the manual physical-model foundation before deterministic drawing generation expands further. This is the **current next implementation milestone** after deployed 4A, despite the 2C dependency label.

Minimum delivery order:

1. create persistent Site/Building/optional Level/Space identities without requiring a complete house;
2. add a small BuildingElement vocabulary and explicit spatial relationships;
3. let a Project scope itself to physical targets and let Areas optionally map to them without changing Area's project-work-zone meaning;
4. reuse existing provenance/revision rules for measurements and physical claims;
5. model proposed physical change separately from current state, with an explicit path to accepted/as-built state;
6. only then add Bob-assisted floor-plan/image ingestion as a proposal/review flow on the same records.

The manual foundation must work without AI. Bob-assisted plan extraction depends on the Slice 1C vision seam and must preserve `ai_assessment` / unknown states rather than claiming inferred geometry or hidden services as verified.

**2C exit:** the four fixtures in `Docs/building-model.md` work at the agreed narrow fidelity: a whole-plan structure can be represented, one room can exist alone and later gain an adjacent room, separate buildings do not bleed physical knowledge, and a major remodel can preserve before/proposed/accepted history. Persisted manual data survives reload and honours backend project/building authority boundaries.

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

**Before deterministic drawing generation expands beyond the existing manual 4A foundation, planned Slice 2C must establish persistent physical targets.** Generated geometry should reference the Building/Space/Element context it describes instead of hard-coding project `Area` as if Area were the building model.

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

V1 does not require a new top-level navigation item merely because persistent building records exist. The first UI should support both:

- top-down capture from a whole-plan source; and
- bottom-up capture where only the currently relevant room/space is modelled.

A dedicated Building view may be added when needed for editing/visualising several Spaces together, following Vera's UI contract rather than creating a parallel design system.

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