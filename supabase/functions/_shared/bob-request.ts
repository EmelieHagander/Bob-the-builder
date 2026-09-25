import type { ProjectAnswer } from './project-answer.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Bob-Release',
  'X-Bob-Release': 'bob-drawing-delivery-2026-09-25',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
})
const fail = (error: string, status: number) => json({ ok: false, error }, status)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Same injectable HTTP boundary in deployment and integration tests. */
export function createBobHandler(deps: {
  authenticate: (header: string) => Promise<string | null>
  enqueue?: (opts: { authHeader: string; userId: string; projectId: string; message: string; clientTurnId: string }) => Promise<ProjectAnswer | { ok: true; status: 'accepted'; projectId: string; jobId: string; expiresAt: string }>
  answer: (opts: { authHeader: string; userId: string; projectId: string; message: string; clientTurnId: string }) => Promise<ProjectAnswer>
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (req.method !== 'POST') return fail('method_not_allowed', 405)
    try {
      const authHeader = req.headers.get('Authorization') ?? ''
      if (!/^Bearer\s+\S+$/i.test(authHeader)) return fail('unauthorized', 401)
      const userId = await deps.authenticate(authHeader)
      if (!userId) return fail('unauthorized', 401)
      const text = await req.text()
      if (new TextEncoder().encode(text).length > 24_000) return fail('bad_request', 400)
      let body: Record<string, unknown>
      try { body = JSON.parse(text) } catch { return fail('bad_request', 400) }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('bad_request', 400)
      if (body.action !== 'send') return fail('unsupported_action', 409)
      // clientTurnId is an idempotency key only. Provider ids, transcripts and
      // model history remain server-owned and are still rejected here.
      if (Object.keys(body).some(k => !['action', 'projectId', 'message', 'clientTurnId', 'background'].includes(k))) return fail('bad_request', 400)
      if (typeof body.projectId !== 'string' || !body.projectId.trim() || body.projectId.length > 200) return fail('project_required', 400)
      if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4096) return fail('invalid_message', 400)
      if (body.clientTurnId !== undefined && (typeof body.clientTurnId !== 'string' || !UUID.test(body.clientTurnId))) return fail('invalid_turn_id', 400)
      // Accept old clients during the coordinated rollout; new clients supply
      // the UUID so a network retry can resolve to the same logical turn.
      if (body.background !== undefined && typeof body.background !== 'boolean') return fail('bad_request', 400)
      const clientTurnId = typeof body.clientTurnId === 'string' ? body.clientTurnId : crypto.randomUUID()
      const result = await (body.background === true && deps.enqueue ? deps.enqueue : deps.answer)({ authHeader, userId, projectId: body.projectId, message: body.message.trim(), clientTurnId })
      if (!result.ok) {
        const status = result.error === 'unauthorized' ? 401 : result.error === 'project_denied' ? 403 : result.error === 'turn_in_flight' ? 409 : 503
        return fail(result.error, status)
      }
      if ('jobId' in result) return json(result, 202)
      return json({ ok: true, backend: 'openai', status: 'completed', projectId: result.projectId, summary: result.answer, evidence: result.evidence })
    } catch {
      return fail('service_unavailable', 503)
    }
  }
}
