# bob — edge functions (the Launchpad seam)

bob owns **no AI infrastructure**. When someone asks him something his script
can't answer, he hands the question to **Launchpad** — the AI-coworker
platform — where a team of builders works it out on Launchpad's runtime and
Launchpad's AI gateway. bob only carries the question over and brings the
answer back.

This directory is that seam: the **only server-side code bob has**, and the
**one shared pattern every app in this shared Supabase project reuses** to
talk to Launchpad.

## The shape

```
supabase/functions/
├── _shared/launchpad.ts     ALL the plumbing (JSON-RPC 2.0 / PP×A2A, auth,
│                            error mapping). App-agnostic — never edited
│                            per app.
└── ask-launchpad/index.ts   bob's deployment: one line pins app = 'bob'.
```

Why a server-side function at all: the Launchpad partner API key is a real
secret. It can never ship in the frontend bundle (everything `VITE_*` is
public), so it lives in Supabase **function secrets** and only this function
ever sees it. The function also refuses anonymous callers — a request must
carry a signed-in bob user's JWT (the shared guest login counts), otherwise
the key would be an open proxy.

**Per-app identity is pinned in source, not in the request.** Launchpad gives
every app its own workspace (its memory/billing boundary) keyed by
`external_workspace_id`. bob's function sends `'bob'` because that's written
in `ask-launchpad/index.ts` — a browser cannot ask for another app's
workspace. That rule is what makes the pattern safe to reuse.

## Adding the next app (the whole recipe)

1. Copy `ask-launchpad/index.ts` to `<yourapp>-launchpad/index.ts` and change
   the one line to `serveLaunchpad({ app: 'yourapp' })`.
2. Set `LAUNCHPAD_TEAM_KEY_YOURAPP` (which Launchpad team it invokes).
3. Ask the Launchpad side for a workspace + mapping for `'yourapp'` (one
   data-seed row pair on their side — same partner account, same key).
4. `supabase functions deploy yourapp-launchpad --project-ref <ref>`

No new key, no new protocol code, no schema work.

## Configuration (Supabase function secrets)

Set these once for the whole project (Dashboard → Edge Functions → Secrets,
or `supabase secrets set --project-ref <ref> KEY=value`):

| Secret | What it is |
| --- | --- |
| `LAUNCHPAD_GATEWAY_URL` | Partner-gateway base, e.g. `https://<laf-ref>.supabase.co/functions/v1/partner-gateway` |
| `LAUNCHPAD_INTEGRATION_ID` | The partner-integration UUID (issued on the Launchpad side) |
| `LAUNCHPAD_PARTNER_API_KEY` | The partner API key — shown once at issue time, server-only |
| `LAUNCHPAD_TEAM_KEY_BOB` | The team bob invokes (falls back to `LAUNCHPAD_TEAM_KEY`) |

Until all four are set the function answers `{ ok: false, error:
"not_configured" }` and the app quietly falls back to scripted Ask-bob —
deploying before Launchpad-side onboarding is finished is safe.

## The contract (what the UI may promise)

- **Info-only.** The builders answer questions and produce reports; they never
  write into bob's database. No "bob will add it to your list" copy.
- **Async.** `send` returns a task id; the client polls `status` until
  `completed` / `failed`. Minutes, not seconds — the UI shows an honest
  working state.
- **Clarification.** A run may pause `input-required` with a question; the
  next message answers it (`reply`).
- **Artifacts by reference.** Rich outputs come back as ids redeemed via
  `artifact`, never inlined.

## Actions (what the frontend calls)

`POST` body → response, always `{ ok: boolean, ... }`:

| Request | Response |
| --- | --- |
| `{ action: 'send', message }` | `{ ok, taskId, status: 'working' }` |
| `{ action: 'status', taskId }` | `{ ok, status: 'working' \| 'input-required' \| 'completed' \| 'failed', summary?, report?, artifacts?, question?, errorCode? }` |
| `{ action: 'reply', taskId, questionId, answer }` | `{ ok, status: 'working' }` |
| `{ action: 'artifact', artifactId }` | `{ ok, artifact }` |

Errors are honest strings: `not_configured`, `unauthorized`,
`empty_message`, `message_too_long`, `gateway_unreachable`,
`bad_gateway_response`, or a Launchpad error code passed through.

## Deploying

```bash
supabase functions deploy ask-launchpad --project-ref <ref>
```

The frontend calls the function through `supabase.functions.invoke` from
`src/data/database.ts` (the app's single data module), so no frontend config
changes when the function moves or the secrets rotate.
