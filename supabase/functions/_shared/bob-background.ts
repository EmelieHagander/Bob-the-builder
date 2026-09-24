import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { answerWithOpenAi } from './ask-openai.ts'
import { BobContinuation, createBobJournal } from './bob-job-journal.ts'
import { sealCredential, openCredential } from './bob-job-credentials.ts'

type Input = { authHeader: string; userId: string; projectId: string; message: string; clientTurnId: string }
const binding = (v: Pick<Input, 'userId' | 'projectId' | 'clientTurnId'>) => JSON.stringify([v.userId, v.projectId, v.clientTurnId])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function services() {
  const url = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_ANON_KEY')!, secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (!url || !key || !secret) throw new Error('not_configured')
  const client = createClient(url, secret, { db: { schema: 'bob' }, auth: { persistSession: false, autoRefreshToken: false } })
  const rpc = async (name: string, args = {}) => {
    const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(12000))
    if (error) throw new Error(error.message)
    return data
  }
  return { url, key, secret, rpc }
}
export async function enqueueBobTurn(input: Input) {
  const s = services()
  const caller = createClient(s.url, s.key, { db: { schema: 'bob' }, global: { headers: { Authorization: input.authHeader } }, auth: { persistSession: false, autoRefreshToken: false } })
  const access = await caller.from('projects').select('id').eq('id', input.projectId).maybeSingle()
  if (access.error || !access.data) return { ok: false as const, error: 'project_denied' }
  const token = input.authHeader.replace(/^Bearer\s+/i, '')
  const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  const expires = Math.min(Number(payload.exp) * 1000, Date.now() + 20 * 60_000)
  if (!Number.isFinite(expires) || expires < Date.now() + 30000) return { ok: false as const, error: 'unauthorized' }
  const result = await s.rpc('bob_enqueue_job', {
    p_project: input.projectId, p_user: input.userId, p_turn: input.clientTurnId, p_message: input.message,
    p_credential: await sealCredential(token, binding(input), s.secret), p_expires: new Date(expires).toISOString(),
    p_worker_url: s.url.replace(/\/$/, '') + '/functions/v1/bob-worker',
  })
  if (result.status === 'accepted') {
    console.log('[Bob job]', JSON.stringify({ jobId: result.jobId, turnId: input.clientTurnId, status: 'queued' }))
    // The committed queue survives even if this kick fails; cron owns recovery.
    try { await s.rpc('bob_dispatch_jobs') } catch { /* next minute */ }
    return { ok: true as const, status: 'accepted' as const, projectId: input.projectId, jobId: result.jobId as string, expiresAt: result.expiresAt as string }
  }
  if (result.mode === 'local_only') return answerWithOpenAi(input)
  if (result.status === 'completed') return { ok: true as const, projectId: input.projectId, answer: result.answer as string, evidence: result.evidence }
  return { ok: false as const, error: 'turn_in_flight' }
}

/** Per-job capability, checked inside the service-only claim command. Neither
 * the browser nor request body chooses the principal/project of the worker. */
export async function serveBobWorker(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const capability = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!uuid.test(capability)) return new Response(null, { status: 401 })
  let body: { jobId?: string }
  try { const text = await req.text(); if (text.length > 2000) throw new Error(); body = JSON.parse(text) } catch { return new Response(null, { status: 400 }) }
  if (!body || typeof body.jobId !== 'string' || !uuid.test(body.jobId) || Object.keys(body).length !== 1) return new Response(null, { status: 400 })
  const s = services(), started = Date.now()
  let job: any
  try { job = await s.rpc('bob_claim_job', { p_job: body.jobId, p_capability: capability }) }
  catch { return new Response(null, { status: 403 }) }
  if (job.status !== 'claimed') return new Response(null, { status: 204 })
  const args = { p_job: job.id, p_claim: job.claimToken }
  const work = async () => {
    let phase = 'credential'
    console.log('[Bob job]', JSON.stringify({ jobId: job.id, turnId: job.clientTurnId, status: 'running', generation: job.generation }))
    try {
      const token = await openCredential(job.credential, binding(job), s.secret)
      const caller = createClient(s.url, s.key, { global: { headers: { Authorization: 'Bearer ' + token } }, auth: { persistSession: false, autoRefreshToken: false } })
      phase = 'authentication'
      const auth = await caller.auth.getUser(token)
      if (auth.error || auth.data.user?.id !== job.userId) throw new Error('unauthorized')
      const journal = createBobJournal({ entries: job.entries, save: async entry => {
        await s.rpc('bob_save_job_step', { ...args, p_key: entry.key, p_fingerprint: entry.fingerprint, p_value: entry.value })
      } }, started + 140000)
      phase = 'answer'
      const result = await answerWithOpenAi({ authHeader: 'Bearer ' + token, userId: job.userId, projectId: job.projectId, message: job.message, clientTurnId: job.clientTurnId,
        background: { claim: { mode: 'server', status: 'claimed', thread_id: job.threadId, generation: job.generation }, journal,
          deadline: Date.parse(job.expiresAt) - 10000, replay: job.entries.length > 0 } })
      journal.check()
      const finished = await s.rpc('bob_finish_job', { ...args, p_error: result.ok ? null : result.error })
      console.log('[Bob job]', JSON.stringify({ jobId: job.id, status: finished.status, error: result.ok ? undefined : result.error }))
    } catch (error) {
      const reason = error instanceof BobContinuation ? error.message : phase === 'authentication' ? 'authentication_expired' : phase === 'credential' ? 'credential_unavailable' : 'background_failed'
      console.log('[Bob job]', JSON.stringify({ jobId: job.id, status: error instanceof BobContinuation && error.kind === 'yield' ? 'continuing' : 'failed', reason, phase }))
      try {
        if (error instanceof BobContinuation && error.kind === 'yield') await s.rpc('bob_yield_job', args)
        else await s.rpc('bob_finish_job', { ...args, p_error: reason })
      } catch { /* A stale worker cannot settle another lease. The driver recovers. */ }
    }
    try { await s.rpc('bob_dispatch_jobs') } catch { /* cron recovery */ }
  }
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(task: Promise<unknown>): void } }).EdgeRuntime
  if (!runtime) return new Response(null, { status: 503 })
  runtime.waitUntil(work())
  return new Response(null, { status: 202 })
}
