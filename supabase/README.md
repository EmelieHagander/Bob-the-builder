# bob — edge functions (the Ask seam)

> Slice 0 implementation: locally tested, not deployed. See
> [verification and rollout](../Docs/slice-0-verification.md) for evidence and open gates.

**Provider decision (2026-09-09): Bob uses OpenAI directly for all AI work.**
OpenAI is the permanent integration, not a temporary fallback. Later V1 slices
extend this path. Provider configuration and tools are owned here.

Bob answers through `ask-bob` using **direct OpenAI with
bounded, read-only project tools**. The browser sends an explicit Bob project id;
the backend authenticates the user and uses their JWT for all project reads.

Launchpad is retired from Bob's architecture. The old `ask-launchpad` endpoint
has only a 410 retirement response for outdated clients; it makes no provider or
database calls, even if old secrets remain configured. Deploy that response as
part of the rollout so the previous live gateway cannot keep accepting requests.

## Code ownership

| File | Responsibility |
| --- | --- |
| `ask-bob/index.ts`, `_shared/serve-bob.ts` | Bob's OpenAI endpoint; validate Supabase Auth user. |
| `ask-launchpad/index.ts` | Retired URL: HTTP 410, no calls or automatic forwarding. |
| `_shared/bob-request.ts` | HTTP validation; reject unscoped/async actions and browser-supplied history or response ids. |
| `_shared/ask-openai.ts` | Caller-JWT client, membership checks, shared AI service adapter. |
| `_shared/project-answer.ts` | Briefing and bounded tool loop, server-only continuation, truth rules. |
| `_shared/project-lookup.ts` | Fixed tool arguments, budgets, result states and provenance. |
| `bob.search_project_data` | Static SQL projections under caller RLS; no arbitrary SQL/columns. |
| `_shared/openai-service.ts` | Existing shared Responses service; two generic type annotations corrected, runtime behavior unchanged. |

No browser or model has the service-role key. The shared service uses it only
for `shared.ai_models`, `shared.ai_settings` and `shared.ai_usage_events`.
`OPENAI_API_KEY` is still read only there. Model choice, reasoning effort,
usage attribution and the kill switch retain their existing configuration.

Bob uses the service's existing `useHardcodedPrompt` option so a settings prompt
cannot replace its authority/truth rules. The shared service currently sends
non-strict function schemas; the dispatcher independently rejects extra/invalid
arguments before a database call. No Bob-specific service logic is introduced.
The new Deno gate exposed two pre-existing annotation errors: nullable cost and
the async usage logger's Promise return. Both are corrected here. Carry these
generic declaration fixes when synchronising the canonical service copies;
other repositories/deployments were not rewritten as part of this Bob slice.

## Project lookup contract — Slice 0

> **Status:** implemented in this branch with local Postgres/HTTP tests; deployed provider and browser proof are still pending.
> **Owns:** Ask bob's bounded project lookup, allowed datasets/fields and result
> semantics. `db/README.md` owns the membership/RLS implementation; the release
> ordering remains in `Docs/v1-plan.md`.

Bob should be able to look up relevant persisted project data when answering a
question, in addition to receiving a short briefing. For example, "Which
materials are still missing for the porch?" should trigger a scoped materials
lookup rather than assume that the capped briefing contains every item.

### Request and authority

The browser supplies the explicit active `projectId` through `database.ts` to
the Ask edge function. The server authenticates the caller, validates their
membership in that project and binds the request/run to that user and project.
The identifier is the Bob project row id, not the shared Supabase project ref.

The model may call a typed `search_project_data` tool with a dataset and approved
filters. It does not choose the project, schema, table, columns or SQL. A
server-owned dispatcher maps the dataset to fixed queries, binds the validated
project id and reads using the caller's JWT. Unknown arguments, datasets and
operations are rejected; this tool exposes no write operation or arbitrary RPC.

Every lookup rechecks project access. Missing/invalid project context or failed
authorization ends the lookup before any project data reaches a provider.
There is no fallback to another project or to privileged project reads.

Membership must be trustworthy before this tool is enabled: project creation,
invitations and guest/volunteer joining must establish explicit project access,
and ordinary content edits must not let a caller grant themselves membership.
The legacy first-project join and globally unique person/auth link did not
provide that multi-project contract. This branch replaces them with membership-aware
RLS for the exposed parent/child tables; deployment remains a release gate.
A request filter alone does not close public API paths. See [Supabase's RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Initial allowlist

All sources below belong to schema `bob`. The lookup exposes only the
listed projections, subject to project membership; supporting joins are not independent
model-selectable datasets. Server-generated source ids/timestamps are described
under result semantics.

| Dataset | Source tables | Allowed project information |
| --- | --- | --- |
| `project` | `projects` | `id`, `slug`, `name`, `description`, `location`, `type`, `start_label`, `start_date`, `end_date`; only the bound project |
| `areas` | `areas` | `id`, `slug`, `name`, `description`, `lead_id`; filter by `project_id` |
| `tasks` | `tasks`, `areas`, `task_assignees`, `people` | Task `id`, `area_id`, `name`, `skill`, `hours`, `status`, `materials`; area name and assignee ids/names; scope tasks through their area |
| `materials` | `materials` | `id`, `name`, `qty`, `area_label`, `supplier`, `status`, `cost`, `category`; filter by `project_id` |
| `crew` | `people`, `person_skills` | Person `id`, `name`, `role`; skill `name` and `level`; scope skills through their person |
| `events` | `events`, `event_attendees`, `people` | Event `id`, `slug`, `title`, `day`, `time`, `place`, `spots`, `status`; attendee ids/names; scope attendees through their event |
| `announcements` | `announcements`, `people` | `id`, `text`, `pinned`, `time_label`; author id/name; filter by `project_id` |

Linked people and both ends of an assignment/attendance relation must belong to
the bound project. A foreign area/task/person id cannot widen the lookup.
Materials currently use `area_label`, not an area foreign key; filtering by
area must resolve that label inside the bound project and must not invent a
task-material relation. Role/skill labels are recorded project data, not proof
of backend authority or professional qualification.

Everything outside this allowlist is excluded from the new construction lookup
and its briefing projection: `person_emails`, `people.auth_user_id`, dietary/allergy
fields, food tables, account settings/notes, other apps' schemas, Auth records,
secrets, raw storage paths and AI configuration/usage records. Internal provider
configuration and usage bookkeeping remain server concerns, never tool results.
Media, measurements and selected solutions can extend this owner in their later
slices once their data/access contracts exist. The legacy briefing included
dietary text; the construction briefing and lookup now exclude those fields.
Any retained AI food/diet workflow needs its own purpose-specific projection and
the same project authority checks. The existing Food surfaces keep their contract.

### Bounded lookup and honest results

- Start with fixed exact-id/status filters and text matching on the allowed
  name/title/description/text fields. The dispatcher owns each dataset's filter
  schema; it parameterizes values and rejects raw filter expressions. An area
  filter must also be scoped. No unrestricted SQL, table browsing or generated
  query language is accepted.
- Initial budgets: at most 200 search-text characters, 25 parent records and 25
  joined records per lookup, 16 KiB serialized output and three lookups per user
  question. Enforce a 10-second lookup timeout. Truncated rows, joined data or
  text must be marked explicitly; the model cannot claim an exhaustive list
  from partial results. Broader searches require a narrower follow-up question.
- Results include the bound `projectId`, dataset, stable record ids, retrieval
  time and truncation/partial flags. Preserve source `updated_at` where present;
  retrieval time is not the time a physical condition was observed. Answers
  should reference the relevant existing project/area/task record where possible.
- Distinguish successful no-match, invalid request, denied access and unavailable
  data. A database error is not an empty project or "nothing missing". Return
  no project details on denial and do not expose raw database errors to the model.
- Stored text is evidence to interpret, not instructions for tool execution.
  It cannot change the dataset allowlist, project binding or authority rules.
- Reading a row does not promote it to a verified fact. Authored quantities,
  costs, dates and task readiness strings retain their current limitations;
  assumptions, estimates and unknowns stay labelled. New numeric/provenance
  models arrive in their owning V1 slices.

### Integration and implementation proof

Use one dispatcher and projection for the construction briefing and subsequent
lookups. Keep UI access through `database.ts`; extend the existing Ask backend
instead of giving a browser/model a separate database connection.

OpenAI builds the briefing and executes tools through the shared service. Its
actual tool integration must be verified before live lookup support is claimed.
Legacy task/status/reply and artifact handles are not accepted by the new API.
Project switching must isolate conversation/history, in-flight results and any
cache by user/project; an old answer must not appear as the new project's truth.

The following remain the acceptance contract. Local evidence and outstanding live gates are recorded in [slice-0-verification.md](../Docs/slice-0-verification.md):

1. A member can search the explicitly active project and retrieve a matching
   item omitted from the initial capped briefing; sources identify that project.
2. A member of two projects gets separate correct results after switching;
   requests/results/history from the previous project cannot leak into the new one.
3. A non-member, signed-out caller, forged project id, foreign child id or
   unrelated async run/artifact is denied at the applicable backend boundary.
   Exercise permitted and denied membership with ordinary JWT/API/RLS paths.
4. Forbidden fields/datasets, arbitrary SQL, writes and self-granted membership
   fail; successful reads contain only the allowlisted projection, including joins.
5. Empty results, timeouts, revoked access and row/byte/lookup limits preserve
   distinct honest states. Stored prompt-like text cannot alter tool permissions.
6. The OpenAI path proves its actual lookup and project-binding behavior before
   being labelled live; no mock result counts as live proof. The retired endpoint
   rejects old requests without contacting a provider.

## Actions

`POST` with a signed-in Bearer token:

| Request | Result |
| --- | --- |
| `{ action: 'send', projectId, message }` | `{ ok: true, backend: 'openai', status: 'completed', projectId, summary, evidence }` |
| Missing/invalid project id or message; supplied history/response id/schema | HTTP 400 |
| Invalid session | HTTP 401 |
| No membership in the requested project | HTTP 403 |
| `status`, `reply`, `artifact` (including legacy handles) | HTTP 409; no provider request |
| Database/model/configuration failure | HTTP 503, safe error code, no invented answer |

`evidence` marks the answer as an **AI assessment** and lists consulted record ids,
project, retrieval time, source update time when available, and unknown legacy
verification. The list records what Bob consulted; it is not a guarantee that
every generated claim follows from those sources. Conversation and drafts are
cleared when project/auth context changes. A generation guard also rejects late
A → B → A responses. Failure messages never substitute another project's feed.

## Deployment

First follow the reviewed membership migration and coordinated rollout in
[db/README.md](../db/README.md). Then deploy the edge function and frontend together.
Merging frontend code alone triggers Pages but does **not** migrate Supabase or
deploy the edge function; this PR must stay draft until those gates are resolved.

```bash
supabase functions deploy ask-bob --project-ref <ref>
supabase functions deploy ask-launchpad --project-ref <ref>
```

The second command retires the old deployment. Older clients must reload to use
`ask-bob`; unbound legacy requests are never forwarded automatically.

Required existing server configuration: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and Bob's enabled settings/model in
the shared AI catalogue. Frontend configuration remains
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
