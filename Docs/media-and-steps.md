# Project images and illustrated task steps

**Status:** milestones 1A and 1B are implemented and deployed (2026-09-09).
[Verification and rollout evidence](foundation-verification.md) owns the actual
checks and their limits. The V1 plan owns delivery order; vision remains 1C.

## Ownership and authority

Images are durable project records. Use a new private `bob-project-media` bucket;
the public `bob-assets` bucket and `bob.asset` app catalog keep their existing job.
An image belongs to exactly one Bob project. The current membership rules apply
to its metadata, bytes, links and all task steps, including members of two projects.
The frontend supplies an explicit project id through `database.ts`; the backend
validates every relation and operation independently.

`bob.media_assets` owns the storage identity, original filename, title, purpose,
MIME type, byte size, image dimensions, uploader, timestamps and lifecycle state.
`bob.media_links` attaches one existing asset to an area, task or step. Every end
must belong to the asset's project. A project image may have multiple links; it is
always discoverable from the project's image collection even without a link.
An attachment never copies the image bytes or transfers project ownership.

Normal clients read these records through RLS and mutate them through fixed domain
commands. Guarded definers live only in `bob_private`, use an empty search path,
validate `auth.uid()` and membership, and expose invoker wrappers in `bob`.
Protect identities, parents, uploader and lifecycle from direct client updates.
Storage policies are limited to the new bucket and include restrictive guards so
a broader permissive policy cannot grant access or replacement rights.

## Image lifecycle and recovery

Support JPEG, PNG and WebP originals, up to 6 MiB each. SVG, HEIC and other formats
receive an actionable validation message; no silent format conversion or cropping.
The browser checks decode/dimensions before upload. Storage enforces MIME and size
limits; finalisation checks the Storage object metadata against the reservation.
Image pixel dimensions describe the file, never measured dimensions of the build.

1. Reserve an immutable, unique `project/id` storage path and optional attachment
   in a database transaction. State is `pending`; actor/time come from the server.
2. Upload via the Storage API with replacement disabled. Only the reserving member
   may fill a pending upload. No ready image may be overwritten at that path.
3. Finalise only after the actual object exists with the expected MIME type/size.
   State becomes `ready`. An interrupted response leaves a visible pending record;
   check/finalise it again or remove it and select the file again.
4. Read originals using authenticated Storage downloads, not persisted public or
   signed URLs. Browser object URLs are temporary and revoked on unmount/project
   switch. Reopening/refetching checks access again. Previously delivered bytes
   cannot be recalled from a user's device after membership is revoked.
5. Removing an image first marks it `deleting`, then removes bytes through the
   Storage API, then removes metadata/links only after object absence is checked.
   Interrupted deletion stays visible with a retry action. Never delete an object
   row with SQL as a substitute for deleting the stored file.

Deleting a link, step, task or area removes attachments but keeps original project
images discoverable. Project deletion is restricted while it owns images; perform
explicit file cleanup first. Replacing an image creates a new asset and identity.
Removing a project image explains that all its attachments will disappear.

Purposes are current state, reference, instruction, proposal, progress and as-built.
These are user-provided classifications. A supplied instruction/proposal is not a
verified drawing; a photo alone does not verify a measurement or professional check.
AI consumption/generation is outside these milestones and the lookup allowlist
does not expand merely because new tables exist.

## Manual task detail and steps

`bob.tasks.instructions` stores the task's manually supplied scope/instructions.
`bob.task_steps` stores a stable id, project/task parent, title, instruction text,
order, revision, checkpoint/required flags, completion actor/time and timestamps.
There is one ordered level of steps. Nested task hierarchies and generated guides
remain later scope. Concurrent edits use a revision check; order/create/delete
operations serialize through the parent task. Stale edits ask the user to reload.

A step can be ordinary work or a completion check. Required checks are labelled
and must be completed before the task can be marked done, including via the normal
API. Reopen a completed task before adding or reopening a required check. Completing
steps does not automatically complete a task or certify a professional inspection.
Images on steps reuse the same upload, existing-image attachment and read-back path.

## Reachable UI and verification

Use the existing Dashboard project images, Area images and expanded task detail;
no new top-level navigation. Keep task cards short, with instructions and ordered
steps available from the task. Preserve legacy reference labels as clearly labelled
notes, never as uploaded-image tiles. Show purpose/source/time, complete originals,
loading, errors, pending uploads, retryable deletion and permission failures honestly.
Use existing theme/form/modal primitives, 44px actions and mobile layouts.

Live mode persists through Supabase. Demo mode must explicitly disclose its limited
persistence and must not claim an image was uploaded to the project backend.

Required evidence: actual Postgres/RLS tests for cross-project rows/links/bytes,
protected fields, lifecycle recovery, stale edits/order and required checks; browser
proof through the production build for upload, attach, view original, edit/reorder/
complete, reload and project switching at phone and desktop widths. A fixture-backed
browser test does not prove deployed Storage; record any live API proof separately.
The owner does not need to test Bob or invoke AI for foundation work to proceed.

## External contracts checked

- [Private bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Storage RLS](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage schema and API-only object deletion](https://supabase.com/docs/guides/storage/schema/design)

See [the verification record](foundation-verification.md) for the applied migration
and actual test/deployment results.
