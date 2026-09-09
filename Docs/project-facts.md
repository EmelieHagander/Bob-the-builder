# Measurements and existing components

**Status:** manual foundation milestones 2A/2B are implemented, merged and deployed
on 2026-09-09. [Foundation verification](foundation-verification.md) owns the
release evidence and its limits. The V1 plan owns order and release scope.

## User goal and scope

Record what is known, what still needs measuring, and which existing parts may be
reused. Return later to the same values and their history. This supplies the manual
foundation of BOB-US-007 and BOB-US-009, with a manual missing-measurement list from
BOB-US-008. It does not generate a deliverable-specific checklist or call AI.

Lengths support mm, cm and m, non-negative decimal values with at most three
decimal places, and exact database conversion to millimetres. Keep the entered
value/unit: normalisation is not a new measurement or proof of precision. Other
measurement kinds, stock deduction, calculations and AI consumers remain later.

## Canonical records and history

`bob.measurements` and `bob.existing_components` own stable identity, one project,
optional area, and the current revision number. A measurement may belong to an
existing component in that same project and area. Parent links are fixed after
creation; archive a misplaced record and create the correctly placed replacement.

`bob.measurement_revisions` and `bob.component_revisions` are append-only content
snapshots. Create, revise, archive and restore each produce a server-attributed,
timestamped revision. Earlier values, sources and decisions remain readable.
Writes lock the owning record and require its expected current revision. A stale
edit fails with a reload instruction instead of overwriting another person's work.
Current-head foreign keys require an existing revision at transaction commit.

Measurements store subject, value, unit, truth state, source explanation, notes,
whether the measure is required, and an optional existing project source image.
Manual truth states reuse `TruthState`: measured, provided_spec, estimated, unknown.
Known values require a source explanation. Unknown has a null value, never zero
as a stand-in. Estimates remain explicitly estimated in lists, detail and history;
changing an estimate to measured creates a new revision. User-recorded measured
or specification provenance does not imply independent site verification.

Components store name, kind, optional known count, observed condition,
specification/description, notes, source image and intended action: inspect, reuse,
remove or replace. Unknown count is null. Dimensions are linked measurement
records so their units and provenance cannot become a second free-text numeric
truth. A reuse intention is not a structural-suitability approval. Component
archiving does not erase or silently archive its measurements.

## Authority and source images

Use the existing protected Bob membership and `database.ts` boundary with explicit
project ids and project/auth generation checks. New tables expose SELECT under RLS;
invoker views join each stable record to its current revision. Fixed invoker
`bob.evidence_command` delegates guarded mutations to a private definer with an
empty search path, authenticated-user and membership checks, and independent
same-project checks for areas, components and source images. Caller-supplied
actor/history/parent changes are rejected. Other apps' schemas are untouched.

Source images reuse completed uploads in `bob-project-media`. Selection and
viewing reuse the project gallery and authenticated original downloads. A snapshot
keeps the image title. Deleting the file clears its optional reference but preserves
the historical value/source and title, visibly identifying the removed image.
This does not retain a second copy of the bytes. Area deletion clears optional
area links and keeps project facts. Project deletion may cascade facts/history
only after the existing explicit image-cleanup gate is satisfied.

## Reachable manual workflow

Dashboard links to a focused Measurements & existing parts page. Area detail links
to the same page filtered to that area; no new global navigation or Today editor.
The page separates measurements and components, supports active/archived records,
and offers a To measure filter for unknown/estimated measurements. Component detail
links to its measurements and can add one in the same scope. Lists and history are
paged; an empty first page never implies there are no more records.

Create or update a record, select an optional source image, save, then read back the
server record. Open history to compare revisions, including after reload. Archive
and restore preserve history. Invalid, loading, empty, denied and failed/stale-write
states are explicit; input survives failed saves. A changed project closes the old
context and rejects delayed responses. Demo mode explains that facts are unavailable
there rather than pretending they are durably saved.

## Verification gate

Use actual migration/RLS tests for anonymous, outsider, member and dual-project
member access; cross-project references; current views/history; append-only edits;
decimal/unknown rules; supersession; stale edits; archive/restore; and file/parent
deletion behavior. Drive the production UI at phone and desktop widths for create,
revise, history, source image, component dimensions, reload and project switching.
Separately prove the deployed RPC/views with disposable Auth/PostgREST fixture data,
then clean it up. No owner Bob trial or AI request is part of this gate.
