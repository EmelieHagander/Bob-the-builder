# Runtime path audit — 2026-11-04

**Correction update:** all five technical findings are corrected and installed
through [PR #461](https://github.com/EmelieHagander/Bob-the-builder/pull/461),
with focused verification and exact hosted readback below.
The original audit and its measurements are preserved as the pre-fix snapshot;
they are not the current implementation verdict. No paid model/CAD/image run or
owner visual acceptance is claimed. This document records evidence, not a new
domain contract. [Correction and rollout evidence](#corrections).

Baseline: `dbb1b5986c52f7195e0ed327f6b9ee8eb2386db8` after #458/#459.
Readback confirmed the installed `bob-worker` v197 and `ask-bob` v229 still have
the exact bundle hashes recorded in the [Rita rollout](p25-live-window-anchor-followup-2026-11-04.md#exact-source-rollout-2220-utc).

The owner asked whether other paths share the identity/handoff/schema problems
encountered while binding Rita. Read-only inspection also confirmed the current
published manifest `1d72bcf6-a986-4f90-9f5d-3f2bf283156e` has the same worker
ownership/knowledge used by the focused catalog probes. Scope covers coordinator/worker handoff, catalog
reconstruction, provider serialization, checkpoint/restart, source readback,
planning, materials, images and CAD piece/background delivery. It is not an
exhaustive review of every app endpoint or a new paid end-to-end acceptance run.

## Findings

| ID | Priority | Confirmed mechanism | Consequence / confidence |
|---|---|---|---|
| A1 | P1 | New bound Rita sessions exclude piece/shell/link writers, while Bob hides the same worker-owned tools. | No current coordinator route to those operations. This is a regression introduced by #458's narrow fence. |
| A2 | P1 | Konrad and Mattias have no equivalent operation source/destination binding. | Same-project assignment identity remains model-selected. Missing binding is confirmed; no wrong write or cross-project bypass was demonstrated. |
| A3 | P2 | CAD identity/section readers fetch the complete RPC record before selecting metadata or a JSON path. | Avoidable recipe/annotation/source payload. Actual Ladan RPC is 260,868 bytes, not the 3.3 MB stored CAD row; no new CPU shutdown attribution. |
| A4 | P1 | Image generation precedes validating/reserving the attachment target; the retry key includes the target. | Invalid target can waste a generation; changing only the target can generate the same motif again. Confirmed with a stub provider. |
| A5 | P2 | The session removes disabled build-guide fields, but catalog reconstruction restores them. | Actual model schema can disagree with the feature's executable surface. Identity fields remain protected by the Rita transform; the guide execution switch still applies. |

### A1 — Scoped Rita closed the only owner of larger drawing operations

`project-tools/bob-tools.ts:245` excludes `plan_cad_pieces`, `compose_cad_shell`,
`link_cad_shell_steps`, `link_project_drawing`, `link_drawing_gap` and
`ensure_drawing_gap_task` whenever `drawingWorker` is true. Every new drawing
handover gets that mode from the pinned `drawingBindingVersion:1`.
`project-answer.ts:458` independently hides worker-owned tools from Bob.
The catalog assigns these operations to Rita, with no alternative owner.

A prepared-session probe verified that the piece and shell tools are offered on
the older unbound bench, absent on the new bench, and owned only by Rita. In
addition, `resolveDrawingWork` requires one source, so a multiple-source job can
stop before reaching Rita at all. The underlying piece implementation still works
in isolation; its passing tests do not establish a reachable coordinator path.

This restriction was introduced in the previous change to prevent bypassing the
single-drawing binding. Leaving the larger flow unreachable is not an acceptable
completion of that correction.

**Repair:** supply explicit code-owned operations for single drawing, piece batch,
shell composition and work linking. Carry the verified source/destination tuples
through each operation's save/restart. Expose the appropriate operation to its
owner. Do not restore the old unrestricted tool bench as a shortcut. Add a test
from an ordinary Bob handover through the actual catalog/session to the requested
piece/shell operation, including retry after partial success.

### A2 — Other colleagues still choose existing source/record identities

The plain request handover remains the common contract. Only the `drawing` branch
in `project-answer.ts:525` calls a binding resolver. Konrad still receives
`edit_construction_parts.record_id` and `expected_revision`; Mattias still receives
`save_construction_cut_plan.artifact_id` and `revision`, as well as the source
fields described by `derive_cad_material_requirement`.

Their knowledge starts with project-wide constructions, not a durable job source
pin. `worker-form-piece.ts` deliberately marks the Plan focus as
`assignment_confirmed:false`: it is a navigation hint. The v4 construction piece
preflight protects its configured review workflow; it is not a universal identity
binding for every Construction or material job.

An offline provider-schema probe confirmed those identity fields remain offered
to the respective roles. This establishes the missing handover contract, not an
observed wrong-object mutation. Current project authorization, revisions, material
pins and deterministic quantity/write validation still apply. Selecting a valid
but unintended object within the same authorized project is the relevant risk.

**Repair:** bind the approved work context and exact existing source in code for
Konrad/Mattias too, using server-issued read selections where intent needs to
choose among objects. Preserve the colleagues' actual design/material judgement;
local part keys, material choices and proposed geometry are not transport IDs to
remove indiscriminately. Exercise two valid constructions in one project and
reject an attempted switch after the job has been bound.

### A3 — Metadata and sections are still narrowed after retrieval

`ask-openai.ts:864` uses `read_cad_artifact` for `readBoundDrawing`. The generic
CAD section callback at `ask-openai.ts:1061` uses the same RPC.
`project-record-detail.ts:18` receives the record before following `path`; its
24,000-byte result limit runs after this retrieval. Thus a small output does not
imply a small upstream read. A focused synthetic probe passed 260,082 bytes into
the reader for a 131-byte returned section.

Read-only inspection of the current hosted function chain confirmed **no `files`
field is returned**. A member-context, read-only invocation measured the actual
revision 3 RPC response without printing geometry, media, identity claims or
private packets:

| Ladan revision 3 measurement | UTF-8 JSON bytes |
|---|---:|
| Stored CAD row | 3,286,423 |
| Stored `files` field | 3,014,447 |
| Actual `read_cad_artifact` response | 260,868 |
| Recipe in that response | 12,905 |
| Manifest in that response | 170,494 |
| Annotations within that manifest | 44,418 |

The initial commentary used the stored-row size too broadly. The RPC excludes
those 3 MB of files; the audit corrects that distinction explicitly. The remaining
finding concerns unnecessary geometry/metadata and post-fetch selection, **not**
a demonstrated 3 MB download in Bob's identity reader or proof of the CPU root
cause. The new chat preview already fetches one exact saved SVG separately.

**Repair:** use a small caller-authorized drawing identity/scope projection for
routing and server-side exact-revision section selection for section reads.
Retain source access/freshness checks. Measure actual dispatched/journaled bytes
and CPU before deciding whether broader optimization is justified.

### A4 — Attachment validation occurs after image generation

`project-image-tools.ts:65` calls the provider. `image_reserve` is first attempted
at line 73, where the database checks the actual attachment target.
`bob_private.link_media` enforces the target's same-project identity (including
Plan Step versus Task instruction Step). Invalid/removed/wrong-project targets
cannot be saved, but the generation can already have happened.

The successful generation is remembered only after reserve succeeds. Its
`requestKey` includes `target_kind` and `target_id`. The isolated probe returned
an invalid reserve and observed `provider -> image_reserve`, with no saved media
identity. Retrying the exact prompt/references with only a corrected target invoked
the stub provider a second time. No real provider was called.

**Repair:** preflight and pin the target before paid work; create a durable image
operation identity before dispatch. Separate generation identity (including exact
reference versions/provider configuration) from attachment work. Preserve a
successful result when an attachment fails or changes concurrently so link repair
can reuse it without another generation. Existing pending-upload finalization
already follows the right no-regeneration recovery principle.

### A5 — Another session-only schema transform is lost

`project-tools/bob-tools.ts:264` calls `withoutAssemblyOrder` when
`buildGuideTools` is false. `bob-workers.ts:270` sends general catalog parameters
but no guide-off restriction. `ai-catalog.ts:338` rebuilds every schema from the
catalog; line 339 reapplies the Rita identity transform only.

An actual catalog-binding probe with the guide disabled confirmed
`assembly_dependencies` absent from the prepared drawing tool and present again
in the final model tool. The hidden `request_id` stays absent. The backend guide
switch still prevents guide execution when off: this finding is a schema/capability
mismatch and needless input work, not permission elevation. No assertion is made
that the guide is currently disabled in production.

**Repair:** use one declared, server-owned binding mechanism through session,
context renewal, catalog resolution and both provider adapters. Verify the final
provider surface against the domain handler for feature-on/off and role variants.
Do not accept arbitrary schemas in place of the catalog or add one unrelated
exception per incident.

## Coverage and verification

| Path | Evidence / status |
|---|---|
| Bob coordinator, worker ownership and native schema reconstruction | A1/A5 reproduced through real catalog/session code. |
| Konrad | A2 transport fields confirmed; review/Plan gates and saved-piece restart checks retained. |
| Rita, exact one-Construction drawing | Existing identity fence retained; larger-operation reachability A1 and metadata overhead A3 remain. |
| Mattias/materials | A2 source identity unbound; material finder maps short refs back to server-owned catalog values, not model-invented IDs/prices. |
| Plantus/Vera plan compilation/review | Server fills `expected_revision` from the snapshot and validates saved identities. Focused proposal, identity, denial and replay tests passed. |
| Shared specialist calculator | Assignment, policy, source reads, manual discovery and context renewal tests passed; no wider toolbox fallback. |
| Images and attachment/finalize | A4 reproduced; access/quote denial, exact retries and pending-upload reuse tests passed. |
| CAD pieces and background release | Eight focused tests passed, including isolated SQL queue/source checks. These do not cover the missing coordinator route in A1. |
| Drawing-request resume/cancel/restore | Fresh cancellation and completed-operation reconstruction checks passed; original request identity retained. |
| Provider/continuation | Anthropic serialization and shared worker checkpoint tests passed; A5 occurs upstream during shared catalog reconstruction. |

- **76 existing focused tests passed:** 65 across plan assistant, images, worker
  checkpoints, specialist discovery, CAD resume views, drawing-request store and
  Anthropic adapter; 3 material-finder tests; 8 CAD-piece tests (one isolated local
  SQL fixture). These are not the full suite/CI or real-model acceptance.
- **Five additional isolated probes reproduced A1–A5.** Their assertions document
  the current defects; they are not green acceptance tests for the desired fixes.
  Probe A2 demonstrates an absent binding, not an unauthorized mutation.
- The probes use synthetic data and stub providers; no provider cost was incurred.
  No full CI, workflow, paid run, browser publication or production write started.
- Production reads verified the two unchanged function hashes and measured JSON
  sizes. They did not fetch/export file contents or inspect unrelated projects.
- No confirmed cross-project write was found in the examined paths. This audit
  does not replace a complete authorization/security assessment.

## Recommended order

1. **A1:** restore larger drawing/link operations through typed, reachable bindings.
2. **A4:** validate image targets before dispatch and preserve generated results
   across attachment-only repair.
3. **A2:** extend operation identity binding to Construction/material work.
4. **A5:** carry feature/schema restrictions through the final catalog/provider
   surface rather than accumulating local transforms.
5. **A3:** introduce thin metadata/section reads, then measure actual CPU impact.

The [delivery State](bob-delivery-flow.md#state) owns subsequent implementation and
acceptance. This audit does not close the existing facade/owner visual gate or O5
whole-run cost/CPU measurement.


<a id="corrections"></a>
## Corrections and verification — 2026-11-04

| Finding | Implemented correction | Focused evidence |
|---|---|---|
| A1 | Code-owned single/batch/shell/work-link adapters restore Rita's tools; exact unreleased requests recover without duplication. | Ordinary Bob → Rita catalog/session → batch dispatch; shell/Step/gap tuple mapping; partial-release retry with changed-intent rejection. |
| A2 | Konrad/Mattias source pins and server-issued record selections survive checkpoints; raw ID/revision overrides and source switches fail. | Two same-project constructions; stale/revoked references; own-write revision advance; canonical need/cut-plan reuse; overview does not assign an existing construction to a new job. |
| A3 | Authenticated thin drawing identity and SQL-selected exact CAD sections. | Full-schema isolated SQL tests with 280 kB annotations and 1 MB files; metadata <1.8 kB; requested scalar returned directly; Edge full-read callback never called; foreign identity, paths and oversized envelope rejected. |
| A4 | Target preflight precedes generation; project media save/finalization precedes attachment; generation key excludes target changes. | Stub provider stays at zero calls for invalid targets, one for attachment repair through a JSON checkpoint; version/config changes create a distinct key; pending-upload recovery does not generate again. |
| A5 | Common declared runtime surface reapplied after catalog reconstruction and renewed context. | Guide on/off and bound/unbound worker schemas; actual OpenAI and Anthropic request serializers; rollover retains the server restriction. |

Focused local validation: 95 tests passed across the affected worker, catalog,
context, provider, image, drawing and record-reader suites; five isolated SQL
access/projection tests passed. The subsequent complete worker/operation rerun passed 23 tests, including
overview/new-construction and duplicate-label routing; the complete impacted
worker/piece rerun passed 30 tests, including the full nine-test piece suite.
These batches overlap; their counts must not be added as independent tests. Deno checks
both Edge entrypoints using installed equivalent dependency declarations; the
exact remote esm imports were unreachable locally. `git diff --check` passed.
No full CI/workflow, browser or paid provider call was started.

The hosted installation/readback below closes A1–A5 as technical findings. Owner facade/visual acceptance (#438), frontend publication and O5
whole-run CPU/cost measurement remain separate. Ladan geometry is not changed
by these runtime corrections.


### Exact installation — 2026-11-04, 23:43 UTC

- Merged source: `a5750fbe76c0cfb3a01dee9e4cd90d5993d14f0f` (#461), tree
  `548170b1dbf2c7034dbd852c2ab1e7385d48280f`. This is byte-identical
  to the locally checked tree and the published review tree.
- Project URL/ref was checked twice: `yuobtgoidmmmwfqenkau`.
  Zero queued/running jobs and unchanged prior v197/v229 bundles were checked
  immediately before release. No project reset or geometry write occurred.
- Applied migration `20261104234159_bob_runtime_operation_paths.sql`;
  exact SQL SHA-256 `42a1b68de3e0718b793a6e4c055430a05bddf93c49168bd2995c046b90a99369`.
  The CLI-created file was renamed to the hosted history version; SQL is unchanged.
- Immutable catalog manifest:
  `6490dd53-06ad-4c36-ae15-a09e6731e2a9`. Both material worker read ownership
  and its role key include `read_project_work`; prior versions remain available.

| Consumer | Installed version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 198 | 140 | existing capability authentication | `e40045447642bedc0cf47ee977a395f72bd5b92a29799904f48e7317c1445596` |
| ask-bob | 230 | 142 | required | `ff17b1f3cda370d7a5e383a1749d1869c9f2df5272d9880b57c50de4ca3e5a78` |

Every deployed file was read back and compared byte-for-byte with the prepared
merged-source bundle, including all unchanged files, imports and entrypoints.
Both functions are ACTIVE. Unauthenticated POST smoke checks return HTTP 401
from both endpoints without creating a job or invoking a provider. The twelve changed shared files and two new shared
modules are present in both closures; no unrelated bundled file was dropped.

All five new RPCs are SECURITY INVOKER, fixed empty search_path, executable by
authenticated callers and denied to anon/service_role. Existing advisor groups
remain; no advisor finding names a new helper. This is not a clean bill of health
for unrelated projects in the shared Supabase instance.

A read-only production probe used the actual project member identity under
`authenticated` (not an admin data read): Ladan drawing revision 3 and
Construction revision 5 remain current; all reference checks pass, scope is
ready with 41 small entries, and image-target preflight is ready. The identity
projection is **477 bytes of serialized jsonb text**, omitting recipe, manifest
and files. The requested units-section envelope is **178 bytes**. These are
SQL projection sizes, not whole-request/provider CPU measurements. No geometry,
private claims or pixels were printed and no model/render was dispatched.

Validation batches: 95 focused runtime tests; five full-schema isolated SQL
tests; 30 impacted worker/piece tests; final 23 worker/routing tests after the
additional overview/record-reference corrections. Batches overlap. Both Edge
entrypoints type-check, and the exact provider serializer tests use stub
network/model responses. No full CI, publication workflow or paid run was started.

Owner facade/visual acceptance (#438), frontend publication and O5 whole-run
CPU/cost measurement remain open. These corrections do not approve construction
safety or prove a complete real Bob delivery.


<a id="live-retry-2026-11-05"></a>
## Owner retry — 2026-11-05: execution completed, visual delivery failed

Read-only investigation of job `c085aae0-eb0b-45a8-88aa-bbf5727b3cc3`, turn
`be3cfe4c-43b8-44c2-8a82-dec00164e80d`, 06:24–06:26 UTC
(07:24–07:26 Europe/Stockholm), on worker v198 / ask-bob v230 and the
installed manifest above. The owner requested another attempt. The job ended
`completed` with no error code, seven claims and an explicitly **partial**
delivery. Execution completion is not owner acceptance or complete delivery.

The sole write was `drawing_link`: existing drawing revision 3 was linked to
`Placera och granska fasadöppningarna`. Construction revision 5 and drawing
revision 3 remain unchanged; saved isometric/front views exist. This is actual
acceptance evidence for the restored code-owned work-link path (A1), not for
the whole drawing workflow. There were zero CAD consultations, renders or CAD
reviews. All six Rita model calls succeeded. Her trace contains read/section
calls, including two `too_large` results, and the successful link; it contains
no `open_project_item`, `design_project_cad` or `save_cad_design` call.

Two separate visual gaps are confirmed:

1. **Published web is old.** The latest successful Pages publication is
   [run 41465780179](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/41465780179),
   commit `3d114f2a3ddbc451484433cc4ccda2c3d912b314`, November 2.
   A direct HTTP read of the live Pages document and its
   `assets/index-D_8n-qmv.js` confirms it lacks the `bob-chat-drawing` component
   marker. The merged #458 preview has not reached this published UI. No browser
   rendering proof or publication workflow was run in this investigation.
2. **The assistants cannot reopen a saved CAD view as pixels.** Both shared
   context registries in `ask-openai.ts` register only `mediaAdapter()`;
   `project-context/media.ts` opens `image:<media-id>` from ordinary media.
   There is no saved-CAD-view adapter there. JSON section reads expose text,
   not a visual model input. Bob's final reply correctly discloses that neither
   Bob nor Rita actually saw the images. Publishing the frontend fixes the
   owner's viewing path, but does not add model vision by itself.

The retained function logs show orderly `background_continue` / `worker_step`
continuations and successful completion. The captured Shutdown is `EarlyDrop`
after a recorded continuation, not CPUTime. This run does not demonstrate
another CPU-limit failure; it also does not close O5's full CPU attribution.
The recorded model-event cost totals approximately USD 0.89354. Working model
packets/checkpoints were cleaned at completion; content-free execution events,
write receipts and final chat evidence remain. No attempt was made to recover
cleared private model reasoning or reconstruct unrecorded tool arguments.

Next acceptance work: publish the already merged web preview; provide a
caller-authorized, exact-revision saved-view opening path for Bob/Rita with
bounded image delivery and existing checkpoint/provider handling; verify the
owner's view and actual model visual input separately. Preserve the current
geometry and the owner's facade acceptance gate. A repeated prompt alone does
not supply either missing capability. This investigation changed no runtime,
project data or deployed version and started no paid call/workflow.

### Flexibility findings carried forward

- Separate broad authorized reading from the exact Construction write pin;
  Konrad/Mattias currently also lose cross-construction reads after binding.
- Distinguish an exact retry from a new drawing intent/view selection;
  the completed-operation cache currently keys only by source reference.
- Move declarative tool/field binding metadata toward its existing catalog
  owner where appropriate; the current adapter explicitly names roles/tools.
  Keep authorization and exact write invariants executable in code.
- The earlier Ladan facade policy is explicit project configuration installed
  by a one-off migration, not a general building rule. Its configured bounds
  must not silently become universal constraints.

None of these flexibility mechanisms has been established as the cause of this
specific visual-delivery failure. The [active State](bob-delivery-flow.md#state)
owns the next actions; no additional behavior rule or mandatory owner prompt
was introduced as a substitute for capability.


<a id="saved-visual-access-2026-11-05"></a>
## Saved drawing vision and flexible operations — 2026-11-05

Implementation follows the failed owner retry above. Publication evidence is
recorded below after hosted readback; local tests are not a production model run.

- The existing Project Context registry adds `drawing_views`. One metadata card
  contains exact revision/view/sheet refs. `open_project_item` prepares one chosen
  saved sheet for the calling model, including source status, historical/current
  revision and archival state. Bob and Rita use the same adapter and resolver.
  Metadata is not pixels and opening is not owner approval.
- `read_saved_drawing_view` and `list_saved_drawing_views` are authenticated,
  security-invoker project reads. Only the selected SVG export is returned to the
  raster boundary. No STEP, full CAD packet or service-role project read crosses
  that boundary. Historical revisions remain explicitly historical.
- A separate JWT-protected `drawing-preview` function rasterizes the immutable
  source SVG with pinned Resvg WASM and DejaVu font hashes. It crops the saved
  multi-sheet viewport without new geometry or model/CAD work. PNG <=700 kB,
  longest side <=1024 px; cache <=8 entries / 5 minutes. Fresh caller/source
  checks precede and follow raster/cache use. Fixed public dependency assets carry
  no project data; unavailability fails closed.
- Checkpoints retain private resolver references and exact source versions, never
  SVG/PNG payloads. Source/permission changes stop subsequent model use. Saved CAD
  views do not write image-asset description rows.
- Construction read selections may inspect other authorized current constructions
  without moving the write pin. SQL inventory includes those sources; writes and
  automatic checks retain the assigned source/revision fence.
- Drawing reuse keys include source, code-resolved destination and the full
  requested intent/views. Identical saved retries survive restart; a new brief or
  view can proceed on the same construction revision. Legacy execution pins keep
  their original replay behavior; unverifiable old intent is not regenerated.
- Native schema field/ref mappings are published as immutable
  `bob.tools.worker_operation_bindings` catalog data. Generic projection and source
  resolution support a reader with new tool/field names. Specialized CAD, material
  and write validation remain server code. This is not arbitrary model-defined
  routing. Worker final catalog binding also carries all registered categories.

Validation before installation: **99 affected tests pass**, including full-schema
PGlite caller/grant tests, actual WASM sheet/glyph rendering, cache revocation,
source races, checkpoint/provider carrier, transport limits and new catalog-reader
fields. Production build, PWA checks and Edge type checks pass. The exact saved
Ladan front SVG (revision 3, SHA256
`71debf413395d29f01c0b5ba57845bff217d1d413cd3caa5a82d230e12e03c76`)
was read through the authenticated project role and rasterized locally: three
1024×798 sheets, 136038 / 121066 / 106557 bytes; visually inspected sheets 1–2.
These timings and pixels prove the derivative locally, not hosted CPU attribution.

Owner facade acceptance (#438), actual model consumption in an ordinary Bob turn,
and O5 whole-run CPU attribution remain separate acceptance work. No construction
geometry was changed and no paid AI/CAD run was started by this implementation.


### Hosted installation and Pages publication — 2026-11-05

Implementation [#464](https://github.com/EmelieHagander/Bob-the-builder/pull/464)
merged as `c4cfce99731732af9afbeb69710fbeff16f66cb2`; its exact tree was
`59dd3ee2e03b3cb23f6db3d19f7fdca3e5dd6874`. Installation target was double-checked
as `yuobtgoidmmmwfqenkau`, with zero queued/running Bob jobs and the expected
prior catalog/Edge hashes. Ladan drawing 3 and Construction 5 stayed unchanged.

- Migration installed as **20261105080905_saved_drawing_visual_access**. The CLI
  generated filename is renamed to the hosted version without changing SQL bytes;
  SHA256 `a425530b4e21b416e425158bfed7180766211fbc4698c972b3d130359a67fcd4`.
- Catalog resolved/validated as **e92b7a7f-d2f7-48ed-9957-ca0810831465**:
  `bob.tools` version 47 and open/list contracts version 3, publication
  `saved-drawing-visual-access-v1`. Older immutable manifests remain untouched.
- **drawing-preview v1**, JWT true, four runtime files, bundle SHA256
  `dc89596f6aa55133ff8712423c8dc525fa47a36faaf05c302cf070b44e55c8f7`.
  The readback normalizes the common `supabase/` directory; all four actual
  runtime files match their upload exactly. Type-only dependencies are omitted
  by the Edge bundler, as expected.
- **bob-worker v199**, 143 files, existing job-capability JWT false unchanged,
  SHA256 `1a27560c80f5b99de45b06fc72cea76327b097eae3261b65b776e165afbe0044`.
- **ask-bob v231**, 145 files, JWT true,
  SHA256 `a3c3b3385e3e6f67c58390a775bbb83a57dd96444610c0d83c25de53516181f5`.
  Every returned file of both Bob closures matches the intended content byte for
  byte, with no missing or extra files.
- Hosted authenticated-role reads return the exact Ladan `front.sheet2` metadata,
  SVG source hash, revision 3/current state, one listed saved drawing and a ready
  operation scope. All three read RPCs are security invoker, authenticated-only;
  anon/service-role execute grants are false. Anonymous endpoint POST is 401;
  OPTIONS boots the new function and returns 200 with CORS. Security advisor
  output contains no notice for these functions (unrelated existing notices are
  not reclassified as fixed).
- Pages **[#392 / run 41992782178](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/41992782178)**
  succeeded on the exact merged implementation SHA in 55 seconds. Public
  [Bob](https://emeliehagander.github.io/Bob-the-builder/) now serves
  `assets/index-Bm1fsy3l.js` containing `bob-chat-drawing`; the old Nov 2 bundle
  is replaced. This publishes #458's already merged chat preview.

An additional real `runWorker` + final catalog reconstruction regression passes:
Rita lists `drawing_views`, opens the selected saved sheet, carries its private
image reference to her next provider call, resolves PNG pixels and confirms
successful delivery. **100 affected tests** are now represented by the green
runs (99 before installation plus this added regression); final operation/replay
refinements also passed 33 worker tests and 11 operation tests. No full CI or
paid AI/CAD run was started.

The published app opens correctly at its sign-in page in the inspection browser.
That browser has no Bob member session, so no private chat/owner screenshot or
ordinary model consumption is claimed. Positive hosted member-role SQL, local
real SVG rasterization and the worker/provider fixture are distinct evidence.
Next owner check: reload the app, inspect the existing saved view in the chat,
and let Bob continue with that saved view available as real visual input. #438
owner acceptance and O5 whole-run CPU attribution remain open.


### Entré follow-up: saved Solution sketch absent from chat — 2026-11-05

The owner's entré turn completed with a saved three-view **Solution concept**,
not a generated media asset or CAD Artifact. Chat rendered media/CAD receipts
but skipped `solutions`, so “look at the sketch” had no visible counterpart.
The [Solution owner records the fix and evidence](solutions.md#saved-concept-previews-in-bob-chat--2026-11-05): reuse the existing renderer for the exact
receipt revision, deduplicate intermediate saves, recheck caller/current head,
and retain historical/archival/estimate notices. No backend migration, Edge
change, new geometry or paid generation is required.


Entré fix #466 is merged and published by Pages #393 on exact merge
`9f47c5a5b56048fdb4e6ff54fc5d3f03d98df697`. The public bundle contains saved
Solution previews. The [Solution owner](solutions.md#saved-concept-previews-in-bob-chat--2026-11-05)
records the 26 green affected tests and the remaining private-chat acceptance
boundary. This repairs existing replies without new AI work or project writes.


<a id="entry-five-findings-2026-11-05"></a>
## Entré: five findings investigated and implementation plan — 2026-11-05

**Status: investigation/reproductions complete; changes below are planned, not
implemented or deployed.** Owners: project edits/solutions, project facts, shared
AI seam, Project Context. This is evidence and a staged repair plan, not another
prompt policy. The active delivery State links here.

### Pinned observation

Entré turn `9a1108ca-939f-4753-9b04-85b9d388170e`, job
`abdd5557-de69-4afc-8fb8-e01e1a26dd24`, ran 13:56:11–13:58:29 CET.
It completed, error_code null, two worker claims. Solution revisions 11–13 and
the corresponding selected-target decisions were saved. That is successful
persistence, not proof of visual review or construction suitability. The observed
shutdown was EarlyDrop after normal background continuation; this is not CPUTime
failure evidence. Investigation performed only reads and local synthetic tests.
Later owner edits are independent; immutable revision 13 is the geometry baseline.

Durable `bob.execution_events` confirms 13 main model calls, **seven returning
get_work_history**, three edit writes and a final answer. Main input ranged from
29438 to 78302 tokens. Model-event cost is USD 1.743988 (the general usage ledger
also includes the separate embedding cost). These are observed totals, not an
attribution guessed from a time window.

### F1 — The generic result pager adds seven model rounds

`displayEditSnapshot` sends the full design intent, measurement evidence, checks
and link dictionaries. Each successful selected-solution edit returns the full
fresh display again. `constructionReadiness` is already compact; it is not a
second full model copy. The generic result reference layer cuts these tool
results at 3000 serialized tokens. The model then fetches the remaining literal
JSON through get_work_history. These are pages of retained results, not seven
repeated database reads and not evidence of a runaway loop.

Local reproduction using the saved v10 model with a reduced surrounding envelope
still produces 11092 characters / 3675 serialized tokens and a first-page cursor.
The actual live read has more surrounding evidence. The immutable v13 intent is
12847 bytes with 36 nodes and 11 components. Current-head reads can differ while
the owner continues working; they must not replace this incident baseline.

**Repair:** retain the complete server-side edit snapshot and exact edit_ref,
but return purpose-built compact model summaries/section reads. Make requested
nodes, components, views, choices and source facts independently readable against
that same snapshot. After a save, return the fresh ref, changed content and
compact checks rather than resending the full model. Large originals remain
available on demand. Add same-batch choice/component linking from F2 so a write
need not be followed by full rereads just to resolve a new identity. Do not fix
this by globally enlarging prompts or weakening the reference/source fence.

**Acceptance:** a section produced by the domain reader reaches the provider
whole; the representative edit/save response does not need generic history pages.
Freshness/conflict, caller access, exact revisions and checkpoint replay remain
covered. Compare model rounds, input/cache tokens and delivered outcome in the
next ordinary owner run; no hard call-count/spending limit is introduced.

### F2 — Two different API behaviors force the extra revisions

1. v11 creates a width decision through add_choice. Its ID is correctly assigned
   by the server. The add operation cannot also link it to model components, so
   v12 is needed solely to connect that new decision to wall_front. The live
   revision comparison confirms null links in v11 and wall_front in v12/v13.
2. `applyProjectDelta` unconditionally replaces `alignment.basis` with the change
   reason unless alignment is explicitly supplied. Consequently v12's small link
   edit discards the longer existing reconciliation basis; v13 restores it.
   A local metadata-only label edit reproduces this replacement and draft reset.

**Repair:** preserve the existing reconciliation basis when invalidating status
to draft; use the existing change_note for the new edit reason. An explicit
alignment update remains possible and subject to the existing authority/gates.
Add an operation that creates a choice and links it to server-issued component
selections in the same bound transaction. The caller must not manufacture the
future persistent ID. Keep target advancement atomic with the same Solution.

**Acceptance:** the representative geometry/decision/link change can be saved
once, with no repair save. The prior basis and unrelated sources/choices remain;
changed geometry still becomes draft and never inherits stale visual approval.
Foreign, stale or ambiguous component selections fail closed; retries reuse the
committed receipt without making another revision.

### F3 — Picker failure is confirmed; its original subtype is not retained

The picker consumed 6752 input / 116 output tokens and returned success=false.
The retained model event classifies it only as model_error, role other. The
terminal journal cleanup is working and has removed the raw transient response;
the precise old cause cannot now be established responsibly.

The provider adapter computes JSON/schema/refusal/output-limit error outcomes,
but its ledger callback records only success and usage. `logAIUsage` does not
write the existing error_code/latency columns. The execution-metrics role list
also folds tool-picker/memory-stair/completion-gate into other. A further metrics
gap: none of the seven internal history calls has its own tool event, although
returned model tool names retain enough evidence to reconstruct them.

A reproducible **possible failure class**, not the established live cause:
the picker schema requires an unused reason of <=200 characters. Claude's wire
schema cannot enforce maxLength, and the adapter rejects an overlong reason even
when tool selections are valid. The consumer never uses this reason. The same
wire/post-validation distinction applies to the four-tool bound; synthetic picker
tests currently bypass that real provider-validation boundary for oversized picks.

**Repair first:** record bounded error codes and schema issue paths/counts,
actual helper identity and timing in existing execution metrics; count internal
history tool calls as well. Preserve privacy: no prompts, output excerpts,
arguments, source values or secrets. Link each synchronous usage row to its
execution event (for example a returned usage-event identifier). Do not put the
same Bob job ID into background_job_id: that existing column has a unique index
for single durable provider jobs, not multiple calls in one Bob turn.

Then repair the proven schema/adapter subtype from the next ordinary observation.
The unused reason is a candidate for removal through immutable catalog
publication. Keep candidate filtering, existing tool permissions and safe fallback;
do not retry paid picker calls blindly or loosen general output validation.

**Acceptance:** fixture refusal, malformed JSON, schema-bound violation, output
limit and transport failure have distinct safe diagnostics and correct helper
attribution. A valid tool list survives the actual provider/caller seam. Ledger
links and deterministic tool events remain correct through replay without double
billing/counting. A failed optional picker still lets Bob continue safely.

### F4 — The door value exists, but its definition is ambiguous

The stored measurement is labelled karmytterhöjd and measured, value 209 cm.
Its source explicitly says underside of threshold to top of trim. Bob's reply
retains that source description but also treats the value as the frame's height
in the model. This is a conflict in meaning within the source record, not a
missing value or an arithmetic-fetch failure. The 98 cm width and 118×170 cm
window records exist as measured project facts.

Measurement identity already has optional property/side/reference metadata;
reuse that owner before adding a competing measurement system. The concept model
explicitly excludes ParameterInput source nodes, whereas the Construction
parameter engine can bind an exact measurement revision. Concept values therefore
carry a decision/estimate plus prose, not the same typed source binding.

**Repair:** deliver exact source revision, property/reference, complete source
explanation and uncertainty together when a model dimension uses a measurement.
Plan a versioned concept-source binding compatible with the existing measurement
and parameter owners; update JS/SQL validation, rendering, readiness and export
consumers together. Source meaning must not be inferred by a door-specific text
rule. An unclassified/ambiguous datum remains unresolved for a verified opening
or derived sill dimension. Owner clarification can establish what was actually
measured once; existing classification/history rules still apply.

**Acceptance:** an outer-trim height does not silently become a verified frame
height; changes to the exact source revision invalidate dependent readiness.
Legacy concepts remain readable with honest design/estimate status. **Do not
change 209, subtract a guessed trim size or backfill a measurement definition
automatically.** This case needs a source-definition decision, not invented data.

### F5 — Solution vision is a distinct missing source adapter

The owner can now see Solution concepts in chat (#466), using `SolutionConcept`
and `conceptSvg`. Model vision is separately registered in Project Context:
media images and saved CAD drawing_views only. There is no Solution-concept
adapter. No open_project_item/image_pixels consumption was recorded for this
incident. Correctly saving model JSON is not a completed visual review.

**Repair:** register exact Solution/view references in the existing Project
Context registry for Bob and Rita. Derive pixels with the same concept renderer
and existing bounded raster engine, with caller, project, exact revision,
current-head/source state and renderer version checks. Keep original SVG/PNG
bytes out of checkpoints. Feed the pixels through the existing image carrier to
a normal following model call; no new image-generation/CAD job is needed.
Actual visual delivery is recorded only after provider consumption succeeds.

Carry the visual source kind/ref/version through evidence and chat display.
The current generic image_pixels source recordId alone is insufficient: a CAD
Artifact or Solution UUID must not be passed to BobChatImages as a media-asset
UUID. Route by a validated visual source descriptor, not by title/text guessing.

**Acceptance:** Bob and Rita can open the same immutable Solution/view that the
owner sees; denied/foreign/stale/source-changed cases are explicit and fail
closed as appropriate. A consumed concept/CAD view remains reachable after
reply/reload through its correct viewer. Viewing never records owner approval
or implies construction safety. UI and provider/checkpoint tests must both pass.

### Proposed delivery order and review gates

1. **Diagnostic visibility (F3):** preserve a safe failure subtype before it is
   lost and repair helper/internal-tool attribution. This lets the next normal
   owner turn establish the picker cause without a paid diagnostic rerun.
2. **One coherent edit (F2):** preserve the basis while invalidating alignment;
   create/link choices atomically. This removes two confirmed forced saves.
3. **Thin semantic reads/results (F1):** use the same exact server snapshot with
   section reads and compact changed-state responses; remove the seven paging
   detours in a representative fixture.
4. **Source meaning (F4):** implement explicit versioned source binding and
   uncertainty propagation; leave the ambiguous existing measurement unchanged.
5. **Shared concept vision (F5):** extend the existing registry/raster/carrier and
   visual evidence/display routing for the same saved Solution views.

Each delivery has focused regression/type checks and an explicit source/catalog/
RPC/Edge readback before its status becomes installed. Larger source-binding
changes need a coordinated migration and immutable catalog activation. Existing
in-flight jobs keep their pinned contract. The final ordinary owner probe checks
saved geometry, readable visuals, source truth, tool behavior and cost together;
no paid AI/CAD rerun or full CI is started by this investigation.

Baseline tests executed: **18 pass** across picker, Anthropic and saved-drawing
vision. Those verify current behavior, not the planned fixes. Source authority
for this investigation is main `b7d8fd53b21577dc6befa3ca3536bb60eb2fd111` and
the immutable live turn/revisions above. Broader CPU attribution O5 remains open.

### Five-finding implementation — 2026-11-05

Implemented in #469 and installed with the release readback below.

| Finding | Implemented behavior | Verification |
|---|---|---|
| F1 | New turns receive a compact overview and compact save results. Explicit semantic section pages stay bound to the original edit snapshot and survive checkpoints without rereading the database. The complete original remains available on explicit request. | Overview under 700 serialized tokens; section results under the existing 3,000-token generic page boundary; exact reassembly, checkpoint restore and forged cursor rejection. |
| F2 | Alignment reset preserves its previous basis. `add_choice_for_components` creates a server-owned choice identity and links it to exact active component refs in one delta/save. | Deterministic retry, same-project stale refs, foreign refs, original snapshot preservation and atomic link checks. |
| F3 | Claude structured failures retain safe failure codes and declared schema paths; the usage ledger receives error code/latency and its returned row ID is linked to execution metrics. Helper function names and internal history reads are durable metadata. The unused picker reason is removed by an immutable publication. | Malformed JSON/schema failure fixtures, no raw output or unexpected field names in diagnostics, deterministic internal-tool event keys, continuation callback and published schema tests. No diagnostic model call. |
| F4 | Model v2 adds exact linked measurement revisions, original values/units and intended versus recorded endpoints. Code supplies the source pins and normalized estimate; unresolved endpoints remain visible and block construction reconciliation. Sources may be detached explicitly while retaining an estimate. | JS/SQL shape and value consistency; forged, foreign and unlinked source rejection; deferred source-link constraint; 209 cm stays 209 cm. Existing v1 models remain readable. |
| F5 | Bob and Rita can list/open exact saved Solution views through the existing image carrier. A caller-authenticated `concept-preview` rasterizes the same `conceptSvg` as the UI, with pinned source hash, revision, view and source-state checks. Typed visual evidence routes CAD/concepts to their own previews, including the exact viewed CAD sheet. | Actual bounded WASM raster, same-SVG comparison, denied/mismatched caller/project/revision/hash/view checks, compact checkpoints without pixels, evidence only after confirmed delivery, and model/browser source routing checks. |

The new behavior is selected by immutable catalog `solution_work_version=1`
and retained in the execution identity. Older execution identities retain their
editor schema/results and adapter set. No global token/work budget was added,
no project data was deleted and no existing measurement definition was guessed.
The door's physical measurement endpoints still need owner confirmation; a
source binding cannot establish their meaning by itself.

Focused validation includes the isolated full-schema project/edit/operation
suites, new source/view SQL tests, real raster fixtures, picker/provider,
continuation and execution-metric regressions, and chat data/SSR tests.
Deno checks both Bob endpoints and both preview endpoints using the installed
equivalent dependency map. Frontend TypeScript/Vite and local PWA checks pass.
Test batches overlap; do not add their counts. Full CI, paid model/CAD probes
and the signed-in private browser acceptance were not run. O5 whole-turn CPU/
cost and ordinary owner visual acceptance remain separate.

Rollout order: core SQL, the two preview endpoints and matching complete Bob
bundles, then immutable catalog activation, then matching Pages. Preserve
`bob-worker` private capability mode and JWT verification on the other endpoints.
Check actual project URL, active jobs, migration names and installed source before
applying; compare complete deployed closures and caller-scoped reads afterwards.
The CLI's earlier telemetry connection was blocked by automatic approval review;
the two new source filenames use their recorded actual UTC authoring times and
must be mapped to the hosted migration ledger without changing the SQL.

### Five-finding hosted installation — 2026-11-05, 14:13 UTC

- Merged implementation: [#469](https://github.com/EmelieHagander/Bob-the-builder/pull/469),
  source `6ee8850a6e166ea9067066e2daab4956a27375f3`, reviewed tree
  `b5af362c933eaaecc24e3642d0a0343db7f1e47f` (local/remote tree equality).
- Project URL/ref was rechecked as `yuobtgoidmmmwfqenkau`; zero queued/running
  jobs before installation and after activation. Existing runtime versions and
  complete source were checked before replacement. No project-content writes.
- Core source `20261105135621_coherent_solution_work.sql` maps to hosted ledger
  `20261105141212`, name `coherent_solution_work`.
- Catalog source `20261105135742_coherent_solution_catalog.sql` maps to ledger
  `20261105141332`, name `coherent_solution_catalog`. It was activated only after
  all four deployed bundles passed complete source comparison. Source filenames
  retain authoring times; do not replay either migration under its source time.
- New immutable manifest: `35bcd84f-6253-42b3-9b20-84c747bf6161`.
  `bob.tools` v48 carries `solution_work_version=1`; picker schema v2 requires
  only `tools`; editor contract v10, edit-read v4 and open/list v4 are active.

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 200 | 145 | Existing private job capability, JWT false | `40da3be312d0347bb5162904fd35be594c8aed479417e300e6a272cf688aa3fc` |
| ask-bob | 232 | 147 | JWT true | `e9e30b68dc6db52f8e0cb25130e1d7a6f9bedfce3b5e73490b01bfe1be7c576f` |
| drawing-preview | 2 | 5 | JWT true | `d88df37ce339f58dd26259ecda8719f8643632a57d1a8115e6b320b3dfd2f25a` |
| concept-preview | 1 | 11 | JWT true | `e006ba9ab80175bcff65cc9fd416c80059c3f5ceeecbde167f64588df1ae5619` |

All returned runtime files matched the prepared merged-source closures byte for
byte. The same pinned raster engine is shared by the two preview endpoints.
Unauthenticated POST is 401 and OPTIONS is 200 for both. Read RPC execution is
allowed for `authenticated`, denied for `anon`/`service_role`, with caller RLS
and explicit project access inside the read. Security advisors have the same
seven lint groups and identical entities/counts as the pre-release baseline
(observation timestamps excluded).

A read-only authenticated-role check using the existing project owner verified:
`p_bygga_in_entren` lists its saved concept, exact Solution revision 13 returns
view `plan`, source SHA-256
`d74ec37438352877f1be4b4ebfe09ab3985deac3947bdf5b7515676961b00dfd`, and
current head 16 is retained separately. The original 209 cm measurement is
unchanged. This is caller-RLS evidence, not a signed-in browser/model acceptance.

Matching frontend: manual Pages **#394**, [run 42043160044](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/42043160044),
completed successfully against the exact implementation merge. The public
`assets/index-C6yQdkCL.js` bundle was fetched and contains the saved-view RPC,
source bindings/reference handling and concept preview routing. A cropped
success/commit screenshot was retained for the handoff. No full CI or paid
model/CAD execution was started.

Focused test results include: 21 editor/operation/schema tests; 12 provider/new
vision/diagnostic tests; 23 continuation tests; two new caller/source SQL tests;
9 compact-editor/chat tests; 5 drawing-preview data tests. The metric/tool
regression batch passed its 16 non-view tests; its two failed view tests were
fixed and rerun in the passing two-test SQL batch. Counts overlap. Final four
Edge entrypoint type checks, frontend build, PWA and diff checks passed.

F1–F5 are technically installed. The exact old picker failure remains unknown,
the physical door measurement meaning still needs confirmation, and ordinary
owner/provider visual acceptance plus O5 whole-run CPU/cost remain open.

<a id="three-project-followup-2026-11-05"></a>
## Three-project follow-up — 2026-11-05

Owner requested fixes and publication after testing all projects. The latest
bunk-bed turn `425866c0-1452-4c5c-89d5-1497dd04eb59` (16:31–16:35 UTC)
saved Construction revision 14, then recovered one receipt instead of producing
Bob's normal answer. Durable delivery code is `context_unavailable`; all 13 model
calls succeeded, with observed model cost USD 1.337298. Shutdown entries in the
scoped window say `EarlyDrop`, not `CPUTime`. The retained screen is the Project
page, with no selected drawing focus. Terminal image/journal records were cleared
as intended, so the exact opened image refs cannot be reconstructed from that
turn's tool-name metrics alone.

The two latest entry turns are `c2621b81-a51c-47bb-81c9-2a28a3f4f90a`
and `41ec7105-a6a8-41d9-8fec-f7bf2aee0f55`. They saved measurement notes and
Solution revision 20, then described future framing work. Two direct history
calls in the former were refused as `not_offered` before a separate describe call.
The barn turn `f4bcfa23-e5f4-4115-91ff-dcd557791227` reached a design-review stop;
it is useful comparative evidence, not complete owner/model acceptance.

| Finding | Cause / source evidence | Implemented correction |
|---|---|---|
| N1: a successful save can invalidate retained visual context | Saved-view version combined immutable pixels with mutable head, archive and source-status metadata. An own Construction write can stale its drawing source without changing any saved pixels; the reproduced next-step validator then stops the whole answer. Live failure matches this mechanism, but the exact opened refs are no longer retained. | New pinned visual adapters keep pixel identity exact, refresh mutable metadata under caller access and deliver a text-only historical/stale notice on the next ordinary model call. Changed bytes and access loss still stop. Notices survive checkpoints; no pixels are stored there. Focus and visual failures now have distinct content-free log markers. |
| N2: picker and completion gate lose the conversation in stair mode | `prepareMemoryStair` intentionally returns an empty `summary` and only the current instruction in `recent`. Helpers read those legacy fields instead of `stair.summaries/raw`, so delegated work and prior measurement deferrals disappear from their inputs. This is a confirmed blind spot, not proof of every conversational misjudgment. | Both helpers receive the real bounded stair summaries and recent raw conversation, using existing memory without another model call. Completion also sees the current capability shelf. Legacy pins retain their original inputs. |
| N3: a visible capability still requires failed selection rounds | Shelf cards advertise available tools, while execution requires the tool to have been separately loaded. The entry history lookup paid for two refused calls. | An explicit call may select an already available capability from that step's shelf after live policy/version/gate and argument validation. Newly available, disabled, waiting, unknown or changed-contract capabilities cannot acquire authority retroactively. |
| N4: older constructions cannot report their exact small change without FORM mapping | Bed has no configured construction-piece policy. The old evidence helper returns `no_form_scope` even after an exact readback and successful whole-Construction check. | New pins can report exact predecessor/current legacy Construction evidence, then stop for design review. They never invent FORM coverage, local functional verification or owner approval; configured FORM and source guards remain unchanged. |
| N5: stale open questions cannot be repaired with a bounded edit | The bed worker's retained note identifies old narrative information but the text interface accepts only title/description. Geometry-only edits preserve the stale question. | Optional complete `text.open_questions` joins the same atomic parameter/part edit. Null preserves it; an empty list clears it. A narrative-only edit is allowed only when its text actually changes. Exact source, compilation, revision and replay checks remain in the ordinary writer. |

Changes are pinned by `bob.tools.continued_work_version=1` in the execution
identity, with a new immutable publication after matching core SQL and both Bob
bundles. No existing project measurement, geometry, question, workpad or private
conversation is manually rewritten by this release. Existing revision 14 and
its receipt remain the starting point for the owner's next normal instruction.
The remaining source-reading volume is observable but not proved to be needless;
no claim of a whole-run CPU/cost improvement is made without a new ordinary run.

Focused fixtures cover: helper history and completion continuation; direct
capability selection and authority fences; metadata-only visual renewal, restart,
revocation and hash changes; legacy exact change review without FORM promotion;
and same-revision geometry preservation plus idempotent narrative repair through
SQL. Provider/WASM/worker regressions, Edge types and frontend/PWA checks are local.
No full CI or paid AI/CAD probe is part of this repair. Hosted installation and
matching public release are verified in the readback below.

### Continued-work hosted installation — 2026-11-05, 17:05–17:12 UTC

- Implementation merged in [#471](https://github.com/EmelieHagander/Bob-the-builder/pull/471),
  source `5c021008ac2fa344c8e7813981e477f2582a1dcd`, reviewed tree
  `4105a6f34bd340aa18437ec0cfcc3f5e6af1bb06` (local/remote tree equality).
- Actual project URL/ref was rechecked as `yuobtgoidmmmwfqenkau`; no queued/running
  jobs before core installation or after catalog activation. Fresh source/JWT
  readback preceded each endpoint replacement. No existing project-content writes.
- Core source `20261105165327_continued_construction_notes.sql` maps to hosted
  ledger **20261105170514**, name `continued_construction_notes`, SHA-256
  `f5e8df2c02b5860a7ab3ab6fb2cfd3d33f25cc591bf6bd8f588c552864a780bf`.
- Catalog source `20261105165925_continued_work_catalog.sql` maps to ledger
  **20261105170606**, name `continued_work_catalog`, SHA-256
  `4d7070f1e3416704dda9539a2fa6e79addaffc21afc070d0d713d0d963b27bed`.
  Both complete hosted SQL strings match their source MD5 values. Keep these
  authoring-time filenames and ledger mappings; do not replay under source times.
- Catalog activation followed byte-for-byte readback of both complete Bob bundles.
  Resolved immutable manifest: `209068b0-7b40-4b43-8fde-219366267319`.
  `bob.tools` **v49** pins `continued_work_version=1`; parameter-edit **v11**
  and part-edit **v9** expose the same bounded optional question schema.

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 201 | 146 | Existing private job capability, JWT false | `56cc75de6a7a9d3e1e4f1931ba1bbd064fd655e05cf7538f86670d836255589c` |
| ask-bob | 233 | 148 | JWT true | `178d6194e06e7d7a3deba25c386a0c768eb13471f00d850efd32a54196066608` |

Every returned file matches the prepared merged-source closure byte for byte.
Drawing-preview v2 and concept-preview v1 remain unchanged: their raster/wire
protocol is compatible; the new saved-pixel identity is consumed by Bob's adapters.
Hosted text validation accepts a valid question list and rejects a non-string
question. A read-only authenticated-role check under the existing bed owner sees
Construction **14** and piece progress **not_configured**, preserving the honest
legacy status. Security advisors have identical seven lint groups and entities/
counts to the pre-release baseline (observation timestamps excluded).

Matching frontend: manual Pages **#395**, [run 42071944787](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/42071944787),
completed successfully against implementation merge `5c02100` (build and deploy
both green). The public page loads `assets/index-C6yQdkCL.js`; no frontend source
change was needed for these runtime repairs. A cropped success/commit screenshot
was retained for the handoff.

Final focused validation: 58 pure/worker/vision tests; 21 SQL/provider/WASM tests;
8 SQL/completion tests; 8 final visual tests. Batches overlap and are not an
independent total. Both Bob Edge entrypoint type checks, frontend build, PWA and
diff checks passed. No full CI, paid model/CAD probe or private browser acceptance
was run. N1–N5 are technically installed; ordinary owner/provider acceptance and
O5 whole-run CPU/cost remain open. Physical meaning of the entry's 209 cm remains
unchanged and unconfirmed.

<a id="context-envelope-2026-11-05"></a>
## Context-envelope investigation — owner runs 2026-11-05, 18:37–18:48 UTC

**Investigation only; corrections below are not implemented.** The owner asked
why input grows and what Bob actually needs. Readback confirms bob-worker v201,
bundle `56cc75de6a7a9d3e1e4f1931ba1bbd064fd655e05cf7538f86670d836255589c`;
the inspected continuation/request/result/answer files match installed source.
All four jobs pin manifest `209068b0-7b40-4b43-8fde-219366267319`.

| Owner run | Observed evidence |
|---|---|
| Barnrum – våningssäng, `0e5d63b9-2c7b-4c69-b534-cbf32f1a411c` | Main model inputs 27,737 → 29,453 → 44,225 → 57,484 tokens; successful construction read followed by `context_input_too_large`, stage `model`, 18:39:37 UTC. No final answer. |
| Entry, `4ca1919e-83d0-460f-be53-8f0db0c45e93` | Main inputs 44,056 → 45,265 → 64,349 → 67,668; successful image open followed by the same code/stage at 18:40:23 UTC. No saved work or final answer in this attempt. |
| Barn, `15bb592f-32d3-4cb7-b58d-8573310e75b9` | Saved image candidates; final image open followed by the same context failure. Job is technically completed at 18:43:36 UTC because receipt recovery succeeded; normal delivery did not succeed. Earlier events on this reused turn precede this job and must not be counted as its new calls. |
| Våningssäng2, `271d0f34-a8a0-4d4c-a8bc-216b2ff86c09` | Main input reached 86,833 before delegation; Konrad's own inputs grew 75,975 → 125,075. The later bounded edit conflicted; main answer finished at 18:48:29 UTC after verification stops. Large input is observed, but this run's edit conflict is a separate cause. |

Execution events and scoped function logs agree on the failed stage/code.
These failures are application input-envelope refusals, not demonstrated
provider maximum-context errors or CPU shutdowns. The active agent contract v24
sets a 64,000-token continuation target and a 96,000-token main input ceiling.
Specialists use a separate larger envelope. Provider-reported usage and the
application's conservative GPT-tokenizer/image estimate are different measures.
Successful main inputs can therefore exceed 96,000 provider-reported tokens.

### Measured live main context

A read-only copy of the running bed checkpoint **59**, 18:44:01 UTC, was analysed
locally before terminal cleanup. The last completed main request reconstructs to
**84,501 estimated input tokens** with its saved tools; the real model reported
**86,833**. No project content or private reasoning is reproduced in this report.

| Part | Local measurement / meaning |
|---|---|
| Role/persona plus context principles | 696 text tokens |
| Toolbox directory/workflows/colleague cards | 3,460 text tokens; system total 4,156 |
| Full native tool definitions | 10,202 text tokens across 18 tools; general editor 4,020, calculator 1,825 |
| Fixed initial messages | 9,558 estimated conversation tokens, including history and fresh turn context |
| Four retained images | 32,768 reserved visual tokens, plus small reference envelopes; this is an estimate, not image billing |
| Remaining transcript | Tool results, calls and intervening messages; its older text-result allowance is separate from the image/total request size |

The current-turn frame includes 16 historical receipts (1,624 tokens), fresh
orientation (1,822), project facts (968), and current-view/source metadata.
These measurements overlap the fixed initial messages; do not add them again.
Removing image parts from the reconstructed diagnostic request lowers the
estimate from 84,501 to 51,666. Removing editor/calculator schemas alone lowers
it to 78,071. Neither experiment is a proposed production deletion of evidence
or authority; they isolate where capacity is used.

### Confirmed mechanisms and open corrections

| Finding | Source / consequence | Required correction |
|---|---|---|
| C1: result references are not whole-request renewal | In `bob-context-continuation.ts`, `references` skips the legacy 64k rollover branch. Its text-result projection is followed by the final 96k estimate/throw. There is no request-wide headroom adjustment or equivalent renewal at the target in this path. | Bound the assembled request around the active assignment, exact work state and currently needed evidence. Renew before exhaustion; retain immutable originals for targeted reopening. Preserve native call/output pairs and original constraints. |
| C2: images remain literal for the whole main chain | `buildBobRequest` reconstructs all seed/history image parts. The dispatcher clears only its pending carrier after delivery; that does not remove an image from continuation history. Reopening can append the same pixels again. The eight-image count is bypassed for unlimited work, and its byte limit does not account for total model headroom. | Give visual evidence an explicit active lifetime and deduplicate exact image identities in assembled input. Keep the exact comparison images while needed; after a completed stage retain source/version-bound findings and reopening references. Never silently substitute prose for an unperformed visual check. |
| C3: tool discovery does not make all tool costs lazy | The bed picker selected four optional tools; main preload adds core tools, all colleague handovers, check readers and workpad. Its full set starts at 16 and grows to 18. General editor/calculation schema costs apply before their eventual use, while availability messages also remain in transcript. | Keep concise discoverability and select the tools/typed operation needed for the current stage. Broader schemas should load when needed and have a renewal lifetime; avoid replacing this with project-specific lists or rigid work quotas. |
| C4: bounded individual sources do not bound their combination | The 20k older-result window excludes seed and user image carriers. Batched compaction leaves the latest 2–5 exchanges whole. Fresh facts, receipts, orientation, shelf states and older calls can coexist even when each individual packet passes its own check. | Allocate from the actual whole-request headroom, deduplicate source/version claims and replace superseded progress with a compact exact work state. Do not remove the user's selected design, deferred measurements, constraints or provenance. |

Controlled offline replay uses this checkpoint and actual continuation code,
with catalog/tool/model boundaries stubbed and one synthetic completed worker
result (not an exact replay of a failed production request). Baseline: estimate
85,227, four images retained, one stub dispatch succeeds. Reopening two of those
same image refs: `context_input_too_large`, zero stub dispatches. **Zero real
provider calls** in either case. Failed jobs' terminal checkpoints/journals were
cleared by design, so the exact last inputs of entry/Barnrum/barn cannot now be
reconstructed; the general mechanism and its failure boundary are reproduced.

### Information needed for these assignments

- **Bed visual comparison:** owner's current request and chosen mockup; exact
  current Construction identity/revision, relevant dimensions/requirements and
  parts; the mockup plus matching current-model views; concise findings,
  unresolved checks and source-bound worker handoff. The captured CAD v4 views
  are explicitly stale relative to Construction v14. They can illustrate the
  old drawing, but cannot prove the current model matches the mockup.
- **Entry window balance:** selected current Solution and front view, exact
  facade/window/door geometry and measurement uncertainty, plus the requested
  design adjustment. Broader building/material/fastener detail can be read when
  required by the subsequent construction stage.
- **Barn mockups:** pinned drawing/proportions and requested views; generation
  inputs and the current candidates under review. Every older candidate need
  not remain a pixel input to all subsequent coordination calls.
- **Konrad:** affected current parts/parameters, shared constraints and exact
  findings/reference evidence needed for the change; additional joints/materials
  through focused reads. The observed main reads cover different views/part
  groups, so they must not all be labelled redundant rereads.

First repair C1/C2, then trim stage-specific tool/seed duplication. Instrument
the fully bound request's components and renewal outcome without logging private
text/pixels. Verify both provider protocols, checkpoints, exact reopening,
access/source changes, and final delivery after many image/read exchanges. A
larger ceiling alone postpones the same accumulation. These findings remain open.

<a id="context-release-regression-review-2026-11-05"></a>
## Regression review of context release — 2026-11-05

**Manual source review against owner incidents; no runtime change.** Current
hosted worker remains v201 with the SHA recorded above. Latest job/message/event
readback at 19:21 UTC confirms the same four owner runs. Copying Launchpad's
"strip images after first grounding iteration" rule directly is not approved by
this review: Bob's comparisons may require further dimension/part reads while
the same visual question is still open.

| Regression risk | Recent bug / current seam | Required acceptance before release |
|---|---|---|
| R1: lose delegation or turn a deferred measurement into a blocker | Entry's picker/completion helpers previously lost stair history (N2). A shorter seed/brief can reproduce this even with smaller requests. | Renewal during the entry task preserves the delegated framing/roof outcome, preliminary front-window height and remeasure-at-build-start instruction. Helpers see the same current assignment and unresolved facts; no extra owner approval for ordinary work. |
| R2: claim a comparison after its pixels disappear | Current continuation delivers real pixels after an open/restart; reference IDs are not viewed evidence. N1's stable pixel identity also carries metadata-only stale/head notices. | A multi-round comparison retains or explicitly reopens its exact required views until a source-bound finding exists. Later retirement releases pixels, not truth status: old CAD cannot prove current Construction, unconfirmed review cannot become approval, and revoked access/changed bytes never reuse evidence. Metadata notices survive until consumed. |
| R3: regenerate images or repeat already committed work | Ladan recovered saved images; worker-operation bindings distinguish identical retries from new views/briefs. Model context and execution state have different lifetimes. | Remove old payloads from the model while preserving server-side receipts, exact intent keys, operation pins and journal/replay cursors. A crash after renewal neither generates nor saves twice. A genuinely changed drawing intent remains possible. |
| R4: recreate unavailable tools or broken native call/output chains | N3 fixed direct use of an already visible tool. Prior retention fixes preserve parallel outputs and prevent commentary consuming exchange slots. | Renew schema, instructions and offered fence together; every kept output has its matching call. Test OpenAI and Claude plus late parallel outputs, descriptions loaded mid-turn, pending images and checkpoint resume. Existing pinned jobs keep their old request protocol. |
| R5: repeat a blocked edit, or mistake context repair for edit repair | Bed's `edit_construction_parts` returned `construction_edit_preparation_failed` at 18:46:59 UTC. `failedWorkers.structure_piece` persisted the stop, so later handovers returned verification stops. The underlying RPC reason is collapsed; it is not proved to be a missing measurement or a geometry conflict. | A context renewal must preserve the failed-attempt/source state and cannot clear the stop just to retry. Separately classify and reconcile the actual edit conflict. A new user "kör" is not evidence that its cause has disappeared. |
| R6: save tokens but cause endless rereads or lose reopen promises | Result archives currently belong to continuation chains; a brand-new empty chain cannot automatically open old `get_work_history` refs. Past overly small result pages/windows caused extra reading rounds. | Before advertising a reference after renewal, preserve its authorized exact-read path or replace it with the saved canonical source. Carry current-stage coverage, findings and next cursor so partial source reads can continue. Old source payloads and completed-stage notes must actually leave the next prompt; no ever-growing backup summary. |

The revised design boundary is **active evidence until its question is settled,
then an explicit stage handoff and fresh model context**. Canonical project
facts/decisions and the server execution ledger remain outside the prompt;
only current-stage constraints, source-bound findings, unfinished work and
necessary tools/evidence enter the rebuilt model request. This is not a new
spending or call-count quota. The initial owner request, physical uncertainty,
authority and already-committed work must survive the handoff.

Focused baseline revalidation: **76/76** existing helper, tool-session,
worker-operation/piece, continuation/request and saved-vision tests pass. Three
additional PostgreSQL-fixture checkpoint tests pass: exact construction read
observations after yield/claim, 40 resumed main steps with one uncommitted-operation
retry, and prepared tool cards through JSONB. This validates current invariants,
**not the unimplemented retirement/renewal design**.
Missing regression cases are the R1–R6 end-to-end combinations above: a smaller
prompt and passing historical tests alone cannot close C1–C4. No real AI/CAD,
workflow, hosted mutation or deploy was started for this review.

<a id="image-dedup-increment-2026-11-05"></a>
## First context increment — exact image input deduplication, 2026-11-05

Owner approved small implementation/test increments, starting with impact, after
preserving today's state. Remote safety branch
[`save/bob-before-context-release-2026-11-05`](https://github.com/EmelieHagander/Bob-the-builder/tree/save/bob-before-context-release-2026-11-05)
was created and read back at `462a6d046559324f00f9e952f16bfde152da9d56`
**before code edits**. Local `save/local-context-review-2026-11-05` also retains
the reviewed audit state (`dc47582`). No database/catalog/project content changes
are needed for this increment.

New durable complete-request identities adopt `imageInputDedupVersion: 1` inside
the existing memoized execution factory. Previous jobs never rerun that factory,
so their model inputs stay unchanged. The continuation checkpoint records the
pin and rejects mismatched restoration. The actual full provider request keeps
the first occurrence of an exact private resolver identity/detail pair and
removes subsequent copies before capacity estimation. Metadata/text/native tool
pairs are preserved. Different hashes, revisions, views and detail levels remain;
mutable public URLs are deliberately not deduplicated. Saved project images,
operation receipts, source bindings and archives are untouched.

**Validation:** 4 new tests pass, including 40 repeated opens across JSON
restarts, both actual provider request shapers, native invalid-input refusal,
historical pin compatibility and a duplicate-only capacity failure that now
fits while distinct necessary views still fail honestly. 82 related existing
regressions pass. Three targeted activation/SQL-checkpoint cases pass. Both Bob
Edge entrypoint type checks pass with the same installed dependency map used
for prior releases. No paid model/CAD test or full CI was run.

One older catalog-publication parity test fails at
`tests/bob-release-capacity.test.ts:57` (`bob.tools` definition parity). The exact
same assertion fails in an isolated, unmodified `dc47582` worktree, so it is a
pre-existing fixture/publication issue, not caused by this increment. The scoped
activation-pin test passes; no catalog publication is changed here.

This increment prevents duplicate visual inputs; it does **not** yet release
unique obsolete images or solve C1–C4, entry/Barnrum's exact past failure inputs,
or the bed edit-preparation conflict. Controlled request fixtures are not
ordinary owner/model acceptance. Runtime installation is verified below.
Rollback to the safety branch requires settling active new-version jobs first;
an old runtime must not restore a newer continuation identity.

### Image-dedup increment hosted readback — 2026-11-05, 19:59–20:00 UTC

Implementation [#474](https://github.com/EmelieHagander/Bob-the-builder/pull/474)
merged as `20c041491cc6e11779e9e8a81dc177a3e1bfca25`, reviewed local/remote/merged
tree `c9b0d34f1cbca43c4428abe2969513568ef390ff`. Correct project URL/ref
`yuobtgoidmmmwfqenkau` and zero queued/running jobs checked before rollout;
fresh previous version/hash/JWT checked before each endpoint replacement.

| Consumer | Version | Full files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 202 | 146 | Existing private job capability, JWT false | `7b7412d93a9046acde699362dc86a17e5ba95bbae31c67cded4c88d295c78da6` |
| ask-bob | 234 | 148 | JWT true | `b9e7041710e1b8a75bf4ebf5c72bf6fe1f9c798028cca9b1781e63e6fef0f19a` |

Every returned runtime file matches the prepared closure byte for byte; only
three reviewed shared runtime files were replaced in each complete bundle.
Post-rollout readback: zero active jobs, bob.tools v49 and agent contract v24
unchanged. No SQL/catalog/project-content mutation, preview redeploy, Pages
workflow, full CI or paid model/CAD probe was needed or started. Existing web
clients use these same endpoint URLs. New ordinary owner/model acceptance remains
open before the next larger context-lifecycle increment.

### First owner run after dedup — entry, 2026-11-05, 20:25–20:27 UTC

Turn `044a28df-d3a8-4a52-9cb1-485810f810f7`, job
`4e7ca1df-64e1-4bb9-a988-e4b81d2fe2d8`, requested a proportion review and
balanced window proposal while confirming the preliminary height. New durable
checkpoint job started after the v202/v234 release, with the same catalog
manifest. It completed in about **123 seconds**, through three worker claims.
Nine model calls and nine tool executions are recorded; model cost totals
**USD 1.3087552**. All model events succeeded. Scoped logs have no context-error
or CPUTime entry. Final delivery is **partial**, not receipt-recovery; a normal
answer was delivered.

Readback verifies Solution **21** and selected target **21**. Both front-window
position expressions changed, with explicit proposal labels and an open owner
choice; no owner decision is invented. Front width **370 mm** and preliminary
height **1170 mm** remain unchanged. No construction/CAD execution occurred.
Visual evidence records the old Solution **20 front view**; delivery evidence
does not establish that Bob inspected the new revision 21 image. Terminal
checkpoint/journal cleanup prevents reconstructing the exact two open requests
or the component that set the aggregate partial flag.

Main provider inputs were **47,216 → 49,683 → 63,977 → 70,788 → 74,005 →
77,404 → 86,826** tokens. This is successful continuation but still growing
input. The deployment/new-job path supports the new pin, but no persisted
before/after image-count diagnostic exists, so the run cannot quantify actual
dedup savings or prove a causal improvement over the earlier different request.
Add content-free image counts before judging that effect.

Inherited data inconsistency remains: both Solution 20 and 21 descriptions still
say front windows are 170 cm high and tight beside the door, while their model
already uses preliminary 117 cm and revision 21 moves the windows. This predates
deduplication; source narrative/model alignment needs a separate repair. No
project data, model rerun or runtime change was made during this read-only check.

### Image-count diagnostic increment — source verified 2026-11-05

Owner approved the next small measurement step after the first ordinary run.
Complete-request assembly reports six numeric values: message image parts
`before`/`after` deduplication, `removed`, eligible `unique_private` identities,
`other` image parts, and `dedup_version` (0/1). Identity is the same exact private
resolver reference/detail pair used by deduplication; uniqueness is not an
inference that different references contain different pixels. Public/inline
images and parts outside ordinary user messages are counted as `other`.

Counts travel as a separate dispatcher argument. They do not enter provider
options, model/job fingerprints, native protocol or saved continuation state.
The existing journalled factory logs `[Bob image input attempt]` after its
dispatch/time gates. Completed journal replay skips the log. Pending async
recovery/retries may enter again; these are attempts, not paid-call totals.
Requests refused by the input ceiling never reach that log. No URLs, hashes,
record IDs, titles, text, pixels or credentials are logged by this diagnostic.
This adds observation only; it does not retire images or change model inputs.

Validation: all **6 image tests** pass, including numeric-only diagnostics,
exact request equality with/without observation, public/inline/ineligible
classification, invalid native protocol, empty input, JSON restarts and journal
replay. **56 related existing tests** pass (complete requests, context/native
wire, checkpoint state, model budgets and replay CPU). Both Edge entrypoint
type checks pass. No paid model/CAD probe, full suite or workflow was started.
The known pre-existing catalog parity fixture failure above is outside this
increment; catalog/SQL/publication remain unchanged. Hosted installation is
verified below; compare the next ordinary run's counts with input growth before
judging deduplication savings. C1–C4 and R1–R6 remain open lifecycle work.

### Image-count diagnostic hosted readback — 2026-11-05, 21:02–21:03 UTC

Implementation [#476](https://github.com/EmelieHagander/Bob-the-builder/pull/476)
merged as `31c648467c7b39e1efb4f0cf029e0ab32d14bbe7`. Local, uploaded and
merged source tree match `b47e285b66bafa8db73a5d63129fdd2353a94ace`.
Correct project `yuobtgoidmmmwfqenkau`, previous versions/hashes/JWT policies
and zero queued/running Bob jobs were checked before replacement. Fresh worker
v202 and ask-bob v234 bundles were retrieved; only the three reviewed shared
runtime files changed. The full worker closure was installed/read back before
replacing ask-bob.

| Consumer | Version | Full files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 203 | 146 | Existing private job capability, JWT false | `0b47c0d7ad95b5d6e0770ce0d7f956fa942ec083bb110c3ae8423b14d2953f6c` |
| ask-bob | 235 | 148 | JWT true | `c863a4985f5fa5b02d6f35a4924cb2f37c69df102d242c916197700938d09979` |

Every returned runtime file matches its prepared closure byte for byte.
Post-rollout check at 21:03:35 UTC found zero active Bob jobs. No SQL/catalog,
project content, preview service or frontend change was made; no paid probe,
Pages workflow or full CI was started. Code-path tests and installation are
verified; an actual ordinary run's image counts and dedup effect remain pending.

### Measured owner run — entry, 2026-11-05, 21:28:44–21:30:14 UTC

Job `27705c1c-cd1f-40b1-9af1-b01f633b7775` completed in about 90 seconds:
8 successful model calls, 7 tool calls, no uncertain resends, final delivery
`partial`, no project writes. Main input grew **45,319 → 46,452 → 63,676 →
67,948 → 70,137 → 82,309** tokens. Scoped function logs prove activation and
deduplication: the last request was **before 5 / after 3 / removed 2 /
unique_private 3 / other 0 / dedup_version 1**. Earlier requests had zero,
then three unique image parts. This proves removal of two exact copies in that
request, not a measured token/CPU saving or a solution to total growth.

Visual evidence now records the exact **Solution 21 front**. Bob nevertheless
said the picture could only reach him and substituted ASCII. That capability
claim is wrong: the shipped component already renders read-only `source.visual`
previews. We did not directly observe the owner's rendered final reply, so
missing pixels in that particular UI are not independently established.
Source inspection found a separate concrete render bug behind earlier writes:
an opened Solution 20 view removed a just-saved Solution 21 receipt preview
solely because they shared a record ID. Only an exact same-revision viewed
source should replace that receipt's default preview.

<a id="stage-context-increment-2026-11-05"></a>
## Next increment — exact chat previews and explicit stage release, 2026-11-05

Owner authorized both fixes. Safety branch
`save/bob-before-stage-context-2026-11-05` retains published source
`a53f5ccb3662dce505486984e6499c7e09c7cf89`; the original pre-dedup safety
branch above is also retained. New main complete-request identities use a
published `stage_context_version: 1` pin; old manifests/jobs omit it.

- `open_project_item` supplies immutable `context_ref` and conditional
  `chat_preview` information in the main chat. Actual delivery remains the
  prerequisite for source evidence. Worker-private images make no main-chat
  promise. The view selector replaces a written receipt preview only when a
  viewed source has the exact same revision. Older comparison views therefore
  cannot hide newly saved work; read-only exact views and drawing revisions
  retain their existing rendering and authority checks.
- `advance_work_stage` replaces a bounded, unverified note when a visual/work
  question is settled. It validates finding refs against this chain's observed
  calls or exact active image inputs. Selected immutable pixels stay; other
  registered private pixels leave. Public/unknown identities stay. Original
  seed text and subsequent user constraints remain verbatim. Earlier assistant
  exchanges/tool payloads leave as whole native exchanges; a fresh matched
  handoff call/output pair remains, with the refreshed callable surface.
- The exact operation archive survives across stage boundaries and JSONB
  restoration. Reopening a retired picture uses the canonical authorized image
  reader. Backend write receipts, failed-worker stops, unfinished candidates,
  source/access validation and spending/idempotency policies are not reset.
  Stable note serialization keeps the next journal fingerprint exact after
  JSONB key reordering. Content-free stage logs contain image counts only.

**Verification:** 122 focused tests pass, including 40 unique-image stage
transitions through checkpoints, old pins/mismatched restore, explicit archive
recall, later reopening, exact media versions, invalid/invented refs, mixed
handoff/write batches, live pre-dispatch denial, native pairing/Claude wire,
JSONB-style fingerprints, preview capability and old/new view selection.
Both Edge type checks, app build, PWA checks and publication generation parity
pass. The actual live catalog activation/validation was exercised inside a
transaction and rolled back; readback retained contract v24 and no stage-tool
row. The final generated publication is checked again before actual activation.
No paid model/CAD probe or full CI was started.

The browser fixture now covers an exact read-only front preview after reload;
its TypeScript fixture import loads. No local Chromium is installed, so that
browser scenario has not run here. The pure preview-selection regression tests
and build pass; owner/browser rendering and ordinary model choice of correct
stage boundaries remain acceptance work. The initial seed, directory and
protected user text can still be large, and the private exact archive remains
once per turn; this does not close all C1–C4 or claim constant memory/CPU.

Hosted installation and activation are verified below. The preceding checks
describe the pre-publication state, not the current activation.
Rollback first disables the new contract, then drains pinned stage jobs before
restoring older runtime code. No canonical project data is deleted by this fix.

### Hosted readback and completed activation — 2026-11-06

Resumed the interrupted publication against the verified project
`yuobtgoidmmmwfqenkau`. PR #478 had already merged as
`7a5690325e6d57e0e427dd495f73551de91e004f`. Both Edge functions and
[Pages #396](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/42118610510)
were installed on November 5; only the catalog publication remained.

| Function | Version | Returned files | JWT |
|---|---:|---:|---|
| bob-worker | 204 | 148 | false, existing job capability |
| ask-bob | 236 | 150 | true |

Read back every returned file and compared its content to merged source.
The only difference is `cad-intake.ts`: its type-only declarations are erased
to an empty module in the hosted bundle. All executable source matches.
The served frontend `assets/index-BOiMxWPi.js` contains the exact-revision
comparison that prevents an older opened view suppressing a newer save,
and is configured for the expected Supabase project. Pages #396 is successful
at the exact #478 merge. The later #473 mobile UI merge is not part of that
published frontend; this continuation did not publish it or `cad-viewer`.

On November 6, publication generation parity and 12 targeted stage/catalog/
preview tests passed against main `07f10ab`. The actual catalog transaction
was validated and rolled back again before application. Source migration
`20261105214237_bob_stage_context_catalog.sql` was then applied as managed
ledger `20261106075147`, name `bob_stage_context_catalog`, at 07:51 UTC.
Readback verifies all four heads and exact published tool definitions:
`agent-contract.ask-bob` v25 with `stage_context_version=1`,
`tools.advance_work_stage` v1, `tools.open_project_item` v5 and
`tools.get_work_history` v4. Existing manifests and project data were not
rewritten. The entrance job `beac9bc1-0b2d-4305-93c9-45a8de07fe68`
started at 07:46 UTC before activation and cannot establish acceptance of
the new pin.

No new model/CAD call, CI or Pages run was started during this continuation.
Chromium is still unavailable locally; the cloud app opened at sign-in, so
private transcript rendering/reload and ordinary model choice of stage
boundaries remain unverified. Next acceptance must use a job created after
activation and measure stage transitions, exact displayed images, input growth
and preservation of unresolved constraints. C1–C4 and whole-run CPU/cost
acceptance remain open. Documentation reviewed directly using Archie's
placement/State rules; no separate reviewer agent was run.

## Stage tool card correction — 2026-11-06

The first stage-enabled entrance job `e5e410f3-24b8-4c51-be63-92688543315f`
(08:03:38–08:03:46 UTC) failed before its main model call. The picker succeeded,
but the main request uses lazy catalog resolution with `card:true`.
Published `tools.advance_work_stage` v1 lacked `card_description`, producing
`ai_contract_missing: tools.advance_work_stage card` in a local reproduction;
the job surfaced `ai_unavailable`. No main-model or project-write result was
produced. The earlier 07:46 entrance job retained its old manifest, saved
Solution v22 and mockup v4, then ended partial at 96,771 input tokens. It does
not measure the new stage handoff.

[PR #480](https://github.com/EmelieHagander/Bob-the-builder/pull/480) adds only the
missing card through `scripts/publish-bob-stage-context-card.sql`. Existing
versions are immutable; the publication refuses incompatible or independently
changed definitions. Its exact SQL passed real catalog activation in a rolled
back transaction before application to `yuobtgoidmmmwfqenkau`. Managed ledger
`20261106084847`, name `bob_stage_context_card`, activated v2 at
08:48:47 UTC. Readback confirms active ID
`1ac8d5b5-78a9-4ff9-8507-1f24d95059aa`, retained `stage_context_version:1`,
and an exact definition match to v1 after removing `card_description`.
Content and flow are unchanged. All other 401 catalog heads match the
pre-publication snapshot; original v1 remains unchanged.

The fixture applies the additive publication. A new regression exercises
`createBobContextContinuation` and actual `applyCatalogModelOptions` with
lazy main settings: the missing card must reject before dispatch, and the
corrected card must resolve through a stage handoff while retaining uncertainty.
**This new Node test is authored and reviewed but not executed:** the local
executor became unavailable. Earlier passing tests did not cover this path.
No new Edge/frontend deployment, paid model/CAD call or CI run was started.

Next acceptance requires a new job created after 08:48:47 UTC; replaying an
old pinned manifest does not establish the correction. Startup, actual image
delivery and bounded context across model-selected stage transitions still need
that ordinary run. C1–C4 remain open.

<a id="three-project-audit-2026-11-06"></a>
## Three-project owner-message audit — 2026-11-06

Read-only production audit of the latest entrance, Våningssäng2 and Lilla ladan
messages, preceding owner answers, current canonical records, private workpads,
conversation summaries, execution events and scoped Edge logs. The owner
confirmed the allegedly missing entrance message is the window-measurement
request, not a later message. Times below are UTC (Sweden is UTC+1).
No model call, project mutation, workflow or deployment was started.

| Project / latest job | Observed outcome | Acceptance |
|---|---|---|
| Entry, `bb36276a-38e3-492c-a0a4-9292a98364ef`, 08:58:15–08:59:00 | Owner message seq105 and answer seq106 are both completed. Five successful model calls, no writes; main input 54,976 tokens maximum. Answer compares mockup v4 windows with the sketch. | Startup correction works in an ordinary job. Delivery remains partial; actual owner-browser rendering is not observed. |
| Våningssäng2, `b45c2cdc-4ee3-4c90-9f18-1c82b8bd0367`, 08:58:55–09:23:06 | Construction advanced from v14 through v19; drawing v5 saved and front view opened; requirements updated. 89 logged model calls, USD 13.704 model-event cost, 24 invalid tool calls, final answer seq16 partial. | Real progress, but incomplete hardware/fastener work and renewed owner questions; no whole-task success. Cost excludes anything not represented by those model events. |
| Lilla ladan, latest job `7381e025-1e54-4983-8b37-9852ef1768b1`, same turn began 2026-11-05 18:14 and resumed 18:37–18:43 | Five mockup media entries appear in recovered receipts. Delivery failure code is `context_input_too_large`; final seq147 is a receipt recovery. Current construction remains v5 and drawing v3. | No ordinary run after the stage/card activation. Saved mockups do not establish agreement with updated construction or owner approval. |

### Confirmed findings and remaining diagnosis

**F1 — The entrance request arrived; the reported missing answer is a display
investigation.** Thread `90ef43fe-d675-4f29-baeb-70e400c8a552`, turn
`043d2d1a-9c24-4e4c-8188-e2d19ebd53d6`, has the owner's exact confirmed
request and a 2,047-character completed answer. All three audited threads have
no in-flight provider lock. A focused local probe fed the real last four entry
rows through `readBobTranscript`: seq106 and its evidence survive, latestSeq is
106 and unfinished is null. This excludes disappearance in that parser; it does
not verify authenticated fetch, drawer state, browser cache, or actual rendering.
Do not resend the work to diagnose display. Inspect that turn's retrieval and
rendering in the affected browser.

**F2 — Answered and deferred questions are reintroduced.** Entry seq91 explicitly
defers window remeasurement until building starts; seq96 confirms preliminary
height. Final seq106 nevertheless requests measurements now before changing the
sketch. The active summary through seq95 also preserves already-answered
questions: seq83 says the 3.16 m was to the roof underside, yet the summary still
asks whether it was the ridge cap or underside (while elsewhere stating
underside). This is a demonstrated summary-reconciliation error.

In the bed, seq3 rejects panel, seq4/6 record no panel anywhere, and current
Solution revision 13 explicitly retains that choice. Final seq16 again asks
plain plywood versus panel. There is no active stair summary for this short
thread: summary compression cannot explain this instance. Current source
selection/precedence and question reconciliation must also be corrected.
Not every repeated-looking question is old: the lower plank's end and changed
stair spacing correspond to explicit uncertainties in construction v19 and
deserve separate treatment, rather than silently treating them as answered.

**F3 — Replaceable working notes are not being maintained.** Bed Bob's note still
says construction v14 and drawing v4 are blocked after v19/v5 were saved; the
structure note stops mid-edit at v16. Entry Bob's note still targets Solution v8
and confuses front/side windows; barn notes retain an older no-geometry task and
an assumed animal-end choice. The frame marks these notes unverified, so this
does not prove they overrode canonical data. It does prove the supposedly
current working note is stale. Reconcile completed receipts and superseded
blockers at the work boundary; preserve deferred decisions as deferred.

**F4 — Stage release is installed but not used in these owner runs.**
Both new jobs pin manifest `46c3a797-f3b1-428a-9cc3-3a4f28b825e0`.
All 19 main model requests offer `advance_work_stage`; none calls it.
Bed main input starts at 33,035, peaks at 82,904, and ends at 76,829 tokens.
Structure has 35 calls and reaches 151,969 input tokens; materials has 20 and
reaches 98,855; drawing has 10 and reaches 90,577. Five context-summary calls
also occur. The current implementation only exposes explicit stage release to
main Bob (`references` checks function/role ask-bob); the workers have none.
C1–C4 remain open. Main installation alone does not establish bounded active
evidence or bounded colleague context.

**F5 — Worker contract friction consumes substantial work.** Of the bed's 24
invalid calls, 18 reject `derive_cad_material_requirement` with
`operation_identity_is_server_owned`; others include human-text validation,
unused parameter nodes, a no-change write and invalid drawing handoff.
Both drawing and materials return `step_budget` once. The worker loop still
has a `max_steps` boundary; these returns are not proof of task completion.
Inspect the final catalog-transformed schema, generic data description/manual
and server-owned identity binding together before weakening any write guard.
The active material tool's generic data description still lists source IDs
that the bound handler rejects; exact failed argument payloads were not
retained for attribution in this audit.

**F6 — Final answer is not a coherent whole-task handoff.** Bed seq16 concentrates
on materials and refers to questions from a previous message, although only
one answer was persisted for this turn. Telemetry shows a draft final at main
step13, one completion review, more material work at step14 and a final at
step15. Code keeps the draft as `reviewedAnswer` but persists the final answer;
this is consistent with a partial follow-up replacing the integrated report.
The discarded draft text was not retrieved, so its exact content is unverified.
Add a completion-continuation case that requires one self-contained final
delivery of changed construction, exact drawing, comparison findings and
genuine remaining questions.

**F7 — Barn's original visual-approval seam remains unresolved.** Seq142 gives
positive feedback and defers chicken/rabbit end choice; seq144 authorizes
standard working-size windows with final measurement later. Seq145 reports a
requirement for a presentation bound to the current message, despite earlier
chat feedback. The latest requested mockups were saved while actual
construction still has the older single-window geometry. Audit historical
presentation-to-feedback binding and label proposal images distinctly from
current-construction evidence; never manufacture approval or remove source
version checks. These incidents precede the latest stage release.

### Continue the existing plan

The original C1–C4/R1–R6 plan above remains the owner: small increments after
safety branches, exact image deduplication, reliable image delivery, then
stage-based release of obsolete images/read payloads while preserving original
instructions, uncertainty, source versions and write receipts. Stage activation
and the missing-card repair are installed; the ordinary behavior is not accepted.

Next priorities from this audit:
1. Reproduce the entrance answer's fetch/render path without a new model run.
2. Reconcile answered/deferred questions against exact owner messages and current
   project choices; use entry seq83/91/96 and bed no-panel decision as fixtures.
3. Reproduce/fix the bound material schema/manual rejection and coherent final
   answer after completion continuation; retain backend authority checks.
4. Validate an actual stage handoff and refreshed work note, then extend bounded
   active-evidence lifetime to colleagues before declaring C1/C2 complete.
5. Finish C3/C4 tool/seed duplication and whole-request accounting, with exact
   reopening/restart and no invented approval, measurement or blanket quotas.

This audit used direct source/contract review, not an independent reviewer
agent. It does not change the prior unrun Node regression or unobserved browser
acceptance into a pass. Current worker source readback remains v204.


<a id="three-project-corrections-2026-11-06"></a>
### Corrections and release after the three-project audit — 2026-11-06

The source corrections below were reviewed and merged in #482. Hosted release
evidence is recorded below; ordinary owner/model acceptance remains open. No owner project records, messages, summaries,
presentations or approvals were rewritten and no paid model run was started.

| Finding | Correction and evidence | Remaining acceptance |
|---|---|---|
| F1: answer visibility | A deterministic test reproduces a late same-thread tail (99–103) replacing an already received 102–106 tail. `refreshHistoryPage` now rejects older and empty stale tails; AskBob also retains delivery/read/recovery state and does not stop polling from a rejected result. New/reset threads still replace old history. | This race is reproducible, but is not proven to be the cause on the owner's device. Browser refresh/reopen/send acceptance remains. |
| F2: repeated questions | Immutable catalog revisions reconcile later owner answers against old questions, distinguish answered/open/deferred matters in memory folds, and tell the completion gate that already answered questions are not human blockers. The startup role remains within the existing 700-token limit. | Prompt semantics require a normal model run. Existing immutable summaries remain historical; exact source retrieval is still needed when their gist conflicts. Entry seq83/91/96 and bed's no-panel decision remain the named acceptance cases. |
| F3: stale workpads | A claim-fenced reader omits a private note after a later successful Bob write in the same project. It retains the original note and CAS revision; explicit reaffirmation after current-source reading advances CAS, and retries remain idempotent. Old pinned jobs retain the old RPC. | This is a conservative freshness fence for Bob writes, not a semantic decision store or detection of every manual project edit. Current records and exact conversation remain authoritative. |
| F4: worker evidence lifetime | A separate immutable worker pin enables native requests, exact result archive and `advance_work_stage` for structure, materials and drawing. Worker image carriers now expose exact context refs without promising main-chat previews. Real worker/grounding/continuation/catalog tests exercise stage dispatch, refreshed tool gates, source receipt facts, release, reopening, restart and old-protocol isolation. Stage telemetry now records the actual tool name. | Main Bob and colleagues must use transitions effectively in ordinary work. Large seed/knowledge/user-text payloads and an unfinished large stage remain C3/C4 work; no whole-run cost improvement is claimed. |
| F5: material calls | Catalog operation bindings can override the description at an exact schema path. The final material schema and manual omit the generic instruction to supply source/target IDs; the job still injects them and still rejects overrides. Bound and unbound source tests pass. | A normal material run must demonstrate that the 18 repeated invalid calls disappear. Other invalid/no-change calls are not conflated with this specific defect. |
| F6: final handoff | Both completion continuation notes explicitly identify the candidate answer as unsent and require one self-contained whole-task final result. They retain targeted work and do not repeat completed operations. | The output of a real resumed completion must cover construction, drawing, comparison and genuine remaining questions together. Scripted model responses prove the runtime instruction path, not the model's judgement. |
| F7: historical visual feedback | A read-only hosted check found **zero** `solution_presentations` for the barn. There is no exact recorded presentation to retroactively approve. The feedback manual now distinguishes an unavailable current-turn feedback binding from permission to perform ordinary requested edits; earlier intent still comes from conversation and current decisions from readiness. | Do not fabricate a presentation/approval or accept a changed revision. Verify that a mockup response allows the requested design correction without a spurious global approval stop. |

Verification: 100 distinct focused local tests pass across the affected history,
worker, continuation, image, memory, catalog and workpad seams; the new catalog
publication is exercised with the full synthetic database validator, preserves
prior versions and is idempotent. The eight changed catalog keys were compared
read-only with their hosted predecessors; every expected old content/definition
matched. Frontend build and PWA checks pass. Both affected Edge entrypoints pass
Deno type checking with the same pinned Supabase 2.49.8 and tokenizer 3.4.0 types
from locally installed packages: this environment cannot fetch esm.sh directly.
No dependency change is shipped. Chromium is absent, so browser acceptance is
not reported as passed. Full CI/workflows and live models were not run.

Release order: install `20261106110808_bob_workpad_freshness.sql`, publish matching
ask-bob/bob-worker code, activate `20261106111110_bob_audit_followup_catalog.sql`,
then publish the frontend and read back exact versions. Activation refuses a
missing workpad RPC or changed expected catalog content. Existing execution and
checkpoint pins remain unchanged. Check active jobs and source parity before
any deployment. The frontend/Edge/catalog changes are one reviewable package;
new worker stage mode must not be activated against the old runtime.


#### Hosted publication — 2026-11-06

The owner authorized publication after the prepared corrections. #482 is merged
at `d98f70640cac3c8e73b02764f2a62ca91b7d5998`, with tested tree
`61a75703c9e50227feef4a4be98f1802047ec251`. Audit #481 was included and is merged
as well. The safety branch retains `07f8ef5be59611acbb5151879d9eaa17e5dc7749`.
A fresh preflight found zero active Bob jobs and unchanged expected predecessors
for all eight catalog keys.

Publication followed the dependency order:

1. Workpad migration applied under hosted ledger version `20261106122646`
   (`bob_workpad_freshness`; repository filename `20261106110808_...`). Its
   function body exactly matches the prepared SQL; only postgres/service_role
   can execute the security-definer wrapper.
2. Matching Edge code published as **bob-worker v205** and **ask-bob v237**.
   JWT verification remains false/true respectively, with the existing custom
   worker authentication unchanged. All returned runtime sources match the
   prepared upload; the only content difference is the already-known erasure
   of type-only `cad-intake.ts`. Additional type-only inputs may be omitted by
   the bundler. Returned source counts are 148 and 150. Bundle SHA-256 values:
   worker `0db463a27ceae8700e053d61dab3fdd217c99215cc7b47c59b4c84d8b3cf6f1f`;
   ask `94643b8ef642d4c9a6c761adf9285ab7624a39415e9a50f5f38a87692c08ad52`.
3. Catalog migration applied under hosted ledger version `20261106122806`
   (`bob_audit_followup_catalog`; repository filename `20261106111110_...`).
   Exact readback of content, definitions and preserved metadata passed:
   `agent-contract.ask-bob` v26, `bob.context-principles` v6,
   `bob.note.finish`/`bob.note.gate-gap` v2, `bob.tools` v50,
   `completion-gate.contract`/`memory-stair.contract`/`tools.read_model_feedback`
   v3. Publication tag is `bob-audit-followup-v1`; both new runtime pins are 1.
   Existing execution manifests remain immutable; a fresh manifest is created
   when a new job claims the current catalog, not merely on activation.

4. **Pages #398 succeeded** from the exact merged source `d98f70640cac3c8e73b02764f2a62ca91b7d5998`:
   https://github.com/EmelieHagander/Bob-the-builder/actions/runs/42218185648.
   Both build and deployment passed. This was the authorized manual deployment
   workflow only. No full CI or paid acceptance workflow was started.

The acceptance cases in the table above remain open until ordinary owner runs.
No paid model run, full CI or owner-project data correction was performed.

<a id="owner-runs-after-audit-release-2026-11-06"></a>
### Owner runs after the audit release and the bed edit repair — 2026-11-06

Read-only hosted readback (SELECT only; no project data, prompt, job or catalog
changed) of the two owner turns after bob-worker v205 / ask-bob v237.

| Run | Outcome | Model calls / known cost | Largest input | Observed |
|---|---|---|---|---|
| Entry, 13:44 UTC (`88761ca2`) | `recovered`, `context_input_too_large` at the model stage | 10 / USD 1.13 | Bob 93,383 (ceiling 96,000) | Mockup v5 (front windows 42 × 117 cm) was saved. Opening saved items raised Bob's input from 45.7k to 76.3k in one step. The final message is the recovery notice with no image attached. The recovery request had no cached input and cost USD 0.475 (42 %). F2 (repeated questions) could not be judged. The preceding 11:58 UTC owner message (measurements and photo) ended as `image_outcome_unknown` before the release and has no reply. |
| Bed, 13:46 UTC (`492a597d`) | `saved` | 26 / USD 2.07 | Konrad 132,128 (77.8k → 132k in 9 calls) | Bob saved the three owner decisions in the selected Solution and reported honestly that the construction was unchanged. Konrad's `edit_construction_parts` was first rejected for `human_text`, then returned `conflict`; the worker stopped and further structure work was blocked for the turn. Mattias was not called, so F5 is untested. |

Both runs offered `advance_work_stage` on every Bob and Konrad request; it was
used 0 times. C1/C2 therefore remain open in ordinary work.

**Bed conflict cause.** Construction v19 reads `source_state: changed` with the
stored reason `target_changed`. `bob.prepare_construction_edit` refuses
`target_revision: null` when the source state is not current
(`construction_changed`, PT409), and the Edge wrapper collapsed that to
`construction_edit_preparation_failed`. The active `tools.edit_construction_parts`
v9 description explains `target_revision` only for joint Solution edits, so
Konrad had no named repair. The RPC reason is inferred from the hosted function
and the current stored state, not from a logged payload. A new "kör" alone would
repeat it (R5).

**Correction (merged in #484; hosted publication below).**

- The Edge wrappers pass through only the server's named `construction_changed`
  and `operation_reused` conflicts; every other database error keeps its generic
  reason.
- A construction-only edit with `target_revision: null` refused as
  `construction_changed`, whose current construction is still at the expected
  revision, unarchived and `changed`, returns `invalid` /
  `target_revision_required` with the repair: read `view=work`, resend with the
  current target revision. `invalid` keeps Konrad's job running. Revision races,
  archives and unknown failures stay terminal conflicts. The server gate is
  unchanged.
- A real-database fixture saves an owner decision in the Solution first,
  receives `target_revision_required` without a new revision, then saves
  revision 5 with the current target and `source_state: current`. On the
  previous code the same case returns the original `conflict`. Focused suites
  for construction work, workers, edits, text, write state, fasteners, delivery
  and stage context pass, except two catalog-publication cases in
  `construction-edits` and `construction-fastener-tools` that fail identically
  on unchanged main. Both Edge entrypoints pass Deno type checking with a
  temporary local import map for the pinned packages.

#### Hosted publication — 2026-11-06, 15:00 UTC

The owner authorized publication of this correction alone (Entry/C2 remains a
separate increment).

- #484 is merged at `4bb0db5d4035375e952f8163aaa7d44eff688fa0`; its tree
  `36aff2a149a34cf3692a728ad71f01892e80a01d` equals the tested branch tree.
  Safety branch `save/bob-before-edit-repair-2026-11-06` retains the previous
  published source `bf353885bdcb5a3deb7cf1deb8114f2c020182d4`.
- Preflight: project `yuobtgoidmmmwfqenkau`, zero active Bob jobs, and the
  running versions were exactly the recorded bob-worker v205 / ask-bob v237
  bundles.
- Published from the merged checkout with Supabase CLI 2.117.0
  (`supabase functions deploy --use-api`), worker first.

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 206 | 148 | Existing private job capability, JWT false | `b1db3dbef23404358d2b34cffc5a86fcf08f7873c449722ce628b79756f0ed3f` |
| ask-bob | 238 | 150 | JWT true | `f33c3e8795342a80d8e14b709df52bc6e11bd187a06ff8c83de2450915070c2a` |

The returned runtime sources were compared byte for byte with the merged
checkout: every file matches except the already-known type-only erasure of
`cad-intake.ts`, and both bundles contain the new reason handling. Zero Bob jobs
were active after publication. No migration, catalog change or frontend
publication was needed: the change is Edge code only.

Remaining: one ordinary bed turn to show Konrad's repaired edit, the
Rita/Mattias follow-up and the cost. Entry's image load and context ceiling (C2)
is the next separate increment. No paid model run, full CI, catalog publication
or owner-data correction was performed.

<a id="claude-window-cut-2026-11-06"></a>
### Bed run after the edit repair: Konrad's answer outgrew the Claude window — 2026-11-06

Read-only readback of the owner's bed turn at 15:59 UTC (job `32eef129`, run
`a75d02e0`): 7.8 minutes, 20 model calls, USD 1.69 known cost, `saved` with one
record (a catalog fastener). The construction is unchanged and Rita/Mattias
were not called. The edit repair (#484) was never reached.

- Konrad read the construction 11 times (input 71k → 113k), added the fastener,
  then his next request was aborted by our own timer twice at exactly 120 s
  (`request_aborted`, attempt 0 and the uncertain-billing resend). The worker
  returned `unavailable`, and the turn's structure stop refused Bob's two
  narrower retries. Both aborted requests are absent from `ai_usage_events`;
  their cost is unknown (execution events mark them unpriced).
- Claude calls stream synchronously inside one worker segment
  (`CLAUDE_BACKGROUND_TIMEOUT_MS` 120 s, at least a 90 s window), while
  unlimited Bob work sends the model's own `max_tokens` (128,000). A local
  timeout during an active stream was reported as `Network error` and resent
  identically.
- A fixed output cap derived from the window was considered and rejected:
  execution events show long Claude outputs streaming at 91–154 tokens/s and
  successful outputs up to 16,618 tokens (112.6 s). A cap at a conservative rate
  would have cut about 25 successful calls.

**Correction (source; not yet deployed).**

- The Claude adapter reports a local deadline that closes while answer text or
  thinking is still streaming (last delta within 10 s) as
  `model_output_window`, not as a lost connection. A stalled or never-started
  stream keeps the existing `Network error` and its single resend.
- Bob's main loop and the worker loop treat `model_output_window` and
  `model_output_limit` as a cut answer that ran nothing: the same pending
  request is sent once more with one short code-owned note to continue with one
  change per tool call. A second cut answer stops as before. Other failures are
  unchanged. The shortened-segment yield (`segment_wall`) still runs first.
- The CAD design/review failure messages and execution-metric failure kinds
  include the new code.
- Tests: a streaming fixture returns `model_output_window` (the previous
  adapter returns `Network error: aborted`); full-turn fixtures show Konrad and
  Bob each continuing once with the note, a second cut stopping Konrad without a
  third request, and other failures stopping without the note. With the retry
  disabled the three loop cases fail. 133 of 134 focused tests across adapter,
  turn, worker, CAD, budget, metrics, checkpoint and Claude continuation pass;
  the remaining `bob-final-answer` spending-stop readback case fails identically
  on unchanged main. All Edge entrypoints pass Deno type checking with the
  temporary local import map.

**Similar risks found and corrected in the same change.**

- `plan-compiler` had at most 40 s; earlier compiled plans reached 5,402 output
  tokens (p90 4,535), about 60 s at observed Claude speeds. Its window is now up
  to 120 s, still bounded by the caller's deadline. The reviewer (max 1,740
  tokens, 30 s) is unchanged.
- Working-context and orientation summaries (3,000-token design, Claude
  outputs up to 2,646 tokens in 17.7–22.7 s) now have 45 s instead of 30 s. The
  memory stair (max 1,314 tokens) keeps 30 s.
- An aborted Claude request that reached the provider is now written to the
  usage ledger with its known input tokens, zero recorded output and
  `cost_usd: null`, with error code `model_output_window`, `local_timeout` or
  `network_or_stream`. No ledger trigger or Bob runtime reader is affected;
  failed rows already existed.

**Remaining decision.** A first cut answer still spends its whole window (up to
120 s) before the note. Longer Claude segments would let long answers finish,
but depend on the Supabase plan's Edge wall clock (the timing module assumes
150 s); the plan could not be read with the session's access.

Remaining: Edge deploy (ask-bob + bob-worker) with the owner's OK, then one
ordinary bed turn. No paid model run, full CI, catalog change or owner-data
correction was performed.

<a id="image-lifecycle-2026-11-06"></a>
### Image lifecycle: look when needed, release after use — 2026-11-06

**Owner decision.** Images keep their full resolution. Bob first sees a short
description, opens only the images he needs, and does not keep pixels beyond
their use; the description stays and he can reopen. Descriptions are made once
per image by the smallest vision model (Haiku tier), kept short.

**Measured cause (entry run 88761ca2).** One `open_project_item` delivered four
images (mockup v4 and three phone photos, +30.3k provider tokens); reviewing
mockup v5 added +14.2k. Every opened image then stayed in each later request:
pixels left only through `advance_work_stage`, which was never used.
`generate_project_image` already passes `reference_image_ids` straight to the
image model, so opening references is not needed to generate. Of 48 ready
project images, 6 have a cached description; the existing
`describe_project_image` cache is only written when Bob chooses to after viewing.

**Step 1: release after use (source; not yet deployed).** New execution
identities with the stage contract pin `imageReleaseVersion: 1`. Before each
native request the continuation replaces the pixels of an opened private image
with a short text marker once a result was saved after the model saw it, or at
the latest after three of its answers. The image's ref/title text stays and the
marker names `open_project_item` for reopening. Seed messages (the owner's
current message and its photos), tool results, native answers and unknown or
public images are unchanged. The pin is part of the saved continuation state;
jobs without it keep every opened image. Releases are logged content-free as
`[Bob image release]`.

Tests: rule cases (in use, save in the delivery group, later save, three
answers, idempotence, untouched kinds), a native chain through a worker restart
where the saved mockup releases mockup v4 and the window photo while the
owner's photo stays (old pin: unchanged), and pin/state validation. Existing
continuation, image, stage, drawing-preview, vision and turn suites pass except
cases that fail identically on unchanged main. Both Edge entrypoints pass Deno
type checking.

**Step 2: descriptions first (source; not yet deployed; owner chose Haiku and
option C).** A new read-only catalog role `image-describer` (profile on the
`nano` tier, production binding `claude-haiku-5-5`, 300 output tokens, 30 s,
low effort) writes one Swedish phrase of at most 120 characters: subject, side,
viewpoint and build state. A dimension appears only when written in the image
itself; sizes are never estimated and people never identified. Publication
`20261106180000_bob_image_describer_catalog.sql` adds six definitions and the
function setting; it refuses a second run.

- New executions pin `imageDescriptionVersion: 1` when the manifest contains the
  role. When Bob lists images, up to six undescribed listed images per listing
  are described after the metadata read, within 40 s, and stored through the
  existing claim-fenced `bob_describe_image` cache (per owner and image
  version; a changed image never shows an old description). A failed or slow
  description leaves the listing usable without it. There is no separate
  backfill: older images are described when first listed (about USD 0.002 each,
  estimated).
- An opened image carries its current description in the item and in the image
  text, so the description remains after step 1 releases the pixels.
- Tests: role shape and contract wording; the DB publication adds only the six
  keys and the setting and refuses a rerun; the fixture matches the migration
  for every new key (the fixture-replay test still fails on unchanged main for
  older keys); description parsing; batch limit, reuse, failure and
  continuation handling; opened-image description; dispatcher listing with a
  failing describer and the carrier text. Both Bob Edge entrypoints pass Deno
  type checking.

Release order: publish ask-bob and bob-worker first, then apply the catalog
migration (activation). Jobs pinned before it describe nothing.

<a id="publication-486-2026-11-06"></a>
#### Hosted publication of #486 — 2026-11-06, 19:47 UTC

The owner authorized publication of the cut-answer retry, fitted helper
windows, image release after use and image descriptions.

- #486 is merged at `af31e04e28559c14a76672eb20356ae64b3e7219`; its tree
  `3518c88da28677beb5932f179fe5eb23af76d691` equals the tested branch tree.
  Safety branch `save/bob-before-window-images-2026-11-06` retains the previous
  published source `667e5dfc395ce1c2cef7dcb3e5e6abc100d03061`.
- Preflight: zero active Bob jobs; running versions exactly bob-worker v206 /
  ask-bob v238; none of the describer keys or its function setting existed.
- Edge code published first from the merged checkout (Supabase CLI 2.117.0,
  `--use-api`, worker first):

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 207 | 149 | Existing private job capability, JWT false | `9168dbbb1ee3577b6a1205fb5eb8a22e9f1b6a8f0311ed5d16a1e38eb6bce19f` |
| ask-bob | 239 | 151 | JWT true | `106a7955a1c89d07e6732303030760e3f7f3b55f10d5ccd6b66f9414ae75b543` |

  Returned sources match the merged checkout byte for byte except the known
  type-only `cad-intake.ts` erasure; both bundles contain the new adapter code,
  retry note, image release and description parser.
- Catalog activation afterwards: `20261106180000_bob_image_describer_catalog.sql`
  applied under hosted ledger version `20261106194717`
  (`bob_image_describer_catalog`). Six definitions are active at version 1
  with publication `bob-image-describer-v1`, and their content and definitions
  equal the repository migration; the `image-describer` function setting is
  enabled at `nano`; `tier.nano` remains `claude-haiku-5-5`.
- Zero active Bob jobs after publication. No frontend publication was needed.
  New jobs adopt the pins; existing manifests and jobs keep their behaviour.

Remaining: an ordinary entry turn (descriptions, image release, ceiling) and
an ordinary bed turn (Konrad's repaired edit and any cut-answer retry), with
cost. No paid model run, full CI or owner-data correction was performed.

<a id="tool-schema-dedup-2026-11-06"></a>
### Tool schemas: the same block sent seven times — 2026-11-06

**Measured (o200k, pinned manifest).** Konrad's 25 tool definitions are 30,227
tokens, 73 % of which are five write schemas (`edit_construction_parts` 8,024,
`save_construction_draft` 6,762, `change_construction_parameters` 4,268,
`calculate_project` 1,824, `transition_legacy_drawing` 1,330). Merging the 31
read tools would save only 0.6–1.6k per role start, so the owner chose to look
at the write tools first.

**Cause.** `edit_construction_parts` is 28,653 schema characters, and 72 % are
copies: the schema builder inlines the same sub-schemas wherever they are used
(the placement block seven times; the box/cylinder shape three times; the
whole Solution edit schema inside a construction tool). Description text is
only 2,551 characters. The same copies recur across the sibling write tools.

**Measured with Claude's token counter (one-off, owner-authorized, ≈USD 0.01;
a temporary count function was deployed in the project and deleted with its
secret).** For the five write tools, inline 44,096 tokens → with shared `$defs`
34,561 (−22 %); `edit_construction_parts` alone 14,907 → 11,150 (−25 %). Across
the whole bench the wire schemas go from 210,378 to 185,188 characters.

**Correction (source; not yet deployed).** `tool-schema-dedup.ts` rewrites a
tool schema losslessly: every sub-schema that occurs at least twice is written
once under `$defs` and referenced, larger blocks first, so a shared block can
use smaller shared blocks. Only the Claude adapter applies it, and only for
executions pinned `toolSchemaDedupVersion: 1` (new executions on a checkpointed
job); validators and old pins keep the inline schema. Tests prove the round
trip is identical for every bound tool, that the rewrite is idempotent, that
missing or cyclic refs are refused, and that the wire request carries `$defs`
only under the pin.

Remaining: an ordinary bed turn with the pin (Konrad start should fall by about
10k Claude tokens); then step B, offering the rarely used write tools only when
the job needs them (`save_construction_draft` 12 % of jobs,
`change_construction_parameters` 15 %, `calculate_project` 4 %,
`transition_legacy_drawing` 0 %), and a slimmer `solution_edit`.

<a id="publication-488-2026-11-06"></a>
#### Hosted publication of #488 — 2026-11-06, 21:43 UTC

The owner authorized publication of the tool-schema deduplication.

- #488 is merged at `0fba851737b41af4eb64ff952c7df856f6b2012a`; its tree
  `42c2c1cee062fb6b0369a6637717f40d204d1564` equals the tested branch tree.
  Safety branch `save/bob-before-schema-dedup-2026-11-06` retains the previous
  published source `ec0fb3d96d29e68921c37c35a3ab12467fc49f27`.
- Preflight: zero active Bob jobs; the running bundles were the 19:47 ones
  (bob-worker `9168dbbb…`, ask-bob `106a7955…`; their version numbers had
  advanced to 209/241 during that same publication without a content change).
- Published from the merged checkout (Supabase CLI 2.117.0, `--use-api`,
  worker first):

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 210 | 150 | Existing private job capability, JWT false | `8f0d4654d13b4c810e5bea9a14dd87ee3c65a5b8cf4f144c9805fb2a582628a2` |
| ask-bob | 242 | 152 | JWT true | `f5d1f732b5a7a6add610e5f929a677625e65ce29f728ea450253dd9c99d97276` |

  Returned sources match the merged checkout byte for byte except the known
  type-only `cad-intake.ts` erasure; both bundles contain the dedup module and
  the execution pin. Zero active jobs after publication. No migration, catalog
  change or frontend publication.

Remaining: ordinary entry and bed turns measure, against the
[baseline](#context-envelope-2026-11-05) and today's per-role figures (Bob
start 28.2k, Konrad 57.5k, cache 65 % / 83 %), the combined effect of the
19:47 and 21:43 publications: image release and descriptions, the cut-answer
retry, and Konrad's start input (expected about 10k Claude tokens lower).

<a id="cache-points-2026-11-06"></a>
### Owner runs after #486 and #488: cache misses and silent aborts — 2026-11-06

Two ordinary owner turns ran after the 21:43 publication (read back from
`bob.execution_events`, `shared.ai_usage_events` and the job rows; no model
was run for the analysis).

| | Bed (`749d3bea`, job `65f2d501`) | Entry (`c4216d67`, job `4dfc4cb7`) |
|---|---|---|
| Wall time | 22:00:45–22:12:34 UTC, 706 s | 22:01:23–22:24:23 UTC, 1,380 s |
| Saved | 1 record | 8 records |
| Bob | 8 calls, start 33,023, peak 41,100, cache 71 %, USD 0.59 | 28 calls, start 34,428, peak 87,170, cache 72 %, USD 3.22 |
| Konrad | 27 calls, start 59,485, peak 109,664, cache 77 %, USD 3.26, 2 aborted | 5 calls, start 75,842, 2 aborted, USD 0.50 |
| Total | ≈ USD 3.84 | ≈ USD 3.76 |

**What the publications fixed.** The bed edit conflict is repaired live:
`target_revision_required` at 22:02:59, the resend saved at 22:03:17. Konrad's
start input fell to 59,485 tokens (71–78k before the schema deduplication).
Aborted Claude calls are now visible in the ledger (four rows, cost null).

**What still failed.**

1. *Silent aborts.* Konrad's last job in both runs stopped after two 120 s
   deadlines (bed: input 85,340; entry: 94,219). The ledger says
   `local_timeout`, not `model_output_window`: the stream had started
   (`message_start`, usage known) but no content delta arrived in the last
   10 s, so the adapter treated it as a lost connection and the worker resent
   the identical request, which timed out identically. The model was thinking
   in silence (adaptive thinking streams no deltas while it thinks). Nothing
   from those jobs was saved; Bob's bed answer asks the owner to choose a
   stair option a–d (recommendation a). In the entry run Bob's turn ended
   without Konrad's part.
2. *Full cache misses.* Calls with `cached_input_tokens` 0 at 40k+ input:
   bed Konrad steps 6, 10, 12, 18 and every Konrad job start, Bob step 4
   (≈ 53 % of the bed's cost); entry Bob steps 2, 6, 10, 14, 18 — every fourth
   step, which is the compaction batch (`BOB_COMPACTION_BATCH` 4) — plus step
   16 (tool list 19 → 21) and Konrad's job start (≈ 76 % of the entry's cost).
   The offered tool lists at the compaction misses were identical (25 tools,
   same order), so the tool list is not the cause there. The cause is how
   Claude caches: it keeps a read point only where an earlier request wrote
   one, and Bob's request wrote only the automatic point at its end. When a
   compaction batch rewrites older results, the new request's prefix matches
   no earlier end point, so tools (Konrad ≈ 43k tokens of definitions after
   the deduplication), system prompt and job start are paid at full price
   again; a new Konrad job's different start has the same effect. OpenAI
   matched these prefixes by itself, which is why the design never needed
   fixed points before.
3. *Unexplained.* Entry Bob steps 22 and 26 read 72,273 cached tokens (the
   step-18 end point) although their input was 79–82k: the transcript
   between steps 18 and 21 had changed after a three-minute idle gap. Bob
   stands still for two to three minutes about six times per run, roughly
   half the wall time, and did so on earlier days too (gaps over 100 s per
   hour since 2026-11-04: 5, 4, 2, 6, 3, 4, 2, 2, 2, 6). Function logs are
   not readable through the management API in this session, so the cause is
   open and needs its own investigation.
4. *Image descriptions.* None were written: Bob never listed the project's
   images in either run, so the describer had nothing to do. Not a defect;
   the live path is still unverified.

**Owner direction (2026-11-06).** The whole fix: A to reach the footing GPT
had (fixed cache points, and the note retry after a silent abort), then B to
improve beyond it (Konrad plans first in his workpad, about eight tools
instead of 25, Bob's tool list fixed from step 1). Measured tool use since
2026-11-02 supports B: Konrad's 25 offered tools serve 9,617 calls, of which
two tools (`read_construction_draft` 386, `edit_construction_parts` 57) are
75 % and thirteen tools are used seven times or fewer; Bob saw 52 distinct
tools, about 30 of them fewer than ten times, and called `describe_tool` 97
times. B is a proposal for owner review before it is built.

**Correction A (source; not yet deployed).**

- *Fixed cache points*, pinned `promptCachePointsVersion: 1` for new
  executions on checkpointed jobs. The Claude request puts an explicit point
  on the system prompt's last block (tools render before the system prompt,
  so tools and system become one read point), on the last message of the job
  start (seed, stage handoff, historical images) and on the last settled
  history message (the compaction boundary, byte-stable between batches),
  beside the automatic point at the end: at most four, the provider's limit.
  Points are wire form only; nothing is stored in a chain or checkpoint.
  Tests prove that unpinned executions send identical bytes, that the points
  sit where stated through eleven exchanges and a checkpoint restore, and
  that the settled point moves one batch at a time. Expected effect: a
  compaction miss costs the transcript after the settled boundary instead of
  everything, and a Konrad job start costs its seed instead of tools, system
  and seed; roughly one dollar per run of the two above. To be measured.
- *Silent aborts*: a local deadline after Claude's first stream event is
  reported as `model_output_window` whether text was still streaming or the
  model was thinking in silence (ledger `model_output_window` /
  `model_output_window_silent`); a deadline before the first event keeps
  `local_timeout` and the identical retry. Bob and the workers then continue
  with the note, reworded to cover both: "Your previous answer did not finish
  within one response and was discarded … Continue the same task in smaller
  steps".
- Not changed: Bob's tool list still grows within a turn (step B).

Remaining: publish A, run the same two turns, read back cache share and cost
per role against this table; then the B proposal.

<a id="publication-491-2026-11-06"></a>
#### Hosted publication of #491 — 2026-11-06, 23:43 UTC

The owner authorized the whole fix ("Applicera alla", 2026-11-06): A now, B
after it is built.

- #491 is merged at `086915d036592fea6c5030df23516f91a7358223`; its tree
  `b403ac8c57595e9ac864b75c0ff1c25a1f3aaf5c` equals the tested branch tree.
  Safety branch `save/bob-before-cache-points-2026-11-06` retains the previous
  published source `0fba851737b41af4eb64ff952c7df856f6b2012a`.
- Preflight: zero active Bob jobs; the running bundles were the 21:43 ones
  (bob-worker v210, ask-bob v242).
- Published from the merged checkout (Supabase CLI 2.117.0, `--use-api`,
  worker first):

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 211 | 150 | Existing private job capability, JWT false | `59b8fa317c4070a246654162bea414bebd868f9640349553a43d12086f7782a2` |
| ask-bob | 243 | 152 | JWT true | `5b61fecce41985fe10b91fa434ab2eb06933b955cc4250aaf04dd65cea394d7b` |

  Returned sources match the merged checkout byte for byte except the known
  type-only `cad-intake.ts` erasure; both bundles contain the cache-point pin,
  the `cacheBoundary` marking and the silent-window code. Zero active jobs
  after publication. No migration, catalog change or frontend publication.

Remaining: B (Konrad's plan gate, core and picked tools, Bob's picker up to
eight), then the owner's own project turns read back against the
[table above](#cache-points-2026-11-06).

<a id="tool-focus-2026-11-06"></a>
### B: Konrad plans first, a focused tool list, Bob's picker up to eight — 2026-11-06

Owner decision 2026-11-06 ("Applicera alla"): B1 as a server rule with the
same tool list, B2 as listed, B3 with the picker widened and loading kept as
the reserve.

**Measured basis (28 Bob turns with Konrad since 2026-11-02).** Konrad was
offered 25 tools on every call. `read_construction_draft` (386 calls, every
turn) and `edit_construction_parts` (57, 64 % of turns) were 75 % of his
calls; `find_catalog_materials` 57 % of turns, `search_project_data` 32 %,
`add_catalog_fastener` 29 %, `update_workpad` 25 %, `read_build_tree` 21 %,
`read_solution_context` 18 %, four tools at 14 %, four at 4–11 %, and
`create_sub_build`, `place_build`, `derive_construction_lists`,
`transition_legacy_drawing` never. His persona asks for the next step in the
workpad, but no job wrote a plan before its first write. Bob saw 52 distinct
tools, about 30 fewer than ten times, and loaded tools through
`describe_tool` 97 times; each load changed his tool list within the turn,
which under Claude invalidates the whole cache (entry: 17 → 19 → 21 tools).

**Correction (source; the catalog migration is applied at publication).**

- *Catalog* (`20261107000000_bob_tool_focus_catalog.sql`, publication
  `bob-tool-focus-v1`): `bob.tools` gets `worker_focus_version: 1` and
  `build_workers.structure.focus` — core `read_construction_draft`,
  `edit_construction_parts`, `save_construction_draft`,
  `check_construction_draft`, `find_catalog_materials`,
  `add_catalog_fastener`, `search_project_data`; optional
  `change_construction_parameters`, `continue_construction_change`,
  `read_build_tree`, `read_solution_context`, `read_construction_changes`,
  `search_building_knowledge`, `open_project_item`, `list_project_category`,
  `calculate_project`, `change_construction_roles`,
  `read_construction_delivery`; `optional_limit` 4. The four never-used tools
  stay owned by Konrad (so Bob does not get them) but are not offered.
  `agent-contract.ask-bob` gets `worker_focus_version: 1`,
  `worker_plan_version: 1`, `tool_pick_limit: 8`. `schema.bob_tool_pick`
  allows eight names. `tool-picker.contract` OLD "Name at most four, only from
  candidates; name fewer when fewer are needed." → NEW "Name at most eight,
  only from candidates; name fewer when fewer are needed."
  `structure-worker.persona` gains the paragraph: "Innan du ändrar något
  skriver du din plan i anteckningsblocket: målet, stegen i ordning och nästa
  steg. En ändring utan plan avvisas. Planen är ditt arbetsläge, inte ett
  sparat resultat; uppdatera nästa steg efter varje sparad del."
- *Runtime.* `catalogWorkers` validates a focus (known, owned, disjoint
  names; limit 0–8). A pinned job (`workerFocusVersion: 1`) is offered its
  core tools, the workpad and up to the limit of optional tools that the
  tool-picker role names from Bob's request at job start (`pickWorkerTools`:
  the same role and schema as Bob's picker, candidates only the optional
  tools with their cards); the list is fixed for the job, and a resumed job
  reads its picks from the offered order instead of asking again. A pinned
  job (`workerPlanVersion: 1`) refuses a construction write (the worker's
  tools except `check_construction_draft`) with `plan_required` until an
  `update_workpad` note with status working or waiting, a goal and at least
  one step is saved in this job; reads and checks pass; `planned` is saved in
  the worker's progress. Bob's picker names up to the pinned `tool_pick_limit`
  (eight) instead of four; loading through `describe_tool` stays as the
  reserve and is measured. Pins: both worker pins need a checkpointed,
  claimed job with `workpad_version 1`; older jobs and manifests change
  nothing.
- *Tests* (`tests/bob-worker-focus.test.ts`): the offered list is core plus
  the first valid picks, fixed across steps and across a resume without a
  second pick; unlisted and unpicked tools answer `not_offered`; the gate
  refuses writes until a real plan (a done note or a note without steps does
  not count), lets reads and checks through, persists `planned`, and is
  absent without the pin; the fixture catalog carries the focus, the pins,
  the eight and the persona paragraph; a bad focus is refused; the picker
  limit and the worker pick's inputs.

Expected: Konrad's tool definitions fall from about 43k to about 30k Claude
tokens per call (to be measured), one `update_workpad` call more per job,
and fewer tool-list changes in Bob's turns. Publication order: both runtimes
first (older code ignores the new flags), then the migration.

<a id="publication-492-2026-11-06"></a>
#### Hosted publication of #492 (B) — 2026-11-06, 23:55 UTC

- #492 is merged at `46152aa6a61530bd420b1dccba17d387f6671aec`; its tree
  `8f65ca86334c97e1614aca8796ed3afc77d73221` equals the tested branch tree.
  Safety branch `save/bob-before-tool-focus-2026-11-06` retains the previous
  published source `086915d036592fea6c5030df23516f91a7358223` (A).
- Preflight: zero active Bob jobs; the running bundles were the 23:43 ones
  (bob-worker v211, ask-bob v243).
- Published from the merged checkout (Supabase CLI 2.117.0, `--use-api`,
  worker first), before the catalog change:

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 212 | 150 | Existing private job capability, JWT false | `7ac04299a47b0e165658535bd04f98743330c3d40186d54c18ef8909c51de3ae` |
| ask-bob | 244 | 152 | JWT true | `738d0b4b00aacb94602adf467bd61f81afa08a87c7f379bab8e30cb5dec8feda` |

  Returned sources match the merged checkout byte for byte except the known
  type-only `cad-intake.ts` erasure; both bundles contain the focus and plan
  pins and the worker pick.
- Catalog: `20261107000000_bob_tool_focus_catalog.sql` applied through the
  management API as ledger version `20261106235617` (`bob_tool_focus_catalog`).
  Active afterwards: `bob.tools` v51 (focus present, `worker_focus_version`
  1), `agent-contract.ask-bob` v27 (`worker_focus_version` 1,
  `worker_plan_version` 1, `tool_pick_limit` 8), `schema.bob_tool_pick` v3,
  `tool-picker.contract` v2, `structure-worker.persona` v5 (plan paragraph
  read back), all `bob-tool-focus-v1`. Zero active jobs after. No frontend
  publication.

Remaining: the owner's own project turns. Read back per role: Konrad's
offered tool count (expect 11–12 plus the two continuation tools instead
of 25), start input, `plan_required` rejections and the `update_workpad`
note before his first write, cache share and cost against the
[table above](#cache-points-2026-11-06); Bob's picked count and
`describe_tool` loads per turn.

<a id="locked-paths-2026-11-07"></a>
## Locked paths: the server rules that steer the models — 2026-11-07

Owner question 2026-11-07: have we built "låsta vägar och hårdkodat
beteende"? Two read-only code inventories (Bob's loop and tool session;
workers, construction, writes, drawing) and the hand-over data since
2026-11-02. Nothing was changed.

**Inventory.** Bob's loop and session: 111 rules (35 refuse/defer/ignore,
14 forced order, 27 caps or surface closing, 17 changes to the offered
tools, 18 turn endings, nudges and injected notes). Workers, construction,
writes and drawing: 185 (97 refusals, about 60 of them fixed refusal texts
in the writer's error mapping; 21 forced orders; 37 caps and early job
endings; 15 tool-offer rules; 15 injected notes). Three kinds:

- *Fences* (authority and integrity): server-owned identities, exact
  revisions, request quotes, `human_text`, schema checks, access checks,
  the write-uncertain stop, budgets. Right to keep; the model cannot
  negotiate them away.
- *Plumbing* (cache and order stability, per-step tool fences, paging,
  size caps). Invisible when they work.
- *Steering* that replaced the model's judgement: the piece-progress family
  (`workerPieceProgressVersion` 1–4: one write per batch, code readback,
  form evidence, bounded facade review, design-review pause), hand-over
  readiness, `failed_earlier_this_turn` and
  `construction_piece_blocked_earlier_this_turn`, the repair role, nudges,
  the completion gate, and this week's plan gate and focus. These are the
  locked paths.

**Measured.** 61 hand-overs to Konrad since 2026-11-02: ok 11, unavailable
21 (mostly the 120 s aborts, now repaired), needs_verification 11,
awaiting_design_review 9, step_budget 6, paused_at_limit 3. Since
2026-11-04, when piece progress v2–v4 went live: **1 ok of 33.** Three
turns ended `needs_verification` three times in a row — Bob re-dispatched
Konrad into the same wall (Bob to the owner, 11-04 12:12: "Jag gav Konrad
uppgiften en tredje gång … Ändå stoppades sparningen på samma sätt som de
två första gångerna"). One turn had five `awaiting_design_review` in a row,
each a new Konrad job of about 59k tokens. On 11-05 16:30 Bob wrote:
"Systemet vill att ditt svar om 3D-vyn med det första fönstret ska vara
sparat ihop med just den vyn. Först då släpper det fram nästa ändring i
stommen. Du har redan svarat i chatten" — the v4 database facade hold
(`construction_piece_attempts`) ignored the owner's chat answer, against
the 2026-10-27 decision ("Ingen särskild godkännandeknapp … Ett tydligt
svar på den visade modellen räcker"). On 11-05 18:48: "systemet stoppar
alla nya försök resten av den här omgången. Det beror på att ändringen
redan har nekats en gång" — the blocked-earlier rule. The specific
`needs_verification` reason is not in `bob.execution_events` (tool and
status only), so which sub-gate fired cannot be read back. Rules that never
fired: the piece boundary deferral and the 8-per-batch deferral (0),
nudges (0), `plan_required` (new). Loops: one run with 17 identical
`operation_identity_is_server_owned` rejections — a fence with no exit.

**Assessment.** The fences are right. The steering layer was added in two
days (2026-11-03/04) as four pinned versions, each answering one incident
("Box run 14", "ten rejected feature saves in Ladan"). Each is defensible
alone; together they make Konrad's path read → one write → readback, check,
form evidence, bounded review → stop → Bob shows → owner answers in chat →
new job → gate on recorded feedback → …, and when one link is missing the
job ends and Bob tries the same wall again. That is what the owner saw.

**Proposal (owner decisions, nothing built).**
1. The owner's chat answer is the review (2026-10-27): retire the v4
   database facade hold for new jobs; keep `awaiting_design_review` only
   when a piece changed visible form, not after every write.
2. `needs_verification` sub-reasons become facts in the tool result Konrad
   can act on in the same job (except a real write conflict), and the
   reason is logged in `execution_events`.
3. `failed_earlier_this_turn` / blocked-earlier apply to the identical
   request only; a changed request may start a new job.
4. Keep the fences; keep the plan gate and focus under measurement.
5. Rule hygiene: one register of steering rules with the incident, the
   metric and a sunset; a new steering rule is published only with a
   measurement (CLAUDE.md: inspect tools, context, execution and results
   before adding behavioural rules).

<a id="worker-gates-2026-11-07"></a>
### Decisions 1–3 built: the chat answer is the review, gate facts in the job, identical-request refusal — 2026-11-07

Owner decision 2026-11-07 ("Ja bygg 1-3"), from the
[locked-paths inventory](#locked-paths-2026-11-07).

**Owner turns the same morning (published A and B, before 1–3).** Bed
05:27–05:31 UTC (run `c85ddb10`, USD 1.46, 4 saved): Konrad got 14 tools
instead of 25, wrote his plan first, and the cache held across compaction
(Konrad cache 80 %, Bob 89 %); his part edit was refused with
`construction_source_refresh_blocked`, the job ended `needs_verification`,
and Bob's two further hand-overs were refused at once
(`construction_piece_blocked_earlier_this_turn`). Bed again 05:47–05:50 (run
`5294d293`, USD 1.27): the same refusal and the same lock; Bob told the
owner "Sedan spärrade systemet alla ändringar av konstruktionen resten av
omgången". The bed solution reads `ready` at target 17 when read as the
owner afterwards, so the refusal concerned the revision or form scope Konrad
sent; its issues are not logged. Entry 05:28– (run `68e22a5e`, still running
at 05:51): Konrad's step 5 was cut at 120 s as `model_output_window`, the
next step with the note succeeded and read 90,896 cached tokens; compaction
steps read the fixed points (62,526 and 82,833 instead of 0); Bob then had
five `compact_design_intent_required` and two `edit_path_unsupported`
refusals on `edit_project_record`.

**Correction (source; not yet published).**

- *Pin.* `agent-contract.ask-bob` gets `worker_gates_version: 1`
  (`20261107070100_bob_worker_gates_catalog.sql`, publication
  `bob-worker-gates-v1`); new checkpointed, claimed jobs with `workpad_version`
  1 pin `workerGatesVersion: 1`. Older jobs and manifests change nothing.
- *1, the chat answer is the review.* Under the pin Konrad is not stopped
  after every saved piece (`pauseForDesignReview` is not passed); Bob shows
  the saved result and the owner answers in chat, as decided 2026-10-27. The
  database facade hold existed only for "Bygga liten lada";
  `20261107070000_retire_lada_facade_piece_policy.sql` removes that
  project's piece policy, its four facade envelopes and its one open attempt
  (revision 5, front, `awaiting_review` since 2026-11-04), with exact-state
  guards and the removed values recorded in the file. The existing trigger
  then returns early and the progress read answers `not_configured`, as for
  every other project. No construction, solution, plan, task or feedback row
  changes.
- *2, gate findings are facts.* Under the pin an open piece verification
  (readback, check, form scope or evidence, local check) is added to the
  tool result as `piece_open {reason, saved: true, approval_not_implied:
  true, note}` and Konrad continues; a rejected piece write is returned to
  him as its normal `conflict` result instead of ending the job, also after a
  resume. Every receipt still reaches Bob. A stopped hand-over
  (`needs_verification`, `awaiting_design_review`, `unavailable`,
  `not_started`) now logs its reason as the rejection code in
  `bob.execution_events` (telemetry only, always on).
- *3, identical request only.* Under the pin the per-turn latches
  (`failed_earlier_this_turn`, `construction_piece_blocked_earlier_this_turn`)
  are keyed by the worker and an FNV-1a fingerprint of Bob's request
  (`structure_r_<16 hex>`), so Bob may start a new job after changing the
  source or the request; the identical request is still refused without a
  model call.
- *Tests.* `bob-worker-piece-progress`: an open form scope is a fact and
  Konrad continues with both receipts; a rejected v4 write is returned to
  him, also on resume. `bob-worker-checkpoint`: the identical failed request
  is refused, a changed one dispatches a second Konrad job, the latch is the
  fingerprinted key. `bob-worker-focus`: the pin is published; the
  fingerprint is stable and differs for changed text or findings.

**Publication note.** `main` also carries #490 (another session; chat
notices) with Edge changes in `ask-openai.ts`, `delivery-language.ts`,
`drawing-resume-reply.ts`, `project-turn.ts` and an unapplied migration
`20261106233000_bob_failure_notice_marker.sql`. Publishing the runtimes from
`main` publishes those changes too; the owner decides whether #490's
migration is applied in the same publication.

<a id="publication-494-2026-11-07"></a>
#### Hosted publication of #494 (with #490) — 2026-11-07, 06:08 UTC

The owner authorized publication after the entry turn ("Ja, publicera när
entrén är klar"); the entry turn ended 05:56 (28 min, 12 saved records).

- #494 is merged at `edbf3e1f904dda6179124882fdd27b8d4e68d502`; its tree
  `c64f3326d015daf0be85ade463ebeb316d0e35bb` equals the tested branch tree,
  which includes #490 (another session's chat-notice change, merged by the
  owner 05:30 UTC). Its focused tests pass except
  `bob-write-runtime` #13, which fails identically before #490. Safety
  branch `save/bob-before-worker-gates-2026-11-07` retains the previous
  published source `46152aa6a61530bd420b1dccba17d387f6671aec`.
- Preflight: zero active Bob jobs; running bundles bob-worker v212, ask-bob
  v244.
- Published from the merged checkout (Supabase CLI 2.117.0, `--use-api`,
  worker first):

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 213 | 150 | Existing private job capability, JWT false | `c7ccc1e4ed3b82ef116f2974785004ecc366e4e790b6ac7ea01ceaf674c0c936` |
| ask-bob | 245 | 152 | JWT true | `cbaa997cc74242a4ea6ed4aefb95534472ebc72335ab153092f8e5d676e0b019` |

  Returned sources match the merged checkout byte for byte except the known
  type-only `cad-intake.ts` erasure; both bundles contain the worker-gates
  pin, `piece_open`, the request fingerprint and #490's notice marker.
- Migrations, applied through the management API after the runtimes, in
  order: `20261106233000_bob_failure_notice_marker.sql` (#490; its preflight
  hash matched) as ledger `20261107060758`;
  `20261107070000_retire_lada_facade_piece_policy.sql` as `20261107060759`
  (piece policies, scopes and attempts now 0);
  `20261107070100_bob_worker_gates_catalog.sql` as `20261107060801`
  (`agent-contract.ask-bob` v28, `worker_gates_version` 1,
  `bob-worker-gates-v1`). Zero active jobs after. The frontend part of #490
  reaches users on the owner's next site publication.

Remaining: ordinary bed and entry turns read back Konrad's hand-over
outcomes (`ok` share, logged stop reasons, `piece_open` facts) against the
[locked-paths data](#locked-paths-2026-11-07).

<a id="why-bob-stops-2026-11-07"></a>
## Why Bob stands still — 2026-11-07

Owner question 2026-11-07: "Varför stoppas bob?" Read from the unified
Edge log table (`logs`, management API `analytics/endpoints/logs`; the old
`logs.all` endpoint and the `function_logs` source no longer exist), the
execution events and the usage ledger. Nothing was changed.

**Entry turn 05:28–05:56 UTC (28 min, 12 saved records).** About half of
the wall time was spent waiting, for two reasons:

| Cause | When | Lost |
|---|---|---|
| Edge "CPU Time exceeded": the segment's isolate is killed mid-work; the job stays `running` until the lease runs out and the one-minute cron (`bob-background-turns`) re-dispatches it | 05:29:05 → 05:31:20, 05:43:32 → 05:46:02, 05:46:41 → 05:48:48 | ≈ 7 min |
| Claude window: Konrad, at 90–98k input tokens, still writing (1,837 and 1,970 stream events) when our 120 s deadline closed | 05:33:20–05:35:20, 05:49:37–05:51:37, 05:51:59–05:53:59, 05:54:03–05:56:03 | ≈ 8 min |

The first window cut was repaired by the note (the next step succeeded and
read the cut call's cache); the last three came in a row, and after the
third the hand-over ended `unavailable`. CPU kills over the last days:
9 on 2026-11-05, 13 on 2026-11-06, 3 this morning — older than this week's
changes.

**What costs CPU in a segment** (local benchmarks on this machine; the Edge
isolate is slower, and its CPU budget per request is small):

- every step commits the whole turn checkpoint: today 460–800 kB of state
  (`components.contextContinuation` alone 235–451 kB), logged up to five
  times within two seconds; one commit (stable key sort, two to three full
  serialisations, size breakdown, two clones) took 5.5 ms for 460 kB here;
- token counting of the native context: about 20 ms per 290 kB;
- the tool-schema deduplication published on 2026-11-06: about 27 ms for
  Konrad's 24 tools on every call, recomputed each time although the
  schemas do not change within a job.

**Proposals (owner decision, nothing built).**
1. Compute each tool's deduplicated schema once per bound schema (memo by
   identity); expected saving about 27 ms per Konrad call.
2. Checkpoint less work per step: skip the size breakdown unless the size
   crosses the limit, serialise once and reuse the text, and keep chains
   out of the state where the provider-neutral archive already holds them.
3. Recover a killed segment at once: a shorter lease with a heartbeat, so a
   killed job is re-dispatched by the next cron tick instead of after the
   whole lease.
4. Konrad's large writes: the plan gate now makes him plan; the next step
   is to let his plan's steps bound each write (one opening or one wall per
   call), so a single answer fits the window — or, if the project's plan
   allows a longer wall clock, raise the Claude window.

<a id="numbers-and-field-rules-2026-11-07"></a>
## Numbers between roles and field rules before the call — 2026-11-07

Owner direction 2026-11-07, after the locked-paths inventory ("where we were
too hard and steering we were probably too loose with the numbers"):

- **A.** Bob and the team do not write numbers to each other; numbers go
  through variables and reads, never AI-invented.
- **B.** Bob and the team know a field's rules before the call: how it is
  linked to other fields and which values are allowed.

Two read-only code inventories; nothing was changed.

### A — where numbers cross

Already right (22 patterns): request quotes filled by the server; worker
receipts, readback and checks by code; worker knowledge reads; ids and
revisions bound by the server for workers; the parameter graph (`source`
nodes read the measurement, `derived` nodes compute exactly, every
controlling number must be bound, rounding reported); concept measurements
bound by reference; lists, cut layouts, requirement quantities and pack
counts derived by the server; the calculator; echo checks against saved
fastener schedules and sheet formats; tool repair cannot change a value.

Gaps where an AI-typed number reaches another role or saved truth
unchecked (16):

1. Bob's hand-over `request` (2000 chars): "leave ids, measurements and other
   values out" is tool prose only; code checks length.
2. Workers receive Bob's earlier chat answers and AI summaries word for word.
3. A worker's report prose is never compared with the code readback.
4. Stage-handoff observations and compactor summaries replace raw tool
   output in the active context.
5. Workpad notes carry numbers across jobs.
6. `decision`/`estimate` parameter and concept values become geometry with
   only a free-text reason.
7. Unbinding a concept measurement leaves the copied number as an editable
   estimate.
8. Measurement `value` and `truth: measured` are model-chosen; the quote
   check does not check the number.
9. Fastener sizes, counts and spacing are literals; `add_catalog_fastener`
   saves Konrad's typed sizes as `provided_spec`.
10. Material numbers: stock quantity and format, manual requirement
    quantities, waste, allocations, pack size, catalog properties.
11. Hypothetical cut sheets, kerf and trim, with a self-declared basis.
12. Older geometry writers (storage box, stair, building plan, room layout,
    shell) save literals; linked measurements do not drive them.
13. Numbers in saved prose (titles, descriptions, notes, plan text) pass the
    human-text check and reach drawings and CAD requirements.
14. The source reader's `statement` is not checked against its quote.
15. Tool repair checks values as a set, so width ↔ depth swaps pass.
16. Bob types revisions (rejected when stale, so not truth).

### B — rules known before the call

The model sees the bound schema and description; the manual only once the
tool is loaded. Ranked gaps behind repeated refusals:

1. **`compact_design_intent_required`** (edit_project_record,
   create/select solution): after the save the database re-reads the whole
   record (text, ids, the whole design_intent with the concept model, up to
   25 linked measurements) and requires ≤ 30,000 bytes. Not stated
   anywhere, no size is reported, and for the `bound_*` payload kinds the
   refusal falls through to the generic "The database rejected this
   command" without the limit or a remedy (`project-write.ts:432` matches
   only `solution`/`target`). Five refusals in this morning's entry turn.
2. **edit_project_record path grammar** (`edit_path_unsupported`): `path` is
   a free string; allowed paths, per-item editable fields, "no remove on a
   field", and where references and measurements are edited instead, are
   partly prose and not in the schema; the coherent read lists section names
   that are not paths.
3. **Construction `target_revision` / readiness coupling**
   (`construction_source_refresh_blocked`, `target_revision_required`):
   readiness preconditions are not in the tool text; behind both bed
   lock-ups this morning.
4. **Design-intent limits and choice status coupling**
   (`edit_design_inconsistent`): summary 1–2000, feature ≤1000, choices'
   alternatives/recommendation/basis/consequences/decision_basis rules,
   counts 24/16/8, 48,000 bytes; exist in `DESIGN_INTENT_SCHEMA` but not in
   this tool's schema; the refusal names no field.
5. Construction preparation refusals collapse to
   `*_preparation_failed`; the database code and path are dropped.
6. Work records: value format (decimal string, ≤3 decimals, ≤1,000,000),
   truth ↔ value ↔ source coupling, unit and truth enums missing in the v2
   schema, the date rule; the refusal names no field.
7. `derive_cad_material_requirement`: `data` is an untyped object; modes,
   fastener keys and couplings live in prose or the manual.
8. The human-text rule (no ids, codes, "revision N" in prose) is stated in
   no tool description.
9. save_construction_draft create/revise revision coupling, area coupling
   and exact concept mapping.
10. add_catalog_fastener counting ↔ size couplings; what counts as a plan
    for the plan gate.

### Proposal (owner decisions; nothing built)

**A — numbers travel as references.**
- A1 Hand-overs and reports carry no physical numbers: the server refuses a
  hand-over `request` that contains a dimension or quantity (number with
  unit, or a number of two or more digits) with a code-named refusal and
  points to the record to name instead; a worker report's numbers are
  replaced by the code readback Bob already receives.
- A2 Every physical number in saved truth has a basis the server can
  follow: a measurement (by id/revision), a computation (derived node or
  calculator), or an owner decision quoted from the conversation; a free
  `decision`/`estimate` stays allowed but is labelled `ai_estimate` so it is
  never shown or used as measured. Measurement values marked `measured` or
  `provided_spec` must appear in their source quote.
- A3 Catalog fasteners Konrad adds are saved as `design_choice`, not
  `provided_spec`.

**B — rules before the call, generated from the validators.**
- B1 Every refusal names the field, the rule and the limit (first: the
  30 kB readback for the `bound_*` kinds, construction preparation codes,
  work-record field messages).
- B2 The read before a write returns the budget and the paths:
  `read_project_edit_context` reports the record's readback size against
  30,000 bytes and the editable paths and item fields.
- B3 Each write tool's schema and description are generated from the same
  parser that validates it (lengths, enums, patterns, counts, couplings), so
  a rule cannot exist only after the call; a test compares them.

<a id="publication-496-2026-11-07"></a>
#### Hosted publication of #496 (sketchbook A and B) — 2026-11-07, 08:55 UTC

The owner approved the design ("Ja kör på rek!") and then publication
("Applicera allt tack"). Design and build:
[sketchbook](bob-sketchbook-design-2026-11-07.md#6-built-2026-11-07).

- #496 is merged at `2fa3cd30348a21868a8b41a8094cb8a666b1e859`; its tree
  `ee17431cc3afcf73c38227c54f774a87da65de0a` equals the tested branch tree.
  Safety branch `save/bob-before-sketchbook-2026-11-07` retains the previous
  published source `edbf3e1f904dda6179124882fdd27b8d4e68d502`.
- Preflight: zero active Bob jobs, no delivery since 06:10; running bundles
  bob-worker v213, ask-bob v245.
- Published from the merged checkout (Supabase CLI 2.117.0, `--use-api`,
  worker first):

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 214 | 150 | Existing private job capability, JWT false | `8a0e75ae3aead88fa0a521825d2878307e1ee29c89107379c0e5dc0197ffa823` |
| ask-bob | 246 | 152 | JWT true | `73e66ded656f6ca9afed9fd90b1adced03711243b166277d21caa7aaebff47e3` |

  Returned sources match the merged checkout byte for byte except the known
  type-only `cad-intake.ts` erasure; both bundles contain the sketch pin, the
  commit tool, the write-check call and the open-sketch report.
- Migrations, applied through the management API after the runtimes, in
  order: `20261107080000_bob_project_write_check.sql` as ledger
  `20261107085546`; `20261107080100_bob_write_check_catalog.sql` as
  `20261107085547`; `20261107090000_construction_sketches.sql` as
  `20261107085549`; `20261107090100_bob_construction_sketch_catalog.sql` as
  `20261107085551`.
- Read back: `bob.bob_project_write_check` and `bob.construction_sketch`
  executable by `authenticated` only (not anon, not service role); the sketch
  table has RLS on and 0 rows; the finished-job trigger exists. Active
  catalog: `agent-contract.ask-bob` v30 with `write_check_version` 1 and
  `construction_sketch_version` 1; `bob.tools` v52 with the commit tool in
  Konrad's core focus; `tools.edit_construction_parts` v10,
  `tools.commit_construction_sketch` v1, `tools.edit_project_record` v11;
  policy row `commit_construction_sketch` schema 1, active. The three live
  tool definitions equal the tested catalog fixture (definition and
  metadata). Zero active jobs after.

Remaining: ordinary owner turns read back whether Konrad sketches and commits
once per assignment (revisions and change sets per assignment, `sketched` vs
`saved` calls, `open_sketches` at hand-over) and whether Bob uses
`mode: check` before a large solution save.

<a id="versions-and-cost-2026-11-07"></a>
## Versions and cost of the bed and entry turns — 2026-11-07

Owner, 2026-11-07, after the first turns with the sketchbook: "Konrad får inte
bestämma vilken version … det ska lösas via versionshanteringen i databasen.
Dom ska alltid få senaste versionen" and "Det här är väldigt dyrt … hur gör vi
det 1. bättre och 2. billigare." Investigation only; nothing built here.

**The two turns (08:59–09:31 UTC).** Bed: 9 min, USD 4.83, nothing saved.
Entry: 30 min, USD 4.65 recorded, one solution saved (after three
`mode: check` refusals for the 30 kB readback and one passing check: design A
worked), no construction saved. Konrad did not use the sketch in either turn.

### Versions typed by models

- **Inventory (published schemas).** About 60 tools take a version from the
  model: `expected_revision` (about 30, the optimistic-concurrency guard),
  source pins (`target_revision`, `material_revision`, `part_revision`,
  measurement `source.revision`, `plan_revision`, `construction_revision`,
  `child_revision`, …) and read/check `revision`. Server-issued handles already
  exist and work: the Solution `edit_ref`, `next_ref`, and for Konrad the
  worker-operation refs (`source_ref: op_…`), which hide `record_id` and
  `expected_revision` on his construction writes.
- **The gap that stopped the bed.** `target_revision` is still typed by
  Konrad. He sent the construction's revision (20) where the selected target's
  revision (15) belongs, four times across two hand-overs; the refusal said
  "The selected target changed. Read the current Project/Area target", which
  was not true and did not name 15. Since 2026-11-02 about one refusal in five
  concerns a version (`construction_source_refresh_blocked` 7,
  `construction_edit_preparation_failed` 5, `target_revision_required` 1,
  `parameter_source_changed` 1, plus unlabelled conflicts).
- **Best practice.** Optimistic concurrency stays, but the version travels
  with a server-issued handle from the read the change is based on, never as
  a number the model copies. Source pins default to the current revision,
  bound by the server at save; a pin the owner chose to hold is a stored
  decision, not a model input. Deltas by stable id (the construction edit) can
  be applied to the current head when the touched ids did not change since the
  read, and are refused by id when they did.

### Where the money went (recorded USD 9.48)

| Bucket | USD | Share |
|---|---:|---:|
| Input not read from cache | 5.17 | 55 % |
| — of which calls with no cache at all (job starts and two full misses) | 2.40 | |
| — of which partial misses of 30k+ tokens mid-job | 0.80 | |
| Input read from cache (10 % price) | 2.05 | 22 % |
| Output | 2.21 | 23 % |

Konrad is 69 % (USD 6.53), Bob 30 %; the picker, gate, memory and finder
roles together USD 0.15. Both main roles run on the standard tier
(`claude-opus-5-5`, USD 4 / 20 per million input / output). Seven entry calls
that hit the 120 s output window are recorded without a price; their real
cost is unknown and not included.

**Causes found.**

1. *The tool list changes inside a job.* The worker-operation refs are an
   `enum` inside the tool schemas; every read that lists another construction
   or revision adds a ref, which changes the tools block, the first thing Claude
   caches, so the next call is paid in full (bed steps 14 and 22: 95k and 77k
   tokens, no cache, USD 0.68). The same per-job enum keeps each new Konrad
   job from reading the tools and system prompt cached by the previous job
   (each Konrad job start paid 46–60k tokens uncached, USD 0.19–0.32).
2. *Calls that produce nothing.* Bed: 6 refused plan notes (JSON text, fixed
   in #498), 4 version refusals, 3 human-text refusals, 13 construction reads,
   two hand-overs. Entry: 7 output-window aborts (a new wall is one call too
   large for 120 s; the sketch covers only existing constructions), 2
   concept refusals.
3. *Context per call.* Konrad sends 48–117k tokens per call; each step adds
   5–15k new tokens (read results), paid uncached once and cached afterwards.

### Proposals (owner decision)

1. **Server-bound versions** (better and cheaper): no revision numbers in
   Konrad's tools. The server edits the current head and binds the current
   selected target at save after the readiness check; a refusal names what is
   not ready. Then the same for Bob's `expected_revision` tools, through the
   existing handle pattern.
2. **Stable tool schemas** (cheaper): validate operation refs on the server
   and list the current refs in the tool result, not as an `enum` in the
   schema; tools and system prompt then stay cached through a job and from one
   Konrad job to the next.
3. **New constructions in small steps** (better and cheaper): a sketch can
   start a new construction; Konrad adds parts in small calls and saves once,
   so no single answer has to fit 120 s.
4. **Cheaper model for Konrad, tested** (cheaper, quality risk):
   `claude-sonnet-5-5` is half the price per token; one bed and one entry turn
   would show whether his geometry holds.

<a id="lean-writes-2026-11-07"></a>
### Built: proposals 1–3 — 2026-11-07

Owner, 2026-11-07: "1. Ja 2. ja 3. Ja 4. Nej, kör opus för for now." Built and
tested locally in #498; **not deployed, not applied, not owner-run.** New
claimed jobs adopt the pins from publication `bob-lean-writes-v1`
(`20261107100100_bob_lean_writes_catalog.sql`, after
`20261107100000_construction_new_sketches.sql`); pinned manifests keep their
behaviour. Konrad and Bob stay on `claude-opus-5-5`.

1. **Server-bound target (`server_target_version 1`).** `save_construction_draft`,
   `edit_construction_parts` and `change_construction_parameters` no longer
   take `target_revision`, for Konrad or Bob. A save uses the current selected
   target of its area. An edit whose construction is behind the current
   target is bound to it on the server and retried once; the readiness check
   still applies and its issues are returned. A changed measurement is named
   as such instead of as a changed target. A sent `target_revision` is refused
   as an unknown field. `commit_construction_sketch` is bound to the job's
   construction like the part edits (`record_id` hidden, `source_ref`).
2. **Stable tool schemas (`stable_tools_version 1`).** Operation reference
   fields are a fixed pattern checked by the server, present whether or not
   the job is bound; a refused reference returns the current ones. Konrad's
   core tools and workpad come first in catalog focus order, with a Claude
   cache point after them (three of four points: core tools, system, tail),
   so a new Konrad job reads them from cache.
3. **New constructions in parts (`construction_sketch_version 2`).**
   `save_construction_draft` takes `mode: sketch | save`. Sketch calls under one
   key are merged by id (definitions, parts, nodes, bindings, materials,
   joints, roles; header fields and question lists from the latest call),
   checked whole through the same save preparation, and stored in
   `bob_private.construction_new_sketches` (same claim and cleanup rules as
   the existing-construction sketches). `commit_construction_sketch` with
   `new_key` saves it once as revision 1, with the target current at the
   commit, and places it in its sub-build. A part cannot be removed from a new
   sketch; discard and sketch again.

Also in #498: a plan note sent as JSON text is accepted, and a refused note
names its bounds; project-edits now expects the `mode` field that
`bob-write-check-v1` added (missed when design A was built).

**Not covered yet.** Material, part and fastener revisions and measurement
source revisions are still typed by Konrad, and about 30 of Bob's tools still
take `expected_revision`; these are the second step of proposal 1.

<a id="server-revisions-2026-11-07"></a>
### Built: no revision typed by a model, stepwise sketches, refusal guard — 2026-11-07

Owner, 2026-11-07: "fixar dom sista findingsen där också, Konrad och bob med
versionsnummer", then an external review of #498 (priorities: stepwise
construction, stop refusal loops, server-owned versions, correct tool
contracts, stable cache, cost measurement, end-to-end scenarios). Built and
tested locally in #498; not deployed or applied.

- **Server revisions (`server_revisions_version 1`).** A code map
  (`server-revisions.ts`) names each revision field of 31 write tools and the
  record it belongs to. The model never sees the field; a value it sends is
  dropped; the server fills it: catalog items, measurements, space
  measurements and constructions from their current revision, the plan and
  the selected target from their readers, other records from the newest
  revision the model read in the request (kept with a paused job; an unread
  record is refused with "read first"). A worker job's identity fields
  (`derive_cad_material_requirement` data pins, `expected_revision`) are
  dropped before its binding checks the call instead of refused (18 refusals
  since 2026-10-25). Left as model input: reads that choose a historical
  revision, `continue_construction_change.output_revision`,
  `edit_project_room_layout.source_revisions` (no ids beside them) and tools
  whose identities the worker binding already owns.
- **Stepwise sketches.** While a new construction is sketched, a concept
  component not built yet (`concept_part_missing`) or filled only partly
  (`form_envelope_incomplete`, parts inside its envelope) is returned as
  `pending`; geometry outside the concept is still refused; the save applies
  the full rule.
- **Refusal guard (`refusal_guard_version 1`).** An `invalid` call refused
  earlier in the request does not run again unchanged (`repeated_refusal`);
  the third refusal for one reason carries a note to change approach.
  Refusals that depend on project state (read first, a changed source, a
  missing plan) still run again.

**Scenarios (owner review, before merge).** *Entrén* (stepwise from a
multi-component concept): PGlite, a frame sketched rail by rail is pending,
an outside rail and an early save are refused, the finished frame saves once
on the current target. *Fellopp*: a repeated refused call is not run, the
third refusal carries the note, state-dependent refusals still run, a paused
job keeps both memories. *Våningssäng 2* (change a detail, save, updated
drawing) needs a live turn after publication.

**Cost measurement.** Aborted calls are in the ledger with their input
tokens and no price (unknown, not zero). The turn budget counts only priced
calls, so it undercounts aborts; no spending stop is set in the live catalog
(`turn_usd_stop` empty, `work_allowance_version` 1).

**Review of #498 (2026-11-07), two corrections.** (1) The tools sent to the
model are rebuilt from the catalog by name just before each model call
(`applyCatalogModelOptions`), so removing the revision fields from the
session's list did not reach the model; they are now removed in that rebuild
too (and in Bob's tool sheets), tested down to the Claude request body for
`save_project_measurement` and `edit_construction_parts`. (2) Konrad's plan
gate refuses inside the work loop, outside the session's refusal guard; it
now counts its own refusals and the third asks for a plan in the exact note
shape, tested through the real work loop. Remaining before merge: a live
Våningssäng 2 turn to measure what Bob saves, how many calls are refused and
what the turn costs; aborted Claude calls make the recorded total a lower
bound.

<a id="publication-498-2026-11-07"></a>
#### Hosted publication of #498 (lean writes) — 2026-11-07, 12:55 UTC

Owner, 2026-11-07: "Publicera och så testar vi". Design and build:
[versions and cost](#versions-and-cost-2026-11-07),
[lean writes](#lean-writes-2026-11-07),
[server revisions](#server-revisions-2026-11-07).

- #498 is merged at `363f9f483772d35bb340e37e18d9ce5938293931`; its tree
  `46df896f6bc964b6124e08a4995043f55b4a83a7` equals the tested branch tree.
  Safety branch `save/bob-before-lean-writes-2026-11-07` retains the previous
  published source `c1be61b33dec53d6a7bf1b757e31dd302994fa6e`.
- Preflight: zero active Bob jobs, last delivery 09:30; running bundles
  bob-worker v214, ask-bob v246.
- Published from the merged checkout (Supabase CLI, `--use-api`, worker
  first):

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 215 | 152 | Existing private job capability, JWT false | `55d9113c62f25c33909b6fcb997fe9f23e97cc0e1f7a65f9090ba908b945bdb4` |
| ask-bob | 247 | 154 | JWT true | `55ebb6a53a27feab880aee7c1583df736f12d5484601b88129471bb5f5d6a76a` |

  Returned sources match the merged checkout byte for byte except the known
  type-only `cad-intake.ts` erasure; both bundles contain the server-revision,
  stable-tool and refusal-guard pins, the catalog rebuild strip and the
  new-construction sketch store.
- Migrations, applied through the management API after the runtimes, in
  order: `20261107100000_construction_new_sketches.sql` as ledger
  `20261107125435`; `20261107100100_bob_lean_writes_catalog.sql` as
  `20261107125441`.
- Read back: `bob.construction_new_sketch` executable by `authenticated` only;
  `bob_private.construction_new_sketches` has RLS on and 0 rows; the
  finished-job function drops both sketch tables. Active catalog (publication
  `bob-lean-writes-v1`): `agent-contract.ask-bob` v31 with
  `stable_tools_version`, `server_target_version`, `server_revisions_version`,
  `refusal_guard_version` 1 and `construction_sketch_version` 2; `bob.tools`
  v53 with the same flags and the `commit_construction_sketch` binding
  (`record_id` hidden, nullable `source_ref` when unbound);
  `tools.edit_construction_parts` v11, `tools.change_construction_parameters`
  v12 and `tools.save_construction_draft` v16 without `target_revision`
  (save with `mode: sketch | save`); `tools.commit_construction_sketch` v2 with
  nullable `record_id` and `new_key`. Zero active jobs after.

Remaining: the owner's Våningssäng 2 turn, read back for what Bob and Konrad
save, how many calls are refused (and for which reason), whether the guard's
`repeated` note appears, cache reads per Konrad call, and cost per role.
Aborted Claude calls are recorded without a price, so the recorded total is a
lower bound.

<a id="owner-runs-after-498-2026-11-07"></a>
### First owner turns after #498 — 2026-11-07, 13:39–14:00 UTC

The owner ran Våningssäng 2 (job `4c819180`, 13:39–13:43, delivery
`partial`, 4 records saved by Bob) and Entrén (job `f3a93a7a`, 13:40–14:00,
delivery `saved`; Konrad created `Väggstomme – inbyggd entré` rev 1 and
edited it to rev 2).

| Role | Calls | Recorded USD | Input read from cache |
|---|---:|---:|---:|
| Konrad (structure-worker) | 45 (+7 refused before billing) | 4.42 | 87 % |
| Bob (ask-bob) | 22 | 1.29 | 83 % |
| tool-picker, completion-gate, material-finder | 12 | 0.15 | — |

Recorded total USD 5.86; three Konrad calls cut by the 120 s window carry no
price (their input was 92–99 % cached), so this is a lower bound. Before
#498 the bed turn read 45 % from cache. A Konrad job now starts with 27,883
tokens read from cache (core tools and system shared across jobs).

- **Defect in #498: five cache points.** Seven Konrad calls were refused by
  Claude before billing: `400 A maximum of 4 blocks with cache_control may be
  provided. Found 5.` A compacted job marks system, core tool, job start,
  settled compaction and the automatic tail; the tests covered the core-tool
  point only without the message points. Bob saw `ask_structure_worker
  unavailable` three times in the bed turn and four times in the entry turn.
  Fixed in #500 (published below).
- **Gap: a part added by an edit cannot be mapped to the concept.** Twice
  (13:48, 13:59) a Konrad edit and a sketch commit were refused by the
  database with `form_instance_unmapped` (recorded as `unspecified`; Konrad
  received the writer's FORM message). The construction has an explicit FORM
  mapping, `edit_construction_parts` has no field for it, and a sketch of an
  existing construction is refused in `save_construction_draft`
  (`sketch_existing_construction`), so only a complete save can map a new
  part. Not fixed.
- Other refusals: `human_text` (description), `parameter_unused_node`,
  `edit_path_unsupported` (Bob); each once. No refusal repeated, so the
  guard's `repeated` note did not appear. Konrad sketched once
  (`edit_construction_parts`), wrote three answers above 10,000 output tokens
  and was cut three times by the window.

<a id="publication-500-2026-11-07"></a>
#### Hosted publication of #500 (four cache points) — 2026-11-07, 14:01 UTC

Owner: "Ja, publicera #500". #500 is merged at
`6e4d632f7036fdf9c0b4100ead3c9eacbdc5e22d`; its tree
`4bc3687ddb4165151817965fc1105cd73baf1661` equals the tested branch tree.
Safety branch `save/bob-before-cache-cap-2026-11-07` retains
`951c434d329736ac9e7ef573975296fd8c8cf23b`. Zero active jobs before and
after. No migration.

| Consumer | Version | Files compared | JWT policy | Bundle SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 216 | 152 | Existing private job capability, JWT false | `332ab34acc0b430ee6c00f696ecc53abeea602d6091e26ce9388884fa46e33b3` |
| ask-bob | 248 | 154 | JWT true | `5d014ed87f0821c85c0619cb795a63176a0d57b3be0f326cbb5f5701883d000b` |

Returned sources match the merged checkout byte for byte except the known
type-only `cad-intake.ts` erasure; both bundles contain `capCachePoints`.
Remaining: a new owner turn shows no `cache_control` refusal.

<a id="lean-construction-2026-11-07"></a>
### Built: Konrad writes the construction, code writes what follows — 2026-11-07

Owner, 2026-11-07, after the Entrén turn: five root measures, then "Kör B"
(all in one change) "sen auditar vi det några gånger". Built and tested
locally; not deployed, not applied. Pin: `lean_construction_version` 1 on
`tools.save_construction_draft` (publication `bob-lean-construction-v1`).

**Root cause, measured.** The saved 11-part wall (`d0e2fa57`, rev 1) holds 1,939
characters of geometry, but the save Konrad typed was 26,590 characters
(≈ 8,000 tokens): parameter plan 13,940 (40 nodes, 81 bindings, 27 derived),
joints 6,714 (21 joints), policy 1,447, materials 748, questions 1,058. Typing
that took 75–120 s per answer; three answers were cut by the 120 s window, and
four refusals (`human_text`, `sketch_existing_construction`, twice
`form_instance_unmapped`) threw away whole written payloads of 7,000–10,700
output tokens.

| Measure | What code now does | Source |
|---|---|---|
| 1. Joint rules | One rule per definition pair; code writes a joint for each touching pair without one, faces in local coordinates. Contact alone still declares nothing. | `construction-joint-rules.ts` |
| 2. Formulas | A recipe number may be a formula over node names; code adds `fx.<hash>` derived nodes and bindings. Same stored graph. | `cad-formulas.ts` |
| 3. FORM mapping | Code maps a new part to the component holding it; edits carry the mapping to the database; `form_assign` overrides. | `construction-form.ts`, `20261107150000_…sql` |
| 4. Cost truth | A cut Claude answer is priced from its input and streamed output, `cost_basis = streamed_output_estimate`. | `anthropic-service.ts` |
| 5. Kept payloads | A refused construction write stays in the sketch; corrections are small; commit re-checks text. A saved construction can be revised whole in a keyed sketch. | `construction-draft.ts` |

**Dropped from the proposal, with the numbers.** *Trimming Konrad's own saved
writes from his context* would save under USD 0.10 per job: an 8,000-token
write read from cache costs about USD 0.003 per later call; measures 1 and 2
shrink the writes themselves. *Separate thinking tokens* cannot be measured:
Claude reports one output count, and thinking streams as a summary.

**Size.** The two tool schemas grow from 27.8 to 37.3 kB (save) and 32.5 to
41.5 kB (edit), mostly the formula alternative repeated at each number field;
dispatch sends repeated sub-schemas once as `$defs` (`tool_schema_dedup`), and
the schemas are read from cache within a job. The expected write for the same
wall is about a third of the former 26,590 characters (formulas instead of 81
bindings and 27 nodes; two rules instead of 21 joints); measured only after a
live turn.

**Verification (local, focused).** `lean-construction-units` 6/6 (formula
graph, refusals by path, negative values and repeat spacing, edit upserts and
unused formula nodes, rule joints accepted by the check, FORM mapping), and
`lean-construction` 4/4 against the database: a frame saved with formulas and
one rule; a part added by an edit, with its joints and mapping (the edit refused
live at 13:48 and 13:59); a refused edit kept and corrected in the sketch,
refused text re-checked at commit; a refused new save kept by key, and a saved
construction revised whole by key. `construction-sketch` 12/12 asserts that code
validates exactly the published schemas with the production pins.
`anthropic-service` 11/11 (cut answers priced). Five suites fail identically on
`main`.

**Owner review the same day (external review relayed by the owner), applied.**
(1) Joints are not only geometry: a rule is Konrad's decision per definition
pair, `except` leaves touching pairs unjoined, and the answer lists every joint
code wrote (`rule_joints`). (2) Formulas must not change the model: a test
compiles the same wall in the old hand-written format and with formulas and
asserts identical geometry, bindings and values, and identical geometry after
the same measure change through the `change_construction_parameters` compiler.
(3) The size and time gain is a hypothesis until measured. (4) Code maps a part
to a concept component only when exactly one holds it. (5) Only writing errors
(text, formula, joint rule) are kept in the sketch, never construction errors.

**Audit 3, offline on the real wall (no model call).** The saved entry wall
(`d0e2fa57` rev 1) rewritten in the lean format by script: every bound field
as the formula of its node, code zero bindings as 0, one rule per definition
pair. Compact JSON as the model would type it, without server-added fields:

| | Old | Lean |
|---|---:|---:|
| Characters | 20,651 | 9,808 (−52 %) |
| Tokens (Bob's counter, approximate for Claude) | 6,495 | 3,245 (−50 %) |
| Parameter plan | 9,144 (40 nodes, 81 bindings) | 1,579 (12 declared nodes) |
| Joints | 5,854 (21 joints) | 1,561 (7 rules) |
| Recipe | 1,680 | 2,759 (formulas in place of numbers) |

The lean wall compiles to byte-identical geometry, and the 7 rules write
exactly the 21 joints of the original (none missing, none extra). One rule
(plate–stud) carries one reason where the original had six (corner, king and
end stud, top and bottom); a different reason per joint needs explicit joints.
Still typed per part: instance roles (1,357) and open questions (1,053). The
earlier forecast of about 2,500 tokens was optimistic; time per answer is
measured only live.

**Audit round 1 (three independent reviewers: formulas; sketches and the
database; joints, FORM and cost), 32 findings, fixed the same day.**

| Area | Found | Now |
|---|---|---|
| Formulas | Removing a part placed by formula failed (`parameter_path_missing`): code's bindings stayed | Bindings for a part that is gone go with it, then unused formula and zero nodes |
| | A hand-made `fx.` node could change what a formula means | An `fx.` name must be the hash of what it computes; a copied code node is accepted unchanged |
| | Placeholders failed recipe rules (a tube's diameter) | Fields get their real values from the graph before the recipe is checked |
| | A number where code computes the field was silently replaced | Refused, naming the field, its node and the computed value |
| | Unary minus, units per field, unknown names, edit conflicts | Leading minus negates the product; wrong unit and unknown names named by field |
| Sketches | A keyed sketch could be committed onto another construction, or over a newer revision | A keyed sketch keeps the construction and revision of its first call; the commit is checked against that revision |
| | A kept text could block rebase; a refused edit's sketch stayed open after the fix saved | Text is checked at commit only; a sketch begun only to keep a refused direct change is dropped when a change saves |
| | Formula errors in part edits were never kept | Edit sketches keep what was written; formulas compile at each check |
| Joints and FORM | The sketch check used hand joints and the unextended mapping | It checks what the commit would save |
| | Existing touching parts stayed unjoined; a moved part kept a stale code joint | Existing pairs get a joint with nothing fastened; code joints follow their parts or go |
| | A rule alone could not join saved parts | A rule-only edit writes the joints it finds |
| Cost | The estimate reached the ledger but not the turn budget; it was also written for network errors | The budget and events see it; only our own deadline cuts are estimated, and an unknown input stays unknown |

Not changed: `form_assign` only with a part change (the database refuses an
edit with no change). Tests: `lean-construction-units` 10/10,
`lean-construction` 7/7.

**Audit round 2 (two reviewers: the round-1 fixes, and a fresh read of the
whole diff), fixed the same day.** Round 1's fixes held; these were new or
not yet whole.

| Area | Found | Now |
|---|---|---|
| Formulas | A binding to a mistyped path was dropped without a word | Refused as `binding_path_unknown`, naming each path (save and edit) |
| | A part sent again with its saved number after its node changed was refused | The saved number is accepted and computed anew; only a new number where code computes the field is refused, and hand bindings are not checked as formulas |
| | `w * w` passed until the evaluator; a formula and a binding for one path conflicted | Unit rules are checked at compile and named by field; a formula replaces a binding for its path |
| | A strict schema pattern refused a mistyped formula as a wrong type, so it was never kept | Any short text is accepted by the schema; the compiler names it and the sketch keeps it |
| Sketches | A refused edit's shadow sketch was dropped by any saved edit | Dropped only when a saved change covers it; otherwise the answer names it as open |
| | A refused direct edit was merged into ordinary open sketch work | Kept only when no sketch is open |
| | Rules and assignments piled up across sketch calls, also for removed definitions and parts | Filtered when their definitions or parts go |
| Joints | An `except` from the save was forgotten by the next part edit | A part edit joins only parts it adds or changes |
| | Existing pairs got a joint with nothing fastened | The rule applies as declared; `except` is where it does not |
| | A part turned into a cut or other shape lost its code joints | A code joint goes only when its parts are gone, or both are still boxes and no longer touch |
| | A rule-only edit did not say what it wrote | It lists `rule_joints` |
| Removal | Removing a part left its role and joints, so the edit was refused | Its role, joints, bindings, formula nodes and a removed definition's material go with it, and the answer lists them; a node Konrad wrote stays until he removes it, since a decided value is not dropped unseen |
| Roles | Every role needed `quantity_policy`; a repeat needed one entry per copy | `quantity_policy` follows from the role; a repeat's copies take the role given for its id |
| Cost | The cut-answer estimate was read as a drawing's reserved cost, so drawing reservations settled early | The failure carries `costEstimate`; reservations stay pending until a real price is known |

Tests: `lean-construction-units` 10/10, `lean-construction` 10/10; 55
focused files 415/420. The five failures are catalog-parity tests that fail
identically on `main` (`ai-catalog-fixture-replay`, `construction-fastener-tools`,
`construction-parameter-catalog`, `konrad-lean-catalog`, `tool-catalog-parity`):
older publications they assert as the latest. This PR adds no difference to
them; `konrad-lean-catalog` now also reads the lean pin. Deno check of
`bob-worker` and `ask-bob` passes.

**Audit round 3 (two reviewers: the round-2 fixes, and correctness and
security, the owner's Audit 2), fixed the same day.**

| Area | Found | Now |
|---|---|---|
| Sketch scope (security) | A keyed sketch of construction A could continue, or be committed, from a job bound to B, and overwrote A | Refused as `operation_scope_changed` |
| Sketches | The sketch check read a repeat's role unexpanded and stopped at `invalid_instance_policy`, hiding collisions and FORM | It checks the roles the commit saves |
| | A kept rule-only change was dropped by any saved edit | Dropped only when the saved change also carries its rules, assignments and text |
| | A save refused for its text was merged into open sketch work under its key | Kept only when no sketch work is open under the key |
| | Two refused tries were merged, so a part dropped in the second still reached the commit | The second try replaces the first |
| Keep rules | A construction error behind a joint-rule refusal, or behind a number written where a node computes the field, was kept | Those refusals come only after the construction checks pass; an unreadable formula hides the geometry, so it is still kept and the commit checks everything |
| Joints | A part made reference geometry kept code's joints | They go |
| | A rule restated with a pair in `except` kept code's joint for that pair | It goes |
| | A rule in a node-only edit wrote nothing; upserting a definition lost earlier excepts; new fasteners did not reach code's joints of edited parts | A rule applies to parts the edit adds, names or moves (computed place or size changed), and their code joints take it; rules that write nothing say so |
| Formulas | The saved number sent again was recomputed without a word | Listed in the answer (`recomputed`) |
| Limits (security) | Formulas could build tens of thousands of nodes before the plan limit; repeated role rows multiplied | Compilation stops at 1,024 nodes; rows naming an id twice are not expanded |
| Cost | Execution events showed a cut answer as free | They carry its estimated tokens, cost and `cost_basis` |
| Tests | One check passed without checking (an invalid `quantity_policy` stopped it early) | It runs, and asserts it ran |

Checked clean: both patched database functions stay SECURITY DEFINER with an
empty `search_path`, each patch anchor must match once, no grant changes, no
injection path; edit sketches commit through the database's revision check;
sketch stores are scoped per thread and turn; formula parsing is linear and
bounded; server revisions in joint rules come from the catalog.

Tests: `lean-construction-units` 12/12, `lean-construction` 12/12,
`lean-entrance-wall` 1/1; 57 focused files 432/437, the five failures the same
catalog-parity tests as on `main`, with identical differences. Deno check
passes.

Open, low: (1) a cut answer's estimate is not added to the turn budget when the
step yields at the segment wall; the ledger row is written, and new pinned Bob
turns have no spending stop. A fix needs the estimate journaled. (2) Sketches
keep catalog revisions filled at the sketch call (joints, materials, now joint
rules); an item revised before the commit commits its older revision. (3) A
`form_assign` naming a part the construction lacks is ignored, not refused.
(4) Publication order: migration `20261107150000` before the functions, or
estimated ledger rows fail to insert.

**Audit round 4 (one reviewer, a convergence check of round 3), fixed the
same day.** Round 3's rows hold. Found: the construction fence skipped jobs
bound to no construction (`record_id` null), so a new-wall job using the same
key could continue and commit another construction's sketch (medium,
confirmed); now any call or commit not naming the sketch's construction is
refused. Low: a second refused try that could not be kept left the first one
open (now discarded, `earlier_try`); a rule-only edit that wrote nothing got an
unexplained database refusal (now `rules_wrote_nothing`), and code joints a
restated `except` removed were not reported (now `code_joints_removed`); model
texts did not say `except` is sent again with its rule (now in the schema);
the formula cap counted old nodes about to be pruned (now only new ones). Not
changed: a role or parameter change through its own tool leaves code joints
until the next part edit (documented; the check names faces that no longer
meet). Tests: `lean-construction` 13/13; 57 focused files 433/438, the same
five catalog-parity failures as on `main`, with identical differences. Deno
check passes.

**Audit 4, local, on the real wall (no model call).** The saved entry wall
(`tests/fixtures/entrance-wall-construction.json`) goes through the same tools
and database twice: as saved live (old format, 15,463 characters) and in the
lean format (8,155: formulas, seven rules, one mapped part). Project
measurements are decisions with the same values; fasteners are left out
(`tests/lean-entrance-wall.test.ts`). Result: the same geometry, the same 21
joints on the same faces, the same roles and the same completed mapping; after
the window width changes, both computed walls are still identical. The part
edit refused twice live (`form_instance_unmapped`) saves: code maps the new
stud to the wall and the stud–plate rule writes its two joints. Live
measurement (Entrén, Våningssäng 2) needs publication.

**Open.** Reads still show the stored graph (nodes and bindings), not formulas;
an edit names nodes, not the formulas that made them. Instance roles
(`instance_policy`, 1,447 characters for the wall) are still written per part.
Live measurement of write size, refusals and cost is the next owner turn.
The five catalog-parity tests red on `main` are a separate repair.

<a id="publication-502-2026-11-07"></a>
#### Hosted publication of #502 (lean construction writing) — 2026-11-07, 19:12–19:14 UTC

Owner: "Applicera tack". #502 is merged at
`0518da400d9ec2da425b0122babb264beaa78a8b`; its tree
`75bce2afacd42ce851700c94e78a11640ec42899` equals the tested branch tree
(`0bd2806`). Safety branch `save/bob-before-lean-construction-2026-11-07`
retains the previous published source `ad3bc4934bd057d93b52ea1425b33d8b08fbf1b8`.
Zero active jobs before and after; last job completed 14:00.

Order: the database seam first (backward compatible: the edit mapping is
optional and `cost_basis` nullable), then the runtimes, then the catalog that
switches the pin on.

1. `20261107150000_construction_edit_form_mapping.sql` as ledger
   `20261107191243`. Read back: `bob.prepare_construction_edit` and
   `bob_private.bob_project_write_v16` carry `form_refinement`, both SECURITY
   DEFINER with an empty `search_path`; EXECUTE for `authenticated` and
   `postgres` only; `shared.ai_usage_events.cost_basis` exists (text, nullable).
2. Functions from the merged checkout (Supabase CLI, `--use-api`, worker first):

| Consumer | Version | Files compared | JWT policy | ezbr SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 217 | 155 | Existing private job capability, JWT false | `52faa582ff234c66dff1c91c9f447755e3f7f09357c004d73ab35056717e9093` |
| ask-bob | 249 | 157 | JWT true | `e594fa84f7dc83ae6bc18a7e36015e899ac65589545fa468cc63d0fbf84a1ce5` |

   Returned sources match the merged checkout byte for byte except the known
   type-only `cad-intake.ts` erasure; both bundles contain the formula
   compiler, joint rules, mapping extension, sketch fence, rule notes, the
   cut-answer estimate and the `leanConstruction` pin.
3. `20261107150100_bob_lean_construction_catalog.sql` as ledger
   `20261107191355`. Active catalog (publication `bob-lean-construction-v1`,
   `lean_construction_version` 1): `tools.save_construction_draft` v17 with
   `joint_rules`; `tools.edit_construction_parts` v12 with `joint_rules` and
   `form_assign`; `tools.commit_construction_sketch` v3. Each active definition
   equals the migration's JSON.

Remaining: the owner's Entrén and Våningssäng 2 turns, read back for
characters and tokens per Konrad write, answer time against the 120 s window,
refusals by reason (and whether kept), joints written by rules, mapping
completions, and cost per role including `streamed_output_estimate` rows.

<a id="entry-after-502-2026-11-07"></a>
#### First owner turn after #502: Entrén stopped — 2026-11-07, 19:46–20:00 UTC

Job `016d8a42` failed after 31 claims with `continuation_changed` at
`workpad:load:5` (log 20:00:06). Konrad had worked normally until then: edits,
sketches and a committed sketch saved; three edits refused as `invalid`.

Cause (not in #502's code): the verified context renewal of Konrad's chain
(`bob-workers.ts`) ran after the step was saved. At 19:59:42 its conditions held
(input 110,269 tokens, a saved revision, a later workpad note), so it loaded the
workpad (journal `workpad:load:5`, location `renewal:<step>`), did not renew,
and the job yielded. The next claim resumed from the save made before that load,
ran the next step and tried again: `workpad:load:5` with the next step's
location met the recorded entry, and the journal stopped the turn. The attempt
also depended on the clock (`Date.now() + 30 s < deadline`), so a replay could
take another path. Any attempt that did not renew stopped the turn at the next
eligible step.

Fix: the attempt runs before the step's single save, so the save covers its
journaled reads, and its condition no longer reads the clock (the journal yields
when the segment runs short). `tests/bob-worker-renewal.test.ts` reproduces the
stop on the published code and passes with the fix; a renewing attempt is saved
with the fresh messages, no chain and one reset.

<a id="publication-503-2026-11-07"></a>
#### Hosted publication of #503 (renewal fix) — 2026-11-07, 23:47 UTC

Owner: "Publicera". #503 is merged at
`ac6a0e46223f828a2fe4ed7419390b19deb065d7`; its tree
`144c00971b22449de9cae40e6af1ed3817aa573d` equals the tested branch tree.
Safety branch `save/bob-before-renewal-fix-2026-11-07` retains the previous
published source `0518da400d9ec2da425b0122babb264beaa78a8b`. Zero active jobs
before and after. No migration.

| Consumer | Version | Files compared | JWT policy | ezbr SHA-256 |
|---|---:|---:|---|---|
| bob-worker | 218 | 155 | Existing private job capability, JWT false | `859797e549f676bfa8c9b56f8e9f99ffb0ea8449bbf65e8b68e277215969a1f8` |
| ask-bob | 250 | 157 | JWT true | `4caea91196081b05ba38a159d02f2244c06f724a7aade5dc8b989eae942c652d` |

Returned sources match the merged checkout byte for byte except the known
type-only `cad-intake.ts` erasure; both bundles contain the reordered renewal.

<a id="deep-audit-2026-11-08"></a>
### Deep audit after the Entrén incident — 2026-11-08

Owner: "sen gör vi en djupare audit". Four read-only reviewers: the live turn
(A), replay determinism (B), lean writing in Konrad's real job path (C),
checkpoint and context growth (D). No model call; SELECT queries and logs only.

**What #502 changed live (Entrén 13:40 before, 19:46 after; different work).**

| | Before | After |
|---|---:|---:|
| Konrad answers cut by the 120 s window | 3 | 0 |
| cache_control refusals | 4 | 0 |
| Characters typed per saved part | 2,417 | 1,108 |
| Konrad USD (turn) | 3.39 (lower bound) | 4.04 |
| Cost per saved part (rough) | ≥ 0.38 | 0.23 |
| Joint rules sent | — | 0 (104 joints typed by hand, 54 % of characters) |
| Mapping completed by code | — | all 20 new parts |

Konrad's cost moved from output to re-sent input (four cache fallbacks, about
USD 0.61); about 45 % of his output was thinking. A wrong sentence in the edit
tool's `additional_description` ("Resolve dependent bindings, nodes, joints,
materials and roles explicitly") and reads that show hand joints but no rules
kept him on hand joints. Three `concept_geometry_changed` refusals named no part,
so the door beam was never saved (about USD 0.79 of trial sketches).

**Fixed in this branch (tests in brackets):**

| Found | Now |
|---|---|
| (B) A worker's reference check read the database outside the journal; a replayed step's own saved write was refused and its entry left behind | The check is journaled (`bob-operation-validate-replay`) |
| (B) Listed images were described in parallel inside an outer journal step; positions followed network order and a resume stopped with `continuation_changed` | One after another, each call journaled once (`bob-media-describe-replay`, fails on the old code) |
| (C) A committed sketch was never read back or checked; Bob saw the superseded revision and the next job was bound to it | Read back and checked like any save (`bob-worker-commit-readback`) |
| (A) A concept refusal named nothing | The database refusal carries its reason; code names the component, the parts outside it and the numbers (`lean-construction` deep audit) |
| (C) A refused try kept in a sketch looked like real work at job end and could be committed as a duplicate | Open sketches carry `refused_try`, title and the construction a keyed sketch revises |
| (A) The edit tool told Konrad to write joints by hand under lean writing | One sentence changed, catalog `bob-lean-edit-text-v1` (`20261108090000_bob_lean_edit_text.sql`) |

**Open, owner decisions:**

1. A save or sketch in a job bound to a construction revises that construction;
   a second "new" construction in the same job overwrites the first (C, high;
   before lean a new-construction sketch there was refused). Proposal: offer
   `source_ref` (the job's construction or null for new) so Konrad names the
   target, and name it in every answer.
2. Joint rules are not stored with the construction, so reads show only hand
   joints. Proposal: store the rules on the construction (reads show them, part
   edits apply them to added parts).
3. Reaching Konrad's 200k-token ceiling or the 2 MB checkpoint kills the whole
   turn; renewal never fires in a sketch-only hand-over (D). Proposal: end the
   hand-over cleanly with its receipts, count ceilings in Claude tokens, allow
   renewal after a committed sketch.
4. State size (D): the continuation stores tool arguments about 3.6 times and
   results twice; `answer.request`/`answer.tools` (117k) are kept after use;
   `projectEdits` keeps every snapshot. Proposals ranked in the reviewer's
   report; together roughly −55 % per step.
5. Reads show the stored graph, not formulas, so Konrad copies `fx.` hashes.

<a id="publication-504-2026-11-08"></a>
**Hosted publication of #504 — 2026-11-08, 05:31–05:33 UTC.** Owner: "Gå med
rek.". Merged at `0feff885b8c85232bea2f7e9193a767d4cc51ffb` (tree
`3e012e8a30354d2019205725d64a8d5c2309e681` equals the tested branch). Safety
branch `save/bob-before-deep-audit-fixes-2026-11-08` retains `ac6a0e4`. Zero
active jobs before and after. bob-worker v219 (ezbr
`3777a427966e36a426895563a6643c8252e6c92a82b4426c5834cb640e0d1e37`), ask-bob
v251 (`1814d0e10074a7d72df406410489e2975b427833d3677999cb4458255de7a822`);
returned sources match except the known `cad-intake.ts` erasure and contain
the four fixes. `20261108090000_bob_lean_edit_text.sql` as ledger
`20261108053347`: `tools.edit_construction_parts` v13, publication
`bob-lean-edit-text-v1`, new sentence present, old one gone.

**Built after the audit (owner: "Gå med rek.", 2026-11-08):**

- **A save names its target** (decision 1): with lean writing,
  `save_construction_draft` takes `source_ref` in every structure job — the
  construction's reference revises it whole, `null` saves a new construction,
  also in a bound job; sketch answers name the target (`revises`).
  `worker-operations`, `lean-worker-path` (real binding against the database).
- **Limits end the hand-over, not the turn** (decision 3): with the
  final-answer pin, Konrad's context ceiling (`context_limit`) and a checkpoint
  over 2 MB (`state_limit`) end the hand-over with what it saved and a note to
  hand over the rest; the turn goes on. Claude Opus 5.5 takes 1M tokens, so
  Konrad's 200k ceiling (about 272k Claude tokens) stays below the provider's
  limit and is not recounted. Renewal follows a committed sketch now that a
  commit is a read-back saved revision. `bob-worker-limits`,
  `bob-worker-renewal`.
- **Joint rules stored with the construction** (decision 2): migration
  `20261108100000_construction_joint_rules.sql` (table per revision, RLS read
  by project access, immutable, inherited by revisions without rules; the
  edit prepare accepts `data.joint_rules`; the writer stores the set for the
  new revision and keeps exact-retry receipts; reads return it) and catalog
  `20261108100100_bob_stored_joint_rules_catalog.sql` (pin
  `joint_rule_store_version` 1, publication `bob-stored-joint-rules-v1`,
  generated from the code's texts). A part edit applies the stored rules to
  the parts it adds or moves without resending them. `lean-construction`
  stored-rules test against the database.
- Pre-existing, unchanged: `bob-final-answer` "a worker stopped by the
  spending stop…" and `worker-checkpoint-catalog` fail the same before #504.
  An exact retry (same key) of a lean part edit that code extended is refused
  as `operation_reused` (nothing is written twice); the database compares the
  stored whole change with the first, unextended prepare.

**Open, low (documented):** other nested journal steps (CAD guard reads,
`cad:construction_check`), worker sessions reused within one claim, live reads
feeding journaled inputs in long steps, date checks across midnight, recorded
failures losing their error class on replay; a commit retry under the same key
meets the refusal guard; the `sketch_base_differs` message asks for a field the
server owns.
