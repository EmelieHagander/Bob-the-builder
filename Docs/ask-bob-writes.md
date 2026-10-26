# Ask Bob — bounded project writes

This document owns the source/runtime contract for bounded project writes. Hosted release evidence belongs in the merged release PR and [foundation verification](foundation-verification.md). Dated extension sections below retain their original rollout context; current tool availability comes from the live catalog and handlers.

## Human text holds only prose — owner decision 2026-10-26

**Source only; not applied or deployed.** Owner decision: human text holds only
human prose; references are typed relations, never IDs or codes in free text.
A read-only audit (2026-10-25) found snake_case codes in 24 of 78 Bob replies,
full UUIDs in 12 and "rev N" in 18, and the same fragments in saved notes,
change notes and server-written text. The prompt rule alone did not hold.

`_shared/human-text.ts` `humanTextIssues(text)` is a pure check that returns the
offending fragments by kind: database IDs (UUIDs with or without `@N`, long
hexadecimal runs), internal codes (snake_case tokens, camelCase field names),
tool names, revision numbers (`rev N`, `revision N`) and app links or paths
(app routes, the app's own address, Markdown links to records). External web
addresses, e-mail addresses, file names, camera file stems and ordinary
Swedish/English prose pass, including measurements and the Swedish verb *rev*.

**Writers reject; Bob rewrites in the same turn.** A writer checks only its
human prose fields. Typed fields (IDs, refs, keys, enums, numbers, dates) and
quotes of the owner (`request_quote`, `source_quote`) are not checked. A
violation returns the ordinary `invalid` result with
`validation: {code: 'human_text', fields}` and a short message naming the
fields, fragment kinds and fragments; nothing is written and no model call is
added. It stays a rejected write until corrected, like other field validation.
Bound edits check only text the call supplies (`set`/`append_text` values and a
reason that is saved), so existing saved text never blocks an unrelated edit;
no existing row is rewritten.

| Writer | Prose fields checked |
| --- | --- |
| `project-write.ts` tools (`WRITE_TOOL_PROSE`), including Building intake | Project description; Area/Task names, descriptions and instructions; measurement subject, source, notes and change note; build-day text; readiness labels and notes; stock, requirement and supplier-product text; solution content and design-intent prose; phase and target reasons; catalog names, aliases and notes; plan summary, reason, Step and requirement text; drawing, stair, building-plan, room-layout and shell titles, descriptions, assumptions, sources and notes; Building, level, space and element names, kinds, notes and descriptions |
| `project-work-records.ts` | Changed `/name /description /instructions /subject /source /notes /title /day /time /place /food /label`, readiness `note`, and `reason` where it becomes a measurement change note or phase reason |
| `project-edits.ts`, `project-solution-actions.ts` | Changed title, description, assumptions, tradeoffs and design-intent prose; `reason`; design-reference `note` |
| `construction-draft.ts` (all write tools) | Titles, descriptions, change notes, parameter/frame/role/joint reasons, open questions, cutting-candidate notes and review notes |
| `project-image-tools.ts` | Generated image `title`, before any generation |

Not checked: plan-link reasons (not saved), building scope (no prose), a plan
compiled by the plan colleague and a reviewed CAD candidate (Bob cannot
rewrite colleague text in that call), and Bob's chat answer.

**Server-written text.** Drawing-event replies no longer show the outcome code
or the catalog `next_action` guidance; that guidance stays in model-facing
results. `drawingNotice` maps the outcome to the existing owner meanings:
service failures to `drawing_unavailable`, target and design-readiness
prerequisites to `drawing_prerequisite`, everything else to
`drawing_incomplete`. Gap details carrying codes or IDs are left out. Without a
prepared phrase (budget stop, known CAD-engine failure, language call down) the
language-neutral mark stands alone. A source or write receipt for a record
without a name is labelled by its kind (*Stock item*, *Image*), never its ID.
New construction-blank requirements get a human basis
([database](../db/README.md#human-construction-blank-basis--2026-10-26)).
English default change notes stay.

**Release:** apply the migration, then deploy `ask-bob` and `bob-worker` from
the same source while no Bob job is active: the check is runtime code, not
pinned per job. No catalog publication or prompt change: the rejection message
carries the guidance. `tests/human-text.test.ts` covers the check and every
writer family; notices are in `tests/drawing-resume-reply.test.ts`.

## Server-bound edits and canonical data reuse — owner decision 2026-10-14

**Status: specified architecture principle; implementation remains incomplete.**
This section owns the model/runtime responsibility boundary for data edits across
Bob and his specialists. It refines delivery-flow decision D5. It supersedes any
earlier guidance that makes the model copy database IDs, concurrency versions or
unchanged saved fields into a write. Historical payload descriptions below remain
accurate descriptions of existing implementations until their handlers migrate.

> Bob can inspect and change project data. The model expresses the intended
> change; the system binds its target, retrieves existing data and preserves
> everything the change does not address.

### First implementation: project description and existing solutions

**Technically deployed through PR #254; ordinary-member/model acceptance remains open.**
[Release evidence](foundation-verification.md#server-bound-project-edits--2026-10-14) records exact source, authentication and catalog readback.
`project-edits.ts` exposes `read_project_edit_context` and `edit_project_record`.
The reader returns complete, caller-scoped snapshots, human scope labels and
opaque selections, two records per page. Selected solutions retain the exact
selected revision; a newer head is disclosed and cannot be adopted silently.
Measurement evidence retains its original value, unit, truth and source.

The editor accepts only a selection, bounded sequential content changes and a
reason. It binds request provenance, identity, scope, the version actually read,
measurement pins and image links on the server. It preserves untouched nested
features and decisions, generates IDs for new feature/choice entries, and resets
design alignment to draft unless the edit explicitly supplies a supported new
alignment. Text can be appended without retransmitting the existing description.
Identity, parent, evidence-link and whole-list replacement paths are rejected.

`read_bob_edit_context` is a caller-authorized invoker read. The claimed-turn
`bob_project_write_v17` wrapper delegates to the existing domain writer. A selected
solution revision and its target pointer advance in one transaction; both have
canonical receipts. Stale solution/target pins reject the entire operation.
An exact retry returns the original receipt; a changed retry conflicts. Durable
read/write journaling recreates the same selections after a worker restart,
while project authority is checked live. New manifests route legacy solution
edits to this adapter and disable the legacy description replacement tool.
An unresolved bound edit prevents creating a replacement alternative in that turn.
Historical pinned manifests retain their original handler path.

**Remaining deployed scope:** alternative/selection/evidence actions are now covered by the second implementation below; other write families retain their existing contracts until their separate publication ships. This slice does
not claim that all Bob tools are free of model-supplied database fields. Editing
an unselected alternative does not change a selected target. Reconciling an old
selected revision with a newer alternative is an explicit separate decision.

**Release order:** apply the additive core migration, deploy both `ask-bob` and
`bob-worker`, then apply the generated catalog publication. Verify ordinary
member access, read/edit/readback, stale/conflicting updates, receipt recovery
and a real model run before calling it deployed acceptance. Catalog publication
is separate so a handler upload alone cannot silently change active contracts.
The isolated tests cover the real SQL/RLS/ledger path, downstream rollback,
server restart, model-facing contract and completion after correction. They do
not measure live model latency or cost.

### Second implementation: alternatives, selection and evidence links

**Technically deployed through PR #255; ordinary-member/model acceptance remains open.** `project-solution-actions.ts` adds
`read_solution_context`, `create_solution_alternative`,
`select_solution_alternative` and `change_solution_evidence`. The read returns
paged, caller-scoped alternatives, selected versions, scopes, measurement truth
and image metadata. Opaque refs are held only in the turn; raw identities,
concurrency fields and request quotes are absent from model inputs.

Creation is explicit and separate from revision/selection. A bound base copies
all saved content and evidence pins, then applies only the requested differences.
With no base, only new content is authored. Existing IDs remain on the server;
the database generates the new solution identity. Creation never selects it.
Unresolved edits, evidence changes or selection failures cannot be repaired by
creating another alternative. The new catalog disables both legacy solution
creation and target selection while preserving older pinned manifests.

Selection binds the exact read solution and destination target revisions. A
newer solution head or concurrent target change rejects the action. Evidence
changes add/remove one measurement, set/clear the primary image, or add/remove
one design image reference. Additions bind source revisions/timestamps; removals
use indices from the complete solution read. Source values, truth, other links,
features and decisions are preserved. Evidence changes reset alignment to draft;
selected context advances the same target atomically. Image metadata does not
claim pixel inspection or measured geometry.

The additive `read_bob_solution_context` invoker and claimed-turn v18 wrapper
retain the existing domain writers, project locks, receipts, budgets and live
authority. Exact replay is checked before source freshness; subsequent intentional
selections have separate operation keys. Read/write journals preserve the exact
choices across restarts. Install core, both runtimes, then the separate immutable
catalog publication. No existing data, model settings or older manifests are
rewritten by installation.

### Third implementation: work records and their relations

**Technically active, verified 2026-10-17.** The [current readback](foundation-verification.md#write-conflicts-and-sequential-work--hosted-release-2026-10-17) supersedes the catalog blocker in the [October 15 installation record](foundation-verification.md#server-bound-work-records--2026-10-15-readback). Ordinary-member/model acceptance remains separate. `project-work-records.ts` adds
`read_work_context`, `edit_work_record`, `create_work_record`,
`change_work_relation`, `change_work_state` and `change_task_readiness`. These replace thirteen legacy
writes for Area/Task content, measurements and archive/restore, Task status and
assignees, build days and scheduled Tasks, Area lifecycle, project phase and
schedule, and Shopping deletion. They use opaque read refs and whitelisted
content deltas. Project/Area/current Plan Step/component scope is resolved from
the read; complete existing content and relations stay server-side.

Creation is separate and explicit. The database generates identity; copied bases
and destination scopes must still match their reads. New Tasks start todo and
unassigned; copying content never copies completion. New measurements default
to unknown. An image-backed measurement cannot be duplicated through base-copy;
edit its existing identity or use an explicit evidence operation. Content edits
retain that image, exact truth/source and history. Build day edits retain the
complete scheduled Task list and never change RSVP. Relation changes add/remove
one member rather than asking Bob to replace the whole set. Readiness changes select existing needs/dependencies and checkpoint indices from the read, merge only changed need content, and keep real readiness evidence explicit. Schedule edits merge
unchanged dates; clearing still requires both null. Canonical archive, phase,
completion and deletion rules remain authoritative.

`read_bob_work_context`/`read_bob_work_snapshot` are invoker reads. Claimed-turn
v19 locks and compares complete server snapshots, including relation membership,
before delegating to existing commands. Parent-lock triggers serialize direct
Task-assignee and event-Task writes with full-set replacements, including initially
empty sets. Exact committed retry precedes freshness; separate operation keys
allow successive intentional changes and never take another writer's receipt.
Old durable manifests and RPC names remain unchanged. Install core, both runtimes,
then the generated catalog; a source commit alone does not activate these tools.

### Sequential work changes and conflict recovery — 2026-10-16

Deployed through [PR #259](https://github.com/EmelieHagander/Bob-the-builder/pull/259);
[hosted verification](foundation-verification.md#write-conflicts-and-sequential-work--hosted-release-2026-10-17)
records the migration, both runtime readbacks and acceptance limits.
all five active public writer routes, v16–v20, translate an aborted serialization
or deadlock into `PT409`. PostgREST must return that conflict once instead of
retrying the same stale payload internally. The exception rolls back the entire
delegated write; private domain implementations, caller identity, RLS, grants,
claim checks and receipt transactions stay unchanged. `turn_not_claimed` remains
terminal in the runtime. This also covers older pinned manifests using v16.

After a saved non-delete work action or a known conflict, the runtime reads the
complete target through caller-authorized `read_bob_work_snapshot`. The response
includes `current` with a new immutable ref and human-facing content for the next
change. Old refs remain bound to their original snapshots: an exact retry cannot
append twice, and a changed stale request cannot overwrite a concurrent edit.
Readbacks are journaled so worker continuation reconstructs the same refs.
Create returns the saved identity's ref; readiness refreshes its parent Task;
delete does not attempt to reopen a removed record. A failed, foreign or revoked
readback never creates a ref or changes a verified save into an unknown write.
Scope/source conflicts may still require rereading those related records.

An uncertain write pauses subsequent write tools with `write_uncertain`, while
reads remain available. It must not be described as an exhausted write budget.
The normal write/correction limits, lifecycle rules and completion evidence still
apply. Regression fixtures cover chained content/status/assignment/readiness
changes, another Task, concurrent edits, exact retries, caller revocation,
durable readback replay and transaction rollback at all five public routes.

### Fourth implementation: current plan focus and Task links

**Technically active, verified 2026-10-17.** [Current readback](foundation-verification.md#write-conflicts-and-sequential-work--hosted-release-2026-10-17) confirms the installed core, runtime and catalog; ordinary-member/model acceptance remains separate. `project-plan-links.ts` adds
`read_plan_link_context`, `change_plan_focus` and `change_plan_task_link`.
The reader exposes current approved plan/Step/Task content, scope labels and
opaque refs. The server retains the exact plan head, complete Task/Step records
and current-plan link set. Focus changes preserve parallel Step states. Link,
move and unlink delegate to the canonical plan command and retain Task content,
status, assignments and unrelated links; move intentionally replaces primary
ownership and its previous primary association. These actions neither create
Tasks nor approve a proposal or certify completion.

The claimed-turn v20 wrapper locks the plan head before Tasks, checks full read
snapshots, and owns separate retry receipts. Exact retries return the original
receipt without reversing later changes. A parent trigger serializes direct
relation writes with the plan command; no member write grant is added. Reads and
writes use the existing durable journal and live access checks. A fresh catalog
retires only `set_project_plan_focus` and `link_project_plan_task`; pinned older
manifests keep their original handlers. Install core, both runtimes, then the
separate generated catalog. Plan decisions, evidence links and nested proposal
identities remain outside this slice.

### Fifth implementation: building and room scope — source 2026-10-25

**Applied, deployed and activated 2026-10-25** ([evidence](foundation-verification.md#building-and-room-links--2026-10-25)); not yet exercised in a live turn. The owner decisions and
linking rules live in the [building model](building-model.md#bob-building-scope--owner-decisions-2026-10-25).
`project-building-scope.ts` adds two tools on the Building and site shelf:

| Tool | Effect | Refused or not included |
| --- | --- | --- |
| `read_building_scope` | Pages of 6 Buildings the caller can edit or this project already targets, 16 rooms of one of them, or 8 Areas, each as an opaque ref with link state, room marks and Area mappings | Buildings reachable only through another project; archived Buildings, rooms and Areas; database identities |
| `change_building_scope` | Link or unlink a whole Building; mark or unmark rooms; map or unmap an Area to rooms or to the whole Building | A whole-Building unlink under the project's Site link or household follow; room marks or Area mappings without the whole-Building link; Elements, Sites and creating anything |

Claimed-turn `bob_project_write_v21` handles kind `bound_building_scope`; all
other kinds delegate unchanged to v20. It checks the claim, project access and
current-message quote, accepts only `{pins, command}`, and takes the same
per-project lock as `physical_scope_command` plus a key-share lock on the
project row, which household sharing changes update. Exact retries return their
receipt before freshness checks; the per-turn receipt quota applies to
historical jobs. Every pin must equal a fresh `read_bob_building_scope_snapshot`
(otherwise `PT409`). Link rows to remove are found on the server. Each target
then goes through the unchanged `physical_scope_command`, which owns all
authority: a whole-Building link needs a Building editor; room marks and Area
mappings need project access and the whole-Building link.

One `building_context` receipt per call (`operation: updated`, `recordId` = the
Building) records the changes, the room marks and Area mappings an unlink
removed, and fresh snapshots of the same records; the pins are its
before-record. The tool returns fresh refs from that receipt, so a following
change needs no new read. `building_denied`, `building_not_linked`,
`space_not_in_building`/`element_not_in_building` and the two unlink refusals
come back as answerable `invalid` results with a fixed explanation; only a lost
project ends the turn. Conflicts ask Bob to read again. The turn checkpoint
leaves out unused scope state, and a checkpoint without it restores as unused.
Install the room-scope migration, this core migration, both runtimes from the
same source, then the generated catalog.

### Remaining migration inventory

| Family | Current boundary / remaining work |
| --- | --- |
| Description, solution content, alternative creation, selection, evidence | Technically deployed in #254/#255; real member/model acceptance remains. |
| Areas, Tasks, measurements, build days, assignments, schedule/phase/basic lifecycle | Third implementation core/runtime/catalog verified active. Thirteen legacy write contracts are replaced for fresh manifests; member/model acceptance remains. |
| Task readiness | Third implementation binds dependencies, checkpoint selections and need changes to complete Task reads; new needs start unresolved and canonical confirmation rejects blockers. |
| Living plan | Compiler/edit/save already retain server candidates. Focus/Task links are active in the fourth slice, with member/model acceptance still separate. Decisions, evidence links and nested proposal identities still need bound actions. |
| Materials and procurement | `manage_project_material`, `derive_cad_material_requirement`, supplier articles and pack purchases still expose source/allocation/version fields. Preserve deterministic quantities, stock reservations, existing allocations and exact published commitments. |
| Catalog | `save_catalog_definition` needs bound existing definitions/materials/profile versions and preserved properties; source claims stay explicit. |
| Image and drawing links | Attachment/detachment, finalization, drawing links and lifecycle choices still need complete bound source/target reads. |
| Building, room and stair inputs | Project and Area links to a Building and its rooms are bound in the fifth slice (live 2026-10-25). Intake, room-layout and stair inputs still need bound physical context, source dimensions, current geometry and unchanged saved values. |
| Construction and CAD | Existing candidate/draft/calculation adapters already own portions of identity and derivation; audit every nested source/definition/instance/Step reference and stateful update before declaring this family complete. |

This inventory describes migration work, not exceptions to the ownership rule.
Do not remove a capability from the active bench before its replacement covers
its canonical behavior and preservation/concurrency tests.

### Responsibility boundary

| Concern | Bob's responsibility | System responsibility |
| --- | --- | --- |
| Inspect and choose | Read relevant records, compare sources and identify the intended object or relationship | Return authorized, bounded data with meaning, units, source, truth state and freshness; resolve the selection to exact identities |
| Identity and scope | Select an existing object from grounded context; resolve genuine ambiguity | Own database IDs, project/Area/parent bindings, actor, turn and operation identity; never require the model to transcribe or generate these |
| Existing values | Understand the data and deliberately propose corrections where needed | Fetch canonical values and retain untouched fields, references, decisions and relationships |
| Changed values | Supply genuinely new content, a supported design choice or an explicit correction with its basis | Validate permitted fields, units, source/provenance and domain rules; save through the owning command |
| Reuse and derivation | Choose relevant sources and a supported calculation or relationship | Bind exact source versions, perform deterministic calculations and propagate dependency changes |
| Persistence | Explain verified results and remaining gaps | Enforce concurrency, permissions, atomicity, idempotency, history and readback receipts |

This is not a read-only role for Bob and not a requirement to ask the owner before
every edit. Existing delegated authority still applies. Bob must be able to inspect
saved data, correct an incorrect measurement with appropriate new evidence, change
a design dimension, revise text and relationships, and select a different source.
A stored value is not immutable merely because it already exists.

### Required tool behavior

1. **Bind the target before editing.** Use verified current context or a selection
   from authorized read results. An opaque server-issued selection reference may
   be used when needed; it is not a model-authored database ID, permission or
   substitute for validation. Do not guess by name, silently select the first
   match, or equate the current screen with the user's intended target.
2. **Send changes, not reconstructed records.** Expose bounded domain edits.
   Omitted fields are preserved; clearing/removing a value is explicit. Nested
   collections and relationships need explicit add/change/remove semantics so a
   small edit cannot replace an entire list. A deliberate full text rewrite is
   supported when it is the requested change, not required for unrelated updates.
3. **Reuse saved data directly.** A value already available from a relevant,
   authorized source is referenced and hydrated by the system, not copied through
   model prose or a specialist handoff. Do not duplicate records merely to carry
   data between tools. New literals remain necessary for new owner input or
   supported design decisions; their meaning and provenance must be retained.
4. **Pin what was read.** Capture the revision/timestamp server-side when the
   target and sources are read. Check those preconditions at commit. Never fetch
   a newer version merely to make a stale write succeed. A conflicting change
   triggers bounded rereading/reconciliation, not blind overwrite.
5. **Separate revise from create.** Editing an existing object preserves its
   identity and appends the appropriate history. Creating a genuinely new object
   or alternative is an explicit operation. An invalid edit must never become a
   create by clearing an ID, changing a version to zero or supplying a new name.
6. **Keep uncertainty and authority visible.** Existing data can be stale,
   conflicting, inaccessible, assumed or wrong. Select/adopt sources deliberately;
   never promote an estimate to measured truth or a concept to checked
   construction. Domain permissions and source-refresh rules still apply.
7. **Resolve completion from the actual operation.** Return field-specific
   validation failures and an actionable correction. A successful correction
   resolves the same rejected operation; saving a different object cannot hide
   it. Completion checks must address a real remaining gap, not request another
   model answer solely because already-resolved bookkeeping survived replay.
8. **Preserve the established write boundary.** Caller authority, same-project
   checks, claimed turns, generation fencing, deterministic calculations,
   transactionally saved receipts and downstream version lineage remain
   mandatory. Automatic field binding grants no additional access.

### Example and implementation boundary

For “add a back panel behind the bookcase and include slatted bases for both beds”,
Bob reads the selected solution and proposes the relevant additions. The runtime
binds the same solution and read version, preserves the existing gable/ladder/
drawer choices and source links, saves the revision and handles any required
target-selection command under its own domain rules. It does not ask Bob to
resubmit all IDs, measurement links or unchanged choices.

These additions are concept requirements until an actual construction version
contains supported parts, materials, joints and unresolved questions. Text alone
does not satisfy the construction-before-drawing boundary.

The 2026-10-14 investigation found an existing-solution edit rejected because it
supplied both `record_id` and `area_id`. The diagnostic reported
`domain_fields` without naming a field. Bob then changed only `record_id` to
null and `expected_revision` to zero, creating a different alternative. The
original rejected target remained unresolved and triggered a completion check
that returned the same answer. This illustrates a tool-contract gap, not an
accepted repair strategy. Relevant current seams are
`project-expert-tools.ts`, `project-write.ts`, `project-answer.ts` and the
versioned tool definitions; changing this document does not change live schemas.

### Acceptance required for implementation

- An ordinary edit requires no model-supplied database ID, revision, timestamp
  or unchanged record payload.
- Bob can read and intentionally change existing values and relationships within
  his mandate; untouched fields, source pins and prior decisions survive.
- An edit creates one new revision of the same object; a new alternative requires
  an explicit create operation.
- Ambiguous selection, stale versions and inaccessible/cross-project references
  fail honestly without guessing, bypassing authority or overwriting newer work.
- Replayed requests reuse their exact receipts. Corrected writes resolve the
  corresponding failure; unresolved or uncertain writes remain visible.
- Existing source values and calculated results reach downstream tools through
  validated bindings, with provenance and required change consequences preserved.
- A real small-edit run is checked for content, reload/readback, identity/history
  preservation, actual model calls, latency and cost. Deterministic tests alone
  do not establish the live-model acceptance or a speed improvement.

Implementation order and outstanding release/member gates live in
[delivery-flow State](bob-delivery-flow.md#state).

## First scope

The exact approved persona remains unchanged. Its separate server authority layer now allows action on a clear request or approval of an already specified option, without another permission loop. The actual per-call tool list remains the capability authority.

| Tool | Persistent effect | Exclusions |
| --- | --- | --- |
| `save_project_description` | Replace the current description/plan with a timestamp precondition; preserve unrelated content | Not SolutionVersion selection, Building facts, or design approval |
| `save_project_task` | Create a todo Task or revise its name/instructions and primary Step ownership; Area is optional when the Step supplies it | No assignment, status changes, completion or readiness |
| `save_project_measurement` | Create/revise the existing canonical measurement record and append revision history | No invented measured evidence, parent moves, source-image removal, archive or deletion |
| `save_project_drawing` | Create/revise the supported parametric 2D storage-box Artifact and read it back with an exact revision receipt | No arbitrary CAD/SVG/code, target selection, measured-site assertion, approval, purchases or parent move |
| `create_project_room_layout` | Create one linked two-room Concept plan with existing physical source identities and a pinned furniture drawing | No new/accepted physical records, arbitrary house geometry, furniture resizing or target selection |
| `edit_project_room_layout` | Move the shared wall, change only furniture placement, or explicitly refresh source revisions | No silent source adoption, stock changes, construction approval or independent conflicting room sizes |
| `save_project_stair` | Save/revise the supported stair study tied to one exact multi-floor plan; explicit source refresh | No accepted physical edits, source-plan mutation, rounded winders, approval or purchases |
| `save_project_building_plan` | Create/revise one Concept multi-floor coordinate study with exact canonical sources | No accepted physical updates, automatic source adoption, arbitrary geometry, stair or safety claims |
| `save_building_context` | Atomic canonical Building/Level/Space/Element/Relationship capture and exact room measurement links; append Building notes | No general geometry, stairs, automatic proposal acceptance, unscoped Building access, deletion or safety approval |

`search_project_data` gains a caller-RLS measurement projection and task instructions through a new `search_bob_project_data` RPC. The older lookup RPC stays compatible. Results remain literal, bounded and project-scoped; a chosen design dimension is a provided specification, not a physical measurement.

The shared guest identity remains read-only: it has no private claimed server thread. Unrelated apps, household sharing, people, purchases, selected targets, checks and structural approval are not exposed. The dedicated Building intake tool separately enforces existing Building-edit authority.

## Parametric drawing extension (implementation branch)

The 2026-09-18 2D extension requires
`20260918204949_parametric_storage_box_drawings.sql` before its frontend/Edge
rollout; it is not yet a hosted-release claim. `bob_project_write_v2` handles the
new drawing kind and delegates existing kinds to the established writer. It uses
the **same** claimed turn, 32-operation budget, semantic retry keys, private audit
receipts and generation-fenced settlement. No service-role domain write is added.

Read the exact current target and drawing before an edit. Full explicit design
parameters produce one Concept revision; linked measurement references and
unrelated description/assumptions must be retained unless the request changes them.
`search_bob_project_data_v3` enriches artifact rows with their exact saved recipe;
Edge adds finished-part sizes using the same deterministic generator as the UI.
The generator and its limits live in [Plans and drawings](artifacts.md), not here.

Drawing receipts add `revision` and `areaId`; parser and browser validate these
before showing an exact-version **Open drawing** link. Receipt-only retry recovery
keeps that link. The full saved recipe is returned to the tool, not duplicated into
the compact transcript receipt. Arbitrary user/provider text never creates a saved
badge. Opening the link closes the drawer and uses the normal Artifact view.

## Linked-room extension (implementation branch, 2026-09-19)

The new `project-room-layout.ts` defines strict create/edit tool shapes. Bob reads
canonical IDs using the caller-scoped `physical_spaces` and `physical_elements`
research datasets, then the exact target and source furniture drawing. Parameters
are proposed design specifications. Existing accepted physical context and a
selected target are prerequisites, not records the tools may invent or approve.

`search_bob_project_data_v4` adds bounded physical research and exact linked-plan
source details. Derived geometry, outline conflicts and furniture parts use the
same `roomLayout.ts` engine as the browser. The new `bob_project_write_v3` handles
`room_layout` and delegates old write kinds to v2, preserving the existing claimed
turn, caller JWT, 32-operation budget, audit quotes, atomic receipts, retries and
fenced settlement. No generic SQL or service-role domain writes are added.

Source changes reject normal edits. `refresh_sources` is a separate, explicit
adoption decision: it is not a permission to invent new measurements or resize
furniture. Readback includes exact versions and computed conflict state. Compact
chat receipts continue to use the existing Artifact revision link. The full
construction/placement contract and rollout dependencies are owned by
[Plans and drawings](artifacts.md#linked-two-room-plan-pilot--implementation-branch-2026-09-19).

## Building intake extension (implementation branch)

`save_building_context` is wired through caller-JWT `bob_project_write_v4`;
older kinds delegate unchanged to v3. It uses the same claimed-turn ownership,
32-operation budget, private before-state audit, idempotent receipt and fenced
settlement. `search_bob_project_data_v5` supplies scoped current physical records,
measurement snapshots and separate proposals. The model's output allowance on a
write-capable call is raised to 8,000 tokens to accommodate the bounded multi-node
tool payload; the normal concise prose contract is unchanged.

The [Building model's chat intake section](building-model.md#chat-driven-building-intake--implementation-branch-2026-09-19)
owns the capture semantics, existing/proposed authority, local references, sources,
limits and next geometry boundary. This extension is not yet hosted-deployed.
A `building_context` receipt links to current Building context, not to a frozen
multi-floor plan or a claim of computed staircase geometry.

## Multi-floor coordinates (implementation branch after #85)

`save_project_building_plan` uses caller-JWT writer v5 (older kinds delegate to v4)
and the existing 32-operation claimed-turn/receipt/settlement boundary. Research v6
adds a non-geometric marker in artifact lists and full source-authorised details
only on exact record lookup. Partial/stale/unavailable source states are explicit.

`inspect_building_projection` is a **read-only** tool in the project lookup budget,
not a write tool. It requires the current artifact revision and existing floor
identities, and returns geometric overlaps and known height differences without
saving a new plan. It cannot conclude stair fit, headroom, structural approval or
physical emptiness from an unmapped area. Invalid calls consume the same bounded
lookup allowance. Coordinates and source text remain untrusted data.

[The Artifact owner](artifacts.md#multi-floor-coordinate-studies--implementation-branch-2026-09-19)
owns the study semantics, source refresh and release dependencies. Both tools are
implementation-branch capabilities, not a hosted/live-model release claim.

## Server-owned change provenance — 2026-09-27

**Supersedes the model-supplied request quote described in [Authority and atomicity](#authority-and-atomicity) and [Retry, failure and reset](#retry-failure-and-reset).** Owner decision, 2026-09-27: Bob is no longer asked to quote the owner to make a change.

- No tool offered to Bob has a `request_quote` parameter. The tool session removes it from the offered schema and, on execution, sets it to the owner's current message (at most 500 UTF-16 units, never splitting a character). A value the model supplies anyway is replaced.
- Every SQL writer is unchanged and still checks that the value is an exact substring of the claimed turn's user message, so each receipt stays tied to the owner message it belongs to. The writer boundary still rejects any other quote.
- The quote was an audit constraint, not consent; it now records provenance only. Real authority is unchanged: caller JWT, project access, claimed turn, generation fencing, revisions and each writer's own rules.
- Plan approval still needs the owner's explicit approval or instruction (a prompt rule; [living plan](living-project-plan.md)). `source_quote` fields in building intake and the material catalog are unchanged: they record which owner words a fact came from.
- Guide wording that asked Bob for a quote is removed by migration `20260927063000_bob_server_change_provenance.sql`.

## Lifecycle tools — 2026-09-27

Bob keeps the project tidy as it changes, through `bob_project_write_v13` (kind `lifecycle`; older kinds delegate unchanged to v12). Every change keeps the claimed-turn ledger, the server-filled current-message provenance, the 32-change turn budget, operation-key replay and a before-state receipt. Authority matches what a project member can do in the UI.

| Tool | Effect | Refused |
|---|---|---|
| `archive_project_area` | Archive or restore an Area through `area_lifecycle_command` | Unfinished Tasks, a pending plan proposal using the Area, a stale `updated_at` |
| `delete_project_task` | Delete a Task with its checkpoints, assignments, dependencies, needs, scheduling and image links | Completed Tasks, which are history; a stale `updated_at` |
| `delete_project_build_day` | Delete a build day, its sign-ups and Task links; the Tasks stay | A stale `updated_at` |
| `delete_shopping_item` | Remove one Shopping item; a linked requirement stays | — |
| `detach_project_image` | Remove one image attachment; the image stays in the library | An attachment that does not exist |
| `set_project_phase` | Move the project or one Area to a phase, with a reason in the phase history | Completing the project while an Area is not complete |
| `update_project_schedule` | Set or clear the build window | Start after end, one date without the other, a stale `updated_at` |

A deletion receipt has `operation: 'deleted'`; the browser accepts it and shows it without a link. The removed row is kept in `bob_write_receipts.before_record`. Server-authored refusal reasons for these tools are returned verbatim so Bob can explain or correct them.

A record ID the database refuses (`42501`) no longer ends the turn by itself. The runtime re-checks project access: if access still holds, Bob receives `not_found` and can correct the ID; if access is gone, the turn ends as `project_denied`. A lost turn claim still ends the turn.

## Authority and atomicity

> The model-supplied quote described here is superseded by [server-owned change provenance](#server-owned-change-provenance--2026-09-27); the SQL check itself is unchanged.

The model cannot supply project, user, thread or generation authority. The Edge Function binds these from authenticated request and claimed server state. Domain calls use the **caller JWT**, not the service-role client. SQL independently checks current membership, thread ownership, active turn, generation, exact current-message request quote, allowed fields and same-project parents. A quote is an audit/reference constraint, not a semantic proof of consent; the model must distinguish requests from quotations, hypotheticals and suggestions.

Updates require the current timestamp or canonical revision. Project/task changes and their audit receipt commit in one transaction. Measurement writes reuse `evidence_command` and preserve an existing source image. Drawing writes reuse `artifact_box_command` and the canonical Artifact command; new geometry never silently reuses an old illustration. Receipts contain the actual post-write record; browser/transcript evidence receives only compact metadata. The private ledger retains before-state and write provenance and is never a public raw-table API.

There is no generic SQL, table-name, status, actor, readiness, purchase or delete argument. The migration changes only Bob schemas and grants no new raw domain-table privilege.

## Retry, failure and reset

> The model-supplied quote described here is superseded by [server-owned change provenance](#server-owned-change-provenance--2026-09-27); the SQL check itself is unchanged.

There are at most 32 committed operations per turn, enforced in every routed writer version and in frontend receipt validation. Rejected/invalid attempts have a separate bound of 12; correcting an input does not consume a successful-save slot. An uncertain result still stops all writes. Exact retries return the original receipt; a differently worded second create for the same named target in that turn conflicts instead of producing a duplicate. A legacy synchronous retry with existing receipts skips the model and reports what was saved. Durable background continuation instead replays completed operations and continues unfinished work as described in [conversation recovery](ask-bob-conversations.md).

Rejected tool arguments distinguish schema shape, exact-current-request quote and Task field errors. A valid quote must not be blamed for a bad Step UUID or missing edit timestamp. The tool names the field and correction needed, without rewriting the quote, inventing current IDs or making a database call for invalid input. Schema diagnostics include bounded field paths and expected types/constraints without echoing private argument values. Domain validators retain their stricter rejection boundary; not every cross-record rejection has a field-level explanation. Diagnostic logs contain only the tool, validation category and schema field names, never arguments or conversation text.

Invalid/conflicting writes remain tracked per tool and target until a successful correction. Saving one Task does not clear another Task's rejection. The existing single completion review also considers these unfinished writes while time and write budget remain. It adds no owner instruction, permission or automatic replay. Uncertain transport, exhausted budgets and the closing deadline still stop further work. An unresolved rejection marks the answer evidence partial, even when another requested change has a valid receipt.

Before finishing, settlement obtains the same advisory/thread/provider locks as writes, advances the generation and reads committed receipts. A delayed tool request carrying the earlier generation cannot commit afterward. The new commit/failure commands also fence generations, including retries of the same turn UUID.

A model exception after a save produces a receipt-only recovery answer, not a false failure or another execution. A receipt-only answer clears the provider cursor but retains the visible transcript. Failed transcript synchronization explicitly says project changes are saved. Unverifiable settlement stops further writes and labels the outcome uncertain; it is not a promise of rollback.

The frontend offers **Retry request** with the original turn UUID. A latest failed/pending server request can be recovered after reload. A deliberate new message is a new request, not a global semantic-deduplication guarantee.

The existing **New conversation → Clear chat and context** flow from #80 clears the caller's transcript/cursor and retry UI. It does **not** undo saved domain edits or their private audit history. Active turns block reset; generation/ownership checks reject later writes against a removed claimed thread. Multiple named/archived chat selection and provider-side object erasure remain out of scope.

## UI and refresh

The drawer shows **Saved to project** only from validated, same-project server receipts. Saving does not certify measurements, safety or readiness. Project screens refresh when the drawer closes, avoiding the existing project-version event remounting the shell halfway through a reply. The close event itself performs the refresh: Layout unmounts the drawer, so an effect waiting for `open=false` cannot do it. Both receipt links (including a second link to the same Building/route) and ordinary close refresh verified changes without requiring a browser reload. Error responses never create a receipt badge.

## Verification and release

- `tests/bob-project-writes.test.ts`: actual migrated PGlite database, authenticated roles, read-back, atomic rollback, history, image preservation, stale edits/generations, dual-project boundaries, guest/revocation, reset survival and idempotency.
- `tests/bob-write-runtime.test.ts`: production tool parser/orchestration with injected provider/transport fixtures; approved-option execution, retry without another model call, lost HTTP results, model failure and receipt validation.
- `tests/bob-write-recovery.test.ts`: field diagnostics, exact quote preservation, independent Task targets, bounded completion review, partial evidence and worker replay.
- Existing independent literal persona fixture remains unchanged.
- Existing project browser gate adds phone/desktop receipt display, wrong-project rejection, lost-answer retry with the same turn id, close/reopen and reload. Existing reset gate is retained.

These deterministic tests do not claim a live model personality evaluation. Hosted Auth/PostgREST write proof, migration verification, Edge rollout and Pages are separate release gates. Roll back the Edge Function first if necessary; the additive migration and optional frontend receipt fields remain backward compatible. Do not replay the whole shared-database migration history.

### Stair-study extension (implementation branch, not deployed)

`inspect_stair_options` is read-only, bounded to four candidates and one fresh
exact-plan lookup. `save_project_stair` enters caller-JWT `bob_project_write_v6`
with existing claimed-turn, receipt and settlement rules; older kinds delegate to
v5. Research v7 adds exact stair-source details. Project/Area, target and existing
measurements come from the parent plan, not model-chosen authority. The geometry,
unknowns, refresh semantics and limited headroom contract belong in
[Plans and drawings](artifacts.md#stair-geometry-study--implementation-branch-2026-09-19).
Neither an inspection nor a saved study is a physical floor modification.


## Native work values and Task feedback — 2026-10-17

The task-workflow publication versions exactly `edit_work_record`,
`create_work_record` and `change_task_readiness` to schema 2. Their closed change
variants use native `value` strings, nullable strings or booleans, with explicit
allowed paths. Text is no longer JSON encoded inside a JSON string. Server refs,
request provenance, canonical writers, budgets and authority remain unchanged.
`change_work_state` keeps its typed schema 1.

Known Task completion/readiness rejections have allowlisted validation codes and
safe explanations. With the pinned task-workflow behavior enabled, work records
return a fresh authorized snapshot after these rejections so Bob can name the
remaining required checks or readiness blockers. Unknown database errors remain
generic. Required completion checks are enforced as before; readiness is not a
new prerequisite for `doing`, and no check is completed automatically.

Schema 1 and its parser remain available to historical pinned jobs. Live policy
2 explicitly accepts pinned handlers 1 or 2 for only those three tools; policy 1
accepts handler 1 only. Disabled, unknown-version or unauthorized tools remain
denied. New rejection feedback and its extra readback are selected by the pinned
behavior contract, preserving historical journal inputs. The execution-only
receipt projection reconstructs results at the replay position; recovery's later
receipts cannot alter an earlier completion-review input.

Deploy both compatible runtimes before activating the new immutable catalog.
For rollback, reactivate the prior catalog for new jobs while keeping compatible
runtime and live policy 2 until all pinned schema-2 jobs finish. This supersedes
the generic Edge-first rollback guidance for this publication. No stored user
instructions are rewritten on deployment. [Release evidence](foundation-verification.md#bob-task-workflow-release-2026-10-17)
separates technical checks from the owner's real-model acceptance.

## Unlimited durable work — 2026-10-17

New jobs pin the work-allowance policy and AI manifest at enqueue. Policy 1 removes
application write/correction quotas and the cumulative receipt ceiling in every
retained writer delegate. The SQL exception requires the exact owned Project,
thread, turn and generation, a live running job/lease and unexpired caller authority.
No model or client input can grant it. Historical/no-job writes retain prior limits.

Read-before-write, canonical domain commands, Task completion checks, revisions,
exact replay, uncertain-write fences and settlement all remain. Recovered and
rendered receipt sets are not cut to 32. Stop invalidates the active generation;
confirmed writes remain saved. No deployment rewrites existing Task instructions.
