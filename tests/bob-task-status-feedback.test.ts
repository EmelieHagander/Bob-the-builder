import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { createWorkRecords, type WorkResource } from '../supabase/functions/_shared/project-work-records.ts'
import { createProjectWriter, type WritePayload } from '../supabase/functions/_shared/project-write.ts'

const uid = '00000000-0000-4000-8000-000000000001'
const quote = 'Update the requested task status and readiness.'
let pg: Awaited<ReturnType<typeof projectSchema>>, thread: string, turn: string, generation: number
before(async () => {
  pg = await projectSchema()
  await pg.query('insert into auth.users values($1,$2,now())', [uid, 'owner@example.test'])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Project A'); insert into bob.areas(id,project_id,slug,name) values('areaA','A','assembly','Assembly')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('owner','A','Owner','OA',$1),('helper','A','Helper','HA',null)", [uid])
})
after(async () => { await pg?.close() })

async function claim() {
  if (turn) await asProjectUser(pg, null, 'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)', ['A', uid, thread, turn, generation], 'service_role')
  turn = randomUUID()
  const result: any = (await asProjectUser(pg, null, "select bob.bob_claim_turn('A',$1,$2,$3) result", [uid, turn, quote], 'service_role')).rows[0].result
  assert.equal(result.status, 'claimed')
  thread = result.thread_id; generation = result.generation
}
async function fixtureTask(id: string) {
  await pg.query("insert into bob.tasks(id,project_id,area_id,name,instructions) values($1,'A','areaA',$1,'Keep the owner instructions and original decision.')", [id])
  await pg.query("insert into bob.task_assignees values($1,'owner'),($1,'helper')", [id])
}
function setup() {
  const writer = createProjectWriter('A', quote, async payload => {
    try {
      return { data: (await asProjectUser(pg, uid, 'select bob.bob_project_write_v19($1,$2,$3,$4,$5::jsonb) result', ['A', thread, turn, generation, JSON.stringify(payload)])).rows[0].result, error: null }
    } catch (e: any) { return { data: null, error: { code: e.code, message: e.message } } }
  }, async () => ({ data: [], error: null }), async () => ({ data: { generation: generation + 1, receipts: [] }, error: null }), { taskWorkDiagnostics: true })
  const read = async (input: { resource: WorkResource; query: string | null; after: string | null }) => ({
    data: (await asProjectUser(pg, uid, 'select bob.read_bob_work_context($1,$2,$3,$4) result', ['A', input.resource, input.query, input.after])).rows[0].result, error: null,
  })
  const readSnapshot = async (input: { resource: WorkResource; key: string }) => ({
    data: (await asProjectUser(pg, uid, 'select bob.read_bob_work_snapshot($1,$2,$3) result', ['A', input.resource, input.key])).rows[0].result, error: null,
  })
  const tools = createWorkRecords({ projectId: 'A', writer, hasAccess: async () => true, read, readSnapshot })
  return { writer, tools: { ...tools, execute: (name: string, value: unknown) => tools.execute(name, value, 1, true) } }
}
async function choose(tools: ReturnType<typeof createWorkRecords>, name: string) {
  const result = await tools.execute('read_work_context', { resource: 'tasks', query: name, next_ref: null })
  assert.equal(result.status, 'ok', JSON.stringify(result))
  return result.entries.find((entry: any) => entry.content.name === name)
}
const state = (ref: string, value: string) => ({ ref, action: 'status', value, reason: 'Requested status update', request_quote: quote })
const readiness = (task_ref: string, action: string, overrides: Record<string, unknown> = {}) => ({
  task_ref, action, item_index: null, source_ref: null, checkpoint_index: null, changes: [], ready: null, note: null,
  reason: 'Requested readiness update', request_quote: quote, ...overrides,
})
async function assertPreserved(id: string, status: string) {
  const row: any = (await pg.query('select status,instructions,area_id from bob.tasks where id=$1', [id])).rows[0]
  assert.equal(row.status, status)
  assert.equal(row.instructions, 'Keep the owner instructions and original decision.')
  assert.equal(row.area_id, 'areaA')
  assert.deepEqual((await pg.query('select person_id from bob.task_assignees where task_id=$1 order by person_id', [id])).rows.map((r: any) => r.person_id), ['helper', 'owner'])
}

test('bound task status makes the complete todo roundtrip without changing content or assignments', async () => {
  await fixtureTask('status roundtrip'); await claim()
  const { tools, writer } = setup()
  let current = await choose(tools, 'status roundtrip')
  for (const value of ['doing', 'done', 'todo', 'blocked', 'todo']) {
    const result = await tools.execute('change_work_state', state(current.ref, value))
    assert.equal(result.status, 'saved', JSON.stringify(result))
    assert.equal(result.current.content.status, value)
    await assertPreserved('status roundtrip', value)
    current = result.current
  }
  assert.equal(writer.receipts.length, 1, 'the answer keeps the latest receipt for this Task')
  assert.equal((await pg.query('select count(*)::int n from bob_private.bob_write_receipts where turn_id=$1', [turn])).rows[0].n, 5)
  assert.equal(writer.hasUnresolvedWrites, false)
})

test('an incomplete required check returns a useful safe reason and remains enforced until completion', async () => {
  await fixtureTask('required check'); await claim()
  const check = randomUUID()
  await pg.query("insert into bob.task_steps(id,project_id,task_id,title,instructions,position,is_checkpoint,required,created_by) values($1,'A','required check','Inspect the actual fastening','Record the inspection result',1,true,true,$2)", [check, uid])
  const { tools, writer } = setup()
  const rejected = await tools.execute('change_work_state', state((await choose(tools, 'required check')).ref, 'done'))
  assert.equal(rejected.status, 'invalid')
  assert.equal(rejected.validation.code, 'task_required_checks')
  assert.match(rejected.message, /incomplete required checks/)
  assert.deepEqual(rejected.current.content.instruction_steps.map((step: any) => ({ title: step.title, completed: step.completed })), [{ title: 'Inspect the actual fastening', completed: false }])
  assert.ok(!JSON.stringify(rejected).includes(check), 'refresh exposes the useful check, never its raw database identity')
  assert.equal(writer.receipts.length, 0)
  assert.equal(writer.hasUnresolvedWrites, true)
  await assertPreserved('required check', 'todo')

  const started = await tools.execute('change_work_state', state(rejected.current.ref, 'doing'))
  assert.equal(started.status, 'saved', 'an incomplete completion check does not prevent starting the Task')
  await asProjectUser(pg, uid, "select bob.task_steps_command('A','required check','complete',$1,'{\"revision\":1,\"completed\":true}')", [check])
  const completed = await tools.execute('change_work_state', state((await choose(tools, 'required check')).ref, 'done'))
  assert.equal(completed.status, 'saved', JSON.stringify(completed))
  await assertPreserved('required check', 'done')
})

test('readiness blockers are named without creating a new prohibition on task status changes', async () => {
  await fixtureTask('readiness task'); await claim()
  await asProjectUser(pg, uid, "select bob.work_plan_command('A','readiness task','add_need',$1,0,'{\"kind\":\"tool\",\"label\":\"Confirm the saw is available\",\"notes\":\"Awaiting owner report\"}')", [randomUUID()])
  const { tools } = setup()
  let current = await choose(tools, 'readiness task')
  const blocked = await tools.execute('change_task_readiness', readiness(current.ref, 'confirm_readiness', { note: 'Requested check' }))
  assert.equal(blocked.status, 'invalid')
  assert.equal(blocked.validation.code, 'task_readiness_blocked')
  assert.ok(blocked.current.content.readiness.blockers.some((item: any) => item.kind === 'tool' && item.label === 'Tool needed: Confirm the saw is available'))
  assert.match(blocked.message, /Readiness is separate from Task status/)
  const started = await tools.execute('change_work_state', state(blocked.current.ref, 'doing'))
  assert.equal(started.status, 'saved')
  assert.equal(started.current.content.needs[0].ready, false, 'starting does not fabricate readiness evidence')
  await assertPreserved('readiness task', 'doing')

  const readyNeed = await tools.execute('change_task_readiness', readiness(started.current.ref, 'set_need_ready', { item_index: 0, ready: true }))
  assert.equal(readyNeed.status, 'saved')
  const confirmed = await tools.execute('change_task_readiness', readiness(readyNeed.current.ref, 'confirm_readiness', { note: 'Fixture owner confirmed availability' }))
  assert.equal(confirmed.status, 'saved', JSON.stringify(confirmed))
  const completed = await tools.execute('change_work_state', state(confirmed.current.ref, 'done'))
  assert.equal(completed.status, 'saved')
  const inactive = await tools.execute('change_task_readiness', readiness(completed.current.ref, 'confirm_readiness', { note: 'No new work requested' }))
  assert.equal(inactive.status, 'invalid')
  assert.equal(inactive.validation.code, 'task_readiness_inactive')
  assert.equal(inactive.current.content.status, 'done')
})

test('a dependency cycle stays rejected and explains how to reconsider the existing prerequisites', async () => {
  await fixtureTask('cycle first'); await fixtureTask('cycle second'); await claim()
  const { tools } = setup()
  const first = await choose(tools, 'cycle first'), second = await choose(tools, 'cycle second')
  const added = await tools.execute('change_task_readiness', readiness(first.ref, 'add_dependency', { source_ref: second.ref, note: 'Second precedes first' }))
  assert.equal(added.status, 'saved', JSON.stringify(added))
  const cycle = await tools.execute('change_task_readiness', readiness(second.ref, 'add_dependency', { source_ref: added.current.ref, note: 'Would form a cycle' }))
  assert.equal(cycle.status, 'invalid')
  assert.equal(cycle.validation.code, 'task_dependency_cycle')
  assert.match(cycle.message, /dependency cycle/)
  assert.deepEqual(cycle.current.content.dependencies, [])
  assert.equal((await pg.query("select count(*)::int n from bob.task_dependencies where task_id in ('cycle first','cycle second')")).rows[0].n, 1)
})

test('only exact known task domain errors get recovery codes; access, conflict and unknown outcomes keep their meaning', async () => {
  const status: WritePayload = { kind: 'task_work', record_id: 'fixture', expected_updated_at: '2026-10-17T00:00:00Z', expected_revision: null, request_quote: quote, data: { status: 'done', person_ids: [] } }
  const wrap = (domain: WritePayload): WritePayload => ({ ...domain, kind: 'bound_work', data: { domain } })
  const execute = async (payload: WritePayload, code: string, message: string, taskWorkDiagnostics = true) => {
    const writer = createProjectWriter('A', quote, async () => ({ data: null, error: { code, message } }), async () => ({ data: [], error: null }), async () => ({ data: { generation: 1, receipts: [] }, error: null }), taskWorkDiagnostics ? { taskWorkDiagnostics: true } : undefined)
    return writer.commit(payload)
  }
  const fixed = 'Complete required checks before marking this task done.'
  assert.deepEqual(await execute(wrap(status), 'P0001', fixed, false), {
    status: 'invalid', message: 'The database rejected this command. No change made; check fields, source, current revision and record state.',
  }, 'pinned older turns retain byte-identical feedback for journal replay')
  for (const payload of [status, wrap(status)]) assert.equal((await execute(payload, 'P0001', fixed)).validation?.code, 'task_required_checks')
  const checkpoint: WritePayload = { ...status, kind: 'operational', data: { resource: 'task_work', action: 'add_dependency' } }
  assert.equal((await execute(wrap(checkpoint), 'P0001', 'Dependency checkpoint must be a checkpoint on the prerequisite task.')).validation?.code, 'task_dependency_checkpoint')
  for (const [payload, code, message] of [
    [status, 'P0001', fixed + ' private SQL detail'],
    [{ ...status, data: { status: 'doing' } }, 'P0001', fixed],
    [{ ...status, kind: 'task' }, 'P0001', fixed],
    [status, '22023', fixed],
    [wrap(checkpoint), 'P0001', 'private SQL detail'],
  ] as [WritePayload, string, string][]) {
    const result = await execute(payload, code, message)
    assert.equal(result.status, 'invalid')
    assert.equal(result.validation, undefined)
    assert.ok(!JSON.stringify(result).includes('private SQL detail'))
  }
  assert.equal((await execute(wrap(status), 'PT409', 'record_changed')).status, 'conflict')
  assert.deepEqual(await execute(wrap(status), '42501', 'project_denied'), { status: 'denied', reason: 'access' })
  assert.equal((await execute(wrap(status), 'XX000', fixed)).status, 'unknown')
})
