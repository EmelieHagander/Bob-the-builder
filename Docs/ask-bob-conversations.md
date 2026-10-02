# Ask bob — conversation state and working context

> **Implementation: September 2026 context release.** This supersedes the earlier provider-cursor-only design and its unimplemented provider-compaction/reseed plan. Code and migrations are not deployment proof: the merged PR release record owns hosted migration versions, Edge version and live verification.

## Ownership and authority

Drawing-request recovery is owned by [CAD adapter — P2a](cad-adapter.md#p2a--request-recovery). It is deployed through [PR #165](https://github.com/EmelieHagander/Bob-the-builder/pull/165). It adds an intake retry condition across turns and binds completion to the CAD receipt without creating a second transcript or broadening private-thread access.

There is one active private thread per `(auth user, Bob project)`. The database owns the visible transcript; normal-user RLS requires both thread ownership and current project membership. Another member of the same project cannot read it. The browser supplies only the current request and its stable turn UUID, never provider ids, history, a summary or a tool conversation.

The public `guest@bob.local` identity is shared. Its chat remains device-local and provider-stateless between questions, without private server summary/history or write tools. Do not merge local guest history into an ordinary account implicitly.

The project database remains the authority for **saved** project state. Conversation explains goals, references and corrections, but is not proof that an earlier quantity, status or dimension is still current. Fresh project reads use the caller JWT, never privileged service reads. User-supplied observations and new decisions can supersede an old saved plan; proposed sizes remain specifications/estimates, not invented measured evidence.

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

Newly generated gists are constrained to 6,000
characters and pointer topics to 200 in the output schema and runtime validation.
The complete JSON still must fit 12,000 characters. Older valid stored briefs may
exceed the new gist target; they remain readable and are recompressed on the next
fold. An invalid size, shape or sequence index gets one repair attempt from the
same original sources within the preparation deadline. Only a valid fold advances
the compare-and-swap watermark. Neither failed candidate is truncated or saved;
two failures preserve the prior brief and exact transcript and return the existing
retryable failure. Journal replay reuses the first response across worker yields.
Diagnostics record validation reason and size, never conversation text. This
repairs the failure before main Bob, image inspection or CAD can start; a guest
read-only release check does not exercise private-thread summarization.

Preparation is synchronous before answering, not Launchpad's separate fold worker. When a long legacy thread needs more batches, return `context_preparing`; retry the same request to continue from saved progress. A failed fold returns an explicit failure rather than answering with silently missing history. Original messages are never rewritten. Exact recent text is not silently truncated on model-limit errors either.

### Provider calls

The first answer call starts a **new** provider chain containing fresh rules/briefing, the older brief labelled untrusted conversational data, and T1's original roles/text. The previous user-turn cursor is not used. Within the current turn only, tool results continue through server-owned Responses ids. The final id is still stored by existing commit machinery, but no longer supplies next-turn memory. Clearing Bob context does not promise erasure of already-retained provider objects.

The original approved persona remains byte-for-byte unchanged. Separate server rules ask for concise, concrete construction proposals, ordinary reversible working decisions and consistent dimension stacks. They do not grant safety certification, inspection/image capabilities, deletion, purchases, assignment or broader write authority. The listed available tools remain the capability authority.

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

Elapsed time runs from first admitted execution through the final result, including
worker waits but excluding initial queue delay. `scripts/report-bob-execution.sql`
reports outcome distribution, p50/p95 time, retries/repairs and per-role usage/cost.
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

Release checks: full CI/Edge build, hosted ordinary-role and service-guard tests on a rollback-only fixture, Pages success, then a post-deploy Auth→Edge→model smoke. The owner's ordinary-account conversation test remains the usability check for concise expert-like proposals, enough retrieval and faithful memory. Do not claim that a passing code suite proves construction advice is correct or that a guest read-only smoke proves signed-in summarization/writes.


## Shared provider jobs and unread replies

The opt-in provider background transport supersedes the synchronous model waiting described above for newly enrolled Bob jobs. It preserves the existing caller authority and journal. [Shared AI background calls](shared-ai-background.md) owns the lifecycle, confirmed delegation notice, read receipts and staged rollout. Existing in-flight jobs retain their pinned transport. PR #152 deployed the schema, endpoints and unread UI on 2026-09-28; Bob’s receiver is now enabled after signed webhook acceptance. A full real-model/CAD turn after activation remains to be verified. The linked owner records exact release evidence.

### P2 completion: events, gaps and request accounting

**Deployed and technically verified: [PR #171](https://github.com/EmelieHagander/Bob-the-builder/pull/171), with live-boundary repairs in #172–#175. The PR records migration/runtime pins, real Auth/event/model save and readback, unchanged repeats and fixture cleanup. P0 participant acceptance and P4 broader outcome coverage remain separate.** This extension supersedes the open implementation boundaries in the P2b/P2c slice descriptions above.

A discovered gap has a durable opaque identity within its request. Its operational action, blocking state, assessment revision and existing Task/Step links survive private-chat reset; the collector's prose does not become shared Task instructions. `read_drawing_request_work` reads the links and budget. `link_drawing_gap` reuses existing work. `ensure_drawing_gap_task` atomically reuses/creates a Task only from an already shared current Plan requirement explicitly referenced by the gap; the requirement identity, not its title, deduplicates that Task across requests. Private-only needs remain chat complements unless linked to existing shared work. Task completion schedules reassessment; it never supplies missing measurements or resolves a gap by itself.

`resolve_drawing_request` reuses the initiating member's same scope and deterministic requirement identity. An active Step/Artifact-scoped request also retains its identity when its requirement wording changes. This is deterministic identity matching, not a claim of universal semantic equivalence for unrelated unscoped prose. A changed source, new worker, new turn or new UUID does not allocate budget. Terminal receipts remain exact historical receipts.

Bob-owned domain changes advance a project event revision. The existing queue starts at most one active event execution per request, using the original real instruction and a server-owned attempt record. No user message is fabricated or rewritten. The worker runs the drawing pipeline directly, reads fresh caller-authorized project sources and saves through the existing canonical CAD writer. It does not open a generic event-driven project-write loop. A completed event may add an assistant outcome; the original chat reply remains intact. Duplicate events and unchanged source/dependency fingerprints do not buy another model attempt. The dependency plan records bounded read instructions, including collector-discovered reads, and refreshes those sources before retry suppression. An unchanged failed designer/reviewer attempt retains its outcome rather than starting a fresh design. Collector source-citation, reviewer requirement-coverage and renderer transport contracts participate in the runtime fingerprint. When a changed runtime configuration or explicit cost allocation releases a technical stop while the source fingerprint still matches, the exact private recipe is rendered and independently reviewed before any designer call. A changed source requires fresh intake. Failure to save a recovery checkpoint remains explicit and never exposes an approved candidate.

Authority remains the initiating member's ordinary short-lived access JWT, sealed using the existing credential transport, with a maximum twenty-minute execution window. The signed-in app renews authority only for existing active delegated requests through authenticated `renew_requests`; this cannot create work, restore cleared context or increase budget. A closed/expired session leaves `authorization_needed` visible in request work. Membership, generation, cancellation and restored-plan revisions remain fresh backend gates. No refresh token, synthetic JWT, service-role domain writer or cross-member takeover is introduced.

Each new request starts with the existing $1 / 24-call stopping policy, now reserved and accounted across turns, worker segments and retries. The cost threshold is checked before each call; the last in-flight call can exceed it. Identical model inputs recover their private result without another paid dispatch. Unknown outcomes remain reserved; known late provider charges reconcile exactly once from Bob's shared AI usage receipt. Private result payloads disappear with the thread; minimal accounting remains with the request. Unpriced or unresolved usage blocks further spending. A separate owner-only, idempotent budget command adds $1 / 24 calls without changing the work mandate; the UI presents that concrete allocation before applying it. Older project requests receive no inferred historical costs or free refill: their pre-migration accounting is marked untracked, with zero further allocation until explicitly extended.

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
