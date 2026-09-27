# Bob AI runtime review — 2026-09-27, compared with Launchpad

**Date:** 2026-09-27. **Baseline:** `main` at `ab1043a` (after PR #149). **Comparison:** Launchpad Aigentforge `main` as checked out the same day. This is a dated review, not a new runtime contract. Contract owners stay where they are: [tools](ask-bob-tools.md), [writes](ask-bob-writes.md), [conversations](ask-bob-conversations.md), [living plan](living-project-plan.md), [CAD](cad-adapter.md). The two earlier audits ([2026-09-24](bob-context-audit-2026-09-24.md), [2026-09-25](bob-tool-autonomy-audit-2026-09-25.md)) remain the record of the state they describe; where a finding below repeats one of theirs, it is marked.

**Question asked by the owner.** Bob is meant to run a whole project autonomously, keep everything it creates current, and report in compact messages. Instead it has trouble using its tools, stalls, and asks for confirmation several times. What does the request path look like, how do the models work together, how does that differ from Launchpad, and what should change?

**Method.** Code reading of every file on the request path in both repositories; Bob's own offline runtime audit (`node --import tsx scripts/audit-bob-runtime.ts --seed`, synthetic model and I/O, real orchestration); the migrated model settings and tool catalog. No live model runs, no production logs and no private conversations were used. Where a cause is inferred rather than reproduced, the text says so.

## 1. Summary

Bob's runtime is careful about truth and authority and weak at finishing. Five mechanisms, all in code, produce the experience the owner describes:

1. **Bob's own words are thrown away when the delivery check says work is unfinished.** The final answer becomes a server notice that lists the request back to the user; the model's explanation or question is dropped (`project-answer.ts:260`). Reproduced offline: three delegated requests end after seven model calls with the answer `⚠ ○ <the user's own sentence>`.
2. **Every write must quote the *current* user message as its authorisation** (`project-write.ts:21,100,222`; SQL `request_quote_required`). When a follow-up message only answers Bob's question, the cheapest way for the model to obtain a quotable authorisation is to ask another question. This is the structural incentive behind repeated confirmations.
3. **Approval is designed into the tool chains and then generalised by the prose.** Plan: compile → save proposal → `decide_project_plan` needs explicit approval. Drawing: `design_project_cad` refuses without a selected target → save a solution → select a target → design again (two consultations per turn) → independent review must pass → `save_cad_design`. The catalog guides contain 62 permission/authority caveats; the fixed system sections 28 more. Bob is told to act autonomously in one paragraph and told twenty times what it may not do without approval.
4. **A background turn gets roughly one main model call per worker hop and at most twelve hops.** The journal yields whenever `now + 100 s reserve + 8 s > segment start + 140 s` (`bob-job-journal.ts:67`, `ask-openai.ts:59-66,202`, `bob-background.ts:71`), each hop replays the loop with live access, catalog and validation reads, and `attempts >= 12` fails the job (`20260924120448…:107`). The user then sees "The previous answer was interrupted. Retry…". The advertised 24 rounds are unreachable in practice.
5. **Forced continuation instead of steering.** Up to seven follow-up model calls use `tool_choice: 'required'` or a named tool (`project-answer.ts:186,239-255`). A model that has a legitimate question must call something anyway, and then loses the question to mechanism 1. Launchpad never sets `tool_choice`; its only pause is a structured `request_user_input` tool.

Launchpad's runtime has the same shape (one edge function, one loop, discovered tools, a fold of older history) but three design choices Bob lacks: a structured way for the model to ask, authority carried by the server binding rather than by a tool argument, and time limits that pause and resume an exact message envelope instead of re-executing the loop. Sections 5 and 6 say what to adopt and in which order.

## Implementation status — 2026-09-27

Implemented on the same branch, owner direction: Bob communicates in text (no answer/input tool), tools are never forced, and Bob gets the whole toolbox.

| Finding | Status |
|---|---|
| F1 answer replaced by a notice | **Fixed.** Bob's text is always kept; server notices are appended. |
| F2 quote framed as authorisation | **Fixed, on the owner's explicit instruction.** A first attempt was refused by the session's safety classifier; the owner then directed the change. Bob no longer sees or supplies a quote: the server fills the current message as provenance, the SQL writers still check it, and guide wording asking for a quote is removed. |
| F3 approval chains and prose | **Partly.** The prompt was rewritten around running the project, keeping it tidy and asking only for what nobody else can supply, within the same word budget. Plan approval still needs the owner's explicit approval or instruction; the catalog guides' authority wording is unchanged. No input tool was added, per the owner. |
| F4 background hops | **Fixed.** Stall detection counts segments without progress; per-role reserves fit several calls per segment; cut-off calls restart cleanly; the browser refreshes the token before sending. The 20-minute wall stays. |
| F5 progress and effort | **Progress fixed.** Live status line from content-free progress markers. Reasoning effort is unchanged: there is no measurement to justify lowering it. |
| F6 tool surface | **Fixed.** The whole toolbox is offered every step on named shelves; waiting and used-up tools are listed with the reason. |
| F7 forced continuation | **Fixed.** No `tool_choice` anywhere, classifier removed, one factual completion note at most. The CAD designer's nudges are unforced too. |
| F8 missing lifecycle tools | **Fixed.** Seven tools: archive/restore Area, delete Task (not completed ones), delete build day, delete Shopping item, detach image, set phase, set build window. |
| F9 per-turn amnesia | **Partly.** The records consulted in the previous reply now reach the next turn as pointers. A folded work-state was not built. |
| F10 end reason | **Fixed.** Per-tool diagnostic rows and `end_reason`. |

Also fixed while implementing: access is re-checked before a reply's tool calls run; a refused record ID no longer ends the turn while access holds; extra tool calls in one step are deferred instead of failing the turn; server notes are user-role, because the shared adapter silently drops system-role messages.

## 2. The path of one Bob request

| Step | Where | What happens | Limits |
|---|---|---|---|
| 1 | `src/data/bobConversation.ts:129` | Browser posts `{action:'send', projectId, message, clientTurnId, background:true}` to `ask-bob`. | Message ≤ 4096 chars. |
| 2 | `_shared/bob-request.ts`, `serve-bob.ts` | Auth via caller JWT; body validated; `enqueueBobTurn`. | 24 KB body. |
| 3 | `_shared/bob-background.ts:20-43`, `bob_enqueue_job` | Turn claimed (`bob_claim_turn`), caller JWT sealed, job row written, `bob_dispatch_jobs` kicked; HTTP 202 returned. | Job expiry = min(JWT exp, 20 min). |
| 4 | `bob_dispatch_jobs` (pg_net), cron `bob-background-turns` every minute | `POST bob-worker` with the job capability. | 150 s lease; re-dispatch throttled 30 s unless yielded. |
| 5 | `bob-background.ts:47-93` | Worker claims the job (`attempts+1`, generation+1), opens the JWT, builds the journal, runs `answerWithOpenAi` under `EdgeRuntime.waitUntil`. | Segment budget 140 s; ≤ 12 claims per job. |
| 6 | `_shared/ask-openai.ts` | Builds caller-JWT lookup/writer/context/assistants; wraps every model call and RPC in the journal (`memo`). | Main model timeout 100 s in background. |
| 7 | `_shared/project-turn.ts` | Recovers receipts, prepares working context (fold older messages), runs the answer loop, settles writes, commits the transcript. | |
| 8 | `_shared/project-answer.ts:96-268` | Briefing read → round 0 work-intent classifier → per round: `toolbox.prepare()` → main call → execute ≤ 8 tool calls → repeat; forced continuation reviews; final notice or answer. | 24 rounds; 32 writes; 12 rejected writes; 12 reads main, 48 grounding; 2 CAD, 2 plan compilations, 4 plan edits; 12 image ops; 4 history searches. |
| 9 | `AskBob.tsx:341-362` | Browser polls `bob_job_status` and the transcript every 2 s until the assistant row commits; one static "Bob is working on the project…" bubble. | |

**Model calls that can run inside one turn** (settings from the migrations; effective output cap is `min(max(db, call), model)`):

| Role (`function_name`) | Model / reasoning | When | Purpose |
|---|---|---|---|
| `context-summary` | gpt-5.4-mini / low, 3000 | Before the loop, when older messages exist; up to 4 folds × 2 attempts | Gist + index of older conversation |
| `work-router` → `bob-work-intent` | gpt-5.4 / low, 4000 | Round 0, every turn with a writer | Structured list of requested results |
| `ask-bob` | gpt-5.4 / **high**, 16000 | Every round (≤ 24) | Main Bob |
| `work-router` → `bob-tool-discovery` | gpt-5.4 / low | On `list_tools` with a query | Capability search over the catalog |
| `plan-compiler` / `plan-reviewer` | mini / low, nano / low | On `compile_project_plan`, `edit_project_plan` | Compile Bob's intent; advisory review |
| `cad-designer` | gpt-5.4 / **high**, 16000 | On `design_project_cad`, up to 10 rounds with its own tools | Geometry candidate |
| `cad-reviewer` | gpt-5.4-mini / **high**, 5000 | After each candidate, ≤ 3 | Independent review; must pass before save |
| `work-router` → `bob-delivery-language` | gpt-5.4 / low | When the answer is replaced by a notice | Localise the notice |
| `project-image` | image model | On `generate_project_image` | Illustration |

**Tool surface per main call** (offline audit, seeded catalog = production catalog per `tool-catalog-parity.test.ts`):

| Project phase | Tools offered | System prompt chars | Serialized tool schemas | CAD offered directly |
|---|---:|---:|---:|---|
| none / complete | 17 | 7 086 | 22 259 B | no |
| concept | 22 | 7 209 | 48 119 B | no |
| design | 24 | 7 263 | 46 012 B | yes |
| planning / build | 26 | 7 310 | 42 295 B | no |

Every offered tool carries the catalog description, the code description **and the full `how_to`** in its description (`project-tools/session.ts:86`); `save_building_context` alone is 13 KB, `save_catalog_definition` 6.9 KB. The other 19–29 tools are reachable only through `list_tools` → `load_tool` → the *next* model call.

## 3. The path of one Launchpad request (for comparison)

Verified against `supabase/functions/session-router` and `_shared/ai-workers/inner-loop` in the Launchpad repo.

- **Entry:** `session-router` actions `start / message / continue / resume / abort`. Each HTTP request has a 22 s budget (`run-plan/constants.ts:21`); when it is reached the turn **pauses** with an exact message envelope and a `continue` call (frontend auto-continue ×5, or the continuation cron) resumes it by replaying the envelope, not by re-running the loop. The UI is fed by Supabase Realtime rows, so each message and event appears as it lands.
- **Loop:** `runInnerLoop` — ≤ 10 steps per speaker (`run-inner-loop.ts:185`), then one prose-only "force-finalize" nudge. Each step reserves credits, calls the gateway, settles. Invalid tool arguments go back to the model as `status:"invalid_args"` (`iteration-core.ts:1128`). `tool_choice` is never set by any adapter.
- **Tools:** union of `always_load` catalog rows, per-coworker grants, and tools found with `discover_tool` (deterministic ranker, model fallback) — found tools usable from the next step, same two-step cost as Bob. Only the short description is loaded; `how_to` is served on demand by `describe_tool` (ADR 0017).
- **Asking the user:** `request_user_input` is a tool that pauses the turn with a structured question card (`tool-registry/basic-tools.ts:302`). The base frame says to "look it up before you ask", and that the pause "is a short, single question and a rare one" (`sessions/prompt-assembly.ts:953-957`). The lead frame says "You don't need permission to start".
- **Authority:** the server binding (workspace, session, caller) is the authority; no tool argument carries it. Consequential external writes become `tool_action_proposals` cards the user approves in the UI; `compose_team` returns a composition card and pauses. `create_coworker` / `create_team` run immediately.
- **Autonomy:** a numeric `autonomy` column (0–100) on the coworker's settings row is turned into one tiered directive appended to the system prompt (`ai-policy/autonomy-directive.ts:57-89`): at 60+ "avoid asking the user for confirmation on routine investigation steps", at 80+ "dispatch a tool BEFORE answering when uncertain". Written for the same failure Bob shows (a coworker that narrated instead of acting).
- **Support models in a turn:** `knowledge_router` once before step 1; RAG + memorian brief inside `prepareAICall`; after the turn, memorian extraction and a serialized working-context writer + `session_brief_fold`. None of them second-guesses the main model's plan.
- **Memory across turns:** last 6 turns verbatim (8000-token cap), a consolidated brief with turn pointers, `recall_session_turn`, and a working-context JSON (goal, open loops) rewritten after each turn.
- **Documented lessons:** a Creation lead that "asked the user's nod in chat prose, materialised nothing, tripped `stalled_no_progress`" was fixed by routing the question through `request_user_input` (bugfix 2026-06-12); ADR 0092 "time is not a control surface" — limits exist to survive platform walls, never to ration output, and reset on progress; Saoirse's learning that "no deterministic guard is the reason a healthy turn ends".

## 4. Side by side

| Dimension | Bob | Launchpad |
|---|---|---|
| Request shape | 202 + background job; worker hops of 140 s; ≤ 12 hops; browser polls every 2 s | 22 s requests; pause envelope + continue; Realtime updates |
| Loop per speaker | 24 rounds nominal; ~1 main call per hop in practice | 10 steps; force-finalize nudge; retries only on truncation |
| Pre-main model work | Classifier every writer turn; fold; discovery search; delivery localisation | Knowledge router once; brief and RAG inside prepare |
| Tools offered | 17–26 with full guides inline, 22–48 KB | Short descriptions; `how_to` via `describe_tool` |
| Discovery | `list_tools` (model search) → `load_tool` → next call; unloaded call = `not_loaded` | `discover_tool` → next step |
| Asking the user | Prose only; prose replaced by a notice when goals are outstanding | `request_user_input` tool = structured pause; "rare, single question" |
| Write authority | `request_quote` from the *current* message, checked in TS and SQL; tool text says the quote "authorises" | Server binding; no argument carries authority; proposal cards for external writes |
| Approvals | Plan decision and target selection happen in chat; CAD review pass | UI cards (`tool_action_proposals`, composition card); plan-phase filter |
| Forced continuation | `tool_choice` required/named, up to 7 extra calls | None |
| Autonomy setting | The words "Autonomy: extra high." in the persona | Numeric column → tiered directive |
| Model config | Main gpt-5.4 high; helpers mini/nano | One settings row per (coworker, purpose); provider from the catalog; no `previous_response_id` |
| Memory across turns | 5 recent messages, gist, ≤ 16 receipts, history search | 6 turns verbatim, brief, recall, working-context JSON |
| Progress to the user | One static bubble | Placeholder message filled at turn end; events streamed by row |

Both runtimes are request/response without token streaming, both discover tools in two steps, and both fold older history. The differences that matter for the owner's complaint are the pause tool, the authority model, and the time model.

## 5. Findings

Severity: **P1** produces the reported experience directly; **P2** amplifies it; **P3** limits what Bob can do at all.

### F1 — P1: Bob's answer is discarded when work is judged unfinished (new)

`project-answer.ts:260`: `answer = missingDrawing || outstanding.length ? await formatNotice({...}) : answerText`. After the continuation reviews are spent, whatever the model wrote — a blocker explanation, a design question, a partial result — is replaced by the notice (`delivery-language.ts:27-36`): a heading, the unfinished goal descriptions and the saved receipts. The only channel for a reason is `drawingBlockerDetail`, and only when the CAD assistant returned `blocked` (`project-answer.ts:208`).

Reproduced with `scripts/audit-bob-runtime.ts --seed`: for "Skapa en uppgift för att mäta öppningen.", "Ändra planen och flytta uppgiften till rätt steg." and "Ta fram och spara materiallistan.", a model that declines ends after 7 calls, 0 writes, `ok=true, partial=true`, answer `⚠\n○ <the same sentence>`. In production the heading is localised, but the user still reads their own request back with no explanation. This is the "stall": a long wait, then a warning, then the user repeats the request, and the same thing happens because the classifier produces the same goal.

**Fix.** Never replace the model's text. Append the notice after `answerText` when goals are outstanding, and mark the evidence partial (it already is). When a structured `ask_owner` pause exists (F3), a question is a legitimate end and no notice is needed.

### F2 — P1: the write quote is framed as authorisation from the *current* message (new)

`project-write.ts:21`: "Exact 1–500 character quote from the CURRENT user message authorising this action, including a clear approval of an earlier option." Checked in TS (`:100`, `:222`) and in every SQL writer (`request_quote_required`). `propose_project_plan`, `decide_project_plan`, `link_project_plan_evidence` and `save_compiled_project_plan` repeat "authorising" in their schemas (`project-plan.ts`, `plan-assistant.ts:49`).

The general prose says the opposite — "Follow-ups continue the understood unfinished task" (`project-answer.ts:36`), and the intent classifier is told a question still delegates work (`work-delivery.ts:15`). But the check the model actually hits is the per-tool one, and a rejected quote costs one of 12 corrections. When the current message is "3 × 4 m, tryckimpregnerat" (an answer to Bob's question), the model must assert that this span *authorises* saving a plan. The safe move under that framing is to ask "Ska jag spara planen?" so that the next message contains a quotable yes. That is one extra round trip per delegated action, and it is what the owner sees.

**Fix.** Keep the quote as provenance (it is a good audit trail) but stop calling it authorisation anywhere the model reads. Let the server supply it: the round-0 intent already produces `request_quote` (`work-delivery.ts:8`); when the model omits the field or the message is a follow-up, fill it from the intent, and validate the substring server-side as today. Move the single sentence about authority into `writeContract`, phrased positively ("a delegated request authorises its ordinary prerequisites"), and remove "authorising / permission / not authority" from tool descriptions and `how_to` (62 occurrences in the catalog seed). Launchpad has no authority-bearing argument at all.

### F3 — P1: approval is designed into the chains, and the prose generalises it (extends 09-24 §6 and 09-25 A9)

- **Plan:** `compile_project_plan` (mini + nano) → `save_compiled_project_plan` → `decide_project_plan`, whose guide says the owner "must explicitly approve it or instruct this exact edit to be applied" and "A request for suggestions alone does not approve a plan". Plan approval is a product decision (living-project-plan §8) and should stay one. But it is executed as a *chat question*, and the model has no way to hand the decision to the UI.
- **Drawing:** `design_project_cad` returns `prerequisite_required` unless a selected target exists (`cad-assistant.ts:76-80`); Bob must save a solution and select a target, then consult again, with only two consultations per turn (`:46`); the candidate is saved only after the independent reviewer passes (`:127-140`); the reviewer runs gpt-5.4-mini at reasoning high on a 5000-token cap.
- **Prose:** the persona says "Ask when their observation or decision is genuinely indispensable" (`bob-prompt.ts:12`) and nothing about not asking otherwise. The fixed sections and guides then say "not permission", "not authority", "explicit", "never" 90 times between them. A model reading that will generalise "ask first" beyond the two designed gates.

**Fix.** (a) Add one tool, `ask_owner` (Launchpad's `request_user_input`): a structured pause with a short question and optional options. The turn ends with `status:'awaiting_owner'`, the UI renders the card, and the answer arrives as the next message. This makes asking visible, countable and rare by design, and it removes the need for F7's forcing. (b) Make plan approval and target selection **UI approvals**: Bob saves the proposal (allowed today), the transcript row carries `pending_decision`, the chat shows Approve / Reject, and the decision writes `plan_decision` directly without a model call. (c) Add the Launchpad autonomy directive as one positive paragraph in the persona ("You don't need permission to start; a delegated request includes its ordinary reversible choices; ask through `ask_owner` only for a decision or observation nobody but the owner can supply") and delete the duplicated caveats from the guides. Bob's CLAUDE.md north star already says this; the prompt does not.

### F4 — P1: background hops ration the turn to ~1 main call each, 12 hops maximum (new)

The journal yields when `now + reserveMs + 8000 > segmentDeadline` (`bob-job-journal.ts:67`). `reserveMs` is the model timeout (`ask-openai.ts:66`), 100 000 ms in background (`:202`); the segment deadline is worker start + 140 000 ms (`bob-background.ts:71`). A second main call in the same segment therefore starts only if the first finished within 32 s of worker start; with gpt-5.4 at reasoning high and 22–48 KB of tool schemas that is rare. Each hop then: `bob_yield_job` → `bob_dispatch_jobs` → pg_net → new worker → `bob_claim_job` (attempts + 1, generation + 1) → journal replay. Replay re-runs the loop from round 0: memoized model and RPC results return instantly, but `hasAccess`, `projectContext.validate()` and `toolbox.prepare()` (a `projects` and `tool_catalog` read) are live on every replayed round, and the tool-session, assistants and counters are rebuilt. At `attempts >= 12` the job fails as `background_expired` (`20260924120448_bob_background_jobs.sql:107`), the turn is failed, and the chat shows "The previous answer was interrupted. Retry to continue without repeating saved changes."

A turn that needs the classifier, six tool rounds, two continuation reviews and a delivery notice is already ten model calls. The loop's advertised "24 model rounds" (`project-answer.ts:64`) cannot be reached; the effective ceiling is the claim count, and the failure surfaces as a stall with a retry button.

**Fix.** Short term: set the reserve from the role's measured latency (execution_events already records `duration_ms`) rather than the timeout, and raise the segment budget to the lease minus a margin. Structural: adopt Launchpad's envelope pause — checkpoint the exact `messages`, offered tools, counters and assistant state at a yield, and resume by continuing at the next model call instead of replaying the loop. Count hops on *no progress* (a hop that produced a tool result or a write resets the count), per ADR 0092. Keep the 20-minute wall as the platform wall it is.

### F5 — P2: reasoning high everywhere, an extra classifier before every turn, no progress shown (extends 09-25 A7)

Main Bob and the CAD designer run gpt-5.4 at reasoning high; the CAD reviewer runs mini at high; the round-0 classifier runs gpt-5.4 (low) on every writer turn before Bob starts (`project-answer.ts:146-179`) and can itself trigger a yield. Launchpad's Edward learning applies: a reasoning model bound at a low output cap can spend the budget on reasoning and return nothing. Meanwhile the chat shows one bubble, "Bob is working on the project…" (`AskBob.tsx:219`), for the whole turn.

**Fix.** Emit a content-free progress row per round and per tool call (extend `execution_events`, which already has the shape) and render it as a status line: "Reading the plan… Saving task 2 of 4… Rendering the drawing… Waiting for review…". Set reasoning per role from measured outcomes rather than by default: main at medium unless measurement shows high pays; classifier on mini at minimal; reviewer at medium. Consider folding the classifier into the main call as a structured preamble field rather than a separate request.

### F6 — P2: tool surface weight and two-step loading (extends 09-24 §3 and 09-25 A2/A3)

Offered tools embed the full `how_to` (`session.ts:86`), which is why a Planning turn ships 42 KB of schemas on every round. On-demand tools cost `list_tools` → (model search) → `load_tool` → next call; a call to an unloaded but eligible tool returns `not_loaded` and wastes a round (`:124`). Launchpad pays the same next-step cost for discovered tools but keeps `how_to` off the initial load.

**Fix.** Keep `how_to` out of the offered description; return it from `load_tool` (as today) and from a `describe_tool` call for core tools. Pre-load from the intent: goal kind → tool names (drawing → `design_project_cad`, `save_project_solution`, `select_project_target`; material → `manage_project_material`, `search_material_catalog`; build_day → `save_project_build_day`), applied before round 1, so the common cases need no discovery round. Allow a `load_tool` and a call to the same tool in one batch to execute (schema validation already protects the write); the fence is worth keeping only for tools that were never loaded.

### F7 — P2: forced continuation fights the model (new)

Drawing reviews ×3 and work reviews ×3 set `tool_choice` to a named tool or `required`; the completion review adds one more (`project-answer.ts:186,239-255`). The model's text from each of those rounds is discarded. The offline audit shows the mechanics: seven model calls to arrive at the notice. Launchpad never sets `tool_choice`; at the step cap it appends one prose nudge and takes whatever the model says.

**Fix.** Replace the forced rounds with one nudge (system + user message as today, no `tool_choice`) that offers two exits: finish the listed results, or call `ask_owner` with the exact blocker. Keep `missingWork` as a label on the evidence (`partial:true` plus the list) rather than as a gate that rewrites the answer.

### F8 — P3: Bob cannot delete, archive or move what the UI can (extends 09-25 A9)

UI commands in `src/data/databaseCore.ts` include `deleteTask`, `deleteArea`, `setAreaArchived`, `deleteEvent`, `deleteMaterial`, `deletePerson`, `deleteAnnouncement`, `setTaskStatus`, `setTaskAssignees`, `setProjectPhase`, `updateProjectSchedule`. Bob's 45 tools offer archive/restore only for measurements, remove for plan steps and task dependencies, unlink for drawings and plan tasks. There is no task archive, Area archive, build-day removal, image detach, phase change or schedule change. "Ta bort …" therefore cannot succeed; Bob explains or asks, which reads as stalling.

**Fix.** Expose the existing canonical commands (`area_lifecycle_command` and the task/event equivalents) as archive/restore tools through `bob_project_write` with the same receipts, plus `set_project_phase`, `update_project_schedule` and `detach_project_image`. Archive-not-delete for anything with history.

### F9 — P2: per-turn amnesia of Bob's own work (repeats 09-24 §4 and 09-25 A1)

Each turn starts a fresh provider chain (`project-answer.ts:126`) with five recent messages, a gist, and ≤ 16 receipts stripped of records (`bob-working-context.ts:112`). What Bob read last turn, which IDs and revisions it was working with, and what it had decided to do next are gone. Launchpad rewrites a working-context JSON (goal, open loops, next) after every turn and injects it at the top of the frame.

**Fix.** After each committed turn, fold a compact `work_state` — goal, verified done, next action, real blocker, key record IDs and revisions — into the thread summary (a second field beside the gist) and put it first in the turn frame. Fresh reads still decide current truth.

### F10 — P3: the end reason of a turn is not observable

`execution_events` records model calls and one delivery row. It does not record which tool was offered/loaded/called, how many questions were asked, or why the turn ended (goals outstanding, budget, claims, notice). Without that, the acceptance matrix in the 09-25 audit cannot be measured.

**Fix.** One event per tool call (name, status, budget left), one per continuation, and an explicit `end_reason` on the delivery row. Run the 09-25 acceptance matrix nightly against a fixture project with the real model.

## 6. What to adopt from Launchpad, and what not to

**Adopt:** `request_user_input` as a structured pause; authority in the server binding rather than in an argument; approval as UI cards; the envelope pause/resume; the autonomy directive as one positive paragraph; short tool descriptions with `how_to` on demand; a working-context fold with open loops; per-step progress rows. **Do not adopt:** `stalled_no_progress`-style guards as convergence verdicts — Launchpad's own bugfix (2026-06-12) shows the guard firing on a legitimate propose-then-await turn — and the 10-step cap as a hard ceiling; Bob's work is longer-running than a chat turn and should pause and resume on progress instead.

## 7. Recommended order

Phase 1 — days, no schema change:

1. Append the notice to Bob's text instead of replacing it (F1).
2. Add `ask_owner`; remove `tool_choice` forcing; one nudge with two exits (F3b, F7).
3. Strip authorisation language from tool descriptions and guides; server-fill `request_quote` from the intent (F2).
4. Measured reserve and a lease-sized segment budget; `end_reason` on the delivery event (F4 short term, F10).
5. Progress rows and a status line in the chat (F5).

Phase 2 — structural:

6. Envelope pause/resume with hops counted on no progress (F4).
7. Plan and target approval as UI cards that write without a model call (F3a).
8. `work_state` fold per turn (F9).
9. `how_to` on demand; intent-driven pre-load; same-batch load and call (F6).
10. Archive, phase, schedule and detach tools (F8).
11. Reasoning effort per role from measurements; classifier on mini (F5).

Then run the 09-25 acceptance matrix (plain Swedish requests without API names; saved end result, revisit, correct role, one failure path) with the same model before comparing models. Model choice is the last variable, not the first.

## 8. Limits of this review

No live model calls were made and no production logs or private conversations were read. F1, F4 and F7 are reproduced mechanically (offline audit and code); F2 and F3 describe incentives that the code creates and are the most plausible cause of the repeated confirmations, but their frequency in real turns is not measured here. The Launchpad comparison is against its `main` on 2026-09-27; Launchpad's own docs note that its prompt-example rule is a process rule without a scanner, so it is a source of patterns, not of finished answers.
