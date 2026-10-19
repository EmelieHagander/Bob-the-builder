import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import type { PGlite } from './support/pglite.ts'
import { createBobJournal, BobContinuation, fingerprint } from '../supabase/functions/_shared/bob-job-journal.ts'
import { createBobTurnCheckpoint, validateBobTurnCheckpoint } from '../supabase/functions/_shared/bob-turn-checkpoint.ts'
import { createToolSession, type ToolDefinition, type ToolPolicy } from '../supabase/functions/_shared/project-tools/session.ts'

let pg: PGlite
const owner = '00000000-0000-4000-8000-000000000001'
const worker = 'https://fixture.supabase.co/functions/v1/bob-worker'
const service = async (name: string, args: unknown[] = []) => (await asProjectUser(pg, null, `select bob.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, 'service_role')).rows[0].result as any
const row = async (id: string) => (await pg.query<any>('select * from bob_private.bob_jobs where id=$1', [id])).rows[0]
const claim = async (id: string) => {
  const job = await service('bob_claim_job_v2', [id, (await row(id)).capability])
  if (job.checkpointJournalPaged) {
    let after: string | null = null
    do {
      const page = await service('bob_checkpoint_steps_page', [job.id, job.claimToken, after])
      job.entries.push(...page.entries)
      after = page.next
    } while (after)
  }
  return job
}
async function enqueue(version = 4, turn = randomUUID()) {
  return { ...await service('bob_enqueue_job_v' + version, ['A', owner, turn, 'Spara uppgiften.', { ciphertext: 'fixture' }, new Date(Date.now() + 3600000).toISOString(), worker, null, null]), turn }
}
const finish = async (id: string, token: string) => service('bob_finish_job', [id, token, 'fixture_done'])
const cursor = (positions: Record<string, number> = {}) => ({ version: 1, positions, reusedModelCalls: 0, uncertainResends: 0 })
const save = (job: any, revision: number, state: any, journal = cursor()) => service('bob_save_turn_checkpoint', [job.id, job.claimToken, revision, state, journal])
const op = (job: any, key: string, result: unknown) => service('bob_save_job_step', [job.id, job.claimToken, key, 'a'.repeat(64), { ok: true, result }])

before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name === '20260924120448_bob_background_jobs.sql') await db.exec(`create schema cron; create schema net; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint'; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
  })
  await pg.query('insert into auth.users values($1,$2,now())', [owner, 'owner@test.invalid'])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Build'); insert into bob.areas(id,project_id,slug,name) values('areaA','A','work','Work');")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('one','A','Owner','O',$1)", [owner])
  const current = (await pg.query<any>("select active_version_id from shared.ai_prompts where app='bob' and prompt_key='agent-contract.ask-bob'")).rows[0].active_version_id
  const version = (await pg.query<any>(`insert into shared.ai_prompt_versions(prompt_id,version,content,metadata,available_variables,flow,definition_kind,definition_format_version,definition)
    select prompt_id,(select max(version)+1 from shared.ai_prompt_versions where prompt_id=v.prompt_id),content,metadata||'{"work_allowance_version":1}',available_variables,flow,definition_kind,definition_format_version,definition
    from shared.ai_prompt_versions v where id=$1 returning id`, [current])).rows[0].id
  await pg.query("update shared.ai_prompts set active_version_id=$1 where app='bob' and prompt_key='agent-contract.ask-bob'", [version])
})
after(() => pg.close())

test('only a newly enqueued v4 main job adopts checkpoints; old jobs retain the original claim contract', async () => {
  const old = await enqueue(3)
  assert.equal((await row(old.jobId)).checkpoint_version, 0)
  assert.equal((await enqueue(4, old.turn)).jobId, old.jobId)
  assert.equal((await row(old.jobId)).checkpoint_version, 0)
  const legacy = await claim(old.jobId)
  assert.equal(legacy.checkpointVersion, undefined)
  assert.equal(legacy.pagedJournal, true)
  await finish(old.jobId, legacy.claimToken)
  const retry = await enqueue(4, old.turn)
  assert.notEqual(retry.jobId, old.jobId)
  const fresh = await claim(retry.jobId)
  assert.equal(fresh.checkpointVersion, 1)
  assert.equal(fresh.checkpointJournalPaged, true)
  assert.equal(fresh.pagedJournal, undefined)
  assert.equal(fresh.checkpoint, null)
  await assert.rejects(service('bob_claim_job_v2', [fresh.id, randomUUID()]), /job_denied/)
  await assert.rejects(service('bob_claim_job', [fresh.id, (await row(fresh.id)).capability]), /checkpoint_worker_required/)
  await finish(fresh.id, fresh.claimToken)
})

test('checkpoint commits fence stale claims, compare revisions and restore only bootstrap plus active operations', async () => {
  const q = await enqueue(), first = await claim(q.jobId)
  await op(first, 'startup:0', 'orientation')
  const initial = await save(first, 0, { nextStep: 0 }, cursor({ startup: 1 }))
  assert.equal(initial.revision, 1)
  assert.equal(initial.turnId, q.turn)
  assert.equal(initial.catalogManifestId, first.catalogManifestId)
  assert.deepEqual(await save(first, 0, { nextStep: 0 }, cursor({ startup: 1 })), initial, 'lost acknowledgement can retry exactly')
  await op(first, 'model:0', 'response0')
  await save(first, 1, { nextStep: 1 }, cursor({ startup: 1, model: 1 }))
  await service('bob_save_job_step', [first.id, first.claimToken, 'model:1:waiting', 'b'.repeat(64), { id: 'pending-provider-call' }])
  await service('bob_yield_job', [first.id, first.claimToken])
  const resumed = await claim(first.id)
  assert.deepEqual(resumed.entries.map((entry: any) => entry.key), ['model:1:waiting', 'startup:0'])
  assert.deepEqual(resumed.checkpoint.state, { nextStep: 1 })
  assert.equal((await pg.query<any>('select count(*)::int n from bob_private.bob_job_steps where job_id=$1', [first.id])).rows[0].n, 3, 'completed operations stay immutable but are not transported')
  await assert.rejects(save(first, 2, { nextStep: 2 }), /job_not_claimed/)
  await assert.rejects(save(resumed, 0, {}), /checkpoint_conflict/)
  await assert.rejects(save(resumed, 2, {}, cursor({ startup: 1, model: 0 })), /checkpoint_cursor_regression/)
  await assert.rejects(save(resumed, 2, {}, { ...cursor(), version: 2 }), /invalid_turn_checkpoint/)
  await assert.rejects(save(resumed, 2, {}, { ...cursor(), reusedModelCalls: '2' } as any), /invalid_turn_checkpoint/)
  await assert.rejects(save(resumed, 2, {}, cursor({ startup: '1' as any })), /invalid_journal_state/)
  await assert.rejects(save(resumed, 2, {}, { ...cursor(), reusedModelCalls: 9007199254740992 }), /invalid_journal_state/)
  const retained = await save(resumed, 2, { nextStep: 1, phase: 'before_model' }, cursor({ startup: 1, model: 1 }))
  assert.equal(retained.revision, 3)
  await service('bob_yield_job', [resumed.id, resumed.claimToken])
  const again = await claim(resumed.id)
  assert.deepEqual(again.entries.map((entry: any) => entry.key), ['model:1:waiting', 'startup:0'], 'a state-only checkpoint cannot discard an unconsumed operation')
  await finish(again.id, again.claimToken)
  assert.equal((await pg.query<any>('select count(*)::int n from bob_private.bob_turn_checkpoints where job_id=$1', [first.id])).rows[0].n, 0)
})

test('40 restarted main steps load a fixed journal tail and a crash reuses only its uncommitted operation', async () => {
  const q = await enqueue()
  let job = await claim(q.jobId), dispatched = 0, bootstrapRuns = 0
  let savedRevision = 0, crashed = false
  for (let step = 0; step < 40; step++) {
    const journal = createBobJournal({ entries: job.entries, save: entry => service('bob_save_job_step', [job.id, job.claimToken, entry.key, entry.fingerprint, entry.value]) }, Infinity, Date.now, new Map(), { unlimitedWork: true })
    await journal.run('startup', {}, async () => { bootstrapRuns++; return 'saved orientation' })
    const checkpoints = createBobTurnCheckpoint({ jobId: job.id, turnId: q.turn, catalogManifestId: job.catalogManifestId, checkpoint: job.checkpoint, journal,
      save: write => save(job, write.expectedRevision, write.state, write.journalState) })
    if (job.checkpoint) journal.restoreState(checkpoints.current()!.journalState)
    else await checkpoints.commit({ nextStep: 0 })
    assert.equal(checkpoints.current()!.state.nextStep, step)
    const answer = await journal.run('model:ask-bob', { step }, async () => { dispatched++; return `answer-${step}` })
    assert.equal(answer, `answer-${step}`)
    if (step === 20 && !crashed) {
      crashed = true
      // The model result committed, but the isolate died before the main state.
      await service('bob_yield_job', [job.id, job.claimToken])
      job = await claim(job.id)
      assert.equal(job.entries.length, 2, 'one bootstrap and one uncommitted model response')
      step--
      continue
    }
    const saved = await checkpoints.commit({ nextStep: step + 1 })
    savedRevision = saved.revision
    await service('bob_yield_job', [job.id, job.claimToken])
    job = await claim(job.id)
    assert.equal(job.entries.length, 1, `step ${step + 1} transports no completed main operation`)
    assert.equal(job.checkpoint.revision, savedRevision)
  }
  assert.equal(dispatched, 40)
  assert.equal(bootstrapRuns, 1)
  await finish(job.id, job.claimToken)
})

test('checkpoint tables and mutation RPCs are never exposed to a normal caller', async () => {
  const q = await enqueue(), job = await claim(q.jobId)
  await assert.rejects(asProjectUser(pg, owner, 'select * from bob_private.bob_turn_checkpoints'), /permission denied/)
  await assert.rejects(asProjectUser(pg, owner, 'select bob.bob_save_turn_checkpoint($1,$2,0,$3,$4)', [job.id, job.claimToken, {}, cursor()]), /permission denied/)
  await assert.rejects(asProjectUser(pg, owner, 'select bob.bob_claim_job_v2($1,$2)', [job.id, (await row(job.id)).capability]), /permission denied/)
  const packet = await save(job, 0, {})
  assert.throws(() => validateBobTurnCheckpoint(packet, { jobId: job.id, turnId: randomUUID(), catalogManifestId: job.catalogManifestId }), /invalid_turn_checkpoint/)
  assert.throws(() => validateBobTurnCheckpoint(packet, { jobId: job.id, turnId: q.turn, catalogManifestId: randomUUID() }), /invalid_turn_checkpoint/)
  await finish(job.id, job.claimToken)
})

test('prepared tool cards survive the ready-to-model checkpoint through PostgreSQL JSONB', async () => {
  for (const pinnedCatalog of [false, true]) {
    const q = await enqueue(), job = await claim(q.jobId)
    const definition: ToolDefinition = {
      version: 1, spec: { type: 'function', function: { name: 'read_source', description: 'Read the exact source.', parameters: { type: 'object', properties: {} } } },
      gate: () => 'available', execute: async () => ({ status: 'ok' }),
    }
    const policy: ToolPolicy = { name: 'read_source', description: 'Read the exact source.', how_to: 'Keep its version.', schema_version: 1, always_load: false, preload_phases: [], active: true }
    let cardBindings = 0
    const make = () => createToolSession({ definitions: [definition], toolInstructions: 'lazy', readPolicy: async () => ({ phase: 'design', tools: [policy] }),
      ...(pinnedCatalog ? { catalogTool: (name: string, parameters: Record<string, unknown>) => {
        if (name === policy.name && parameters.card) cardBindings++
        return { type: 'function' as const, function: { ...definition.spec.function, name } }
      } } : {}),
    })
    const first = make()
    await save(job, 0, { phase: 'ready', toolbox: first.exportState() })
    await first.prepare()
    assert.equal(first.exportState().cards.length, 1)
    // JSON.stringify roundtrips NUL, whereas PostgreSQL JSONB rejects it. This
    // must cross the production RPC boundary after cards have been populated.
    const stored = await save(job, 1, { phase: 'model', toolbox: first.exportState() })
    assert.equal(stored.revision, 2)
    const restored = make()
    restored.restoreState(stored.state.toolbox)
    assert.deepEqual(restored.exportState(), first.exportState())
    assert.deepEqual(await restored.prepare(), await first.prepare())
    if (pinnedCatalog) assert.equal(cardBindings, 1, 'the restored cache keeps its exact catalog binding')
    await finish(job.id, job.claimToken)
  }
})

test('checkpoint journal pages retain byte and row bounds without reading archived operations', async () => {
  const q = await enqueue(), job = await claim(q.jobId)
  for (let i = 0; i < 3; i++) await op(job, `startup:${i}`, 'x'.repeat(1_100_000))
  await save(job, 0, {}, cursor({ startup: 3 }))
  for (let i = 0; i < 105; i++) await op(job, `read:${String(i).padStart(3, '0')}`, i)
  const page = await service('bob_checkpoint_steps_page', [job.id, job.claimToken, null])
  assert.equal(page.entries.length, 100)
  assert.equal(page.next, 'read:099')
  const afterRows = await service('bob_checkpoint_steps_page', [job.id, job.claimToken, page.next])
  assert.equal(afterRows.entries.length, 6, 'five small active operations and one large bootstrap row')
  const afterLarge = await service('bob_checkpoint_steps_page', [job.id, job.claimToken, afterRows.next])
  assert.equal(afterLarge.entries.length, 1, 'two large entries cannot share a page')
  await save(job, 1, {}, cursor({ startup: 3, read: 105 }))
  const archived = await service('bob_checkpoint_steps_page', [job.id, job.claimToken, null])
  assert.deepEqual(archived.entries.map((entry: any) => entry.key), ['startup:0'])
  await service('bob_yield_job', [job.id, job.claimToken])
  const resumed = await claim(job.id)
  await assert.rejects(service('bob_checkpoint_steps_page', [job.id, job.claimToken, null]), /job_not_claimed/)
  assert.equal(resumed.entries.length, 3)
  await finish(resumed.id, resumed.claimToken)
})

test('expired lease, changed provider generation and cancellation fence checkpoint mutations', async () => {
  const q = await enqueue(), first = await claim(q.jobId)
  await save(first, 0, { nextStep: 0 })
  await pg.query("update bob_private.bob_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [q.jobId])
  await assert.rejects(save(first, 1, { nextStep: 1 }), /job_not_claimed/)
  const second = await claim(q.jobId)
  await pg.query('update bob_private.bob_thread_provider_state set generation=generation+1 where thread_id=$1', [second.threadId])
  await assert.rejects(save(second, 1, { nextStep: 1 }), /job_not_claimed/)
  await asProjectUser(pg, owner, 'select bob.bob_cancel_job($1,$2)', ['A', q.jobId])
  assert.equal((await row(q.jobId)).status, 'cancelled')
  await assert.rejects(save(second, 1, { nextStep: 1 }), /job_not_claimed/)
  assert.equal((await pg.query<any>('select count(*)::int n from bob_private.bob_turn_checkpoints where job_id=$1', [q.jobId])).rows[0].n, 0)
})

test('metadata-only checkpoints cannot mask five stalled segments', async () => {
  const q = await enqueue(), first = await claim(q.jobId)
  let checkpoint = await save(first, 0, { nextStep: 0 })
  assert.equal((await save(first, 1, { nextStep: 0 })).revision, 1, 'an unchanged snapshot is a no-op')
  await service('bob_yield_job', [first.id, first.claimToken])
  for (let i = 0; i < 5; i++) {
    const current = await claim(q.jobId)
    assert.equal(current.status, 'claimed')
    checkpoint = await save(current, checkpoint.revision, { nextStep: 0, diagnosticSegment: i })
    await service('bob_yield_job', [current.id, current.claimToken])
  }
  const stalled = await claim(q.jobId)
  assert.equal(stalled.status, 'failed')
  assert.equal((await row(q.jobId)).error_code, 'background_stalled')
})

test('a lost checkpoint acknowledgement yields before another operation can start', async () => {
  const journal = createBobJournal({ entries: [], save: async () => {} }, Infinity)
  const checkpoint = createBobTurnCheckpoint({ jobId: randomUUID(), turnId: randomUUID(), catalogManifestId: randomUUID(), checkpoint: null, journal, save: async () => { throw new Error('connection lost') } })
  await assert.rejects(checkpoint.commit({ nextStep: 0 }), error => error instanceof BobContinuation && error.message === 'checkpoint_unavailable')
  assert.equal(checkpoint.current(), null)
})

test('journal cursors preserve cumulative counters while active retries and reused calls count once', async () => {
  const input = { next: true }, hash = await fingerprint(input)
  const entries = [
    { key: 'model:ask-bob:0', fingerprint: hash, value: { ok: true, result: 'old', reused: true } },
    { key: 'model:ask-bob:0:retry:1', fingerprint: hash, value: { reason: 'provider_uncertain' } },
    { key: 'model:ask-bob:1:retry:1', fingerprint: hash, value: { reason: 'provider_uncertain' } },
  ]
  const journal = createBobJournal({ entries, save: async entry => { entries.push(entry as any) } }, Infinity)
  const restored = { version: 1 as const, positions: { 'model:ask-bob': 1 }, reusedModelCalls: 4, uncertainResends: 3 }
  journal.restoreState(restored)
  assert.equal(journal.reusedModelCalls(), 4, 'bootstrap and archived results are already in the cumulative count')
  assert.equal(journal.uncertainResends(), 4, 'one retry belongs to the active operation beyond the saved cursor')
  let nextKey = ''
  await journal.run('model:ask-bob', input, async identity => { nextKey = identity.key; return 'next' })
  assert.equal(nextKey, 'model:ask-bob:1')
  const exported = journal.exportState()
  assert.equal(exported.positions['model:ask-bob'], 2)
  assert.equal(exported.uncertainResends, 4)
  const next = createBobJournal({ entries: [], save: async () => {} }, Infinity)
  next.restoreState(exported)
  assert.deepEqual(next.exportState(), exported)
  restored.positions['model:ask-bob'] = 99
  assert.equal(journal.exportState().positions['model:ask-bob'], 2, 'restore clones the supplied cursor')
})

test('an in-flight operation cannot publish or restore a committed cursor', async () => {
  const journal = createBobJournal({ entries: [], save: async () => {} }, Infinity)
  const operation = journal.run('read', {}, async () => {
    assert.throws(() => journal.exportState(), /journal_boundary_required/)
    assert.throws(() => journal.restoreState(cursor() as any), /journal_boundary_required/)
    return 'done'
  })
  await operation
  assert.equal(journal.exportState().positions.read, 1)
})
