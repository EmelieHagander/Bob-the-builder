import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIBackgroundPending, AIBackgroundStorageError, backgroundResponse, reconcileAiWork } from '../supabase/functions/_shared/ai-background.ts'

const id = '11111111-1111-4111-8111-111111111111'
const call = { key: 'session/model/0', fingerprint: 'a'.repeat(64), receiver: 'fixture', context: {}, expiresAt: '2030-01-01T00:00:00Z' }
const accounting = { user_id: null, module: 'test', ai_function: 'designer', model: 'fixture', input_price_per_1m: 1, output_price_per_1m: 2, cached_price_per_1m: .1 }
const secret = 'private prompt; Bearer credential; data:image/png;base64,PRIVATE'

test('HTTP failure preserves status/request ID without repeating an uncertain POST or copying provider content', async t => {
  const oldFetch = globalThis.fetch, oldError = console.error
  t.after(() => { globalThis.fetch = oldFetch; console.error = oldError })
  for (const status of [400, 503]) {
    let reserved = false, rejected = false, posts = 0
    const failures: any[] = [], logs: unknown[][] = []
    console.error = (...args) => { logs.push(args) }
    globalThis.fetch = async () => { posts++; return new Response(secret, { status, headers: { 'x-request-id': 'req_fixture' } }) }
    const rpc = async (name: string, args: any) => {
      if (name === 'ai_job_reserve') { const submit = !reserved; reserved = true; return { id, submit, status: rejected ? 'failed' : 'submitting' } }
      if (name === 'ai_work_record_failure') { failures.push(args); return true }
      if (name === 'ai_job_reject') { rejected = true; return null }
      throw new Error(name)
    }
    const run = () => backgroundResponse(rpc, secret, 'fixture', call, { input: secret }, accounting)
    await assert.rejects(run, status === 400 ? /ai_provider_http_400/ : AIBackgroundPending)
    await assert.rejects(run, status === 400 ? /ai_background_failed/ : AIBackgroundPending)
    assert.equal(posts, 1); assert.equal(failures.length, 1)
    assert.equal(failures[0].p_failure.phase, 'submit'); assert.equal(failures[0].p_failure.http_status, status)
    assert.equal(failures[0].p_failure.provider_request_id, 'req_fixture')
    assert.equal(failures[0].p_kind, 'job'); assert.equal(failures[0].p_id, id)
    assert(!JSON.stringify({ failures, logs }).includes(secret))
  }
})

test('lost acceptance records the known response ID and SQL code without buying another model call', async t => {
  const oldFetch = globalThis.fetch, oldError = console.error
  t.after(() => { globalThis.fetch = oldFetch; console.error = oldError })
  console.error = () => {}
  let reserved = false, posts = 0
  const failures: any[] = []
  globalThis.fetch = async () => { posts++; return Response.json({ id: 'resp_accepted', status: 'queued' }) }
  const rpc = async (name: string, args: any) => {
    if (name === 'ai_job_reserve') { const submit = !reserved; reserved = true; return { id, submit, status: 'submitting' } }
    if (name === 'ai_job_accept') throw new AIBackgroundStorageError('40001', 'ai_response_mismatch')
    if (name === 'ai_work_record_failure') { failures.push(args.p_failure); return true }
    throw new Error(name)
  }
  for (let n = 0; n < 3; n++) await assert.rejects(() => backgroundResponse(rpc, secret, 'fixture', call, {}, accounting), AIBackgroundPending)
  assert.equal(posts, 1); assert.equal(failures.length, 1)
  assert.equal(failures[0].phase, 'accept'); assert.equal(failures[0].category, 'storage')
  assert.equal(failures[0].rpc_code, '40001'); assert.equal(failures[0].response_id, 'resp_accepted')
  assert.equal(failures[0].error_code, 'ai_response_mismatch')
})

test('a refused acceptance is recorded; an invalid work capability cannot append a failure to the target operation', async t => {
  const oldFetch = globalThis.fetch, oldError = console.error
  t.after(() => { globalThis.fetch = oldFetch; console.error = oldError })
  console.error = () => {}
  const writes: any[] = []
  globalThis.fetch = async () => Response.json({ id: 'resp_refused', status: 'queued' })
  const rpc = async (name: string, args: any) => {
    if (name === 'ai_job_reserve') return { id, submit: true, status: 'submitting' }
    if (name === 'ai_job_accept') return false
    if (name === 'ai_work_record_failure') { writes.push(args); return true }
    if (name === 'ai_work_claim') throw new AIBackgroundStorageError('42501', 'ai_work_denied')
    throw new Error(name)
  }
  await assert.rejects(() => backgroundResponse(rpc, secret, 'fixture', call, {}, accounting), AIBackgroundPending)
  assert.equal(writes.length, 1); assert.equal(writes[0].p_failure.phase, 'accept')
  await assert.rejects(() => reconcileAiWork(rpc, secret, 'job', id, id), /ai_background_storage_unavailable/)
  assert.equal(writes.length, 1)
})

test('timeout and transport failures keep allowlisted codes; broken diagnostic storage retains a safe console record', async t => {
  const oldFetch = globalThis.fetch, oldError = console.error
  t.after(() => { globalThis.fetch = oldFetch; console.error = oldError })
  for (const [error, category, transport] of [
    [new DOMException(secret, 'TimeoutError'), 'timeout', null],
    [new TypeError(secret, { cause: { code: 'ECONNRESET', details: secret } }), 'transport', 'ECONNRESET'],
    [new Error(secret), 'unknown', null],
  ] as const) {
    const logs: unknown[][] = [], failures: any[] = []
    console.error = (...args) => { logs.push(args) }
    globalThis.fetch = async () => { throw error }
    const rpc = async (name: string, args: any) => {
      if (name === 'ai_job_reserve') return { id, submit: true, status: 'submitting' }
      if (name === 'ai_work_record_failure') { failures.push(args.p_failure); throw new AIBackgroundStorageError('PGRST002') }
      throw new Error(name)
    }
    await assert.rejects(() => backgroundResponse(rpc, secret, 'fixture', call, {}, accounting), AIBackgroundPending)
    assert.equal(failures[0].category, category); assert.equal(failures[0].transport_code, transport)
    assert.equal(logs.length, 2); assert(!JSON.stringify({ logs, failures }).includes(secret))
  }
})

test('retrieval retries only the existing response; callback failure leaves acceptance intact and records its phase', async t => {
  const oldFetch = globalThis.fetch, oldError = console.error
  t.after(() => { globalThis.fetch = oldFetch; console.error = oldError })
  console.error = () => {}
  const failures: any[] = [], operations: string[] = []
  let gets = 0, ready = false
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.method, 'GET'); gets++
    return ready ? Response.json({ id: 'resp_existing', metadata: { ai_job_id: id }, status: 'completed' })
      : new Response(secret, { status: 502 })
  }
  const rpc = async (name: string, args: any) => {
    operations.push(name)
    if (name === 'ai_work_claim') return { response_id: 'resp_existing' }
    if (name === 'ai_work_record_failure') { failures.push(args.p_failure); return true }
    if (name === 'ai_job_accept') return true
    if (name === 'ai_job_deliver') throw new AIBackgroundStorageError('P0001')
    if (name === 'ai_work_finish') return null
    throw new Error(name)
  }
  for (let n = 0; n < 2; n++) await assert.rejects(() => reconcileAiWork(rpc, secret, 'job', id, id), /ai_provider_http_502/)
  ready = true; await reconcileAiWork(rpc, secret, 'job', id, id)
  assert.equal(gets, 3); assert.deepEqual(failures.map(f => f.phase), ['retrieve', 'retrieve', 'deliver'])
  assert.equal(operations.filter(name => name === 'ai_job_accept').length, 1)
  assert.equal(operations.at(-1), 'ai_work_finish')
})
