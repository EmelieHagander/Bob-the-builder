# Solution alternatives and the selected target

**Status:** manual milestone 3A is implemented, merged and deployed on 2026-09-10.
The V1 plan owns delivery order and
[foundation verification](foundation-verification.md) owns release evidence.

## User goal

Keep alternatives, compare their rationale and assumptions, and deliberately
choose one exact version as the shared project target. This supplies the manual
foundation of BOB-US-014/015. Generated proposals/mockups, measured drawings,
calculations and propagation into tasks remain later slices.

## Records and decisions

`bob.solutions` owns identity, project, optional fixed area and current revision.
`bob.solution_revisions` keeps append-only title, description, assumptions,
trade-offs, optional reference image, archive state and server actor/time/reason.
Create/revise/archive/restore each creates a revision. Identity and parents cannot
be rewritten. Area deletion keeps the solution in the project.

Each revision may reference up to 20 exact measurement revisions through
`bob.solution_measurements`. The UI displays those saved values, units, truth
states and sources. A later measurement revision is visibly marked as changed;
it never silently replaces an earlier decision's evidence. Reused-part dimensions
use the same measurements. New references must belong to this project. An older
measurement version may be kept deliberately; uncertainty remains visible.

`bob.project_targets` points to the latest append-only `bob.target_revisions`
decision. A decision selects one exact solution revision or explicitly clears the
target, with a reason and server actor/time. An Area uses its own target decision;
it inherits the Project target only when no Area pointer exists. An explicit Area
clear blocks inheritance. Editing a selected solution creates a new
candidate version; the target remains on the selected version until a new explicit
decision. Selection requires both the expected target decision and current solution
revision. Concurrent changes fail with a reload instruction. A selected solution
must be replaced or the target cleared before archiving it.

Bob may create and select a new alternative in one command (prepared
2026-10-29, [writer contract](ask-bob-writes.md#create-and-select)). It is still
two append-only records, a solution revision and a target decision, each with its
own receipt; a concurrent target change leaves the new solution unselected.

The selected state expresses project intent, not engineering approval. Downstream
consumers must store this exact solution/decision revision when they are built.
No current task, shopping item or drawing is recalculated by this milestone.

## Shared expert advice and design intent — 2026-10-09

**Deployed 2026-10-09 through [PR #236](https://github.com/EmelieHagander/Bob-the-builder/pull/236).**
[Release evidence](foundation-verification.md#expert-advice-and-design-readiness-release--2026-10-09)
owns migration, catalog, runtime and Pages pins.
`20261009214214_solution_design_readiness.sql` adds nullable `design_intent` to
the existing immutable Solution revision. Bob's solution tools expose this packet
and existing `source_media_id`; paged reads and exact selected-target reads retain
both. `20261009214611_ai_design_readiness_catalog.sql` versions the associated
role/tool guidance in the AI catalog. No separate memory or decision table is
created. Legacy null remains readable and unknown, without invented decisions.

Bob investigates consequential choices, explains alternatives and practical
consequences, and recommends a supported direction. Technical choices within the
existing mandate remain his responsibility. The owner decides consequential use,
cost, appearance, preferences and undelegated trade-offs, with expert advice;
they do not arbitrate engineering correctness. Prior saved decisions and mandate
can be reused after chat reset. Delegation authorizes a choice; readiness still
needs its actual selected direction. Alignment expresses supported intent,
not engineering or fabrication approval.

| Packet component | Saved meaning |
| --- | --- |
| `purpose`, `summary` | One next output: `illustration`, `concept` or `construction`, with its shared goal and scope. |
| `references` | Exact same-project image IDs, roles `appearance`, `layout` or `context`, and notes. The primary source image is also represented here. |
| `features` | Stable required-feature IDs, descriptions and their request/record/assumption basis. Appearance/layout references require preserved features. |
| `choices` | Question, alternatives, recommendation, basis, consequences and geometry dependency; status `open`, `resolved` or `deferred`. Resolution records actual direction, `owner` or `bob` authority and decision basis. |
| `alignment` | `draft` or `aligned`, with an explicit basis for the settled direction. |

An open choice blocks readiness. A resolved choice needs alternatives, advice,
consequences, an actual direction and decision basis. A deferral names a reason
and exactly `illustration` or `concept`; it is valid only for that same output
purpose. Construction permits no deferred choices. This limits the next output
without requiring owner approval for ordinary details. A well-formed packet may
still be a draft; valid JSON alone is not readiness.

The caller-authorized `read_design_readiness` returns `ready`, `needs_data`,
`conflict` or `unavailable`, with issues and any valid deferrals. Only `ready`
returns a pin for the exact Project/Area target decision, Solution revision and
purpose. A changed expected target conflicts; missing intent, draft alignment,
open choices or a purpose mismatch need reconciliation. Missing/revoked image
sources remain unavailable. [CAD consumption](cad-adapter.md#expert-advice-and-design-readiness--2026-10-09)
owns enforcement before new geometry and at save/review.

Relevant Solution edits without a replacement packet retain prior advice but
set alignment back to `draft`. Explicit null clears the packet or primary image;
omission preserves them. Selecting a revised Solution remains a separate target
command. Existing revision, caller authority and exact receipt-replay rules stay
in force; historical accepted receipts do not authorize new work.

Intent create/revise and selection check their exact canonical Solution or target
readback in the same transaction against the existing 30,000-byte lookup envelope.
An oversized result raises `compact_design_intent_required` and rolls back the
write; no new revision, target change or accepted receipt survives. The intent's
48,000-byte absolute storage cap is a separate limit, not a larger lookup budget.
Shorten explanations while preserving actual choices, required features and
reference identities; open original sources separately. No generic prompt/read
budget increase or new tool is introduced.

The UI adds a read-only **Design & choices** section to selected and historical
Solution details, including original reference viewing, alternatives, advice,
actual direction and bounded deferrals. Missing or unreadable legacy packets keep
the original Solution text visible without claiming readiness. This UI is not a
manual readiness editor or a new confirmation step. [State](bob-delivery-flow.md#state)
retains ordinary-member advice/reference acceptance.

## Authority, files and recovery

Use the existing membership boundary and database.ts project/auth generation guard.
Clients SELECT under RLS and invoker views. Only the guarded solution_command may
write. Its private definer checks Auth/project membership and all relation ends,
rejects actor/history/parent fields, and serializes solution/target writes using
the project row. Expected revisions prevent lost updates; failed saves retain input.

Reference images reuse completed authorised project uploads and original viewing.
They are context, not measured drawings. Deleting a file clears its reference but
retains the recorded title and solution/decision history. No second copy of bytes
is made. Project deletion cascades records only after existing image cleanup.

## Reachable workflow and proof

Dashboard and Area link to /solutions. The focused page shows the project target
even when alternatives are filtered by area, active/archived alternatives, paged
revision and decision histories, source images and exact measurement evidence.
Creation, revision, selection, replacement, clearing, archive/restore and reload
must work without AI. Demo mode explicitly cannot persist these records.

Verify actual SQL/RLS for anonymous/member/outsider/dual-project access, immutable
history, cross-project references, stale decisions, pinned targets/evidence and
parent/file cleanup. Drive real production UI at 320/390/1280px using HTTP fixtures;
separately prove deployed Auth/PostgREST/Storage with disposable data and cleanup.

<a id="early-concept-geometry-form--source-implementation-2026-10-26"></a>
## Early concept geometry (FORM) — technically installed, 2026-10-26

Decision: the optional `design_intent.model` belongs to the immutable Solution
revision. It can exist before a selected target. No new table, ProjectPhase,
approval state, Building or Artifact is created for a sketch. Existing bound
Solution edits, receipts, selection, access checks and reload/history own its
lifecycle. Editing an unselected alternative leaves the target pinned; editing
a selected scope through the existing bound editor advances that scope atomically.

The first slice is an orthogonal concept model: named positive X/Y/Z axes and
origin, mm parameters, stable named components (solid, space or opening), explicit
XY/XZ/YZ projections or principle sections, and equality/upper-bound or required-view-plane constraints.
Parameter expressions reuse the CAD calculator's versioned decimal arithmetic.
Parameters are design decisions, estimates, unknowns or derived values, never
measurements. Exact measurement and image evidence stays on the existing Solution.
Unknown dimensions omit affected geometry and remain visible. Openings are annotated
volumes, not boolean cuts. Slopes, curves and engineering section cuts are outside
this slice; unsupported requirements remain explicit gaps. No object-type templates.

Initialize the model once through `edit_project_record`; subsequent edits address
individual parameters, components, views or constraints and preserve their IDs.
Components can be deactivated rather than deleted/reidentified. Every derived
view is rebuilt from this same saved model. Feature and choice links use the
existing design-intent identities; a missing feature is a reported gap. Model
validity is separate from alignment, construction checks and physical safety.

Construction handoff retains the selected Solution revision through the existing
Artifact lineage. This slice admits exact, unrotated box instances with the same
component IDs; spaces/openings must be reference instances. Subdivision, rotation
or other geometry needs an explicit future mapping contract and returns unsupported,
not a fabricated conversion. K2 and independent CAD review still apply. CAD review
receives the full pinned intent, including the model and its view/constraint data;
the handoff uses the selected model's named coordinate frame. Changed linked
measurements block construction readiness until their revisions are reconciled.

Core, matching backend, frontend and catalog are installed.
[Verification](foundation-verification.md#form-concept-loop--local-synthetic-verification-2026-10-26)
records its exact source and hosted readback. Real owner/model acceptance remains
in [State](bob-delivery-flow.md#state).

<a id="form-refinement"></a>
### Concept-to-construction refinement — checkpoint source implementation, 2026-10-27

The installed handoff above remains available. The first scoped extension is
implemented in source, with [local evidence](foundation-verification.md#form-checkpoints-2026-10-27)
and [release order](../supabase/README.md#form-checkpoint-release).
`form_refinement: {version: 1, mappings: [{component_id, instance_ids}]}` belongs
to an exact Construction revision and its existing selected Solution/target pins.
Each active concept component may map to several detailed parts; every actual
instance must appear exactly once. Parts retain their own identities. The first
checker accepts uncut, unrotated boxes and requires each mapping's aggregate
envelope and physical/reference roles to match the selected component exactly.
This bounds a checkpoint; it does **not** prove preserved function, clearances,
joinery or structural adequacy. Every explicit refinement remains `unverified`.

Solution continues to own intended form and function; Artifact/Construction owns
parts, placement, joints and the detailed realization. Mapping identity, version
binding and validation belong at that existing boundary, not in a new parallel
model store. Missing mappings, unsupported geometry or an unresolved controlling
requirement remain explicit. A detail that changes intended form/function returns
to a revised Solution and target decision before affected outputs are regenerated.

Refinement supports [progress in coherent parts](bob-delivery-flow.md#form-work-pieces).
The server derives mapped and pending component IDs and independent pending
choice IDs from the exact selected Solution. Construction overview/notes reopen
the mapping, source revision, original features/choices and remaining work.
Ordinary part, parameter and role edits inherit the mapping; removing a mapped
instance fails unless a complete save explicitly replaces that mapping. Explicit
`null` requests the original complete same-ID handoff and its whole-design gates;
omission on an older writer inherits the prior revision. Archive/restore preserves
the original scope. No requirement is removed or satisfied by omission.

`read_construction_readiness` and the SQL write boundary share scoped permission
to save. `read_design_readiness` retains whole-output readiness and its original
pin: a scoped ready result cannot produce a whole-design pin. A choice is pending
only if it is explicitly linked to active unmapped components outside the current
dependency closure. Shared parameter inputs/derived values, numeric constraints,
shared features and touching/overlapping component envelopes connect that closure
transitively. Unlinked choices still block; `geometry_dependency: false` alone
cannot establish independence. Source access, purpose, alignment, exact target
and measurement freshness checks remain mandatory. The first slice conservatively
requires the entire conceptual geometry to be resolved and supported; even shared
zero nodes count as dependencies. More precise independent unknown geometry and
functional/interface evidence remain future work. Refinement checkpoints cannot
authorize CAD publication, manufacturing quantities or cut plans at either the
tool or database boundary. Their [technical evidence](artifacts.md#form-scoped-checks) has a first source
implementation; it is not implied by an envelope match.

The [2026-10-27 FORM decision](bob-delivery-flow.md#form-flow) makes the user the
reviewer of intended form/function in 2D and of the detailed model's appearance
and function in 3D. Reuse existing Solution decisions and explicit delegation;
selection/alignment alone does not prove that a particular preview was shown or
accepted. The detailed 3D decision must also identify its exact Construction
revision and presented evidence. Changed controlling inputs require reassessment
within that decision's scope. This acceptance does not assert technical safety.
The installed [shown-model feedback contract](#form-shown-feedback) below
connects the first 2D producer. Detailed 3D production and its Artifact evidence
binding remain package 4a.

The [conversational alignment contract](bob-delivery-flow.md#form-dialogue)
captures the user's ordinary feedback on the shown model; no FORM approval
button or second formal confirmation is required. Preserve the response's scope,
actor and exact shown revision through existing decisions/receipts without
publishing private chat. Corrections, ambiguous feedback and silence cannot be
turned into blanket acceptance. [Technical checks](bob-delivery-flow.md#form-technical-checks)
remain separate responsibilities and cannot be approved by a visual response.
Use one decision contract for 2D and detailed 3D: server-bound actor, presented
evidence identity, exact revisions and scoped response/delegation basis. A reply
to an older presentation cannot authorize a newer head. Preserve that link across
reload and private chat reset within its authorization boundary; it must not
depend solely on the latest chat summary or model-authored `alignment.basis`.

Final conversion and replacement of CAD review remain separate from these previews. The
[whole FORM flow](bob-delivery-flow.md#form-flow) owns review responsibility and
[State](bob-delivery-flow.md#form-next) owns implementation order and acceptance.


<a id="form-shown-feedback"></a>
## Shown model and conversational feedback — technically installed, 2026-10-27

`solution_presentations` and `solution_model_feedback` are subordinate evidence
and decisions on existing immutable Solution revisions, not new model geometry.
Package 4a adds a technically installed `construction_3d` producer for exact saved box
solids. Its Artifact/revision, material pins, named camera and realized component
scope are derived by the server; its source guard reuses Artifact freshness.
The shared history is scoped to that exact Construction revision. A whole-model
response expands only the shown components, including a partial refinement;
it cannot accept missing components or replace the concept readiness decision.
Current negative 3D feedback remains a readiness gap until a later covering
response on the same sources. [3D evidence](foundation-verification.md#form-construction-preview-2026-10-27)
records full CI, browser and hosted boundary verification.
[2D release evidence](foundation-verification.md#form-hosted-release-2026-10-27)
records full CI, browser and hosted boundary verification for 2a/2b/2c;
real-model and final delivery acceptance remain separate.

The Solutions page calls `record_solution_presentation` after a nonempty rendered
concept viewport intersects the visible page. Covered parent views stop publishing
focus. The server derives actor, exact Solution revision, view, renderer contract,
Project/Area target scope and bounded source identities (head, target revision,
measurement pins/heads and image versions). Reopening the same evidence is
idempotent. This is a browser presentation record, not proof of gaze or
comprehension, and it creates no acceptance. Link failure retains the drawing and
offers retry. Existing ordinary discussion controls carry the pointer.

A draft started on this presentation freezes its identity. A late presentation
callback cannot attach evidence to an already unbound draft, and a new head or
view cannot retarget a started reply. The logical turn keeps this identity through
send, retries and worker recovery. `read_model_feedback` reads only its bound
presentation, active component identities and ten responses at a time; its cursor
can reopen older decisions without loading construction geometry. The UI's feedback
history uses the same caller-authorized reader and survives reload/private reset.

Bob interprets the **whole ordinary response** in the normal conversation.
`record_model_feedback` accepts a typed outcome (`accepted`, `change_requested`,
`unclear`, `delegated`), whole-model or exact active-component scope, and separate
correction/uncertainty flags. The backend rejects inconsistent acceptance, binds
the entire original turn rather than a model-selected quote, and derives the
actor and shown source from private turn capture. It never lets a model choose a
different presentation, actor or source revision. Language interpretation remains
model judgment; flag consistency is not proof that any arbitrary natural-language
response was correctly classified. There is no extra classifier call or approval
button. Only typed metadata is shared; chat text and the normal provenance quote
remain private and are removed by private conversation reset.

An explicit `delegated` response is a mandate, not acceptance. Bob may record a
separate acceptance under that exact current mandate in the **same turn**, without
a second owner confirmation. Its scope must be covered by the mandate, and later
corrections/uncertainty prevent reuse. User and Bob records have separate immutable
receipts. Exact retries recover the original receipt; changed payloads/sources
return a conflict for acceptance/mandate and cannot transfer old feedback to a
new head. A late correction or unclear response can still be recorded against
its historical presentation; it does not invalidate a later decision on different
exact sources. Membership,
claim generation, presenter, source revision and target/source freshness are
checked at the actual caller-JWT write boundary. Shared metadata remains after a
private reset; project deletion removes its subordinate metadata, while removed
Areas retain their historical scope identities.

`read_design_readiness` can use current whole-model acceptance as the shared
alignment basis without rewriting the immutable intent. Once visual feedback
exists, a limited, unclear, corrective or historical response cannot be bypassed
with model-written `alignment.basis` or a new Solution head. A later whole-model
response can settle that exact current model. Purpose, open design choices,
geometry/measurement checks, K2 and CAD/manufacturing restrictions remain in force.
Untouched legacy alignment keeps its prior design-readiness behavior and is **not**
backfilled as shown or accepted evidence. Full FORM delivery and 3D/export review
remain separate work in [State](bob-delivery-flow.md#state).
