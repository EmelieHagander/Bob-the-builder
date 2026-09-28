# Shared AI background calls

Status (2026-09-28): PR #152 is merged. Database migrations, Edge endpoints and the UI are deployed. Bob’s receiver is enabled after signed webhook acceptance and scheduler/callback checks. New authenticated background turns pin the durable Responses transport; existing turns and the shared guest keep their prior behavior. A real model/tool/drawing turn after activation still requires live acceptance. Other apps require separate opt-in.

## Ownership and contract

The shared Responses service owns model configuration, provider execution and accounting. Each app owns its session, caller authority, tools, review and final delivery. The shared database does not run the model: it stores an opaque operation identity, routing context, state and, temporarily, the provider result. No prompts or user credentials are stored in the shared job queue. Completed output is private to service commands, removed after one day; idempotency tombstones and webhook IDs are retained for seven days. The normal usage ledger contains counts and prices, not output.

Apps opt in through `OpenAIServiceOptions.background`:

```ts
background: {
  key: `${sessionId}/${stableOperationKey}`,
  fingerprint: stableInputHash,
  receiver: 'registered_receiver',
  context: { sessionId },
  expiresAt: absoluteDeadline,
}
```

`app` remains the caller's normal app identifier. Keys must identify one logical model call and survive restarts. The hash must cover its original input and tools; ephemeral timeouts and retrieval timestamps must not change its identity. On resume, invoke the same operation: `AIBackgroundPending` means persist app waiting state and release the worker. A completed response goes through the existing shared parser, including function-call outputs and `previous_response_id`. A model completion can request another app tool; it does not imply that the user's overall task is complete.

Only a trusted server can call the shared RPCs. A database administrator registers `(app, receiver)` with a fixed SQL handler `(job uuid, context jsonb, status text)` in `shared_private.ai_receivers`. Request bodies cannot specify arbitrary callback URLs. The handler must durably mark the app session ready and be safe to retry. It must recheck current app authority before consuming output or executing tools. Registration does not grant a browser or another app's user access to the job. The shared service role remains a trusted cross-app server boundary, not an isolation boundary between compromised servers sharing that key.

## Delivery and recovery

1. Reserve the operation durably before a provider POST. Only the first reservation gets submission authority.
2. Start a Responses request with `background: true`, `store: true` and the opaque job ID in metadata. Persist its response ID. Re-entry returns the existing state.
3. The raw-body signature-verified webhook persists an event inbox row before acknowledging. It performs no model work itself.
4. A capability-authorized shared worker retrieves the authoritative provider response. Completion, token counts and the original pricing snapshot commit atomically. Duplicate or out-of-order delivery cannot create a second usage entry.
5. A durable completion outbox wakes the registered app. App callback failure does not roll back the provider result or accounting. Callback retries are independent of provider execution.
6. `pg_cron` and `pg_net` retrieve known response IDs if webhook delivery is delayed or lost. They never POST the same model operation again. Waiting is distinct from a failed provider attempt.

The acceptance POST can have an ambiguous outcome if the network or worker dies. It is deliberately not retried blindly. A later signed completion can recover its ID through provider metadata, including when the acceptance checkpoint was lost. If no receipt/event ever arrives, the absolute deadline produces a failure; exactly-once provider execution cannot be promised across an unacknowledged POST. Definite 400/401/403/404/422/429 rejection fails the operation promptly. Transient retrieval failures retry the same ID.

`shared.ai_job_cancel(app,key)` cancels a pending logical call; deadline expiry has the same no-late-resume rule. Known provider responses are cancelled best-effort with durable retries for up to one hour after expiry. Late terminal usage is still accounted for, but late content cannot revive the app operation. A provider cancellation request is not a claim that earlier computation was free.

The initial transport covers **OpenAI Responses** calls, including app tool loops. The separate `/images/generations` helper and external CAD rendering service retain their own contracts; they do not acquire background support by setting this Responses option. Additional provider/long-running tool adapters need an explicit lifecycle integration.

## Bob integration and user-visible behavior

New Bob jobs pin `async_models` at enqueue time from the receiver's enabled setting. Already-running legacy jobs keep their original transport. Bob journals one stable operation key per model call and parks on `waiting_ai_job`, without consuming stall retries or repeatedly claiming a worker while OpenAI computes. Completion-before-wait and wait-before-completion both preserve wakeup. The existing owner JWT, current membership checks, generation fencing and exact artifact review remain authoritative.

Durable CAD uses the turn's absolute deadline instead of restarting its five-minute local timer on every replay. The overall turn is still bounded at twenty minutes and by the authenticated caller's credential; this change does not promise an unlimited session or renew authorization in the background.

Once a CAD model request has a persisted provider response ID, Bob records a separate, private delegation notice: “Jag har skickat ritningen till designern. Jag återkommer här när resultatet är granskat.” It is shown during waiting and retained beside the eventual answer. It is not a completed assistant turn and does not falsely finish the user's request. The final reviewed answer still comes from Bob's normal loop.

The active project's Ask bob button shows **New from Bob** for a new final answer or failure. The shell checks only inbox metadata every ten seconds while visible, and immediately on focus or a local delivery/read event. This works even when the drawer was never opened in the current page session. Opening a mounted drawer refreshes server history. The user's per-thread read sequence is persisted on the server, advances only to actually displayed outcomes at the bottom of a visible chat, and cannot acknowledge a future message. Old history is initialized as read during migration. Shared guests retain their existing local-only conversation mode. This is an in-app visual badge, not a browser/OS push or sound notification, and currently applies to the active project's private chat.

## Rollout and rollback

1. Coordinate this additive shared migration with the owner of the common AI service. The generic service module and `ai-background.ts` must travel together when other repos adopt this version. Do not replace another app's divergent copy without reviewing its changes. No other app's settings are changed here.
2. Apply `20260928100626_shared_ai_background_jobs.sql`, then `20260928100953_bob_ai_background_notifications.sql`. Both are tested against the full isolated Bob schema. The receiver starts disabled and the worker URL is unset.
3. Deploy `ai-background-worker` and `ai-background-webhook`, with their custom capability/signature authentication and `verify_jwt=false`. Deploy updated `ask-bob`/`bob-worker` bundles and the UI. Keep the existing Bob JWT modes.
4. Set `shared_private.ai_runtime.worker_url` to this project's shared worker endpoint. Register the webhook URL in the OpenAI project matching `OPENAI_API_KEY`, subscribing to `response.completed`, `response.failed`, `response.incomplete`, `response.cancelled`. Store its signing secret as `OPENAI_WEBHOOK_SECRET`. Background Responses stores provider state; verify the project's retention configuration supports it.
5. Confirm signed event handling, the recovery scheduler and receiver callback before enabling `shared_private.ai_receivers` for Bob. New jobs then opt in; no running job is changed mid-replay.
6. Verify a synthetic slow Responses/tool/review turn, duplicate event, missed webhook recovery, closed-chat badge/reload/read receipt, and revoked access. Full real-room drawing fidelity is separate acceptance.

For a graceful rollback, let active app turns drain with the receiver enabled and their compatible workers still deployed; then disable the receiver. Disabling prevents every new model-operation reservation, including a later tool-loop call in an already-pinned turn. Already-submitted operations can still reconcile and deliver, but disabling is not a promise that a multi-call turn can finish. An emergency rollback should explicitly cancel and settle affected turns. Do not roll a synchronous-only worker over async journals. Stop scheduler/webhook only after pending provider work is reconciled. The schema can remain in place disabled.

## Evidence and sources

Automated tests exercise reservation isolation and permissions, duplicate accounting/delivery, interrupted submission, signed/forged webhooks, provider tool-response parsing, Bob wait/wake ordering, and unread authority. The Bob browser recovery scenario covers closed-chat completion, reload and badge acknowledgement at phone and desktop widths. See the PR checks for actual pass/fail results; file presence is not live verification.

- [OpenAI background mode](https://developers.openai.com/api/docs/guides/background)
- [OpenAI webhooks](https://developers.openai.com/api/docs/guides/webhooks)
- [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Bob conversations](ask-bob-conversations.md)


## Deployment record — 2026-09-28

Release commit: `14a35873af67e759b2f131b733a878e441342992` ([PR #152](https://github.com/EmelieHagander/Bob-the-builder/pull/152)). The 602-test CI, Edge checks and browser flows passed before merge. [Pages deployment](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36413212078) and [live Auth/RLS/OpenAI release check](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36413212076) both succeeded. The live check covered the existing transport, not signed background completion.

- Source migration `20260928100626_shared_ai_background_jobs.sql` is recorded by the managed migration API as `20260928105942 / shared_ai_background_jobs`.
- Source migration `20260928100953_bob_ai_background_notifications.sql` is recorded as `20260928105958 / bob_ai_background_notifications`. Do not reapply by comparing timestamps alone.
- Deployed `ask-bob` v51 (JWT enabled), `bob-worker` v19 (private capability), and shared `ai-background-worker` / `ai-background-webhook` v1 (capability / signature authentication).
- Worker URL configured for project `yuobtgoidmmmwfqenkau`; the `shared-ai-background` minute scheduler has successful runs. Receiver `(bob,bob)` is still disabled.
- Live unauthenticated POST probes return 401 for both workers and `ask-bob`. The webhook returns 503 because `OPENAI_WEBHOOK_SECRET` is not configured; no unsigned event is accepted.
- Live privilege checks confirm shared reservation is service-only, inbox commands require authentication, and private job RLS is enabled. Advisors report the intended no-browser-policy private tables and guarded authenticated SECURITY DEFINER inbox commands; these boundaries are covered by the SQL authority tests. See [Supabase database advisors](https://supabase.com/docs/guides/database/database-linter).

### Activation — 2026-09-28, 15:43 Europe/Stockholm

The user configured the signing secret and sent OpenAI's `response.completed` test. The endpoint returned HTTP 204 and the signed event was persisted at 13:41:22 UTC. Both background schedulers reported successful runs. A rollback-only terminal fixture exercised the registered Bob callback twice and confirmed delivery acknowledgement without retaining fixture rows or usage. This callback fixture had no live Bob turn; it does not prove the complete model/tool/chat flow.

The sample event references `resp_abc123`, not a real model response. Its exact inbox row was marked finished after verifying receipt, preventing pointless retrieval retries against the sample ID. No real model job was marked complete.

With zero active Bob jobs, `(bob,bob)` was enabled and read back as true. No other app receiver was enabled. New authenticated background turns now use the durable provider transport. Full real-model/CAD acceptance remains the next check; the signed sample proves webhook authentication and receipt only. PR #153's additional synchronous retry bound is separate and not yet deployed. Never paste the signing secret into chat, source code, a PR, or logs.
