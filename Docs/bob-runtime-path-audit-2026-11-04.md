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
