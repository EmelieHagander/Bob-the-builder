/** Content-free diagnostics. Never copy exception messages, stacks, provider
 * bodies, URLs, credentials or model input into either log sink. */
export type AiFailurePhase = 'reserve' | 'prepare' | 'submit' | 'accept' | 'reject' | 'claim' | 'retrieve' | 'cancel' | 'deliver' | 'finish'
export class AIProviderHttpError extends Error {
  constructor(readonly status: number, readonly requestId: string | null = null) { super('ai_provider_http_' + status) }
}
export class AIBackgroundStorageError extends Error {
  constructor(readonly code?: string, readonly reason?: string) { super('ai_background_storage_unavailable') }
}
export class AIBackgroundNotSubmitted extends Error {
  constructor(readonly status: string) { super('ai_background_' + status) }
}
const transportCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'])
const errorCodes = new Set(['ai_response_mismatch', 'ai_operation_changed', 'ai_background_not_configured', 'invalid_job_deadline', 'ai_work_denied', 'project_denied', 'context_changed', 'unsupported_image', 'payload_too_large', 'invalid_ai_failure_diagnostic'])
const safeRequestId = (value: unknown): value is string => typeof value === 'string' && /^(req_[a-zA-Z0-9_-]{1,160}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(value)
const safeResponseId = (value: unknown): value is string => typeof value === 'string' && /^resp_[a-zA-Z0-9_-]{1,200}$/.test(value)
const safeRpcCode = (value: unknown): value is string => typeof value === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(value)
export function aiFailureDiagnostic(error: unknown, phase: AiFailurePhase, started: number, responseId?: unknown) {
  const value = error as { name?: string; message?: unknown; code?: unknown; cause?: { code?: unknown } } | null
  const code = value?.cause?.code ?? value?.code
  const transportCode = typeof code === 'string' && transportCodes.has(code) ? code : null
  const timeout = value?.name === 'TimeoutError' || value?.name === 'AbortError' || transportCode?.includes('TIMEOUT') || transportCode === 'ETIMEDOUT'
  const reason = error instanceof AIBackgroundNotSubmitted ? 'not_submitted' : error instanceof AIBackgroundStorageError ? error.reason : value?.message
  const errorCode = reason === 'Payload exceeds 25MB limit. Try using a smaller or compressed image.' ? 'payload_too_large'
    : reason === 'not_submitted' || typeof reason === 'string' && errorCodes.has(reason) ? reason : null
  return {
    phase,
    category: error instanceof AIProviderHttpError ? 'http' : error instanceof AIBackgroundStorageError ? 'storage'
      : timeout ? 'timeout' : transportCode || value?.name === 'TypeError' ? 'transport'
      : error instanceof AIBackgroundNotSubmitted || value?.name === 'SyntaxError' ? 'protocol' : phase === 'prepare' ? 'preparation' : 'unknown',
    http_status: error instanceof AIProviderHttpError ? error.status : null,
    provider_request_id: error instanceof AIProviderHttpError && safeRequestId(error.requestId) ? error.requestId : null,
    response_id: safeResponseId(responseId) ? responseId : null,
    transport_code: transportCode,
    rpc_code: error instanceof AIBackgroundStorageError && safeRpcCode(error.code) ? error.code : null,
    error_code: errorCode,
    elapsed_ms: Math.max(0, Math.min(86400000, Math.round(performance.now() - started))),
  }
}
/** Emit before persisting so a database outage cannot hide the original phase.
 * Logging failure must not turn an uncertain POST into a fresh submission. */
export async function recordAiFailure(rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  kind: 'job' | 'event', id: string | null, phase: AiFailurePhase, error: unknown, started: number, responseId?: unknown) {
  const failure = aiFailureDiagnostic(error, phase, started, responseId)
  console.error('[AI background failure]', JSON.stringify({ work_kind: kind, work_id: id, ...failure }))
  if (!id) return
  try { await rpc('ai_work_record_failure', { p_kind: kind, p_id: id, p_failure: failure }) }
  catch (storageError) {
    console.error('[AI background diagnostic storage]', JSON.stringify({ work_kind: kind, work_id: id,
      ...aiFailureDiagnostic(storageError, phase, started) }))
  }
}
