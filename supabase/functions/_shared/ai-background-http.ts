import { reconcileAiWork, verifyAiWebhook, type AiRpc } from './ai-background.ts'
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s)
async function boundedBody(req: Request): Promise<string> {
  if (!req.body) throw new Error('missing_body')
  const reader = req.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 32768) { await reader.cancel(); throw new Error('body_too_large') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
export function aiWebhookHandler(rpc: AiRpc, secret: string | undefined) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response(null, { status: 405 })
    if (!secret) return new Response(null, { status: 503 })
    let body: string
    try { body = await boundedBody(req) } catch { return new Response(null, { status: 400 }) }
    if (!await verifyAiWebhook(body, req.headers, secret)) return new Response(null, { status: 401 })
    let event: any
    try { event = JSON.parse(body) } catch { return new Response(null, { status: 400 }) }
    if (!['response.completed', 'response.failed', 'response.incomplete', 'response.cancelled'].includes(event.type)) return new Response(null, { status: 204 })
    if (!/^resp_[a-zA-Z0-9_-]{1,200}$/.test(event.data?.id ?? '')) return new Response(null, { status: 400 })
    try {
      await rpc('ai_event_receive', { p_event: req.headers.get('webhook-id'), p_response: event.data.id })
      return new Response(null, { status: 204 })
    } catch { return new Response(null, { status: 503 }) }
  }
}
export function aiWorkerHandler(rpc: AiRpc, apiKey: string) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response(null, { status: 405 })
    const cap = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!uuid(cap)) return new Response(null, { status: 401 })
    let body: any
    try { body = JSON.parse(await boundedBody(req)) } catch { return new Response(null, { status: 400 }) }
    if (!body || !uuid(body.id) || !['job', 'event'].includes(body.kind) || Object.keys(body).length !== 2) return new Response(null, { status: 400 })
    try {
      await reconcileAiWork(rpc, apiKey, body.kind, body.id, cap)
      return new Response(null, { status: 204 })
    } catch { return new Response(null, { status: 503 }) }
  }
}
