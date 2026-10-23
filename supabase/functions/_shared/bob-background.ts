import { drawingErrorCode } from './drawing-errors.ts'
import {drawingRuntimeVersion} from './drawing-runtime.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { answerWithOpenAi } from './ask-openai.ts'
import { BobContinuation, createBobJournal, rethrowContinuation } from './bob-job-journal.ts'
import { createBobTurnCheckpoint } from './bob-turn-checkpoint.ts'
import { sealCredential, openCredential } from './bob-job-credentials.ts'
import { parseBobScreen } from '../../../src/domain/bobScreen.ts'
import type { BobTurnInput } from './bob-request.ts'

type Input = BobTurnInput
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
  return { url, key, secret, rpc, client }
}
export async function enqueueBobTurn(input: Input) {
  const s = services()
  const caller = createClient(s.url, s.key, { db: { schema: 'bob' }, global: { headers: { Authorization: input.authHeader } }, auth: { persistSession: false, autoRefreshToken: false } })
  const access = await caller.from('projects').select('id').eq('id', input.projectId).maybeSingle()
  if (access.error || !access.data) return { ok: false as const, error: 'project_denied' }
  const token = input.authHeader.replace(/^Bearer\s+/i, '')
  const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  const expires = Number(payload.exp) * 1000 // SQL applies the pinned legacy/new policy.
  if (!Number.isFinite(expires) || expires < Date.now() + 30000) return { ok: false as const, error: 'unauthorized' }
  const result = await s.rpc('bob_enqueue_job_v4', {
    p_project: input.projectId, p_user: input.userId, p_turn: input.clientTurnId, p_message: input.message,
    p_credential: await sealCredential(token, binding(input), s.secret), p_expires: new Date(expires).toISOString(),
    p_worker_url: s.url.replace(/\/$/, '') + '/functions/v1/bob-worker',
    p_screen: input.screen ?? null,
    p_images: input.imageIds ?? null,
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

/** Renew only already-delegated work using this authenticated session's ordinary
 * short-lived JWT. No refresh credential or new budget is accepted here. */
export async function renewDrawingRequests(input:{authHeader:string;userId:string;projectId:string}){
 const s=services()
 const caller=createClient(s.url,s.key,{db:{schema:'bob'},global:{headers:{Authorization:input.authHeader}},auth:{persistSession:false,autoRefreshToken:false}})
 const {data,error}=await caller.rpc('drawing_resume_bindings',{p_project:input.projectId}).abortSignal(AbortSignal.timeout(12000))
 if(error||!Array.isArray(data))return {ok:false,error:'project_denied'}
 const token=input.authHeader.replace(/^Bearer\s+/i,'')
 const payload=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
 const expires=Number(payload.exp)*1000
 if(!Number.isFinite(expires)||expires<Date.now()+30000)return {ok:false,error:'unauthorized'}
 const jobs=await s.rpc('bob_jobs_to_renew',{p_project:input.projectId,p_user:input.userId})
 let renewed=0
 for(const job of jobs){
  if(await s.rpc('bob_renew_job',{p_project:input.projectId,p_user:input.userId,p_job:job.id,
   p_credential:await sealCredential(token,binding({...input,clientTurnId:job.turn_id}),s.secret),p_expires:new Date(expires).toISOString()}))renewed++
 }
 for(const request of data){
  await s.rpc('bob_renew_drawing_authority',{p_project:input.projectId,p_user:input.userId,p_id:request.id,p_turn:request.turn_id,
   p_credential:await sealCredential(token,binding({...input,clientTurnId:request.turn_id}),s.secret),p_expires:new Date(expires).toISOString(),p_worker_url:s.url.replace(/\/$/,'')+'/functions/v1/bob-worker'})
 }
 if(data.length){
  const version=await drawingRuntimeVersion(s.client,{model:!!Deno.env.get('OPENAI_API_KEY'),cad:!!Deno.env.get('BOB_CAD_URL')&&!!Deno.env.get('BOB_CAD_TOKEN')})
  await s.rpc('bob_observe_drawing_runtime',{p_project:input.projectId,p_user:input.userId,p_fingerprint:version})
 }
 await s.rpc('bob_dispatch_jobs')
 return {ok:true,renewed:renewed+data.length}
}

/** Cancel only an owned turn through the ordinary authenticated RPC. Receipt
 * history remains available; the server fences every still-running worker. */
export async function cancelBobTurn(input:{authHeader:string;userId:string;projectId:string;jobId:string}){
 const s=services()
 const caller=createClient(s.url,s.key,{db:{schema:'bob'},global:{headers:{Authorization:input.authHeader}},auth:{persistSession:false,autoRefreshToken:false}})
 const {data,error}=await caller.rpc('bob_cancel_job',{p_project:input.projectId,p_job:input.jobId}).abortSignal(AbortSignal.timeout(12000))
 if(error)return {ok:false as const,error:'project_denied' as const}
 return data as {ok:true;status:'cancelled';projectId:string;jobId:string}|{ok:false;error:'turn_not_in_flight'}
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
  try { job = await s.rpc('bob_claim_job_v2', { p_job: body.jobId, p_capability: capability }) }
  catch { return new Response(null, { status: 403 }) }
  if (job.status !== 'claimed') return new Response(null, { status: 204 })
  const args = { p_job: job.id, p_claim: job.claimToken }
  const unlimitedWork=job.workAllowanceVersion===1
  const authorityExpired=()=>Date.now()>=Date.parse(job.expiresAt)
  const work = async () => {
    let phase = 'credential'
    console.log('[Bob job]', JSON.stringify({ jobId: job.id, turnId: job.clientTurnId, status: 'running', generation: job.generation }))
    try {
      const token = await openCredential(job.credential, binding(job), s.secret)
      const caller = createClient(s.url, s.key, { global: { headers: { Authorization: 'Bearer ' + token } }, auth: { persistSession: false, autoRefreshToken: false } })
      phase = 'authentication'
      const auth = await caller.auth.getUser(token)
      if (auth.error || auth.data.user?.id !== job.userId) throw new Error('unauthorized')
      // An explicit retry of a failed turn reuses its paid model results with
      // identical input. Unavailable means the ordinary paid path, never a guess.
      let reusable = new Map<string, unknown>()
      if (!job.drawingRequestId && job.checkpointVersion !== 1) {
        try {
          const rows = await s.rpc('bob_job_reusable_models', args)
          if (Array.isArray(rows)) reusable = new Map(rows.filter((r: any) => typeof r?.fingerprint === 'string').map((r: any) => [r.fingerprint, r.value]))
        } catch { /* reuse is an optimisation */ }
      }
      if(job.pagedJournal===true || job.checkpointJournalPaged===true){
        job.entries=[]
        let after:string|null=null
        do{
          const page=await s.rpc(job.checkpointJournalPaged===true ? 'bob_checkpoint_steps_page' : 'bob_job_steps_page',{...args,p_after:after})
          job.entries.push(...page.entries)
          after=page.next
        }while(after!==null)
      }
      const journal = createBobJournal({ entries: job.entries, save: async entry => {
        await s.rpc('bob_save_job_step', { ...args, p_key: entry.key, p_fingerprint: entry.fingerprint, p_value: entry.value })
      } }, started + 140000, Date.now, reusable, {unlimitedWork,authorityExpiresAt:Date.parse(job.expiresAt)})
      if (job.checkpointVersion === 1) {
        // Pin exact-match retry results once in bootstrap. Subsequent claims
        // retain this paid-work reuse without fetching prior job history again.
        try {
          const rows = await journal.run('execution:reusable-models', {}, () => s.rpc('bob_job_reusable_models', args))
          if (Array.isArray(rows)) for (const row of rows) if (typeof row?.fingerprint === 'string') reusable.set(row.fingerprint, row.value)
        } catch (error) { rethrowContinuation(error) /* reuse is an optimisation */ }
      }
      if (job.checkpointVersion !== undefined && job.checkpointVersion !== 0 && job.checkpointVersion !== 1) throw new Error('turn_checkpoint_version_invalid')
      const checkpoint = job.checkpointVersion === 1 ? createBobTurnCheckpoint({ jobId: job.id, turnId: job.clientTurnId,
        catalogManifestId: job.catalogManifestId, checkpoint: job.checkpoint, journal,
        save: write => s.rpc('bob_save_turn_checkpoint', { ...args, p_expected_revision: write.expectedRevision,
          p_state: write.state, p_journal_state: write.journalState }),
      }) : undefined
      phase = 'answer'
      // Content-free progress for the owner's chat, at most every 1.5 s. Advisory:
      // a lost update never affects the turn.
      let lastProgress = 0
      const progress = (value: { stage: string; tool?: string; step: number; saved: number }) => {
        const now = Date.now()
        if (now - lastProgress < 1500 && value.stage !== 'finishing') return
        lastProgress = now
        const payload = { stage: value.stage, step: Math.min(999, value.step), saved: Math.min(999, value.saved), ...(value.tool && /^[a-z][a-z0-9_]{0,63}$/.test(value.tool) ? { tool: value.tool } : {}) }
        s.rpc('bob_job_progress', { ...args, p_progress: payload }).catch(() => { /* advisory */ })
      }
      const result = await answerWithOpenAi({ authHeader: 'Bearer ' + token, userId: job.userId, projectId: job.projectId, message: job.message, clientTurnId: job.clientTurnId, screen: parseBobScreen(job.screen),
        background: { checkpoint, ...(checkpoint ? { loadRenderFiles: (renderFingerprint: string) => s.rpc('bob_checkpoint_render_files', { ...args, p_fingerprint: renderFingerprint }) } : {}), drawingRequestId:job.drawingRequestId??undefined, jobId: job.id, asyncModels: job.asyncModels === true, claim: { mode: 'server', status: 'claimed', thread_id: job.threadId, generation: job.generation }, journal,
          workAllowanceVersion:job.workAllowanceVersion,catalogManifestId:job.catalogManifestId,authorityExpiresAt:job.expiresAt,
          deadline: unlimitedWork ? Infinity : Date.parse(job.expiresAt) - 10000, replay: job.entries.length > 0, progress } })
      journal.check()
      if(unlimitedWork&&!result.ok&&authorityExpired())throw new Error('authentication_expired')
      const finished = job.drawingRequestId && result.ok
        ? await s.rpc('bob_finish_drawing_job', { ...args, p_answer: result.answer })
        : await s.rpc('bob_finish_job', { ...args, p_error: result.ok ? null : result.error })
      console.log('[Bob job]', JSON.stringify({ jobId: job.id, status: finished.status, error: result.ok ? undefined : result.error }))
    } catch (error) {
      const reason = error instanceof BobContinuation ? error.message : phase === 'authentication' || unlimitedWork&&authorityExpired() ? 'authentication_expired' : phase === 'credential' ? 'credential_unavailable' : drawingErrorCode(error) ?? 'background_failed'
      console.log('[Bob job]', JSON.stringify({ jobId: job.id, status: error instanceof BobContinuation && error.kind === 'yield' ? 'continuing' : 'failed', reason, phase, operation: error instanceof BobContinuation ? error.operationKey : undefined }))
      try {
        if (unlimitedWork && reason==='authentication_expired') await s.rpc('bob_pause_job',{...args,p_expires:job.expiresAt})
        else if (error instanceof BobContinuation && error.aiWait) await s.rpc('bob_wait_for_ai', { ...args, p_ai_job: error.aiWait.id })
        else if (error instanceof BobContinuation && error.kind === 'yield') await s.rpc('bob_yield_job', args)
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
