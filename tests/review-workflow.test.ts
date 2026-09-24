import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

let pg: PGlite
const owner = randomUUID(), outsider = randomUUID()
const query = (sql: string, args: unknown[] = [], uid: string | null = owner, role = 'authenticated') => asProjectUser(pg, uid, sql, args, role)
async function call(name: string, args: unknown[], uid: string | null = owner, role = 'authenticated'): Promise<any> {
  return (await query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, uid, role)).rows[0].result
}
before(async () => {
  pg = await projectSchema()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [owner, 'review-owner@example.test', outsider, 'review-outsider@example.test'])
})
after(() => pg.close())
async function fixture(phase: string | null = 'design') {
  const project = (await call('bob.create_project', [JSON.stringify({ name: 'Review regression' })])).id
  const draft = await call('bob_private.project_plan_propose', [project, 0, JSON.stringify({ summary: 'Shared work', reason: 'Prepare the drawing',
    steps: ['Design', 'Assembly'].map(title => ({ step_id: null, title, goal: title, state: 'active', phase, area_id: null, responsible_kind: 'bob', responsible_person_id: null, notes: '', requirements: [] })), task_links: [] })], owner, 'postgres')
  const plan = await call('bob_private.project_plan_decide', [project, 0, draft.record.revision, 'approve', 'Proceed'], owner, 'postgres')
  return { project, steps: plan.record.steps.map((s: any) => s.id) as string[] }
}
const solutionData = { title: 'Shelf', description: 'A proposed construction', assumptions: 'Check fit', tradeoffs: '', measurements: [] }
async function solution(project: string, area: string | null = null, expected = 0) {
  const id = randomUUID()
  await call('bob.solution_command', [project, 'create', id, 0, JSON.stringify({ ...solutionData, area_id: area })])
  await call('bob.solution_command', [project, 'select', id, expected, JSON.stringify({ area_id: area, solution_revision: 1, reason: 'Selected' })])
  return id
}

test('design and unclassified Steps can be reviewed without changing phase; actual task needs still block', async () => {
  for (const phase of ['design', null]) {
    const { project, steps } = await fixture(phase)
    const task = await call('bob.create_work_task', [project, steps[0], null, 'Create CAD drawing', 'novice', '1h'])
    const read = async () => (await query('select * from bob.current_task_readiness where task_id=$1', [task.id])).rows[0]
    assert.equal((await read()).readiness_state, 'unreviewed')
    const need = randomUUID()
    await call('bob.work_plan_command', [project, task.id, 'add_need', need, 0, JSON.stringify({ kind: 'information', label: 'Confirm opening width', notes: '' })])
    assert.equal((await read()).readiness_state, 'blocked')
    await assert.rejects(call('bob.work_plan_command', [project, task.id, 'confirm_readiness', null, 0, '{}']), /Resolve named blockers/)
    await call('bob.work_plan_command', [project, task.id, 'set_need_ready', need, 1, JSON.stringify({ ready: true })])
    assert.equal((await read()).readiness_state, 'unreviewed')
    await call('bob.work_plan_command', [project, task.id, 'confirm_readiness', null, 0, '{}'])
    assert.equal((await read()).readiness_state, 'ready')
    assert.equal((await call('bob.project_work_read', [project])).steps[0].phase, phase)
  }
})

test('home, Step and exact-version freshness agree after target and measurement changes without rewriting Build ready', async () => {
  const { project, steps } = await fixture()
  const selected = await solution(project), drawing = randomUUID(), measurement = randomUUID()
  const fact = { subject: 'Shelf width', value: '800', unit: 'mm', truth: 'measured', source: 'Tape', required: true }
  await call('bob.evidence_command', [project, 'measurement', 'create', measurement, 0, JSON.stringify(fact)])
  await call('bob.artifact_command', [project, 'create', drawing, 0, JSON.stringify({ area_id: null, title: 'Ready shelf', kind: 'detail', description: 'Saved design', status: 'build_ready', assumptions: 'Check assembly', target_revision: 1, measurements: [{ id: measurement, revision: 1 }], source_media_id: null })])
  await pg.query('insert into bob.artifact_step_links values($1,$2,$3)', [project, drawing, steps[0]])
  const status = async () => (await query('select * from bob.artifact_source_status where artifact_id=$1 and revision=1', [drawing])).rows[0]
  assert.equal((await status()).source_state, 'current')
  await call('bob.evidence_command', [project, 'measurement', 'revise', measurement, 1, JSON.stringify({ ...fact, value: '810', change_note: 'Remeasured' })])
  assert.deepEqual((await status()).source_reasons, ['measurements_changed'])
  await call('bob.solution_command', [project, 'revise', selected, 1, JSON.stringify({ ...solutionData, title: 'Wider shelf', change_note: 'New design' })])
  await call('bob.solution_command', [project, 'select', selected, 1, JSON.stringify({ solution_revision: 2, reason: 'Use wider design' })])
  for (const [view, key] of [['current_drawing_overview', 'id'], ['current_drawing_steps', 'artifact_id']]) {
    const row = (await query(`select * from bob.${view} where ${key}=$1`, [drawing])).rows[0]
    assert.equal(row.status, 'build_ready')
    assert.equal(row.source_state, 'changed')
    assert.deepEqual(row.source_reasons, ['target_changed', 'measurements_changed'])
  }
  assert.deepEqual((await query('select * from bob.artifact_source_status where artifact_id=$1', [drawing], outsider)).rows, [])
  await assert.rejects(query('select * from bob.artifact_source_status', [], null, 'anon'), /permission denied/)
  assert.equal((await query('select count(*)::int n from bob.artifact_revisions where artifact_id=$1', [drawing])).rows[0].n, 1)
})

test('Area drawings inherit the Project target until an explicit Area target exists', async () => {
  const { project } = await fixture(), area = 'a_' + project, drawing = randomUUID()
  await query('insert into bob.areas(id,project_id,slug,name) values($1,$2,$1,$3)', [area, project, 'Shelf work'])
  await solution(project)
  await call('bob.artifact_command', [project, 'create', drawing, 0, JSON.stringify({ area_id: area, title: 'Area drawing', kind: 'detail', description: 'Saved Area concept', status: 'concept', assumptions: 'Concept', target_revision: 1, measurements: [] })])
  const read = async () => (await query('select * from bob.artifact_source_status where artifact_id=$1', [drawing])).rows[0]
  assert.equal((await read()).source_state, 'current')
  await solution(project, area)
  assert.deepEqual((await read()).source_reasons, ['target_changed'], 'Equal decision numbers in different scopes do not hide a changed solution')
})

test('volunteer primary-Step images are readable only while the live task relation and capability remain valid', async () => {
  const { project, steps } = await fixture()
  const task = await call('bob.create_work_task', [project, steps[0], null, 'Build shelf', 'novice', '1h'])
  const invite = randomBytes(32).toString('hex'), session = randomBytes(32).toString('hex')
  const link = await call('bob.create_volunteer_link', [project, 'Helpers', invite, 30])
  await call('bob.volunteer_join', [invite, session, 'Helper', null], null, 'anon')
  const imageIds: string[] = []
  for (const [kind, target] of [['plan_step', steps[0]], ['plan_step', steps[1]], ['task', task.id]]) {
    const id = randomUUID(); imageIds.push(id)
    await call('bob.media_command', [project, 'reserve', id, JSON.stringify({ original_name: 'guide.png', title: kind + ' image', purpose: 'instruction', content_type: 'image/png', byte_size: 8, width: 1, height: 1, target_kind: kind, target_id: target })])
    await query("insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,$2)", [project + '/' + id, JSON.stringify({ size: 8, mimetype: 'image/png' })])
    await call('bob.media_command', [project, 'finalize', id, '{}'])
  }
  const taskRead = () => call('bob.volunteer_task', [session, task.id], null, 'anon')
  const mediaRead = (id: string) => call('bob.volunteer_media', [session, task.id, id], null, 'anon')
  assert.deepEqual((await taskRead()).images.map((i: any) => i.id).sort(), [imageIds[0], imageIds[2]].sort())
  assert.equal((await mediaRead(imageIds[0])).path, project + '/' + imageIds[0])
  await assert.rejects(mediaRead(imageIds[1]), /Image unavailable/)
  await call('bob_private.project_plan_link_task', [project, 1, steps[1], task.id, 'move'], owner, 'postgres')
  assert.deepEqual((await taskRead()).images.map((i: any) => i.id).sort(), [imageIds[1], imageIds[2]].sort())
  await assert.rejects(mediaRead(imageIds[0]), /Image unavailable/)
  await call('bob.media_command', [project, 'begin_delete', imageIds[1], '{}'])
  await assert.rejects(mediaRead(imageIds[1]), /Image unavailable/)
  await call('bob.revoke_volunteer_access', [project, link.id, null])
  await assert.rejects(taskRead(), /expired|revoked|unavailable|access/i)
  await assert.rejects(mediaRead(imageIds[2]), /expired|revoked|unavailable|access/i)
})
