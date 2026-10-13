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
