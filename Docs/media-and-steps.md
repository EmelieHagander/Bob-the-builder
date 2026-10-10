# Project images and illustrated task steps

**Status:** milestones 1A and 1B are implemented and deployed (2026-09-09).
[Verification and rollout evidence](foundation-verification.md) owns the actual
checks and their limits. The V1 plan owns delivery order. The on-demand image
context slice below implements vision input (1C); PR #89 owns rollout proof.

## Ownership and authority

The [September 24 outcome use cases UC-003–005](user-stories.md#product-mandate--2026-09-24)
require both people and Bob to create, attach, revise and consume information,
mockups and guidance at the relevant step. Existing manual uploads and image
vision do not establish AI generation or AI attachment support. The current
`media_links.step_id` is a task instruction-step identity; project-plan Steps
need an explicit same-project relation and rendering path rather than silently
reusing that foreign key. These remain integration work, not shipped claims.

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

AI-generated instruction/proposal images remain illustrations, including after
visual inspection. They do not replace failed CAD or establish checked geometry.
The image inspection carrier preserves project identity, purpose, source kind
and attachments (including living-plan `plan_step_id`). Generated/design images
receive the shared drawing-review instruction alongside their pixels so Bob
checks the linked Step and current project facts before recommending the image.
Changed provenance or attachments invalidate retained image context. A saved
illustration after failed CAD produces one factual completion note; tools remain
unforced and the owner-facing reply remains Bob's responsibility.
AI consumption/generation is outside milestones 1A/1B. The image-on-demand slice
below adds explicit vision reads; chat photos and reference mockups are owned by
the following contract.

## Chat photos and reference mockups

Ask bob's paperclip uploads up to four JPEG/PNG/WebP originals through the existing
project-media commands (6 MiB per image, 16 MiB per message). A ready preview can
be sent with a message or on its own. Failed uploads have a retry action that keeps
the same immutable asset identity. Removing a draft attachment leaves its project
image in Images. Unsent drafts are local to the mounted drawer; uploaded originals
remain in the project even after a page reload.

The user message stores only private same-project `image_ids`. Enqueue v3 binds
the ready image set in the same transaction as the logical turn; retrying an
accepted turn cannot replace, reorder or remove those references. Omission on an
older client preserves the saved set. The private transcript and outgoing-turn
recovery read the IDs back; byte data and download URLs are never stored in chat
or browser persistence. The ready project originals remain governed by membership
and authenticated downloads. Each person still owns their private conversation.

Before the first model call, the attached photos use the existing versioned image
context path. Bob sees the actual pixels and exact IDs. For a placement mockup,
`generate_project_image.reference_image_ids` selects those photos (or other opened,
ready same-project photos). The image provider receives their freshly authorised
original bytes through `/v1/images/edits`. An empty list uses the existing text-only
generation path. Missing, changed, inaccessible or unsupported references fail
explicitly; they cannot silently become a new setting invented from text.
The prompt asks the image model to preserve the photographed setting, perspective
and existing features. The result remains an illustrative proposal.

The assistant bubble shows saved media write receipts as image previews. Originals
open in the shared image modal and survive transcript reload. Generation continues
to use the existing private-media reserve/upload/finalise path and project write
receipts. The AI catalog publishes a new immutable image-tool version; earlier
pinned manifests retain their historical schema.

Verification owners are `bob-chat-images-db.test.ts`, `bob-chat-images.test.ts`,
`project-images-runtime.test.ts`, `project-image-tools.test.ts`,
`openai-image-wire.test.ts` and `check-bob-images-browser.mjs`. The browser fixtures
cover interrupted upload/send, unchanged retry identities, original previews,
reload, unsupported formats and project switching at 320/390/1280 px. These do not
establish real-model visual quality; rollout and real photo acceptance belong to
the feature PR.

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

### Name-only volunteer extension

The project-only volunteer journey can read existing task/area-linked images and
instructions, and update steps on tasks the participant has joined. Required
checks still gate task completion. `completed_by_volunteer` records the Bob person
ID separately from the authenticated actor field; it never invents an Auth user.
Authenticated completion/reopen clears the volunteer actor field.

The P4 instruction-image correction adds `steps[].images` (exact task-instruction
links, with purpose) and `contextImages` (task, Area and current primary work-Step
images) to `volunteer_task`. The existing `images` union remains for older clients.
The participant view places each instruction's images beside its text. Reusing an
original in two instructions and replacing one link preserves the other; refresh
clears downloaded previews and reads the current links. Task instructions and
project-plan Steps remain distinct identities. Rollout and live proof are tracked
in [P4 verification](foundation-verification.md#p4-product-acceptance--2026-09-30).

Images are downloaded through the capability-checked `volunteer-media` Edge
function. It checks current access and the exact task/image relation before and
after fetching original bytes; it returns `no-store` responses and never makes
Storage public. [The data contract](../db/README.md#name-only-volunteer-access)
owns this extension. The additive P4 migration is applied and its browser and
live participant HTTP proofs are recorded in the linked P4 verification. Real
phone/participant product acceptance remains separate.

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
claim the broader Context Router, Process Lens, full Project Catalog or Project
Librarian are built. P3 Current View is separately deployed, with named-member acceptance pending
with its status owned by [the context contract](ask-bob-context.md#implemented-scope-and-remaining-target). The registry currently exposes **images**;
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

## Generated media and living-plan Step links — September 24 integration

The CAD specialist's selected-image handoff and matching current-fact grounding
are owned by [the CAD assistant contract](cad-adapter.md#cad-assistant-integration--2026-09-24).
The handoff carries refs; the specialist reopens authorised originals. It does
not turn metadata or a parent caption into a viewed-image receipt.

Implementation branch adds `media_links.plan_step_id` alongside the existing Task instruction `step_id`. Exactly one target is present. Linking validates the current project plan; a stable Step retains its links across ordinary replanning. Project-home Step workspaces show descriptions, linked current CAD revisions and the existing project-image controls. User uploads and Bob-created images use the same private media store. The broader guest/volunteer Step view remains unverified; this change does not declare all five outcome use cases complete.

`generate_project_image` uses the shared configured image-generation path, then reserves a canonical media record, uploads through the caller's Storage authority and finalizes against actual object metadata. Only proposal/instruction purposes are generated; provenance is `ai_generated`. A reservation is visibly pending. Failed upload retains its ID; failed finalization can use `finalize_project_image` without another generation/upload. `attach_project_image` reuses existing ready media. Every database action uses the claimed-turn write ledger; a final success requires real bytes and the saved attachment. The model never receives storage credentials or arbitrary destinations.

Apply `20260924084046_bob_cad_and_project_tools.sql` then `20260924084937_bob_step_media.sql` and `20260924092456_preserve_cad_artifact_revisions.sql` before deploying matching Edge/frontend code. These are additive changes to Bob's shared-database objects and scoped AI settings; no other app settings or project records are migrated.


### Primary-Step volunteer images — September 24 review correction

Source implementation, pending release: a name-only volunteer opening a Task can
read its current primary Step's ready images as well as the existing Task, Area
and instruction images. Both the Task response and the media capability check
validate that current relationship; a stale image ID grants no access after a
Task move or revocation. The UI calls Task-level checks “instructions”, reserving
“Step” for project work. Volunteer consumption of saved drawings remains a
separate gap in `Docs/user-stories.md`; Step images alone do not complete it.

The same correction fixes volunteer image response handling: the app fetches the
existing capability endpoint as binary and keeps its original MIME type. The
Functions client parses `image/*` as text, so it is not used to decode these
responses. The endpoint still checks the capability before and after download;
no Auth session or general Storage access is added.

### Compact image journal and optional descriptions — September 28 implementation

Status: deployed on 2026-09-28 in PR #154, alongside the retry cap from PR #153. A live CAD
request accumulated about 13.9 MB of checkpoint JSON across repeated source-image
opens. `bob_save_job_step` timed out while serializing every previous value for
its cumulative size check, and subsequent job claims also timed out.

New source-image opens checkpoint metadata and a private reference bound to the
exact media version. They do not download or checkpoint base64 pixels. Bob and
CAD rebuild the reference registry from those checkpoints on resume. The shared
Responses transport resolves references only immediately before a **new** POST;
a pending/completed provider job is resumed without fetching those images again.
The caller JWT, project, ready state, immutable object path, revision, byte count
and signature are checked before/during download, and the revision again after.
The reference digest identifies metadata version, not an image-content checksum.
No signed URL or storage credential is persisted. Existing inline checkpoints
remain readable; already-generated images and CAD render packets retain their
existing bounded checkpoint format.

`bob_job_steps.value_bytes` stores the exact JSON byte length once. Journal limits
remain 24 MB per checkpoint, 64 MB total and 512 entries, under the existing job
row lock. An identical checkpoint replay succeeds even at the entry limit.

When Bob has actually received an image in a successful model call, the optional
`describe_project_image` tool can cache up to 500 characters of visible content.
It does not trigger a dedicated vision request or automatically scan the album.
Descriptions are private per owner, bound to the image version, and marked
`ai_visual_observation` / `verified: false` when returned in metadata lists. They
help select images; visual detail still requires opening the original. They are
not verified measurements, write receipts or instructions. The tool cannot cache
an unseen, merely prepared, changed or revoked image. Saving also requires the
active server turn claim. Deleting an image deletes its descriptions. The
existing twelve-operation image-context budget includes description operations.

Validation includes a four-image fixture with 10 MB of source pixels and under
5 kB of checkpoints, exact decoded provider bytes, no downloads on waiting or
completed replay, revision invalidation, owner isolation, stale-claim rejection,
and unchanged byte/count limits. Provider requests in these tests are mocked;
this is not a live cost-reduction measurement.

Release order: let active Bob jobs drain (tool specs are part of replay
fingerprints), apply `20260928141215_bob_compact_image_journal.sql`, then deploy
matching `ask-bob` and `bob-worker` code after CI. The generated byte column
requires a bounded table rewrite; migration lock/statement timeouts fail the
transaction rather than allowing a partial rollout. Roll back Edge code first if
needed; the additive database schema is compatible with the old code. This
change is independent of the bounded provider-retry correction in PR #153.


Release verification (2026-09-28): main commit
`9be9db83253512fee618dbd64a4781f1b2360324` includes both fixes. The
[combined CI](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36436287680)
passed all 610 tests, Edge checks, production builds and browser flows. CI first
caught a missing offline tool-catalog seed row; that was corrected before release.

The migration is recorded by the managed API as
`20260928143632 / bob_compact_image_journal` (source timestamp `20260928141215`).
Deployed `ask-bob` v53 with JWT verification and `bob-worker` v21 with its existing
per-job capability check. Retrieved runtime files match the reviewed source;
the type-only provenance module is omitted by the bundler. Deployment required
rebuilding the relative import graph because an older file manifest omitted
`ai-background.ts`; the failed bundle did not activate a version.

A hosted rollback-only fixture passed caller-scoped cache reads, denial of
browser writes and outsider reads, stale-image invalidation, idempotent compact
checkpoints and byte accounting; no fixture project remains. HTTP probes return
401 for an unauthenticated Ask Bob request and 403 for an invalid worker
capability. The database advisor's private-table/no-policy and guarded
SECURITY DEFINER reader notices are intentional and covered by those checks;
see the [database advisor guidance](https://supabase.com/docs/guides/database/database-linter).
The owner's fresh visual/CAD run and actual cost improvement remain to be tested.


## Project thumbnails

`bob.project_thumbnails` stores one optional ready image per Project. The composite
foreign key enforces same-Project identity and cascades image deletion to the pin.
`pin_project_thumbnail` applies the same current membership authority as image
uploads, validates a ready image, serialises against removal, and supports explicit
unpin. Authenticated clients have scoped SELECT only; anon and direct writes are
denied. Pending/deleting images are not displayed as overview thumbnails.

Pin controls live only in the Project image gallery. Home and Project headers use
`ProjectThumbnail` with protected downloads and a decorative fallback, without
public URLs or storage permission changes. Account reads never switch the active
Project. Blob URLs are revoked on unmount/scope changes; failed/revoked downloads
fall back without blocking navigation. Original uploads remain unchanged.
