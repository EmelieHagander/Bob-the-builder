import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIBackgroundPending, backgroundResponse, reconcileAiWork, verifyAiWebhook } from '../supabase/functions/_shared/ai-background.ts'
import { aiWebhookHandler, aiWorkerHandler } from '../supabase/functions/_shared/ai-background-http.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'

const id = '11111111-1111-4111-8111-111111111111'
const call = { key: 'session/model/0', fingerprint: 'a'.repeat(64), receiver: 'fixture', context: { session: 'one' }, expiresAt: '2030-01-01T00:00:00Z' }
const accounting = { user_id: null, module: 'test', ai_function: 'designer', model: 'fixture', input_price_per_1m: 1, output_price_per_1m: 2, cached_price_per_1m: .1 }

test('long model survives restarts: one POST, retrieve same response, then journal the finished tool call', async () => {
  const oldFetch = globalThis.fetch; let posts = 0, gets = 0, reserved = false
  let job: any = { id, status: 'submitting', response_id: null, response: null }
  const result = { id: 'resp_long', metadata: { ai_job_id: id }, status: 'completed', output: [{ type: 'function_call', name: 'render_cad_candidate', call_id: 'render1', arguments: '{}' }] }
  const rpc = async (name: string, args: any) => {
    if (name === 'ai_job_reserve') { const submit = !reserved; reserved = true; return { ...job, submit } }
    if (name === 'ai_job_accept') { job.response_id = args.p_response.id; job.status = args.p_response.status; if (job.status === 'completed') job.response = args.p_response; return true }
    if (name === 'ai_work_claim') return { response_id: job.response_id }
    if (name === 'ai_work_finish') return null
    throw new Error(name)
  }
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'POST') { posts++; assert.equal(JSON.parse(String(init.body)).background, true); return Response.json({ ...result, status: 'queued', output: [] }) }
    gets++; return Response.json(result)
  }
  const entries: JournalEntry[] = []
  const run = () => createBobJournal({ entries, save: async e => { entries.push(e) } }, Date.now() + 10000).run('model', { original: true }, async () => {
    try { return await backgroundResponse(rpc, 'key', 'appA', call, { model: 'fixture' }, accounting) }
    catch (error) { if (error instanceof AIBackgroundPending) throw new BobContinuation('yield', 'ai_wait', { id: error.jobId, accepted: error.accepted, role: 'designer' }); throw error }
  })
  try {
    await assert.rejects(run, e => e instanceof BobContinuation && e.aiWait?.accepted === true)
    await assert.rejects(run, e => e instanceof BobContinuation)
    assert.equal(entries.length, 0, 'waiting is neither an error checkpoint nor a provider retry')
    await reconcileAiWork(rpc, 'key', 'job', id, id)
    assert.deepEqual(await run(), result)
    assert.deepEqual(await run(), result)
    assert.equal(posts, 1); assert.equal(gets, 1); assert.equal(entries.length, 1)
  } finally { globalThis.fetch = oldFetch }
})

test('ambiguous submission is never sent again, including loss of acceptance checkpoint', async () => {
  const oldFetch = globalThis.fetch; let posts = 0, reserved = false
  const rpc = async (name: string) => { if (name === 'ai_job_reserve') { const submit = !reserved; reserved = true; return { id, status: 'submitting', submit } }; throw new Error('storage interrupted') }
  globalThis.fetch = async () => { posts++; throw new Error('connection lost after provider accepted') }
  try {
    for (let i = 0; i < 3; i++) await assert.rejects(() => backgroundResponse(rpc, 'key', 'appA', call, {}, accounting), AIBackgroundPending)
    assert.equal(posts, 1)
  } finally { globalThis.fetch = oldFetch }
})

test('signed webhook is persisted before acknowledgement; forged, old and modified bodies are denied', async () => {
  const secret = 'whsec_' + btoa('a fixture signing secret with entropy'), body = JSON.stringify({ type: 'response.completed', data: { id: 'resp_long' } })
  const stamp = String(Math.floor(Date.now() / 1000)), headers = new Headers({ 'webhook-id': 'wh_1', 'webhook-timestamp': stamp })
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('a fixture signing secret with entropy'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`wh_1.${stamp}.${body}`))
  headers.set('webhook-signature', 'v1,' + btoa(String.fromCharCode(...new Uint8Array(signature))))
  assert(await verifyAiWebhook(body, headers, secret))
  assert(!await verifyAiWebhook(body + ' ', headers, secret))
  assert(!await verifyAiWebhook(body, headers, secret, Date.now() + 600000))
  const received: any[] = []
  const handler = aiWebhookHandler(async (name, args) => { received.push({ name, args }) }, secret)
  const request = () => new Request('https://fixture', { method: 'POST', body, headers })
  assert.equal((await handler(request())).status, 204); assert.equal(received.length, 1)
  assert.equal((await aiWebhookHandler(async () => { throw new Error('storage down') }, secret)(request())).status, 503)
  assert.equal((await handler(new Request('https://fixture', { method: 'POST', body }))).status, 401)
  assert.equal((await aiWorkerHandler(async () => { throw new Error('must not call') }, 'key')(new Request('https://fixture', { method: 'POST', body: '{}' }))).status, 401)
})
