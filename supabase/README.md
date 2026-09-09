# bob — edge functions (the Ask seam)

When someone asks bob something his script can't answer, the question goes to
an AI backend. There are two, and which one answers depends only on what is
configured:

| Backend | Shape | What it's good at |
| --- | --- | --- |
| **Launchpad** | Async — send returns a task id, the client polls for minutes | A whole team of AI builders. Produces reports and artifacts, and can pause to ask a clarifying question. |
| **OpenAI direct** | Synchronous — the answer comes back on the send itself, in seconds | One model answering from a briefing of bob's own live data. |

Launchpad wins whenever the `LAUNCHPAD_*` secrets are set, because it is the
richer answer. Otherwise the OpenAI backend answers. With neither configured
the handler returns `{ ok: false, error: "not_configured" }` and the app falls
back to its scripted Ask-bob feed — honest, never fake.

This directory is that seam: the **only server-side code bob has**.

## The shape

```
supabase/functions/
├── _shared/launchpad.ts     Launchpad protocol plumbing (JSON-RPC 2.0 /
│                            PP×A2A, auth, error mapping) AND the router that
│                            picks a backend. App-agnostic.
├── _shared/ask-openai.ts    The OpenAI backend: assembles the prompt and
│                            bob's persona, delegates the call.
├── _shared/bob-context.ts   Builds "the briefing" — a compact snapshot of the
│                            project read with the CALLER'S JWT, so RLS decides
│                            what the model may see.
├── _shared/ai-service.ts    The ONE AI service, shared by every app in this
│                            Supabase project. Speaks the OpenAI Responses API.
│                            The only file that ever reads OPENAI_API_KEY.
│                            CANONICAL COPY — keep in sync across repos.
└── ask-launchpad/index.ts   bob's deployment: one line pins app + dbSchema.
```

Why a server-side function at all: both the Launchpad partner key and the
OpenAI key are real secrets. Neither can ship in the frontend bundle
(everything `VITE_*` is public), so they live in Supabase **function secrets**
and only these functions see them. The function also refuses anonymous callers
— a request must carry a signed-in bob user's JWT (the shared guest login
counts), otherwise the key would be an open proxy.

**Per-app identity is pinned in source, not in the request.** `ask-launchpad/
index.ts` passes `{ app: 'bob', dbSchema: 'bob' }`. `app` is bob's Launchpad
workspace (its memory/billing boundary) and how AI spend is attributed;
`dbSchema` is where the briefing is read from. A browser cannot ask for another
app's workspace or another app's data. That rule is what makes the pattern safe
to reuse.

## Adding the next app (the whole recipe)

1. Copy `ask-launchpad/index.ts` to `<yourapp>-launchpad/index.ts` and change
   the one line to `serveLaunchpad({ app: 'yourapp', dbSchema: 'yourapp' })`.
2. Copy `_shared/ai-service.ts` across unchanged, and give the app its own
   context builder in place of `bob-context.ts`.
3. Add an `ai.settings` row for `('yourapp', <coworker>, 'ask-bob', 'global')`.
4. For the Launchpad backend only: set `LAUNCHPAD_TEAM_KEY_YOURAPP` and ask the
   Launchpad side for a workspace mapping for `'yourapp'`.
5. `supabase functions deploy yourapp-launchpad --project-ref <ref>`

## Configuration (Supabase function secrets)

Set these once for the whole project (Dashboard → Edge Functions → Secrets, or
`supabase secrets set --project-ref <ref> KEY=value`):

| Secret | What it is |
| --- | --- |
| `OPENAI_API_KEY` | The OpenAI key, for the direct backend. Read only inside `ai-service.ts`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Already set project-wide. `ai-service.ts` needs it to read AI settings and write usage rows. |
| `LAUNCHPAD_GATEWAY_URL` | Partner-gateway base, e.g. `https://<laf-ref>.supabase.co/functions/v1/partner-gateway` |
| `LAUNCHPAD_INTEGRATION_ID` | The partner-integration UUID (issued on the Launchpad side) |
| `LAUNCHPAD_PARTNER_API_KEY` | The partner API key — shown once at issue time, server-only |
| `LAUNCHPAD_TEAM_KEY_BOB` | The team bob invokes (falls back to `LAUNCHPAD_TEAM_KEY`) |

The Launchpad set is all-or-nothing: until all four are present the router
falls through to the OpenAI backend.

### Model, cost and the kill switch

None of that is configured here. The shared `ai` schema owns it — see the
migration `20260813092414_shared_ai_schema.sql` in the hearthandlarder repo:

- `ai.models` — the catalogue and price list. **The** gate on which models may
  be called; there is deliberately no allow-list in code to drift out of sync
  with it. Adding a model is a row, not a deploy.
- `ai.settings` — bob's row is `app='bob', coworker_id='bob',
  function_name='ask-bob'`. Model, token ceiling, temperature, a prompt
  override that applies without a deploy, and `is_enabled` as a kill switch.
- `ai.usage_events` — one row per call with the price snapshot used, so what a
  question cost stays true after prices change.

## The contract (what the UI may promise)

- **Info-only, both backends.** They answer questions and produce reports; they
  never write into bob's database. No "bob will add it to your list" copy.
- **The briefing uses the caller's JWT.** The OpenAI backend uses the caller's
  database permissions, never the service-role key for project reads. Current
  policies still allow broad reads, and the briefing selects the first project;
  this is not yet proof of project isolation. Slice 0 must establish the
  membership and explicit-project boundary described below and in `db/README.md`.
- **Async vs. sync is visible and honest.** Launchpad's `send` returns a task
  id to poll and the UI shows a working state. OpenAI's `send` returns
  `status: 'completed'` with the answer and there is nothing to poll — the UI
  renders it immediately rather than inventing a fake task and a fake wait.
- **Clarification (Launchpad only).** A run may pause `input-required`; the next
  message answers it (`reply`). The OpenAI backend never pauses, so a `reply`
  there is simply treated as the next question.
- **Artifacts by reference (Launchpad only).** Rich outputs come back as ids
  redeemed via `artifact`. A single model turn produces prose, not artifacts.

## Project lookup contract — Slice 0

> **Status:** specified for implementation; not available in current runtime.
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
The current first-project join and globally unique person/auth link do not
provide that multi-project contract. Implement and test membership-aware RLS
for the exposed parent/child tables as part of Slice 0; a request filter alone
does not close the existing public API paths. See [Supabase's RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Initial allowlist

All sources below belong to schema `bob`. The planned lookup exposes only the
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
slices once their data/access contracts exist. The current briefing includes
dietary text; those fields must not implicitly enter the construction lookup.
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

Apply the same user/project boundary to both provider paths. Direct OpenAI
currently builds the briefing; Launchpad currently forwards messages with an
app workspace id, which is not a Bob project binding. Provider tool integration
must be verified before lookup support is claimed. Async task/status/reply and
artifact access must be bound server-side to the originating user/project as
well, not authorized merely because a caller supplies a remote task/artifact id.
Project switching must isolate conversation/history, in-flight results and any
cache by user/project; an old answer must not appear as the new project's truth.

The following are required implementation tests, **not passing tests today**:

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
6. Both configured provider paths prove their actual lookup and project-binding
   behavior before being labelled supported; no mock result counts as live proof.

## Actions (what the frontend calls today)

`POST` body → response, always `{ ok: boolean, ... }`:

| Request | Launchpad response | OpenAI response |
| --- | --- | --- |
| `{ action: 'send', message }` | `{ ok, taskId, status: 'working' }` | `{ ok, status: 'completed', summary }` |
| `{ action: 'status', taskId }` | `{ ok, status, summary?, report?, artifacts?, question?, errorCode? }` | `{ ok: false, error: 'no_task_to_poll' }` |
| `{ action: 'reply', taskId, questionId, answer }` | `{ ok, status: 'working' }` | `{ ok, status: 'completed', summary }` |
| `{ action: 'artifact', artifactId }` | `{ ok, artifact }` | `{ ok: false, error: 'artifacts_unavailable' }` |

Errors are honest strings: `not_configured`, `disabled`, `unauthorized`,
`empty_message`, `message_too_long`, `gateway_unreachable`,
`bad_gateway_response`, `no_task_to_poll`, `artifacts_unavailable`,
`rate_limited`, `bad_api_key`, `timeout`, `openai_error`, `openai_unreachable`,
or a Launchpad error code passed through.

## Deploying

```bash
supabase functions deploy ask-launchpad --project-ref <ref>
```

Apply the shared `ai` schema migration **before** deploying, or the service
finds no model catalogue and every call returns `no_model`.

The frontend calls the function through `supabase.functions.invoke` from
`src/data/database.ts` (the app's single data module), so no frontend config
changes when the function moves or the secrets rotate.
