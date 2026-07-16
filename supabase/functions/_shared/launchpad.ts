/*
 * launchpad.ts — the ONE shared client for Launchpad's partner gateway.
 *
 * Every app in this shared Supabase project talks to Launchpad through this
 * module: bob today, sibling apps tomorrow. The pattern is "shared code,
 * per-app pinned identity":
 *
 *   • This module holds all the protocol plumbing (JSON-RPC 2.0, PP×A2A,
 *     auth-forwarding, error mapping). It is app-agnostic.
 *   • Each app deploys its OWN thin edge function (bob's is ask-launchpad/)
 *     that calls serveLaunchpad({ app: 'bob' }). The app name is pinned in
 *     that function's source — NEVER read from the request — so a browser
 *     can never address another app's Launchpad workspace. Launchpad maps
 *     the app name (external_workspace_id) to a dedicated workspace per app,
 *     which is its memory/billing/erasure boundary.
 *
 * Config (Supabase function secrets, shared project-wide):
 *   LAUNCHPAD_GATEWAY_URL      base URL of the partner gateway, e.g.
 *                              https://<ref>.supabase.co/functions/v1/partner-gateway
 *   LAUNCHPAD_INTEGRATION_ID   the partner-integration UUID (URL path segment)
 *   LAUNCHPAD_PARTNER_API_KEY  the console-issued partner key (server-only!)
 *   LAUNCHPAD_TEAM_KEY_<APP>   which Launchpad team this app invokes
 *                              (falls back to LAUNCHPAD_TEAM_KEY)
 *
 * Until all of those are set the handler answers { ok: false, error:
 * "not_configured" } and the app falls back to its scripted behavior —
 * honest, never fake.
 *
 * The gateway contract is async and info-only: send returns a task handle,
 * the client polls; the team answers questions and produces artifacts, it
 * never writes into this database.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

/* ── config ────────────────────────────────────────────────────────────── */

export interface LaunchpadAppConfig {
  /** The app's identity, pinned in the per-app function source ('bob', …).
   *  Sent to Launchpad as external_workspace_id — never client-supplied. */
  app: string
}

interface ResolvedConfig {
  gatewayUrl: string
  integrationId: string
  apiKey: string
  teamKey: string
  externalWorkspaceId: string
}

function resolveConfig(appCfg: LaunchpadAppConfig): ResolvedConfig | null {
  const gatewayUrl = Deno.env.get('LAUNCHPAD_GATEWAY_URL')?.replace(/\/+$/, '')
  const integrationId = Deno.env.get('LAUNCHPAD_INTEGRATION_ID')
  const apiKey = Deno.env.get('LAUNCHPAD_PARTNER_API_KEY')
  const teamKey =
    Deno.env.get(`LAUNCHPAD_TEAM_KEY_${appCfg.app.toUpperCase()}`) ?? Deno.env.get('LAUNCHPAD_TEAM_KEY')
  if (!gatewayUrl || !integrationId || !apiKey || !teamKey) return null
  return { gatewayUrl, integrationId, apiKey, teamKey, externalWorkspaceId: appCfg.app }
}

/* ── responses ─────────────────────────────────────────────────────────── */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const fail = (error: string, status = 200, extra?: Record<string, unknown>) =>
  json({ ok: false, error, ...extra }, status)

/* ── the task status a client sees ─────────────────────────────────────── */

/** Gateway run states collapsed to what a chat UI needs. */
function simplifyStatus(status: string): 'working' | 'input-required' | 'completed' | 'failed' {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'needs_input':
    case 'input-required':
      return 'input-required'
    case 'failed':
    case 'timed_out':
    case 'canceled':
    case 'rejected':
      return 'failed'
    default:
      // submitted / working / processing / anything future — still running.
      return 'working'
  }
}

/* ── gateway JSON-RPC ──────────────────────────────────────────────────── */

interface RpcEnvelope {
  result?: Record<string, unknown>
  error?: { code: number; message: string; data?: { error_code?: string; retryable?: boolean } }
}

async function callGateway(
  cfg: ResolvedConfig,
  method: string,
  params: Record<string, unknown>,
): Promise<RpcEnvelope | { transportError: string }> {
  const requestId = crypto.randomUUID()
  try {
    const res = await fetch(`${cfg.gatewayUrl}/${cfg.integrationId}/a2a`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'Accept-Protocol-Version': 'pp.v1',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
    })
    const text = await res.text()
    try {
      return JSON.parse(text) as RpcEnvelope
    } catch {
      // An HTML body here means the gateway URL points at an SPA, not the API.
      console.error(`launchpad: non-JSON gateway response (${res.status}) for ${method}`)
      return { transportError: 'bad_gateway_response' }
    }
  } catch (err) {
    console.error(`launchpad: gateway unreachable for ${method}`, err)
    return { transportError: 'gateway_unreachable' }
  }
}

function rpcFailure(env: RpcEnvelope | { transportError: string }): string | null {
  if ('transportError' in env) return env.transportError
  if (env.error) return env.error.data?.error_code ?? env.error.message ?? 'gateway_error'
  if (!env.result) return 'gateway_error'
  return null
}

/* ── actions ───────────────────────────────────────────────────────────── */

const MAX_MESSAGE_CHARS = 4096 // gateway-enforced cap; fail fast client-side of it

type ActionBody = {
  action?: string
  message?: string
  taskId?: string
  questionId?: string
  answer?: string
  artifactId?: string
}

async function handleAction(cfg: ResolvedConfig, body: ActionBody): Promise<Response> {
  switch (body.action) {
    case 'send': {
      const message = body.message?.trim()
      if (!message) return fail('empty_message')
      if (message.length > MAX_MESSAGE_CHARS) return fail('message_too_long')
      const env = await callGateway(cfg, 'SendMessage', {
        team: { key: cfg.teamKey },
        message,
        context: {
          workspace_id: cfg.externalWorkspaceId,
          request_id: crypto.randomUUID(),
          idempotency_key: crypto.randomUUID(),
        },
      })
      const err = rpcFailure(env)
      if (err) return fail(err)
      const result = (env as RpcEnvelope).result!
      return json({ ok: true, taskId: result.taskId, status: 'working' })
    }

    case 'status': {
      if (!body.taskId) return fail('missing_task_id')
      const env = await callGateway(cfg, 'GetTask', { task_id: body.taskId })
      const err = rpcFailure(env)
      if (err) return fail(err)
      const result = (env as RpcEnvelope).result!
      const status = simplifyStatus(String(result.status ?? 'working'))
      // Pass through only the envelope fields the UI renders.
      const r = result as {
        summary?: string
        report_markdown?: string
        result_format?: string
        artifacts?: { artifact_id: string; kind: string }[]
        question?: { question_id?: string; question_text?: string; options?: string[]; expires_at?: string }
        error_code?: string
      }
      return json({
        ok: true,
        status,
        summary: r.summary,
        report: r.report_markdown,
        artifacts: r.artifacts,
        question: r.question
          ? {
              id: r.question.question_id,
              text: r.question.question_text,
              options: r.question.options,
              expiresAt: r.question.expires_at,
            }
          : undefined,
        errorCode: status === 'failed' ? (r.error_code ?? String(result.status)) : undefined,
      })
    }

    case 'reply': {
      if (!body.taskId || !body.questionId) return fail('missing_task_id')
      const answer = body.answer?.trim()
      if (!answer) return fail('empty_message')
      if (answer.length > MAX_MESSAGE_CHARS) return fail('message_too_long')
      const env = await callGateway(cfg, 'ProvideInput', {
        task_id: body.taskId,
        question_id: body.questionId,
        answer,
      })
      const err = rpcFailure(env)
      if (err) return fail(err)
      return json({ ok: true, status: 'working' })
    }

    case 'artifact': {
      if (!body.artifactId) return fail('missing_artifact_id')
      const env = await callGateway(cfg, 'GetArtifact', { artifact_id: body.artifactId })
      const err = rpcFailure(env)
      if (err) return fail(err)
      return json({ ok: true, artifact: (env as RpcEnvelope).result })
    }

    default:
      return fail('unknown_action', 400)
  }
}

/* ── entry point ───────────────────────────────────────────────────────── */

/**
 * The whole handler, ready to hand to Deno.serve from a per-app function:
 *
 *   import { serveLaunchpad } from '../_shared/launchpad.ts'
 *   Deno.serve(serveLaunchpad({ app: 'bob' }))
 */
export function serveLaunchpad(appCfg: LaunchpadAppConfig): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (req.method !== 'POST') return fail('method_not_allowed', 405)

    // The caller must be a signed-in user of THIS project (bob's guest login
    // included) — otherwise the function would be an anonymous proxy spending
    // the family's Launchpad key. The platform's verify_jwt gate lets the
    // anon key through, so the user check happens here.
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return fail('unauthorized', 401)

    const cfg = resolveConfig(appCfg)
    if (!cfg) return fail('not_configured')

    let body: ActionBody
    try {
      body = (await req.json()) as ActionBody
    } catch {
      return fail('bad_request', 400)
    }
    return handleAction(cfg, body)
  }
}
