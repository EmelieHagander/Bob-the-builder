# bob — V1 release plan

> **Status:** current V1 release contract  
> **Owns:** V1 product thesis, release boundary, slice sequence, release gates and golden-path acceptance  
> **Inputs:** `Docs/user-stories.md`, `Docs/function-inventory.md`, `Docs/function-scope.md`, `Docs/ui-index.md`

V1 is the next product release after bob's existing collaboration/coordination core. It adds the missing planning/evidence layer without rebuilding areas, tasks, people, shopping, build days, food or announcements.

Bob's AI work uses OpenAI directly throughout V1. The permanent provider decision,
project lookup and deployment contract are owned by [supabase/README.md](../supabase/README.md).

## Naming note

`Docs/function-scope.md` uses labels such as `V0-CORE`, `V0-AUTO` and `V0-STRETCH`. Those labels were created as **next-phase scope buckets before release naming was settled**. They are not historical app version numbers.

The release described here is now called **V1**. This plan consumes the relevant scope buckets without rewriting their original prioritisation vocabulary.

---

# 1. V1 thesis

> **Show bob the real project, then let bob help turn that shared evidence into a trustworthy, buildable plan that the existing crew can actually execute together.**

Today bob is already useful once someone has manually created areas, tasks, materials, people and build days. V1 removes the hardest translation step before that point: turning photos, measurements, existing components and design decisions into the project truth that drives drawings, materials and work.

### Primary value

A project owner should not need to be a construction planner before bob becomes useful.

They should be able to start with:

- photos of what exists;
- plain-language intent;
- measurements collected over time;
- components/materials they already have;
- decisions made together with bob.

Bob should then help preserve that evidence and transform it into a coherent shared plan without disguising assumptions as facts.

### V1 north-star experience

A real homeowner can go from:

> "Here is my porch. I want to enclose and extend it."

through:

> evidence → missing measurements → selected solution → measured/concept-labelled artifacts → calculated materials → ordered editable tasks → task guidance

and end with the same information usable by the people who are actually building.

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
7. Explore more than one proposed solution and keep the alternatives.
8. Mark one solution revision as the shared current target.
9. Preserve a target mockup as **illustrative**, not measured truth.
10. Produce a simple measured/concept-labelled artifact for a supported assembly, with assumed values visibly distinguished from verified ones.
11. Derive a transparent bill of materials from the same selected solution and measurements.
12. Deduct existing stock/components from what needs to be purchased.
13. Feed purchase requirements into the existing checkable Shopping surface rather than creating a second shopping system.
14. Generate an ordered, editable work breakdown with dependencies, tools, material requirements and readiness reasons.
15. Put the relevant photo/drawing/guidance image directly on the task where it is needed.
16. Open **"How do I?"** for at least one supported task and receive project-specific guidance, checkpoints and an explicit safety/professional-check boundary.
17. Assign the resulting tasks to people using bob's existing collaboration core.
18. Record at least a progress note/photo and an as-built observation so the project can continue from reality rather than only from the original plan.

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
- old high-value revisions remain available.

Automatic propagation of every as-built change through all downstream drawings/BOM/tasks can remain post-V1 unless it is cheap for the supported fixture.

## 4.10 Existing collaboration integration — MUST KEEP WORKING

V1 outputs must land in bob's existing collaboration model:

- areas remain the work-zone container;
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

**Goal:** turn bob's missing-evidence request into durable, provenance-aware project truth.

Includes:

- Measurement;
- ExistingComponent / existing stock minimum;
- manual entry;
- Bob reads the new facts;
- estimate → verified supersession.

**Exit:** a user can answer a concrete measurement request, return later, and Bob uses the verified value while retaining provenance.

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

**Manual foundation 4A (implementation verified; parallel PR integration pending):** continue
with versioned drawings/references and exact task pins under the owner's
foundations-first order. [Project artifacts](project-artifacts.md) owns the
contract. Ready project images are saved against the selected solution version
and its exact measurement evidence. Target/input changes stay visible; revision
requires explicit review, and tasks deliberately adopt newer reference versions.
These are manual references without a measured/build-ready claim. Generated
geometry, deterministic BOM, stock, shopping and readiness remain later Slice 4
work. No new AI consumer or owner Bob trial is required for this milestone.

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
- product/catalog integrations.

These should not expand the V1 release boundary.

---

# 6. V1 UI contract

V1 must extend bob's current UI instead of creating a parallel planning application.

### Dashboard — understand the project

May surface:

- project target/current phase;
- a small amount of current evidence;
- concrete missing evidence/questions from bob;
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

The existing Area `Reference images` concept should evolve into real media rather than being duplicated elsewhere.

### Ask bob — reason and explain

Ask bob remains the conversational layer for:

- analysing project evidence;
- asking for missing evidence;
- comparing options;
- explaining calculations/plans;
- generating proposed work/guidance.

It should not become the only place project truth lives.

### Today — stay fast

Today remains field-first and minimal. V1 may expose a relevant task image/artifact link, but project-management detail should stay behind the task.

---

# 7. V1 truth and authority rules

These are release invariants, not optional polish.

1. **Unknown stays unknown.** Missing site facts are visible rather than auto-filled.
2. **AI observation is not measurement.** Image analysis cannot silently create verified dimensions.
3. **Human confirmation owns high-value truth.** Selected target, verified measurement and plan-changing AI proposals require explicit confirmation in V1.
4. **Every calculated quantity has a basis.** Formula/method/inputs/allowance can be inspected.
5. **Revision beats destructive overwrite.** High-value solution/artifact/calculation/as-built history remains explainable.
6. **Project context is explicit.** No V1 AI/read/write path may infer project identity by `limit(1)` or equivalent.
7. **Authorization lives at the real boundary.** UI hiding is never the only project-access protection.
8. **Generated beauty does not upgrade authority.** Mockups/diagrams/drawings carry their actual status.

---

# 8. V1 release gates

V1 is not "done" because all screens exist.

## Product gate

The golden porch journey can be completed end to end without maintaining a parallel spreadsheet/chat as the source of truth.

## Persistence gate

V1 evidence, measurements, selected target, artifacts, calculated requirements, richer tasks and progress/as-built records survive navigation/reload where promised.

## Security gate

- active project is explicit;
- cross-project reads/writes are denied at backend/storage boundaries;
- new V1 records follow membership-aware authority.

## Truth gate

A reviewer can tell, from the UI/data, whether a value is measured, provided, estimated, AI-assessed, calculated or unknown.

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
- `SolutionRevision`;
- `ArtifactRevision`;
- `MaterialRequirement` / `QuantityCalculation`;
- stable task-material relation;
- `TaskDependency` and richer task detail;
- progress/as-built observation;
- provenance/truth metadata.

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

Avoid large "platform first" refactors. Promote repeated UI/data patterns only when the slice demonstrates the repetition.

---

# 11. V1 definition of success

V1 succeeds when bob changes from:

> **a very good place to coordinate a build that somebody has already planned**

into:

> **a place where a real DIY/community build can become understandable, buildable and shareable from the evidence the people actually have.**

The release is intentionally judged against one real project first. If the porch can move from photos and uncertain existing conditions to a transparent build package and usable crew tasks without fake precision or fragmented truth, V1 has proven the product direction.
