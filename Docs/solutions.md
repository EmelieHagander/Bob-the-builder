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
target, with a reason and server actor/time. One target exists per project, even
when alternatives have area context. Editing a selected solution creates a new
candidate version; the target remains on the selected version until a new explicit
decision. Selection requires both the expected target decision and current solution
revision. Concurrent changes fail with a reload instruction. A selected solution
must be replaced or the target cleared before archiving it.

The selected state expresses project intent, not engineering approval. Downstream
consumers must store this exact solution/decision revision when they are built.
No current task, shopping item or drawing is recalculated by this milestone.

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
