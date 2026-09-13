# Ask bob — project context gateway

> **Status: specified / pre-build.** This is the owning contract for how Ask bob knows what the user is looking at, discovers project context, selects the relevant parts, opens exact records and researches across several project sources at runtime. It does **not** claim that the screen-context seam, Project Catalog, Context Router, Process Lens or Project Librarian are built yet.
>
> **Current runtime (2026-09-13):** `supabase/README.md` owns the deployed Slice 0 briefing + bounded `search_project_data` lookup. `Docs/ask-bob-conversations.md` separately owns transcript/provider continuity. Until this contract is implemented, the deployed Slice 0 path remains runtime truth.

## Decision

Bob should receive **exactly the information needed for the current question, when it is needed**.

That means separating five concerns that are easy to conflate:

```text
SCREEN POINTER          what is the person looking at?
        ↓
CURRENT VIEW            what does that on-screen project object actually say now?
        ↓
PROJECT CATALOG         what other project resource families are available?
        ↓
CONTEXT ROUTER          what should be loaded first + which work lens fits?
        ↓
DETERMINISTIC FETCH     what do those current records actually say?
        ↓
MAIN BOB                reason; pull more context or research if needed
```

The key separation is:

```text
navigation ≠ facts ≠ relevance ≠ retrieval ≠ reasoning
```

The browser is allowed to tell Bob **where the user is**, but never what is true there. The backend hydrates those navigation pointers through current caller-authorised project reads. The Project Catalog and category adapters are deterministic Bob infrastructure. The Context Router is a cheap relevance helper. Main Bob owns the answer. The project database remains the truth authority.

## Architecture sketch

```text
User message
    │
    ├── client screen pointer
    │     surface + opaque ids only
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│ hydrateCurrentView(pointer, projectId, callerJwt)            │
│                                                              │
│ verifies every id under the bound project                    │
│ derives viewer from Auth/project membership                  │
│ returns a compact semantic projection of what is on screen   │
│                                                              │
│ e.g.                                                         │
│ viewer=Emelie                                                │
│ area=Sovrum                                                  │
│ task=Måla sovrum                                             │
│ step=Måla                                                    │
│ assignees=[Emelie]                                           │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ├───────────────────────┐
                               │                       │
                               ▼                       ▼
┌─────────────────────────────────────┐   ┌───────────────────────────────┐
│ buildProjectCatalog(...)            │   │ canonical contextQuery        │
│                                     │   │ = current user message        │
│ categories + counts + area ids/names│   └───────────────────────────────┘
└────────────────────┬────────────────┘                 │
                     └──────────────┬───────────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────┐
│ Context Router — cheap configured model                     │
│                                                              │
│ input: contextQuery + CurrentView + ProjectCatalog           │
│ output: fixed ProcessLens + category/scope requests          │
│ no SQL, table names, project ids or arbitrary filters        │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Category adapters — deterministic caller-authorised reads    │
│                                                              │
│ listProjectCategory(request)                                 │
│ openProjectItem(ref)                                         │
│ current revision / status / provenance / evidence            │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Runtime turn assembly                                        │
│                                                              │
│ BOB_TRUTH_RULES                                              │
│ + PROCESS_LENS block                                         │
│ + CURRENT_VIEW block                                         │
│ + selected fresh project context                             │
│ + tiny Project Catalog                                       │
│ + provider conversational continuity                         │
│ + current user message                                       │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
                            MAIN BOB
                     answer / list / open / research
```

The router is an **optimization, not a gate**. If it misses something, Main Bob can pull another category or exact item during the same turn.

## Canonical user query

Create the routing query exactly once from the real current user message:

```ts
interface BobTurnInput {
  projectId: ProjectId
  message: string
  clientTurnId: string
  screen?: BobScreenPointer
}

const contextQuery = input.message
```

All automatic context-selection paths consume the same `contextQuery`. Do **not** reconstruct it later from an assembled prompt, provider conversation, transcript frame, page label or tool result.

Conversation state may help Main Bob resolve references, but the preflight question has one source.

## Screen context — pointer first, facts second

Bob should follow the same safety pattern proven in Kvarnstrands' context-aware assistant: the client publishes **navigation pointers**, and the server performs the grounded read.

The browser must not send a blob like:

```json
{
  "area": "Sovrum",
  "step": "Måla",
  "responsible": "Emelie"
}
```

Those strings look like facts but would make the browser a truth source.

Instead it sends a small descriptor such as:

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
  areaId?: AreaId
  taskId?: string
  stepId?: string
  solutionId?: string
  artifactId?: string
  eventId?: string
}
```

These ids are **opaque pointers, not facts**.

### Pointer validation

The request boundary validates only the wire shape and basic id format/length. It never turns pointer presence into a project claim.

The server then:

1. binds the turn to the authenticated user + explicit project;
2. derives the current project-person identity from the authenticated membership — never from a client-supplied name;
3. reads every pointed object under the caller JWT/RLS;
4. checks that relations agree (for example, a step belongs to the pointed task and the task belongs to the pointed area/project);
5. fails closed on stale, foreign or forged pointers;
6. returns a compact current-view projection containing only AI-safe fields.

A stale pointer must never make Bob guess what used to be on screen. A malformed descriptor is a request error. A well-formed pointer that no longer resolves is an honest `not_found`/empty current-view state; the rest of Bob may still work through the catalog and pull tools.

### Client lifecycle

Use one small app-level context publisher, analogous to Kvarnstrands' assistant surface snapshot:

```ts
setBobSurface({
  surface: 'task',
  areaId,
  taskId,
  stepId,
})

const pointer = getBobSurface() // read at send time
```

Each real page/surface publishes what it is showing. Switching to another page replaces the snapshot and clears pointers that are no longer visible. Opening the Ask bob drawer itself does **not** clear the page context because the page remains underneath it.

Do not infer this only from `window.location.pathname`: the URL does not always express the selected row, open detail, current step or other semantically useful focus.

## Current View — server-hydrated page semantics

`hydrateCurrentView` turns the pointer into a small, grounded representation of the same meaningful context the person can already see on the page.

```ts
interface CurrentViewContext {
  surface: BobSurface
  viewer: {
    personId: string
    name: string
  } | null
  project: {
    id: ProjectId
    name: string
  }
  focus: {
    area?: { id: AreaId; name: string }
    task?: { id: string; name: string; status: string }
    step?: {
      id: string
      title: string
      completedAt: string | null
      required: boolean
    }
    solution?: { id: string; title: string; revision: number; selected: boolean }
    drawing?: { id: string; title: string; revision: number; status: string }
    event?: { id: string; title: string; status: string }
  }
  related: {
    assignees?: ReadonlyArray<{ id: string; name: string }>
  }
  retrievedAt: string
}
```

The exact union should be implemented per surface rather than filling unrelated keys. The important contract is semantic: Bob gets the **current visible focus**, not a dump of the entire page.

Example hydrated block:

```text
CURRENT VIEW
Viewer: Emelie
Project: Renovering
Area: Sovrum
Task: Måla sovrum
Step: Måla
Task status: Doing
Responsible: Emelie
```

Because this block is server-hydrated through current project reads, its fields may support current project claims. The original browser pointer never may.

Current View should remain compact. If the task page contains twelve attachments, forty materials and a long history, those belong behind the normal category/list/open paths unless they are themselves the selected visible focus.

## Project Catalog

The Project Catalog is a **small deterministic navigation manifest**, not a project dump.

Its job is to tell the router and Main Bob what can be opened without spending context on unrelated records.

```ts
type ProjectCategory =
  | 'areas'
  | 'measurements'
  | 'components'
  | 'images'
  | 'materials'
  | 'tasks'
  | 'solutions'
  | 'drawings'
  | 'people'
  | 'events'
  | 'announcements'

type ProjectScopeKind = 'project' | 'area'

interface ProjectCatalogCategory {
  category: ProjectCategory
  count: number
  scopeKinds: readonly ProjectScopeKind[]
  canList: boolean
  canOpenItem: boolean
  canResearch: boolean
}

interface ProjectCatalog {
  project: { id: ProjectId; name: string }
  areas: ReadonlyArray<{ id: AreaId; name: string }>
  categories: ReadonlyArray<ProjectCatalogCategory>
  generatedAt: string
}
```

A bedroom-measurement question therefore does not spend context on people, build days or unrelated photos. Those categories exist in the catalog but their rows stay closed until selected.

### Area is both category and scope

Areas are special. A user can ask about areas themselves, and an area can scope another category such as measurements, tasks or images.

The small area id/name manifest may therefore be included in the catalog so the router can resolve a phrase such as “sovrummet” without loading full area records.

## Registration rule — how future data reaches Bob

Do not make the catalog a hand-maintained list that drifts from runtime.

Every AI-addressable project resource family gets one server-owned adapter:

```ts
interface ProjectContextAdapter<ItemRef, ManifestRow, OpenedItem> {
  category: ProjectCategory
  scopeKinds: readonly ProjectScopeKind[]

  count(ctx: ProjectReadContext): Promise<number>
  list(ctx: ProjectReadContext, request: CategoryRequest): Promise<CategoryManifest<ManifestRow>>
  open(ctx: ProjectReadContext, ref: ItemRef): Promise<OpenedItem>
}
```

Adding calculations, BOMs, inspections or generated artifacts must answer:

> How is this resource represented in the Project Catalog, listed as a bounded manifest and opened as current evidence?

Bob should not gain bespoke raw table knowledge for each feature.

## AI-safe catalog, not raw schema catalog

“Everything available in the project” means every project resource **Bob is allowed to know exists**, not every table/field in the application.

Examples:

- `people`: construction identity/role/skills only; no email, diet, auth ids or account notes;
- images: safe metadata + authorised bytes only after explicit open; no storage internals;
- service/configuration/usage/internal tables: never present;
- future sensitive domains: absent until their AI-safe field contract exists.

A category name or count must not become a side channel for forbidden data.

## Context Router

The router answers two narrow questions:

1. **Which fixed work lens should steer Main Bob for this turn?**
2. **Which project categories/scopes should Main Bob see first?**

It does not answer the user's construction question.

```ts
type ProcessLens =
  | 'general'
  | 'survey'
  | 'design'
  | 'drawing'
  | 'procurement'
  | 'execution'
  | 'coordination'

interface CategoryRequest {
  category: ProjectCategory
  scope?: { areaId?: AreaId }
  intent?: string
}

interface ContextRoutePlan {
  lens: ProcessLens
  requests: readonly CategoryRequest[]
  reason: 'selected' | 'nothing_needed' | 'fallback'
}
```

The router input is:

```text
current user message
+ server-hydrated Current View
+ Project Catalog
```

A page is a strong reference clue, not a hard filter. If the user is on Measurements and asks “vem kan hjälpa mig på lördag?”, the router may select `coordination` + people/events. If the user is on a task page and asks “vad var bredden här?”, the Current View resolves “här” to the current area while the router selects measurements.

### Process Lens is steering, not truth

The router may select only a fixed enum. It never writes prompt prose.

Server code owns short lens blocks such as:

```text
SURVEY
Prioritise current measurements, existing components, source images and uncertainty.
Do not jump to a construction conclusion while required dimensions are unknown.
```

```text
EXECUTION
Prioritise the selected target, current/build-ready drawings, task instructions,
materials and current site evidence. Prefer concrete next actions.
```

On router failure, use the neutral `general` lens. Never invent a free-text “phase” from the cheap model.

### Router constraints

The router receives server-provided values and returns only schema-validated enum/id choices. It cannot choose SQL, schema/table names, columns, raw PostgREST filters, another project, provider ids or browser-supplied fact text.

Unknown categories, area ids, lens names or extra fields are rejected before project reads.

### Failure posture

Router failure is fail-soft:

```ts
try {
  routePlan = await runContextRouter(...)
} catch {
  routePlan = { lens: 'general', requests: [], reason: 'fallback' }
}
```

Main Bob still receives the grounded Current View, compact catalog and pull tools.

## Category manifests

A selected category returns a bounded, domain-appropriate manifest:

```ts
interface CategoryManifest<Row> {
  category: ProjectCategory
  projectId: ProjectId
  scope: { areaId?: AreaId }
  rows: readonly Row[]
  totalMatching: number | null
  truncated: boolean
  retrievedAt: string
}
```

Examples:

```ts
interface MeasurementManifestRow {
  ref: `measurement:${string}`
  subject: string
  value: number | null
  unit: 'mm' | 'cm' | 'm'
  truthState: 'measured' | 'provided_spec' | 'estimated' | 'unknown'
  revision: number
  areaId: AreaId | null
  updatedAt: string
}

interface ImageManifestRow {
  ref: `image:${string}`
  title: string
  purpose: 'current' | 'reference' | 'instruction' | 'proposal' | 'progress' | 'as-built'
  areaId: AreaId | null
  width: number
  height: number
  updatedAt: string
}

interface DrawingManifestRow {
  ref: `drawing:${string}`
  title: string
  kind: 'plan' | 'elevation' | 'section' | 'detail'
  status: 'concept' | 'measured' | 'build_ready'
  revision: number
  targetDecisionRevision: number
  areaId: AreaId | null
  updatedAt: string
}
```

Some manifests may already contain enough evidence for a simple answer. Main Bob should not open every row merely because it was listed.

## Images are first-class context

Images participate in the same hierarchy as measurements, drawings and tasks.

The first fetch returns metadata, not pixels:

```text
images / Bedroom
image:img_21  Wall before demolition   current
image:img_24  Stud behind plasterboard reference
image:img_27  Bunk bed sketch           proposal
```

Only when Main Bob explicitly opens `image:img_24` does the backend recheck access, read the authorised original and place that one image into the vision-capable model path.

Image pixels are evidence/context, not measurements.

## Main Bob pull surface

Main Bob must be able to repair incomplete preflight in the **same turn**.

Prefer a small generic vocabulary:

```ts
list_project_category({ category: 'drawings', scope: { areaId: 'a1' } })
open_project_item({ ref: 'image:img_24' })
ask_project_librarian({
  task: 'Compare measurements, selected solution and drawings for this area and identify conflicts.',
  scope: { areaId: 'a1' },
})
```

The browser never calls these tools directly.

### Pull before asking the human

```text
need more information
      │
      ├─ project may contain it → list / open / research project context
      │
      └─ project genuinely lacks it → ask the user
```

Do not ask for a bedroom width that is already recorded as a current measurement.

## Project Librarian

The Project Librarian is an on-demand research worker, not the automatic router and not project authority.

Use it when Main Bob needs multi-source research rather than one bounded list/open operation:

```text
ask_project_librarian(task, scope)
        ↓
PLAN        cheap structured model
        ↓
RETRIEVE    deterministic project adapters
        ↓
RERANK      cheap structured model
        ↓
SYNTHESIZE  stronger configured model
        ↓
GATE        cheap grounding/coverage check
        ↓
Main Bob receives summary + exact source refs
```

```ts
interface ProjectResearchResult {
  status: 'ok' | 'thin' | 'empty' | 'error'
  summary: string
  sources: ReadonlyArray<{ ref: ProjectItemRef; revision?: number }>
  qualityFlag?: string
}
```

Its output is research evidence for Main Bob, not a parallel conversational persona.

## Project item references

Do not let the model improvise raw table/id pairs:

```ts
type ProjectItemRef =
  | `area:${string}`
  | `measurement:${string}`
  | `component:${string}`
  | `image:${string}`
  | `material:${string}`
  | `task:${string}`
  | `solution:${string}`
  | `drawing:${string}`
  | `person:${string}`
  | `event:${string}`
  | `announcement:${string}`
```

The server-bound turn already owns the project. Item refs never carry a project id.

## Freshness and truth

Context has distinct authority levels:

```text
browser screen pointer         navigation hint only, never evidence
server-hydrated Current View   current-turn project evidence
Project Catalog                navigation metadata, not substantive evidence
category manifest              current-turn project evidence
opened item                    current-turn project evidence
Librarian cited project refs   current-turn project evidence
provider conversation state    conversational continuity, never project authority
Process Lens                   steering only, never project evidence
```

If Bob remembers “the wall was 3100 mm” from an older turn, that helps interpret the conversation but does not satisfy a current project claim. Fetch the measurement again when the value matters.

## Runtime turn assembly

The conversation state machine remains owned by `Docs/ask-bob-conversations.md`. This contract slots into `PREPARE_FRESH_TURN`:

```ts
async function prepareFreshBobTurn(input: BoundBobTurn): Promise<PreparedBobTurn> {
  const contextQuery = input.message

  const currentView = await hydrateCurrentView({
    pointer: input.screen ?? null,
    projectReadContext: input.projectReadContext,
    viewerAuthUserId: input.userId,
  })

  const catalog = await buildProjectCatalog(input.projectReadContext)

  const routePlan = await runContextRouterFailSoft({
    contextQuery,
    currentView,
    catalog,
  })

  const manifests = await Promise.all(
    routePlan.requests.map(request =>
      listProjectCategory(input.projectReadContext, request),
    ),
  )

  return {
    truthRules: BOB_TRUTH_RULES,
    processLens: PROCESS_LENS_BLOCKS[routePlan.lens],
    currentView,
    contextQuery,
    catalog,
    selectedProjectContext: manifests,
    userMessage: input.message,
    previousResponseId: input.lastCommittedProviderResponseId,
    tools: BOB_CONTEXT_TOOLS,
  }
}
```

Recommended model-facing order:

```text
BASE / BOB_TRUTH_RULES
PROCESS LENS
CURRENT VIEW
SELECTED PROJECT CONTEXT
COMPACT PROJECT CATALOG
CONVERSATION CONTINUITY
CURRENT USER MESSAGE
```

The compact catalog lets Main Bob repair router misses. Current View resolves deictic phrases such as “den här”, “här inne”, “det här steget” without loading unrelated project categories.

## Example — same page context as the human

The user has the task detail open. The client sends only:

```json
{
  "surface": "task",
  "areaId": "area_bedroom",
  "taskId": "task_paint",
  "stepId": "step_paint"
}
```

The server hydrates:

```text
Viewer: Emelie
Area: Sovrum
Task: Måla sovrum
Step: Måla
Responsible: Emelie
```

User asks:

```text
Vad behöver jag göra nu?
```

The router can choose `execution` and fetch task/material/image context if needed. Bob does not need to ask “vilket rum?” or “vilket steg?” because those are already grounded in Current View.

If the user instead asks “vad var bredden här inne?”, the same Current View resolves the area while the router selects measurements. People/events remain closed.

## Example — irrelevant categories stay closed

User on the Bedroom area:

```text
Hur ser måtten ut här inne?
```

Current View establishes `area=Bedroom`. Router selects measurements/components for that area. Main Bob does **not** get people, events, shopping or all project images.

## Example — image discovery without preload

User:

```text
Har vi en bild som visar regeln bakom gipset här?
```

Current View resolves the area. Router lists image metadata for that area. Main Bob opens only the relevant image; only that original reaches vision.

## Context budget discipline

Hierarchy exists to keep the prompt useful, not merely small:

1. Current View: tiny semantic page focus.
2. Project Catalog: tiny categories/counts + area names/ids.
3. Selected category manifests: bounded rows and fields.
4. Opened items: exact detail/bytes/history only on demand.
5. Librarian: bounded multi-source research when many opens would bloat the main turn.
6. Conversation: provider-managed continuity/compaction, never current project evidence.

Never solve overflow by silently dropping selected evidence. Reduce before retrieval or return explicit `truncated` / `partial` states.

## Access / authority invariants

1. Every turn is bound to one authenticated user + one explicit project before any context read.
2. The browser screen descriptor is an untrusted navigation pointer, never a fact source.
3. The current viewer/person is derived server-side from authenticated project membership.
4. Every screen pointer is re-read and relation-checked under caller JWT/RLS before becoming Current View.
5. Catalog, list, open, image and Librarian reads all use caller-authorised project seams; no model-selected project.
6. Router output is untrusted selection data and schema-validated before reads.
7. Process Lens is fixed server-owned steering text selected from an enum; it is not model-authored policy.
8. Main Bob may pull more context but cannot bypass category/item allowlists.
9. Image bytes are fetched only after an explicit open under current access.
10. Private/sensitive domains absent from the AI allowlist do not appear in screen hydration, counts, manifests or research.
11. Database error, empty, not-found, denied, unavailable and truncated states remain distinguishable.
12. Provider conversational state cannot prove a current project fact.
13. Membership is rechecked before slow/deep work and before releasing the final answer.

## Suggested implementation order

### Context A — registry + catalog

- server-owned category registry;
- tiny Project Catalog under caller authority;
- current Slice 0 categories plus shipped media/facts/solutions/artifacts;
- excluded/sensitive fields cannot influence the catalog.

### Context B — screen pointer + Current View hydration

- one small client-side `bobSurfaceContext` publisher;
- strict request parser for `screen`;
- surface-specific server hydrators under caller JWT;
- server-derived viewer identity;
- stale/foreign pointer tests;
- prompt composition tests proving pointer text itself never becomes fact.

### Context C — category manifests + open-by-ref

- parameterized `list_project_category`;
- typed `ProjectItemRef` + `open_project_item`;
- image metadata + authorised image-open seam;
- revisions/provenance + explicit bounded result states.

### Context D — cheap router + Process Lens

- router sees `contextQuery + CurrentView + ProjectCatalog`;
- strict fixed-enum `ProcessLens` + category/scope output;
- configured cheap model through shared AI settings, no hardcoded model;
- fail-soft to `general` + no automatic prefetch;
- shadow-mode evaluation before routing changes Main Bob's context.

### Context E — Main Bob runtime assembly + repair pulls

- base rules + lens + Current View + selected context + catalog;
- list/open tools in the existing tool loop;
- prove a router miss can be repaired in the same turn;
- user questions come only after project retrieval is genuinely insufficient.

### Context F — Project Librarian

- plan → retrieve → rerank → synthesize → gate;
- same adapters as normal Bob reads;
- research support only, never parallel project authority.

### Context G — tune + prove

Verify at minimum:

- task page context hydrates area/task/step/assignee from live data rather than browser strings;
- stale/foreign task/step pointers never leak another project or become guessed page facts;
- page switches clear stale focus pointers;
- an area measurement question does not load people/events/unrelated media;
- a people question can route to people even when the user is on another page;
- image metadata lists before pixels and only the chosen image enters vision;
- router failure still leaves grounded Current View + catalog + pull tools;
- Main Bob repairs a missed category in the same turn;
- changed measurements/solutions/drawings override stale conversation;
- denied/revoked access leaks no screen-hydrated facts, counts, rows, image bytes or research;
- Process Lens changes steering without becoming a source of facts;
- all current Slice 0 isolation/forbidden-field tests continue to pass.

## Relationship to current owners

- `supabase/README.md` — **current built** Ask bob lookup/authority contract until this gateway is deployed.
- `Docs/ask-bob-conversations.md` — thread/transcript/provider continuity, compaction and recovery.
- `Docs/media-and-steps.md` — image/media and task-step truth.
- `Docs/project-facts.md` — measurement/component truth and revisions.
- `Docs/solutions.md` — solution/target truth and revisions.
- `Docs/artifacts.md` — drawing/artifact truth and lineage.
- `db/README.md` — membership/RLS/data authority.

This document owns only **how Ask bob turns current screen focus and project resources into runtime model context**. It does not redefine any domain's data meaning or access contract.