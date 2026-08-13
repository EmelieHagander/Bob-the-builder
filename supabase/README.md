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
- **The briefing is RLS-scoped.** The OpenAI backend reads the project with the
  caller's JWT, never the service-role key, so a user cannot reach a project
  they aren't a member of by asking bob nicely.
- **Async vs. sync is visible and honest.** Launchpad's `send` returns a task
  id to poll and the UI shows a working state. OpenAI's `send` returns
  `status: 'completed'` with the answer and there is nothing to poll — the UI
  renders it immediately rather than inventing a fake task and a fake wait.
- **Clarification (Launchpad only).** A run may pause `input-required`; the next
  message answers it (`reply`). The OpenAI backend never pauses, so a `reply`
  there is simply treated as the next question.
- **Artifacts by reference (Launchpad only).** Rich outputs come back as ids
  redeemed via `artifact`. A single model turn produces prose, not artifacts.

## Actions (what the frontend calls)

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
