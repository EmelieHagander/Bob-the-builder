# Ask Bob: tool discovery, loading and authority

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

**Published and activated through PR #267; ordinary owner/model acceptance remains.**
[Release evidence](foundation-verification.md#bob-context-strategy-release--2026-10-18)
records the installed runtimes and catalog. The [context owner](ask-bob-conversations.md#context-strategy--2026-10-18)
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

Live policy, membership, source revisions, prerequisites and the prepared-call fence
are still checked at execution. Main-role context renewal unloads detailed schemas
and refreshes the prepared-call fence before its first fresh provider request;
it preserves work/results and reopens only what the next step needs. Full
descriptions remain versioned in the one AI catalog, rather than copied into an
ever-growing permanent base prompt. The inline and earlier on-demand-manual modes
remain compatibility paths for their pinned executions.

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
Bob, CAD research/designer/reviewer and Plan compiler/reviewer. Every specialist
checks the same live active/schema-version policy before offering and executing
it; policy failure never enables a fallback. All callers share twelve calculation
attempts within the turn, including invalid attempts. Provider calls still use
the existing aggregate call/cost budgets and authority/dispatch guards.

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

Structured specialists offer the calculator in their normal call while retaining
the pinned strict JSON response schema. A direct verdict finishes that first
call. Only an actual calculator request causes a continuation: code executes
the calculation and returns the complete result as a paired tool output using
the provider response ID. The server does not restart the original context in a
separate final conversation. At most two tool rounds, with four calls in each,
are allowed; a third model call closes tools if both rounds were needed.
Provider failure, revocation, policy failure or an already exhausted calculator
stops honestly, without a manual-arithmetic fallback. CAD dependency refresh
records these reads so a saved retry cannot treat changed inputs as unchanged.

The calculator itself executes deterministic program/SQL operations and makes
**no AI calls**. In this wrapper, no calculation normally needs one model call;
one calculation round followed by a verdict needs two. Every model call still
uses the caller's ordinary or CAD task budget, the pinned specialist's output
ceiling (including reasoning) and any explicit caller ceiling. The adapter's
`structuredToolOutput` server opt-in sends the schema alongside the tools and
strictly parses/validates the final JSON; it never repairs truncated JSON or
phase prose into a verdict. Existing shared-service callers retain their
previous output contract. The historical `calculator.schema-phase` fragment
remains immutable in the catalog but is no longer injected; the roles' existing
calculator contracts supply the guidance, so no catalog migration is required.
[Integration evidence](foundation-verification.md#calculator-in-normal-structured-calls--2026-10-12)
owns validation and release references. Actual cost per accepted drawing and
real owner/model acceptance remain to be measured.

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
