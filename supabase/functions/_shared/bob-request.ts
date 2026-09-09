import type { ProjectAnswer } from './project-answer.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
})
const fail = (error: string, status: number) => json({ ok: false, error }, status)

/** Same injectable HTTP boundary in deployment and integration tests. */
export function createBobHandler(deps: {
  authenticate: (header: string) => Promise<string | null>
  answer: (opts: { authHeader: string; userId: string; projectId: string; message: string }) => Promise<ProjectAnswer>
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
      // App-wide workspace + raw run/artifact ids cannot satisfy project isolation.
      // No gateway request is made, even if old Launchpad secrets remain set.
      if (body.action !== 'send') return fail('async_backend_unavailable', 409)
      if (Object.keys(body).some(k => !['action', 'projectId', 'message'].includes(k))) return fail('bad_request', 400)
      if (typeof body.projectId !== 'string' || !body.projectId.trim() || body.projectId.length > 200) return fail('project_required', 400)
      if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4096) return fail('invalid_message', 400)
      const result = await deps.answer({ authHeader, userId, projectId: body.projectId, message: body.message.trim() })
      if (!result.ok) return fail(result.error, result.error === 'project_denied' ? 403 : 503)
      return json({ ok: true, backend: 'openai', status: 'completed', projectId: result.projectId, summary: result.answer, evidence: result.evidence })
    } catch {
      return fail('service_unavailable', 503)
    }
  }
}
