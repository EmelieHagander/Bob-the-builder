/** Optional durable Responses transport shared by all apps. No app tools or data access. */
export interface BackgroundCall {
  key: string
  fingerprint: string
  receiver: string
  context: Record<string, unknown>
  expiresAt: string
}
export class AIBackgroundPending extends Error {
  constructor(readonly jobId: string, readonly accepted: boolean) { super('ai_background_pending') }
}
export type AiRpc = (name: string, args: Record<string, unknown>) => Promise<any>
export class AIProviderHttpError extends Error {
  constructor(readonly status: number) { super('ai_provider_http_' + status) }
}
export interface BackgroundAccounting {
  user_id: string | null; module: string; ai_function: string; model: string
  input_price_per_1m: number; output_price_per_1m: number; cached_price_per_1m: number
}
export async function providerRequest(apiKey: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch('https://api.openai.com/v1/responses' + path, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new AIProviderHttpError(response.status)
  return response.json()
}
/** Reserve BEFORE submission. An uncertain POST is never blindly resubmitted.
 * Its signed completion event can recover the association using the opaque job ID.
 * A persisted response is consumed by the normal shared parser, without a second bill. */
export async function backgroundResponse(rpc: AiRpc, apiKey: string, app: string, call: BackgroundCall,
  request: Record<string, unknown>, accounting: BackgroundAccounting,
  prepare?: () => Promise<Record<string, unknown>>): Promise<any> {
  const job = await rpc('ai_job_reserve', { p_app: app, p_key: call.key, p_fingerprint: call.fingerprint,
    p_receiver: call.receiver, p_context: call.context, p_expires: call.expiresAt, p_accounting: accounting })
  if (job.response) return job.accounting ? { ...job.response, _shared_accounting: job.accounting } : job.response
  if (job.status === 'completed') throw new Error('ai_background_result_expired')
  if (['failed', 'expired', 'cancelled'].includes(job.status)) throw new Error('ai_background_' + job.status)
  if (job.submit) {
    // Local preparation cannot have submitted a provider request. Reject the intent
    // explicitly on failure rather than leaving it in ambiguous-POST recovery.
    let prepared = request
    try { if (prepare) prepared = await prepare() }
    catch (error) { await rpc('ai_job_reject', { p_job: job.id }); throw error }
    let response: any
    try {
      response = await providerRequest(apiKey, '', { ...prepared, background: true, store: true,
        metadata: { ai_job_id: job.id } })
    } catch (error) {
      if (error instanceof AIProviderHttpError && [400, 401, 403, 404, 422, 429].includes(error.status)) {
        await rpc('ai_job_reject', { p_job: job.id })
        throw error
      }
      // The provider may have accepted the request. Keep the durable intent for
      // webhook reconciliation and deadline handling; never submit a duplicate.
      throw new AIBackgroundPending(job.id, false)
    }
    try { await rpc('ai_job_accept', { p_job: job.id, p_response: response }) }
    catch { throw new AIBackgroundPending(job.id, false) }
    // Re-read the committed state: expiry/cancellation can win while POST is in flight.
    if (!['queued', 'in_progress'].includes(response.status)) return backgroundResponse(rpc, apiKey, app, call, request, accounting)
    throw new AIBackgroundPending(job.id, true)
  }
  throw new AIBackgroundPending(job.id, !!job.response_id)
}

/** Reconcile one durable work item. The DB validates capability and takes a lease.
 * Webhooks only persist a hint. Always retrieve the authoritative provider result. */
export async function reconcileAiWork(rpc: AiRpc, apiKey: string, kind: 'job' | 'event', id: string, capability: string) {
  const work = await rpc('ai_work_claim', { p_kind: kind, p_id: id, p_capability: capability })
  if (!work) return
  if (work.response_id) {
    const path = '/' + encodeURIComponent(work.response_id)
    const response = work.cancel ? await providerRequest(apiKey, path + '/cancel', {}) : await providerRequest(apiKey, path)
    const jobId = kind === 'job' ? id : response.metadata?.ai_job_id
    if (typeof jobId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobId)) {
      await rpc('ai_job_accept', { p_job: jobId, p_response: response })
      try { await rpc('ai_job_deliver', { p_job: jobId }) } catch { /* durable outbox retry */ }
    }
  }
  await rpc('ai_work_finish', { p_kind: kind, p_id: id })
}

/** Standard Webhooks HMAC: verify raw bytes, timestamp and any rotated v1 signature. */
export async function verifyAiWebhook(body: string, headers: Headers, secret: string, now = Date.now()): Promise<boolean> {
  try {
    const id = headers.get('webhook-id'), time = headers.get('webhook-timestamp')
    if (!id || id.length > 200 || !time || !/^\d+$/.test(time) || Math.abs(now / 1000 - Number(time)) > 300) return false
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0)),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const payload = new TextEncoder().encode(`${id}.${time}.${body}`)
    for (const part of (headers.get('webhook-signature') ?? '').split(' ')) {
      const [version, signature] = part.split(',')
      if (version === 'v1' && signature && await crypto.subtle.verify('HMAC', key,
        Uint8Array.from(atob(signature), c => c.charCodeAt(0)), payload)) return true
    }
  } catch { /* malformed or untrusted request */ }
  return false
}
