# Drawings and references

Manual milestone 4A supplies versioned image references for a selected project
target. The [V1 plan](v1-plan.md) owns delivery order and
[foundation verification](foundation-verification.md) owns release evidence.

## One recorded basis

An artifact has stable project identity, optional fixed area, and append-only
revisions. Each revision records title, drawing kind, notes, source/preparation,
unresolved checks, an existing ready project image, and server actor/time/reason.
These are manually supplied references, with no claim of measured or build-ready
precision. Image bytes are reused from private project storage, never duplicated.

Create/revise pins the current target decision, hence one exact solution version
and its existing measurement references. No numeric truth is copied into a second
measurement store. Saving requires explicit review acknowledgement and the
expected target decision and artifact revision. A concurrent change fails and
keeps the form. The acknowledgement records review, not engineering approval.
If a target is cleared, create/revise waits for a new selection.

An old revision never silently adopts a new target or measurement. Detail views
show the saved solution, exact values, units, truth states and sources. They flag
changed measurements, a replaced/cleared target, newer artifact versions,
archiving, and removed files. Selecting the same exact solution version again
does not mark its basis changed. Revision explicitly binds the reviewed file to
the currently selected target. Archive/restore keeps the old basis and history.

## Tasks and recovery

Task links pin an exact artifact revision. An explicit update adopts the current
active revision; it requires both expected artifact and existing link revisions.
Detach removes only the task reference. Existing task pins remain readable after
archive or image removal. Deleting an image clears file IDs while retaining titles,
artifact versions and task pins. Task deletion removes links; area deletion keeps
project artifacts; project deletion cascades after the existing media cleanup gate.

Clients read RLS-protected tables and security-invoker views. Writes go through
artifact_command, with membership, same-project checks at every relation end,
field allowlists, revision conflicts and project-row serialization. UI access
uses database.ts and its project/auth generation guard. Lists/pickers paginate
24 items; history paginates 12. Errors support retry and failed edits retain input.

Dashboard and Area lead to /artifacts. Task detail attaches, opens, updates and
detaches pinned references. Demo mode cannot persist artifacts. Generated drawings,
engineering calculations, BOM, stock deduction, shopping and readiness remain
later work; this milestone does not invoke AI or recalculate tasks.

Verify actual SQL/RLS, concurrency conflicts, immutable history, cross-project
relations and cleanup. Drive production UI with HTTP fixtures at 320/390/1280px;
separately verify deployed Auth/PostgREST/Storage with one disposable project.
