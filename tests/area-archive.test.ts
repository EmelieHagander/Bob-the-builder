import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

let pg: PGlite
const owner = randomUUID(), stranger = randomUUID()
const as = (sql: string, args: unknown[] = [], uid: string | null = owner, role = 'authenticated') => asProjectUser(pg, uid, sql, args, role)
const rpc = async (name: string, args: unknown[], uid: string | null = owner, role = 'authenticated'): Promise<any> =>
  (await as(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, uid, role)).rows[0].result
const step = (area: string | null, id: string | null = null, state = 'planned') => ({ step_id: id, title: 'Prepare work', goal: 'Work completed and checked', state, area_id: area, phase: 'design', responsible_kind: 'unassigned', responsible_person_id: null, notes: '', requirements: [] })
before(async () => {
  pg = await projectSchema()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [owner, 'archive-owner@example.test', stranger, 'archive-stranger@example.test'])
})
after(() => pg.close())
async function fixture() {
  const project = (await rpc('bob.create_project', [JSON.stringify({ name: 'Area lifecycle' })])).id
  const area = 'a_' + randomUUID()
  await as('insert into bob.areas(id,project_id,slug,name) values($1,$2,$1,$3)', [area, project, 'Old work area'])
  const read = async () => (await as('select * from bob.areas where id=$1', [area])).rows[0] as any
  const command = async (action: string, expected?: string, uid = owner) => rpc('bob.area_lifecycle_command', [project, area, action, expected ?? (await read()).updated_at], uid)
  const propose = (steps: any[], expected = 0) => rpc('bob_private.project_plan_propose', [project, expected, JSON.stringify({ summary: 'Organise work', reason: 'Move existing work', steps, task_links: [] })], owner, 'postgres')
  const approve = (revision: number, expected = 0) => rpc('bob_private.project_plan_decide', [project, expected, revision, 'approve', 'Requested work organisation'], owner, 'postgres')
  return { project, area, read, command, propose, approve }
}

test('an Area with historical plan references can be archived after work moves, preserving exact history and Task identity', async () => {
  const f = await fixture()
  const first = await f.propose([step(f.area)])
  await f.approve(first.record.revision)
  const sid = first.record.steps[0].id
  const task = await rpc('bob.create_work_task', [f.project, sid, null, 'Existing task', 'novice', '1h'])
  await assert.rejects(f.command('archive'), /Move or finish/)
  const next = await f.propose([step(null, sid)], 1)
  await f.approve(next.record.revision, 1)
  const before = await f.read()
  const result = await f.command('archive', before.updated_at)
  assert(result.archived_at)
  assert.equal((await as('select area_id from bob.project_plan_steps where project_id=$1 and plan_revision=1', [f.project])).rows[0].area_id, f.area)
  assert.equal((await as('select area_id from bob.tasks where id=$1', [task.id])).rows[0].area_id, null)
  assert.equal((await rpc('bob.project_work_read', [f.project])).areas[0].archived_at, result.archived_at)
  assert((await rpc('bob.search_bob_project_data_v2', [f.project, 'areas', null, null, null, f.area, null])).records[0].archived_at)
  await assert.rejects(f.command('restore', before.updated_at), /Area changed/)
  await f.command('restore')
  assert.equal((await f.read()).archived_at, null)
  assert.deepEqual((await as('select action from bob.area_lifecycle_events where area_id=$1 order by recorded_at', [f.area])).rows.map(r => r.action), ['archive', 'restore'])
})

test('archive rejects unfinished legacy Tasks and pending proposals; completed records remain accessible', async () => {
  const f = await fixture(), task = 't_' + randomUUID()
  await as('insert into bob.tasks(id,project_id,area_id,name) values($1,$2,$3,$4)', [task, f.project, f.area, 'Retained task'])
  await assert.rejects(f.command('archive'), /unfinished/)
  await as("update bob.tasks set status='done' where id=$1", [task])
  const draft = await f.propose([step(f.area)])
  await assert.rejects(f.command('archive'), /pending plan proposal/)
  await rpc('bob_private.project_plan_decide', [f.project, 0, draft.record.revision, 'reject', 'Keep old work archived'], owner, 'postgres')
  await f.command('archive')
  assert.equal((await as('select status from bob.tasks where id=$1', [task])).rows[0].status, 'done')
  await assert.rejects(as("update bob.tasks set status='todo' where id=$1", [task]), /Restore the Area/)
  await assert.rejects(rpc('bob.create_work_task', [f.project, null, f.area, 'New work', 'novice', '1h']), /Restore the Area/)
  await assert.rejects(f.propose([step(f.area)]), /Restore the Area/)
  await rpc('bob.phase_command', [f.project, 'project', null, 'complete', 'All active work finished'])
  await f.command('restore')
  await as("update bob.tasks set status='todo' where id=$1", [task])
})

test('ordinary table writes cannot bypass archive guards and foreign/anonymous callers have no lifecycle authority', async () => {
  const f = await fixture()
  await assert.rejects(as('update bob.areas set archived_at=now() where id=$1', [f.area]), /permission denied|archive or restore command/)
  await assert.rejects(f.command('archive', undefined, stranger), /project_denied/)
  await assert.rejects(rpc('bob.area_lifecycle_command', [f.project, f.area, 'archive', (await f.read()).updated_at], null, 'anon'), /permission denied/)
  await f.command('archive')
  assert.deepEqual((await as('select * from bob.area_lifecycle_events where project_id=$1', [f.project], stranger)).rows, [])
  await assert.rejects(as('select * from bob.area_lifecycle_events', [], null, 'anon'), /permission denied/)
})
