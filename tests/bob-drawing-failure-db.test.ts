import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

let pg: PGlite
const invoke = async (name: string, args: unknown[], role = 'service_role', user: string | null = null): Promise<any> =>
  (await asProjectUser(pg, user, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
const one = async (sql: string, args: unknown[] = []) => (await pg.query<any>(sql, args)).rows[0]
const scope = { area_id: null, component_id: null, step_id: null, artifact_id: null }
const prices = { user_id: null, module: 'test', ai_function: 'cad-reviewer', model: 'fixture', input_price_per_1m: 1, output_price_per_1m: 2, cached_price_per_1m: .1 }
before(async () => {
  pg = await projectSchema()
  await pg.exec("update shared_private.ai_runtime set worker_url='https://fixtureproject.supabase.co/functions/v1/ai-background-worker'; update shared_private.ai_receivers set enabled=true where app='bob'")
})
after(() => pg.close())

async function fixture() {
  const owner = randomUUID(), turn = randomUUID(), request = randomUUID(), job = randomUUID(), claimToken = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now())', [owner, owner + '@example.test'])
  const project = (await invoke('bob.create_project', [{ name: 'Failure fixture' }], 'authenticated', owner)).id
  const c = await invoke('bob.bob_claim_turn', [project, owner, turn, 'Draw the fixture'])
  await invoke('bob.create_drawing_request', [project, c.thread_id, turn, c.generation, request, scope], 'authenticated', owner)
  const draft = { title: 'Retained draft', recipe: { fixture: true }, measurements: [] }
  const packet = { brief: scope, owner_request: 'Draw the fixture', reference_refs: [], draft }
  await invoke('bob.bob_drawing_request', [project, owner, c.thread_id, turn, c.generation, 'save', request, 0, 'draft', packet, randomUUID()])
  await invoke('bob.bob_commit_turn_v2', [project, owner, c.thread_id, turn, c.generation, 'Original answer', { kind: 'ai_assessment', references: [], sources: [], partial: true }, 'resp_fixture'])
  const header = await one('select * from bob_private.project_drawing_requests where id=$1', [request])
  await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,credential,worker_url,expires_at,status,claim_token,lease_until,drawing_request_id,drawing_event_revision)
    values($1,$2,$3,$4,$5,$6,'{}','https://fixture.supabase.co/functions/v1/bob-worker',now()+interval '20 minutes','running',$7,now()+interval '150 seconds',$8,$9)`,
    [job, project, owner, c.thread_id, turn, c.generation + 1, claimToken, request, header.observed_event])
  await pg.query('insert into bob_private.drawing_attempts(id,request_id,event_revision,request_revision) values($1,$2,$3,$4)', [job, request, header.observed_event, header.revision])
  await pg.query('update bob_private.bob_thread_provider_state set generation=$2,in_flight_turn_id=$3,lock_started_at=clock_timestamp() where thread_id=$1', [c.thread_id, c.generation + 1, turn])
  const ai = await invoke('shared.ai_job_reserve', ['bob', job + '/model:cad-reviewer:0', 'a'.repeat(64), 'bob', { jobId: job, role: 'cad-reviewer' }, new Date(Date.now() + 600000).toISOString(), prices])
  await pg.query('update bob_private.bob_jobs set waiting_ai_job=$2 where id=$1', [job, ai.id])
  return { owner, project, thread: c.thread_id, turn, request, job, claimToken, ai: ai.id, draft, revision: header.revision }
}

test('failed drawing publishes one honest private answer and status; preserves draft, owner turn, spend and paid operation', async () => {
  const f = await fixture()
  const beforeJobs = await one('select count(*)::int n from shared_private.ai_jobs')
  const budget = await one('select to_jsonb(b) state from bob_private.drawing_budgets b where request_id=$1', [f.request])
  assert.equal((await invoke('bob.bob_finish_job', [f.job, f.claimToken, 'background_expired'])).status, 'failed')
  const header = await one('select status,reason,revision from bob_private.project_drawing_requests where id=$1', [f.request])
  assert.deepEqual(header, { status: 'retrieval_failed', reason: 'background_expired', revision: f.revision + 1 })
  const packet = await one('select status,revision,payload from bob_private.drawing_requests where id=$1', [f.request])
  assert.equal(packet.status, header.status); assert.equal(packet.revision, header.revision)
  assert.deepEqual(packet.payload.draft, f.draft); assert.equal(packet.payload.execution_failure.job_id, f.job)
  assert.equal(packet.payload.execution_failure.receipt_missing, true)
  const reply = await one("select text,evidence from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='assistant'", [f.thread, f.job])
  assert.match(reply.text, /inget kvitto/); assert(reply.evidence.partial); assert.deepEqual(reply.evidence.writes, [])
  assert.equal((await one("select text from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='assistant'", [f.thread, f.turn])).text, 'Original answer')
  assert.equal((await one("select delivery_state from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='user'", [f.thread, f.turn])).delivery_state, 'completed')
  assert((await invoke('bob.bob_chat_inbox', [f.project], 'authenticated', f.owner)).unread)
  const event = await one("select counts from bob.execution_events where run_id=$1 and event_key='background_failure'", [f.job])
  assert.equal(event.counts.end_reason, 'background_expired')
  assert.equal((await pg.query('select bob_private.record_failed_drawing_job($1) repaired', [f.job])).rows[0].repaired, false)
  assert.equal((await one("select count(*)::int n from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='assistant'", [f.thread, f.job])).n, 1)
  assert.deepEqual(await one('select to_jsonb(b) state from bob_private.drawing_budgets b where request_id=$1', [f.request]), budget)
  assert.deepEqual(await one('select count(*)::int n from shared_private.ai_jobs'), beforeJobs)
  assert.equal((await one('select response_id from shared_private.ai_jobs where id=$1', [f.ai])).response_id, null)
  await assert.rejects(() => invoke('bob_private.record_failed_drawing_job', [f.job], 'authenticated', f.owner), /permission denied/)
})

test('cron expiry uses the same failure path after the worker has disappeared', async () => {
  const f = await fixture()
  await pg.query("update bob_private.bob_jobs set expires_at=now()-interval '1 second' where id=$1", [f.job])
  await invoke('bob.bob_dispatch_jobs', [])
  assert.equal((await one('select status from bob_private.bob_jobs where id=$1', [f.job])).status, 'failed')
  assert.equal((await one('select reason from bob_private.project_drawing_requests where id=$1', [f.request])).reason, 'background_expired')
  assert.equal((await one("select count(*)::int n from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='assistant'", [f.thread, f.job])).n, 1)
})

async function nextFailure(f: Awaited<ReturnType<typeof fixture>>, error = 'background_expired') {
  const job = randomUUID(), claim = randomUUID()
  const header = await one('update bob_private.project_drawing_requests set observed_event=observed_event+1 where id=$1 returning observed_event,revision', [f.request])
  const generation = (await one('update bob_private.bob_thread_provider_state set generation=generation+1,in_flight_turn_id=$2,lock_started_at=clock_timestamp() where thread_id=$1 returning generation', [f.thread, f.turn])).generation
  await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,credential,worker_url,expires_at,status,claim_token,lease_until,drawing_request_id,drawing_event_revision,waiting_ai_job)
    values($1,$2,$3,$4,$5,$6,'{}','https://fixture.supabase.co/functions/v1/bob-worker',now()+interval '20 minutes','running',$7,now()+interval '150 seconds',$8,$9,$10)`,
    [job, f.project, f.owner, f.thread, f.turn, generation, claim, f.request, header.observed_event, f.ai])
  await pg.query('insert into bob_private.drawing_attempts(id,request_id,event_revision,request_revision) values($1,$2,$3,$4)', [job, f.request, header.observed_event, header.revision])
  assert.equal((await invoke('bob.bob_finish_job', [job, claim, error])).status, 'failed')
  return job
}

test('repeated automatic failures retain separate diagnostics without duplicate consecutive chat cards', async () => {
  const f = await fixture()
  await invoke('bob.bob_finish_job', [f.job, f.claimToken, 'background_expired'])
  const sequence = await one('select next_seq from bob.bob_threads where id=$1', [f.thread])
  const next = await nextFailure(f)
  assert.deepEqual(await one('select next_seq from bob.bob_threads where id=$1', [f.thread]), sequence)
  assert.equal((await one("select count(*)::int n from bob.bob_messages where thread_id=$1 and turn_id=$2", [f.thread, next])).n, 0)
  assert.equal((await one("select count(*)::int n from bob.execution_events where run_id in ($1,$2) and event_key='background_failure'", [f.job, next])).n, 2)
  assert.equal((await one('select payload from bob_private.drawing_requests where id=$1', [f.request])).payload.execution_failure.job_id, next)
  assert.equal((await one('select status from bob_private.drawing_attempts where id=$1', [next])).status, 'failed')
  assert.deepEqual((await one('select payload from bob_private.drawing_requests where id=$1', [f.request])).payload.draft, f.draft)
})

test('changed error, uncertainty or an intervening owner message receives a fresh failure notice', async () => {
  for (const boundary of ['error', 'receipt', 'owner']) {
    const f = await fixture()
    await invoke('bob.bob_finish_job', [f.job, f.claimToken, 'background_expired'])
    if (boundary === 'receipt') await pg.query("update shared_private.ai_jobs set submission_state='prepared' where id=$1", [f.ai])
    if (boundary === 'owner') {
      const { seq } = await one('update bob.bob_threads set next_seq=next_seq+1 where id=$1 returning next_seq-1 seq', [f.thread])
      await pg.query("insert into bob.bob_messages(thread_id,seq,turn_id,role,text) values($1,$2,$3,'user','Please continue')", [f.thread, seq, randomUUID()])
    }
    const next = await nextFailure(f, boundary === 'error' ? 'background_failed' : 'background_expired')
    assert.equal((await one("select count(*)::int n from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='assistant'", [f.thread, next])).n, 1, boundary)
  }
})

test('saved, cancelled, reset, superseded and revoked requests retain their authority and receive no stale error answer', async () => {
  for (const boundary of ['saved', 'cancelled', 'paused', 'new_turn', 'new_event', 'revoked']) {
    const f = await fixture()
    if (['saved', 'cancelled', 'paused'].includes(boundary)) {
      await pg.query('update bob_private.project_drawing_requests set status=$2 where id=$1', [f.request, boundary])
      await pg.query('update bob_private.drawing_requests set status=$2 where id=$1', [f.request, boundary === 'paused' || boundary === 'cancelled' ? 'collecting' : boundary])
    } else if (boundary === 'new_turn') await pg.query('update bob_private.project_drawing_requests set origin_turn_id=$2 where id=$1', [f.request, randomUUID()])
    else if (boundary === 'new_event') await pg.query('update bob_private.project_drawing_requests set observed_event=observed_event+1 where id=$1', [f.request])
    else {
      const remaining = randomUUID()
      await pg.query('insert into auth.users values($1,$2,now())', [remaining, remaining + '@example.test'])
      await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,'Remaining','RE',$3)", [randomUUID(), f.project, remaining])
      await pg.query('delete from bob.people where project_id=$1 and auth_user_id=$2', [f.project, f.owner])
    }
    const before = await one('select status,reason,revision from bob_private.project_drawing_requests where id=$1', [f.request])
    await invoke('bob.bob_finish_job', [f.job, f.claimToken, 'background_failed'])
    if (boundary !== 'revoked') assert.deepEqual(await one('select status,reason,revision from bob_private.project_drawing_requests where id=$1', [f.request]), before)
    assert.equal((await one("select count(*)::int n from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='assistant'", [f.thread, f.job])).n, 0)
  }
})

test('private AI diagnostics validate a content-free shape, expire once, and cascade with their retained operation', async () => {
  const f = await fixture(), failure = { phase: 'submit', category: 'http', http_status: 503, provider_request_id: 'req_fixture', elapsed_ms: 33 }
  await invoke('shared.ai_work_record_failure', ['job', f.ai, failure])
  const row = await one('select phase,category,http_status,provider_request_id,elapsed_ms from shared_private.ai_background_failures where job_id=$1', [f.ai])
  assert.deepEqual(row, failure)
  for (const invalid of [{ ...failure, prompt: 'PRIVATE' }, { ...failure, http_status: 999 }, { ...failure, provider_request_id: 'Bearer private' }, { ...failure, transport_code: 'PRIVATE' }]) {
    await assert.rejects(() => invoke('shared.ai_work_record_failure', ['job', f.ai, invalid]), /invalid_ai_failure_diagnostic|check constraint/)
  }
  await assert.rejects(() => invoke('shared.ai_work_record_failure', ['job', f.ai, failure], 'authenticated', f.owner), /permission denied/)
  await assert.rejects(() => asProjectUser(pg, f.owner, 'select * from shared_private.ai_background_failures'), /permission denied/)
  await pg.query("update shared_private.ai_jobs set status='expired' where id=$1", [f.ai])
  await pg.query("update shared_private.ai_jobs set status='expired' where id=$1", [f.ai])
  assert.equal((await one("select count(*)::int n from shared_private.ai_background_failures where job_id=$1 and phase='expire'", [f.ai])).n, 1)
  assert.equal((await one("select error_code from shared_private.ai_background_failures where job_id=$1 and phase='expire'", [f.ai])).error_code, 'receipt_missing')
  assert.equal((await one('select count(*)::int n from shared.ai_usage_events where background_job_id=$1', [f.ai])).n, 0)
  await pg.query('delete from shared_private.ai_jobs where id=$1', [f.ai])
  assert.equal((await one('select count(*)::int n from shared_private.ai_background_failures where job_id=$1', [f.ai])).n, 0)
  const event = randomUUID()
  await pg.query("insert into shared_private.ai_events(id,event_id,response_id) values($1,$2,'resp_fixture')", [event, randomUUID()])
  await invoke('shared.ai_work_record_failure', ['event', event, { phase: 'retrieve', category: 'http', http_status: 502 }])
  assert.equal((await one('select count(*)::int n from shared_private.ai_background_failures where event_id=$1', [event])).n, 1)
  await pg.query('delete from shared_private.ai_events where id=$1', [event])
  assert.equal((await one('select count(*)::int n from shared_private.ai_background_failures where event_id=$1', [event])).n, 0)
})

test('a provider output ceiling is recorded without copying its response or losing cost accounting', async () => {
  const f=await fixture()
  const response={id:'resp_'+f.ai.replaceAll('-',''),status:'incomplete',metadata:{ai_job_id:f.ai},incomplete_details:{reason:'max_output_tokens'},
    error:{message:'PRIVATE provider detail'},usage:{input_tokens:100,output_tokens:20}}
  await invoke('shared.ai_job_accept',[f.ai,response])
  const diagnostic=await one("select phase,category,error_code,response_id from shared_private.ai_background_failures where job_id=$1",[f.ai])
  assert.equal(diagnostic.phase,'provider');assert.equal(diagnostic.error_code,'model_output_limit')
  assert(!JSON.stringify(diagnostic).includes('PRIVATE'))
  assert.equal((await one('select count(*)::int n from shared.ai_usage_events where background_job_id=$1',[f.ai])).n,1)
})
