# Bob / Launchpad migration audit — 2026-10-19

**Dated evidence, not the implementation contract.** The corrected three-PR
contract lives in [the conversation owner](ask-bob-conversations.md#launchpad-migration).
[Active State](bob-delivery-flow.md#state) owns the next action. PR1 is
**merged and technically deployed through [PR #281](https://github.com/EmelieHagander/Bob-the-builder/pull/281)**;
[the release readback below](#pr1-technical-release) does not close ordinary
member/model, long-work, image or CAD acceptance. PR2/PR3 remain specified.

## Scope and verdict

The source baseline was Bob main `b4e04986ad9d96a03ca748f14745e4314a6c6c55`.
Launchpad was inspected read-only through its repository at
`9448bad116f78c44178f5415520602406df7ef69`. No Launchpad production flag or
end-to-end behavior was verified. Baseline live Bob inspection was read-only; private job
identifiers and conversation content are intentionally absent from this record.

**Proceed with the corrected first stage.** Removing historical orchestration
replay addresses a measured cause of growing work. A literal implementation of
the proposed plan would leave crash-consistency and authority gaps. The later
stateless-prompt and result-demotion stages need their own compatibility and model
quality gates. No application work quotas are reintroduced, and this audit makes
no promise that arbitrary unlimited work fits below 64,000 tokens.

## PR candidate and verification decision

[PR #281](https://github.com/EmelieHagander/Bob-the-builder/pull/281) was opened at
initial head `5f3521eaca9fdfec7056b1edaa215e7b9ae5f7df`. Its GitHub CI jobs stopped
before executing steps: the check annotations reported that the account was
locked by a billing issue. The annotations were verified through a read-only
GitHub request. This was an infrastructure blocker, not a passing CI result or a
test failure inside the workflow. The final local full suite passed **1,605 / 1,605**
tests in **493,382 ms**. The first updated run had one obsolete source assertion
for the legacy policy-cache wiring; that assertion now checks both execution
modes. Build, vocabulary and app typechecking also passed. All seven Edge
entrypoints passed Deno graph checking with scratch-only mappings to the exact
Supabase 2.49.8 / 2.110.2 and tokenizer 3.4.0 dependencies; the unchanged CI
command remains required at the final CI gate because esm.sh was unreachable locally.

The owner subsequently reported that billing was fixed and explicitly directed
work to continue with targeted tests, typechecks, review and behavior acceptance
per stage, with the full suite and CI after the final stage's behavior is
confirmed. The initial billing failure remains historical evidence, not an active
blocker or proof of a later passing CI run. No workflow or CI setting is changed
by this exception. The long-image gate before PR2, release ordering and rollback remain in
[the migration contract](ask-bob-conversations.md#launchpad-migration).

<a id="pr1-technical-release"></a>
## PR1 technical release

PR #281 was merged as `fa725fe6f92fcd63bf4b1271517ef29852ac4e13`; its runtime
code is the tested `495cb44` candidate. Deployment followed the required order:
additive migration, compatible worker, then enqueue activation through `ask-bob`.
The hosted migration is **`20261019104918_bob_turn_checkpoints`**, corresponding
to repository `20261019101005_bob_turn_checkpoints.sql`, with SQL SHA-256
`42fc255f98dd09e23bd3f698bee59e528139570e096377f388b9d3be0a1e6da6`.
Read-only metadata at **2026-10-19 10:49:40 UTC** confirmed all 11 checked RPC
ACL/security definitions, enabled private-table RLS and absent direct table
grants. All 16 existing jobs retained execution version 0.

| Installed endpoint | Status / JWT verification | Retrieved bundle SHA-256 | Source readback |
| --- | --- | --- | --- |
| `bob-worker` v110 | ACTIVE / false | `c512e7fa846f6b272716a0d7159117d4634f3553613552310563eaf027e75b7a` | 101 returned files: 100 nonempty files exactly match reviewed source; type-only `cad-intake` is empty. `provenance` and `bob-request` are omitted from this bundle. |
| `ask-bob` v142 | ACTIVE / true | `b3d5aae7a2996112862a39ad0e5abdbb991a4956e168d0ddab11db126468fc15` | 103 returned files: 102 nonempty files exactly match reviewed source; type-only `cad-intake` is empty. `provenance` is omitted from this bundle. |

All runtime sources in both retrieved bundles matched the immutable release.
An unauthenticated `GET` returned **401** from `ask-bob` and **405** from
`bob-worker`. These are boundary checks, not a successful authenticated model
turn. At **10:51:13 UTC**, the queue still contained the same 16 terminal legacy
jobs and no new jobs. No positive member/model call or long-image acceptance is
claimed. Full CI remains deferred to the final stage by the owner's decision;
ordinary long-image behavior and log review remain required before PR2.

<a id="pr1-live-checkpoint-regression"></a>
### First live job: checkpoint serialization failure

A live job started at **11:13:50 UTC** and ended with `background_stalled` at
**11:15:44 UTC**, after **9 claims**. Three bootstrap `context-summary` calls
succeeded; **no main `ask-bob` model call** was submitted. Checkpoint revision 1
saved the `ready` state at step 0. The following six checkpoint saves failed with
`unsupported Unicode escape sequence`: lazy tool preparation added internal card
cache keys containing U+0000, which PostgreSQL JSONB rejects. No `CPUTime`
shutdown was observed for this job. Normal terminal privacy cleanup removed its
working snapshot.

This is a checkpoint-storage regression in PR1, not successful model acceptance.
The corrected candidate encodes the derived cache key as a JSON tuple without
U+0000. Its new regression test first reproduced SQLSTATE `22P05`, then passed
with populated lazy-tool snapshots persisted through the actual checkpoint RPC,
restored and compared for both pinned and unpinned catalog bindings. JSON-only
roundtrips had not caught this boundary. The focused checkpoint-database and
tool-state suites passed **20 / 20** tests; Deno checking of `session.ts` and
`git diff --check` passed. Independent review found no blocker.

The correction shipped through [PR #282](https://github.com/EmelieHagander/Bob-the-builder/pull/282),
merged as `a37706912e85c2e78c4432157c70b65a5a2b7467`, with the tested runtime from
`b32a83d`. No migration was required. `bob-worker` **v111** was deployed at
approximately **11:20:44 UTC**, followed by `ask-bob` **v143** at approximately
**11:21:04 UTC**; both were ACTIVE with unchanged JWT verification (worker false,
ask-bob true). Retrieved bundle SHA-256 values were respectively
`0ec5cba2b3859d91e827421579a34387d297e29ec7abce0f1701b6277f67dada` and
`30dcd799864460a8e962baf762327a9b2a9ffa51ea476152dfa4997e025578a5`.
All runtime sources matched the reviewed release across 101 worker and 103
ask-bob returned files, with the same empty type-only file and omissions recorded
for the first release above. At **11:21:46 UTC**, read-only inspection still found
the same failed job and no replacement job. Its three bootstrap calls cost
**USD 0.014636**; main-role calls remained zero. Full CI remains deferred by the
owner's decision. No successful model run on the correction is claimed; a new
attempt at the long image job and log review remain required before PR2.

<a id="pr1-live-grounding-regression"></a>
### Second live job: image-grounding read order on resume

The next attempt began at **11:27:10 UTC** on worker v111 / ask-bob v143. It
passed tool-card checkpoint storage, completed **six main model calls and ten
tool executions**, and opened the project image. After an asynchronous context
summary, it failed at **11:34:26 UTC** with `continuation_changed` on
`rpc:search_bob_project_data_v8:6`, after **ten claims**. Terminal privacy cleanup
removed the working state as designed. Observed worker shutdown samples reported
**275–588 ms** of CPU and `EarlyDrop`; this subset is not proof of a successful
long run or constant CPU.

The image wrapper starts two lookup reads. Both await a journaled observation
before taking a position in the shared RPC stream. Cold persistence and warm
replay can complete those observations in different orders, assigning the same
RPC position to different inputs. The new regression fixture reproduced the
exact operation mismatch before the correction: it restores the model boundary
after an accepted asynchronous compactor call and reverses observation timing.

The correction pins `groundingReadOrderVersion: 1` in the saved execution
identity for new checkpoint turns and performs those two reads serially. Existing
identities without that flag retain their original parallel contract. Journal
fingerprints, live project/image authority checks, write receipts and CAD behavior
are preserved. No schema change is needed.

The focused grounding, lookup continuation and checkpoint-resume suites passed
**23 / 23** tests, including the 43-claim fixture. After expanding the authority
test to cover both read orders, the two grounding suites passed **9 / 9** tests.
The regression asserts no repeated source reads or compactor submission, identical
compactor input, preserved image reference and equal source evidence after
restart. Both affected Edge entrypoints passed Deno graph checking using the
same scratch dependency mapping described above. Diff and documentation review
were performed directly in this session, not by an independent reviewer. Full
CI remains deferred. A new ordinary long-image run is still required before this
correction can close the live gate.

The correction shipped through [PR #283](https://github.com/EmelieHagander/Bob-the-builder/pull/283),
merged as `38c5c70edf6672afbb0973d8e1df180eee4ed48e`, with tested runtime from
`3c28690b61ceb22126c591052fc85a090d4710df`. Read-only inspection at **12:10:04 UTC**
found no active jobs. Worker **v112** was installed at **12:10:15 UTC**, followed
by ask-bob **v144** at **12:10:35 UTC**, both ACTIVE with unchanged JWT verification
(worker false, ask-bob true). Retrieved bundle SHA-256 values were respectively
`927c8c33eb4973c6c231e0258db1d3f1747e6acd37dea63bcb6f2d0241608f4f` and
`70cc722a29d9e23f7e7545c716f8545a47626fcafea5ccdcba109012962510d5`.
All runtime sources matched the reviewed merge across 101 worker and 103 ask-bob
returned files, with the same type-only erasure and omissions recorded above.
No migration was required. This is technical release evidence, not a successful
authenticated long-image turn.

## Observed Bob baseline

Five `CPUTime` shutdown records on **2026-10-18, 20:47–20:59 UTC**, from
`bob-worker` **v105**, reported **2,057 / 2,056 / 2,084 / 2,168 / 2,022 ms**.
These are runtime shutdown observations, not an inferred database failure. At
the audit, installed endpoints were `bob-worker` **v109**, updated
**2026-10-19 08:58:30 UTC**, and `ask-bob` **v141**, updated **08:58:19 UTC**.
The latest inspected failed job had **40 claims** on worker **v108**, before that
deployment. There were **no active jobs at the audit snapshot**. The older
failures establish the incident; they do not establish a failure or a successful
long run on the newly installed versions.

The available **169 `ask-bob` calls** showed **41.65%** cached input in aggregate;
the latest inspected long job showed **32.73%**. The proposed **86%** is therefore
not a general verified baseline for this migration. Cost and cache comparisons
must use comparable completed work, identify the sample and preserve outcome
quality. A stable prompt prefix helps caching but cannot guarantee the same
percentage when tool schemas and prompt contents change.

### Forty-step replay probe

A local synthetic probe exercised the baseline main loop, job journal and
project image context with the current catalog fixture and a tiny image. It
interrupted and restarted after model steps, used no network, and did not use
`reuseFresh` or context compaction. The final answer and evidence matched the
uninterrupted run. This isolates replay cost; it is not a hosted Edge CPU or real
model/image acceptance test.

| Work per claim | Claim 2 | Claim 20 | Claim 40 |
| --- | ---: | ---: | ---: |
| Access checks | 23 | 113 | 210 |
| Tool-policy reads | 5 | 41 | 79 |
| Image validations | 5 | 41 | 80 |
| Model-wrapper traversals | 3 | 21 | 40 |
| Actual model dispatches | 1 | 1 | 1 |

Across 40 claims the probe made **40 actual model dispatches and 780 historical
model traversals**. Node CPU totaled **1,638 ms**, compared with **122.844 ms**
uninterrupted; claim 2 used **8.692 ms**, and claim 40 **62.995 ms**. These are one
synthetic run's timings, not a production latency prediction. Baseline TypeScript
checking passed. The full baseline suite passed **1,557 / 1,557** tests in
**502,257 ms**; that run started before the new checkpoint tests were added and
does not verify the migration. The implementation fixture below adds separate
restart regression coverage.

### Implementation fixture follow-up — still local, not released

The new full-state restart fixture used **43 claims** and serialized
**86,565,004 bytes across 214 checkpoint boundaries**. Both paths made **43 main
and eight summary calls** and produced the same final result. The timing includes
fresh component construction and state restoration. This is one synthetic Node
run with warm token caches, an in-memory transport/ledger and private image
references without pixels; it is not a hosted transport or CPU benchmark.

| Whole fixture | Legacy replay | Checkpoint resume |
| --- | ---: | ---: |
| CPU | 7,258.582 ms | 3,445.492 ms |
| Wall time | 9,891.742 ms | 3,816.437 ms |
| Access checks | 5,417 | 271 |
| Tool-policy reads | 2,041 | 88 |
| Image validations | 1,959 | 88 |
| Catalog traversals | 43 | 1 |
| Tool executions/traversals | 1,028 | 43 |

At **claims 2 / 20 / 40**, starting from completed-step indices **1 / 19 / 39**,
checkpoint CPU was **33.014 / 44.582 / 56.257 ms** and wall time
**35.134 / 48.178 / 56.735 ms**. The largest complete snapshot within those claims
was **131,078 / 478,368 / 691,153 bytes**; its retained context-compaction archive
was **13,951 / 346,475 / 553,611 bytes**. Across the whole run the maxima were
**710,811 bytes** for a complete snapshot and **573,057 bytes** for that archive.
These are individual observations, not percentiles, and are not directly
comparable with the smaller baseline probe above.

This confirms an improvement while exposing a remaining limit: PR1 removes
historical handler execution, but snapshot bytes, copying and serialization
still grow with retained state. It does **not** establish constant CPU per claim.
The large contributor is the current context archive, whose replacement belongs
to the separately gated later stages. The new full-suite result and hosted
long-image acceptance remain separate from these local measurements.

## Corrections to the starting plan

| Finding in current Bob | Required correction |
| --- | --- |
| `bob-background.ts` reads the journal and re-enters `project-answer.ts` from the beginning. Saved model responses avoid new dispatches, but historical control flow and live checks still run. | Restore an explicit execution head and continue at the next operation. Keep the active operation journal for an unfinished call. |
| Journal identity uses stream positions. A resumed loop that simply skips old steps would restart positions and collide with existing results. | Persist and restore operation cursors and stable identities together with runtime state. |
| A model response can contain several tool calls. A write can commit before the state checkpoint, and a worker can lose ownership while waiting. | Checkpoint operation boundaries, native response, original offered-tool fence, pending tool index and exact pending write. Reconcile writes through the existing database receipt ledger and retain claim/lease fencing. |
| State includes more than tool names and counters: server-issued work/edit/solution/plan references and page cursors, image carriers, source observations, accepted current-view receipts, plan proposals, drawing requests and outcome/partial state. | Inventory every state owner; roundtrip it without rerunning historical reads. A loaded manual is not proof of current permission. |
| Folding all historical rows on every restart still grows with history. Saving the entire history every step can also multiply storage and serialization. | Use a current snapshot head plus the active operation journal. Measure bytes read/written and serialization as well as RPC counts. Do not promise constant CPU merely because old handlers no longer run. |
| Current authorization, tool policy, record versions and kill switches can change while a model is working. | Remove checks for historical operations, not checks before new dispatches or writes. Revalidate at the existing live authority boundaries. |
| `bob-prompt.ts::buildBobHands` already includes the eligible toolbox directory. The workflow cards are not Bob's only capability view; manual carry is already versioned. | Preserve the complete eligible directory and loaded manuals. Do not describe the migration as first exposing all tools, hardcode a count of 93, or remove all of PR #280 with the obsolete carry workaround. Completion and write guards remain. |
| Bob currently relies on `previousResponseId`; its shared adapter does not retain all native Responses output. Delivered image carriers are cleared after delivery. | Before dropping the chain in PR2, preserve ordered native output/reasoning items and the original authorized image content needed by subsequent requests. Text-only fixtures cannot establish parity. |
| Smaller tool pages alone do not bound manuals, assistant text, tool arguments, image inputs or encrypted reasoning. | PR3 needs exact retrievable results, protected receipts/constraints, measured input size and an honest provider-capacity outcome. No silent clipping, invented summaries or new application work quota. |
| The private journal is cleared on terminal handling; shared diagnostics are content-free. | Do not introduce permanent full-prompt logging as a side effect. Private diagnostic retention and authorization must be explicit. |

The relevant Bob owners are [the main loop](../supabase/functions/_shared/project-answer.ts),
[worker](../supabase/functions/_shared/bob-background.ts),
[journal](../supabase/functions/_shared/bob-job-journal.ts),
[tool session](../supabase/functions/_shared/project-tools/session.ts),
[image dispatcher](../supabase/functions/_shared/project-context/dispatcher.ts),
[current-view guard](../supabase/functions/_shared/current-view-guard.ts),
[lookup](../supabase/functions/_shared/project-lookup.ts) and
[writer](../supabase/functions/_shared/project-write.ts). Their current working
tree may advance beyond the pinned audit baseline above.

## What Launchpad actually does

| Pattern | Inspected source behavior | Implication |
| --- | --- | --- |
| Resume | `resumeInnerLoop` restores messages/discovered tools and starts at `iterationsConsumed + 1`; the carried memory brief is not surveyed again. | Useful model for explicit resume and durable tool loading. |
| Checkpoint storage | Self-contained pause envelopes; `session_execution_checkpoints` holds one replaceable private snapshot per Session, retained atomically when consuming a timeout pause. Retention is gated by `SESSION_TIMEOUT_CHECKPOINT_RETENTION_ENABLED`, default false. | Not proof of append-only per-step checkpoints or arbitrary crash resume. |
| Model requests | Full assembled input, no `previous_response_id`, `store:false`. The inspected OpenAI adapter does not roundtrip native encrypted reasoning. | Stateless prompts are demonstrated; Bob's native reasoning preservation is additional work. |
| Mid-turn context | Optional deterministic demotion keeps three recent rounds raw. `LAF_INNER_LOOP_BOUNDED_REBUILD` defaults off; production value was not checked. | Source availability is not proof of a deployed bounded-context guarantee. |
| Older outputs | Glances describe shape/size and explicitly promise no retrieval. Mutation-fact results stay raw. On resume, prior conversation becomes the stable head; demotion applies to subsequent rounds. | Bob needs a real archive/reopen path rather than copying this information loss. |
| Images | An optional demotion removes image pixels after grounding; its own comments identify later visual reasoning as a correctness risk. | Bob's image acceptance must verify retained pixels/versioned reopening, not just presence of a textual reference. |
| Work limits | Ten inner-loop iterations, then a prose-only forced finalization; 30 absolute timeout resumes and two stalled windows. | Launchpad does not prove unlimited work without context or step constraints. These application quotas are not adopted for Bob. |
| Recovery safety | Exact ownership fences, 15-second lease renewal, physical-dispatch admission and committed-mutation suppression. Expired execution recovery seals interrupted/failed rather than replaying uncertain paid work. | Preserve Bob's existing write/uncertain-outcome safety while changing resume. |

Pinned Launchpad sources:

- [Resume and iteration limit](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/functions/_shared/ai-workers/inner-loop/run-inner-loop.ts), [iteration core and finalization](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/functions/_shared/ai-workers/inner-loop/iteration-core.ts).
- [OpenAI adapter](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/functions/_shared/ai-services/openai/service.ts), [bounded rebuild](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/functions/_shared/ai-workers/inner-loop/bounded-rebuild.ts), [timeout bounds](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/functions/_shared/sessions/turn-loop.ts).
- [Checkpoint schema and authority](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/migrations/20261009170958_laf_laf926_timeout_checkpoint_retention.sql), [current claim/snapshot replacement](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/migrations/20261014183225_laf_memory_guest_execution_receipt.sql).
- [Execution lease/admission](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/functions/_shared/sessions/execution-lease.ts), [interrupted recovery](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/functions/_shared/sessions/execution-recovery.ts), [committed-mutation suppression](https://github.com/EmelieHagander/Launchpad/blob/9448bad116f78c44178f5415520602406df7ef69/supabase/functions/_shared/ai-workers/inner-loop/committed-mutation-skip.ts).

## Regression gates still to pass

The [owning migration contract](ask-bob-conversations.md#launchpad-migration)
defines acceptance per PR. In particular, test interruption before and after each
durable boundary, committed-write-before-checkpoint, pending asynchronous model
resume, stale/duplicate workers, cancellation/session expiry and revoked authority.
Check every state owner's roundtrip and exact legacy-job compatibility. Compare
40-step restart counts, CPU and bytes without dropping image/source checks for new
work. Complete each stage's targeted tests, typechecks and review, then verify its
behavior on the reviewed deployment. The ordinary long image task remains a gate
before PR2; passing synthetic tests alone does not close it. Run the complete
suite and CI after the final stage's behavior is confirmed, as directed by the
owner's scoped verification decision above.
