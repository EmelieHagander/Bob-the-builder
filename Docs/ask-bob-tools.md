# Ask Bob: tool discovery, loading and authority

<a id="selective-methods-and-tools--prepared-2026-10-19"></a>
## Selective methods and tools — hosted 2026-10-19

**Delivery 3 is merged through [PR #291](https://github.com/EmelieHagander/Bob-the-builder/pull/291)
and now technically installed and activated for new catalog manifests.**
[Hosted verification](foundation-verification.md#hosted-bob-release--2026-10-19)
owns the runtime versions and publication receipts. A pinned
`bob.workflows.metadata.selective_tools_version=1` separates workflow selection
from schema loading. `describe_tool(workflow_name)` retains the method in current
system instructions and lists member availability, without loading their schemas.
`describe_tool(tool_name)` loads only that tool. Its result is a reference: the
next request carries the full manual and schema once in the native tool definition.
The short directory remains available, including waiting prerequisites.

**Shown-model feedback — source only, 2026-10-27.** `read_model_feedback` and
`record_model_feedback` extend the existing Solution actions, the Project records
and memory shelf and `workflow_solution_concept`. They load on demand and use the
same caller, journal, writer and receipt paths in `ask-bob` and `bob-worker`.
The reader pages bound presentation metadata and responses; the writer binds the
whole current reply, presenter and exact source server-side. No additional model
or always-loaded behavioral prompt is introduced. The [Solution owner](solutions.md#form-shown-feedback)
defines outcome/scope/mandate semantics; [release ordering](../supabase/README.md#form-feedback-release)
and [local proof/limits](foundation-verification.md#form-feedback-2026-10-27)
remain separate from activation.

**Six catalog-owned core tools — technically installed, 2026-10-28.** The owner approved
up to six permanent tools, including discovery. New `bob.tools.core_tools` pins
`describe_tool`, `search_project_data`, `open_project_item`,
`read_solution_context`, `read_construction_draft` and
`change_construction_parameters`. They are callable from the first main request
and remain available through subsequent steps. Descriptions, manuals and schemas
come from each tool's immutable catalog definition, through the existing binder;
the runtime does not embed a second set of prompt descriptions. Discovery uses
its catalog card. Normal policy, prerequisites and write authority still apply.

The six-tool limit applies to automatic core loading. Bob can load other tools
when needed, and selective loading still retains those tools within the turn.
The new list supersedes the additive drawing, reading and building preloads
below for new manifests; building-link facts remain in context. Older pinned
manifests keep their original loading behavior. An invalid, duplicate, unknown
or oversized core list fails before a model request. Installation and measured
limits belong to [verification](foundation-verification.md#bob-cost-controls-2026-10-28).

<a id="coherent-construction-work"></a>
### Coherent construction operations — installed, 2026-10-28

New manifests pin `construction_work_version=1` on four tool interfaces and
`bob.tools`. Agent instructions, model profiles and the six core names remain
unchanged. Existing manifests retain their original schemas and execution path.
The [release evidence](foundation-verification.md#construction-work-2026-10-28)
records installation and the remaining live delivery/cost acceptance.

| Operation | Existing interface and new behavior |
|---|---|
| Read | `read_construction_draft(view: work)` gathers exact editable inputs, the affected dependency closure and governing sources. `work_kind` selects parameters, parts or inspection; `step_id` names an approved Step or is null. The [context owner](ask-bob-context.md#construction-work-context) defines coverage and caching. |
| Change | `change_construction_parameters` or `edit_construction_parts` accepts several related deltas plus an optional server-bound `solution_edit`. The [writer owner](ask-bob-writes.md#construction-work-write) defines atomicity, source reconciliation and recovery. |
| Check | `check_construction_draft` returns bounded complete findings for the receipt revision and optionally reopens saved output categories. The [Artifact owner](artifacts.md#construction-work-check) defines evidence and limits. |

The pinned catalog's `operation_followups` loads the part editor after a parts
work read, the checker after a successful save, and the drawing tool after a
concept-ready check. A reviewed CAD candidate or compiled plan proposal also
exposes its save tool when that existing gate is ready. Loading offers a tool on
the next model request; it does not execute it or bypass policy, version,
authorization or the current request's offered-tool fence. Descriptions and
schemas still come from the pinned catalog. Checkpoints retain loaded tools.
This adds no seventh permanent core tool or new model helper.

**Creation continuation — installed, 2026-10-29.** The new-construction work
packet reports `creation_state` from canonical readiness. Catalog followups
expose creation/selection when no Solution exists, the content editor when
issues remain, and construction/material tools when ready. An explicit scoped
FORM candidate retains its save capability even when unrelated whole-solution
choices remain open. These are tool availability changes, not auto-execution,
approval or a substitute for save validation. No new core tool is added.
[Preparation evidence and release order](foundation-verification.md#creation-preparation-2026-10-29)
own the current source-only status.

<a id="write-state"></a>
**Writes return their state — prepared, 2026-10-29 (owner decision).** New
manifests pin `bob.tools` `write_state_version: 1`. Construction saves, part
edits and parameter changes return the check of their receipt revision
(`check`, `checked_concept_ready`) through the ordinary check path, so Bob does
not call the checker or re-read the result next; a check that cannot run is
reported inside the saved result. Solution creation returns a usable reference;
selection and selected-solution edits return construction readiness
(`creation_state`) and a fresh edit reference. Followups after saves now load
the drawing tool when concept-ready and the part editor otherwise, instead of
the checker. `search_project_data` leaves the core list (five tools); it stays
loadable through `describe_tool`, and the server already binds every read to
the current project. Older manifests keep their receipts, texts and loading.
[Preparation record](foundation-verification.md#controlled-completion-2026-10-29).

The existing post-write completion review remains. A synthetic main-loop proof
therefore uses three domain tool calls and five main requests: read, change,
check, candidate answer and completion review. It is proof of accessible
capability, not that a live model will always choose this sequence or cost.
Content-free `work_*` diagnostics record operation, reuse, revisions, coverage
and requested output count through the existing metrics owner; no source text
or record identities are added to those diagnostics.

**Historical drawing continuation preload — 2026-10-20.** A turn whose thread has a pending
drawing request (the same `pending()` read the turn already makes) starts with
the construction-drawing core loaded: `read_construction_draft`,
`check_construction_draft`, `design_project_cad`, `read_drawing_requests`,
`read_drawing_request_work`, `read_construction_changes`,
`change_construction_parameters`, `edit_construction_parts`, `save_cad_design`
(`DRAWING_CONTINUATION_PRELOAD` in `project-tools/bob-tools.ts`). Loading uses
the same gate as `describe_tool` by name; waiting tools appear when ready and
authority is still checked at execution. Measured reason: on 2026-10-20 every
drawing turn loaded these one or a few at a time, and the 42 model steps after a
manual load hit the provider cache 9% of the time against 81% otherwise (2.03 of
7.88 USD). Other work keeps the selective on-demand loading unchanged.

**Core reading preload — deployed 2026-10-25** ([evidence](foundation-verification.md#core-reading-preload--2026-10-25)). New jobs (execution pin
`corePreloadVersion: 1`) also start with `search_project_data`,
`list_project_category` and `open_project_item` loaded (`CORE_READ_PRELOAD`),
through the same preload path and gate. Measured reason: from 2026-10-19 to
2026-10-25, 99 of 611 main steps only loaded manuals and 38 of 57 turns began
with such a step; these three were the most loaded tools. They add about 950
tokens to each request, sent from the first step so the prompt cache keeps them.
Jobs started before the pin keep on-demand loading. Every other tool keeps the
selective loading described above.

**Building scope tools — activated 2026-10-25** ([evidence](foundation-verification.md#building-and-room-links--2026-10-25)). The generated
publication `20261025150500_ai_building_scope_catalog.sql` adds
`read_building_scope` and `change_building_scope` to the **Building and site**
shelf, ahead of `save_building_context`, and to `workflow_facts_and_site`, whose
card and method now name linking the project's building and rooms. They load on
demand like other tools, except for the building-link preload below. The read has its own budget
of 24 calls; the change uses the write gate. Handlers register only for manifests
that publish the contracts, so older pinned manifests keep their bench. The
`save_building_context` manual points to `change_building_scope` instead of
manual linking. [The write contract](ask-bob-writes.md#fifth-implementation-building-and-room-scope--source-2026-10-25)
owns authority and receipts.

**Building links at turn start — deployed 2026-10-25** (PR #329, `c449ce7`; `bob-worker` v137, `ask-bob` v169 at 18:05 UTC after a read-only check found no active jobs; not yet observed in a live turn). On 2026-10-25 Bob said a
project had no saved measurements: the project linked no building, so its reads
were empty, while 12 measured values sat on the owner's room in an unlinked
house. New jobs (execution pin `buildingLinkVersion: 1`) read their building
links once before the first step (`read_bob_building_scope_context`, own journal
stream `building:links`, skipped when resuming from a checkpoint). The first
note carries them as data: `buildings: {linked, owner_can_link}` (names and link
kind only). When no whole building or site is linked, `read_building_scope` and
`change_building_scope` are loaded from the first step (`BUILDING_SCOPE_PRELOAD`),
so Bob can find and link the house instead of reporting missing data. Linked
projects keep on-demand loading.

**Room dimensions dataset — activated 2026-10-26** ([evidence](foundation-verification.md#room-dimensions-and-human-text--2026-10-26)).
`search_project_data` gains the dataset `room_dimensions`: one record per room in
this project with its name, building name, revision and typed dimensions (length,
width, ceiling height, openings; side and reference) from
`bob.project_room_dimensions`, each `known`, `conflict` (all values) or `unknown`,
in millimetres, never derived. New jobs pin `roomDimensionsVersion: 1` and read
through `search_bob_project_data_v9`; journals without the pin keep v8, so a
resumed job replays unchanged. The generated publication
`20261026130500_ai_room_dimensions_catalog.sql`
(`scripts/build-ai-room-dimensions-catalog.ts`) appends the dataset to the enum
and one sentence to its description; older manifests keep their list. Order:
core migration, both runtimes, then the publication
([database](../db/README.md#room-dimensions--2026-10-26)). Bob's writers are
unchanged.

**Owner decision — 2026-10-22, amended by the six-tool selection above:** do not redesign selective loading, allowed-tool
restriction or instruction placement for provider caching. The cache work kept is
a routing hint only ([decision A](ask-bob-conversations.md#pr3--bound-result-payloads-without-an-ai-history-summary)).

Tool-session checkpoint v2 saves selected method names and loaded tool versions.
Methods resolve from the immutable manifest; current instructions and per-tool
catalog overrides are rebuilt after restart/rollover. Current policy, handler
version, prerequisite and the submitted offer fence still gate execution. A
checkpoint cannot grant authority. Old manifests retain v1 group loading and
their original response shape; state modes cannot be interchanged.

The construction method chooses numeric/role/part edits for existing work and
natural saved sub-constructions for larger new builds. It includes the existing
`plan_cad_pieces` queue without automatically loading it. Repetitions and shared
interfaces belong to the [Artifact contract](artifacts.md#compact-repetition-and-natural-pieces--prepared-2026-10-19).
Complete provider-independent requests and exact result recall are integrated in
the same source merge. Their paired catalog opt-in remains inactive pending the
heavy-reasoning and ordinary model acceptance gates.
[Verification](foundation-verification.md#selective-tools-and-construction-work--2026-10-19)
separates scripted surface evidence from actual model behavior and cost.

**Owner decision / implementation in PR #91 (2026-09-21).** This document owns
Bob's tool surface and loading contract. The PR records the exact tested commit,
managed migration, merge, deployed Edge version, Pages and live-check evidence;
source presence alone is not a deployment claim.

September 25 adds six registered on-demand capabilities: `read_project_work`, `manage_task_readiness`, `manage_project_material`, `derive_cad_material_requirement`, `save_project_build_day`, and `search_building_knowledge`. The first reads scoped operational records; four use the existing bounded writer and canonical domain commands; knowledge retrieval is read-only general reference material. Planning/Build preloads do not change permission. Detailed contracts belong in `living-project-plan.md`, `material-planning.md` and `building-knowledge.md`. `bob_project_write_v12` delegates earlier operations unchanged and adds atomic operational receipts.

This supersedes the fixed tool-array loading described in older backend/context
plans. It does not supersede domain write rules, Artifact lineage, private media,
conversation compaction or the selected-image grounding repair. See
[bounded writes](ask-bob-writes.md), [images](media-and-steps.md),
[conversation state](ask-bob-conversations.md) and [drawings](artifacts.md).
Current View and the remaining broader catalog/router/Librarian design are distinguished in
[the context owner](ask-bob-context.md#implemented-scope-and-remaining-target). The image-only catalog/list/open tools do not imply that general architecture is implemented.

The first server-bound edit adapter is technically deployed for project descriptions
and existing solutions: `read_project_edit_context` returns bound selections and
`edit_project_record` accepts only content changes. The owning write contract
records the exact scope, catalog/runtime rollout order and remaining tool families.
[Release evidence](foundation-verification.md#server-bound-project-edits--2026-10-14)
separates installation from open ordinary-member/model acceptance. The second deployed slice adds explicit alternative creation, selection and evidence-link changes (#255). The next source slice replaces thirteen work-record writes with bound content, create, relation and state actions; its publication is not yet active. The owning write document inventories the remaining families.

## Data edit responsibility — specified 2026-10-14

[Server-bound edits and canonical data reuse](ask-bob-writes.md#server-bound-edits-and-canonical-data-reuse--owner-decision-2026-10-14)
owns the owner-approved target: Bob can inspect and change data; the runtime binds
identity, read versions and existing values. New and revised tool contracts must
follow it. Existing model-supplied IDs/full-record payloads are migration work,
not an exception to the principle. This documentation does not activate new
catalog schemas or change the deployed toolbox.

## Tool and colleague cards — 2026-10-18

**Hosted addition, 2026-10-19:** the versioned
`edit_construction_parts` command sends only changed canonical construction posts.
Its [Artifact contract](artifacts.md#bounded-part-changes--prepared-2026-10-19)
owns merge, identity, source and receipt rules. The new publication adds it to the
construction workflow and directs small edits away from full-document saves.
Earlier pinned catalogs do not acquire this handler or the new full-save
diagnostics. Delivery 2 adds [small read views and observed-result references](artifacts.md#construction-views-and-observed-results--prepared-2026-10-19),
with a pinned reader contract. Delivery 3's [selective surface](#selective-methods-and-tools--prepared-2026-10-19)
replaces group expansion for new manifests. The [dated payload audit](bob-launchpad-migration-audit-2026-10-19.md#tool-payload-audit)
records the original failure and measured baseline; these changes are not yet
proof of a real-model tool-choice or dollar improvement.

**Main Bob's foundation was published through PR #267.** The
[coverage corrections](bob-context-coverage-audit-2026-10-18.md) extend the same
instruction-loading mechanics to active specialists and remove dormant CAD roles.
They are published; [coverage release evidence](foundation-verification.md#bob-context-coverage-corrections--2026-10-18)
records verification and hosted readback. Ordinary owner/model and CAD acceptance
remain in [State](bob-delivery-flow.md#state).
[Foundation release evidence](foundation-verification.md#bob-context-strategy-release--2026-10-18)
records the earlier installed runtimes and catalog. The [context owner](ask-bob-conversations.md#context-strategy--2026-10-18)
owns memory, source truth and long-work continuation. This section owns the new
tool surface; older pinned manifests retain the whole-bench contract below.

Bob receives short cards for eligible tools and colleagues. A colleague card gives
name, title, job description and the real tool through which that colleague is
engaged. It does not invent a directly callable agent or imply authority to save.
Only implemented, enabled delegation paths visible to the current caller appear.
Bob chooses what serves the owner's request; project phase does not choose for him.

`describe_tool` provides the chosen tool's complete instructions and exact input
schema, including the relevant colleague handoff. Its permitted native function
becomes available on the following model step. Several independent manuals may be
requested together. A waiting capability can be explained but cannot run until its
prerequisite is satisfied. Hidden/disabled capabilities reveal neither a card nor a
manual. Loading instructions grants no permission and performs no project mutation.

**Workflows and judgement (2026-10-18, catalog publication `bob-workflows-judgement-v1`).**
After the cut to short cards Bob lost the working method that used to sit in the
base prompt and spent many steps opening manuals one by one. The catalog
definition `bob.workflows` now lists a few workflow cards (construction drawing,
living plan, tasks, facts and site, materials, solutions and description, images)
under the toolbox intro. `describe_tool` with a workflow name returns that
workflow's method and makes all its available member tools callable on the next
step; each member keeps its own policy, gate and version checks, and single-tool
manuals stay available. A workflow lists only tools Bob can already see.
`bob.context-principles` gained one judgement paragraph (picture the result
finished and in use; parts join, mirrored parts match; compare with mockups; fix
causes in the saved source). Methods describe judgement, never magic words.
Manifests pinned before this publication show no workflows.

**Loaded tools survive a context rollover (2026-10-19, execution `toolCarryVersion: 1`).**
A live job on 2026-10-19 re-described 3–5 tools after every rollover (about 40
`describe_tool` steps in 20), each a full model call with a cache miss. New
executions keep the loaded tools at a rollover; their offered schemas then carry
the manual (`include_manual`, no card) because the manuals moved into the
summarized history. Policy, gate and version checks still run on every prepare.
Executions started before this keep the original reset.

**Replay freshness window (2026-10-19).** A journal replay re-ran every recorded
step's access, tool-policy and opened-image checks within milliseconds (about
500 round trips per claim in that job). `ask-openai.ts` reuses a successful live
answer for 3 s; a failed or denied answer is never reused, the image check right
before a new submission stays live, and writes stay enforced by RLS and the
domain commands.

**Image provider files (2026-10-19, owner decision).** A fresh request used to
re-download each opened image and send it inline as base64 (a 3 MB photo became
about 4 MB of request body, and the CPU to build it). Claimed server turns now
upload one exact image revision once to the OpenAI Files API (`purpose=vision`,
deleted by OpenAI after 30 days) and send `input_image.file_id`. The image itself
stays in bob storage as the source; the file id is derived metadata on it in
`bob_private.image_provider_files`, readable by project members through
`bob_image_provider_file` for the current revision only and recorded through the
claim-bound `bob_record_image_provider_file`. A changed or deleted image never
reuses the old id. Every lookup, upload or save failure falls back to inline
pixels; access and revision are still checked before each use.

Live policy, membership, source revisions, prerequisites and the prepared-call fence
are still checked at execution. Bob and specialist context renewal unloads detailed schemas
and refreshes the prepared-call fence before its first fresh provider request;
it preserves work/results and reopens only what the next step needs. Full
descriptions remain versioned in the one AI catalog, rather than copied into an
ever-growing permanent base prompt. The inline and earlier on-demand-manual modes
remain compatibility paths for their pinned executions.

Plantus, Vera and Rita receive only a calculator card for their scoped assignment.
They request its manual through `describe_tool`, then use its native schema on the
following step. Their strict output contract, source assignment and independent
review remain in force; they do not inherit Bob's private transcript or project-wide
toolbox. `specialist_tool_instructions_version: 1` selects this behavior for new
manifests; earlier journaled specialist calls retain their exact original input.

Daisy and Kjell have no runtime dispatch or active catalog entry. Drawing geometry
is compiled from the exact checked construction and rendered deterministically;
Rita reviews that candidate. Plantus/Vera cards describe compile/audit;
`edit_project_plan` uses deterministic validation without calling either colleague.
Immutable historical catalog versions, manifests and execution evidence remain
retrievable; they do not restore removed capabilities.

## Capability supports autonomy; prompt prose does not replace it

Bob chooses the work, tool and investigation path; the server provides
discoverable, caller-eligible, actually executable capabilities with usable
manuals, source-linked context and honest execution receipts. A catalog row
or a green isolated handler test does not prove Bob can use that capability in
a real turn. Tool success is not completion of the owner's request; acceptance
remains with [the conversation contract](ask-bob-conversations.md) and
[the user outcomes](user-stories.md).

When Bob stalls, repeats work or asks needlessly, diagnose what was **offered
and callable**, what context and previous receipts survived, which operation
failed, and what user-facing outcome is still missing. Fix the owning tool,
context or execution seam before prescribing a tool order, a confirmation
loop or a new behavioural prompt clause. Preserve backend authority, physical
uncertainty and high-consequence decisions. The [prompt-craft guide](prompt-craft.md)
owns how to write prompts, not this runtime contract.

## Current toolbox contract — 2026-09-27

This remains the baseline for older manifests. The new [card contract](#tool-and-colleague-cards--2026-10-18)
supersedes its loading behavior only after the new version is explicitly activated.

**Definition ownership changes in the 2026-10-09 catalog implementation.**
[The AI catalog owner](../supabase/README.md#ai-definition-catalog-and-model-tiers)
describes database versions, request manifests and tiers. This changes the source
of offered contracts; it preserves the bench, execution gates and inline-manual
baseline below. Hosted installation is recorded separately in the release PR.

**Supersedes the two-tier core/on-demand loading, `list_tools`/`load_tool` discovery and phase preloads described in [Product rule](#product-rule) and [Prepare, discover, load, execute](#prepare-discover-load-execute).** Those sections remain as history of the September 21–26 design. The dated [runtime review](bob-ai-runtime-review-2026-09-27.md) records why.

- **One bench.** Every policy row that is active, has a registered handler with a matching schema version and passes its server gate is offered on every tool-enabled model step. The exact parameter schema and description come from the pinned `tool_contract` database version; migrated descriptions retain the previous technical guidance and inline manual. There is no discovery round and no model-interpreted capability search.
- **Shelves.** The system prompt lists the bench on fixed shelves (`TOOLBOX_SHELVES` in `project-tools/bob-tools.ts`): records, project/phases/Areas, living plan, Tasks and build days, measurements and design decisions, drawings and CAD, materials, images, building, knowledge. A test requires every active catalog row to sit on a shelf.
- **Waiting and used up.** A tool whose prerequisite does not exist yet (for example `save_cad_design` before a reviewed candidate) or whose budget is used is not offered, but its shelf entry says so. A caller who may not use a tool (for example a guest and any write) sees neither the tool nor its shelf entry.
- **Bob chooses.** The server never sets `tool_choice` for Bob or the CAD designer. Phase is no longer a loading hint; `always_load` and `preload_phases` stay in the catalog as data but do not change the bench.
- **No quote parameters.** Change provenance is filled by the server from the owner's current message ([writes](ask-bob-writes.md#server-owned-change-provenance--2026-09-27)); offered schemas never contain `request_quote`.
- **Authority is unchanged.** Offering is not authorization. Every execution re-reads policy, re-checks the gate and version, and runs the handler's own validation. The set offered to one step remains a fence: a tool that becomes available during a batch returns `not_offered` and is callable from the next step.

The current synthetic payload and its limits are recorded in the [runtime baseline](foundation-verification.md#k2-runtime-payload-baseline--2026-10-03). Stable prefixes may be cacheable; actual provider cache usage and cost require measurement.

Deployed release B adds `change_construction_parameters` to the Drawings and CAD shelf and existing write-budget gate. The model sends changed saved input IDs, values/units/reasons or exact source revisions; the handler owns geometry compilation and unchanged metadata. The [Artifact owner](artifacts.md#parameter-changes-before-drawing--specified-2026-10-10) owns its boundaries and explicit downstream construction version. The generated catalog publication updates only this tool, `design_project_cad` and the toolbox, preserving immutable older manifests and role/model settings. Earlier pinned manifests omit the new handler while keeping their own existing tool bench. [Verification](foundation-verification.md#bounded-construction-changes--release-b) records hosted activation and remaining real member acceptance.

Release C adds `transition_legacy_drawing` on the same shelf/write gate. The database owns the copied geometry/graph and atomic origin/receipt; the model cannot send a replacement recipe or dimensions. Null evidence returns grouped gaps; exact existing-checkpoint reuse returns a `reused` Artifact receipt without creating a construction revision. The catalog adds this contract and updates only the CAD reader/render manuals and toolbox. Older immutable manifests omit the handler even when live tool policy includes it. [Artifact](artifacts.md#legacy-drawing-transition--release-c) owns first-pin/history semantics and [verification](foundation-verification.md#legacy-drawing-transition--release-c) owns installation/readback.


## Joint fasteners in construction tools — 2026-10-26

Publication `joint-fasteners-v1` (`scripts/build-ai-joint-fasteners-catalog.ts`)
applies to manifests from that publication only. Earlier manifests keep their
joint schema and journal sequence.

- **The `fastener` field.** Each joint in `save_construction_draft`,
  `transition_legacy_drawing` and `edit_construction_parts` has an optional
  `fastener`.
  - **Null applies the fixed rule.** Bob sends a choice only when the owner
    chose another fastener, such as nails. A missing count or spacing is
    spread by rule.
  - **Explicit choices are the only ones stored.** Sending null for an
    upserted joint removes an earlier choice.
  - **The human-text guard checks the reason.**
- **What `derive_construction_lists` shows.** It reads
  `bob.read_construction_fasteners` for the exact revision and shows:
  - each joint's fastener, with the rule's own proposal next to a choice
  - totals by kind and size, and glue packages
  - a `fastener_capacity_unverified` gap
  - per-joint rule notes
  An unreadable schedule shows as `fastener_schedule_unavailable`. Nothing is
  invented.
- **Older pinned calls.** Calls without the field get `fastener: null` before
  schema validation, the same precedent as `instance_policy`.
- **Exact needs (live 2026-10-26, PR #339).** Publication
  `exact-fasteners-v1` (`scripts/build-ai-exact-fasteners-catalog.ts`) adds one
  note to `derive_cad_material_requirement`: fastener and glue needs are exact
  schedule counts, so Bob omits `waste_percent` and recommends any spare in the
  reply. A nonzero allowance is refused as `fastener_quantity_exact`, which the
  writer turns into the same instruction
  ([material owner](material-planning.md#exact-counts-without-waste--owner-decision-2026-10-26)).

The rule and its limits are owned by
[Artifacts](artifacts.md#joint-fasteners--owner-decisions-2026-10-26).

## Construction roles and continued changes — release D

Three versioned catalog tools extend the existing Drawings/CAD shelf: `change_construction_roles`, `read_construction_changes` and `continue_construction_change`. [Artifact](artifacts.md#instance-roles-and-affected-outputs--release-d) owns roles and output-history semantics, [material](material-planning.md#role-aware-manufacturing-and-continuation--release-d) owns deterministic quantity/layout reuse, and [CAD](cad-adapter.md#reference-geometry-and-exact-role-versions--release-d) owns exact rendering. Full construction saves also expose nullable versioned `instance_policy`. Older pinned schemas may omit it; the runtime preserves uncertainty/inheritance and never assigns default manufacturing roles.

Read saved change work after numeric, role or full construction revisions. Follow all pages. Queue readback includes compact public receipt headers rather than repeating whole output packets; reopen the exact output when its details are needed. Process need items before cuts; drawing items return exact existing pins for `design_project_cad`. `action=recalculate` carries no quantities/geometry/placement inputs. For a linked Step, inspect changed outputs and necessary ordinary plan/work actions, then `action=record_work_review` with the exact current plan `output_revision` and an honest note. Work reviews retain completed/performed history and never claim physical verification. Blocking commitments/allocations require their normal resolution commands.

Preparation and queue reads use fresh caller RPCs rather than replaying an old journal progress snapshot. The writer repeats guards under the database lock and stores the original operation receipt. Already completed items are reused; stale heads and changed operations stop instead of duplicating outputs. The existing per-turn write/call/cost budgets remain unchanged. A saved queue supports later continuation; it does not promise every linked output fits inside one turn. Install both D core migrations and matching ask-bob/worker sources before activating the D catalog. Earlier manifests and all model/role settings/prices remain immutable.

Legacy/manual linked needs are included in the work list even without a recorded model. `needs_requirement_model` requires an explicit supported definition/mode through `derive_cad_material_requirement`, under the same need ID and exact changed construction revision. Model inputs must not be guessed from a name, free-text basis or old quantity. Normal typed source publication then completes that item. An explicit ordinary archive instead retires a no-longer-required need, preserving its original model/quantity/history.

## Calculator and saved calculation models — specified 2026-10-11

**Product decision; the first common calculator is implemented in the 2026-10-12 branch.** Hosted activation and actual model evidence belong to the [release verification](foundation-verification.md#common-calculator--2026-10-12); code presence is not an installation claim.
AI describes the calculation model and proposes explicit design assumptions;
code executes the mathematics. Bob and delegated specialists must use the same
calculation capability. A computed project value needs an executable model and
traceable inputs, not arithmetic copied from an AI answer. Keep measured inputs,
design decisions, estimates and derived results distinct.

Expose a common calculator tool through the existing registered-handler,
versioned AI-contract and policy seams. It must execute supported, versioned
methods or a validated declarative dependency graph, with named inputs, units and
an explicit rounding policy. Do not execute arbitrary model-authored code or
expressions through `eval`. An unsupported formula or missing input is a concrete
gap; it must not trigger a model-arithmetic fallback or an invented zero. Extending
the supported operations/methods is a reviewed code change.

One tool surface does not require one new formula table or a second calculation
engine. Preserve the existing owners and distinguish three layers:

| Layer | Version and storage owner |
|---|---|
| Reusable method and supported operations | Versioned executable code. Fixed domain methods reuse their current evaluator; the AI catalog owns the offered tool contract, not the mathematical definition. A changed formula gets a new method version; existing saved versions keep their original semantics and remain replayable. |
| Project model, inputs and dependencies | The existing domain revision: construction parameter graph, stair recipe with exact source plan, or material requirement basis. Project-specific declarative formulas belong with that revision. Source values are read from authorised exact database revisions; AI supplies references, not copied source values. Explicit proposed inputs retain decision/estimate provenance. |
| Calculation result | Returned by code with method/operation versions, input provenance, units and rounding. A saved result/basis belongs to the same owning domain revision through its canonical writer and receipt. Where results are derived on read, replay the pinned method and inputs; do not create a competing stored-result source. |

**Existing stair example.** `inspect_stair_options` already calls
`stairSummary`/`stairGeometry` in `src/lib/stairStudy.ts`; it reads the exact
authorised multi-floor plan and computes total rise, rise per step and
`step_formula_mm = 2 * rise_mm + going_mm` in code. `save_project_stair` stores a
`stair_study_v1` recipe and exact parent plan revision in
`bob.artifact_stair_studies`. The [Artifact stair owner](artifacts.md#stair-geometry-study--implementation-branch-2026-09-19)
owns persistence, history, shape limits and checks. Reuse this evaluator rather
than teaching the model to reconstruct heights or introducing another stair
formula store. Evaluating the formula and selecting an evidenced project criterion
are separate concerns; the numeric result alone is not a suitability approval.

[Construction graphs](artifacts.md#parameter-changes-before-drawing--specified-2026-10-10)
already execute saved operands and versioned operations in code and validate them
on save. [Material calculations](material-planning.md#truth-classes-in-4b2a)
own supported quantity methods and purchase arithmetic; AI-supplied manual base
quantities must retain manual provenance. The common calculator must not relabel
them as computed or silently convert estimates into measurements.

Implementation acceptance must exercise the actual offered tool and caller scope,
unit/rounding errors, missing inputs, exact-revision replay after reload, changed
sources and retry without duplicate saved results. Include a stair calculation
and a dependent construction dimension; domain formula tests alone do not prove
the common tool or its use by a real model. [State](bob-delivery-flow.md#state)
owns sequencing and remaining implementation.

### Existing evaluators and first common-tool boundary

The [calculation review](foundation-verification.md#calculation-and-formula-review--2026-10-11)
traces the repository's evaluators through their canonical save/read boundaries.
This inventory describes executable code; it does not establish hosted installation
or common-tool/model acceptance. Domain owners retain their release status.

| Calculation | Executable method and precision | Model/result owner |
|---|---|---|
| Dependent construction/CAD dimensions | `cad-parameters.ts`: `add_v1`, `subtract_v1`, `multiply_v1`, `divide_v1`; scaled BigInt, six decimals; `exact` rejects a remainder, `half_away_6` rounds ties away from zero. SQL independently recomputes on save. | Construction revision `parameters` or CAD revision `manifest.bob_parameters`: operand IDs, source snapshots, bindings and rounding. Read/inherit validates the saved graph; source changes remain separate from saved values. |
| Stair rise, step formula, pitch and headroom | `stairStudy.ts`, `stair_study_v1` / `1`; total rise comes from pinned floor heights, rise is total/risers, step formula is twice rise plus going. Coordinates use 0.001 mm; equal-rise division and trigonometry retain floating-point results. | `bob.artifact_stair_studies` pins the recipe and parent plan revision; results derive on read. Never round every rise before deriving the total or applying a criterion. |
| Wall net area and sheet layers | SQL `stud_wall_net_area` / `4B2b-v1`, `stud_wall_sheet_layer` / `1`; mm²→m², optional layer count, upward base normalization to 0.0001 m². Declared unit coverage must be exactly representable at that precision. | Immutable material requirement revision, drawing/measurement pins and, for layers, `sheet_layer` input snapshot. Area-based coverage does not establish cutting fit. |
| CAD/construction blanks | SQL `cad_blank_<mode>` / `1`; `construction_blank_<mode>` / `2` in D counts manufacture instances only. Pieces, explicit axis length or box face area; quantities round upward to four decimals. | Material requirement revision plus exact Artifact/definition/mode and construction source snapshot. Earlier v1 quantities keep their original history. |
| Allowance, allocations and purchase increment | SQL material planner: apply allowance once, round upward to four decimals, subtract confirmed compatible allocations, clamp the shortfall to zero, then round upward to the purchase increment. | Same requirement revision. A manual base remains manual even though its purchase arithmetic is derived. |
| Aggregated supplier packs | Caller-authorised SQL `pack_purchase_quote`, `k4-pack-aggregate-v1`; sum net needs before one whole-pack ceiling. Missing pack size returns unknown. | Exact article/need revisions in quote; canonical pack-purchase revision/receipt on publication. The quote RPC exists but is not offered as a Bob calculation tool. |
| Candidate-sheet cutting | `constructionCutFit`, `construction-sheet-guillotine-v1`; integer six-decimal working mm, explicit kerf/trim/grain, bounded guillotine search. | Read-only assessment; saved plans pin construction and candidate sources and SQL revalidates the layout. Feasibility is not an optimal purchase count. |
| Earlier drawing recipes | `artifactGeometry.ts`, `storageBox.ts`, `roomLayout.ts`, `buildingPlan.ts`: bounded versioned recipes, integer micrometre geometry and exact source pins. | Existing Artifact generation/layout/plan revisions; no second geometry or formula store. |

The reviewed implementation seams are below. The v1 boundary and explicit remaining gaps are recorded in [Common calculator v1](#common-calculator-v1--implementation-2026-10-12):

- **Reuse with typed scope.** Separate graph evaluation from CAD path binding
  without changing v1 arithmetic. Its units are only `mm`, `deg`, `scalar`;
  multiplication requires a scalar operand. General area/volume/money arithmetic
  is not supported by that graph. Fixed material methods retain their SQL owners;
  a new operation/unit contract needs its own version and save validation.
- **Make outputs traceable.** Return method/operation versions, named input values
  with provenance and exact source revisions, dependencies, output units and
  rounding. Stair rise/pitch need an explicit numerical/display policy, keeping
  their existing full-precision evaluation. Distinguish historical replay from
  current-source readiness. Stored quantity history alone does not prove a
  read-only replay API for every method; D's v1/v2 count semantics need separate
  replay tests before claiming support.
- **Offer one capability to the actual callers.** Bob's governed registration is
  separate from CAD research/designer tool arrays. CAD and Plan reviewers/compiler
  currently request strict JSON without tools; `openai-service.ts` omits
  `text.format` when `tools` is supplied. Giving those roles access requires a
  bounded calculation phase and a validated final response, preserving authority,
  pinned catalog contracts and the existing aggregate call/cost limits.
- **Save through the owning revision.** Previewing does not save. The supported
  stair, construction and material models already have canonical writers and
  receipts; reuse them and verify reload/retry. A standalone graph has no current
  generic saved-model writer and cannot be called saved without an explicit
  domain contract and receipt. Unsupported methods and missing inputs stay gaps.

Measurement mm/cm/m conversion and catalog inch/fraction normalization already
have exact code/SQL paths; preserve those rather than asking AI to preconvert.
Authored time/price display helpers are separate from these model contracts:
`savedTaskEstimate` sums recognised saved task estimates to one decimal hour,
while [Shopping price text](material-planning.md#authored-prices-and-display-total)
currently has a reproduced parsing defect. Neither establishes a complete
project effort or verified price calculation.

### Common calculator v1 — implementation 2026-10-12

`calculate_project` is one registered, catalog-versioned read-only capability for
Bob, Plantus (plan compiler), Vera (plan reviewer) and Rita (CAD reviewer).
They check the same live active/schema-version policy before offering and
executing it. New `work_allowance_version: 1` jobs have no application calculation,
model-call, spend or output-token quotas; usage accounting, provider capacity,
authority and dispatch guards remain. Historical bounded jobs retain their shared
twelve calculation attempts per turn, including invalid attempts, and specialist
limits of two calculation rounds with at most four calls per batch. Models and
reasoning effort are unchanged.

| Request method | Executed model and persistence boundary |
|---|---|
| `parameter_graph_v1` | The existing six-decimal evaluator, separated from CAD path binding. Named outputs retain source snapshots, decision/estimate roles, operand IDs and operation/rounding versions. This is a preview; persist a construction graph with its canonical construction writer. |
| `construction_parameters_v1` | Replay the exact saved construction recipe/graph with its original snapshots and validate it before returning derived nodes. A separate fresh caller read reports current-source readiness; a newer head never changes the historical result. |
| `stair_study_v1` / `saved_stair_study_v1` | Inspect an explicit recipe on an exact authorised multi-floor plan, or reopen an exact stair revision and parent plan. Reuse `stairSummary`; return full-precision rise/formula/pitch and an explicit three-decimal display policy. Display-rounded rise is never an evaluator input. Save through `save_project_stair`. |
| `material_purchase_v1` | Reopen an exact requirement revision and replay allowance, saved allocations, zero-clamped shortfall and purchase-increment rounding in SQL. The canonical writer and reader share `material_purchase_math_v1`. Manual base quantities remain manual. Construction blank v1/v2 bases replay from their typed immutable instance/dimension snapshots with their original count semantics. Other deterministic base methods are explicitly `stored_only`, not falsely claimed as historical replay. |
| `pack_purchase_v1` | Reuse the caller-authorised `pack_purchase_quote` and read exact article readiness. Sum net needs before whole-pack rounding. Unknown pack size remains null with a named gap. A quote does not publish, reserve, deliver or save a purchase. |

Results identify schema/method versions, named inputs/dependencies/outputs,
units, rounding, domain owner and exact model/source revisions. `saved=false`
means this invocation performed no write; `model.persisted` separately says
whether it replayed an existing saved model. Proposed inputs do not become
measurements. Source changes are readiness information, not permission to adopt
new values. Exact database reads enforce project/physical access through the
caller; the new RPC is invoker-only and has no anon/service grant.

Structured specialists retain their pinned strict JSON response schema and
receive only the assigned calculator card. They request its manual with
`describe_tool`; the native `calculate_project` schema becomes available on the
following step. Each tool result is paired with its call in the same provider
conversation. Context renewal refreshes the tool surface and requires the manual
again. Older immutable manifests retain their exact eager request inputs for
journal replay; their applicable work policy still determines any quota.

An actual calculation request stops if access is revoked, live tool policy becomes
unavailable or its applicable allowance is exhausted; it cannot become a
model-only arithmetic verdict. Invalid inputs, missing data and source-specific
read failures remain explicit paired results that the specialist may correct or
report within its authority. A task needing no arithmetic may return its normal
structured answer even when the optional calculator is unavailable. Provider
failure remains an error. CAD dependency refresh records calculation source reads
so a saved retry cannot treat changed inputs as unchanged.

The calculator executes deterministic program/SQL operations and makes **no AI
calls**. Manual discovery and calculation add provider continuations when needed;
a no-arithmetic answer can finish the first model call. The adapter's
`structuredToolOutput` opt-in sends the pinned schema alongside available tools
and strictly validates the final JSON; it never repairs truncated JSON or phase
prose into a verdict. Existing shared-service callers retain their output contract.
The retired `calculator.schema-phase` fragment remains only in immutable history;
the current specialist instructions come from the published catalog.
[Original integration evidence](foundation-verification.md#calculator-in-normal-structured-calls--2026-10-12)
records the earlier eager-call release; [coverage release evidence](foundation-verification.md#bob-context-coverage-corrections--2026-10-18)
records current discovery and policy verification. Actual cost per accepted
drawing and ordinary owner/model/CAD acceptance remain to be measured.

Remaining boundaries: a standalone graph has no generic saved-model writer;
use the existing domain revision or report that gap. General area/volume/money
operations are not part of the v1 graph. Historical wall/CAD-only base replay,
cutting/geometry exposure beyond the existing specialist tools and the separate
Shopping authored-price fix remain with their existing owners. The common tool
cannot claim those capabilities from a stored number alone. Actual model and
member acceptance remain distinct from scripted domain/SQL tests.

## Opt-in manual experiment — 2026-10-03

**Implemented comparison candidate; not enabled by hosted callers or deployed.**
The intended direction is that Bob sees what each permitted tool does and when it
is useful, and retrieves deeper instructions when needed. Tool availability and
instruction depth are separate decisions. This experiment moves only the catalog
`how_to` out of the inline description; the short catalog purpose, complete code
description and exact parameter schema remain visible. All eligible domain tools
stay callable without a discovery/load step or mandatory manual read.

Internal callers can pass `toolInstructions: 'on_demand'` to the existing Bob
loop/session. The default is `inline`; no HTTP request field, database setting or
hosted call site enables the candidate. The session then offers `describe_tool`
with one exact `name`. This is a read-only session metadata operation, not a new
domain handler or catalog permission. It returns the current combined manual and
schema version for a visible tool. Waiting and exhausted tools can be explained,
but reading never changes their gates, loads a capability or performs a write.
Policy and target eligibility are re-read on every manual request; hidden,
disabled, unregistered and version-mismatched tools reveal no manual. The prepared
visibility/version fence and final closed bench still apply. Manual calls consume
the same model-step and per-step call limits as other calls.

Run `node --import tsx scripts/audit-bob-runtime.ts --compare` for the inline/separate/batched/selective
comparison. Independent manual requests can share one native tool-call batch;
each request retains its own execution-time policy check. Retrieval strategy is
scripted only in the audit, with no production router. [Evidence and trade-offs](foundation-verification.md#k2-tool-manual-comparison--2026-10-03)
include retrieval overhead: a smaller first tool surface does not establish lower
total cost or better delivery. The candidate retains sizeable schemas and code
descriptions. Retrieval timing is scripted; real model selection and quality
remain unverified. [State](bob-delivery-flow.md#state) owns the next decision.

## Product rule

> Historical (2026-09-21 to 2026-09-26). Superseded by the current toolbox contract above.

The starting toolbox is not the complete toolbox. Bob must be able to find an
implemented permitted capability, load its exact contract, and continue the same
user task without another approval loop. The user never has to write JSON, choose
API names or approve a read of a tool guide.

Two availability tiers, separate from depth of description:

- **Core:** eligible tools supplied on every normal tool-enabled model call.
- **On demand:** eligible tools preloaded for useful project phases or loaded by
  exact name during the turn.

Phase is a preload hint, not authority. A design tool may be loaded during Build
without changing project phase. A phase change cannot grant rights to another
project, a Building, a write, a purchase or a completion. The bounded final-answer
call remains tool-free; directory availability does not promise an unbounded loop.

## One catalog and one handler-registration seam

`bob.tool_catalog` retains operator-owned **live policy metadata**: stable name,
schema version, active flag and legacy descriptions/loading fields. Authenticated
identities can read it; ordinary users cannot modify it. The AI catalog's
`tools.<name>` definition owns the model-facing description, manual and exact
JSON parameter schema. Its immutable version is pinned for the turn. Neither
catalog contains project facts, credentials, executable code or per-user grants.

`project-tools/bob-tools.ts` is the sole registration seam connecting a catalog
name to a validated handler and server-derived eligibility gate. The runtime
intersects the live policy, pinned tool contract and registration. A missing
contract, unregistered handler, disabled policy row or mismatched schema version
cannot become callable. Database schema changes must remain compatible with the
registered validator/handler; activation cannot add executable behavior. Adding
a new handler does not require editing the model loop.

`catalog-seed.json` is the complete migrated offline policy, including inactive
rows and phase preloads. `tool-catalog-parity.test.ts` installs all migrations and
compares every row/field. Production always supplies the caller-JWT reader;
failed live reads never fall back to the seed. Operator edits must be recorded in
a new migration and regenerated seed to retain parity. The dated
[September 25 audit](bob-tool-autonomy-audit-2026-09-25.md) preserves the earlier drift.
Already committed migrations are never edited to change a live loadout.

After catalog rollout, legacy policy/manual parity does not determine the active
provider schema. Activate a new AI definition version for model-facing contract
edits, and preserve the separate live policy/handler compatibility checks. The
[catalog owner](../supabase/README.md#authoring-activation-and-release) owns
activation and rollback.

There is no new grant editor in this slice. Eligibility reuses the actual
capabilities of the authorised turn: for example, a shared guest has no claimed
writer and therefore cannot discover/load/invoke writes. Private history needs
its private conversation context. Domain RPCs remain the final authority for
exact records, physical edits, selected targets and permitted fields. A loaded
write tool does not imply that every Building or record is writable.

## Prepare, discover, load, execute

> Historical (2026-09-21 to 2026-09-26). Superseded by the current toolbox contract above; `list_tools`, `load_tool` and the `bob-tool-discovery` call no longer exist.

The per-turn `project-tools/session.ts` resolves a fresh caller-JWT policy for
prepare and again for execution. The initial load combines eligible core rows
with eligible rows whose preload phase matches the current Project phase. This
version reads the actual `bob.projects.phase`; it does NOT infer an Area or
screen selection from chat, add a browser authority field, or implement the
planned Current View. Future Area-aware hints must use a server-verified pointer.

`list_tools({query, after_name})` returns up to 12 permitted registered names and
short descriptions, their loading/availability state, and a continuation cursor.
A query is interpreted by the governed `work-router` model against the eligible
names, descriptions and guides. No Swedish/English keywords, object aliases or
negated-description substring matches route the request. Exact returned names
are intersected with eligible handlers; interpretation cannot register tools or
grant authority. Rankings are cached only within this turn and exact policy
snapshot for stable pagination. Search failure reports `browse_fallback` and
returns browse pages. `query:null` and exact-name loading need no model call.

`load_tool({name})` returns exactly one tool's full parameter schema, description,
version, detailed catalog guide and implementation notes. It also records the
activation in turn-local state. On the **next model call**, that exact native
function schema is in `tools[]`; the result is not merely JSON prose which the
model cannot call. Loading does not execute the handler or authorize its effects.
An already loaded tool can be reloaded to reread its guide.

Only tools offered for the model call that emitted a request can execute. A model
cannot load and invoke a previously absent tool in the same returned tool batch:
the invocation gets `not_loaded`, with an instruction to use the next call. This
fence prevents guessed/stale schemas becoming a back door. The dispatcher also
rechecks live policy and handler eligibility before invocation. Disabled/revoked
or version-mismatched tools do not retain authority through an old packet.

Loaded tools remain in the same turn until disabled, ineligible, version-changed
or the normal finalization boundary. A fresh turn derives its own starting set;
load state is not an enduring grant. The same schema can be loaded again then.

The CAD delegation tool now uses schema version 2 with the structured handoff and independent review owned by [CAD](cad-adapter.md#structured-handoff-and-independent-review--september-25). Register/deploy that handler before the catalog version flip; mismatched versions stay uncallable.

A drawing request identified by the server's per-turn delivery routing also
offers `design_project_cad` through this same policy/version/budget intersection.
It does not change project phase or grant write permission. Missing CAD target
prerequisites expose the existing solution/target tools; a rendered candidate
exposes its exact save tool. The [conversation contract](ask-bob-conversations.md#drawing-delivery)
owns routing cost, continuation bounds and the saved-Artifact completion check.

## Failure, cost and evidence

Keep separate results for `not_loaded`, `not_allowed`, `missing_context`,
`budget_exhausted`, `not_found`, `unavailable` and `contract_changed`. A catalog
transport failure is `tool_catalog_unavailable`, not a successful empty list.
Arguments required for a particular drawing, such as an exact source or selected
target, are still checked by that tool; this slice does not promise a complete
preflight of every possible argument before the model supplies it.

The directory/loading budget is independent of project lookup, image and write
budgets; loading never resets one. Bounds are 128 registered policy rows, 12 rows
per directory page, 16 management operations and 24 distinct loaded names per
turn. The execution loop allows 24 model rounds, with a tool-free final round and
elapsed-time fencing. Only queried discovery calls the routing model; browse and
load do not. Claimed writers also use the general work-intent call owned by the
[conversation contract](ask-bob-conversations.md#delegated-work-delivery). The
routing configuration has low reasoning and explicit output ceilings, separate
from Bob and the designer's high reasoning configuration.
Lazy loading limits the initial schema/guide payload; no measured end-to-end
latency improvement is claimed.

Tool guides are server-owned interface documentation, not user permission or
project facts. They never become measurement/image/project sources. Actual reads
still produce their normal provenance; mutations still need a current-request
quote and a verified canonical receipt. A catalog failure after a committed
write must settle the write and retain receipt-only recovery rather than retry
it or falsely report it undone. Image-context revocation behavior is unchanged.
The operational trace records tool name/status and model role, latency and token counts, not arguments or project content. Model execution traces are emitted inside the journal operation, so replay does not appear as another model request. Tool outputs expose remaining execution/read/write/correction/CAD budgets.

## Original catalog-release scope (historical)

This release makes existing tools discoverable and accurately described. It does
not turn `storage_box_v1`, `room_pair_v1` or the bounded stair generator into
arbitrary-object drawing capabilities. Legacy specializations are on-demand
entries, not a general `create_drawing` alias. No `bunk_bed_v1` is added.

The next independent drawing capability must operate on reusable geometry,
parts, parameters, relationships and anchored instances while reusing existing
Artifact identities, versions and source links. A bed, shelf and previously unseen
assembly must be different CONTENT, not different server code. Derived dimensions
must come from the same model as the visible geometry. Drawing flexibility is not
structural certification or permission to run arbitrary model-authored code.

Its acceptance gate must include an initially non-preloaded tool discovered and
loaded by a real model, creation and revision of different/unseen objects without
code changes, same-artifact readback, linked-dimension recalculation and accurate
in-app display. Catalog tests alone cannot satisfy that product gate.

The [building-knowledge plan](building-knowledge.md) remains complementary:
rights-checked construction/VVS/electrical seeding and source-grounded retrieval
teach methods; the generic drawing capability expresses/calculates them. No
reference corpus or embeddings are seeded by the tool-catalog release. AR remains
paused/discovery, not an implemented feature or prerequisite.

## Verification and release

`tool-session.test.ts` covers loading policy, paged browsing, exact contracts,
activation fences, independent budgets, revocation and malformed catalogs.
`tool-catalog-runtime.test.ts` uses the production loop, real writer parsing and
settlement with injected I/O: list -> load -> invoke -> persisted receipt, guest
denial and catalogue failure recovery. `tool-catalog-db.test.ts` applies the exact
DDL to PGlite and checks seed equality, RLS/grants and live policy changes.

Existing domain/SQL scenarios use explicit fixture loadouts through
`tests/support/tool-loadout.ts`; their real handlers/schema/RLS/receipts are not
bypassed. Default discovery has separate tests. The unchanged ordinary CI remains
the full regression gate, including the mobile/desktop browser journeys.

**Evidence limit:** injected model responses do not prove autonomous real-model
selection or a named-member drawing conversation. The existing unchanged hosted
guest smoke proves real-model text retrieval and access boundaries, not the new
list/load behavior. No real user's house/photos are used as test fixtures. No
workflow privilege, local browser restriction or blocked test publication is
bypassed to make a test appear complete.

Only the new additive Bob catalog DDL is required. Existing deployed handlers
already exist; the new dispatcher must validate registration before exposing
rows. For future handler additions: ship dormant handler/schema first, then
activate its matching catalog version. Never advertise an unimplemented handler.
Record exact managed migration history and deploy the verified immutable merged
source with JWT enforcement unchanged. Confirm Edge readback, matching release
marker, Pages and hosted checks before calling the release live. Rollback to the
previous Edge version leaves the unused additive catalog harmless; do not replay
or drop shared migration history.

## Expert tools and prompt delivery — 2026-09-24 integration

Every offered tool now carries its implementation description and usage guide, including preloads. The permanent system text lists names only; the image-grounding wrapper adds fresh evidence but no second behavioural prompt. Context instrumentation records character/byte counts, tool surface and remaining time, never message text or images.

New generic tools cover measurement archive/restore, solution create/revise, scoped target selection and task status/people assignment. Existing canonical commands, caller JWT, revisions and claimed-turn receipts remain authoritative. The plan compiler remains a representation assistant; Bob performs project mutations. CAD has its own research/render tools and standard/high model, documented in [CAD adapter](cad-adapter.md).

`read_project_record_section` navigates exact large plan/CAD records with JSON paths and bounded responses. A size limit cannot masquerade as an empty successful record. It does not increase project access or make partial evidence complete.

Image generation, attachment and finalization use [the media contract](media-and-steps.md). These tools are catalog-discovered, not a new permanent list of incident-specific prompt instructions.

## Focused edits and ready dependencies — September 25

`edit_project_plan` is a core read-only preparation tool; its exact changes and
evidence continuity are owned by [the living plan](living-project-plan.md#focused-plan-edits-and-evidence-continuity--september-25).
Prepared plan/CAD saves and missing CAD prerequisites may be offered by server
state on the next round without another discovery call. This never bypasses
active catalog/version checks, per-call authorization, writer budget or the
current round's offered-tool fence. A disabled tool remains disabled. The live
compile/save/decision guides now agree that Task links are staged and applied
atomically on approval, and distinguish a specific apply instruction from a
request for proposals. The September 24/25 generic CAD integration supersedes
the original catalog release's future-tense geometry section above.
