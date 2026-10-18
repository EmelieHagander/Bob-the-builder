# Bob context and tool coverage audit — 2026-10-18

**Verdict: the released foundation is active, but the agreed strategy is not fully implemented across all colleagues and tools.** This audit corrects the earlier blanket completion claim. Five actionable gaps remain. Current contracts stay with [conversations](ask-bob-conversations.md#context-strategy--2026-10-18), [tools](ask-bob-tools.md#tool-and-colleague-cards--2026-10-18), [CAD](cad-adapter.md) and [the active State](bob-delivery-flow.md#state).

## Scope and evidence

Source: `f32c4da336f98d5364a3b4e618c2ac8447e5be2d`, runtime identical to PR #267's tested `ef68df41e8baa9ded662d2ea41436cf6741f54fe`. Independent source reviews were combined with production readback and offline reproductions. No owner messages, paid model calls, runtime changes, migrations or deployments were performed for this audit.

At 09:47:53 UTC, all 310 active definitions, model/settings records and release migration identities matched the release snapshot. Six database function bodies and service-only grants matched. Fresh Edge source readback matched all 102 returned ask-bob files and 100 bob-worker files, with no unexpected source or mismatch. Versions remain **ask-bob 131 / JWT true** and **bob-worker 99 / JWT false with its existing authentication**; the same bundle hashes were reconfirmed near 12:00 UTC.

The 11:58:50 UTC live tool-policy comparison and 12:00:21 UTC function checks found an older deployment gap outside those new memory migrations, described in F1. Installed new migrations do not prove that every older dependency was installed.

## Findings and correction order

### F1 — P1: shell-to-plan tool and database extension are absent in production

The versioned `bob.tools` catalog contains 92 rows, 91 active; live `bob.tool_catalog` contains 91 rows, 90 active. All compared policy fields match except:

- `link_cad_shell_steps` is missing from the live policy table.
- `read_cad_shell.how_to` lacks the plan-link/material-summary extension promised by its versioned manual.

This is not only stale metadata. Readback found no `bob_private.read_cad_shell_pieces(text,uuid,integer)`, no `bob_private.bob_project_write_before_shell_steps(text,uuid,uuid,bigint,jsonb)`, no `cad_shell_steps` branch in any live Bob writer, and no `plan_summary` in the live reader. The shell migration history contains `cad_shells` at `20261008120000`, but no shell-plan-link extension.

The client code and catalog advertise the capability: `cad-shell.ts:78–108`, `project-write.ts:18–40,163`, and `20261008150000_cad_shell_plan_link.sql:19–76,78–142`. Production actually reads the separate caller-authorised policy table at `project-tools/policy-reader.ts:6–16`; `session.ts:141–160` only offers rows present there. Consequently the missing tool is unreachable, and the reader does not return the promised plan/material fields.

**Impact:** Bob cannot use this batch tool to link shell pieces to current plan Steps. This does not establish the cause of a particular failed drawing job, and the separate individual drawing-link capability is not claimed absent.

**Correction:** inspect the current writer chain and install an additive extension compatible with today's wrappers, then compare live policy, reader, writer and saved/read-back links. Do not blindly run the old migration out of order: it renames/wraps functions that now have later owners.

### F2 — P2: colleague cards describe model routes that do not run

`scripts/build-ai-context-strategy-catalog.ts:36–40` lists Daisy and Kjell for `design_project_cad`. Actual `cad-assistant.ts:447–497` builds a recipe from checked saved construction, renders it deterministically, and invokes Rita. There is no production designer dispatch; `collectCadResearch` has no production caller.

The tests currently endorse both conflicting claims: `bob-context-toolbox.test.ts:60–69` requires Daisy/Kjell/Rita cards, while `runtime-audit.test.ts:75–81` requires zero designer/research calls and one reviewer. A smaller routing mismatch lists Plantus/Vera for `edit_project_plan`, whose deterministic branch returns at `plan-assistant.ts:189–209`, before their model calls at 244–273.

**Correction:** make each card and delegation manual describe its actual reachable branch. Preserve deterministic geometry rendering; do not restore geometry invention merely to make a stale colleague card true. Add a cross-check between advertised colleagues and actual dispatch paths.

### F3 — P2: lazy tool instructions are implemented only for main Bob

Main Bob uses cards, `describe_tool`, exact schema loading on the next model step, live policy/version checks and reloading after context renewal. Plantus, Vera and Rita instead receive the calculator's native schema eagerly via `calculator-model-call.ts:24–29`. They do receive the shared renewal wrapper; this finding is specifically about tool/manual treatment, not missing continuation.

**Correction:** reuse a scoped lazy tool session for the specialists, or explicitly approve and document a minimal calculator exception. Until then, claiming that all colleagues use the same lazy-tool strategy is inaccurate. No five-message chat context should be injected indiscriminately into specialist assignments.

### F4 — P2: renewal retains response groups instead of two tool exchanges

`bob-context-continuation.ts:232–249` slices the latest two response groups. A plain commentary response consumes one slot, although the active policy says `retained_tool_exchanges=2`.

Offline reproduction with real 64,000/96,000 token settings: complete write1, complete write2, receive commentary, then renew. Only write2's exact native call/result pair remains in fresh input. Write1 is summarised and remains exactly retrievable through the scoped operation archive.

**Correction:** select the last two completed tool exchanges plus the context needed to preserve native call/output pairing, without charging plain commentary against that count. Test commentary and completion-review nudges between completed writes. This is a contract/reliability defect, not demonstrated transcript loss or duplicate writing.

### F5 — P2: initial project orientation has no total token allocation

`bob-project-orientation.ts:70–97,138–155` collects all Area pages and emits all relevant cards and source records. The 500/250/150 limits apply only to three presentation texts, not the combined hierarchy. `project-answer.ts:61–74` puts the packet into the exact immutable initial seed; renewal cannot shrink that seed.

An offline fixture using the real lookup/orientation/continuation code, 1,000 valid Areas, ordinary names of at most 36 characters and 40 pages of at most 6,944 bytes produced **111,295 orientation tokens**. The 96,000 ceiling rejected the request before any model dispatch. This is a large-project scalability reproduction, not an observed owner-project failure.

**Correction:** allocate tokens to the complete orientation and provide exact paging for larger peer/child directories. Preserve current focus, necessary requirements and source revisions; expose counts/incompleteness rather than silently deleting records or merely increasing the global ceiling.

## Actual role coverage

| Role | Production use | Context / tool treatment |
| --- | --- | --- |
| Bob | Active main adviser | Five original recent messages, bounded managed memory, project orientation, private retrieval; lazy tools and shared renewal |
| Plantus | Compile/audit plan | Scoped intent, authorised snapshot and revision; shared renewal; eager calculator |
| Vera | Review compiled plan | Independent proposal/evidence assignment; shared renewal; eager calculator |
| Rita | Review rendered CAD | Exact candidate, requirements, source evidence and pixels; shared renewal; eager calculator |
| Samtalsminnet | Fold older conversation | Previous brief plus new original batch/current request; bounded output through shared caller; no own retrieval tools |
| Context presentation | Summarise oversized descriptions | Source IDs and per-block limits; structured transformation |
| Context compactor | Renew an active chain | Paged source history and bounded handoff; intentionally nonrecursive underlying dispatcher |
| Status language | Localise server-owned status | Structured one-shot; cannot decide saved state or grant authority |
| Illustratören | Generate an image | Bounded brief and authorised reference pixels; intentional image endpoint |
| Memory embedding | Index/search vectors | Bounded batches through journalled embedder; intentional embedding endpoint |
| Daisy / Kjell | Dormant model routes | Advertised incorrectly; see F2 |
| Drawing-resume-reply role | Legacy catalog role | Current path composes receipts deterministically and uses status localisation |

The image generator and embedder do not need a five-message conversation loop. Specialists receive scoped source assignments, not automatic access to the owner's private transcript. Shared text renewal is wired through `ask-openai.ts:166–170,235–253` to main Bob, plan/CAD specialists, memory and presentation calls; exact operation archives remain scoped to the corresponding chain.

## Verified strengths and explicit limits

- Five individual original recent messages, including the current pending message; older transcript preserved.
- The complete managed brief, including selected pointers, is validated against 1,600 actual tokens. Main base prompt and directory cards have enforced limits.
- Private-thread history reads are paged and source-linked, with current access checks and fingerprints. Retrieval combines text and semantic matching per query; there is no permanent relevance score or threshold 25.
- Main tool discovery does not grant write authority. Policy, handler compatibility, offered-version fences and backend permissions still apply at execution.
- Context renewal preserves the assignment, native pair integrity, journal replay and scoped exact operation lookup, subject to F4/F5.
- Semantic indexing is incremental (eight source chunks per preparation/search); text/exact lookup remains available while it catches up. The response marks semantic coverage as on-demand.
- The small memory summariser currently maintains a brief; it does not independently search older originals or project knowledge. Bob invokes retrieval. A proactive assistant that scouts relevant sources is not implemented by this release.
- Long-conversation semantic quality, actual specialist judgement and final CAD delivery still require real-model acceptance. No claim here that green structural tests prove those outcomes.

## Validation and handoff

A fresh focused run passed **72/72 tests** across managed memory, retrieval, embeddings, continuation, orientation, main strategy, catalog, toolbox and runtime-tool checks. Earlier audit logs also passed 26 colleague/context tests, 40 plan/CAD runtime tests and 49 tool tests; these overlap and are not summed into a new total. The release's 1,489-test CI remains separate historical evidence.

Two disposable offline reproductions confirmed F4 and F5; production was read only. No fixes are claimed. [State](bob-delivery-flow.md#state) holds the next correction and acceptance work. Existing separate CAD/performance investigations should consume these findings without assuming they explain a particular user incident.
