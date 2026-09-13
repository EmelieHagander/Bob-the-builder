# Ask bob — project context implementation plan

> **Status: planned / pre-build.** This file owns the technical landing sequence for the already-specified runtime context contract in [`ask-bob-context.md`](ask-bob-context.md). It does **not** redefine that contract and does not claim any Project Catalog, Context Router, new pull tools, image vision path or Project Librarian is built.
>
> **Current runtime:** `supabase/README.md` + `supabase/functions/_shared/project-lookup.ts` + `project-answer.ts` remain the deployed truth until an implementation slice below is actually migrated/deployed/verified.

## Job of this plan

`ask-bob-context.md` owns **what Bob's context architecture is**. This plan owns **how to land it without replacing several safety boundaries at once**.

The implementation should be incremental:

```text
existing Slice 0
    |
    v
context types + registry
    |
    v
catalog + deterministic adapters
    |
    v
cheap router preflight
    |
    v
Main Bob list/open pull tools
    |
    v
image-on-demand vision
    |
    v
Project Librarian
    |
    v
retire old model-facing search_project_data tool
```

Conversation persistence / provider continuation is a sibling track owned by `ask-bob-conversations.md`. The context gateway must work correctly **with or without** cross-turn provider continuation: every user turn still reconstructs fresh project context.

## Existing seams to reuse, not replace

The current Ask bob path already has most of the security plumbing we need:

| Current seam | Keep / evolve |
| --- | --- |
| `_shared/bob-request.ts` | Keep the narrow authenticated HTTP boundary. Do not let the browser send provider state, category results or raw context. |
| `_shared/ask-openai.ts` | Keep creating a `bob`-schema Supabase client with the caller JWT. Project reads stay here/under this client, never service-role. |
| `_shared/project-answer.ts` | Evolve from one `project` briefing + `search_project_data` loop into catalog → route → prefetch → generic context-tool loop. |
| `_shared/project-lookup.ts` | Keep as the deployed compatibility seam while the new registry lands. Reuse projections where sensible; do not big-bang rename it first. |
| `_shared/openai-service.ts` | Reuse the shared model/settings/accounting pipe. It already supports strict structured output via `schemaName` + `schema`, tools, images and server-owned `previousResponseId`; no Bob-specific branching belongs here. |
| `src/data/provenance.ts` | Keep the truth/source vocabulary for visible answer evidence. Extend source construction, not the meaning of `measured` / `provided_spec` / `estimated` / `unknown`. |
| current invoker views / RLS | Reuse current project facts, solutions, targets and artifact heads. Do not duplicate domain truth into AI-only tables. |
| private `bob-project-media` bucket | Reuse caller-authorised Storage reads for an explicitly opened image. No public/signed-URL persistence. |

The first context implementation should therefore be mostly **new read orchestration around existing project truth**, not another parallel data model.

## Target module layout

Keep the new context machinery under one backend-owned folder instead of growing `project-answer.ts` into a switchboard:

```text
supabase/functions/_shared/project-context/
  types.ts          # ProjectCategory, catalog, route, refs, result unions
  registry.ts       # one server-owned category registry
  catalog.ts        # buildProjectCatalog
  router.ts         # cheap structured-output model call + validator
  dispatcher.ts     # list/open dispatch + per-turn budgets
  tools.ts          # model-facing list_project_category/open_project_item specs
  sources.ts        # manifest/open results -> ProjectSource evidence
  adapters/
    legacy.ts       # areas/tasks/materials/people/events/announcements
    facts.ts        # measurements/components
    media.ts        # image metadata + authorised original read
    solutions.ts    # alternatives + selected target/current revisions
    artifacts.ts    # plans/drawings + pinned lineage
```

`project-answer.ts` should orchestrate these modules; it should not know table names or storage paths.

## Data layer

### 1. One small Project Catalog read

Add one additive, read-only `bob.project_context_catalog(p_project_id)` RPC. It should be `SECURITY INVOKER`, schema-qualified, `search_path = ''`, callable by authenticated users, and depend on the same project RLS/membership rules as every other Bob read.

Its only job is navigation metadata:

```ts
interface ProjectCatalogPayload {
  project: { id: string; name: string }
  areas: Array<{ id: string; name: string }>
  counts: {
    areas: number
    measurements: number
    components: number
    images: number
    materials: number
    tasks: number
    solutions: number
    drawings: number
    people: number
    events: number
    announcements: number
  }
  generatedAt: string
}
```

Count only rows that Bob could actually list through the matching AI-safe adapter. Examples: only current/non-archived fact heads, only `ready` project images, current solution/drawing heads, and only the existing safe people projection. A count must not reveal a private category the adapter could not expose.

The SQL RPC owns **counts**, not category capabilities. `registry.ts` owns scope/list/open/research capabilities. `catalog.ts` joins the two and fails closed if a count key and registry key drift. A parity test pins that contract.

### 2. Deterministic category adapters

Each adapter uses fixed projections over existing tables/views with the caller-JWT client. No adapter accepts table names, columns or PostgREST filter expressions from a model.

Initial mapping:

| Category | Primary read surface | Manifest posture | `open_project_item` posture |
| --- | --- | --- | --- |
| `areas` | `bob.areas` | id/name/description/lead id only as already AI-safe | one area + bounded related ids, not whole project |
| `measurements` | `bob.current_measurements` | subject/value/unit/truth/current revision/area/source label | current revision + provenance + bounded history only when useful |
| `components` | `bob.current_components` | name/kind/count/condition/action/revision/area | current component + linked dimensions/source metadata |
| `images` | `bob.media_assets` + safe links | title/purpose/dimensions/area/task/step refs; `ready` only | metadata first; bytes go on a server-only model attachment side-channel |
| `materials` | `bob.materials` | existing authored fields, truth remains `unknown` | one current material record |
| `tasks` | `bob.tasks` + area/assignee safe labels | name/status/skill/hours/materials/area | task + instructions + ordered steps + safe attachments |
| `solutions` | `bob.current_solutions` + `bob.current_target` | current alternatives + selected marker + revision/area | current version + assumptions/trade-offs + exact pinned measurement refs + target decision |
| `drawings` | `bob.current_artifacts` | title/kind/status/revision/area/target revision | current artifact + assumptions + exact pinned target/solution/measurement refs + image ref |
| `people` | current Slice-0 people/skills projection | name/role/skills only | same safe projection; no email/diet/auth/account fields |
| `events` | current Slice-0 event projection | title/day/time/place/status + safe attendance labels | one event safe projection |
| `announcements` | current Slice-0 projection | text/pinned/time/author label | one announcement safe projection |

A category manifest may contain enough data to answer a simple question. Do not auto-open every row after listing it.

### 3. Server-owned budgets

The model must not choose row/byte budgets. Keep them in one constant in `types.ts`, initially close to the proven Slice-0 limits and tune from measurements:

```ts
export const PROJECT_CONTEXT_LIMITS = {
  routerRequests: 3,
  manifestRows: 20,
  manifestBytes: 16 * 1024,
  pullOperations: 4,
  toolRounds: 3,
  imagesPerTurn: 2,
  catalogTimeoutMs: 10_000,
  readTimeoutMs: 10_000,
  routerTimeoutMs: 8_000,
} as const
```

These are implementation defaults, not permanent product truth. Any change must preserve boundedness and tests.

## Context Router call

Use the existing shared OpenAI service as a separate Bob AI function, for example:

```ts
callOpenAIResponses<ContextRoutePlan>({
  app: 'bob',
  coworkerId: 'bob',
  functionName: 'ask-bob-context-router',
  aiFunction: 'ask-bob-context-router',
  module: 'global',
  userId,
  useHardcodedPrompt: true,
  systemMessage: CONTEXT_ROUTER_RULES,
  schemaName: 'bob_context_route',
  schema: CONTEXT_ROUTE_SCHEMA,
  messages: [{
    role: 'user',
    content: JSON.stringify({ contextQuery, catalog, uiContext }),
  }],
  maxOutputTokens: 300,
  timeoutMs: PROJECT_CONTEXT_LIMITS.routerTimeoutMs,
})
```

Do **not** hardcode a model name in Bob code. Give `ask-bob-context-router` its own `shared.ai_settings` row so the cheap model, reasoning effort, token ceiling and kill switch are configuration. Usage then lands in the existing shared usage ledger under a distinct function name.

The response schema should permit only:

```ts
interface ContextRoutePlan {
  requests: Array<{
    category: ProjectCategory
    areaId: string | null
    intent: string | null
  }>
  reason: 'selected' | 'nothing_needed'
}
```

Server validation then additionally enforces:

- max three requests;
- every category exists in the server registry;
- category count is non-zero before automatic prefetch;
- `areaId` is null or one of the catalog's exact area ids;
- the category supports area scope when an area is present;
- `intent` is short data, never instructions to the database;
- duplicate requests collapse deterministically.

`limit`, project id, table names, columns and provider ids are deliberately absent from router output.

### Failure posture

Router failure is **fail-soft**:

```ts
const routed = await tryRoute(...)
// failure => no automatic category prefetch
// Main Bob still gets the compact catalog + pull tools
```

Do not fall back by guessing categories in code and label that as router success.

## Turn orchestration

The target `runProjectAnswer` shape becomes:

```ts
async function runProjectAnswer(opts: RunProjectAnswerOptions) {
  await requireAccess()

  const contextQuery = opts.message
  const context = createProjectContext({
    projectId: opts.projectId,
    callerClient: opts.callerClient,
  })

  const catalog = await context.catalog()

  const route = await tryContextRouter({
    contextQuery,
    catalog,
    uiContext: opts.uiContext,
  })

  const prefetched = await context.prefetch(route.requests)

  let turnCursor = opts.committedProviderCursor
  let messages = [{
    role: 'user',
    content: JSON.stringify({
      projectCatalog: catalog,
      projectContext: prefetched,
      question: opts.message,
    }),
  }]

  for (let round = 0; round <= PROJECT_CONTEXT_LIMITS.toolRounds; round++) {
    await requireAccess()

    const response = await callMainBob({
      messages,
      previousResponseId: turnCursor,
      tools: context.modelTools(),
    })

    if (!response.toolCalls?.length) {
      await requireAccess()
      return context.finishAnswer(response)
    }

    turnCursor = requireResponseId(response)
    const dispatched = await context.dispatchToolCalls(response.toolCalls)

    messages = dispatched.toolMessages
    // image opens may additionally add turn-local model attachments;
    // no bytes/storage path appear in the textual tool result.
  }
}
```

The **compact catalog is also supplied to Main Bob**. It is small navigation context and is what lets Main Bob repair a router miss without loading irrelevant rows.

Every deterministic read — automatic prefetch or Main Bob pull — contributes sources to the same turn evidence collector. Catalog category names/counts are navigation metadata, not evidence for a construction claim.

## Main Bob tools

### `list_project_category`

Model input:

```ts
{
  category: ProjectCategory
  areaId: string | null
}
```

Server rules:

- project id is injected from the bound turn;
- exact category + scope validation against the registry/catalog;
- server owns limit/order/byte cap;
- each call consumes one pull-operation budget;
- returns an honest `ok | empty | denied | unavailable | budget_exhausted` envelope plus `truncated`.

### `open_project_item`

Model input:

```ts
{ ref: ProjectItemRef }
```

Server rules:

- parse the prefix and dispatch to exactly one registered adapter;
- reject malformed/unknown prefixes;
- verify the id under the bound project/caller, even if that ref was seen earlier;
- return current data plus source/revision metadata;
- for revision-pinned structures (solution/drawing), the opened object may contain the exact historical evidence they reference rather than pretending the newest measurement rewrites old lineage.

Do not add a raw `search_project_data` equivalent under a new name. The whole point is a smaller category/ref vocabulary.

## Image opening and vision

An image is two different things:

1. **image record / metadata** — safe to list/open as ordinary JSON context;
2. **original pixels** — expensive multimodal context, fetched only after Main Bob explicitly opens that image.

Implementation:

```text
open_project_item(image:123)
  -> validate project + media state under caller JWT
  -> return safe metadata as tool_result
  -> download original from bob-project-media under caller JWT
  -> convert to a turn-local OpenAI image attachment
  -> attach only to the next Main Bob continuation call
```

Use a server-only attachment accumulator such as:

```ts
interface ModelAttachment {
  kind: 'image'
  ref: ProjectItemRef
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  base64: string
}
```

The tool result must never expose bucket/object paths or base64 bytes. Recheck membership before Storage download and again before releasing the final answer. Enforce the existing ready-state and file-type/size contract plus the per-turn image cap.

If the shared OpenAI service needs a generic tweak to combine `previousResponseId` + function outputs + image input in one continuation, make that a provider-neutral service change and sync its canonical copies; do not add Bob-specific request-body code inside the shared service.

## Evidence collector

Replace the current lookup-only source collector with a turn-wide collector owned by `project-context/sources.ts`:

```ts
interface TurnEvidenceCollector {
  addManifest(category: ProjectCategory, rows: unknown[]): void
  addOpenedItem(item: OpenedProjectItem): void
  addResearch(result: ProjectResearchResult): void
  sources(): ProjectSource[]
  partial(): boolean
}
```

Rules:

- dedupe by project/category/record/revision where revision exists;
- preserve the strongest real truth state from the domain record;
- legacy authored text remains `unknown`;
- `truncated`, failed or budget-exhausted reads set `partial = true`;
- a catalog count does not become a source;
- a Librarian summary itself is `ai_assessment`; its cited project refs remain the underlying sources.

## Project Librarian — deliberately later

Do not block the context gateway on the Librarian.

First prove that catalog + router + bounded manifests + `list`/`open` gives Main Bob the right data. Then add `ask_project_librarian` as a separate slice using the same registry/adapters, never a second project-read stack.

The initial worker pipeline can mirror the Launchpad shape without importing Launchpad code:

```text
plan       cheap structured output -> 1..3 research intents
retrieve   deterministic registry/adapters
rerank     cheap structured output -> bounded ProjectItemRefs
synthesize stronger configured model -> cited research summary
gate       cheap grounding/coverage check -> ok/thin/flagged
```

Each AI step gets its own configured function name/settings/usage attribution. The public `ProjectResearchResult` remains provider-neutral. A failure returns an honest research status to Main Bob; it must not replace direct `list`/`open` recovery.

## Request/frontend contract

The context gateway can ship initially **without changing the browser request**. Current `{ action, projectId, message }` is enough because catalog, routing and project reads are server-owned.

Optional UI context is a later optimization:

```ts
uiContext?: {
  areaId?: string
  route?: string
}
```

If/when added, `_shared/bob-request.ts` must strictly validate it and the backend treats it as a navigation hint, never authority. The browser never sends selected categories, ProjectItemRefs from previous turns, provider ids or assembled context.

`clientTurnId` belongs to the sibling conversation-persistence contract; coordinate that request-schema change instead of making two incompatible request revisions.

## Relationship to provider conversation state

When `ask-bob-conversations.md` lands:

- provider state carries conversational continuity;
- the current user message remains the single `contextQuery` for preflight;
- catalog/router/prefetch rerun every user turn;
- old provider conversation content never satisfies current project-evidence requirements;
- automatic/pulled project context is attached to the **current turn**, not written back as durable project truth.

This means context-gateway implementation does not need to wait for server-side chat persistence.

## Implementation slices

Each slice should be independently reviewable and preserve the old Ask bob path until its replacement is proven.

### C0 — context types + registry, no behavior change

Files:

- add `project-context/types.ts`;
- add `registry.ts` with the fixed category metadata;
- add parsers for `ProjectItemRef`, router output and tool input;
- unit-test unknown category/ref/area rejection and budgets.

No migration. No provider call. No deployed behavior change.

**Gate:** registry covers exactly the AI-safe resource families ratified in `ask-bob-context.md`; sensitive fields are not part of any public row type.

### C1 — catalog + deterministic adapters, still no model routing

Migration:

- add `bob.project_context_catalog(p_project_id)` only;
- no new persistence tables;
- no service-role project reads.

Code:

- implement category adapters over existing current views/tables;
- reuse existing Slice-0 projection logic for legacy categories where practical;
- add catalog/adapter parity tests;
- add PGlite/RLS tests for member, outsider and dual-project member;
- test that image catalog/listing contains metadata only.

**Gate:** a server test can build the full compact catalog, list every category and open representative records without calling a model.

### C2 — cheap router in shadow mode

Code/config:

- add `router.ts` with strict structured output;
- create/configure `ask-bob-context-router` in shared AI settings;
- invoke it from the backend **without changing Main Bob's prompt yet**;
- record only operational telemetry: success/fallback, selected category names/count, latency and AI usage. Do not log project record bodies.

This slice proves routing quality/cost separately from answer quality.

**Gate:** test corpus of representative questions routes to expected broad categories/scopes; malformed/timeout/disabled router cleanly degrades.

### C3 — prefetch + Main Bob list/open tools

Replace the initial full `project` briefing in `runProjectAnswer` with:

```text
compact catalog
+ router-selected bounded manifests
+ current question
```

Offer `list_project_category` + `open_project_item`. Generalise the current single-tool dispatcher to a typed context dispatcher and turn-wide evidence collector.

Keep `search_project_data` available as a **server fallback path**, not model-facing primary behavior, during rollout. If the new context build fails before any project data reaches Main Bob, fall back to the deployed Slice-0 flow for that turn and log the fallback reason.

**Gate:** live/model proof that an unrelated category is not fetched, Main Bob can repair a deliberate router miss, and changed project data overrides stale conversational claims.

### C4 — image-on-demand vision

Add the image attachment side-channel and model continuation support.

**Gate:** image metadata can route/list without pixel transfer; a specific image open causes exactly one authorised Storage read and one model image attachment; foreign/not-ready images fail closed.

### C5 — Project Librarian

Add the research tool and worker pipeline on top of the same adapters.

**Gate:** multi-category research returns cited project refs, thin/empty states are honest, and a Librarian failure does not remove direct Main Bob pull capability.

### C6 — retire legacy model-facing lookup

Only after live evidence shows the new path covers the old Slice-0 use cases:

- stop offering `search_project_data` to the model;
- keep or simplify its SQL/function internals only if adapters still reuse them;
- update `supabase/README.md`, `function-inventory.md` and verification docs to mark the new path built;
- do not delete a proven rollback seam in the same deployment that first enables the replacement.

## Deployment order

For slices that add SQL + Edge behavior:

```text
1. merge reviewed migration/code
2. apply additive DB migration
3. verify RLS/RPC live with member + denied caller
4. create/verify shared AI setting for router/worker when that slice needs it
5. deploy ask-bob Edge function
6. run live Ask bob acceptance
7. frontend deploy only if that slice actually changes browser request/UI
8. update built/deployed docs after evidence exists
```

GitHub Pages deployment alone is not enough: current repo automation does not apply Supabase migrations or deploy the Edge function.

Rollback posture:

- additive catalog/read migration may stay applied;
- Edge can fall back to the current Slice-0 path;
- disable the router through its AI setting if its model path misbehaves;
- do not roll back RLS to make context work.

## Verification matrix

Minimum automated/live coverage before calling the gateway built:

| Case | Required proof |
| --- | --- |
| bedroom measurement question | router/prefetch reads measurements/components only; people/materials/images are not fetched |
| image question | image metadata lists first; pixels are fetched only after exact open |
| unrelated people data | no people category read unless selected/pulled |
| area scoping | an area id from another project is rejected even for a dual-project member |
| selected solution + drawing | exact current target and pinned revisions remain distinguishable from later revisions |
| legacy material/task fields | remain `unknown`, never promoted to measured facts |
| router malformed/timeout/off | Main Bob remains usable through catalog + pull/fallback |
| deliberate router miss | Main Bob lists another category in the same turn and completes |
| empty category | honest empty, not “project has none” unless the catalog/count makes that exact claim valid |
| truncation/budget | `partial=true`; Bob cannot claim exhaustiveness |
| access revoked mid-turn | no later category/image read and no final answer release |
| A -> B -> A | catalog/manifests/tools never cross project binding |
| changed measurement | next turn reads the new revision; provider conversation does not win over fresh truth |
| sensitive people fields | email, diet, auth ids and account notes never appear in catalog/manifest/open/research payloads |
| evidence | answer sources name only records actually consulted; catalog counts are not cited as substantive evidence |

Also record router/main-model token usage separately via the existing shared usage ledger so the “cheap sort, expensive think” design can be evaluated with real cost/latency data rather than intuition.

## Decisions locked for implementation

- Project Catalog is small navigation context, not the project dump.
- Main Bob also sees the compact catalog so it can repair router misses.
- Router is a separate cheap configured AI call with strict structured output.
- Router never supplies SQL/table/column/project/provider state.
- Row/byte/tool/image budgets are server-owned.
- Project reads use caller JWT + existing RLS; service role remains AI config/accounting only.
- Category adapters are the only route from a ProjectCategory/ProjectItemRef to database/storage reads.
- Images are metadata-first and pixels-on-demand.
- Project Librarian reuses adapters and ships later.
- Conversation continuity and project-context freshness remain separate planes.
- The old Slice-0 path remains a rollout fallback until the replacement is proven live.

## Discovery still required at implementation time

These are implementation checks, not open architecture questions:

1. Verify the exact current column names/projections on `current_measurements`, `current_components`, `current_solutions`, `current_target` and `current_artifacts` against the migration at pickup time.
2. Verify the shared OpenAI service's current image-input continuation shape before C4; if a generic service extension is needed, keep it provider-neutral and sync canonical copies.
3. Choose the actual router model/settings from the live `shared.ai_models` catalogue; do not bake a model name into this plan.
4. Tune router/prefetch/tool budgets from live latency/token evidence after the safe initial caps are proven.
5. Rebase the implementation branch onto current `main` before writing migrations, because manual foundations are still moving independently of this planning PR.
