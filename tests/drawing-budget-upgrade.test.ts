import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

const migrationName = '20261008160000_drawing_budget_3usd.sql'
const scope = { area_id: null, component_id: null, step_id: null, artifact_id: null }

test('drawing budget upgrade preserves request accounting, releases cost recovery and retains grant guards', async t => {
  const owner = randomUUID(), other = randomUUID(), turn = randomUUID()
  let project: string, claim: any, eventBefore: number
  const cases = [
    { name: 'cost-stop', status: 'retrieval_failed', limit: 2, spent: 2.203370, calls: 9, cap: 48, legacy: false, reason: 'turn_budget_exhausted', raised: true },
    { name: 'quality-stop', status: 'needs_data', limit: 1, spent: 0.3, calls: 3, cap: 24, legacy: false, reason: 'design_failed', raised: true },
    { name: 'paused', status: 'paused', limit: 1, spent: 0.2, calls: 2, cap: 24, legacy: false, reason: 'design_failed', raised: true },
    { name: 'saved', status: 'saved', limit: 1, spent: 1.1, calls: 3, cap: 24, legacy: false, reason: 'turn_budget_exhausted', raised: false },
    { name: 'cancelled', status: 'cancelled', limit: 1, spent: 0.5, calls: 2, cap: 24, legacy: false, reason: 'turn_budget_exhausted', raised: false },
    { name: 'legacy', status: 'retrieval_failed', limit: 0, spent: 0, calls: 0, cap: 0, legacy: true, reason: 'turn_budget_exhausted', raised: false },
    { name: 'at-three', status: 'retrieval_failed', limit: 3, spent: 3.1, calls: 4, cap: 24, legacy: false, reason: 'turn_budget_exhausted', raised: false },
    { name: 'above-three', status: 'retrieval_failed', limit: 4, spent: 3.5, calls: 4, cap: 48, legacy: false, reason: 'turn_budget_exhausted', raised: false },
  ].map(c => ({ ...c, id: randomUUID(), before: null as any }))
  let callsBefore: any[], resultsBefore: any[]
  const call = async (db: any, uid: string | null, name: string, args: unknown[], role = 'authenticated'): Promise<any> =>
    (await asProjectUser(db, uid, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
  const state = async (db: any, id: string) => (await db.query(`select jsonb_build_object(
    'budget',to_jsonb(b),'request',to_jsonb(r),'working',to_jsonb(d)) result
    from bob_private.drawing_budgets b join bob_private.project_drawing_requests r on r.id=b.request_id
    join bob_private.drawing_requests d on d.id=r.id where r.id=$1`, [id])).rows[0].result

  const pg = await projectSchema(async (db, name) => {
    if (name !== migrationName) return
    await db.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [owner, 'upgrade-owner@example.test', other, 'upgrade-other@example.test'])
    project = (await call(db, owner, 'bob.create_project', [{ name: 'Drawing allocation upgrade fixture' }])).id
    claim = await call(db, null, 'bob.bob_claim_turn', [project, owner, turn, 'Continue the same drawing'], 'service_role')
    for (const c of cases) {
      await call(db, owner, 'bob.create_drawing_request', [project, claim.thread_id, turn, claim.generation, c.id, scope])
      const payload = { brief: scope, owner_request: 'Continue the same drawing', reference_refs: [],
        draft: { recipe: { assembly_id: c.name }, source_fingerprint: 'source-stays' },
        retry: { fingerprint: 'f'.repeat(64), outcome: { status: 'unavailable', reason: c.reason, saved: false, stage: 'review' } } }
      await call(db, null, 'bob.bob_drawing_request', [project, owner, claim.thread_id, turn, claim.generation, 'save', c.id, 0, 'retrieval_failed', payload, randomUUID()], 'service_role')
      // Owner-only fixture writes establish historical terminal/paused states;
      // the tested migration must leave them terminal and never grant readiness.
      await db.query('update bob_private.project_drawing_requests set status=$2 where id=$1', [c.id, c.status])
      await db.query(`insert into bob_private.drawing_budgets(request_id,usd_limit,spent_usd,calls,call_limit,legacy_untracked)
        values($1,$2,$3,$4,$5,$6) on conflict(request_id) do update set
        usd_limit=excluded.usd_limit,spent_usd=excluded.spent_usd,calls=excluded.calls,
        call_limit=excluded.call_limit,legacy_untracked=excluded.legacy_untracked`, [c.id, c.limit, c.spent, c.calls, c.cap, c.legacy])
      c.before = await state(db, c.id)
    }
    const stopped = cases[0]
    for (let n = 0; n < stopped.calls; n++) {
      const key = n.toString(16).padStart(64, '0'), cost = n === 0 ? stopped.spent : 0
      await db.query(`insert into bob_private.drawing_model_calls(request_id,key,execution_id,thread_id,completed,cost_usd)
        values($1,$2,$3,$4,true,$5)`, [stopped.id, key, randomUUID(), claim.thread_id, cost])
      await db.query('insert into bob_private.drawing_model_results values($1,$2,$3,$4)', [stopped.id, key, claim.thread_id,
        { success: true, data: 'Retained paid fixture result', model: 'fixture', usage: { total_tokens: 1 }, estimatedCostUsd: cost }])
    }
    callsBefore = (await db.query('select * from bob_private.drawing_model_calls order by request_id,key')).rows
    resultsBefore = (await db.query('select * from bob_private.drawing_model_results order by request_id,key')).rows
    eventBefore = Number((await db.query('select revision from bob_private.drawing_project_events where project_id=$1', [project])).rows[0].revision)
    const { rows } = await db.query(`select pg_get_expr(d.adbin,d.adrelid) value from pg_attrdef d
      join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
      where d.adrelid='bob_private.drawing_budgets'::regclass and a.attname='usd_limit'`)
    assert.equal(rows[0].value, '1', 'fixture reproduces the missing hosted default upgrade')
  })
  t.after(() => pg.close())
  const rpc = (uid: string | null, name: string, args: unknown[], role = 'authenticated') => call(pg, uid, name, args, role)
  const budget = (id: string, operation: string, key: string, execution: string, response: unknown = null) =>
    rpc(null, 'bob.bob_drawing_budget', [project, owner, claim.thread_id, turn, claim.generation, id, execution, key, operation, response], 'service_role')

  await t.test('only open tracked budgets below three change; recovery releases only its fingerprint', async () => {
    for (const c of cases) {
      const after = await state(pg, c.id), before = c.before
      const expectedBudget = { ...before.budget, ...(c.raised ? { usd_limit: 3, revision: before.budget.revision + 1 } : {}) }
      assert.deepEqual(after.budget, expectedBudget, c.name + ': charges, calls and allocation identity stay intact')
      const released = c.raised && c.reason === 'turn_budget_exhausted'
      const expectedWorking = structuredClone(before.working), expectedRequest = structuredClone(before.request)
      if (released) {
        expectedWorking.payload.retry.fingerprint = ''
        expectedWorking.revision++
        expectedRequest.revision++
      }
      assert.deepEqual(after.working, expectedWorking, c.name + ': draft, outcome and receipts retained')
      assert.deepEqual(after.request, expectedRequest, c.name + ': no new request or lifecycle transition')
    }
    assert.deepEqual((await pg.query('select * from bob_private.drawing_model_calls order by request_id,key')).rows, callsBefore)
    assert.deepEqual((await pg.query('select * from bob_private.drawing_model_results order by request_id,key')).rows, resultsBefore)
    const event = Number((await pg.query('select revision from bob_private.drawing_project_events where project_id=$1', [project])).rows[0].revision)
    assert.equal(event, eventBefore + 1, 'one project event for multiple upgraded requests')
    const fresh = randomUUID()
    await rpc(owner, 'bob.create_drawing_request', [project, claim.thread_id, turn, claim.generation, fresh, scope])
    await pg.query('insert into bob_private.drawing_budgets(request_id) values($1)', [fresh])
    assert.equal(Number((await pg.query('select usd_limit from bob_private.drawing_budgets where request_id=$1', [fresh])).rows[0].usd_limit), 3, 'future requests use the upgraded default')
    await pg.exec(await readFile(new URL('../supabase/migrations/' + migrationName, import.meta.url), 'utf8'))
    assert.equal(Number((await pg.query('select revision from bob_private.drawing_project_events where project_id=$1', [project])).rows[0].revision), event, 'reapplying does not reallocate or wake again')
  })

  await t.test('upgraded request can review; completion may cross the threshold, replay never charges twice', async () => {
    const id = cases[0].id, execution = randomUUID(), key = 'a'.repeat(64)
    assert.equal((await budget(id, 'reserve', key, execution)).status, 'reserved', 'existing 2.203370 spend has review room after upgrade')
    const response = { success: true, data: 'Independent review', model: 'fixture', usage: { total_tokens: 10 }, estimatedCostUsd: 0.9 }
    await budget(id, 'complete', key, execution, response)
    await budget(id, 'complete', key, execution, response)
    assert.deepEqual((await budget(id, 'reserve', key, randomUUID())).response, response)
    const blocked = await budget(id, 'reserve', 'b'.repeat(64), execution)
    assert.equal(blocked.status, 'budget_exhausted')
    assert.deepEqual(blocked.budget_stop.reasons, ['usd_limit'])
    assert.equal(blocked.budget_stop.spent_usd, 3.103370)
    assert.equal(blocked.budget_stop.calls, 10, 'complete/replay/blocked dispatch do not add calls')
    const before = (await state(pg, id)).budget, grant = randomUUID()
    await assert.rejects(rpc(other, 'bob.grant_drawing_budget', [project, id, before.revision, grant]), /project_denied/)
    const first = await rpc(owner, 'bob.grant_drawing_budget', [project, id, before.revision, grant])
    assert.deepEqual(await rpc(owner, 'bob.grant_drawing_budget', [project, id, before.revision, grant]), first)
    assert.deepEqual((await state(pg, id)).budget, { ...before, usd_limit: 4, call_limit: 72, revision: before.revision + 1 }, 'one owner allocation on the same charged request')
    await assert.rejects(rpc(owner, 'bob.grant_drawing_budget', [project, id, before.revision, randomUUID()]), /budget_changed/)
    await assert.rejects(rpc(owner, 'bob.grant_drawing_budget', [project, id, first.revision, randomUUID()]), /budget_remaining/)
    assert.deepEqual((await budget(id, 'reserve', key, randomUUID())).response, response, 'original paid result still replays after the grant')
  })

  await t.test('pending and unpriced costs deny owner reallocation and service dispatch stays private', async () => {
    const id = cases.find(c => c.name === 'at-three')!.id, execution = randomUUID(), key = 'c'.repeat(64)
    const before = (await state(pg, id)).budget
    await pg.query('update bob_private.drawing_budgets set unpriced=true where request_id=$1', [id])
    await assert.rejects(rpc(owner, 'bob.grant_drawing_budget', [project, id, before.revision, randomUUID()]), /budget_outcome_unknown/)
    assert.deepEqual((await state(pg, id)).budget, { ...before, unpriced: true })
    await pg.query('update bob_private.drawing_budgets set unpriced=false where request_id=$1', [id])
    await pg.query('insert into bob_private.drawing_model_calls(request_id,key,execution_id,thread_id) values($1,$2,$3,$4)', [id, key, execution, claim.thread_id])
    await assert.rejects(rpc(owner, 'bob.grant_drawing_budget', [project, id, before.revision, randomUUID()]), /budget_outcome_unknown/)
    assert.deepEqual((await state(pg, id)).budget, before)
    await assert.rejects(rpc(owner, 'bob.bob_drawing_budget', [project, owner, claim.thread_id, turn, claim.generation, id, execution, key, 'reserve', null]), /permission denied/)
    await assert.rejects(rpc(null, 'bob.grant_drawing_budget', [project, id, before.revision, randomUUID()], 'service_role'), /permission denied/)
    await assert.rejects(asProjectUser(pg, owner, 'select * from bob_private.drawing_budgets'), /permission denied/)
  })
})
