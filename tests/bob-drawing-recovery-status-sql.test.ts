import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

test('drawing recovery status proves only the exact private delegated scope without rewriting its failed chat', async t => {
  const pg = await projectSchema(); t.after(() => pg.close())
  await pg.exec("create schema cron; create schema net; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint'")
  const owner = randomUUID(), member = randomUUID(), outsider = randomUUID(), turn = randomUUID()
  const request = 'ffffffff-ffff-4fff-8fff-ffffffffffff', event = randomUUID(), artifact = randomUUID()
  const call = async (uid: string | null, name: string, args: unknown[], role = 'authenticated'): Promise<any> =>
    (await asProjectUser(pg, uid, `select bob.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
  const service = (name: string, args: unknown[]) => call(null, name, args, 'service_role')
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',
    [owner, 'recovery-owner@example.test', member, 'recovery-member@example.test', outsider, 'recovery-outsider@example.test'])
  const project = (await call(owner, 'create_project', [{ name: 'Private drawing recovery' }])).id
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('recovery-member',$1,'Member','ME',$2)", [project, member])
  const queued = await service('bob_enqueue_job_v2', [project, owner, turn, 'Draw my shelf', { version: 1, ciphertext: 'fixture' },
    new Date(Date.now() + 600_000).toISOString(), 'https://fixture.supabase.co/functions/v1/bob-worker', { surface: 'project' }])
  const capability = (await pg.query<any>('select capability from bob_private.bob_jobs where id=$1', [queued.jobId])).rows[0].capability
  const claim = await service('bob_claim_job', [queued.jobId, capability])
  const thread = claim.threadId
  const scope = { area_id: null, component_id: null, step_id: null, artifact_id: null }
  await call(owner, 'create_drawing_request', [project, thread, turn, claim.generation, request, scope])
  await service('bob_drawing_request', [project, owner, thread, turn, claim.generation, 'save', request, 0, 'draft',
    { brief: { ...scope }, owner_request: 'Draw my shelf', reference_refs: [] }, randomUUID()])
  await service('bob_finish_job', [queued.jobId, claim.claimToken, 'turn_budget_exhausted'])
  await pg.query("update bob_private.bob_jobs set expires_at=clock_timestamp()-interval '1 hour' where id=$1", [queued.jobId])
  const status = () => call(owner, 'bob_job_status', [project, turn])
  const historical = async () => (await pg.query<any>(`
    select (select md5(to_jsonb(j)::text) from bob_private.bob_jobs j where id=$1) job,
      (select md5(to_jsonb(m)::text) from bob.bob_messages m where thread_id=$2 and turn_id=$3 and role='user') message,
      (select md5(to_jsonb(b)::text) from bob_private.drawing_budgets b where request_id=$4) budget,
      (select count(*)::int from bob_private.bob_jobs) job_count`, [queued.jobId, thread, turn, request])).rows[0]
  const before = await historical()
  const original = await status()
  assert.equal(original.status, 'failed'); assert.equal(original.error, 'turn_budget_exhausted')
  assert.deepEqual(original.screen, { surface: 'project' }); assert.equal(original.drawingRecovery, undefined)

  await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,worker_url,expires_at,drawing_request_id)
    values($1,$2,$3,$4,$5,$6,'https://fixture.supabase.co/functions/v1/bob-worker',clock_timestamp()+interval '10 minutes',$7)`,
    [event, project, owner, thread, turn, claim.generation, request])
  const progress = { stage: 'cad', detail: 'rendering' }

  await t.test('queued and running recovery use their own live deadline despite the original expired budget failure', async () => {
    for (const state of ['queued', 'running']) {
      await pg.query('update bob_private.bob_jobs set status=$2,progress=$3 where id=$1', [event, state, progress])
      const result = await status()
      assert.equal(result.status, 'failed'); assert.equal(result.error, 'turn_budget_exhausted')
      assert.equal(result.drawingRecovery.scope, 'drawing')
      assert.equal(result.drawingRecovery.status, state)
      assert.deepEqual(result.drawingRecovery.requestIds, [request])
      assert.deepEqual(result.drawingRecovery.progress, progress)
      assert(Date.parse(result.drawingRecovery.expiresAt) > Date.now())
    }
    await pg.query("update bob_private.bob_jobs set expires_at=clock_timestamp()-interval '1 minute' where id=$1", [event])
    assert.equal((await status()).drawingRecovery, undefined, 'expired work is not still running')
    await pg.query("update bob_private.bob_jobs set expires_at=clock_timestamp()+interval '10 minutes',status='failed' where id=$1", [event])
    assert.equal((await status()).drawingRecovery, undefined)
  })

  const solution = randomUUID()
  await call(owner, 'solution_command', [project, 'create', solution, 0,
    { area_id: null, title: 'Shelf', description: 'A concept', assumptions: 'Fit unknown', tradeoffs: 'Simple', measurements: [] }])
  await call(owner, 'solution_command', [project, 'select', solution, 0, { solution_revision: 1, reason: 'Use design' }])
  await call(owner, 'artifact_command', [project, 'create', artifact, 0,
    { area_id: null, kind: 'detail', title: 'Saved shelf', description: 'Drawing recovery fixture', status: 'concept', target_revision: 1, measurements: [] }])
  const receipt = { projectId: project, dataset: 'artifacts', recordId: artifact, revision: 1 }
  const evidence = { kind: 'ai_assessment', references: [], sources: [], partial: false, writes: [receipt] }
  await pg.query("update bob_private.bob_jobs set status='completed' where id=$1", [event])
  const seq = (await pg.query<any>('update bob.bob_threads set next_seq=next_seq+1 where id=$1 returning next_seq-1 seq', [thread])).rows[0].seq
  await pg.query("insert into bob.bob_messages(thread_id,seq,turn_id,role,text,evidence) values($1,$2,$3,'assistant','Ritningen är sparad.',$4)", [thread, seq, event, evidence])

  await t.test('completed needs-data events and prose alone do not prove a saved drawing', async () => {
    assert.equal((await status()).drawingRecovery, undefined, 'request remains draft')
    await pg.query("update bob_private.project_drawing_requests set status='saved',saved_receipt=$2 where id=$1", [request, receipt])
    await pg.query('update bob.bob_messages set evidence=$2 where turn_id=$1', [event, { ...evidence, partial: true }])
    assert.equal((await status()).drawingRecovery, undefined)
    await pg.query('update bob.bob_messages set evidence=$2 where turn_id=$1', [event, { ...evidence, writes: [] }])
    assert.equal((await status()).drawingRecovery, undefined)
    await pg.query('update bob.bob_messages set evidence=$2 where turn_id=$1', [event, evidence])
    const complete = (await status()).drawingRecovery
    assert.deepEqual(complete, { scope: 'drawing', requestIds: [request], status: 'completed', expiresAt: null, progress: null })
  })

  await t.test('stale or nonexistent receipts fail closed; a legitimate later Artifact revision preserves historical completion', async () => {
    const stale = { ...receipt, revision: 99 }
    await pg.query('update bob_private.project_drawing_requests set saved_receipt=$2 where id=$1', [request, stale])
    assert.equal((await status()).drawingRecovery, undefined, 'event proof must match the exact saved receipt')
    await pg.query('update bob.bob_messages set evidence=$2 where turn_id=$1', [event, { ...evidence, writes: [stale] }])
    assert.equal((await status()).drawingRecovery, undefined, 'matching prose cannot create a missing Artifact revision')
    await pg.query('update bob_private.project_drawing_requests set saved_receipt=$2 where id=$1', [request, receipt])
    await pg.query('update bob.bob_messages set evidence=$2 where turn_id=$1', [event, evidence])
    await call(owner, 'artifact_command', [project, 'archive', artifact, 1, {}])
    assert.equal((await status()).drawingRecovery.status, 'completed')
  })

  await t.test('latest exact event wins over an earlier success and foreign origin jobs cannot settle or appear running', async () => {
    const later = randomUUID()
    await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,worker_url,expires_at,drawing_request_id,status,created_at)
      values($1,$2,$3,$4,$5,$6,'https://fixture.supabase.co/functions/v1/bob-worker',clock_timestamp()+interval '10 minutes',$7,'failed',clock_timestamp()+interval '1 second')`,
      [later, project, owner, thread, turn, claim.generation, request])
    assert.equal((await status()).drawingRecovery, undefined)
    await pg.query("update bob_private.bob_jobs set status='completed' where id=$1", [later])
    assert.equal((await status()).drawingRecovery, undefined, 'latest event has no matching delivered answer')
    await pg.query("update bob_private.bob_jobs set status='running',turn_id=$2 where id=$1", [later, randomUUID()])
    assert.equal((await status()).drawingRecovery.status, 'completed', 'foreign instruction is excluded from the exact event lookup')
    await pg.query('delete from bob_private.bob_jobs where id=$1', [later])
  })

  await t.test('request paging and unrelated failures never affect this exact lookup; every same-origin request needs its own proof', async () => {
    for (let n = 1; n <= 22; n++) {
      const unrelated = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
      await pg.query(`insert into bob_private.project_drawing_requests(id,project_id,owner_user_id,thread_id,origin_turn_id,scope)
        values($1,$2,$3,$4,$5,$6)`, [unrelated, project, owner, thread, randomUUID(), scope])
    }
    const page = await call(owner, 'project_drawing_requests', [project, null, null])
    assert.equal(page.requests.length, 20); assert(!page.requests.some((r: any) => r.id === request))
    assert.equal((await status()).drawingRecovery.status, 'completed')
    const second = randomUUID()
    await pg.query(`insert into bob_private.project_drawing_requests(id,project_id,owner_user_id,thread_id,origin_turn_id,scope,status,reason)
      values($1,$2,$3,$4,$5,$6,'draft',null)`, [second, project, owner, thread, turn, scope])
    assert.equal((await status()).drawingRecovery, undefined, 'one saved drawing cannot settle another unsaved drawing from the same instruction')
    await pg.query("update bob_private.project_drawing_requests set status='cancelled' where id=$1", [second])
    assert.equal((await status()).drawingRecovery, undefined)
    await pg.query('update bob_private.project_drawing_requests set owner_user_id=$2 where id=$1', [second, member])
    assert.deepEqual((await status()).drawingRecovery.requestIds, [request], 'another member private request is not disclosed')
    await pg.query('delete from bob_private.project_drawing_requests where id=$1', [second])
    assert.equal(await call(owner, 'bob_job_status', [project, randomUUID()]), null, 'an unlinked job/turn has no inferred recovery')
  })

  await t.test('paused, cancelled, rebound origins and private-thread boundaries remove the proof', async () => {
    for (const state of ['paused', 'cancelled', 'draft']) {
      await pg.query('update bob_private.project_drawing_requests set status=$2 where id=$1', [request, state])
      assert.equal((await status()).drawingRecovery, undefined)
    }
    await pg.query("update bob_private.project_drawing_requests set status='saved',origin_turn_id=$2 where id=$1", [request, randomUUID()])
    assert.equal((await status()).drawingRecovery, undefined)
    await pg.query('update bob_private.project_drawing_requests set origin_turn_id=$2 where id=$1', [request, turn])
    assert.equal(await call(member, 'bob_job_status', [project, turn]), null)
    await assert.rejects(call(outsider, 'bob_job_status', [project, turn]), /project_denied/)
    await assert.rejects(call(null, 'bob_job_status', [project, turn]), /project_denied/)
    await assert.rejects(call(null, 'bob_job_status', [project, turn], 'anon'), /permission denied/)
    await assert.rejects(call(null, 'bob_job_status', [project, turn], 'service_role'), /permission denied/)
    await pg.query("update bob.bob_threads set status='archived' where id=$1", [thread])
    assert.equal(await status(), null, 'archived private thread cannot project into a current conversation')
    await pg.query("update bob.bob_threads set status='active' where id=$1", [thread])
  })

  await t.test('repeated status reads preserve history, job count and request accounting', async () => {
    const snapshot = await historical()
    for (let n = 0; n < 3; n++) assert.equal((await status()).drawingRecovery.status, 'completed')
    assert.deepEqual(await historical(), snapshot)
    assert.equal(snapshot.job, before.job); assert.equal(snapshot.message, before.message); assert.equal(snapshot.budget, before.budget)
    assert.equal((await pg.query<any>("select delivery_state from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='user'", [thread, turn])).rows[0].delivery_state, 'failed')
    const nextSeq = (await pg.query<any>('select next_seq from bob.bob_threads where id=$1', [thread])).rows[0].next_seq
    await call(owner, 'bob_reset_conversation', [project, thread, nextSeq])
    assert.equal(await status(), null, 'reset cannot revive recovery from the deleted private thread')
    assert.equal((await pg.query<any>('select thread_id from bob_private.project_drawing_requests where id=$1', [request])).rows[0].thread_id, null)
  })
})
