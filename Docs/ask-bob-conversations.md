# Ask bob — conversation state and working context

> **Implementation: September 2026 context release.** This supersedes the earlier provider-cursor-only design and its unimplemented provider-compaction/reseed plan. Code and migrations are not deployment proof: the merged PR release record owns hosted migration versions, Edge version and live verification.

<a id="launchpad-migration"></a>
## Launchpad-pattern migration — 2026-10-19

**PR1 is merged and technically deployed through [PR #281](https://github.com/EmelieHagander/Bob-the-builder/pull/281).
PR2/PR3 source code is merged into main through [PR #291](https://github.com/EmelieHagander/Bob-the-builder/pull/291),
and compatible Bob runtimes are now hosted, but complete native requests and
result references are still **not activated**: the required paired immutable
agent-contract flags remain unset.**
[Hosted verification](foundation-verification.md#hosted-bob-release--2026-10-19)
owns the installed versions and metadata readback. Ordinary member/model and
long-image acceptance remain open.
[Release evidence](bob-launchpad-migration-audit-2026-10-19.md#pr1-technical-release)
records the installed migration, source and authentication readback. The owner accepted the staged direction: one PR
at a time, verify before the next stage, deterministic references for older tool
results, and CAD after Bob's main turn. The
[dated audit](bob-launchpad-migration-audit-2026-10-19.md) records the baseline,
live CPU evidence and differences from actual Launchpad. This section owns the
corrected target; [State](bob-delivery-flow.md#state) owns the next action.

**Owner verification decision — 2026-10-19:** for this three-stage migration,
each PR requires the relevant targeted regression tests, app and Edge typechecks.
The later cost decision permitted preparing subsequent stages offline before
live acceptance. The combined source passed 1,661 tests and full CI in PR #291;
independent model/behavior acceptance remains open. Full CI, CAD, PostgreSQL
concurrency and dependency-audit workflows now require an explicit manual Actions
run. Original long-image acceptance and release order still apply, and CAD's
context migration follows acceptance of Bob's main turn.

**Owner cost decision — 2026-10-19:** approximately **USD 1 per comparable completed
task is a soft efficiency target, not a spending cap or a reason to stop unfinished
work**. Do not introduce a new step, call, token-output, cost or wall-time quota to
meet it. Do not run another paid model test now. Continue with saved usage and
offline fixtures, and distinguish reduced payload/summary work from measured
delivery quality and actual savings. Model and reasoning settings stay unchanged.
The expensive partial run is a diagnostic baseline, not an accepted-task benchmark;
[cost evidence](bob-launchpad-migration-audit-2026-10-19.md#offline-cost-review) owns
the breakdown and remaining gap.

The existing context-strategy/replay behavior below remains the compatibility
reference for legacy jobs. This migration
preserves the owner's no-application-quotas decision: no added step, call, write,
cost or job-duration quotas. Provider capacity, payload/schema boundaries,
authorization, cancellation and uncertain-outcome handling remain. A payload
boundary must not be disguised as successful completion.

### PR1 — resume the next operation

New jobs pin an execution version at enqueue. A worker restores a current private
snapshot head plus the active operation journal, then continues at the next
unfinished operation. It does not replay historical main-loop handlers. Bootstrap
memory/orientation/view results are retained once per turn. Reading/folding every
historical row on each restart is not the target; measure snapshot size and
serialization as well as database calls. The storage/RPC design must preserve
existing claim fencing and may require an additive migration.

Checkpoints cover durable operation boundaries, not only completed model steps.
They retain the model response and original offered-tool fence, pending tool index,
stable journal cursors/operation identities and exact pending write. A completed
database write is reconciled through the existing receipt ledger if the following
checkpoint was lost. A pending asynchronous model operation resumes its stored job
identity; an uncertain paid image dispatch is not silently repeated. Duplicate or
stale workers cannot advance state or commit through a newer claim.

The complete state inventory includes messages/provider cursor, loaded manuals and
workflow cards, counters/outcome/partial state, pending/delivered image context,
source observations, writer receipts and accepted current-view changes, server-issued
work/edit/solution/plan references and page cursors, plan proposals, generated-image
attempts and drawing-request state. Each owner provides validated save/restore
behavior. Saved observations retain their historical meaning; they do not become
fresh project records or permission.

Current membership, policy, model enablement, image/source versions and canonical
write guards remain checked at new-work boundaries, including after model waits.
Removing checks for replayed operations must not reduce live checks to once per
worker invocation. Existing jobs retain their old execution version; do not
reinterpret their journal or change their pinned catalog. CAD continues through
its existing active-operation mechanism in this stage.

**Exit gate:** interruption at each operation boundary, exactly-once domain effects,
pending-model recovery without resubmission, stale-worker/revocation/cancellation
cases and every state roundtrip pass. A 40-step restart fixture shows historical
handler/control-flow work removed with equivalent answer, receipts and images;
report CPU, read/write bytes and RPC counts at early and late claims. Complete
the stage-specific tests, typechecks and review, followed by the ordinary long
image job on the reviewed release before PR2 begins.
Observed installed versions and live acceptance belong in release evidence.

**Release order:** apply the additive checkpoint migration, deploy the compatible
`bob-worker`, then deploy `ask-bob` to activate v4 enqueue for new jobs. Keep the
existing authentication modes. To stop new checkpoint jobs, roll back the enqueue
endpoint first; retain a compatible worker until every version-1 job has drained.
An older worker is deliberately refused checkpoint-native jobs. Do not remove the
schema or reinterpret their journal during rollback. The
[technical release record](bob-launchpad-migration-audit-2026-10-19.md#pr1-technical-release)
records execution of this order; it does not close model acceptance.

### Immutable model deadline across authority renewal

New checkpoint executions pin `modelDeadlineVersion: 1`. Before each asynchronous
model reservation, `bob-model-deadline.ts` records its original absolute expiry
in the private operation journal. Resuming that same operation uses the recorded
expiry even when the owner's JWT has renewed; the next operation uses the current
authority expiry. Membership, cancellation and actual worker authority are still
checked afresh. The shared reservation identity guard is unchanged. Old manifests
retain their original journal order. This fixes the fourth live attempt's observed
`ai_operation_changed`; [the audit](bob-launchpad-migration-audit-2026-10-19.md#pr1-fourth-live-attempt)
separates local regression evidence from installation and live acceptance.

### PR2 — build each request from complete state

One request builder assembles trusted base instructions, the complete eligible
short-tool directory and workflow cards, loaded manuals, managed memory and five
unchanged recent originals, turn-start orientation/view and the current turn's
ordered native exchanges. Keep stable content first without promoting project or
tool content into trusted instructions. Tool counts are catalog-derived. A loaded
manual remains carried for the turn, subject to current eligibility and the pinned
definition; carrying it never enlarges authority.

Remove the main Bob provider chain only after preserving ordered native Responses
items, encrypted reasoning, call/output pairing and assistant phases. Preserve the
authorized image content needed on subsequent calls; a cleared carrier or textual
reference does not replace pixels. New requests are self-contained. Shared logs
remain content-free; any private request diagnostics follow explicit access and
retention rules. Do not remove unrelated completion/write protections from #280.

**Exit gate:** exact provider-request fixtures, loaded-manual and image resume tests,
native reasoning/tool-pair validity and ordinary model outcome acceptance. Compare
cache share and cost per equivalent delivered task against an identified baseline;
neither 86% nor an unchanged cache ratio is assumed. CAD stays on its existing
path until the main-turn migration is accepted.

**Stage-2 implementation, awaiting activation/live acceptance:** durable main
turns opt in only when their immutable `agent-contract.ask-bob` metadata sets
`complete_request_version: 1` and `result_reference_version: 1` together, with
`context_strategy_version: 1`. Code installation alone leaves the existing mode
unchanged. The execution pins `completeRequestVersion: 1` and
`resultReferenceVersion: 1`; existing jobs keep their recorded identity. `buildBobRequest` reconstructs seed memory,
turn-start context and ordered retained native exchanges from checkpoint state;
the response ID remains only a local state key and is omitted from the provider
request. The complete eligible tool directory precedes workflow cards and changing
availability. Loaded eligible manuals are included in schemas on every call.
`responseItemsMode: preserve` retains native IDs, phases, function calls and opaque
`reasoning.encrypted_content`. Both POST and completed asynchronous retrieval
request encrypted items; a missing payload fails closed. Historical images stay
native inputs and resolve under the existing authorized file/pixel transport.

This PR deliberately retains the existing AI compactor until PR3: a complete
request includes the current handoff plus retained native exchanges and images,
**not every older exchange verbatim after compaction**. Ciphertext is never fed to
the text summarizer or counted as plaintext tokens. Original operation results
remain available through the existing authorized history tool. No claim of zero
mid-turn compaction, constant cost or improved cache share is made at this stage.
The shared async worker must be upgraded before activating new main executions;
old jobs and CAD omit the opt-in and retain their prior wire behavior. No new
schema migration or public request-history logging is introduced.

### PR3 — bound result payloads without an AI history summary

**Prepared, not activated.** The explicit catalog opt-in above pins
`resultReferenceVersion: 1` together with complete requests. Their native main-turn adapter never invokes
the AI compactor and offers `get_work_history` from the first request. Legacy jobs
and specialist/CAD chains retain their pinned behavior. Restore rejects a
different result-reference version.

The immutable operation archive stores exact arguments and results once, plus
small presentation copies prepared at observation time. It is private to the
current turn/response head and restored from the checkpoint; it is not a public
URL or permanent post-turn archive. Reopening pages the exact original, with a
Unicode-codepoint cursor and a serialized envelope bounded to 2,000 tokens. It
never invokes the original project handler or repeats a write. Current dispatch
authorization still applies, including history-only followups.

At the model boundary, large string results receive a bounded first page. Successful
read/list/search/open results older than two model exchanges become explicit
historical references; small write receipts, check results and error feedback stay
literal. Large receipts/feedback keep their bounded first page plus exact recall.
Native image content, original user messages and assistant/reasoning items are not
demoted. Loaded manuals remain in the full tool surface. This bounds model-visible
text; it does not make every underlying database read paged. New orientation
directory pages also use a 2,000-token source limit; older snapshots retain 6,000.
No API permission, source freshness check or write ledger is bypassed.

Reduce default tool pages toward approximately 2,000 content tokens where their
contract permits, with explicit continuation. Retain complete original results in
an authorized, versioned archive before replacing old result bodies with exact
references. Reopening retrieves that observed result, not a newly executed mutation
or a silently changed current record. Preserve tool-call/output pairs, governing
constraints, unresolved decisions and receipts required for safe execution.

Only then retire main-turn AI compaction for the new execution version. Do not
silently truncate native reasoning, images, required source detail or the five
original messages. Deterministic result demotion alone cannot guarantee arbitrary
unlimited work below 64,000 tokens; measure complete provider input and preserve an
honest capacity outcome with durable work intact. No new application work quota
or forced completion is introduced. Legacy compaction remains until its jobs drain;
shared CAD behavior is migrated separately after main-turn acceptance.

**Exit gate:** an ordinary image job exceeding 40 steps completes without main-turn
AI compaction, and its final measured input stays below the 64,000-token test
target. Exact archived results reopen after restart, no duplicate effects occur,
and long-work model tests retain constraints and useful delivery. This is a tested
workload target, not a universal bound. After the final stage's behavior is
confirmed, the full suite and CI must pass before the migration is accepted as
complete. Remove replay fingerprints, carry/paging
compatibility and compactor code only when no supported execution version needs
them and the corresponding protections have a verified successor.

## Context strategy — 2026-10-18

**The foundation was published through PR #267.** The subsequent
[coverage audit](bob-context-coverage-audit-2026-10-18.md) found incomplete specialist
tool loading, exchange retention and orientation bounds. The corrections below
are published; [coverage release evidence](foundation-verification.md#bob-context-coverage-corrections--2026-10-18)
records their verification and hosted readback. Ordinary owner, long-memory model
and CAD acceptance remain in [State](bob-delivery-flow.md#state).
[Foundation release evidence](foundation-verification.md#bob-context-strategy-release--2026-10-18)
records CI, hosted source readback, migrations, catalog activation and web deployment.
This section owns the memory/context behavior.
The [active State](bob-delivery-flow.md#state) owns remaining acceptance
work. Older pinned jobs retain their existing prompt, memory and tool contracts;
the September/October behavior below remains their compatibility reference.

Bob is the owner's building expert and advising project colleague. He carries out
the delegated work, explains relevant choices and uses colleagues when their
expertise helps. Project phase describes the setting; it does not prescribe a
generic sequence or enlarge the assignment to finishing the entire project.

### What memory keeps

The working brief is editable derived context: the memory assistant may rewrite
it, merge related material and remove detail that no longer helps the current
discussion. It preserves the active assignment, applicable constraints, decisions,
corrections and unresolved questions with useful original references. These are
meanings to preserve, not a parallel set of authoritative project records.
Relevance is assessed for the current task and search; there is no permanent
relevance score or archival threshold. Less relevant does not mean false or revoked.

Original conversation remains available even when a hint leaves the brief.
Measurements, selected solutions, requirements, construction revisions, approvals
and saved outcomes stay with their existing domain owners. An owner instruction
can be a binding requirement without becoming an observed physical fact. A proposal
is not a decision, an estimate is not a measurement, and prose claiming a save is
not a receipt. Applicable governing constraints must be read from their structured
sources; they must not depend solely on whether a summary or search retained them.
This means the compact relevant constraint set, not every record in the project.

### Small context, exact sources

Each ordinary new turn retains the four most recent previous individual messages
plus the pending owner message, with their original roles and full text. The memory
assistant receives the previous brief and only the newly older batch. V2 selects
useful pointers rather than indexing every folded message; the persisted fold
cursor tracks coverage. Unknown, duplicate or future references still fail
validation. An oversized brief is rewritten from its sources, never silently cut.

The scoped-pointer contract supplies the exact eligible sequences in the response
schema: previous indexed originals plus this fold's older messages. The current
request is relevance context without a source sequence; it stays in the five
original recent messages. Missing sequence authority fails before dispatch, and
an empty eligible set requires an empty index. The same allowlist reaches initial
and repair calls. Immutable older manifests retain their original input for paid
operation replay; new work uses the scoped contract. See the
[incident verification](foundation-verification.md#memory-pointer-and-repeated-notice-correction--2026-10-18)
for deployment status.

**Gist-only memory — owner decision 2026-10-18 (supersedes the pointer index for
new work).** Bob only needs a summary and to know where the originals are. The
memory assistant returns `{gist}` only; it never lists sequence numbers, so there
is no pointer validation to fail. The server states coverage (`throughSeq`) and
Bob finds older originals with conversation search. If both summary attempts are
invalid or the provider call fails, the fold keeps the earlier gist with a
server-written note naming the uncovered messages, and the turn continues. An
exhausted turn budget or denied access still stops. Publication
`20261018193000_bob_memory_gist_only.sql`; pinned older manifests keep the
scoped-pointer schema for replay. Deployment status is not recorded here yet.

The versioned target limits are content tokens measured with `o200k_base`, including
serialized metadata/references where applicable. They are context-size controls,
not spending limits or permission to abandon unfinished work.

| Context component | Target / maximum |
| --- | --- |
| Rolling conversation brief | Aim for 800–1,200; maximum 1,600 tokens including pointers |
| Base role instructions | 700 tokens |
| Project description | 500 tokens |
| Current work description | 250 tokens |
| Each tool or colleague card | 80 tokens |
| Short ending orientation | 150 tokens |
| Complete initial project-orientation packet | 12,000 tokens, including serialized records, source references and paging metadata |
| Exact deferred orientation page | 6,000 tokens, including metadata and source references |

The existing 12,000-character storage guard and 40-pointer maximum remain secondary
guards. The five original messages are not silently shortened to meet these small
component targets. Token counts do not represent billed usage or fully account for
provider envelopes and image inputs; the runtime reserves space for those separately.

The workshop's logical reading order is **managed memory → latest five messages →
base role → project description → colleagues → tools → short orientation**. The
provider's role hierarchy stays intact: trusted base instructions and the capability
directory are system content. The initial data messages then contain managed memory,
the five unchanged originals, project orientation, pending work and any current
image carrier, ending with a short server-labelled orientation. Project text and
memory never become system instructions. The footer reorients Bob to the project,
current work and latest owner request; it does not introduce another request.

The source packet reads the approved plan, all available Area pages and an exact
focused Task when needed. Screen focus takes precedence over explicitly saved plan
focus; an arbitrary first active Step is not an assignment. The packet gives parent,
sibling and child cards, exact focused Step Completion Requirements with their saved
revision/evidence, and a separate pointer to any unapproved plan proposal. Description
and footer limits apply to their text; their source references remain separate.
Oversized descriptions use a validated advisory presentation. Failed presentation
is marked unavailable with a source pointer, rather than clipped or presented as an
original. Other governing facts still require their existing domain readers; this
packet does not claim to select every applicable constraint automatically.

The complete packet has its own total allocation. Exact focused requirements are
packed before peer/child directories. Deferred records have explicit included,
omitted and source-completeness counts, an immutable snapshot identity and a
`read_project_orientation` cursor. Each page rechecks current project access;
the retained snapshot describes the observed revision, not current write authority.
An individually oversized original is returned as lossless JSON fragments with
explicit offsets. All fragments must be joined before interpreting that record.
Deferred governing requirements must be read before assessing completion. This
does not shorten the five original conversation messages or raise the global ceiling.
`sourceComplete:false` and a null total mean the source scan itself was incomplete;
reading every retained page cannot turn missing source coverage into completeness.
The fixed, non-deferred packet must still fit its allocation or return
`context_input_too_large` before model dispatch.

### Retrieval and colleague handoffs

The first retrieval slice combines text and semantic search over the same private
conversation. Candidates are ranked for the query and returned as bounded excerpts
with exact sequence/source references. `read_conversation_message` opens an
original sequence in pages. Exact IDs, units and source versions remain exact;
semantic similarity is a way to find a source, not evidence that it is applicable.
The transcript is canonical; embeddings are a rebuildable index bound to source
fingerprint and embedding-model identity. A stale vector cannot make an edited
source current. Missing embeddings or an embedding outage leave text/exact retrieval
available, with the actual retrieval mode exposed. An uncertain embedding-provider
submission is not automatically sent again; lexical/exact recall remains available.

Every page/index operation retains owner, project, private-thread and active-turn
authority. This does not vector-index all project data: current project facts and
constraints still come through their existing authorized domain readers. Do not
mix another member's private conversation into a project-wide memory.

Bob and colleagues share context-management mechanics but receive the task and
relevant source packet appropriate to their role. A plan compiler and an independent
reviewer do not receive interchangeable assignments or competing project memories.
The [tool owner](ask-bob-tools.md#tool-and-colleague-cards--2026-10-18) owns concise
capability cards and loading the complete instructions/schema when needed.

### Continue long work from confirmed results

The new continuation contract renews an oversized provider chain within the same
authorized job. The initial trigger is 64,000 input tokens, retaining the two latest
tool exchanges and a source-linked handoff of at most 1,600 tokens. The handoff
preserves the assignment, relevant results, uncertainty, open questions and next
steps; original tool operations remain available through `get_work_history`.
Current authorization, exact revisions and verified write receipts remain separate
from that summary. Compaction neither reruns completed operations nor turns an
uncertain write into permission to repeat it. It is a checkpoint for continuation,
not a new owner message, mandate, budget period or completion claim.

With `continuation_retention_version: 2`, an exchange is one native tool-call batch
and all its results. Commentary and completion-review nudges do not consume an
exchange slot; intervening context remains exact and late outputs retain their
matching calls. Earlier immutable manifests keep their recorded grouping solely
to replay already journaled model inputs. Unknown explicit policy versions fail.

**Rollover sizing (`rolloverVersion: 1`, 2026-10-20).** The earlier estimate
added the tool surface on top of the provider-reported input, which already
contains it. With construction manuals loaded, a freshly refreshed request then
looked over 64,000 at once, so almost every step was summarized again and Bob
kept only his last two exchanges (the 2026-10-20 run: 55 summaries in 62 main
calls, 150 repeated construction reads, no edit). New executions count reported
input once and refresh only when the part to be summarized is at least a quarter
of the trigger, so a refresh actually frees room. This is not a cap on Bob's
work. Executions pinned without the flag keep their recorded behaviour.

New durable executions also pin `lookupObservationVersion: 1`. Each project
lookup records its observation time before its RPC, including invalid and failed
reads. Worker replay restores that original time in the tool result and source
receipt; a genuinely new read gets a new observation. This keeps nested compactor
input exact without dropping timestamps, ignoring record changes or replaying a
composite operation that would skip nested journal positions. The same clock is
used by main Bob, image grounding, plan and CAD model lookups. Physical-source
validation returns source records rather than model lookup packets and can run
inside an already checkpointed CAD gate; it does not add nested clock entries. Existing
in-flight execution identities without the flag retain their recorded sequence.
Live access and source-version gates still apply. The
[lookup replay release record](foundation-verification.md#lookup-observation-replay-correction--2026-10-18)
owns deployment and acceptance evidence.

Bob and active specialist rollover atomically refresh the tool directory and prepared-call fence
before the first fresh provider request. Detailed manuals must be loaded again;
a removed native schema cannot still execute through the earlier fence. The new
manual remains available on the following step. Work handlers and their receipts
are not reset.

The same wrapper serves supported colleague tool loops with their own original
task/source seed. A technical 96,000-token input ceiling remains: if an indivisible
original seed, required result or retained exchange cannot fit after renewal, the
runtime returns `context_input_too_large` before a paid dispatch. It does not silently
cut the five original messages or claim that every possible input fits. This is a
payload boundary, not a renewed task budget. A blocked
source, lost authority or genuine provider error still has an honest outcome;
context renewal does not bypass those checks. Mechanical coverage must verify
small packets, exact-source retrieval, old-job replay and duplicate-free continued
work. Real-model tests must separately prove useful semantic retention and delivery
after many folds; synthetic summaries do not establish that quality.

Source owners are `bob-conversation-brief.ts`, `bob-memory-retrieval.ts`,
`bob-project-orientation.ts`, `bob-context-continuation.ts` and the existing
`project-answer.ts`/`project-turn.ts` seam. Focused fixtures cover exact five-message
composition, source references, token limits, lazy loading, refreshed authority and
the pre-strategy main call's unchanged journal fingerprint. The new function-level
Deno import configuration is part of the Edge deployment; copying only TypeScript
files is insufficient. Hosted readback confirms both function configurations;
technical release verification remains separate from ordinary-model acceptance.

## Active memory and continued work — 2026-10-17

The continuation publication uses existing T1 recent messages, T2 older gist/index
and T3 exact recall to resolve the still-active delegated outcome. It adds no
parallel goal store or memory worker. Latest instructions may refine, cancel or
supersede earlier work; completed work must not be resurrected. Fresh records
remain the authority for saved state. Before the first candidate final answer on
an authorized writing turn, one review checks the active outcome against current
records, Step goals and Completion Requirements, even if no write was attempted.
The same provider chain retains the earlier intent and this turn's tool results.
This review advises Bob; it is not proof that a model completed the whole request.

Bob continues ordinary authorized successor work after an intermediate save and
finishes independent parts before asking for an actual human action. Planning
Tasks use their own delivery requirements; they need not await physical building.
Project/Area phase is orientation, not authority to advance the whole project or
an instruction to work until physical completion. Existing explicit plan approval,
physical evidence and write authority remain required.

For newly enqueued durable jobs with pinned `work_allowance_version: 1`, application
spending, call, output-token, step, read, write, correction, colleague, image-operation,
fold and total job-time allowances are removed. Accounting remains. Per-operation
payload/schema limits, provider constraints, authority, revision guards and uncertain
outcome handling remain. A worker slice yields and resumes the same job; journal
pages have no aggregate entry quota. Replayed operations reuse their exact results.
The saved manifest and policy are pinned at enqueue, before the first model call.
Historical jobs and the legacy synchronous compatibility path retain their original
policy; deployment does not reset or re-execute them.

Actual session expiry pauses and preserves the job. Reconnecting with a fresh
ordinary user session renews that same job, subject to current project access.
The active chat offers Stop for its owned background job; cancellation fences
further writes and preserves already confirmed changes. Neither renewal nor a
technical worker continuation is another owner message or a fresh budget.

This section supersedes the older application-budget and four-fold preparation
rules below for policy-1 durable work. This release did not implement arbitrary
same-turn provider-context rollover; the [new context strategy](#context-strategy--2026-10-18)
owns its successor contract. Older jobs retain the technical context-limit failure
with saved receipts preserved. No model or reasoning tier changes in this
release. [Hosted release evidence](foundation-verification.md#bob-continuation-release-2026-10-17)
records the installed runtime/catalog and the remaining ordinary owner acceptance.

## Recent transcript window and construction-check replay — 2026-10-17

The browser initially requests the latest five transcript rows, with one look-ahead
row for a stable sequence cursor. **Show older messages** loads preceding pages
without replacing the draft or moving the reader to the newest reply. Tail refresh
retains older pages already opened. Pending/retry state still comes from the latest
owner turn and its authenticated exact-turn job status, including when independent
event replies push that owner message outside the visible window.

An account/project-scoped memory cache keeps only the recent preview for up to eight
projects in the current page session. It is cleared on account changes, sign-out and
confirmed reset. It is not persistent storage, model memory, permission or current
job state. A preview can render during revalidation; send/reset actions stay disabled
until fresh server state is known. A failed sync offers Retry conversation rather
than silently switching a private member conversation to a device-local history.
Running durable work polls only content-free job progress and reloads the recent
transcript on settlement. Older history remains in the database; Bob's existing
five-message working context, older brief and exact recall are unchanged.

The observed failed construction run stopped with `continuation_changed` at
`model:ask-bob:22` after its own later material revision. A prior construction check
had combined checkpointed records with an unrecorded current-source gate; replay
then changed that earlier tool result and the following paid model fingerprint.
New execution identities pin `constructionReplayVersion=1`. Their interactive
construction source check is checkpointed per logical check position: replay uses
the historical observation, while a later new check reads current state. Existing
identities without the flag retain their journal sequence. Live caller authority
and independent fresh CAD render/review gates remain required. No journal mismatch
guard is disabled and no paid operation is silently retried as a different input.

This code correction does not itself establish semantic owner acceptance: Bob
still needs to demonstrate that he creates ordinary missing prerequisites instead
of ending with a statement that they are missing. A replay fix or a faster drawer
does not prove construction correctness, CAD readiness or complete delegation.

[Hosted release evidence](foundation-verification.md#bob-history-replay-release-2026-10-17)
records the installed runtime/web pins and the remaining ordinary owner test.

### Visible work status and bounded loading

The drawer keeps automatic work status above the composer, outside the scrolling
transcript. It reports the server's current activity and confirmed saved-change
count, plus the last activity timestamp when available. Reading older messages
does not hide it or move the reader. A connection failure shows that status could
not be refreshed; it does not claim a new worker heartbeat. Paused authorization
offers Reconnect beside the existing exact-job Stop command. Completion removes
the work status after the saved reply is read back.

Initial conversation loading, including the member projection, has a 20-second
deadline and a visible Retry conversation action. Loading/checking a cached
preview stays visible above the composer. A late result from a timed-out attempt
cannot enable actions or replace the recovery state. The draft survives retry.
Older-page reads also have a whole-read deadline, and the initial exact-turn
status request has the same per-request abort as progress polling. These are
browser read limits; they do not stop or restart Bob's background work.

## Ownership and authority

Drawing-request recovery is owned by [CAD adapter — P2a](cad-adapter.md#p2a--request-recovery). It is deployed through [PR #165](https://github.com/EmelieHagander/Bob-the-builder/pull/165). It adds an intake retry condition across turns and binds completion to the CAD receipt without creating a second transcript or broadening private-thread access.

There is one active private thread per `(auth user, Bob project)`. The database owns the visible transcript; normal-user RLS requires both thread ownership and current project membership. Another member of the same project cannot read it. The browser supplies only the current request and its stable turn UUID, never provider ids, history, a summary or a tool conversation.

The public `guest@bob.local` identity is shared. Its chat remains device-local and provider-stateless between questions, without private server summary/history or write tools. Do not merge local guest history into an ordinary account implicitly.

The project database remains the authority for **saved** project state. Conversation explains goals, references and corrections, but is not proof that an earlier quantity, status or dimension is still current. Fresh project reads use the caller JWT, never privileged service reads. User-supplied observations and new decisions can supersede an old saved plan; proposed sizes remain specifications/estimates, not invented measured evidence.

## Current requested deliverable

The owner's current instruction and still-active earlier delegation define the deliverable. Pending drawing requests
are background working state and precede the recent conversation in the model
input. A request to describe an image, discuss the furniture, correct its
description or save project text does not commission CAD. Bob reads the relevant
sources, performs the requested text write and finishes with its actual receipt;
creating or selecting a Solution is not a prerequisite for a description edit.

When the current instruction requests or continues a drawing, Bob reuses the
matching request, requirements and source-current draft without another approval
or duplicate work. A new task period permits work within the current mandate;
it does not itself request a drawing. Automatic domain-event recovery remains
the audited execution of the original drawing instruction, separate from a new
chat request.

`scripts/build-ai-drawing-intent-catalog.ts` publishes the six resume fragments
and CAD request guidance as new immutable versions. Earlier pinned attempts keep
their original versions. `tests/bob-drawing-delivery.test.ts` checks text delivery
with a paused drawing on the bench; `tests/drawing-intent-catalog.test.ts` checks
activation, preserved settings/schemas and historical manifests. Fixtures do
not establish real model selection; hosted readback and owner acceptance remain
separate release evidence.

## Transcript and rejected-send recovery — deployed 2026-10-02

Released through [PR #181](https://github.com/EmelieHagander/Bob-the-builder/pull/181);
[verification evidence](foundation-verification.md#chat-message-recovery--2026-10-02)
records the exact tested source and served bundle. The real shelf acceptance remains open.

Every saved owner message remains visible in sequence, including failed and pending
turns. Failed execution is labelled separately from message persistence. A
matching turn reply settles its ordinary retry state; independently delivered
drawing events do not hide or acknowledge the owner's message. The
[exact drawing-recovery correction](#exact-drawing-request-recovery-status--2026-10-09)
below adds a narrowly scoped budget-stop projection, with separate release status.
A newer owner message supersedes the older retry action while retaining the full
visible history.

Before an ordinary member sends, the drawer retains one attempted message, its
idempotency UUID and frozen screen pointer in tab-scoped session storage keyed by
verified Auth user and Project. It binds to the known private thread and is cleared
when that thread is reset/replaced. Storage failure leaves the in-memory copy only.
This temporary delivery record is not server history, model context or a send queue.
No restored message is automatically submitted. A 409 or uncertain HTTP result
reads history; only the same user-turn receipt acknowledges the message. Unrelated
pending work may be observed, but cannot discard this copy. The retry button sends
the original UUID and screen; new sends cannot replace the retained attempt.
Successful receipt/reset removes it. The owner can explicitly dismiss the local
retry; its visible bubble remains marked unconfirmed and no backend cancellation
or new send occurs. Retrying preserves any newer draft in the composer. Guest
device-local history is unchanged.

The regression in `scripts/check-bob-reset-browser.mjs` covers a rejected complement
with both terminal and pending older work, retained original instructions, reload,
explicit same-ID retry, duplicate prevention and failed/successful reset at
320/390/1280 px. Pure transcript/retention cases live in
`tests/bob-transcript.test.ts`. These fixtures do not close the real shelf/CAD gate.

### Exact drawing-request recovery status — 2026-10-09

**Deployed 2026-10-09 through [PR #235](https://github.com/EmelieHagander/Bob-the-builder/pull/235).**
The existing bed request completed independent review and canonical save after
its original ordinary turn had failed at the budget guard. The browser still
appended that old turn's synthetic spending-stop notice after the saved reply.
[The verification owner](foundation-verification.md#drawing-recovery-status-investigation--2026-10-09)
owns the actual recovery evidence and remaining browser acceptance.

The authenticated `bob_job_status` RPC retains its historical outer `status` and
`error`. An additive `drawingRecovery` projection identifies exact linked
`requestIds`, `scope: 'drawing'` and `status: 'queued' | 'running' | 'completed'`,
with nullable `expiresAt` and `progress`. It requires current project access and
the caller's active private thread. Every request matches the Project, owner,
thread and original turn; each uses its latest matching event job. Completed
recovery requires every linked request to be saved, its exact Artifact receipt
and historical revision to exist, its latest event job to be completed, and a
completed assistant event message with `partial: false` and that exact saved
write receipt. A legitimately newer Artifact head does not invalidate the saved
historical revision. Prose, a merely ready candidate or an unrelated reply is
insufficient.

An exact queued/running recovery with a valid future expiry projects pending
drawing progress for the original unfinished turn, including after a non-budget
failure. It does not claim completion. Terminal completion has the narrower
budget-stop rule below.

Only an outer `failed / turn_budget_exhausted` plus this exact completed drawing
projection removes the synthetic budget-stop notice and its obsolete retry
state. The original user message, failed `delivery_state`, ordinary job and
assistant event remain intact. The client uses a separate `deliveryRecovery`
marker for recovered drawing work; it does not declare the whole ordinary turn
completed. A non-budget failure retains ordinary retry/notice behavior even when
its drawing is saved. Missing, malformed, cancelled or unrelated recovery cannot
settle the failed turn. The RPC is read-only: it cannot enqueue work, renew
authority, grant budget or alter messages.

An open, visible, idle member drawer checks content-free inbox/status every ten
seconds and on focus, visibility or inbox events. An unchanged stopped turn gets
its status checked before full history is fetched; history refresh is justified
by a changed inbox or valid exact recovery. The drawer observes delivery without
resending the owner message, preserves draft and scroll, and fences late reads
by the existing project/account, send and reset scope.

The retained outgoing-message rules above are unchanged. A recovered drawing
does not acknowledge a different message rejected at 409 or an uncertain send;
that copy still needs its exact user-turn receipt or explicit dismissal.

[CI 37989030600](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37989030600)
passed 1,093 tests and reset/recovery browser fixtures at 320/390/1280 px.
[Pages 37991195981](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/37991195981)
deployed merge `a77de7431f3c4ef0a7b866c142e6c050550ac216` successfully. The status
migration is applied; `ask-bob` v93 and `bob-worker` v61 are unchanged. During the
investigation the owner cleared the private thread at 20:40:02Z, before the status
migration: old jobs, messages and working packet were deleted, while the saved
request and Artifact revision remain. That old
turn can no longer supply a live completed-status probe. Isolated SQL and CI
browser fixtures prove the correction; ordinary named-owner browser acceptance
remains in [State](bob-delivery-flow.md#state).

## Explicit T1 / T2 / T3 context

The September 24 correction follows Launchpad's actual context implementation, inspected at commit `28834d6efbf7ac0cb2f7069b7d275b729cb4b28e`, rather than only its earlier parked canvas. References: [`session-brief.ts`](https://github.com/EmelieHagander/Launchpad/blob/28834d6efbf7ac0cb2f7069b7d275b729cb4b28e/supabase/functions/_shared/sessions/session-brief.ts), [`prompt-assembly.ts`](https://github.com/EmelieHagander/Launchpad/blob/28834d6efbf7ac0cb2f7069b7d275b729cb4b28e/supabase/functions/_shared/sessions/prompt-assembly.ts), and [`session-recall.ts`](https://github.com/EmelieHagander/Launchpad/blob/28834d6efbf7ac0cb2f7069b7d275b729cb4b28e/supabase/functions/_shared/sessions/session-recall.ts). There is no Launchpad runtime dependency or claim that its private deployment was tested here.

The common pattern is **verbatim recent chat + older gist and sequence index + exact recall + separate current/action state**. Bob retains the owner's five-message window; Launchpad uses a nominal six-turn window with a budget guard. Bob has one private owner/project thread, not Launchpad's coworker audience routing, so those audience rules are not copied. Current project records still come from caller-authorised reads.

| State | Source and boundary | Lifetime |
| --- | --- | --- |
| T1: recent conversation | Four most recent previous **individual messages**, plus the current pending user request. Full original text and role; sequence/delivery metadata in the frame. Not five pairs. | Rebuilt for each request |
| T2: older working brief | Private `bob_thread_summary`, thread FK, JSON-encoded gist + up to 40 sequence/topic pointers and `last_folded_seq`. Only the prefix before T1 is folded. Legacy plain-text summaries remain readable until the next fold. | Same thread; reset cascade deletes it |
| T3: original history | `search_conversation_history`, exact messages, role and sequence, literal query and exclusive sequence cursor. Same owner/project/thread/claimed turn. | Read-only, same thread |
| In-flight state | Existing turn claim, generation, lease and write receipts. Never reconstructed from prose. | Existing write/turn recovery contract |
| Recent saved actions | Last 16 compact ledger receipts for this actor/project and turns in this private thread. No stale record body, other member's conversation or new permission. | Read afresh alongside T1/T2; old-thread receipts are not injected after reset |
| Project evidence | Fresh briefing and caller-RLS project tools. Not summary or history search. | Current turn |

An old failed request retried later remains the final current input, even if its original sequence is earlier. Delivery metadata distinguishes failed attempts from completed answers. Recent messages are never character-sliced. A summary is necessarily lossy: exact older decisions can be retrieved with T3, and saved state must be re-read with project tools.

### Incremental folding and failure

After claiming a turn, recover durable write receipts **before** any new model call. A receipt-only recovery skips both summarization and answer generation.

Otherwise, load T1 and the unsummarized older prefix under the service-only claim guard. Fold up to 16 old messages and approximately 60,000 characters per batch; one longer legacy message is kept whole rather than cut. A request makes at most four folds within a 105-second preparation budget. Each successful fold persists with compare-and-swap on the previous high-water mark and exact batch endpoint, then reloads. The summary has a 12,000-character storage limit, with a shorter prompt target.

The separate summarizer has no tools, receives no provider cursor, treats transcript text as untrusted data and preserves units, assumptions, explicit corrections and open dependencies. Structured output indexes each newly folded message using a supplied sequence number; invalid/future/duplicate pointers are rejected before saving. Older pointer topics compress into the gist while originals remain retrievable. Claimed saves in prose are not receipts. `context-summary/global` has its own governed mini/low settings and usage category through the same shared AI service. `ask-bob/global` is reserved for the main standard/high model. Neither changes another app's settings.

### Managed memory navigation — 2026-10-17

This is the released V1 compatibility contract. The [V2 strategy](#context-strategy--2026-10-18)
adds token-bounded, semantically selected memory for new activated executions;
it must not rewrite already-journalled V1 inputs.

Executions created under this V1 contract pin `memoryManagementVersion: 1` in their durable execution identity.
The model maintains the gist; code manages its bounded navigation index. Every
newly folded source gets a pointer before optional older hints are selected. A
missing model pointer uses only the source's sequence, role and delivery state,
never an invented topic. Valid model topics replace these neutral descriptors
when they fit. Optional model-selected older hints yield first, newest hints
preferred. This prevents a full index from blocking the next two messages.

New gists are constrained to 6,000 characters, pointer topics to 200 and the index
to 40 entries. The complete serialized JSON, including escapes, must fit 12,000
characters. These are compact-memory limits, not a limit on saved conversation
length: all original messages remain available to same-thread exact search even
after their hints leave the index. T1 remains the latest five individual messages.
No complete older transcript or previous-turn provider chain is sent to main Bob.

Older valid stored briefs may exceed the new gist target; they remain readable
and are recompressed on the next fold. Invalid gist size, shape, duplicate/future
or unsupplied references get one repair attempt from the same original sources
within the preparation deadline. The gist is never character-sliced. Only a valid
managed fold advances the compare-and-swap watermark; two rejected candidates
preserve the prior brief and exact transcript and return the existing retryable
failure. Executions whose stored identity lacks the new version keep the previous
validation and model/save inputs. Journal replay reuses the first response across
worker yields. No schema, catalog or model-setting migration is needed.
[Hosted release evidence](foundation-verification.md#managed-conversation-memory--2026-10-17)
records the installed runtimes and the remaining ordinary owner test.
Diagnostics record validation reason and size, never conversation text. This
repairs the failure before main Bob, image inspection or CAD can start; a guest
release check does not exercise private-thread summarization.

Preparation is synchronous before answering, not Launchpad's separate fold worker. When a long legacy thread needs more batches, return `context_preparing`; retry the same request to continue from saved progress. A failed fold returns an explicit failure rather than answering with silently missing history. Original messages are never rewritten. Exact recent text is not silently truncated on model-limit errors either.

### Provider calls

The first answer call starts a **new** provider chain containing fresh rules/briefing, the older brief labelled untrusted conversational data, and T1's original roles/text. The previous user-turn cursor is not used. Within the current turn only, tool results continue through server-owned Responses ids. The final id is still stored by existing commit machinery, but no longer supplies next-turn memory. Clearing Bob context does not promise erasure of already-retained provider objects.

The 2026-10-09 [AI catalog implementation](../supabase/README.md#ai-definition-catalog-and-model-tiers) supersedes the earlier byte-for-byte persona guarantee. Bob and colleagues use short second-person personas with separate technical contracts. Their definitions, output schemas and execution profiles are database versions; this does not grant broader write authority or change the transcript/summary behavior. Listed registered tools and real backend checks remain the capability authority.

### Pinned AI definitions during continuation

Before model work, the turn journal pins one service-resolved AI catalog manifest.
Its exact prompt, role, profile, tier binding and model capability/price versions
survive worker continuation and retry. An operator's new activation applies to
new manifests; it cannot change the input of an already-journalled model call.
Membership, live tool policy, record freshness and the function/module enable
switch remain fresh checks. A manifest records configuration, not execution
permission or project truth. [The catalog owner](../supabase/README.md#one-turn-one-configuration-snapshot)
owns resolution, version activation and release evidence.

`context-summary` remains the existing bounded private conversation fold. An
explicitly disabled memory-agent proposal in the catalog does not add a separate
intelligent worker, project-memory store or autonomous archive/forget lifecycle.

## Research and execution budget

`search_bob_project_data_v2` keeps static caller-RLS projections and adds components, solutions, the selected target, artifacts and material requirements alongside existing datasets. It returns selected-target **exact solution-version** details and relevant saved measurement snapshots; the newest unselected solution is not substituted for the chosen version.

At most 32 user-directed project lookups (including the briefing), four history
searches and 24 execution rounds are allowed. Image grounding uses a separate
48-read reserve through the same caller-JWT dispatcher; it cannot be starved by
ordinary project searches, and its sources remain in provenance. The final round
is tool-free and elapsed-time fences reserve settlement time. Write limits belong
to [bounded writes](ask-bob-writes.md). Pages and truncation remain explicit.

### Bob-directed completion — 2026-09-27

**Supersedes [Delegated work delivery](#delegated-work-delivery) and [Drawing delivery](#drawing-delivery) below**, which remain as history. The dated [runtime review](bob-ai-runtime-review-2026-09-27.md) records the reasons.

- There is no intent classifier (`bob-work-intent`) and no forced continuation. Bob chooses tools from the whole bench ([tools](ask-bob-tools.md#current-toolbox-contract--2026-09-27)).
- Bob's reply reaches the owner exactly as written. The server never replaces it with a notice. When settlement verifies saved changes after an uncertain write, or the transcript commit fails, the localised notice is appended after Bob's text.
- One factual completion note, at most once per turn and never with a forced tool: when the server knows of a prepared but unsaved result (a validated plan proposal or a reviewed CAD candidate) or of rejected changes not yet corrected, it tells Bob before his reply is released. Bob decides. Such results keep the evidence partial.
- Server notes are user-role messages labelled `[Server note — not from the owner]`. The shared adapter drops system-role messages from `messages`, so earlier continuation prompts in that role never reached the provider.
- A reply that prints tool syntax gets up to two plain nudges and never reaches the owner. An empty reply gets one nudge.
- The closing step (the last of 24 steps, or less than 40 seconds left) has no tools and a labelled note asking Bob to report what is saved and what remains. Up to eight tool calls run per step; extra calls in the same step return `deferred` instead of ending the turn.
- Access is re-checked after every model reply, before any of its tool calls run.
- The records Bob consulted in his previous reply (up to 24 pointers: dataset, ID, label) reach the next turn beside the recent saved actions. They are pointers only; current values must be read again.

### Delegated work delivery

> Historical (2026-09-25 to 2026-09-26). Superseded by Bob-directed completion above; `work-delivery.ts` is removed.

`work-delivery.ts` interprets delegated results before execution using the
`work-router/global` governed configuration. It sees current/recent messages and
labelled older context, validates an exact current-request quote, and distinguishes
information, cancellation, continued work and separate deliverables. This is
language interpretation, not a keyword table, permission or project fact.

Structural completion matches result type, distinct record count and an exact
target ID when known against actual successful receipts observed at that point.
Up to three bounded continuations recover premature prose without another owner
request. Bob then compares the requested object, edit, views, revision and work
links with actual results before finalizing. Missing results replace a premature
success claim and retain partial evidence. These checks do not prove semantic
fidelity by themselves; model acceptance remains necessary.

Initial receipts are checkpointed before execution. Later recovered receipts
cannot change earlier prompts during replay. Failed intent interpretation does
not abort an unrelated turn: execution and one final review remain available,
with partial evidence. Guests have no writer and skip work-intent classification.
Queried tool search is separately logged as `bob-tool-discovery`; intent uses
`bob-work-intent`. Both route through `work-router`, with bounded output tokens.

### Drawing delivery

> Historical (2026-09-25 to 2026-09-26). Superseded by Bob-directed completion above. The receipt helpers in `project-delivery.ts` remain; the drawing intent, forced tool choice and continuation prompts are removed.

`project-delivery.ts` specializes the general work-delivery check for drawings before intermediate saves occur. The model sees the original
recent messages and labelled older context, including continued work, corrections,
cancellation and information-only questions. Classification is validated against
an exact current-message quote. It is interpretation, not authority, a physical
fact or proof of completion; normal caller RLS and domain commands still apply.

A drawing request makes the eligible CAD tool visible through the existing
catalog gates, regardless of phase. At a premature prose ending, the runtime
checks for a pinned, successful drawing Artifact receipt. Task instructions,
measurements, solution/target selection and an unsaved CAD candidate do not meet
that check. Up to three continuations within the existing round/time/write bounds
require native action: an unattempted CAD consultation, saving a ready candidate,
or continuing its prerequisites. An explicit CAD blocker, uncertain write or
exhausted budget stops that recovery. Recovered geometry receipts from the same
claimed turn prevent duplicate generation. Initial delivery state is checkpointed
separately: newly recovered receipts after a later worker yield must not change
an earlier prompt or continuation branch. The actual current user message remains
last after routing data. A remaining missing drawing replaces
the premature answer with an explicit incomplete result and actual saved
subresults; evidence stays partial. Job completion alone is not drawing delivery.

The CAD specialist also gets one bounded recovery when it tries to end without a
rendered candidate. It can render with labelled working assumptions or use
`report_cad_blocker` to identify an indispensable missing/conflicting constraint
or unsupported geometry. Its explanation reaches the incomplete result. Neither
this check nor a saved drawing verifies construction strength, physical fit,
visual fidelity, or every requested view. Model-assisted intent and design quality
still need real-model acceptance; mocked protocol tests are not that evidence.

Write permissions, exact-current-request quotes, optimistic revisions, settlement generation fencing and receipt-only recovery are owned by [ask-bob-writes.md](ask-bob-writes.md). Summary/history retrieval never counts as fresh project evidence or permission to write.

## Delivery language and outcome measurement — September 25

The existing work-intent call also prepares a bounded set of terminal notices in
the owner's requested conversational language. There is no locale keyword map,
language allowlist or Swedish user-facing fallback in the executor. Code owns
which notice applies and appends exact missing-result labels/verified receipts;
the model localises the meanings and cannot select completion state. The notices
survive until settlement/commit so a late chat failure needs no new model call.
A receipt-only recovery with no prepared notices can use one small read-only
localisation call before settlement. Complete provider failure or no remaining
budget uses language-neutral warning/open/saved marks and original labels.
That path preserves partial evidence and never re-executes writes.

### Receipt-owned drawing event replies — 2026-10-10

**Implemented and technically deployed; actual member acceptance remains in [State, release E](bob-delivery-flow.md#six-outcomes-in-five-releases).** [Verification](foundation-verification.md#receipt-owned-drawing-event-replies--2026-10-10) owns the test, CI and exact deployed-file readback evidence. Drawing-event replies use this same phrasebook/notice composer instead of the separate free `drawing_resume_reply` answer. Only an explicit CAD-writer/request-store receipt for the current project establishes a delivered drawing; provisional `saved` flags and free `outcome.user_message` do not. Other verified writes remain partial results. The message includes exact receipt titles and revisions, original gaps and the actual technical/recovery cause; it cannot manufacture a new owner permission question.

Known CAD-engine failures, exhausted drawing budgets and already-saved request acknowledgements need no fresh language call. Seeded phrases remain usable; otherwise the existing language-neutral marks and original labels preserve the result. Missing-data notices may prepare the existing outcome-independent phrasebook once. Localisation receives the owner's language request, not the domain outcome or receipt it might rewrite. Access is rechecked before and after delivery.

Phrasebook calls have a separate `model:delivery-language-v1` journal stream. An exact matching phrasebook already recorded under work-router can be reused from the same turn without provider dispatch; a former free drawing answer has a different input/schema and is not reused as language data. Old work-router slots stay intact. No catalog schema/profile, storage table, write authority or budget reset is added by this release. [State](bob-delivery-flow.md#six-outcomes-in-five-releases) retains the staged implementation and required gates.

`bob.execution_events` is service-only with RLS and no anon/authenticated grants.
It stores random run/turn correlation IDs, role/status, time, tokens, known cost
and bounded numeric/enum counters. No user IDs, project IDs, prompts, record
labels/IDs, images, arguments or provider error text are recorded. The same
journal pins the run identity. Model events are written **inside** actual model
operations, including observed retry failures; replay creates no second event.
The terminal delivery event upserts once per run. Diagnostics fail softly and
cannot overturn a successful project save.

Outcomes distinguish `receipt_matched`, `candidate_ready`, `partial`, `uncertain`,
`recovered`, `read_only` and `failed`. Counts include requested/missing goal groups,
verified saved records, main rounds/continuations, CAD renders/input corrections,
independent reviews and rejected reviews. Receipt matching proves kind/count/known
record identity; it does not certify all task semantics. CAD review is a separate
concept-quality signal. Unknown intent/cost remains unknown. Actual user follow-up
frequency and construction correctness are not inferred from these counters.

**Unknown provider outcomes (K5, code 2026-10-07; owner decision).** In a durable
turn, a definite 429/5xx provider answer is retried up to twice. A lost connection
(`Network error`, including a client abort) or a segment-wall cutoff after dispatch may
already be billed: the journal re-sends it at most once, and the delivered answer ends
with a fixed Swedish notice that one call was re-sent and may have cost extra. The
delivery event records `uncertain_resends`. OpenAI background mode, which avoids the
re-send entirely, stays behind the receiver rollout in
[shared AI background](shared-ai-background.md#rollout-and-rollback).

**Retry reuses paid model work (K5, code 2026-10-07; migration
`20261007180000_bob_retry_model_reuse.sql` not yet applied).** When a chat job finishes
as failed, its successful model results (`model:<function>:<position>` steps whose
result has `success: true`) are kept privately for that owner, thread and turn. An
explicit retry of the same turn answers a model call from them only when the input
fingerprint is byte-identical and the call has no retry markers; tools, writes and any
changed input still run normally. The kept results are deleted when the turn completes,
with the thread, or after seven days. The delivery event records `reused_model_calls`.
Jobs that expire without a worker finishing them keep nothing. Drawing requests keep
their own model-result ledger.

**Turn review reserve (K5, code 2026-10-07).** The in-memory turn threshold ($1 / 24
calls) holds back $0.15 and 3 calls for `cad-reviewer` and `bob-delivery-language`.
Other roles stop at $0.85 / 21 calls with budget-stop reason `review_reserve`; reserved
roles may use the whole limit, which still stops them. The drawing-request SQL budget is
unchanged.

Elapsed time runs from first admitted execution through the final result, including
worker waits but excluding initial queue delay. `scripts/report-bob-execution.sql`
reports outcome distribution, p50/p95 time, re-sent model calls and per-role usage/cost,
plus a role × model × reasoning-effort table (K5 comparison input). Each model row
records the returned model, the effort actually sent (null when none was applied),
cached-input and reasoning tokens, its journal step (`model:<function>:<position>`)
and `attempt` (0 = first dispatch; >0 = a re-send of the same input, which may also
have been billed). Rows written before 2026-10-07 have no model label. Cost per
correct delivery still needs a reviewed outcome per run joined on `run_id`.
Runs with model events but no terminal event remain unfinished/unobserved. Events
lost to a process kill before their insert are not an exactly-once billing ledger;
shared AI accounting remains authoritative. Compare identical ordinary-language
scenarios, actual saved readback and user acceptance before claiming a speed or
quality improvement. Release evidence belongs in the implementation PR.

## Durable background turns

**September 25 recovery correction (implementation):** checkpoint results are
delivered with a stable recursive object-key order before their first use and
after JSONB reload. Array order and every field/value are retained. This prevents
a saved compiler/CAD result from changing the next model prompt solely through
database serialization. Changed substantive inputs still stop replay. Read
adapters propagate scheduling signals instead of treating them as missing data.
A fresh explicit retry of a failed durable job reads current project state and
continues unfinished work with its existing write receipts; the legacy
synchronous path retains receipt-only recovery. The incident was reproduced at
the compiler → reviewer boundary, with a regression covering JSONB key reorder.

**September 25 retry bound:** a transient provider failure may retry twice for
the same operation/input, with the count checkpointed across worker restarts. A
third failure becomes `provider_retry_exhausted`, allowing the parent to explain
the actual failure and continue independent work. Previously the same failed
provider call could consume the entire twenty-minute job. Earlier successful
reads/writes still replay; changed substantive inputs still stop continuation.
**September 28 correction (pending deployment):** timeouts after a model request
has been dispatched at the worker's segment wall now consume that same retry
budget. Previously these yields could restart the same request without counting
towards its limit. Provider errors and segment timeouts share one initial attempt
plus at most two retries; switching error type does not reset the count. Waiting
for an existing background response and yielding before dispatch do not consume
retries. This bounds the legacy synchronous path; the durable Responses transport
addresses the cause by preserving the running provider job instead of resending
it when the worker releases its connection. It does not yet automatically
reorder terminally failed durable provider jobs, and an uncertain submission is
never treated as evidence that no work was accepted.

A single completion review checks attempted unfinished plan/CAD work and rejected
project writes before a premature final answer. Drawing orders additionally use
the delivery check above, including when CAD was never attempted. Neither adds
permissions; [bounded writes](ask-bob-writes.md#retry-failure-and-reset)
owns field diagnostics, correction tracking and partial-success evidence.

Named members opt in with `background: true` on the existing authenticated `send` request. `ask-bob` validates the caller and project, atomically claims the turn and enqueues a private job, then returns HTTP 202 with job id and expiry. Old clients and the shared guest retain their synchronous path. There is still one transcript and one domain-write ledger.

The pattern follows Launchpad's async dispatch, continuation driver and resume paths inspected at `cd2decea3aa3c661e86ef66af54bd00c3fa0ba82`. Bob owns its implementation: `bob-background.ts`, `bob-job-journal.ts` and the two September 24 background migrations. No Launchpad runtime dependency or separate AI provider is introduced.

`pg_net` dispatches `bob-worker`; the `bob-background-turns` cron task checks queued and expired worker leases every minute, independently of any browser. A random private per-job capability authenticates this worker endpoint (`verify_jwt=false` only here). An atomic claim issues a new worker token and increments the existing conversation generation; duplicate dispatches and stale workers cannot settle the active claim or write project records. The driver maintains the conversation lock while work is active. A killed worker is recoverable after its 150-second lease.

Each worker has a 140-second segment budget. Completed model responses, exact domain RPC results, CAD packets, media context and generated image bytes are checkpointed before proceeding. Re-entering the existing orchestration replays those results to rebuild loaded tools, specialist candidates and counters, then continues at the first unfinished operation. Input fingerprints stop divergent replay; domain revisions still guard new writes. If a write committed before its checkpoint was saved, the existing SQL receipt ledger reconciles the identical operation. A yield is an internal scheduling signal, never a failed user turn or invented user approval. Main model calls allow 100 seconds within a fresh segment; specialist budgets remain bounded. Transient provider errors can yield to a later attempt. Standard/high main-model settings and the canonical shared AI service are unchanged.

Journaled read deadlines seal either the result or the abort before checkpointing. Lookup, catalog and media readers wait for that checkpoint before delivering an outcome; a late SDK success cannot replace a timeout that Bob already saw. A pending shared AI job also pins the operation fingerprint and job identity before yielding. Changed input stops before another reservation or provider send. These markers grant no extra retry allowance, and membership, source freshness and image authority remain live checks.

The original short-lived caller JWT is encrypted with AES-GCM, bound to user/project/turn, and stored only in `bob_private`. The key derives from the existing server secret with a Bob-specific domain separator. No refresh tokens or synthetic named-user tokens are used. Every resumed worker revalidates the original Auth user; all domain operations keep that caller JWT and RLS. Project access, tool policy and retained image authority are checked live. Service access is limited to job/transcript metadata, content-free Bob execution diagnostics and existing shared AI configuration/accounting.

Jobs end by the earlier of caller-token expiry or 20 minutes, with the 60-claim and stall limits below. Terminal handling clears the encrypted token and operation journal immediately; terminal job metadata expires after seven days. A paid image generation whose outcome was lost after dispatch is stopped explicitly rather than silently generated a second time. Provider requests interrupted before a response/checkpoint may be billed and retried; this is not an exactly-once provider-billing guarantee. Domain writes retain their existing idempotency guarantee.

The browser polls the owned transcript and `bob_job_status`; an authoritative queued/running job overrides the old five-minute message-age heuristic. Leaving/reopening/reloading the chat does not resend the request. Actual failure or expiry offers recovery using the same turn id. The working hammer stays active while the job is queued or running. Reset remains blocked by the active conversation lock, and deletion cascades private job state without undoing domain writes.

Deploy `20260924120448_bob_background_jobs.sql` and `20260924120747_bob_background_driver.sql`, then the authenticated `ask-bob` and capability-authenticated `bob-worker`, before shipping the frontend opt-in. Both `pg_net` and `pg_cron` are prerequisites; enqueue fails closed when they are absent. Do not claim an ordinary-account CAD smoke from mocked browser/worker tests alone.

### Progress, stall detection and segment time — 2026-09-27

- **Stalls, not hops.** A claim whose previous segment saved at least one journal checkpoint resets the stall count. Five consecutive segments without a checkpoint fail the job as `background_stalled`. The 20-minute wall, the caller-token expiry and a hard ceiling of 60 claims remain; the former twelve-claim cap is gone.
- **Several calls per segment.** The journal reserves a realistic duration per model role (main Bob and the CAD designer 75 seconds, reviewer 60, plan compiler 45, others 15–30) instead of the full 100-second timeout. A call is capped at the segment's remaining time plus 8 seconds; if the segment wall cuts it off, the worker yields and the call restarts in a fresh segment without counting as a provider retry.
- **Live status.** Workers publish a content-free progress marker (stage, tool name, step, saved-change count) through the service-only `bob_job_progress`. `bob_job_status` returns it to the job owner while the job runs, and the chat shows a status line such as "Working on the drawings… · 2 changes saved".
- **Token lifetime.** Before a background send, the browser refreshes an access token that would expire within 25 minutes, so a long turn is not cut short by the sender's token.
- **Diagnostics.** `bob.execution_events` gains one `tool` row per executed tool call (tool name, status, step) and records `end_reason` on the delivery row (answered, asked, step or time budget, or the failure code). Rows stay content-free.

### Failed drawing background jobs — 2026-10-12

The existing claimed-job completion command now closes failed drawing children atomically with their operational result. `record_failed_drawing_job` marks the private packet and project header `retrieval_failed`, records `background_failed` or `background_expired`, and preserves the exact draft, source evidence, paid results, cost period, saved Artifact versions and original owner turn. A content-free execution event ties the failure to its drawing and AI job. The current initiating member receives one private assistant notice under the child-job ID; it advances the normal unread sequence without an explanatory model call. A missing acceptance receipt is reported as uncertain, never as a confirmed free/rejected operation or a reason to resubmit blindly.

The helper is private and idempotent. The existing lease/claim completion boundary remains; an older event cannot overwrite a newer mandate/attempt, saved drawing, cancellation or reset. Revoked membership receives no new private answer. Migration repair uses the same guards for still-current retained failures, without creating owner messages, jobs, grants or provider calls. Once existing authority/budget guards permit continuation, a source-current retained draft is rendered and independently reviewed before any new research/designer pass. A guarded preparation that never reached submission is distinguished from a legacy or started operation with a missing receipt. Only the latter retains the uncertain-cost failure wording. A new real owner message may authorize a distinct terminal attempt with the old accounting preserved; automatic continuations cannot. [Shared diagnostics](shared-ai-background.md#content-free-failure-diagnostics--2026-10-12) owns the failure ledger; [verification](foundation-verification.md#background-failure-diagnostics--2026-10-12) owns installation and acceptance limits.

Consecutive automatic failures for the same drawing and original mandate share
one visible notice when the exact error and missing-receipt status are unchanged.
Each attempt still records its own failure and updates the retained packet. A new
owner message, another reply, a different error or changed uncertainty permits a
fresh notice. This is checked under the existing thread lock using job/event
identity, never arbitrary text equality. Previously delivered history is retained.

## Lifecycle and UI

Reopen/reload/another signed-in device reads the same owned transcript. A → B → A navigation and auth changes invalidate local in-flight scope; late replies cannot leak into the other project/account. Current membership is checked around model calls and inside private commands, including after acquiring locks. Claim binding includes project, owner, thread, turn, generation and an unexpired lease. Summary/history RPCs are service-only and unavailable as ordinary-user shortcuts.

**New conversation → Clear chat and context** confirms deletion of the caller's current active thread, messages, summary and provider cursor. Cancel preserves the draft. Existing expected-sequence and busy-turn checks prevent clearing a concurrently advanced conversation. Saved project records and the independent write audit remain; other projects/users are untouched. Cross-tab reset notifications stop local transcript resurrection. Multiple named/archived chats and automatic retention are not implemented.

Compact chat is the default, with an **Aa** comfortable-spacing toggle stored as a device preference. Assistant bubbles use the available width; suggestions disappear after conversation begins. The multiline composer grows, expands/collapses without losing its draft and keeps Enter for a newline; Ctrl/Cmd+Enter submits outside IME composition. Scroll position is preserved while reading older messages; a latest-message control restores the end. Visual viewport height and safe-area padding keep controls reachable when the mobile viewport contracts.

### P2b project request lifecycle

**Deployed 2026-09-30 in [PR #167](https://github.com/EmelieHagander/Bob-the-builder/pull/167).** The first P2b slice separates a caller-created project request identity from its private working packet. The broader lifecycle contract below includes later gates; budget allocations, gap/Task links, restoration of cleared requirements and automatic wakeup are not implemented by this slice; the P2c extension below owns explicit restoration.

| State | Lifetime and access boundary |
|---|---|
| Project request identity | Stable request ID, Project ID, revision, delivery kind, lifecycle status/reason code, responsible project member, timestamps and validated same-project scope/destination references. Current project membership is required to read it. No transcript excerpts, private brief, specialist output or private thread identifiers in that projection. |
| Project requirements and gaps | References to canonical project requirements, sources, Tasks and Steps. Domain commands remain the owners of their content. A private collector assessment is not automatically published as a shared Task. Durable gap identity and links are a subsequent slice. |
| Private working packet | Owner-bound brief, assessment, source evidence, drafts and specialist state. Reset deletes it under the existing private context contract; project visibility never grants access to it. A missing packet must be reported, not reconstructed from another person's chat. |
| Completion and fencing | Exact saved Artifact/revision and delivery receipt reference; request revision/generation and cancellation tombstone survive private reset. Saved project artifacts remain authoritative. A stale attempt cannot complete a cancelled or superseded request. |
| Budget and authorization references | Request-owned identities independent of turn/attempt/thread, without credentials or private prompt content in the shared projection. Persistence must not imply that a budget allocation or an execution grant exists; accounting/reservations and automatic execution remain later gates. |

Create the minimal project record through a caller-authorized, idempotent command and bind the private working packet without copying its prose. Validate every scope, destination and receipt against this Project. Do not backfill shared content by scanning old private briefs. A deliberate new deliverable is distinct from a retry; IDs and expected revisions govern retries rather than title similarity.

Reset removes private working state but preserves the project identity, committed receipt, cancellation fence and any existing budget allocation/spend. An incomplete request whose only unsaved requirements were in that private packet remains visible with an explicit recovery reason. It cannot be labelled ready until canonical requirements and current sources are available. Project deletion follows the existing project lifecycle; a request must not be independently deleted in a way that permits late callbacks or duplicate completion. Automatic retention and cross-member reassignment require an explicit command contract, not implicit takeover.

Cancellation must lock the same request as completion, compare its expected revision and invalidate outstanding attempts. A completed receipt remains historical; cancellation cannot pretend its Artifact was never saved. Project members may supply complements through existing domain commands, but doing so does not adopt another member's private work or execution authority. The initial bounded implementation keeps execution and cancellation with the initiating authorized member; reassignment is a separate, explicit transition.

An event is a request to re-evaluate, not permission to spend or write. A later event consumer must recheck current membership, mandate, budget, request revision and changed source inputs, including after locking. Existing workers keep their original short-lived caller JWT, deadline and generation fences. No refresh tokens, synthetic user JWTs, service-role domain writes or fabricated user turns are introduced to make a next-day wakeup work. Expired authority yields an explicit paused state. Credential renewal, event deduplication and server-owned audit provenance for non-chat execution must be implemented at their owning boundaries before automatic recovery is enabled.

The first P2b code outcome covers the minimal identity/private-packet split, reset preservation and cancellation/completion serialization. Its required proofs are: owner reset preserves only allowlisted shared state; another authorized member sees that state without private content; outsider/revoked membership is denied; stale/duplicate and cancellation/save races cannot produce a new Artifact or reopen completion; the existing atomic receipt still replays. Task/UI wakeup, new-request semantic deduplication, persistent cost reservations and model/participant acceptance remain open after that bounded outcome.

**P2b runtime boundary.** New server-claimed drawing attempts create an idempotent minimal record with the caller JWT through `create_drawing_request`; the private request RPC then uses that same ID. The stable header is in `bob_private.project_drawing_requests`, with no raw browser or service-role table grants. It contains operational metadata and durable receipt/hash, not brief/assessment/pixels. Claimed-server packet updates mirror only revision/status; only the canonical caller-authorized CAD writer completes it atomically. Existing thread-only requests are left private without automatic promotion or backfill. A header whose first private checkpoint never commits is reported as `paused/context_missing`, not active work.

`project_drawing_requests` returns a paged field allowlist to current project members; it omits Auth/thread IDs, private payload and full audit receipt. `read_drawing_requests` exposes that reader to Bob. `cancel_drawing_request` checks current membership, original initiating member and expected revision, sharing the actor/request locks with completion and reset. Bob receives this tool independently of the design-consultation budget. Live request checks around specialist work stop further work after cancellation; an already dispatched model/render call may finish, but its late candidate cannot commit. Historical completed receipts cannot be cancelled into nonexistence.

The existing reset command still enforces its expected thread/sequence and busy-turn check. Its deletion trigger detaches the stable header before cascading the private packet and journal. Incomplete headers become `paused/context_cleared` with a new revision; saved/cancelled headers retain their terminal status and fence. After reset the owner can recover the exact completed receipt in a new claimed thread; an identical save returns it, while changed payloads fail. A paused request is discoverable but cannot resume using the deleted private requirements: the assistant returns `recovery_required` without calling a model or renderer. Explicit same-ID restoration is specified and implemented by the P2c extension below; its release status is separate. There is no dedicated request UI, cross-member takeover, event consumer or new spending allocation in this slice.

### P2c explicit request restoration

**Deployed 2026-09-30 in [PR #169](https://github.com/EmelieHagander/Bob-the-builder/pull/169).** `restore_drawing_request` restores the initiating member's paused request from one Step in the current approved Project Plan and a quote from their current instruction. Read the request revision and plan first. The backend reads **all** that Step's canonical requirements; callers cannot supply a replacement list. It validates Project, owner, claimed turn, expected request/plan revisions and immutable destination scope. A Step without requirements, an oversized handoff, a foreign destination or a stale plan is an explicit recovery failure. It never clips away requirements or creates a replacement request to bypass the failure.

Restoration atomically reconnects the same project identity to a fresh owner-private working packet and advances its revision to `collecting`. It preserves the exact scope and initiating owner; it does not claim readiness. The new packet contains canonical requirements plus the current owner message, empty image references and unknown coordinate mappings. Deleted private prose, drafts, reviews, old source snapshots and retry outcomes are not reconstructed. The current owner message is kept private. Only the plan/Step identities are retained as recovery references in the project header; the shared member projection remains unchanged.

A lost restoration response replays the same receipt for that claimed turn and expected revision; changed inputs conflict. Cancellation, completion, reset and revoked access still fence replay. An existing nonterminal restored request whose plan revision changed can be explicitly restored again from the new current plan; an unchanged active request cannot be reset just to retry. Saved receipts remain historical and replayable even when the plan later changes. No spend ledger or request budget is created or reset by restoration; existing turn/worker budgets and deadlines remain in force. Persistent cross-turn request spending policy is still open.

Bob receives the restoration tool on the existing drawing shelf independently of the design-consultation allowance. After restoration it continues `design_project_cad` with the same ID, preserving canonical requirement text and source references. Current facts, images, target and intake are read again before design; missing physical constraints and read failures retain their distinct outcomes. Fresh lifecycle checks stop model work when the plan changes. Database checkpoints and the canonical CAD writer also lock/check the recovery plan revision, so a late candidate cannot commit against changed requirements. An in-flight call may finish; its result is fenced. The conservative revision check also stops on unrelated edits to the same plan.

This bounded path requires canonical requirements in the approved plan. Unstructured requirements lost only in chat must first be explicitly restated and saved through the plan's existing commands. It adds no automatic event wakeup, dedicated recovery UI, cross-member adoption, persistent gap-to-Task mapping or new spending authorization. SQL/CI fixtures and release readback do not establish real model interpretation or participant acceptance; these remain in [State](bob-delivery-flow.md#state).

## Verification and deployment

The September 24 correction adds `20260924070107_bob_main_model_and_memory_settings.sql`
and `20260924070321_bob_context_action_receipts.sql`. Apply these before the matching
Edge code. The first configures standard/high main Bob and a separate mini/low
summary worker. The second replaces only the existing service-guarded context
reader, adding compact same-thread action receipts. Gist/index stays within the
existing summary column and compare-and-swap contract; no new transcript store.

The migrations are additive: `20260918194106_ask_bob_context_memory.sql` and `20260918194147_ask_bob_research_pages.sql`. Apply only those after checking the hosted registry; do not replay this repository's history into the shared database. Apply schema before deploying the matching `ask-bob` bundle. Preserve `verify_jwt=true` and the shared AI path; the September 24 migration sets main Bob to standard/high and gives memory folding a separate configuration. Existing frontend reset works with the new cascade.

Automated evidence covers exact five-message replay, incremental folding/CAS, failed summaries, private history, stale/revoked access, reset, selected-version provenance, query pagination/size limits and existing write retry guards. Browser evidence must cover 320/390/1280 widths, density, growing/expanded drafts, Enter semantics, scroll position, reset and saved-write receipts. Test fixtures are not live-model quality evidence.

Release checks: full CI/Edge build, hosted ordinary-role and service-guard tests on a rollback-only fixture, Pages success, then a post-deploy Auth→Edge→model smoke. The owner's ordinary-account conversation test remains the usability check for concise expert-like proposals, enough retrieval and faithful memory. Do not claim that a passing code suite proves construction advice is correct or that a guest smoke using disposable project data proves signed-in summarization/writes.


## Shared provider jobs and unread replies

The opt-in provider background transport supersedes the synchronous model waiting described above for newly enrolled Bob jobs. It preserves the existing caller authority and journal. [Shared AI background calls](shared-ai-background.md) owns the lifecycle, confirmed delegation notice, read receipts and staged rollout. Existing in-flight jobs retain their pinned transport. PR #152 deployed the schema, endpoints and unread UI on 2026-09-28; Bob’s receiver is now enabled after signed webhook acceptance. A full real-model/CAD turn after activation remains to be verified. The linked owner records exact release evidence.

### P2 completion: events, gaps and request accounting

**Deployed and technically verified: [PR #171](https://github.com/EmelieHagander/Bob-the-builder/pull/171), with live-boundary repairs in #172–#175. The PR records migration/runtime pins, real Auth/event/model save and readback, unchanged repeats and fixture cleanup. P0 participant acceptance and P4 broader outcome coverage remain separate.** This extension supersedes the open implementation boundaries in the P2b/P2c slice descriptions above.

A discovered gap has a durable opaque identity within its request. Its operational action, blocking state, assessment revision and existing Task/Step links survive private-chat reset; the collector's prose does not become shared Task instructions. `read_drawing_request_work` reads the links and budget. `link_drawing_gap` reuses existing work. `ensure_drawing_gap_task` atomically reuses/creates a Task only from an already shared current Plan requirement explicitly referenced by the gap; the requirement identity, not its title, deduplicates that Task across requests. Private-only needs remain chat complements unless linked to existing shared work. Task completion schedules reassessment; it never supplies missing measurements or resolves a gap by itself.

`resolve_drawing_request` reuses the initiating member's same scope and deterministic requirement identity. An active Step/Artifact-scoped request also retains its identity when its requirement wording changes. This is deterministic identity matching, not a claim of universal semantic equivalence for unrelated unscoped prose. A changed source, new worker, retry UUID or automatic continuation does not allocate budget. A distinct real owner message starts the fresh period owned by [the current task-budget contract](cad-adapter.md#one-budget-per-owner-task--2026-10-12). Terminal receipts remain exact historical receipts.

Bob-owned domain changes advance a project event revision. The existing queue starts at most one active event execution per request, using the original real instruction and a server-owned attempt record. No user message is fabricated or rewritten. The worker runs the drawing pipeline directly, reads fresh caller-authorized project sources and saves through the existing canonical CAD writer. It does not open a generic event-driven project-write loop. A completed event may add an assistant outcome; the original chat reply remains intact. Duplicate events and unchanged source/dependency fingerprints do not buy another model attempt. The dependency plan records bounded read instructions, including collector-discovered reads, and refreshes those sources before retry suppression. An unchanged failed designer/reviewer attempt retains its outcome rather than starting a fresh design. Collector source-citation, reviewer requirement-coverage and renderer transport contracts participate in the runtime fingerprint. When a changed runtime configuration or explicit cost allocation releases a technical stop while the source fingerprint still matches, the exact private recipe is rendered and independently reviewed before any designer call. A changed source requires fresh intake. Failure to save a recovery checkpoint remains explicit and never exposes an approved candidate.

Authority remains the initiating member's ordinary short-lived access JWT, sealed using the existing credential transport, with a maximum twenty-minute execution window. The signed-in app renews authority only for existing active delegated requests through authenticated `renew_requests`; this cannot create work, restore cleared context or increase budget. A closed/expired session leaves `authorization_needed` visible in request work. Membership, generation, cancellation and restored-plan revisions remain fresh backend gates. No refresh token, synthetic JWT, service-role domain writer or cross-member takeover is introduced.

The initial P2 request-wide accounting and later automatic +$1/+24 resume grant are historical policies. [The current owner task budget](cad-adapter.md#one-budget-per-owner-task--2026-10-12) bounds one real owner message, including its review/repair loop; the next message resets spend/calls to a full fresh period. Worker segments, retries and automatic events keep their original period. Accounting history and paid-result recovery persist; late charges belong to their original period. Conversation reset still erases private results and preserves minimal accounting; reset itself cannot fabricate another owner instruction.

Project Home and linked Task detail read the same request projection after reload, with current status, shared links, budget and owner controls. A saved historical Artifact is linked at its exact revision. Private context restoration remains the explicit P2c command; opening the app cannot silently recover erased requirements. P0's real user outcome and P4's broader product acceptance remain separate gates in [State](bob-delivery-flow.md#state).


## P4 event delivery and replay — deployed 2026-10-02

Drawing lifecycle tool reads and commands now checkpoint through the same private
turn journal. Replaying a worker reconstructs the original status/budget replies,
including the budget before that worker's later model calls. The fresh
`check_drawing_request` authority/reset/cancellation check remains outside the
journal, as does caller project access. A changed operation still stops; the
content-free diagnostic includes its operation key, never inputs or transcript.

A drawing event uses one bounded, tool-free language call to express its actual
CAD outcome in the owner's language, collecting indispensable missing inputs in
one question. Unchanged intake still suppresses paid research/design calls; it
can deliver its retained gap list. Technical failures remain distinct from missing
physical data. The existing private thread receives the answer atomically with
event completion through service-only `bob_finish_drawing_job`. Its saved evidence
comes from the canonical request receipt, not the language model. Duplicate/stale
claims, cancellation/reset and membership loss fence delivery. The original user
turn is preserved; no synthetic user turn or new mandate is created.

The reviewed migration and both Bob runtimes are deployed through PR #180.
[Verification](foundation-verification.md#p4-replay-and-event-delivery--2026-10-02)
owns release evidence and the outstanding real-member complement/save/link proof.


## Delegated Task completion — 2026-10-17

New Bob manifests opt in through
`agent-contract.ask-bob.metadata.work_completion_version = 1`. Only these main
Bob calls select phase-aware provider parsing. Final-answer messages take
precedence over progress messages; commentary continues using the same provider
cursor and durable turn. A second consecutive commentary closes the tool bench
and requests a final answer; a third stops with an honest bounded outcome. Tool
progress resets this small commentary streak. Legacy phase-absent responses,
older pinned jobs and strict specialist schemas retain their contracts. Refusal
and incomplete responses are distinct from successful completion.

The existing single completion review now includes attempted or saved work. It
compares the delegated request with current work snapshots, receipts reached at
that replay position and rejected outcomes. The review may finish remaining work
within the existing authority, time and write budgets, or report a genuine
blocker. It creates no follow-up job, budget reset or universal stop control.
Ordinary information answers do not acquire an extra classifier/review call.

**Completion gate (2026-10-19, publication `bob-completion-gate-v1`).** The v2
review regenerated every final answer, including read-only answers, at the main
role's effort (about 15% of turn cost on 2026-10-19). Manifests that contain
`role.completion-gate` first ask that small read-only role (mini/low, schema
`bob_completion_gate`) whether a read-only answer with no unfinished facts
leaves delegated work undone. Only a valid `work_remaining: false` skips the
review; a failed call or unreadable verdict keeps it. Turns that attempted or
saved work, or carry unfinished facts, are always reviewed. Pinned manifests
without the role keep their recorded review sequence. Metrics record
`completion_gate: done | review`.

Versioned method guidance integrates changes into complete Task instructions,
preserves relevant sources and unknowns, and distinguishes planning progress
from physical completion. Closing messages report saved and remaining work
without promising another run. Content-free metrics retain allowlisted phase,
validation and ending categories; they do not store raw SQL errors or prompt
content. The model stays GPT-5.4/high. The owner will test the real conversation
after [technical release](foundation-verification.md#bob-task-workflow-release-2026-10-17).
