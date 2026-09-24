import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { makePlan, planId } from './support/multifloor-fixture.ts'
import { checkedBuildingPlan } from '../src/lib/buildingPlan.ts'
import { checkedRoomLayout } from '../src/lib/roomLayout.ts'
import { checkedStairStudy } from '../src/lib/stairStudy.ts'
import { makeStair } from './support/stair-fixture.ts'

let pg: PGlite
const owner = randomUUID(), json = JSON.stringify
const query = (sql: string, args: unknown[] = [], uid: string | null = owner, role = 'authenticated') => asProjectUser(pg, uid, sql, args, role)
async function call(name: string, args: unknown[], role = 'authenticated'): Promise<any> {
  return (await query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role === 'authenticated' || role === 'postgres' ? owner : null, role)).rows[0].result
}
before(async () => { pg = await projectSchema(); await pg.query('insert into auth.users values($1,$2,now())', [owner, 'drawing-reader@example.test']) })
after(() => pg.close())
async function fixture() {
  const project = (await call('bob.create_project', [json({ name: 'Volunteer drawing proof' })])).id
  const draft = await call('bob_private.project_plan_propose', [project, 0, json({ summary: 'Work', reason: 'Fixture', steps: ['Assembly', 'Finishing'].map(title => ({ step_id: null, title, goal: title, state: 'active', phase: 'design', area_id: null, responsible_kind: 'bob', responsible_person_id: null, notes: '', requirements: [] })), task_links: [] })], 'postgres')
  const plan = await call('bob_private.project_plan_decide', [project, 0, draft.record.revision, 'approve', 'Fixture'], 'postgres')
  const steps = plan.record.steps.map((s: any) => s.id)
  const task = (await call('bob.create_work_task', [project, steps[0], null, 'Build box', 'novice', '1h'])).id
  const solution = randomUUID()
  await call('bob.solution_command', [project, 'create', solution, 0, json({ area_id: null, title: 'Box', description: 'Design', assumptions: 'Unverified', tradeoffs: '', measurements: [] })])
  await call('bob.solution_command', [project, 'select', solution, 0, json({ solution_revision: 1, reason: 'Fixture' })])
  const invite = randomBytes(32).toString('hex'), secret = randomBytes(32).toString('hex')
  const link = await call('bob.create_volunteer_link', [project, 'Test participants', invite, 30])
  await call('bob.volunteer_join', [invite, secret, 'Test participant', null], 'anon')
  return { project, task, steps, solution, secret, link }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function drawing(f: Fixture, extra = {}, step: string | null = f.steps[0]) {
  const id = randomUUID()
  await call('bob.artifact_command', [f.project, 'create', id, 0, json({ area_id: null, title: 'Work drawing', kind: 'detail', description: 'Saved description', status: 'concept', assumptions: 'Fit must be checked', target_revision: 1, measurements: [], source_media_id: null, ...extra })])
  if (step) await pg.query('insert into bob.artifact_step_links values($1,$2,$3)', [f.project, id, step])
  return id
}
const list = (f: Fixture, after: string | null = null) => call('bob.volunteer_drawings', [f.secret, f.task, after], 'anon')
const read = (f: Fixture, id: string, revision = 1) => call('bob.volunteer_drawing', [f.secret, f.task, id, revision], 'anon')

test('guest gets only the current primary Step drawings; moving a Task or unlinking ends that access', async () => {
  const f = await fixture(), other = await fixture()
  const visible = await drawing(f), secondStep = await drawing(f, {}, f.steps[1]), unlinked = await drawing(f, {}, null), foreign = await drawing(other)
  assert.deepEqual((await list(f)).items.map((d: any) => d.id), [visible])
  const d = await read(f, visible)
  assert.equal(d.projectId, f.project); assert.equal(d.taskId, f.task); assert.equal(d.stepId, f.steps[0]); assert.equal(d.assumptions, 'Fit must be checked')
  for (const id of [secondStep, unlinked, foreign]) await assert.rejects(read(f, id), /Drawing unavailable/)
  await assert.rejects(call('bob.volunteer_drawings', [f.secret, other.task, null], 'anon'), /Task unavailable/)
  await call('bob_private.project_plan_link_task', [f.project, 1, f.steps[1], f.task, 'move'], 'postgres')
  await assert.rejects(read(f, visible), /Drawing unavailable/)
  assert.deepEqual((await list(f)).items.map((d: any) => d.id), [secondStep])
  await pg.query('delete from bob.artifact_step_links where artifact_id=$1', [secondStep])
  await assert.rejects(read(f, secondStep), /Drawing unavailable/)
  assert.deepEqual((await list(f)).items, [])
})

test('exact current versions only; archive and revision changes cannot be bypassed with old ids', async () => {
  const f = await fixture(), id = await drawing(f)
  await call('bob.artifact_command', [f.project, 'revise', id, 1, json({ title: 'Updated work drawing', description: 'New description', kind: 'detail', status: 'concept', assumptions: 'New assumptions', target_revision: 1, measurements: [], source_media_id: null, change_note: 'Fixture' })])
  await assert.rejects(read(f, id), /Drawing unavailable/)
  assert.equal((await read(f, id, 2)).description, 'New description')
  await call('bob.artifact_command', [f.project, 'archive', id, 2, '{}'])
  assert.deepEqual((await list(f)).items, []); await assert.rejects(read(f, id, 3), /Drawing unavailable/)
  await call('bob.artifact_command', [f.project, 'restore', id, 3, '{}'])
  assert.equal((await read(f, id, 4)).revision, 4)
  assert.equal((await pg.query('select count(*)::int n from bob.artifact_revisions where artifact_id=$1', [id])).rows[0].n, 4)
})

test('source changes stay distinct from saved status, and unavailable sources hide geometry and image bytes', async () => {
  const f = await fixture(), measurement = randomUUID(), media = randomUUID()
  const fact = { subject: 'Width', value: '800', unit: 'mm', truth: 'measured', source: 'Synthetic tape reading', required: true }
  await call('bob.evidence_command', [f.project, 'measurement', 'create', measurement, 0, json(fact)])
  await call('bob.media_command', [f.project, 'reserve', media, json({ original_name: 'drawing.png', title: 'Drawing', purpose: 'reference', content_type: 'image/png', byte_size: 8, width: 1, height: 1, target_kind: 'project', target_id: f.project })])
  await query("insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,$2)", [f.project + '/' + media, json({ size: 8, mimetype: 'image/png' })])
  await call('bob.media_command', [f.project, 'finalize', media, '{}'])
  const id = await drawing(f, { status: 'build_ready', source_media_id: media, measurements: [{ id: measurement, revision: 1 }] })
  const image = () => call('bob.volunteer_drawing_media', [f.secret, f.task, id, 1, media], 'service_role')
  assert.equal((await read(f, id)).sourceState, 'current'); assert.equal((await image()).path, f.project + '/' + media)
  await assert.rejects(call('bob.volunteer_drawing_media', [f.secret, f.task, id, 1, media], 'anon'), /permission denied/)
  await assert.rejects(call('bob.volunteer_media', [f.secret, f.task, media], 'anon'), /Image unavailable/, 'Drawing sharing does not widen the ordinary image RPC')
  await call('bob.evidence_command', [f.project, 'measurement', 'revise', measurement, 1, json({ ...fact, value: '810', change_note: 'New fixture value' })])
  const changed = await read(f, id)
  assert.equal(changed.status, 'build_ready'); assert.equal(changed.sourceState, 'changed'); assert.deepEqual(changed.sourceReasons, ['measurements_changed'])
  assert.equal((await list(f)).items[0].sourceState, 'changed')
  await pg.query("update bob.media_assets set state='deleting' where id=$1", [media])
  const unavailable = await read(f, id)
  assert.equal(unavailable.sourceState, 'unavailable'); assert.equal(unavailable.content, null)
  await assert.rejects(image(), /Image unavailable/)
})

test('CAD and parametric geometry use the saved recipe; CAD manifests and model exports are excluded', async () => {
  const f = await fixture(), id = await drawing(f)
  const definitions = [{ id: 'panel', primitive: 'box', x_mm: 800, y_mm: 400, z_mm: 18 }]
  await pg.query('insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,1,$3,$4,$5)', [f.project, id,
    json({ contract_version: 1, units: 'mm', definitions, privateField: 'NOT_SHARED' }), json({ internal: 'NOT_SHARED' }), json({ front: 'PHN2Zy8+', top: 'PHN2Zy8+', step: 'NOT_SHARED', log: 'NOT_SHARED' })])
  const d = await read(f, id)
  assert.deepEqual(d.content.cad, { recipe: { definitions }, files: { front: 'PHN2Zy8+', top: 'PHN2Zy8+' }, source_changed: false })
  assert.doesNotMatch(json(d), /NOT_SHARED/)
  const box = randomUUID(), recipe = { generator: 'storage_box_v1', version: 1, width_mm: 800, height_mm: 350, depth_mm: 600, thickness_mm: 18 }
  await call('bob.artifact_box_command', [f.project, 'create', box, 0, json({ area_id: null, title: 'Box', description: 'Five panels', assumptions: 'Fixture', target_revision: 1, recipe, measurements: [] })])
  await pg.query('insert into bob.artifact_step_links values($1,$2,$3)', [f.project, box, f.steps[0]])
  assert.deepEqual((await read(f, box)).content.parametricRecipe, recipe)
})

test('physical drawings lose their render payload when the project Building link is removed, even under the definer', async () => {
  const f = await fixture(), id = randomUUID(), building = planId(200), scope = randomUUID()
  await call('bob.physical_building_command', ['create', building, 0, json({ name: 'Fixture house', notes: 'Synthetic only' })])
  for (const [n, name, position] of [[201, 'Ground', 0], [206, 'Upper', 1]] as const) await call('bob.physical_node_command', [building, 'level', 'create', planId(n), 0, json({ name, position })])
  for (const [n, level] of [[202, 201], [203, 201], [207, 206], [208, 206]]) await call('bob.physical_node_command', [building, 'space', 'create', planId(n), 0, json({ name: 'Room ' + n, kind: 'room', level_id: planId(level), truth: 'unknown', measurements: [] })])
  await call('bob.physical_scope_command', [f.project, 'project', 'link', scope, json({ target_kind: 'building', building_id: building })])
  await call('bob.artifact_multifloor_command', [f.project, 'create', id, 0, json({ area_id: null, title: 'Floors', description: 'Coordinates', assumptions: 'Synthetic', target_revision: 1, recipe: makePlan(), measurements: [], change_note: 'Fixture' })])
  await pg.query('insert into bob.artifact_step_links values($1,$2,$3)', [f.project, id, f.steps[0]])
  assert.equal(checkedBuildingPlan((await read(f, id)).content.multifloorPlan, f.project, id, 1).names[planId(201)], 'Ground')
  const stair = randomUUID(), room = randomUUID(), box = randomUUID(), wall = randomUUID()
  await call('bob.artifact_stair_command', [f.project, 'create', stair, 0, json({ plan_id: id, plan_revision: 1, recipe: makeStair(), title: 'Stair', description: 'Study', assumptions: 'Synthetic', change_note: 'Fixture' })])
  await call('bob.artifact_box_command', [f.project, 'create', box, 0, json({ area_id: null, title: 'Furniture', description: 'Box', assumptions: 'Fixture', target_revision: 1, measurements: [], recipe: { generator: 'storage_box_v1', version: 1, width_mm: 800, height_mm: 350, depth_mm: 600, thickness_mm: 18 } })])
  await call('bob.physical_node_command', [building, 'element', 'create', wall, 0, json({ name: 'Shared wall', kind: 'wall', space_id: planId(202), truth: 'unknown', description: 'Synthetic' })])
  await call('bob.artifact_room_layout_command', [f.project, 'create', room, 0, json({ title: 'Room pair', description: 'Proposed placement', assumptions: 'Synthetic', area_id: null, target_revision: 1, change_note: 'Fixture', building_id: building,
    left_space_id: planId(202), right_space_id: planId(203), wall_element_id: wall, furniture_artifact_id: box, left_space_revision: 1, right_space_revision: 1, wall_element_revision: 1, furniture_revision: 1, measurements: [],
    parameters: { generator: 'room_pair_v1', version: 1, span_mm: 6120, depth_mm: 4000, wall_thickness_mm: 120, left_width_mm: 3400, furniture_room: 'left', anchor: 'shared_wall', gap_mm: 50, offset_mm: 200, rotation: 0 } })])
  for (const child of [stair, room]) await pg.query('insert into bob.artifact_step_links values($1,$2,$3)', [f.project, child, f.steps[0]])
  assert.equal(checkedStairStudy((await read(f, stair)).content.stairStudy, f.project, stair, 1).plan_id, id)
  assert.equal(checkedRoomLayout((await read(f, room)).content.roomLayout, f.project, room, 1).furniture_artifact_id, box)
  await call('bob.physical_scope_command', [f.project, 'project', 'unlink', scope, '{}'])
  assert((await list(f)).items.every((d: any) => d.sourceState === 'unavailable'))
  for (const child of [id, stair, room]) assert.equal((await read(f, child)).content, null)
})

test('drawing lists are bounded; revocation/expiry and anonymous raw-table reads fail closed', async () => {
  const f = await fixture()
  for (let i = 0; i < 22; i++) await drawing(f, { title: 'Drawing ' + i })
  const first = await list(f), second = await list(f, first.nextCursor)
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 2); assert.equal(second.nextCursor, null)
  assert.equal(new Set([...first.items, ...second.items].map(d => d.id)).size, 22)
  assert.doesNotMatch(json(first), /recipe|files|bucket|path/)
  for (const table of ['artifacts', 'artifact_cad_revisions', 'artifact_multifloor_details', 'current_drawing_steps', 'project_spaces']) await assert.rejects(query(`select * from bob.${table}`, [], null, 'anon'), /permission denied/)
  await assert.rejects(call('bob_volunteer_private.task_drawing_scope', [f.project, f.task], 'anon'), /permission denied/)
  await call('bob.revoke_volunteer_access', [f.project, f.link.id, null])
  await assert.rejects(list(f), /Volunteer access is unavailable/); await assert.rejects(read(f, first.items[0].id), /Volunteer access is unavailable/)
  const expired = await fixture(), id = await drawing(expired)
  await pg.query("update bob.volunteer_links set expires_at=now()-interval '1 second' where id=$1", [expired.link.id])
  await assert.rejects(read(expired, id), /Volunteer access is unavailable/)
})
