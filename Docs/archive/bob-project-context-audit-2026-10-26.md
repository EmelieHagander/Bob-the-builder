# Project context and small-model audit — 2026-10-26

**Dated, read-only runtime assessment.** This records the owner's request to audit the existing equivalent of a small project librarian. It does not authorize or implement a new agent. Current behavior and future decisions belong to [project context](../ask-bob-context.md), [conversation memory](../ask-bob-conversations.md), [tools](../ask-bob-tools.md) and the [AI catalog](../../supabase/README.md#ai-definition-catalog-and-model-tiers). Remaining delivery work belongs to [State](../bob-delivery-flow.md#state).

## Conclusion

Bob already has much of the infrastructure: deterministic project orientation and facts, private conversation summaries, hybrid history retrieval, exact domain views, reusable operation results, and versioned model roles. It does **not** have a running general-purpose small model that knows the whole project, gathers relevant sources across domains and prepares each specialist's input.

The smallest extension is an on-demand source-selection/read operation built on those existing readers. Structured facts and dependency traversal should remain code. A smaller model can interpret selected unstructured sources when necessary. Solution, Construction and Artifact remain the domain owners; a reader's output is derived evidence, not another project truth.

## Evidence boundary

- Local clean `main` and remote `main` both resolved to `25118c4a5a1168545ee63318387a1959986c3cd5` before this audit report was added.
- Read-only hosted checks confirmed `ask-bob` v175 and `bob-worker` v143, matching the versions in the [completed FORM release evidence](../foundation-verification.md#form-concept-loop--local-synthetic-verification-2026-10-26). This audit checked version metadata, not a new full deployed-source comparison.
- Read active `shared.ai_prompts` → `shared.ai_prompt_versions` definitions, tier bindings, migration ledger and selected function privileges in Bob's existing Supabase project. No configuration, schema or project records were changed.
- Read aggregate `shared.ai_usage_events` and content-free `bob.execution_events`. No private message bodies or credentials were retrieved.
- Completed 38 focused local tests across five files; no live model call, CAD call, workflow or deployment was started. Tests establish the listed technical behavior, not model comprehension or a completed owner journey.

## What exists now

| Capability | Actual behavior and model | Boundary |
| --- | --- | --- |
| Project facts at turn start | Code reads rooms, construction counts/revisions/roles/fastener totals, drawing lineage/status and material-need summaries. `projectFactsVersion: 1` is pinned for new executions. | Bounded observation with explicit omitted counts, not a complete project dump or authority for subsequent writes/checks. |
| Project orientation | Code resolves screen/saved focus, ancestors, peers, children and exact completion requirements. Long overview/focus text is cut with warnings and source pointers for new facts-enabled turns. | The starting overview is not selected semantically for every question. The full description is not automatically present. |
| Samtalsminnet (`context-summary`) | Active `gpt-5.4-mini`, low effort. Incrementally summarizes older messages from the current private conversation; five recent originals remain separate. Active schema is gist-only, with server-owned fold coverage. | Does not browse the project or prove that all important meaning survived compression. Originals remain retrievable. |
| Minnesindexet (`memory-embedding`) | Active `text-embedding-3-small`, 256 dimensions; hybrid lexical/semantic retrieval plus exact paged message reads. | Searches this private conversation, not all project records or other members' conversations. Index/model/source fingerprints preserve identity; lexical reads survive embedding failure. |
| Arbetsminnet (`context-compactor`) | Active catalog role using Mini/low; can summarize an authorized operation chain for continuation. | New main requests with `result_reference_version: 1` bypass this compaction branch. It remains reachable for non-reference/older chains, not an automatic whole-project librarian. |
| Projektöverblicken (`context-presentation`) | Active catalog role using Mini/low; shortens already-supplied oversized orientation blocks. | New facts-enabled turns use deterministic cuts instead. Catalog activation alone does not mean a role runs on each turn. |
| Exact construction views | Code supports overview, parts, parameters, bindings, joints, materials, roles, notes, dependencies and saved result views, with exact revisions and selected IDs. New turns also have a compact parts/joints table. | These reusable selectors already exist; a general reader should consume them rather than duplicate them or summarize raw geometry by default. |
| Images | Image-only catalog, metadata listing, caller-scoped pixel opening and optional descriptions. | `describe_project_image` stores Bob's description of an image he already viewed. It is not a separate cheap image reader. Other project data uses existing search/detail tools. |
| Färdigkollen (`completion-gate`) | Active Mini/low; asks whether a candidate answer leaves delegated work unfinished. | Receives the latest instruction, conversation context and candidate answer. It is neither a project researcher nor an independent geometry/requirement verifier. |
| Nano | `tier.nano` binds `gpt-5.4-nano`; the enabled plan-reviewer role uses it. | No Nano usage was recorded for Bob in the queried 19–26 October interval. This is configuration evidence, not proof of recent execution or quality. |
| Minnesagenten (`memory-agent`) | Cataloged role exists with `enabled: false` and `cataloged_proposal_not_runtime_capability`. | Its general save/recall/archive lifecycle is not implemented. Enabling the definition would not create the missing runtime. |
| General Project Librarian / category router | Broader design is documented; no executable `ask_project_librarian`, `runContextRouter` or `ProjectResearchResult` implementation was found in the runtime/client TypeScript. | The later owner decision explicitly replaces the proposed turn-start model router with code-read facts. |

Source map: [turn setup](../../supabase/functions/_shared/ask-openai.ts), [model input](../../supabase/functions/_shared/project-answer.ts), [orientation](../../supabase/functions/_shared/bob-project-orientation.ts), [memory folding](../../supabase/functions/_shared/bob-working-context.ts), [brief policy](../../supabase/functions/_shared/bob-conversation-brief.ts), [retrieval](../../supabase/functions/_shared/bob-memory-retrieval.ts), [continuation](../../supabase/functions/_shared/bob-context-continuation.ts), [result references](../../supabase/functions/_shared/bob-result-references.ts), [construction views](../../supabase/functions/_shared/construction-views.ts), [image dispatcher](../../supabase/functions/_shared/project-context/dispatcher.ts).

The active main agent contract was v9, with `context_strategy_version: 1`, `complete_request_version: 1` and `result_reference_version: 1`. The active conversation-brief schema was v3 with `memory_gist_only_version: 1`. Hosted ledger entries included `20261018090740_bob_source_linked_memory_retrieval`, `20261018193000_bob_memory_gist_only`, `20261019214955_ai_bob_complete_context` and `20261026132719_project_facts`.

## Findings

### 1. Source collection still belongs largely to main Bob

The small context roles have no project-reading tools. Their inputs are a supplied conversation, supplied orientation blocks or an operation history. Main Bob still chooses project searches, construction views and image opens; specialists receive domain-specific handoffs assembled by the existing code. A reusable cross-domain source package is the material gap relative to the proposed librarian.

This is a capability gap, not evidence that the existing summaries are broken. Reuse `search_project_data`, exact record sections, construction views and the existing image adapter before considering another catalog or index.

### 2. Memory coverage does not prove requirement coverage

The gist-only fold validates shape/size and tracks which original messages were processed. It does not machine-verify whether every correction or constraint survived the prose summary. Similarly, the bounded startup packet and an orientation prefix are honest partial views, not a guarantee that every relevant project requirement is present.

For a future reader, exact selected Solution/Construction revisions, known dependencies and explicit governing requirements should enter through the existing domain readers. The reader should report missing sources, conflicts and omissions; Bob must retain access to originals. Do not widen the private conversation index into cross-member memory as a shortcut.

### 3. Some previously expensive context work has already been replaced

New main requests use deterministic references to older tool results, retaining originals in the operation archive. New facts-enabled orientation avoids `context-presentation`. Exact construction views already follow selected dependencies and preserve revision-bound results.

Do not restore an automatic model router or an always-running summary layer to achieve the librarian proposal. Historical compactor/presentation usage is not evidence that today's main path still pays those costs on every turn.

### 4. Per-model timing cannot currently support a reliable speed comparison

For the queried usage rows, `shared.ai_usage_events.latency_ms` was null. Execution events had implausibly short model durations for a provider-latency comparison: the main-model median was about 0.15 seconds over 19–26 October.

Code explains the limit: [ask-openai.ts](../../supabase/functions/_shared/ask-openai.ts) times the invocation that finally returns a result. Pending asynchronous work yields before recording that event, and [ai-background.ts](../../supabase/functions/_shared/ai-background.ts) can return the stored response on resume. Thus `duration_ms` can represent result retrieval rather than elapsed inference. This is a measurement gap, not evidence of subsecond model generation.

Use job submission/completion times and whole-turn delivery time for an evaluation. `context-summary` accounting also groups several distinct roles; execution-event `ai_role_version_id` can disambiguate them through immutable catalog versions.

### 5. A source reader cannot replace 2D/3D review

The [CAD reviewer handoff](../../supabase/functions/_shared/cad-assistant.ts) already includes the original owner request, independent evidence, exact candidate geometry, selected intent, required feature IDs, source images and rendered views. Preserve that independent path.

The [FORM evaluator](../../supabase/functions/_shared/solution-concept.ts) checks numeric geometry, constraints and feature links. A link does not prove that a requested function is semantically satisfied. A general source reader would help prepare evidence, but would not implement the missing independent 2D intent review or the concept-to-detailed-part refinement discussed with the owner.

## Observed usage, not an acceptance benchmark

Bob accounting rows for **26 October, Europe/Stockholm**, up to the latest recorded event at approximately 19:00:

| Accounting function | Model | Calls | Recorded cost, USD |
| --- | --- | ---: | ---: |
| Main Bob | `gpt-5.4` | 193 | 9.7627 |
| Conversation/context summaries | `gpt-5.4-mini` | 36 | 0.2902 |
| Completion gate | `gpt-5.4-mini` | 29 | 0.0957 |
| Memory embeddings | `text-embedding-3-small` | 38 | 0.0004 |
| CAD review | `gpt-5.4-mini` | 1 | 0.1254 |
| Illustration generation | `gpt-image-2` | 2 | 0.9149 |

These are model-call counts, not user-turn counts, and costs use the stored accounting prices. Successful provider responses do not establish correct task completion. The period includes earlier runtime versions; it is not an evaluation of the final FORM deployment.

Across **19 October 02:00 Europe/Stockholm through the latest 26 October event**, content-free execution events recorded 334 successful `read_construction_draft` calls, 184 successful and 60 empty `search_project_data` calls, and 13 successful conversation-history searches. No exact `read_conversation_message` tool event appeared in that interval. Some returns already contain sufficient text; absence of exact opens alone does not prove lost context.

Inference: the logs justify investigating how much main-model work source selection could remove. They do not justify a savings percentage or an immediate Mini-to-Nano change. A model swap alone cannot remove the main model's repeated reading steps.

## Smallest next increment, proposed only

1. Prepare one task-specific source package using existing authorized readers and typed domain views. Keep exact facts, revisions and known dependencies in code.
2. Invoke one bounded small reader only for sources that need interpretation. Return selected passages/findings, exact references, conflicts, uncertainty and coverage; preserve original images when visual comparison matters.
3. Reuse an observation for the same immutable source revisions and question, with current access checks. Keep Bob's ability to open originals and request more evidence.
4. Compare against the present path on the box, bunk bed and barn cases: latest corrections retained, unrelated requirements preserved, stale sources rejected, private scope respected, and total calls/cost/time per correct delivery. Include a reader omission and an unavailable reader. Real model quality requires a separately authorized live evaluation.

This recommendation extends the accepted [small-source-view direction](../ask-bob-context.md#owner-refinement--2026-10-19-small-source-views-before-main-model-work); it does not propose a parallel memory store, new project authority or mandatory extra call for every step.

## Verification performed

Focused local tests completed with **38 passed, 0 failed**:

- `tests/bob-memory-gist-only.test.ts`
- `tests/bob-memory-retrieval.test.ts`
- `tests/bob-project-orientation.test.ts`
- `tests/project-facts-runtime.test.ts`
- `tests/bob-memory-retrieval-db.test.ts`

They cover degraded summaries, exact original retrieval, hybrid search, source identity, changed embedding versions, project/thread/ownership boundaries, revocation, deterministic orientation cuts and startup facts wiring. The database tests used isolated PGlite/pgvector fixtures, not production mutations. The review was performed directly; no separate agent review is claimed.
