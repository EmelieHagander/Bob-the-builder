/** Optional durable Responses transport shared by all apps. No app tools or data access. */
import { AIProviderHttpError, AIBackgroundStorageError, AIBackgroundNotSubmitted, recordAiFailure } from './ai-background-diagnostics.ts'
import { readResponseItems } from './openai-content.ts'
export { AIProviderHttpError, AIBackgroundStorageError } from './ai-background-diagnostics.ts'
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
  if (!response.ok) {
    // The provider's own error code/message (never request content) explains a rejection.
    let detail: string | null = null
    try { const body = await response.json(); detail = [body?.error?.code, body?.error?.param, body?.error?.message].filter(v => typeof v === 'string').join(' | ').slice(0, 300) || null } catch { /* no JSON body */ }
    if (detail) console.log('[AI provider error]', JSON.stringify({ status: response.status, request_id: response.headers.get('x-request-id'), detail }))
    throw new AIProviderHttpError(response.status, response.headers.get('x-request-id'), detail)
  }
  return response.json()
}
/** Reserve BEFORE submission. An uncertain POST is never blindly resubmitted.
 * Its signed completion event can recover the association using the opaque job ID.
 * A persisted response is consumed by the normal shared parser, without a second bill. */
export async function backgroundResponse(rpc: AiRpc, apiKey: string, app: string, call: BackgroundCall,
  request: Record<string, unknown>, accounting: BackgroundAccounting,
  prepare?: () => Promise<Record<string, unknown>>): Promise<any> {
  const started = performance.now()
  let job: any
  try { job = await rpc('ai_job_prepare', { p_app: app, p_key: call.key, p_fingerprint: call.fingerprint,
    p_receiver: call.receiver, p_context: call.context, p_expires: call.expiresAt, p_accounting: accounting }) }
  catch (error) { await recordAiFailure(rpc, 'job', null, 'reserve', error, started); throw error }
  if (job.response) return job.accounting ? { ...job.response, _shared_accounting: job.accounting } : job.response
  if (job.status === 'completed') throw new Error('ai_background_result_expired')
  if (['failed', 'expired', 'cancelled'].includes(job.status)) throw new Error('ai_background_' + job.status)
  if (job.submit) {
    // Local preparation cannot have submitted a provider request. Reject the intent
    // explicitly on failure rather than leaving it in ambiguous-POST recovery.
    let prepared = request
    try { if (prepare) prepared = await prepare() }
    catch (error) {
      await recordAiFailure(rpc, 'job', job.id, 'prepare', error, started)
      try { await rpc('ai_job_reject', { p_job: job.id }) }
      catch (storageError) { await recordAiFailure(rpc, 'job', job.id, 'reject', storageError, started) }
      throw error
    }
    // Preparation can outlive cancellation or expiry. Commit the one submission
    // intent only while this exact operation is still open, before the POST.
    let gate: any
    try { gate = await rpc('ai_job_start_submission', { p_job: job.id }) }
    catch (error) { await recordAiFailure(rpc, 'job', job.id, 'submit', error, started); throw new AIBackgroundPending(job.id, false) }
    if (gate?.submit !== true) {
      if (['failed','expired','cancelled','completed'].includes(gate?.status)) {
        const error=new AIBackgroundNotSubmitted(gate.status)
        await recordAiFailure(rpc,'job',job.id,'submit',error,started)
        throw error
      }
      throw new AIBackgroundPending(job.id, false)
    }
    let response: any
    try {
      response = await providerRequest(apiKey, '', { ...prepared, background: true, store: true,
        metadata: { ai_job_id: job.id,
          ...(Array.isArray(prepared.include) && prepared.include.includes('reasoning.encrypted_content') ? { ai_replay_items: '1' } : {}) } })
    } catch (error) {
      await recordAiFailure(rpc, 'job', job.id, 'submit', error, started)
      if (error instanceof AIProviderHttpError && [400, 401, 403, 404, 422, 429].includes(error.status)) {
        try { await rpc('ai_job_reject', { p_job: job.id }) }
        catch (storageError) { await recordAiFailure(rpc, 'job', job.id, 'reject', storageError, started) }
        throw error
      }
      // The provider may have accepted the request. Keep the durable intent for
      // webhook reconciliation and deadline handling; never submit a duplicate.
      throw new AIBackgroundPending(job.id, false)
    }
    try {
      if (response.status === 'completed' && Array.isArray(prepared.include) && prepared.include.includes('reasoning.encrypted_content')) readResponseItems(response.output)
      if (await rpc('ai_job_accept', { p_job: job.id, p_response: response }) === false) throw new AIBackgroundStorageError()
    }
    catch (error) {
      await recordAiFailure(rpc, 'job', job.id, 'accept', error, started, response?.id)
      throw new AIBackgroundPending(job.id, false)
    }
    // Re-read the committed state: expiry/cancellation can win while POST is in flight.
    if (!['queued', 'in_progress'].includes(response.status)) return backgroundResponse(rpc, apiKey, app, call, request, accounting)
    throw new AIBackgroundPending(job.id, true)
  }
  throw new AIBackgroundPending(job.id, !!job.response_id)
}

/** Reconcile one durable work item. The DB validates capability and takes a lease.
 * Webhooks only persist a hint. Always retrieve the authoritative provider result. */
export async function reconcileAiWork(rpc: AiRpc, apiKey: string, kind: 'job' | 'event', id: string, capability: string) {
  const started = performance.now()
  let work: any
  try { work = await rpc('ai_work_claim', { p_kind: kind, p_id: id, p_capability: capability }) }
  // An unvalidated work capability must not append a failure to another job.
  catch (error) { await recordAiFailure(rpc, kind, null, 'claim', error, started); throw error }
  if (!work) return
  if (work.response_id) {
    const path = '/' + encodeURIComponent(work.response_id)
    let response: any
    try { response = work.cancel ? await providerRequest(apiKey, path + '/cancel', {}) : await providerRequest(apiKey, path) }
    catch (error) { await recordAiFailure(rpc, kind, id, work.cancel ? 'cancel' : 'retrieve', error, started, work.response_id); throw error }
    // Native replay jobs need complete output items. A persisted response
    // carries its reasoning by item id; the provider refuses encrypted content
    // for it (2026-10-20), so the plain retrieval is the complete payload.
    if (!work.cancel && response.status === 'completed' && response.metadata?.ai_replay_items === '1') {
      try { readResponseItems(response.output) }
      catch (error) { await recordAiFailure(rpc, kind, id, 'retrieve', error, started, work.response_id); throw error }
    }
    const jobId = kind === 'job' ? id : response.metadata?.ai_job_id
    if (typeof jobId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobId)) {
      try { await rpc('ai_job_accept', { p_job: jobId, p_response: response }) }
      catch (error) { await recordAiFailure(rpc, 'job', jobId, 'accept', error, started, response.id); throw error }
      try { await rpc('ai_job_deliver', { p_job: jobId }) }
      catch (error) { await recordAiFailure(rpc, 'job', jobId, 'deliver', error, started, response.id) /* durable outbox retry */ }
    }
  }
  try { await rpc('ai_work_finish', { p_kind: kind, p_id: id }) }
  catch (error) { await recordAiFailure(rpc, kind, id, 'finish', error, started, work.response_id); throw error }
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
