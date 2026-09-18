# Ask bob — conversation state and working context

> **Implementation: September 2026 context release.** This supersedes the earlier provider-cursor-only design and its unimplemented provider-compaction/reseed plan. Code and migrations are not deployment proof: the merged PR release record owns hosted migration versions, Edge version and live verification.

## Ownership and authority

There is one active private thread per `(auth user, Bob project)`. The database owns the visible transcript; normal-user RLS requires both thread ownership and current project membership. Another member of the same project cannot read it. The browser supplies only the current request and its stable turn UUID, never provider ids, history, a summary or a tool conversation.

The public `guest@bob.local` identity is shared. Its chat remains device-local and provider-stateless between questions, without private server summary/history or write tools. Do not merge local guest history into an ordinary account implicitly.

The project database remains the authority for **saved** project state. Conversation explains goals, references and corrections, but is not proof that an earlier quantity, status or dimension is still current. Fresh project reads use the caller JWT, never privileged service reads. User-supplied observations and new decisions can supersede an old saved plan; proposed sizes remain specifications/estimates, not invented measured evidence.

## Explicit T1 / T2 / T3 context

The shape is adapted from Launchpad's `docs/planning/laf-session-working-context-memory-tiers-canvas.md` (parked design, not a shipped library port). There is no Launchpad runtime dependency and no provider compaction claim.

| State | Source and boundary | Lifetime |
| --- | --- | --- |
| T1: recent conversation | Four most recent previous **individual messages**, plus the current pending user request. Full original text and role; sequence/delivery metadata in the frame. Not five pairs. | Rebuilt for each request |
| T2: older working brief | Private `bob_thread_summary`, thread FK, summary plus `last_folded_seq`. Only the prefix before T1 is folded. | Same thread; reset cascade deletes it |
| T3: original history | `search_conversation_history`, exact messages, role and sequence, literal query and exclusive sequence cursor. Same owner/project/thread/claimed turn. | Read-only, same thread |
| In-flight state | Existing turn claim, generation, lease and write receipts. Never reconstructed from prose. | Existing write/turn recovery contract |
| Project evidence | Fresh briefing and caller-RLS project tools. Not summary or history search. | Current turn |

An old failed request retried later remains the final current input, even if its original sequence is earlier. Delivery metadata distinguishes failed attempts from completed answers. Recent messages are never character-sliced. A summary is necessarily lossy: exact older decisions can be retrieved with T3, and saved state must be re-read with project tools.

### Incremental folding and failure

After claiming a turn, recover durable write receipts **before** any new model call. A receipt-only recovery skips both summarization and answer generation.

Otherwise, load T1 and the unsummarized older prefix under the service-only claim guard. Fold up to 16 old messages and approximately 60,000 characters per batch; one longer legacy message is kept whole rather than cut. A request makes at most four folds within a 105-second preparation budget. Each successful fold persists with compare-and-swap on the previous high-water mark and exact batch endpoint, then reloads. The summary has a 12,000-character storage limit, with a shorter prompt target.

The separate summarizer has no tools, receives no provider cursor, treats transcript text as untrusted data and preserves units, assumptions, explicit corrections, open dependencies and important sequence references. Claimed saves in prose are not receipts. It uses the same governed Bob model configuration, usage accounting and kill switch, not a new hardcoded model or cross-app setting.

Preparation is synchronous before answering, not Launchpad's proposed post-turn worker. When a long legacy thread needs more batches, return `context_preparing`; retry the same request to continue from saved progress. A failed fold returns an explicit failure rather than answering with silently missing history. Original messages are never rewritten. Exact recent text is not silently truncated on model-limit errors either.

### Provider calls

The first answer call starts a **new** provider chain containing fresh rules/briefing, the older brief labelled untrusted conversational data, and T1's original roles/text. The previous user-turn cursor is not used. Within the current turn only, tool results continue through server-owned Responses ids. The final id is still stored by existing commit machinery, but no longer supplies next-turn memory. Clearing Bob context does not promise erasure of already-retained provider objects.

The original approved persona remains byte-for-byte unchanged. Separate server rules ask for concise, concrete construction proposals, ordinary reversible working decisions and consistent dimension stacks. They do not grant safety certification, inspection/image capabilities, deletion, purchases, assignment or broader write authority. The listed available tools remain the capability authority.

## Research and execution budget

`search_bob_project_data_v2` keeps static caller-RLS projections and adds components, solutions, the selected target, artifacts and material requirements alongside existing datasets. It returns selected-target **exact solution-version** details and relevant saved measurement snapshots; the newest unselected solution is not substituted for the chosen version.

At most 12 project lookups (including the initial briefing), four conversation-history searches, eight model rounds and the existing eight project writes are allowed. The final round is tool-free; elapsed-time fencing reserves time to settle and commit within the existing lease. The model can follow `next_cursor`/`after_id` across project pages rather than assume the first page is complete. Related rows remain separately bounded; truncation is explicit. Oversized single project records return an error rather than an empty success or a stuck cursor.

Write permissions, exact-current-request quotes, optimistic revisions, settlement generation fencing and receipt-only recovery are owned by [ask-bob-writes.md](ask-bob-writes.md). Summary/history retrieval never counts as fresh project evidence or permission to write.

## Lifecycle and UI

Reopen/reload/another signed-in device reads the same owned transcript. A → B → A navigation and auth changes invalidate local in-flight scope; late replies cannot leak into the other project/account. Current membership is checked around model calls and inside private commands, including after acquiring locks. Claim binding includes project, owner, thread, turn, generation and an unexpired lease. Summary/history RPCs are service-only and unavailable as ordinary-user shortcuts.

**New conversation → Clear chat and context** confirms deletion of the caller's current active thread, messages, summary and provider cursor. Cancel preserves the draft. Existing expected-sequence and busy-turn checks prevent clearing a concurrently advanced conversation. Saved project records and the independent write audit remain; other projects/users are untouched. Cross-tab reset notifications stop local transcript resurrection. Multiple named/archived chats and automatic retention are not implemented.

Compact chat is the default, with an **Aa** comfortable-spacing toggle stored as a device preference. Assistant bubbles use the available width; suggestions disappear after conversation begins. The multiline composer grows, expands/collapses without losing its draft and keeps Enter for a newline; Ctrl/Cmd+Enter submits outside IME composition. Scroll position is preserved while reading older messages; a latest-message control restores the end. Visual viewport height and safe-area padding keep controls reachable when the mobile viewport contracts.

## Verification and deployment

The migrations are additive: `20260918194106_ask_bob_context_memory.sql` and `20260918194147_ask_bob_research_pages.sql`. Apply only those after checking the hosted registry; do not replay this repository's history into the shared database. Apply schema before deploying the matching `ask-bob` bundle. Preserve `verify_jwt=true`, model configuration and the exact persona. Existing frontend reset works with the new cascade.

Automated evidence covers exact five-message replay, incremental folding/CAS, failed summaries, private history, stale/revoked access, reset, selected-version provenance, query pagination/size limits and existing write retry guards. Browser evidence must cover 320/390/1280 widths, density, growing/expanded drafts, Enter semantics, scroll position, reset and saved-write receipts. Test fixtures are not live-model quality evidence.

Release checks: full CI/Edge build, hosted ordinary-role and service-guard tests on a rollback-only fixture, Pages success, then a post-deploy Auth→Edge→model smoke. The owner's ordinary-account conversation test remains the usability check for concise expert-like proposals, enough retrieval and faithful memory. Do not claim that a passing code suite proves construction advice is correct or that a guest read-only smoke proves signed-in summarization/writes.
