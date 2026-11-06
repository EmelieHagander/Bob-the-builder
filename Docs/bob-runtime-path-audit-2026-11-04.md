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
