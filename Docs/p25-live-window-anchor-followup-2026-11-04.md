# P2.5 — Live Ladan acceptance: long-member anchor and outer handoff stop

**Current status (2026-11-04, 20:42 UTC):** PR #452 is merged and byte-verified in `bob-worker` v195 / `ask-bob` v227. Terminal specialist stops and compact working state are installed. Ladan revision 5 remains saved and unarchived. Issue #438 remains open for the next owner-initiated show/review of that saved revision and hosted CPU verification; no paid attempt was started by this implementation. Earlier numbered deployments and attempts below are historical evidence.

## Follow-up audit and remaining acceptance

- Read-only production verification found no active Bob jobs. Ladan remains Construction revision 4 / 78 instances / `source_state=changed`; entrance remains revision 1 / 31 instances / `source_state=changed`. A technical deployment has not produced a new window or established visual acceptance.
- Hosted migration SQL and the original repository migration have identical MD5 `337366cc0c99a579b1b131cce29bfc11`. The filename is synchronized to the hosted version in this follow-up; **do not apply the SQL again**. The installed piece trigger MD5 is `afdbb0c9b3e467f30dc2118de0a000f3`.
- Both retrieved Edge bundles contain the P2.5 same-turn blocker. Of 136 files in the retrieved worker bundle, 135 match main `167dc7cc0daa8d5b1a970cf96c06214b478cca35`; the remaining file, `cad-intake.ts`, is empty in the bundle and contains only type exports in source.
- Local `bob-build-workers.test.ts`: **13/13 passed**, including wrong-focus prevention and a blocked second Konrad handoff. The original `construction-presentations.test.ts` passed seven subtests but stalled before the nested P2.4/P2.5 checks, reaching the local 180-second timeout. Diagnostic tracing found the enclosing facade subtest used the **outer** test context for its nested `t.test`, queuing a sibling while awaiting it. Bind the facade callback's own `t`; this is a test scheduling correction, not a product guard change.
- Once the deadlock was removed, the P2.4 fixture exposed untyped `$3`/`$4` parameters inside `jsonb_build_object`, then an obsolete target that triggered the earlier lineage guard. Explicit `integer`/`uuid` casts match the existing columns; select the different design inside the same rejected transaction so the semantic guard is actually reached, and verify rollback restores the prior target. The P2.5 local-anchor test itself passed in the intermediate runs; the full focused file still required a clean rerun.
- **Final local verification: 11/11 construction-presentation tests passed in 35 seconds**, with the synchronized migration filename and corrected fixture. This includes P2.4 semantic source rejection/rollback, exact facade/revision feedback holds and P2.5 local-joint acceptance with negative cases. Together with the 13 worker tests, both requested focused files are now green. Commands: `node --no-wasm-code-gc --import tsx --test tests/bob-build-workers.test.ts` and the same command for `tests/construction-presentations.test.ts`. These use controlled models and isolated PGlite, not real owner/model acceptance.
- Today's four Ladan jobs have 106 model dispatches and **USD 14.0318** in recorded estimated model cost. The last pre-fix run (`267bee16-316c-4a82-b621-9e744cc22039`) accounts for 40 calls / USD 6.0099936: Konrad 25 / USD 4.1944648, Bob 13 / USD 1.7930378, picker/completion helpers 2 / USD 0.022491. These measurements predate P2.5 and cannot establish its cost impact. Telemetry currently labels specialist roles `other`; the journal step labels provide attribution here.
- Separate entrance delivery issue: turns `a9da2b2b-cee7-4b87-9277-e9362dbb5234` and `73ad90b5-0fec-47b1-8624-d9099f3ffa38` saved images/edits but ended with recovery notices. Both last observed tool actions were successful image opens. The original exception is not established: `project-turn.ts` collapses unrecognized exceptions and can replace failure with verified receipt recovery; delivery metrics then lose the underlying error. Preserve a safe failure stage/code through recovery, reproduce image-open → continuation → final reply with controlled inputs, and fix the proven cause before declaring general project help healthy. Do not infer a provider outage or image-size fault from these symptoms.

**Next:** review/merge this bookkeeping/test correction; diagnose the separate recovery failure; then run one explicitly owner-initiated first-window acceptance with exact revision/check/3D/review evidence and measured total cost. No new paid calls, GitHub workflows, migrations, deploys or production geometry writes were started by this audit. A successful window test alone does not close the broader P2 assignment lifecycle.

## Recovery diagnostic follow-up, 2026-11-04

PR #444 was merged as `a8e2fafa11f7b6683aef6fd49fa58d8e91f0efc0`.
The next source change preserves the first safe stopping stage/code across receipt
recovery, including model, checkpoint, settlement and freshness failures. It adds
no automatic retry or paid call and changes no project data or authorization.

The saved-image test fixture incorrectly used receipt dataset `images`; the
canonical writer requires `media`. Correcting the fixture proves saved image
receipts survive a subsequent failed model call without claiming viewed pixels.
Controlled tests also distinguish checkpoint errors from ordinary durable yields
and discard private exception text. A separate native continuation test restores
its durable state and reaches the actual Claude request builder with paired tool
results and private image hydration; its provider transport is mocked.

Read-only log evidence for the last entrance turn: its final checkpoints were
526,187–591,777 characters, below the 2,000,000-character boundary. After the
successful image open at 12:59:11 UTC there is no next `ask-bob` dispatch metric;
only the recovery-localisation call is recorded. This narrows investigation to
pre-dispatch continuation/validation but does not establish the original exception.
Terminal job checkpoints/journal entries have been cleaned up, so they cannot be
replayed as if still available. No jobs were active at the follow-up.

**Technical release verified at 18:30 UTC:** [PR #445](https://github.com/EmelieHagander/Bob-the-builder/pull/445)
is merged as `9fc67f39675bcf94aa0ec0aa05c8dc82eb9f05d0`. Four focused test files
passed: images 9/9, continuation 23/23, execution metrics 12/12 (including SQL
access checks), recovery 2/2. Both Edge entrypoints typechecked against the locally
installed Supabase declarations via a temporary import map; the exact esm.sh
import could not be fetched. No full CI ran. Before deployment the target was
reconfirmed as `yuobtgoidmmmwfqenkau` and active jobs were zero. Worker first,
then entrypoint: `bob-worker` v193 / `ask-bob` v225 ACTIVE, with prior
JWT/capability modes retained. Readback matched all 137 worker and 139 entrypoint
files byte for byte against the submitted bundles. No migration or paid model
was run. Bundle SHA-256 values:
- worker: `fa5350565701f361f1acd72658a42e4566912afc75e3c65ca0e9c436e11fa5eb`
- entrypoint: `225f1ff02986606209c80d931b44d61f0a10074d3d3248f1ff91c185707fb636`

**Acceptance still open:** reproduce image viewing through an ordinary signed-in owner session; fix the observed cause
and run the single-window Ladan acceptance. The available browser currently shows
Bob's sign-in page. Do not manufacture an owner session through database credentials.

## Owner-initiated first-window attempt, 2026-11-04 19:08 UTC

**Failed acceptance: runtime CPU termination before a construction write.**
Job `3c19c94e-55db-4434-ad00-046a974ddc06`, turn
`5b15e19d-0bb8-48ba-a0e8-4d4c21d08146`, ran on worker v193.
Bob delegated once to Konrad; three completed structure-worker model calls read
the saved construction, work sources and dependencies. The last recorded model
response requested `read_construction_draft` / `view=dependencies` on revision 4.
No new construction revision or facade review attempt was saved.

At 19:09:22.638 UTC, execution `8770432d-c7d5-49f5-ab2a-d5ecdf6fdb80`
was terminated with **reason=CPUTime**, **cpu_time_used=2002 ms** and about
53.7 MB total memory. The job row stayed running after the process died; no
ordinary turn-failure diagnostic could execute. It had one claim and five
completed model calls costing **USD 0.8024049**, all priced. This is a distinct
runtime failure; it does not prove the P2.5 window writer rejects the geometry.

Under the owner's delegated investigation authority, the failed process's job
was explicitly finished through the existing private chat-job finalizer with
`cpu_time_investigation`, without exposing or changing its claim credential.
Readback: status failed, zero active Ladan jobs, construction still revision 4.
The job was stopped before automatic recovery could repeat the work. No second
paid attempt was started. The exact construction read was retained locally for
reproduction, not published as a test fixture.

Local probes on that 78-instance source: dependency selection ~4.7 ms wall,
transitive work selection ~11.4 ms, and a 6000-token dependency page ~189.6 ms
(~210 ms process CPU). Different hardware/runtime means these are diagnostic
measurements, not hosted CPU guarantees. The dependency page alone did not
reproduce a two-second termination. Investigate cumulative token counting,
checkpoint serialization and segment boundaries before choosing a correction;
do not attribute the CPU limit to one pure selector without evidence.

**Next:** reproduce/profile the complete worker segment locally, then correct its
CPU consumption or safe durable segmentation. Verify replay does not buy the same
model result again. Only then repeat the owner-initiated single-window acceptance.
The saved-window, exact-3D and feedback-hold acceptance is still open in #438.

## Specialist CPU segment correction

The November 1 worker-checkpoint correction already preserves Konrad's place
(`tests/bob-worker-checkpoint.test.ts`, historical job `da79a46e`). It did not
force a new Edge invocation after saving that place. In the November 4 failed
attempt, Bob and three Konrad model calls therefore shared one invocation before
CPUTime termination. The exact CPU hot path within that invocation remains
unproven; the local dependency-page probe alone was below the hosted threshold.

The correction schedules a fresh invocation after each **continuing** specialist
step. The callback runs after saved progress, stop/review checks and optional
verified context renewal. Final reports, canonical conflicts and exact-revision
review holds return normally to Bob. Existing journal and snapshot formats,
model options, input fingerprints, authority and total work allowances are
unchanged. No migration or catalog publication is required.

Focused source verification: **36/36 tests passed** across worker checkpoint,
piece-progress and build-worker files. The new four-claim fixture uses the real
journal: two reads and one save are followed by the final specialist report and
Bob's reply; exactly four specialist calls and two Bob calls are recorded, with
no redispatch. Conflict and review tests forbid the scheduling callback from
running before their terminal result. Existing interrupted-operation replay,
legacy scheduling, exact-revision checks and wrong-focus gates still pass.
Both Edge entrypoints pass Deno check using the same temporary local Supabase
type mapping recorded for #445; the exact esm.sh import remains inaccessible.

**Technical release verified:** [PR #448](https://github.com/EmelieHagander/Bob-the-builder/pull/448)
is merged as `e49af858d09b26aeecb769c41405866465c6bb25`. Target
`yuobtgoidmmmwfqenkau` and zero active jobs were checked immediately before
installation. `bob-worker` v194 was deployed first, then `ask-bob` v226; both
are ACTIVE with prior authentication modes. Readback matched all 137 worker
and 139 entrypoint files byte for byte. Bundle hashes:
- worker: `4a42bccb177b67e5101056fd5c72accde34980eae03eb24b9f54c9ce58bd90fa`
- entrypoint: `d8871b7e63b728ac1cf208629a811d758cad744f7d6a3e6290a0cda786ff762f`

No migration, full CI or paid model run was started. Active jobs remained zero
after installation. **Next:** repeat a single owner-initiated window test with
cost and per-invocation CPU evidence. This
mitigates cumulative work within one invocation; it does not prove that every
individual tool/model step fits the two-second envelope or close #438.

## Window saved; CPU failure during return to Bob — 19:49 UTC retry

The owner-initiated retry after #448 is job
`ef2055f8-89ab-457f-a4aa-ff8eb4018a6a`, turn
`315fce18-4c7b-4706-aa3e-abc63c4dee51`, on worker v194.
It made **12 completed model calls / USD 1.381521**, with no unpriced calls,
across **10 claims**. Logs show normal `worker_step` yields and later claims;
step scheduling is active. Several claims reuse the same runtime execution ID,
so a new claim is not evidence of a fresh isolate or a guaranteed CPU reset.

**Persisted result:** Construction `ed7c0d27-78b4-4ca6-a829-9d5580b456e7`
advanced from revision 4 to **5** at 19:52:32 UTC, selected target **35** /
Solution revision **27**. Recipe instances went **78 → 86**, joints **171 → 190**.
Added parts: `hw_jl`, `hw_jr`, `hw_hdr`, `hw_hdr_b`, `hw_sill`, `hw_cr1`,
`hw_cr2`, `hw_cr3`. SQL comparison found **zero changed or removed old instances**.
The change note describes one 1200 × 1500 mm front hen-room opening as an
unmeasured design choice. A persisted facade hold records `awaiting_review`,
`view_id=front`, exact revision 5. This verifies persistence and the review gate,
not the correct visual interpretation, complete functional meaning or strength.

The code check was saved as result
`cs_9dedfdc006d311af9f3dd8ebf615e5eb933f744b09e43f23d236a45b601f6f19`:
`status=checked`, `concept_ready=false`, one top-level issue
`requirement_interpretation_unverified`, and `fabrication_ready=false`.
There is no completed Bob reply, matching 3D presentation or owner feedback
recorded for this turn; the whole acceptance remains failed.

At **19:52:35.930 UTC**, runtime execution
`c8385509-27bb-46e5-88fe-1da35e2d22ca` terminated with **CPUTime / 2206 ms**.
It had served an earlier claim as well. Scheduling made progress possible but did
not remove this CPU failure. The latest saved checkpoint was revision **14**,
with worker step **9** and the saved revision/check/review-boundary receipts.
The checkpoint and **114 journal entries** were captured locally before terminal
cleanup, without job credentials. The private job finalizer then recorded
`cpu_time_after_saved_window`; readback confirms failed job, zero active Ladan
jobs and preserved revision 5. No third paid attempt was started.

**Next:** profile the captured post-save continuation and the readback/return-to-Bob
path. Inspect interruption after a saved worker step but before terminal review
handling: the snapshot has receipts, while local terminal variables are not stored.
Before retrying, prove interruption cannot skip the review hold or dispatch another
piece. Also repair specialist tool telemetry: its outer step/index keys can be
reused across restored claims, overwriting earlier tool events; model journal keys
remain distinct. Do not rebuild this saved window or mark #438 accepted.

## Offline CPU growth analysis, 2026-11-04

**Scope:** analysis of the captured retry, production source and prior commits;
no product code, live geometry, runtime configuration or paid model changes.
No historical infrastructure CPU-limit increase was found in available personal
history or CPU/increase/raise/compute commit searches. That absence cannot rule
out a manual Dashboard/support change. Confirmed code fixes include #277/#278
(token counting/paging and replay work), #281 (active-operation checkpoints),
#399 (specialist progress), and #448 (continuing-step scheduling). Hosted logs
still show shutdown at 2002/2206 ms. Supabase documents a separate two-second
active CPU limit in its [limits](https://supabase.com/docs/guides/functions/limits)
and [CPU explanation](https://supabase.com/kb/troubleshooting/edge-function-cpu-limits).

### Measured growth and avoidable work

- During the retry, serialized state grew from **621,282 characters at worker
  step 1 to 1,116,562 characters at step 9** (~1.80x). Final components include
  ~399k context continuation, ~212k saved construction observations, ~145k worker
  state and ~116k main toolbox. The complete 114-entry debug capture is ~5.4 MB;
  this is **not** a claim that every invocation fetches that entire archive.
- `bob-turn-checkpoint.ts` stable-sorts/copies whole state during validation,
  current-state delivery and commit. A changed receipt path copies it before
  saving, inside receipt validation and again on return; equality and SDK
  serialization add whole-state passes. Component exports/main saves also clone.
  A 2 MB payload fence does not establish a CPU bound below it.
- `construction-views.ts::page` repeatedly tokenizes an increasingly large page
  while fitting exact records into its envelope. The exact saved revision's
  6000-token overview produced **15,986 characters**. The report wrapper in
  `project-answer.ts` accepts at most **8000 characters**, then discards that
  generated overview in favor of `too_large`. `bob-workers.ts::readbackReads`
  requests this overview after an exact saved-revision read already occurred.
  Thus page construction/tokenization can be paid in CPU without Bob receiving
  the result. This is directly reproducible with the captured source and schedule.
- Three fresh offline Node processes (same source, no providers/RPCs) measured
  overview-page CPU **498.5 / 853.4 / 1338.0 ms** min/median/max. An unchanged
  checkpoint commit cost **178.3 / 191.5 / 231.5 ms**, a changed commit
  **206.8 / 250.4 / 275.9 ms**. Specialist next-request preparation measured
  **165.0 / 264.5 / 340.0 ms** with cold per-invocation counting caches and
  **10.1 / 21.2 / 21.4 ms** warm. These are Node process CPU (including its GC),
  not hosted per-thread CPU guarantees, and do not identify the exact fatal line.
  The profiler's large module-compilation cost is excluded from this comparison.
- The sampled local profile attributes substantial work to `stableJsonValue`,
  JSON/copy operations and BPE tokenization. This supports a **growing repeated
  processing** explanation. It does not establish a memory leak, provider fault
  or a platform limit that dynamically shrinks. New claims can reuse an isolate;
  claim count cannot substitute for per-invocation/isolate CPU evidence.

### Separate interruption and telemetry defects

An offline `runWorker` probe restores the **actual step-9 progress** with its
saved revision-5 `construction_review_boundary`. The next action is a model call
(the mocked transport throws `OFFLINE_WOULD_CALL_MODEL`) instead of returning
`awaiting_design_review`. No paid provider or tool executes. Terminal handling
uses local `pieceReviewReceipt`/conflict variables **after** the progress save;
a restored step advances the loop without reconstructing those variables.
This proves a review-stop resumption gap, not that a second geometry write occurred.

The journal has 10 successful Konrad responses requesting 13 tools, whereas
execution telemetry retains only 4 tool events across the whole turn. Outer
step/index event keys are reused when the nested worker event counter restarts.
Model dispatch keys remain distinct, so the 12-call / USD 1.381521 total stands.

### Recommended correction order

1. Make the terminal worker result durable before an interruption can advance
   beyond it; prove saved review/conflict/verification outcomes survive a restart
   without another provider call or piece. Preserve exact revision 5.
2. Use a deliberately small exact-revision readback for the report; generate no
   full table that will be discarded. Keep large check details at their existing
   revision-bound observation owner, with references/compact findings in state.
3. Remove repeated whole-state canonicalization/copying and repeated page token
   work while preserving immutability, exact receipts, journal fingerprints and
   source/access checks. Benchmark one complete captured segment, not isolated
   successful helpers. Fix stable specialist event identities alongside this.
4. Run one owner-initiated **show/review saved revision 5** test after targeted
   checks and reviewed deployment; do not ask Konrad to create the window again.

The segmentation change is a scheduling mitigation. It is insufficient evidence
that CPU consumption is stable as histories/checks/construction detail grow.

## Current working state correction, 2026-11-04

The owner authorized implementation of the CPU investigation's next steps.
The correction preserves saved project results and history; it removes redundant
active copies rather than deleting domain records or banning archives.

- Worker progress v3 stores a terminal review/conflict/verification decision
  before finishing/readback can yield. It retains exact receipts and call
  statuses, releases the completed provider chain and saves no pending model
  messages. Restoring it finishes without another specialist model call.
  Older snapshots with a bounded conflict or interrupted review-piece save
  return verification results instead of continuing to another piece.
- Code persistence readback uses the existing caller-authorized construction
  reader and a small overview of the exact revision. It preserves project,
  artifact, revision, current revision, archive/source status and counts. It
  skips fastener/parts table construction and token paging. Model-requested
  tables remain available; saved checks have an explicit results-read reference.
- Construction tools state v3 retains references to successfully persisted
  checks at `construction_observations`, not their full report bodies. Exact
  results load and hash-check through the existing access-controlled reader on
  demand. Unsaved and turn-local list/cut reports remain in state. Old v2 bodies
  remain until persistence is proven by a result read/save. Only each
  construction's newest revision is carried into the next checkpoint.
- Checkpoint commits canonicalize incoming state once, cache comparison text
  and clone at ownership boundaries. Short receipt validation still enforces
  job/revision/unchanged semantics; full legacy packets still validate. Journal
  cursors, model fingerprints and write authority are unchanged.
- The specialist tool-event counter survives checkpoints, preventing later
  claims from overwriting earlier diagnostics. It is not a billing counter.

Offline replay of the captured revision-5 state projects a terminal checkpoint
of approximately **552 kB versus 1,116,562 characters**. Its persisted-check
component falls from **211,914 to 306 characters** after reopening the durable
result; the code-only summary is **1,587 characters**, without constructing the
15,986-character table that the old report wrapper discarded. Three fresh local
commit comparisons show reduced CPU work, with timings varying by local load.
These are Node measurements/projections, not a full hosted segment profile or
proof that Supabase CPUTime can no longer occur.

Focused verification: 76 tests passed across the eight affected worker,
checkpoint and construction files; subsequently changed telemetry,
legacy-recovery and reference-validation cases were rerun separately. Both
Edge entry points typecheck using the temporary local import map (installed
Supabase declarations, because the exact `esm.sh` import is inaccessible here).
No full CI or paid model attempt was run. Raw project/checkpoint captures stay
outside the public repository.

Deployment must find zero active jobs and verify project
`yuobtgoidmmmwfqenkau`, both retrieved bundles and existing JWT modes. No schema
migration/catalog publication is needed. Older runtimes reject v3 states: drain
active jobs before rollback as well. Revision 5 / 86 instances remains the next
**show/review saved result** acceptance target; window recreation is not required.

### Verified release, 20:42 UTC

- PR #452 merged as `300039e8f5503f7bddfc9cdf588eb756b847e44f`;
  remote merge tree `b874950a0938f48c49b145cce4128339578019d3`
  equals the locally reviewed/tested tree. Five shared runtime files changed.
- Verified project URL `https://yuobtgoidmmmwfqenkau.supabase.co` and zero
  queued/running jobs immediately before deployment. The prior versions/hashes
  matched the investigated v194/v226 release; no concurrent runtime drift.
- `bob-worker` **v195**: all **137** retrieved files equal the deployment input;
  existing `verify_jwt=false` with its capability authentication is preserved.
  Bundle SHA-256 `2d334762b3885c193f42d6ce6b0c8e5a4a7e62439c8463d7aab47123165b9bd4`.
- `ask-bob` **v227**: all **139** retrieved files equal the deployment input;
  `verify_jwt=true` and the original import map are preserved.
  Bundle SHA-256 `186fc25f901543a0f624ffe73916162e09c597d7af44642a84760504497d7682`.
- Post-deploy read: zero active jobs; Ladan Construction remains **revision 5,
  archived=false**. No migration, catalog edit, geometry rewrite or model run.
- The final changed cases passed **34/34** after the earlier **76/76** focused
  pass; both Edge entry points typechecked again. These overlapping totals are
  separate runs, not 110 distinct tests. Full CI was not run.

The deployment is technically verified. Exact facade/3D delivery, owner feedback
and full hosted-segment CPU behavior still require the authorized owner test.

## Follow-up optimization audit, 2026-11-04

**Scope:** read-only production inspection and offline probes after #452/#453.
Retrieved `bob-worker` v195 and `ask-bob` v227 still have the release hashes
above. No Bob job has been created after that release at inspection time; hosted
acceptance remains untested. No paid calls, production cleanup or runtime changes
were made. Review performed directly, without an independent agent review.

### Remaining findings, in implementation order

| ID | Priority | Verified finding | Next change and constraint |
|---|---|---|---|
| O1 | P1 CPU | `construction-views.ts::page` still recounts an increasingly large complete envelope per added row. The small code readback avoids it, but ordinary table/parts/parameter reads still use it. | Reduce page-fit probes, cache immutable row work and verify the final exact envelope. Preserve token bounds, Unicode fragments, coverage and revision/selection-bound cursors; pin changed page behavior so existing replay inputs remain stable. |
| O2 | P1 state | The captured main toolbox is 116,406 chars and the specialist session 133,485. Both carry 110 policy rows: 84 are equal; the remaining 26 differ only in `active`. Policy snapshots alone total 150,526 chars. Shelf/card descriptions add more derived copies. The pending request also duplicates the exact 19,218-char `answer.tools`. | Store one bound policy/catalog representation with per-role visibility overrides and compact session state. Regenerate derived cards/schemas deterministically. Retain the exact offered-version fence, current access checks and original pending model input; a reference must not become permission or follow a later mutable catalog. |
| O3 | P2 reads | `readSavedSummary` returns a small value but its transport still calls `read_construction_draft`, downloading/journaling the full geometry first. Captured read results are about 130,699–149,295 chars. Generic construction reads use positional `readRpc`, whereas `lookupReuse` covers a separate lookup path. | Add a thin, caller-authorized server readback at the construction owner and bounded reuse of immutable bodies. Refresh current revision/source/archive/access separately; avoid caching the whole authoritative envelope across writes or revocation. Preserve journal ordering/version compatibility. |
| O4 | P2 cleanup bug | Live `bob_job_steps` retains **724 rows / 5,528,848 logical value bytes** for **five cancelled jobs** dated Oct 29–Nov 1. `bob_finish_chat_job` deletes steps; installed `bob_cancel_job` does not. The job's terminal trigger deletes turn checkpoints only, not steps. | Make terminal job cleanup consistent and race-safe, then separately remove the proven leftovers after review. Preserve saved domain writes, write-idempotency receipts, costs and required recovery evidence. These old journals are not evidence of the active CPU failure. |
| O5 | P1 measurement | Stable tool-event indices are installed, but the metrics role allow-list still maps `structure-worker`, `drawing-worker` and `materials-worker` to `other`. No per-phase whole-invocation CPU attribution establishes the remaining fatal line. | Attribute worker roles and correlate content-free phase timings, input/state sizes and token-fit counts with hosted shutdown CPU/isolate evidence. Wall time is not CPU time; do not tune scheduling or raise limits from helper benchmarks alone. |

Offline instrumentation wrapped only the existing token-count function, retaining
the current page algorithm and captured revision-5 inputs. One 6000-token page:

| Read | Token-count calls | Cumulative serialized input to counting | Returned chars |
|---|---:|---:|---:|
| Overview table | 208 | 1,538,444 | 16,031 |
| All parts | 108 | 954,959 | 16,943 |
| One named part | 3 | 2,587 | 897 |
| Parameters | 72 | 699,988 | 18,283 |

These counts show repeated processing, not additional billed model tokens. Cold
instrumented CPU timings vary substantially and include tokenizer/cache/GC
effects; they are not substituted for Supabase's per-invocation CPU evidence.
Code-only report readback remains small and bypasses this pager after #452.

The prior ~552k terminal-state projection was reproduced with the captured job's
actual unlimited-work policy and a successful exact saved-result reopen. Legacy
v2 bodies are deliberately retained until that persistence proof; attempting the
probe with the fixture's default finite budget stops at `budget_exhausted` and
does not demonstrate reference compaction. New successful persisted checks use
the v3 reference path directly. The projection is not a post-release live run.

### Lower-priority candidates and exclusions

- `importObservation` hashes/canonicalizes the report and rebuilds/copies the
  local observations array. A fresh successful check passes through observe,
  persistence and import. Profile and remove repeated validation of the same
  immutable body, keeping the first hash/project/revision proof intact.
- `ask-openai` exports all component state, `project-answer` clones answer state,
  and commit still clones at transport/return boundaries. The returned full
  commit snapshot is discarded by the runtime caller. The >500k warning also
  serializes nested components on each commit. Optimize ownership/diagnostics
  after O2, preserving isolation and the failed-save cursor behavior.
- Token-count caches have entry-count caps (4096 message entries, 64 surfaces),
  not byte caps. Large keys across warm-isolate jobs merit a bounded-byte policy
  and measurement. This is a potential memory-retention risk, not a proven leak.
- Current turn checkpoints have **zero live rows**. The 704,512-byte physical
  relation size is allocated storage, not 704k of active memory on every run.
  Old project revisions and receipts likewise do not automatically enter prompts.
- Advisors report 63 Bob/Bob-private unindexed-FK candidates and 122 unused-index
  notices. Small frequently scanned tables include `people` (~31 rows) and jobs
  (~115 rows). These statistics do not prove a missing-index CPU root cause;
  examine actual query plans before adding or dropping indexes. See the
  [FK advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
  and [index-use advisor](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
  Security advisor notices were inspected but a full authorization audit is
  outside this performance review; no grants/RLS were modified.

**Recommended next implementation:** O1 and O2, with O5 measurement alongside;
then O3 and the isolated O4 cleanup correction. Retain archived domain history
and make it on-demand. Do not bulk-delete revisions, receipts or indexes to
address a CPU problem whose expensive work is in active processing.

## O1–O4 implementation, 2026-11-04

The owner authorized all four implementation items. These changes are source
complete and locally verified; deployment evidence follows separately.

- **O1:** new executions pin `workingStateVersion:1`. Construction table, detail,
  saved-result and work-packet pages fit contiguous prefixes using exponential
  search/bisection and exact envelope token checks. Oversized rows retain exact
  Unicode fragments. A fitting checked prefix is sufficient; no monotonic-token
  assumption or character estimate becomes the budget boundary. The cursor
  binds the new algorithm; old executions without the pin retain old paging.
- **O2:** tool-session state v3 carries phase, loaded/carried tools, the offered
  and visible version fences, workflow choices, shelf metadata and events. It
  drops the unused policy snapshot rows and stores shelf-description references
  bound to the exact immutable catalog manifest. On resume, descriptions and
  their counting cache rebuild from that catalog; prepare and execute still read
  live policy and current domain gates. Pending request/model inputs are kept.
  Old unpinned sessions still use their original v1/v2 representations.
- **O3:** `read_construction_summary` is a caller-authorized `SECURITY INVOKER`
  RPC with explicit project access, exact construction/revision selection,
  current head/archive metadata and the same source assessment as the full
  reader. It returns counts and references without serializing/downloading the
  geometry. New pinned code readbacks use it; older execution journals retain
  their original full-read sequence. Full detail/model tools remain available.
- **O4:** a private terminal-status trigger clears working journal rows on
  completed, failed and cancelled paths, at the locked job boundary. The same
  migration backfills terminal leftovers. Paused/active work, saved domain
  results, write receipts, conversation/cost and drawing recovery ledgers remain.
  A table lock and zero-queued/running guard prevent applying during active work.

Offline comparison of the captured Ladan revision-5 reads:

| Page | Old token-count calls | New calls | Old cumulative count-input chars | New chars |
|---|---:|---:|---:|---:|
| Table | 208 | 17 | 1,538,444 | 160,317 |
| Parts | 108 | 9 | 954,959 | 41,987 |
| One part | 3 | 3 | 2,587 | 2,587 |
| Parameters | 72 | 9 | 699,988 | 56,253 |

Both algorithms returned the same row counts and output sizes in this sample.
All rows and exact token/fragment/cursor boundaries are separately tested; the
algorithm does not promise identical page lengths for all possible content.
Main toolbox state shrinks **116,406 → 11,330 chars**, specialist session
**133,485 → 16,914** (combined **249,891 → 28,244**, about **89% smaller**).
Restored shelves match the original captured values exactly. These are offline
component measurements, not hosted whole-turn CPU or model-quality acceptance.

Verification: **65 focused checks** across worker resume/build/tool-state,
construction view/work and new readback/cleanup tests passed. Tests include
ordinary-caller/cross-project/revoked/anonymous/service-role reads, historical
archive state and counts, cancelled/failed cleanup, paused/other-job preservation,
late-save rejection, idempotent cancel, migration drain guard and terminal-only
backfill. Both Edge entry points typecheck with the documented local import-map
limitation. No full CI or paid provider run was started. O5 attribution/hosted
CPU measurement and the owner show/review of saved revision 5 remain open.

## Production evidence, read-only

- The live Ladan turn started 11:52 UTC, completed 12:12 UTC. It made **40 model calls**, **three `ask_structure_worker` handoffs**, cost telemetry approximately **$6.01**, and **no new Construction revision**. The saved draft remains revision **4**, 78 instances, pinned to target **29** / Solution **21**; the selected design is target **35** / Solution **27**. The correct Plan focus was saved to the facade-opening Step.
- Konrad first attempted the new front hen-room window as eleven new geometry instances, with local window studs, double header, sill and cripple studs. The edit specified target **35**. `prepare_construction_edit` returned `ready`, then the canonical writer rejected it with PostgreSQL `PT409: construction_piece_too_spread_out` (recorded in the claimed job journal). No partial revision was committed.
- The new window's added joints connect local parts to two **unchanged** existing front members: `bp_front_l` (2,450 mm long) and `tp_front` (6,000 mm long). The P1 trigger includes *both ends of every changed joint* in its affected-part span. It therefore measured the full through-member length against a **2,200 mm** per-workpiece limit. A single local opening was counted as 6 m of facade work.
- Later retries also hit human-text validation, then `construction_source_refresh_blocked/design_target_changed` when Konrad fell back to the **old target 29** instead of selected target 35. These are separate safeguards and should not be disabled to make the test green.
- P2.3 v4 correctly stopped an inner Konrad chain after its first canonical conflict, but Bob delegated the blocked window two more times **in the same owner turn**. The final answer acknowledged this, but the repeated provider work is a real orchestration gap.
- An isolated rollback test of a **synthetic 45 mm stud** attached to both unchanged long members reproduced the existing `construction_piece_too_spread_out` failure. With only the long-member exemption applied, the same real near-corner location exposed the next guard: `construction_piece_outside_or_ambiguous_facade`, because the broad front/left bounding envelopes overlap. Both problems must be resolved together; neither makes the proposed window structurally certified.

## Proposed narrow correction

1. Keep P1's existing `max_affected_instances`, exact facade match, Plan focus, original `max_piece_run_mm`, review hold and P2.4 semantic source guard.
2. Count an unchanged through-member touched by a joint as affected and require it to belong to exactly one facade, but exclude its *entire longitudinal span* only if **every** changed joint touching it is a newly added joint to a genuinely **new** piece whose axis-aligned box physically touches it. Changed long geometry, changed manufacture roles, removed/replaced joints, old-to-old joints, non-contacting anchors, cross-facade parts and multiple spaced new openings still use the original rejection path.
   For overlap near a corner, select a unique nearest outside facade boundary separately for the old and new box; exact ties and moves across facades still reject. The nominal scope rectangles are deliberately broad and cannot alone assign a nearby corner stud to both walls.
3. Persist a new per-turn marker after `construction_piece_write_conflict`. If Bob calls Konrad again in that same turn, return `needs_verification` without starting a new model chain. Ordinary provider-failure markers retain their original behavior; old pinned workers stay unchanged.

## Verification plan

- Static TS parsing and `git diff --check` on the patch.
- PGlite regression: old-to-old joint must fail; two widely separated new attachments must fail; non-contacting anchor must fail; actual change to the long member must fail; true equal-distance corner remains ambiguous; one local touching new attachment within overlapping front/left envelopes must create exactly one `awaiting_review` facade hold.
- Run isolated `BEGIN; ... ROLLBACK` verification on the current function definition and a cloned actual Ladan revision, with **no live Bob write jobs**. Compare saved counts, geometry and source pin before and after; do not count a synthetic edit as construction acceptance.
- Focused worker test: two Bob handoffs in one turn after a canonical conflict must produce **one** paid Konrad chain, and the second result must name the per-turn block.
- Run owner-initiated live test only after database migration and both Edge functions are verified against the same merged commit; check exact Construction revision, check output, 3D facade view and owner feedback hold. No automatically initiated paid model tests or full CI.

## Rollback test results (12:23–12:28 UTC)

- The full candidate migration parsed and executed inside `BEGIN ... ROLLBACK`; helper checks proved touching versus detached axis-aligned boxes and new-only versus old joint eligibility.
- Against the **actual 78-instance Ladan revision 4**, an isolated synthetic front stud joined to the existing 2.45 m bottom piece and 6 m top plate reproduced the original `construction_piece_too_spread_out` rejection before the patch. A first patch attempt found the additional front/left overlapping-facade bug, now covered by unique nearest-side classification.
- With both fixes applied transiently, exactly the same single-stud edit and selected target 35 produced **one temporary Construction revision 5 with `awaiting_review:front`**, then rolled back. A truly equidistant corner piece still failed scope selection.
- Negative actual-source rollback probes adding a **second distant front stud** or a **detached stud** both failed with `construction_piece_too_spread_out` as required.
- Before and after the tests, the installed trigger's definition had the identical MD5 `c610fb80d1fb1c5bdfff63c6237be6c5`; candidate helper functions were absent, the genuine Construction remained revision 4, and the count of persisted review attempts stayed zero.
- Local Node parsing and Git diff checks passed. Focused PGlite/worker test files were *not run* because the workspace lacks `@electric-sql/pglite` and `gpt-tokenizer`. Do not call CI or end-to-end model acceptance green on the basis of the rollback probes.

## Separate entrance observation

The simultaneously run `Bygga in entrén` turn completed with a saved **new concept Construction rev 1**, 31 part instances, 44 joints and selected target/solution 7. Bob asked the owner to reconcile the old **174 cm** depth with the proposed **265 cm** depth. It is not a checked build-ready or CAD-delivered design; no new Construction-linked drawing artifact was present at this inspection. Subsequent owner work on entrance mockup images is separate and must not be interrupted by this fix.
