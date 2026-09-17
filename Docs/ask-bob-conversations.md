# Ask bob — conversation state and context contract

> **Status: continuity implemented; reset implementation added in September 2026.** The runtime now stores private per-user/project transcripts and a server-private Responses cursor. Shared guest conversations remain device-local. Provider compaction/reseed and broader retention policy below remain planned, not shipped.
>
> The earlier 2026-09-13 local-only runtime summary is superseded by `20260915190000_ask_bob_conversation_continuity.sql`, its cleanup migration, and the current server/data modules. The reset's release gate is applying `20260917201626_ask_bob_conversation_reset.sql` before publishing its frontend. A committed migration is not proof of hosted deployment.

## Decision

Bob will deliberately separate three kinds of state:

1. **Bob owns the visible conversation.** The user-visible transcript is Bob data and will persist in Supabase so it can survive reloads and follow the signed-in user across devices.
2. **OpenAI carries the live model conversation state.** Bob will continue a provider-side Responses chain with a server-owned `previous_response_id` and opt into provider context management/compaction rather than replaying the whole transcript on every turn.
3. **The project database remains the only project-truth authority.** Old conversational context may explain pronouns, preferences and what was discussed, but it must never become evidence that a project quantity, status, dimension or decision is still true. Concrete project claims must use the current turn's fresh briefing / scoped lookup evidence.

In short:

`Supabase transcript + thread metadata` → what the user can see and recover

`OpenAI Responses chain` → live conversational continuity and compacted model context

`Bob project reads under caller authority` → current project truth

This is intentionally **not** a port of Launchpad's full working-memory / rolling-brief / searchable-history stack. Bob starts with the simpler provider-state design and only adds Bob-owned summarisation/search if real usage proves it necessary.

## Why this differs from Launchpad

Launchpad is deliberately provider-stateless: its OpenAI adapter opts out of provider storage and assembles bounded context itself. It therefore needs a short verbatim working-memory window, an older-turn fold/brief and separate retrieval surfaces.

Bob has a narrower single-assistant interaction and already uses the Responses API's server-only continuation inside its read-only tool loop. The first Bob conversation implementation should extend that seam across user turns instead of rebuilding Launchpad's orchestration memory architecture.

We **do** carry over Launchpad's useful principles:

- context growth must be bounded;
- important live state must have one explicit owner;
- stale conversation is not current truth;
- access fences apply on every read/release path;
- no silent truncation that changes what the model remembers;
- recovery paths must be designed before the happy path is called done.

## State ownership

| State | Owner | Browser-readable? | Lifetime |
| --- | --- | --- | --- |
| Visible user/Bob messages | `bob` database under per-user + project RLS | Yes, through normal app seam | durable until cleared/retired |
| Evidence shown under a Bob answer | `bob` database with the assistant message | Yes | same as transcript |
| Draft text not sent yet | client state | Yes, current device only | ephemeral |
| Active thread identity | `bob` database | Yes as an opaque Bob thread id if UI later needs it | durable |
| Provider `previous_response_id` cursor | server-private state | **No** | while thread is active/provider state exists |
| Provider response ids used during tool rounds | server-private audit/cleanup state | **No** | retention/cleanup policy |
| In-flight turn lock + generation | server-private/thread state | **No** | one turn |
| Current project briefing + lookup results | caller-authorised project reads | only the rendered evidence/result | one turn |
| Bob truth/authority rules | server code | No | sent fresh on every provider call |

The browser must never be allowed to supply `previous_response_id`, a provider conversation id, tool history, or a provider response chain. The existing request-boundary rule rejecting browser-supplied provider state remains.

## Thread identity

### V1 shape

Use **one active Bob thread per `(auth user, project)`**.

That gives the user the behavior they already expect from the drawer: reopen Bob in the same project and continue where they left off; switch project and get that project's separate conversation; switch back and recover the old one.

A later UI may support multiple named/archived conversations per project. The persistence model should not prevent that, but V1 does not need thread selection before continuity works.

### Shared guest exception

The public guest login is one shared Auth identity. Server-persisting a private chat under that shared identity would leak one person's Bob conversation to another guest user/device.

Therefore the shared guest must **not** get server-synchronised private conversation state in the first implementation. Keep guest history device-local and provider-stateless across separate questions until Bob has a unique guest/session identity that can safely own private history.

This is a privacy boundary, not merely a product limitation.

## Turn state machine

```text
                         project/auth changes
                               ┌───────────────┐
                               v               │
COLD/RELOAD ──resolve──> READY ──send──> CLAIM_TURN
     ^                     ^                   │
     │                     │                   v
     │                     │              CHECK_ACCESS
     │                     │              /          \
     │                     │          denied          ok
     │                     │            │             v
     │                     │            v       PERSIST_USER_PENDING
     │                     │         BLOCKED          │
     │                     │                           v
     │                     │                    PREPARE_FRESH_TURN
     │                     │                     rules + briefing
     │                     │                     + provider cursor
     │                     │                           │
     │                     │                           v
     │                     │                     CALL_PROVIDER
     │                     │                      /         \
     │                     │                tool calls      final
     │                     │                   │             │
     │                     │                   v             v
     │                     │             RECHECK_ACCESS  RECHECK_ACCESS
     │                     │                   │             │
     │                     │                   v             v
     │                     │              SCOPED_LOOKUP   COMMIT_TURN
     │                     │                   │       assistant + evidence
     │                     │                   └──>    provider cursor
     │                     │                         + unlock
     │                     │                              │
     │                     └──────────────────────────────┘
     │
     └──── reload/device switch reads Bob transcript + server cursor
```

Provider compaction is an internal transition inside `CALL_PROVIDER`; it must not change the visible transcript or project-truth rules.

### Failure branches

```text
CALL_PROVIDER / LOOKUP / COMMIT
        │
        ├─ transient/provider/db failure ─> FAIL_TURN ─> unlock ─> READY
        │                                  (user turn remains retryable)
        │
        ├─ provider cursor missing/expired ─> RESEED_CONTEXT ─> retry turn
        │
        └─ membership revoked ─> BLOCKED
                                 discard late answer
                                 do not advance provider cursor
                                 do not release project details
```

## Exact turn algorithm

### 1. Accept and bind the request

The browser sends an ordinary Bob question plus a client-generated **turn idempotency id** (for example a UUID). It does not send provider state.

The edge function:

1. authenticates the Supabase user;
2. validates the explicit active project;
3. verifies current project membership;
4. resolves/creates that user's active Bob thread for the project;
5. checks whether this `clientTurnId` was already completed or is already running;
6. atomically claims the thread's single in-flight turn slot.

Only one provider branch may advance a thread at a time. A second device sending at the same moment must not fork from the same provider cursor. The server lock/compare-and-swap is the authority; the current frontend `working` boolean is only local UX.

### 2. Persist the accepted user turn

Write the user's message as a Bob transcript row with a `pending`/in-flight delivery state and the idempotency id.

If the client retries the same id after a network timeout, the server returns/resumes the same logical turn rather than creating a duplicate message.

### 3. Build fresh current-turn context

Every user turn assembles a new current-turn envelope containing:

- the fresh `BOB_TRUTH_RULES` / authority instructions;
- a fresh project briefing under the caller's JWT;
- the user's new question;
- the server-owned previous provider response id, when one exists;
- the same bounded read-only project search tool.

**Do not rely on instructions inherited from an older response.** The Responses API explicitly documents that instructions from a response referenced by `previous_response_id` are not automatically carried into the next response. Bob's truth rules therefore remain explicit on every provider call.

The truth rules must also state the temporal boundary explicitly:

> Prior conversation may be used to understand what the user is referring to. Prior project details are potentially stale. Concrete project claims in this turn must be grounded in this turn's fresh briefing and current scoped lookup results.

### 4. Run the existing read-only tool loop

The first model call starts from the thread's committed provider cursor. Each tool-call response advances a **turn-local** cursor using the returned response id, exactly as the current single-question tool loop already does.

For each requested lookup:

1. recheck project access;
2. dispatch only the current fixed allowlist/query shape;
3. read with the caller's JWT;
4. return evidence to the provider using the turn-local continuation id.

The thread's durable provider cursor is **not** advanced yet. It advances only when the whole user turn succeeds.

This is important for failure safety: Bob's tools are read-only today, so if the process dies mid-turn it is safe to retry from the last committed turn and regenerate. If Bob later gains write tools, this retry contract must be revisited before those tools are allowed in a continued thread.

### 5. Final access check and atomic commit

Before exposing a slow model response:

1. recheck membership one final time;
2. reject/discard the answer if access was revoked;
3. persist the assistant text + evidence;
4. mark the user turn completed;
5. atomically update the thread's private provider cursor to the final response id;
6. release the in-flight lock.

The browser receives only Bob's answer/evidence. Provider ids remain server-only.

If the provider succeeded but the database commit failed, a retry may regenerate from the previous committed cursor. That can cost another model call but does not duplicate project writes because the tool surface is read-only. The idempotency id prevents duplicate visible turns.

## Context growth and compaction

### Provider storage is deliberate

The implementation must set provider retention behavior **explicitly**, not rely on an omitted default. The intended Bob posture is `store: true` for the Responses chain that provides conversational continuity.

This is a product/privacy decision: current OpenAI Responses documentation says stored response data is retained for at least 30 days, subject to retention exceptions. Bob should not enable provider state silently or accidentally through a shared-service default.

### Automatic context management first

Every continued Bob response should opt into the Responses API's current context-management/compaction feature with a conservative threshold verified against Bob's selected production model.

The desired behavior is:

- keep the provider-side conversation coherent without replaying the Bob transcript;
- compact before the model hits its hard context limit;
- preserve the browser-visible transcript unchanged;
- continue storing only the latest server-owned provider cursor needed for the next turn;
- record enough internal provider response ids/metadata for diagnostics and cleanup.

**Do not use silent oldest-item truncation as the normal overflow strategy.** Dropping the oldest items changes the conversation semantics invisibly. If compaction is unavailable/fails, Bob should enter an explicit recovery path instead of quietly switching to `truncation: auto`.

The exact `compact_threshold` is a release-tuning value, not a documentation guess. It must be chosen after a live capability check against Bob's configured model and observed token usage.

### Provider-state recovery (`RESEED_CONTEXT`)

A stored provider cursor may eventually be unavailable, deleted or rejected. Bob must still have a recoverable product conversation because the visible transcript is Bob-owned.

V1 recovery should stay deliberately simple:

1. invalidate the missing provider cursor;
2. start a fresh provider chain;
3. inject a **bounded conversational handoff** from the most recent Bob transcript messages, under a hard character/token cap;
4. label that handoff as conversational context only — **not project evidence**;
5. attach the fresh current-turn project briefing and truth rules;
6. continue normally and commit the new provider cursor.

Do not replay the unbounded full transcript. Do not build a Launchpad-style rolling summary worker unless actual Bob usage shows that the bounded recovery handoff loses materially important context.

## Reload and second-device behavior

### Reload on the same device

`AskBob` loads the active Bob thread + transcript from Supabase, then sends future questions through the normal server-resolved provider cursor. `localStorage` becomes at most a transition cache/fallback, not the conversation authority.

### Another signed-in device

The second device loads the same Bob-owned transcript because it resolves the same `(auth user, project)` thread. It never needs the provider cursor; the edge function resolves that privately.

### Project switch A → B → A

- A and B have distinct threads and provider cursors.
- switching cancels/invalidates the local in-flight generation scope;
- a late A answer may never render in B;
- returning to A loads A's transcript and continues A's server-owned provider chain.

The existing A → B → A delayed-response guard remains useful even after server persistence lands; client generation guards and server thread/project binding defend different boundaries.

## Auth changes and revoked access

### Sign-out / different account

Signing out invalidates local in-flight work. The server thread remains private to the account that created it. A different signed-in account in the same project gets its own Bob thread; project membership does not make personal Bob transcripts project-shared.

### Membership revoked before a turn

No thread/provider state is read or advanced and no provider call receives project data.

### Membership revoked during a turn

Bob already rechecks membership around slow/tool work; keep that property. A response generated after revocation is discarded before release and the provider cursor is not committed as the user's next conversation state.

The transcript may remain stored for retention/audit, but RLS denies access while the user is no longer a project member. Re-adding a user can restore access to their own historical thread if product policy keeps it; deletion/retention is a separate explicit choice.

## Persistence / schema direction

The exact migration belongs to the data/auth owner, but the conversation contract requires these semantics.

### User-visible `bob` data

A thread record needs at least:

- stable Bob thread id;
- project id;
- owning Auth user id (or an equivalent unambiguous owner binding);
- active/archived status;
- timestamps.

A message record needs at least:

- thread id + monotonic sequence;
- user/Bob role;
- text;
- Bob answer evidence when applicable;
- client turn idempotency id for user turns;
- pending/completed/failed delivery state;
- timestamps.

RLS must require **both** thread ownership and current project membership. Another member of the same project cannot read somebody else's Bob transcript.

### Server-private provider state

Provider continuation ids must live outside ordinary browser-readable project rows, for example in a guarded `bob_private` table keyed by Bob thread id. It needs:

- last committed provider response id;
- thread generation/version;
- in-flight turn id / lock timestamp;
- optionally every response id returned during tool rounds, to support diagnostics and best-effort provider cleanup.

The service-role client may manage this internal provider metadata, but it must never become a privileged substitute for project data reads. Project truth still uses the caller JWT + existing RLS/search RPC.

## Clear / new conversation

The drawer offers **New conversation**, followed by an explicit **Clear chat and context** confirmation. Cancel preserves messages and draft. The confirmed action deletes only the caller's active Bob thread for the current project, its messages and its server-private provider cursor; the next question creates a new thread with no inherited conversation state. This is a hard delete of Bob-owned active chat data, not an archive. Project records, selected decisions, measurements, the approved persona, other users' chats and the caller's other projects are unchanged.

The UI uses `database.ts` → `resetAskBobConversation` → caller-JWT `bob.bob_reset_conversation`. The privileged implementation is in `bob_private`, binds identity to `auth.uid()`, checks project access, takes the same advisory/thread/provider locks as turn claiming, and checks the expected thread id and sequence before deleting. There are no raw table write grants, user-id parameters or browser-readable provider identifiers. An active provider turn blocks reset; a lock older than the existing five-minute recovery boundary can be cleared, and an old commit cannot attach to a new thread.

The UI clears its transcript/draft/cache only after confirmed success. Errors, offline/unavailable Auth, denied access, active answers and stale revisions preserve the displayed chat with an actionable error. Shared guest/demo mode clears only this device's project/member cache and never resets a shared server identity. A project/member-scoped storage notification invalidates stale loads/replies in already-open same-browser tabs. Other devices read the empty/new active thread when Bob is reopened; this is not a real-time cross-device transcript subscription.

**Retention boundary:** disconnecting the stored cursor prevents reuse of the old provider conversation; this release does not call provider deletion APIs or claim erasure of provider-retained response objects. Provider retention/erasure remains a separate policy and implementation task. The reset does not erase facts deliberately saved into the project.

Verification: `tests/bob-reset.test.ts` exercises actual migration functions, authority, private-state deletion, revision guards, retries, busy/expired locks and fresh claims. `scripts/check-bob-reset-browser.mjs` drives the production build at 320/390/1280 px with HTTP fixtures for confirmation/cancel, failures, cache removal, reload, next question and cross-tab clearing. Hosted migration and release evidence belongs in the release PR; browser fixtures do not prove hosted provider deletion.

## Security invariants

1. Browser-supplied provider ids/history remain invalid input.
2. One active provider branch per Bob thread; cross-device concurrent sends cannot fork the cursor silently.
3. Thread history is user-private **and** project-fenced.
4. Project membership is checked before provider exposure, before every lookup and before releasing a final answer.
5. Provider context is conversational context, never project authority.
6. `BOB_TRUTH_RULES` are sent fresh every provider call.
7. Old project claims in provider context cannot satisfy the current-turn evidence requirement.
8. Service-role access may manage shared AI config/accounting and private provider metadata only; it does not read project truth for Bob.
9. Shared guest credentials never become a server-synchronised private-chat owner.
10. Context overflow must fail/recover honestly; no silent semantic truncation.

## Implementation slices

### Slice A — Bob-owned transcript

- add private-per-user/project thread + message persistence and RLS;
- load visible history from Supabase across reload/device switch;
- add turn idempotency and server-side single-turn locking;
- keep current provider behavior otherwise;
- preserve the shared-guest local-only exception.

### Slice B — provider continuity across user turns

- promote the final Responses id from the existing tool loop into server-private thread state;
- seed the next user question with that cursor;
- set provider storage explicitly to the approved Bob posture;
- keep provider ids out of browser contracts;
- update truth rules so prior project details are explicitly stale/non-authoritative.

### Slice C — context management + recovery

- extend the generic shared OpenAI service with the minimal provider-neutral option needed for Responses context management (no Bob-specific branch in the shared service);
- verify automatic compaction with Bob's actual production model;
- choose the compact threshold from live token evidence;
- add provider-cursor loss → bounded reseed recovery;
- log/measure compaction/reseed without exposing provider ids to the UI.

### Slice D — lifecycle UX

- retire `localStorage` as authority after a deliberate migration decision;
- add New conversation / Clear if wanted;
- make pending/failed/retry states explicit;
- keep mobile behavior and source disclosure intact.

### Slice E — live release proof

Verify at minimum:

- reload continues the same conversation;
- a second device signed into the same account sees the same Bob transcript and conversational continuity;
- project A/B histories and provider cursors never mix;
- two members of the same project cannot read each other's Bob threads;
- shared guest users do not receive each other's server chat;
- concurrent sends from two devices cannot fork the thread;
- a retry with the same client turn id does not duplicate visible messages;
- membership revoked before and during a turn leaks no answer/project details;
- a project fact changed since an earlier Bob message is read fresh and the old conversational value is not treated as evidence;
- a deliberately long thread crosses the configured compaction threshold without context overflow or visible transcript loss;
- an invalid/missing provider cursor takes the bounded reseed path rather than replaying the whole history or silently truncating;
- provider ids/history supplied by a browser are still rejected.

## Decisions still needing explicit ratification before code

The architecture above is specified; these deployment/product details are intentionally not guessed:

1. **Exact compaction threshold** for Bob's configured production model.
2. **Existing local history migration:** upload current device history into the new server transcript, leave it local/read-only, or start server history from deployment onward. Do not silently change this privacy boundary.
3. **Conversation retention / provider erasure:** active-chat reset is a hard delete in Bob; automatic retention and provider-object erasure remain undecided.
4. **Provider cleanup promise:** best-effort deletion only vs a stronger user-facing deletion guarantee (which determines how many provider response ids must be retained internally).
5. **Multiple conversations UI:** V1 starts with one active thread per user/project; named/archived threads can be added later without changing the authority model.

## OpenAI capability references

Implementation must re-check the live OpenAI API docs at build time; provider fields evolve independently of Bob.

- Responses create: `previous_response_id`, `store`, `context_management`, conversation-state behavior and current truncation semantics: <https://developers.openai.com/api/reference/cli/resources/responses/methods/create>
- Explicit compaction endpoint / continuation semantics: <https://developers.openai.com/api/reference/java/resources/responses/methods/compact>

The current API documentation states that `previous_response_id` creates multi-turn continuity, cannot be combined with a `conversation` object, stored responses default to provider storage unless opted out, and current Responses requests support context-management compaction. Bob's code must set the chosen behavior explicitly rather than depending on defaults.
