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

## Current toolbox contract — 2026-09-27

**Supersedes the two-tier core/on-demand loading, `list_tools`/`load_tool` discovery and phase preloads described in [Product rule](#product-rule) and [Prepare, discover, load, execute](#prepare-discover-load-execute).** Those sections remain as history of the September 21–26 design. The dated [runtime review](bob-ai-runtime-review-2026-09-27.md) records why.

- **One bench.** Every catalog row that is active, has a registered handler with a matching schema version and passes its server gate is offered on every tool-enabled model step. Its description joins the catalog description, the code description and the full `how_to` guide. There is no discovery round and no model-interpreted capability search.
- **Shelves.** The system prompt lists the bench on fixed shelves (`TOOLBOX_SHELVES` in `project-tools/bob-tools.ts`): records, project/phases/Areas, living plan, Tasks and build days, measurements and design decisions, drawings and CAD, materials, images, building, knowledge. A test requires every active catalog row to sit on a shelf.
- **Waiting and used up.** A tool whose prerequisite does not exist yet (for example `save_cad_design` before a reviewed candidate) or whose budget is used is not offered, but its shelf entry says so. A caller who may not use a tool (for example a guest and any write) sees neither the tool nor its shelf entry.
- **Bob chooses.** The server never sets `tool_choice` for Bob or the CAD designer. Phase is no longer a loading hint; `always_load` and `preload_phases` stay in the catalog as data but do not change the bench.
- **No quote parameters.** Change provenance is filled by the server from the owner's current message ([writes](ask-bob-writes.md#server-owned-change-provenance--2026-09-27)); offered schemas never contain `request_quote`.
- **Authority is unchanged.** Offering is not authorization. Every execution re-reads policy, re-checks the gate and version, and runs the handler's own validation. The set offered to one step remains a fence: a tool that becomes available during a batch returns `not_offered` and is callable from the next step.

The current synthetic payload and its limits are recorded in the [runtime baseline](foundation-verification.md#k2-runtime-payload-baseline--2026-10-03). Stable prefixes may be cacheable; actual provider cache usage and cost require measurement.


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

`bob.tool_catalog` is operator-owned **surface metadata**: stable name, short
trigger description, long `how_to`, schema version, core flag, preload phases and
active flag. Authenticated identities can read it; ordinary users cannot modify
it. It contains no private project data, tool credentials, executable code or
per-user grants. Catalog visibility by itself is not execution authority.

`project-tools/bob-tools.ts` is the sole registration seam connecting a catalog
name to its real validated schema, handler and server-derived eligibility gate.
The runtime intersects BOTH sources. A catalog row with no registered handler,
a disabled row or a mismatched schema version never becomes callable. Exact
schemas are sourced from the executable contract, not a separately editable JSON
copy in a database. Adding a new handler does not require editing the model loop.

`catalog-seed.json` is the complete migrated offline policy, including inactive
rows and phase preloads. `tool-catalog-parity.test.ts` installs all migrations and
compares every row/field. Production always supplies the caller-JWT reader;
failed live reads never fall back to the seed. Operator edits must be recorded in
a new migration and regenerated seed to retain parity. The dated
[September 25 audit](bob-tool-autonomy-audit-2026-09-25.md) preserves the earlier drift.
Already committed migrations are never edited to change a live loadout.

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
