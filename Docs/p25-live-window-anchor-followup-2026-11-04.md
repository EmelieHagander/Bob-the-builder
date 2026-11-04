# P2.5 — Live Ladan acceptance: long-member anchor and outer handoff stop

**Status (2026-11-04, verified after deployment):** PR #440 is merged. Production has `construction_local_joint_anchors` at migration `20261104160438`, `ask-bob` v224 and `bob-worker` v192. Issue #438 remains open: there has been no new owner/model window attempt after this deployment. The earlier evidence below predates it.

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

**Release pending:** review/merge, reconfirm zero jobs and target, deploy compatible
worker/entrypoint bundles and read back exact files. Then repeat a single
owner-initiated window test with cost and per-invocation CPU evidence. This
mitigates cumulative work within one invocation; it does not prove that every
individual tool/model step fits the two-second envelope or close #438.

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
