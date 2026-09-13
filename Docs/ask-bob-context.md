# Ask bob — project context gateway

> **Status: specified / pre-build.** This is the owning contract for how Ask bob discovers, selects, opens and researches project context at runtime. It does **not** claim that the Project Catalog, Context Router or Project Librarian are built yet.
>
> **Current runtime (2026-09-13):** `supabase/README.md` owns the deployed Slice 0 briefing + bounded `search_project_data` lookup. This document specifies the next context-assembly shape. `Docs/ask-bob-conversations.md` separately owns transcript/provider continuity. Where that document says “fresh project briefing”, this document refines the future implementation into the catalog → route → retrieve flow below.

## Decision

Bob should receive **exactly the project information needed for the current question, when it is needed**.

Do not put the whole project into every model call. Do not make a small routing model the authority on project truth. Do not force the main model to discover the whole database from scratch.

Use four distinct layers:

```text
PROJECT CATALOG      what kinds of project information exist?
       ↓
CONTEXT ROUTER       which categories/scopes are likely relevant now?
       ↓
DETERMINISTIC FETCH  what do those current project records actually say?
       ↓
MAIN BOB             reason; pull more context or research if needed
```

The key separation is:

```text
existence/navigation ≠ relevance ≠ retrieval ≠ reasoning
```

The Project Catalog and retrieval code are deterministic Bob infrastructure. The Context Router is a cheap relevance helper. Main Bob owns the answer. The project database remains the truth authority.

## Architecture sketch

```text
User message
    │
    │ canonical contextQuery = the actual current user message
    ▼
┌──────────────────────────────────────────────────────────────┐
│ buildProjectCatalog(projectId, callerJwt)                    │
│                                                              │
│ project: id + name                                           │
│ areas: small id/name manifest                                │
│ categories:                                                  │
│   areas, measurements, components, images, materials, tasks, │
│   solutions, drawings, people, events, announcements         │
│   + future registered AI-safe project resource families      │
│ each category: count + supported scopes/capabilities          │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Context Router — cheap model                                 │
│                                                              │
│ input:                                                       │
│   contextQuery                                               │
│   ProjectCatalog                                             │
│   safe UI context (optional: current area/page)              │
│                                                              │
│ output: STRICT route plan only                               │
│   categories + scope + intent                                │
│   no SQL, no table names, no arbitrary filters               │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Category adapters — deterministic caller-authorised reads    │
│                                                              │
│ listProjectCategory(request)                                 │
│ openProjectItem(ref)                                         │
│                                                              │
│ current revision / status / provenance / evidence            │
│ bounded manifest shapes; RLS + same-project checks           │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Main Bob                                                     │
│                                                              │
│ fresh BOB_TRUTH_RULES                                        │
│ selected fresh project manifests                             │
│ current user message                                         │
│ provider-side conversational continuity                      │
│                                                              │
│ can answer                                                   │
│ can list another category                                    │
│ can open a specific item/image/drawing                       │
│ can ask Project Librarian for multi-source research          │
│ can ask the human only when project information is missing   │
└──────────────────────────────────────────────────────────────┘
```

The router is an **optimization, not a gate**. If it misses a category, Main Bob can pull that category during the same turn.

## Canonical query

Create the routing/retrieval query exactly once from the real current user message:

```ts
interface BobTurnInput {
  projectId: ProjectId
  message: string
  clientTurnId: string
  uiContext?: {
    areaId?: AreaId
    route?: string
  }
}

const contextQuery = input.message
```

All automatic context-selection paths consume this same `contextQuery`.

Do **not** reconstruct it later from an assembled prompt, provider conversation, transcript frame or tool result. Conversation state may help Main Bob resolve references, but the preflight query has one source.

## Project Catalog

The Project Catalog is a **small deterministic navigation manifest**, not a dump of project records.

Its job is to tell the router what can be opened without spending tokens on unrelated content.

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
  project: {
    id: ProjectId
    name: string
  }
  areas: ReadonlyArray<{
    id: AreaId
    name: string
  }>
  categories: ReadonlyArray<ProjectCatalogCategory>
  generatedAt: string
}
```

Example:

```json
{
  "project": { "id": "p123", "name": "Bedroom bunk bed" },
  "areas": [
    { "id": "a1", "name": "Bedroom" },
    { "id": "a2", "name": "Stairs" }
  ],
  "categories": [
    { "category": "measurements", "count": 23, "scopeKinds": ["project", "area"], "canList": true, "canOpenItem": true, "canResearch": true },
    { "category": "images", "count": 38, "scopeKinds": ["project", "area"], "canList": true, "canOpenItem": true, "canResearch": true },
    { "category": "people", "count": 12, "scopeKinds": ["project"], "canList": true, "canOpenItem": true, "canResearch": false }
  ],
  "generatedAt": "..."
}
```

A question about bedroom measurements therefore does not spend context on the twelve people, forty-two materials or unrelated project photos. Their **categories exist in the catalog**, but their rows are not loaded unless selected.

### Area is both a category and a scope

Areas are special:

- a user may ask about areas themselves (“which areas still have open work?”);
- an area may also scope another category (“measurements in Bedroom”).

The catalog may include the small area id/name manifest because it lets the router resolve human area references without loading every area record.

## Registration rule — how future project data reaches Bob

Do not make the catalog a hand-maintained list that drifts from the runtime.

Every AI-addressable project resource family should have one server-owned registry entry/adaptor describing:

```ts
interface ProjectContextAdapter<ItemRef, ManifestRow, OpenedItem> {
  category: ProjectCategory
  scopeKinds: readonly ProjectScopeKind[]

  count(ctx: ProjectReadContext): Promise<number>

  list(
    ctx: ProjectReadContext,
    request: CategoryRequest,
  ): Promise<CategoryManifest<ManifestRow>>

  open(
    ctx: ProjectReadContext,
    ref: ItemRef,
  ): Promise<OpenedItem>
}
```

Adding a future project resource such as calculations, BOMs, inspections or generated artifacts must answer:

> **How is this resource represented in the Project Catalog, listed as a bounded manifest, and opened as current evidence?**

That is the extension contract. Bob should not gain bespoke direct table knowledge for every new feature.

## AI-safe catalog, not raw app-schema catalog

“Everything in the project” means **every project resource Bob is allowed to know exists**, not every table/field in the application.

The context registry must preserve the existing purpose/field allowlist discipline. Private/sensitive fields stay excluded even if their parent feature exists.

Examples:

- `people` may expose the already-approved construction identity/role/skill projection, not email/auth ids/private dietary data;
- project media may expose safe image metadata and authorised bytes, not raw storage internals;
- service/configuration/usage/internal tables never appear;
- a new sensitive domain is absent until its own AI purpose + field contract exists.

A count or category name must not become a side channel for data Bob is not permitted to know exists.

## Context Router

The router answers one narrow question:

> **Which project categories and scopes should Main Bob see first for this user message?**

It does not answer the user's construction question.

```ts
interface CategoryRequest {
  category: ProjectCategory
  scope?: {
    areaId?: AreaId
  }
  intent?: string
  limit?: number
}

interface ContextRoutePlan {
  requests: readonly CategoryRequest[]
  reason: 'selected' | 'nothing_needed' | 'fallback'
}
```

Example:

```json
{
  "requests": [
    {
      "category": "measurements",
      "scope": { "areaId": "a1" },
      "intent": "inspect current bedroom dimensions"
    },
    {
      "category": "components",
      "scope": { "areaId": "a1" },
      "intent": "identify existing parts those measurements describe"
    }
  ],
  "reason": "selected"
}
```

### Router constraints

The router receives only server-provided catalog values and returns only schema-validated identifiers/options.

It cannot choose:

- SQL;
- schema/table names;
- arbitrary columns;
- raw PostgREST filters;
- another project;
- another user's private chat;
- provider continuation ids.

Unknown categories, ids, filters or extra fields are rejected before a project read.

### Router failure posture

The router is fail-soft.

```ts
try {
  routePlan = await runContextRouter(...)
} catch {
  routePlan = { requests: [], reason: 'fallback' }
}
```

A router timeout/error must not make project truth unavailable or fail the whole Bob turn. Main Bob still receives the minimal hard context and can use the pull tools below.

Do not silently substitute a guessed category list and call it routed context.

## Category manifests

A selected category returns a **bounded manifest appropriate to that resource type**. There is no requirement that every manifest row expose the same fields.

```ts
interface CategoryManifest<Row> {
  category: ProjectCategory
  projectId: ProjectId
  scope: {
    areaId?: AreaId
  }
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

Some manifests may already contain enough evidence to answer a simple question. Main Bob should not open every row merely because it was listed.

## Images are first-class project context

Images must participate in the same hierarchy as measurements, drawings and tasks.

The first fetch returns **image metadata**, not image bytes:

```text
images / Bedroom

image:img_21  "Wall before demolition"  current
image:img_24  "Stud behind plasterboard" reference
image:img_27  "Bunk bed sketch"          proposal
```

Only when Main Bob decides an image itself is relevant does it call `open_project_item` for that image. The backend then rechecks access and obtains the authorised original for the vision-capable model path.

This keeps image tokens/bytes out of unrelated turns while still making Bob aware that useful visual evidence exists.

Image pixels are evidence/context, not measurements. The existing media and project-fact provenance rules remain authoritative.

## Main Bob pull surface

Main Bob must be able to repair an incomplete preflight during the **same turn**.

Prefer a small generic context vocabulary instead of one AI tool per database table:

```ts
list_project_category({
  category: 'drawings',
  scope: { areaId: 'a1' }
})

open_project_item({
  ref: 'image:img_24'
})

ask_project_librarian({
  task: 'Compare the measurements, selected solution and drawings relevant to the bedroom wall and identify conflicts.',
  scope: { areaId: 'a1' }
})
```

The browser does not call these tools directly. They are server/model tools inside the bound Bob turn.

### Pull-before-user-question rule

Main Bob should normally try project retrieval before asking the human for information that may already exist.

```text
need more information
      │
      ├─ project may contain it → list/open/research project context
      │
      └─ project genuinely lacks it → request_user_input
```

Do not ask “what is the bedroom width?” when an authorised current measurement already records it.

## Project Librarian

The Project Librarian is an **on-demand research worker**, not the automatic router and not the project authority.

Use it when Main Bob needs multi-source research rather than one bounded category/list/open operation.

Proposed pipeline:

```text
ask_project_librarian(task, scope)
        │
        ▼
PLAN                 cheap model
1–3 focused research subqueries
        │
        ▼
RETRIEVE             deterministic Bob adapters
current records from approved categories/scopes
        │
        ▼
RERANK                cheap model
bounded evidence set
        │
        ▼
SYNTHESIZE            research model
cited/structured research result
        │
        ▼
GATE                  cheap model
coverage/grounding/thinness check
        │
        ▼
Main Bob receives research result + source refs
```

Its output is evidence for Main Bob to reason over; the Librarian does not become a parallel conversational persona.

```ts
interface ProjectResearchResult {
  status: 'ok' | 'thin' | 'empty' | 'error'
  summary: string
  sources: ReadonlyArray<{
    ref: ProjectItemRef
    revision?: number
  }>
  qualityFlag?: string
}
```

The pipeline may evolve, but the public contract should stay small and provider-neutral.

## Project item references

Do not let the model improvise raw table/id pairs. Use typed opaque references emitted by manifests:

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

The dispatcher maps the prefix to the fixed adapter and validates the id under the bound project/caller.

The model never supplies `projectId` inside an item ref. The server-bound turn already owns the project.

## Freshness and truth

The Project Catalog is navigation metadata. A category manifest is current-turn retrieved data. An opened item is current-turn evidence.

Provider conversation state is **not** one of those evidence levels.

```ts
function maySupportCurrentProjectClaim(source: ContextSource): boolean {
  return source.kind === 'category_manifest' ||
    source.kind === 'opened_project_item' ||
    source.kind === 'project_librarian_source'
}
```

If Bob remembers “the wall was 3100 mm” from an older conversation, that memory helps understand the user's reference but does not satisfy the evidence requirement. The current measurement must be fetched again when the value matters.

Every manifest/open/research read carries retrieval time and current revision/source metadata where the domain supports it.

## Turn integration

The conversation-state machine remains owned by `Docs/ask-bob-conversations.md`. Context assembly slots into `PREPARE_FRESH_TURN` and the existing tool loop:

```ts
async function prepareFreshBobTurn(input: BoundBobTurn): Promise<PreparedBobTurn> {
  const contextQuery = input.message

  const catalog = await buildProjectCatalog(input.projectReadContext)

  const routePlan = await runContextRouterFailSoft({
    contextQuery,
    catalog,
    uiContext: input.uiContext,
  })

  const manifests = await Promise.all(
    routePlan.requests.map((request) =>
      listProjectCategory(input.projectReadContext, request)
    ),
  )

  return {
    truthRules: BOB_TRUTH_RULES,
    contextQuery,
    catalog,
    selectedProjectContext: manifests,
    userMessage: input.message,
    previousResponseId: input.lastCommittedProviderResponseId,
    tools: BOB_CONTEXT_TOOLS,
  }
}
```

The full catalog need not be repeated to Main Bob if the selected manifests already encode the relevant navigation result; implementation should measure whether keeping the tiny catalog helps repair misses. The router always receives it.

## Example — irrelevant categories stay closed

User:

```text
How do the measurements look in the bedroom?
```

Catalog:

```text
areas=4, measurements=23, components=7, images=38,
materials=42, tasks=19, solutions=3, drawings=4,
people=12, events=2, announcements=5
```

Route:

```json
{
  "requests": [
    { "category": "measurements", "scope": { "areaId": "bedroom" } },
    { "category": "components", "scope": { "areaId": "bedroom" } }
  ],
  "reason": "selected"
}
```

Main Bob gets the bedroom measurement/component manifests. It does **not** get people, events, materials or 38 image records.

If Main Bob notices that a measurement source references a relevant drawing, it can request drawings during the same turn.

## Example — image discovery without image preload

User:

```text
Do we have a photo showing the studs in that wall?
```

Route:

```json
{
  "requests": [
    { "category": "images", "scope": { "areaId": "bedroom" } }
  ],
  "reason": "selected"
}
```

Manifest:

```text
image:img_21  Wall before demolition   current
image:img_24  Stud behind plasterboard  reference
image:img_27  Bunk bed sketch           proposal
```

Main Bob opens only `image:img_24`; that single authorised original enters the vision path.

## Example — deep multi-source question

User:

```text
Are there any conflicts between the bedroom dimensions and the plan we selected?
```

Preflight can select measurements + selected solution + drawings. If that bounded context is insufficient or spans many revisions, Main Bob can call:

```ts
ask_project_librarian({
  task: 'Check current bedroom measurements against the selected target/solution and relevant drawing revisions. Identify contradictions and cite exact project refs/revisions.',
  scope: { areaId: 'bedroom' },
})
```

The Librarian performs bounded research and returns source refs; Main Bob makes the final response.

## Context budget discipline

Hierarchy exists to keep the main prompt useful, not merely small.

1. **Catalog:** tiny; categories/counts + area names/ids.
2. **Selected category manifests:** bounded rows and fields.
3. **Opened items:** only when Main Bob needs exact detail/bytes/history.
4. **Librarian:** bounded multi-source research when several opens/searches would otherwise bloat the main turn.
5. **Conversation:** provider-managed continuity/compaction, never a substitute for fresh project evidence.

Never solve overflow by silently dropping arbitrary project evidence after it was selected. Reduce before retrieval through hierarchy/budgets, or return explicit `truncated`/`partial` states that Main Bob can react to.

## Access / authority invariants

1. The turn is bound to one authenticated user + one explicit project before catalog construction.
2. Catalog, list, open and Librarian retrieval all use the caller-authorised project read seam; no model-selected project.
3. Every relation end is same-project validated.
4. Router output is untrusted selection data and is schema-validated before reads.
5. Project text is evidence/data, never instructions that can widen the context/tool surface.
6. Main Bob may pull more context; it may not bypass category/item allowlists.
7. Image bytes are fetched only after an explicit open under current access.
8. Private/sensitive domains/fields absent from the AI allowlist do not appear in counts, names or manifests.
9. A database/read error is not an empty category.
10. `truncated`, `empty`, `denied`, `unavailable` and `not_found` remain distinguishable.
11. Provider conversational state cannot prove a current project fact.
12. Membership is rechecked before slow/deep work and before releasing the final answer, preserving the existing revocation rule.

## Suggested implementation order

### Context A — registry + catalog

- define the server-owned category registry;
- implement the tiny Project Catalog under caller authority;
- start with the current Slice 0 datasets plus already-shipped media/facts/solutions/artifacts that have approved projections;
- add tests that excluded/sensitive fields/domains never affect the catalog.

### Context B — category manifests + open-by-ref

- parameterized `list_project_category` dispatcher;
- typed `ProjectItemRef` + `open_project_item` dispatcher;
- image metadata list + authorised image-open seam for vision;
- current revisions/provenance in domain-specific manifest shapes;
- explicit bounded/partial result states.

### Context C — cheap router preflight

- strict router input/output schemas;
- one canonical `contextQuery` from the actual user message;
- configured cheap model through the shared AI settings/catalogue rather than a hardcoded provider/model;
- fail-soft to no automatic category fetch;
- measure routing latency/cost and category-selection quality.

### Context D — Main Bob repair pulls

- expose list/open tools to the existing server-side tool loop;
- preserve lookup/access rechecks on every pull;
- prove a router miss can be repaired by Main Bob in the same turn;
- add `request_user_input` only after project retrieval paths are exhausted/insufficient.

### Context E — Project Librarian

- add only after list/open paths are proven;
- plan → retrieve → rerank → synthesize → gate behind one small tool contract;
- source every retrieval through the same context adapters as normal Bob reads;
- keep Librarian as research support, not a second project-truth authority.

### Context F — tune + prove

Verify at minimum:

- a bedroom measurement question does not load people/events/unrelated media;
- a people question can select people without loading measurements/materials;
- an image question lists metadata first and opens only the chosen image bytes;
- a named project item can be opened deterministically even if semantic/text ranking would miss it;
- router failure does not block Main Bob or invent context;
- Main Bob repairs a missed category in the same turn;
- changed measurement/solution/drawing revisions override stale conversation values;
- truncated category manifests are visibly partial and can be narrowed/opened;
- denied/revoked access leaks no catalog counts, manifest rows, image bytes or Librarian synthesis;
- Project Librarian cites actual current project refs/revisions and cannot widen project scope;
- all current Slice 0 cross-project/forbidden-field tests continue to pass.

## Relationship to current owners

- `supabase/README.md` — **current built** Ask bob project lookup/authority contract. Until the context gateway is implemented, that runtime remains truth.
- `Docs/ask-bob-conversations.md` — thread/transcript/provider continuity, compaction and recovery.
- `Docs/media-and-steps.md` — image/media and task-step domain truth.
- `Docs/project-facts.md` — measurement/component truth and revisions.
- `Docs/solutions.md` — solution/target truth and revisions.
- `Docs/artifacts.md` — drawing/artifact truth and lineage.
- `db/README.md` — membership/RLS/data authority.

This document owns only **how Ask bob navigates those domains into runtime context**. It does not redefine any domain's data meaning or access contract.
