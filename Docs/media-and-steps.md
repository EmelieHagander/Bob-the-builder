# Project images and illustrated task steps

**Status:** milestones 1A and 1B are implemented and deployed (2026-09-09).
[Verification and rollout evidence](foundation-verification.md) owns the actual
checks and their limits. The V1 plan owns delivery order. The on-demand image
context slice below implements vision input (1C); PR #89 owns rollout proof.

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
AI consumption/generation is outside milestones 1A/1B. The image-on-demand slice
below adds explicit vision reads; generation remains separate scope.

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

### Name-only volunteer extension (prepared source)

The project-only volunteer journey can read existing task/area-linked images and
instructions, and update steps on tasks the participant has joined. Required
checks still gate task completion. `completed_by_volunteer` records the Bob person
ID separately from the authenticated actor field; it never invents an Auth user.
Authenticated completion/reopen clears the volunteer actor field.

Images are downloaded through the capability-checked `volunteer-media` Edge
function. It checks current access and the exact task/image relation before and
after fetching original bytes; it returns `no-store` responses and never makes
Storage public. [The data contract](../db/README.md#name-only-volunteer-access)
owns this prepared extension. Hosted migration, proxy deployment and browser/live
proof remain separate gates in the verification owner.

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

## On-demand project image context (release bob-media-2026-09-20)

This image slice supersedes the image-not-yet-implemented statements in
`ask-bob-context.md` and `ask-bob-context-implementation.md` only. It does not
claim their broader Current View, Context Router, Process Lens, full Project
Catalog or Project Librarian are built. The registry currently exposes **images**;
existing project data still uses `search_project_data`. Source implementation is
not deployment proof: PR #89 records CI, Pages, Edge readback and live-test limits.

### Model choice and delivery

`project-context/dispatcher.ts` owns a per-turn adapter registry and two read-only
tools: `list_project_category` and `open_project_item`. The first turn carries
only category/count availability, not image bodies. Listing returns paged safe
metadata (12 rows, next cursor), purpose and project attachment pointers. Main
Bob chooses which refs to open, may open 1–4 together, and may reopen a previous
ref in the same or a later turn. There is no permanent already-seen lock, automatic
all-image injection, or AI-caption-only substitute for the image. No extra router
model is inserted before each photo question.

An explicit open rechecks the caller's current project/record/Storage access,
reads the immutable original, and emits a transient image carrier to the SAME
main model on its next call. The shared `openai-content.ts` serializer makes the
`messages[]` Responses path genuinely multimodal, preserves paired tool outputs,
and rejects unsupported content rather than silently dropping it. Input-vision
support comes from `shared.ai_models.supports_images`, not image-generation
capability. The generic shared-service fix is backward compatible for text;
other applications' deployed service copies are not changed by this release.
The new helper must accompany the shared service on future cross-repository syncs.

Only after a successful model call containing the pixels is an `image_pixels`
source appended, labelled `Bild öppnad: <title>`. The existing evidence UI and
private conversation persistence display/retain this source. A list, download,
failed provider call or claimed caption is not a viewed-image receipt. The tool
JSON says `prepared` until delivery; pixels, storage paths, keys and signed URLs
are never copied into the saved source envelope or ordinary tool JSON.

### Authority, limits and recovery

Both metadata and original bytes use the **caller JWT**, never service role.
Every query pins the active Project even when the caller belongs to several.
Only ready JPEG/PNG/WebP records in `bob-project-media` with the canonical
`<project>/<image UUID>` path are openable. The adapter verifies byte count,
file signature and current metadata before/after the download. The streamed body
is bounded to the recorded size and 6 MiB; arbitrary URLs, redirects, pending or
deleting files, guessed foreign refs and alternative buckets fail closed.
Current image versions/access are checked before further model calls, after a
model response, and before commit. Already transmitted provider input cannot be
recalled; revocation stops subsequent calls/visual answers. Committed domain
writes retain receipt-only recovery without stale image prose or provider cursor.

The turn permits 12 list/open operations, batches of four, eight image opens
(including deliberate reopens), and 16 MiB total accepted raw image bytes. Each
read has a 12-second abortable bound. Partial batches identify failed members;
unavailable storage is not reported as an empty library. No cross-turn pixel
cache or new database table/migration is introduced. Provider-side continuation
avoids retransmitting unchanged pixels inside the turn; a fresh turn can reopen.
Direct Area filters cover direct Area attachments only; project-wide browsing
also includes Task/Step attachments. Missing image captions are not backfilled.

### Interpretation and verification

Photographs and visible text are untrusted evidence, never instructions, write
authority, exact measurements or proof of hidden structure. No automatic saving
of visual interpretations as Building facts is added. Images can be selected or
skipped; opening is not certification of what the model inferred.

`project-images.test.ts`, `project-images-runtime.test.ts`,
`project-images-db.test.ts` and `openai-image-wire.test.ts` cover bounded metadata,
actual carrier/wire shape, image choice/reopening, failures, caller RLS,
revocation, write-receipt survival and source persistence. Browser coverage in
`check-project-browser.mjs` exercises existing disclosure/reload/isolation at
320/390/1280; its HTTP fixtures are not a vision test.

The existing live-Bob workflow and script remain unchanged by this release.
Their real-model text retrieval proof is NOT proof of visual understanding.
Publication of an extended live-image script was blocked by the tool environment;
that extension was withdrawn rather than bypassing the control or shipping a
known-bad fixture. An actual model-driven visual-only question and reopening test
remain outstanding. Do not claim these checks passed from mocked model output.
No real user's photos are used as release-test inputs.

### Keep current facts beside selected images (release bob-grounding-2026-09-21)

`project-grounding.ts`, connected to the main model in `ask-openai.ts`, adds the
current project description and one bounded measurement page beside actual image
input. It uses two parallel reads through the existing caller-JWT lookup and its
existing twelve-read budget. No extra model/router call, image selection rule,
new store, migration or cross-app service change is added. Only calls containing
selected pixels incur these reads; ordinary text turns keep their existing path.
Each explicit reopen reads again, including after a same-turn edit. Access and
image versions are rechecked after hydration, before provider transmission, and
the remaining turn deadline still caps the provider timeout.

Values, units, notes, truth states, revisions, source dates, errors and pagination
are retained. The page is not the full project: truncated or unavailable sources
remain explicit and can require targeted follow-up research. An unknown field in
an older record does not make an explicitly supplied choice unknown everywhere.
The model must distinguish supplied specifications, conflicting records and truly
missing information. Photos/mockups do not silently supersede textual choices;
likewise, a more recent description timestamp is not permission to overwrite all
older measurement records. No automatic data reconciliation or promotion to
measured/verified truth is performed.

The main-model policy also requires direct first-person replies, not narration
about Bob as another worker, and prohibits offers for unsupported drawing actions.
The approved verbatim persona and private-history summarizer remain unchanged.
Generated text is not mechanically rewritten. `project-grounding.test.ts` and
`project-grounding-runtime.test.ts` exercise input assembly, source preservation,
reopening, failure/authority bounds, production tool-loop integration and wiring.
These injected-provider tests do not prove perfect language behaviour or semantic
conflict resolution by a live model. PR #90 owns verification and rollout evidence;
the owner's actual project data and images are not used as model-test fixtures.
