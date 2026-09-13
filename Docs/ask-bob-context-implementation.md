# Ask bob — project context implementation plan

> **Status: planned / pre-build.** This file owns the technical landing sequence for the already-specified runtime context contract in [`ask-bob-context.md`](ask-bob-context.md). It does **not** redefine that contract and does not claim any screen-context seam, Project Catalog, Context Router, Process Lens, new pull tools, image vision path or Project Librarian is built.
>
> **Current runtime:** `supabase/README.md` + `supabase/functions/_shared/project-lookup.ts` + `project-answer.ts` remain deployed truth until a slice below is migrated/deployed/verified.

## Job of this plan

`ask-bob-context.md` owns **what Bob's context architecture is**. This plan owns **how to land it without replacing several safety boundaries at once**.

The target sequence is deliberately incremental:

```text
existing Slice 0
    ↓
context types + registry
    ↓
catalog + deterministic adapters
    ↓
screen pointer + server-hydrated Current View
    ↓
cheap router + Process Lens in shadow mode
    ↓
Main Bob prefetch + list/open tools
    ↓
image-on-demand vision
    ↓
Project Librarian
    ↓
retire old model-facing search_project_data tool
```

Conversation persistence/provider continuation is a sibling track owned by `ask-bob-conversations.md`. Every user turn still rebuilds fresh Current View + project context even when OpenAI carries conversational state.

## Prior art to copy deliberately

Kvarnstrands' context-aware internal assistant has a useful split that Bob should mirror conceptually, not by importing code:

```text
client context descriptor
  = view + opaque selected ids
  = navigation hint only

server get_context-style read
  = real scoped read
  = facts
```

The key lesson is not the field names. It is the trust boundary:

- page/surface code says what is open;
- the request parser validates only descriptor shape;
- ids are opaque pointers;
- a server-side read verifies current visibility/ownership and hydrates facts;
- stale/forged pointers fail closed;
- changing page clears stale selected pointers;
- the assistant overlay itself does not destroy context for the page still underneath it.

Bob should use the same pattern for project/area/task/step/solution/drawing/event focus.

## Existing seams to reuse

| Current seam | Keep / evolve |
| --- | --- |
| `_shared/bob-request.ts` | Keep narrow Auth boundary; extend strict request schema with a small `screen` pointer, never fact blobs/provider state. |
| `_shared/ask-openai.ts` | Keep caller-JWT `bob` client for all project reads. Service role remains shared AI config/accounting only. |
| `_shared/project-answer.ts` | Evolve into the turn orchestrator: hydrate view → catalog → route → prefetch → tool loop. It should not know table/storage details. |
| `_shared/project-lookup.ts` | Keep deployed Slice-0 compatibility/fallback seam while new registry lands. |
| `_shared/openai-service.ts` | Reuse shared model/settings/accounting, strict structured output, tools, images and `previousResponseId`; no Bob-specific provider body logic. |
| `src/components/AskBob.tsx` | Read the current screen pointer at **send time** and send it with the question. |
| project pages + `Layout` | Publish honest surface/focus pointers through one tiny app-level context module. |
| `src/data/provenance.ts` | Keep truth/source vocabulary; extend source collection, not semantics. |
| current invoker views / RLS | Reuse existing domain truth; no AI-only duplicate truth tables. |
| private `bob-project-media` bucket | Reuse authorised originals only after exact image open. |

## Target module layout

Backend:

```text
supabase/functions/_shared/project-context/
  types.ts          # categories, screen pointer, CurrentView, lens, refs, results
  registry.ts       # one category registry + one surface hydration registry
  catalog.ts        # buildProjectCatalog
  current-view.ts   # hydrateCurrentView + viewer derivation
  router.ts         # cheap structured-output call + validator
  lenses.ts         # fixed server-owned ProcessLens prompt blocks
  dispatcher.ts     # list/open dispatch + turn budgets
  tools.ts          # list_project_category/open_project_item specs
  sources.ts        # all current-turn project reads -> ProjectSource evidence
  adapters/
    legacy.ts       # areas/tasks/materials/people/events/announcements
    facts.ts        # measurements/components
    media.ts        # image metadata + authorised original read
    solutions.ts    # alternatives/selected target
    artifacts.ts    # plans/drawings + pinned lineage
```

Frontend:

```text
src/lib/bobSurfaceContext.ts
  setBobSurface(pointer)
  clearBobSurface()
  getBobSurface()      # read at send time
```

Page code publishes context. `AskBob.tsx` consumes it. The AI/backend never derives semantic focus by parsing arbitrary DOM text.

## Screen pointer wire contract

Use a compact request value:

```ts
type BobSurface =
  | 'project'
  | 'areas'
  | 'area'
  | 'task'
  | 'facts'
  | 'solutions'
  | 'drawings'
  | 'people'
  | 'events'
  | 'event'
  | 'shopping'
  | 'today'
  | 'announcements'

interface BobScreenPointer {
  surface: BobSurface
  areaId?: string
  taskId?: string
  stepId?: string
  solutionId?: string
  artifactId?: string
  eventId?: string
}
```

The browser must **not** send names/status/assignees/measurements as page truth. For example, do not send:

```json
{ "area": "Sovrum", "step": "Måla", "responsible": "Emelie" }
```

Instead send ids; the backend hydrates those values.

### Parser rules

`bob-request.ts` should:

- keep `screen` optional;
- reject unknown fields;
- enumerate `surface` values;
- bound pointer strings tightly;
- enforce surface-compatible pointer shapes where practical;
- never accept `viewerName`, assignees, arbitrary page text, category results or provider state.

A malformed supplied descriptor is a 400. A syntactically valid id that is stale/not in this project is handled by the hydrator, not trusted by the parser.

## Frontend surface lifecycle

The surface module is a tiny snapshot store, not a second application state system.

Example:

```ts
useEffect(() => {
  setBobSurface({ surface: 'task', areaId: task.areaId, taskId: task.id })
  return () => clearBobSurface()
}, [task.areaId, task.id])
```

If a specific task step is selected/expanded and should be the conversational focus:

```ts
setBobSurface({
  surface: 'task',
  areaId: task.areaId,
  taskId: task.id,
  stepId: selectedStepId,
})
```

Rules:

- navigating to another page replaces the whole snapshot;
- leaving a detail/selection clears its ids;
- no stale step/product/drawing pointer survives because another surface forgot to unset it;
- opening Ask bob does not navigate, so the underlying surface snapshot remains;
- read the snapshot immediately before `db.askBob(...)`, not when the drawer first mounted.

Page tests should pin these lifecycle rules.

## Server-hydrated Current View

Add `hydrateCurrentView(pointer, readContext)`.

It must use the caller-JWT client and the same RLS/same-project rules as normal project reads.

The server derives the viewer from the authenticated project-person mapping, never from the request body.

Example task hydration:

```text
pointer:
  surface=task
  areaId=area_123
  taskId=task_456
  stepId=step_789

server reads:
  current membership -> viewer Emelie
  area_123 in bound project -> Sovrum
  task_456 in area_123 -> Måla sovrum / doing
  step_789 in task_456 -> Måla
  task assignees -> Emelie

CurrentView:
  Viewer: Emelie
  Area: Sovrum
  Task: Måla sovrum
  Step: Måla
  Responsible: Emelie
```

### Hydration registry

Do not build one giant switch in `project-answer.ts`.

```ts
interface SurfaceHydrator<P extends BobScreenPointer = BobScreenPointer> {
  surface: BobSurface
  hydrate(ctx: ProjectReadContext, pointer: P): Promise<CurrentViewContext>
}
```

The registry maps only supported surface types to fixed reads. Surface hydration must expose only AI-safe fields already allowed for that domain.

### Failure posture

- no descriptor → `CurrentView = null`;
- malformed descriptor → request rejected;
- foreign/stale id → no guessed facts; return a typed unresolved/not-found current-view state;
- project membership denied → fail turn as today;
- a child pointer that does not match its parent → fail closed/unresolved, never silently re-parent.

A missing Current View must not make the whole assistant unavailable; catalog + pull tools still work.

## Project Catalog

Add one additive, read-only `bob.project_context_catalog(p_project_id)` RPC.

Required posture:

- `SECURITY INVOKER`;
- schema-qualified / empty search path discipline;
- authenticated caller only;
- same membership/RLS as ordinary Bob reads;
- counts only AI-safe/listable rows;
- project id/name + small area id/name manifest + category counts;
- no record bodies.

Example payload:

```ts
interface ProjectCatalogPayload {
  project: { id: string; name: string }
  areas: Array<{ id: string; name: string }>
  counts: Record<ProjectCategory, number>
  generatedAt: string
}
```

SQL owns counts. `registry.ts` owns category capabilities. A parity test must fail if one drifts from the other.

## Deterministic category adapters

Each adapter uses fixed caller-authorised projections. No adapter accepts table/column/PostgREST expressions from a model.

| Category | Primary surface | Manifest posture | Open posture |
| --- | --- | --- | --- |
| `areas` | `bob.areas` | id/name/description/safe lead label | one area + bounded safe relations |
| `measurements` | `bob.current_measurements` | value/unit/truth/revision/area/source | current revision + provenance; bounded history only when useful |
| `components` | `bob.current_components` | name/kind/count/condition/action/revision | current component + linked dimensions/source metadata |
| `images` | `bob.media_assets` + safe links | title/purpose/dimensions/link refs; ready only | metadata + server-only pixel attachment on explicit open |
| `materials` | `bob.materials` | existing authored fields, truth remains unknown | one record |
| `tasks` | tasks + safe area/assignee labels | name/status/skill/area | task + instructions + ordered steps + safe attachments |
| `solutions` | current solutions + target | alternatives/selected marker/revision | assumptions/trade-offs + pinned evidence/decision |
| `drawings` | current artifacts | title/kind/status/revision/target revision | assumptions + exact pinned lineage/image ref |
| `people` | Slice-0 safe people/skills projection | name/role/skills only | same safe projection |
| `events` | Slice-0 event projection | safe schedule/status/attendance labels | one safe event |
| `announcements` | Slice-0 safe projection | text/pinned/time/author label | one announcement |

Do not auto-open every listed row.

## Server-owned budgets

Keep one bounded constant, initially conservative:

```ts
export const PROJECT_CONTEXT_LIMITS = {
  routerRequests: 3,
  manifestRows: 20,
  manifestBytes: 16 * 1024,
  pullOperations: 4,
  toolRounds: 3,
  imagesPerTurn: 2,
  catalogTimeoutMs: 10_000,
  currentViewTimeoutMs: 10_000,
  readTimeoutMs: 10_000,
  routerTimeoutMs: 8_000,
} as const
```

These are tuning values, not permanent product truth.

## Context Router + Process Lens

Use the shared OpenAI service as a separate configured Bob AI function.

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
    content: JSON.stringify({ contextQuery, currentView, catalog }),
  }],
  maxOutputTokens: 320,
  timeoutMs: PROJECT_CONTEXT_LIMITS.routerTimeoutMs,
})
```

Do not hardcode a model. Give this function its own `shared.ai_settings` row so model/tokens/reasoning/kill switch are configuration and usage is attributable separately.

Structured output:

```ts
type ProcessLens =
  | 'general'
  | 'survey'
  | 'design'
  | 'drawing'
  | 'procurement'
  | 'execution'
  | 'coordination'

interface ContextRoutePlan {
  lens: ProcessLens
  requests: Array<{
    category: ProjectCategory
    areaId: string | null
    intent: string | null
  }>
  reason: 'selected' | 'nothing_needed'
}
```

Server validation enforces category registry membership, exact catalog area ids, category scope capability, short intent, max request count and duplicates.

### Lens prompt blocks

The cheap model chooses only the enum. It never authors Bob's instructions.

`lenses.ts` owns fixed short blocks:

```ts
const PROCESS_LENS_BLOCKS: Record<ProcessLens, string> = {
  general: '...',
  survey: 'Prioritise current measurements, existing components and uncertainty ...',
  design: 'Keep alternatives distinct and reason from current evidence ...',
  drawing: 'Prioritise exact selected target, drawing revision and pinned measurements ...',
  procurement: 'Prioritise required materials, stock/reuse evidence and uncertainty ...',
  execution: 'Prioritise current task/step, build-ready/current drawing and site evidence ...',
  coordination: 'Prioritise people, timing, task assignment and current project coordination ...',
}
```

Router failure → `general` + no automatic prefetch. Main Bob remains usable with Current View, catalog and pull tools.

## Turn orchestration

Target shape:

```ts
async function runProjectAnswer(opts: RunProjectAnswerOptions) {
  await requireAccess()

  const contextQuery = opts.message
  const context = createProjectContext({
    projectId: opts.projectId,
    callerClient: opts.callerClient,
  })

  const currentView = await context.hydrateCurrentView(opts.screen ?? null)
  const catalog = await context.catalog()

  const route = await tryContextRouter({
    contextQuery,
    currentView,
    catalog,
  })

  const prefetched = await context.prefetch(route.requests)

  let turnCursor = opts.committedProviderCursor
  let messages = [{
    role: 'user',
    content: JSON.stringify({
      currentView,
      projectCatalog: catalog,
      projectContext: prefetched,
      question: opts.message,
    }),
  }]

  for (let round = 0; round <= PROJECT_CONTEXT_LIMITS.toolRounds; round++) {
    await requireAccess()

    const response = await callMainBob({
      systemMessage: assembleBobSystemPrompt({
        truthRules: BOB_TRUTH_RULES,
        processLens: PROCESS_LENS_BLOCKS[route.lens],
        currentView,
      }),
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
  }
}
```

Current View is supplied as fresh data and also rendered into a concise system-side block so Bob reliably understands “här”, “den här uppgiften” and “det här steget”. Avoid duplicating the same verbose page payload in several layers.

## Main Bob tools

### `list_project_category`

Input:

```ts
{ category: ProjectCategory; areaId: string | null }
```

Server injects project, owns limit/order/bytes and charges a turn pull budget.

### `open_project_item`

Input:

```ts
{ ref: ProjectItemRef }
```

Server parses fixed prefixes, rechecks current project access and returns current/revision-pinned evidence as appropriate.

Do not recreate raw `search_project_data` under a new generic name.

## Image opening and vision

Keep metadata and pixels separate:

```text
open_project_item(image:123)
  → caller-JWT validation + metadata result
  → authorised bob-project-media download
  → turn-local model image attachment
  → next Main Bob continuation call only
```

Never expose bucket/path/base64 to the model text result or browser. Recheck access before Storage read and final answer. Keep existing ready/MIME/size rules + per-turn cap.

## Evidence collector

Use one turn-wide collector:

```ts
interface TurnEvidenceCollector {
  addCurrentView(view: CurrentViewContext): void
  addManifest(category: ProjectCategory, rows: unknown[]): void
  addOpenedItem(item: OpenedProjectItem): void
  addResearch(result: ProjectResearchResult): void
  sources(): ProjectSource[]
  partial(): boolean
}
```

Rules:

- browser pointer never becomes a source;
- server-hydrated Current View fields may source current claims;
- catalog counts are navigation only;
- dedupe by project/category/record/revision;
- preserve domain truth state;
- legacy authored values remain `unknown`;
- truncation/failure/budget exhaustion sets partial;
- Librarian summary is assessment; its cited project refs are the underlying sources.

## Project Librarian — later slice

Do not block screen/catalog/router/list/open on Librarian.

Initial shape:

```text
plan        cheap structured output
retrieve    same deterministic adapters
rerank      cheap structured output
synthesize  stronger configured model
quality gate cheap grounding/coverage check
```

No second read stack. No parallel truth authority.

## Request/frontend contract

The eventual send payload becomes conceptually:

```ts
{
  action: 'send',
  projectId,
  message,
  clientTurnId, // when conversation-persistence slice lands
  screen: getBobSurface(),
}
```

Coordinate `clientTurnId` with `ask-bob-conversations.md`; do not create two incompatible request migrations.

The browser never sends:

- provider ids/history;
- hydrated page names/status/assignees as facts;
- selected router categories;
- ProjectItemRefs remembered from previous turns;
- assembled prompt/context;
- another project id inside screen focus.

## Implementation slices

Each slice preserves the old Ask bob path until replacement is proven.

### C0 — context types + registries, no behavior change

- `project-context/types.ts`;
- category registry;
- surface hydration registry;
- screen/ref/router/tool parsers;
- fixed ProcessLens enum + blocks;
- unit tests for unknown categories/surfaces/refs/areas and budgets.

**Gate:** no sensitive field appears in public AI-safe types. No migration/provider/browser behavior change.

### C1 — catalog + deterministic category adapters

- additive `bob.project_context_catalog(p_project_id)`;
- category adapters over existing views/tables;
- catalog/registry parity tests;
- PGlite/RLS member/outsider/dual-project coverage;
- image manifests metadata only.

**Gate:** tests can catalog/list/open representative project data without an AI call.

### C2 — screen pointer + Current View hydration

Frontend:

- add `src/lib/bobSurfaceContext.ts`;
- have each relevant page publish/clear its own surface/focus;
- AskBob reads snapshot at send time.

Backend:

- strict optional `screen` parser;
- derive viewer from Auth/project membership;
- implement surface hydrators using caller-JWT reads;
- reject/neutralise stale/foreign/mismatched pointers.

**Gate:** a task-detail fixture proves the server can produce “viewer Emelie / area Sovrum / task Måla / step Måla / assignee Emelie” from ids alone; browser-supplied labels cannot influence the result.

### C3 — cheap router + Process Lens in shadow mode

- `router.ts` strict structured output;
- configured `ask-bob-context-router` AI setting;
- input = question + Current View + catalog;
- log only operational telemetry (success/fallback, lens, selected categories/count, latency/usage), never record bodies;
- do **not** alter Main Bob context yet.

**Gate:** representative corpus proves page-aware routing/lens choice without harming current answers; disabled/timeout/malformed router degrades cleanly.

### C4 — runtime assembly + prefetch + Main Bob list/open

Main Bob gets:

```text
base truth rules
+ fixed selected lens
+ grounded Current View
+ router-selected manifests
+ compact catalog
+ current question
```

Offer list/open tools. Keep Slice-0 lookup as server fallback if new context assembly fails before useful project data reaches Main Bob.

**Gate:** live proof of page deixis (“här”, “det här steget”), irrelevant-category avoidance, same-turn repair of a router miss and fresh-data-over-conversation behavior.

### C5 — image-on-demand vision

Add server-only image attachment continuation.

**Gate:** metadata routes without pixels; exact image open causes one authorised Storage read/attachment; foreign/not-ready fails closed.

### C6 — Project Librarian

Add research tool/pipeline over the same adapters.

**Gate:** cited refs, honest thin/empty states, direct list/open remains available if research fails.

### C7 — retire legacy model-facing lookup

Only after live coverage matches/exceeds Slice 0:

- stop offering `search_project_data` to the model;
- retain internals only if adapters/fallback still need them;
- update built/deployed docs after live proof;
- do not delete rollback seam in the first replacement deployment.

## Deployment order

For SQL + Edge/browser changes:

```text
1. merge reviewed additive code/migration
2. apply DB migration
3. live verify RLS/RPC with member + denied caller
4. configure/verify router/worker AI setting for the relevant slice
5. deploy ask-bob Edge
6. deploy frontend only when screen/request surface changes
7. run live Ask bob acceptance
8. update built/deployed docs after evidence exists
```

GitHub Pages does not apply Supabase migrations or deploy the Edge function.

Rollback posture:

- additive catalog read may remain;
- disable router via AI settings;
- Edge can fall back to Slice 0;
- never loosen RLS to rescue context routing.

## Verification matrix

| Case | Required proof |
| --- | --- |
| task/step page | browser sends ids only; backend hydrates area/task/step/assignee from live project data |
| viewer identity | current person's name/id comes from Auth-linked membership, not request text |
| page switch | old step/task/drawing pointers are cleared/replaced |
| forged/foreign pointer | no cross-project fact leaks; no guessing from id |
| stale pointer | honest unresolved current view; catalog/pulls remain usable |
| bedroom measurement question | Current View scopes “här”; router fetches measurements/components, not people/events |
| user asks about people from measurements page | page does not hard-filter intent; router may select coordination/people/events |
| image question | metadata first; pixels only after exact open |
| router malformed/timeout/off | `general` lens + grounded Current View/catalog/pull path remains usable |
| deliberate router miss | Main Bob pulls another category in same turn |
| process lens | changes steering only; lens text is fixed server code, not project evidence |
| selected solution/drawing | current target and pinned revisions stay distinct from newer evidence |
| changed measurement | next turn reads new revision; provider conversation cannot override it |
| sensitive people fields | email/diet/auth/account notes absent from Current View/catalog/manifests/research |
| revoked access | no later current-view/category/image read and no final answer release |
| evidence | pointer/catalog/lens not cited as facts; only grounded current-view/project reads are sources |

Record router and Main Bob usage separately in the existing shared usage ledger so “cheap sort, expensive think” can be evaluated with real cost/latency data.

## Decisions locked for implementation

- The page tells Bob **where**, never **what is true**.
- Screen context crosses the wire as a bounded pointer descriptor.
- Current View is hydrated server-side under caller JWT/RLS and may contain the same compact semantic context the person sees: viewer, project, area, focused task/step/drawing/etc., status and safe relations such as assignees.
- Screen pointer and Current View are different trust classes and different types.
- Surface changes clear stale focus pointers; Ask bob overlay does not clear the underlying page context.
- The user's actual message remains the one canonical routing query.
- Project Catalog stays small navigation context.
- Router is a separately configured cheap call; it returns only fixed ProcessLens + category/scope selection.
- Process Lens prose is fixed server-owned steering, never cheap-model-authored prompt text.
- Main Bob sees grounded Current View + compact catalog so it can understand page references and repair router misses.
- Row/byte/tool/image budgets remain server-owned.
- All project reads use caller JWT + existing RLS.
- Images are metadata-first and pixels-on-demand.
- Librarian reuses the same adapters and ships later.
- Conversation continuity and project-context freshness remain separate planes.
- Slice 0 remains rollout fallback until replacement is proven live.

## Discovery still required at implementation time

1. Map each current Bob route/page to the exact `BobSurface` pointer it should publish and decide which in-page selections deserve explicit focus pointers.
2. Verify exact current columns/projections on facts/solutions/target/artifacts at pickup time.
3. Confirm how `AskBob` can read the page snapshot without introducing stale React state across project/auth changes.
4. Verify shared OpenAI continuation + image-input shape before C5; keep any service extension provider-neutral.
5. Choose the actual router model/settings from live `shared.ai_models`; never bake a model name into this plan.
6. Tune router/prefetch/tool budgets from measured latency/token evidence.
7. Rebase implementation work onto current `main` before migrations because foundation work continues independently of this planning PR.