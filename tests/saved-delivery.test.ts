import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBuildPreparation } from '../src/data/buildPreparation.ts'
import { createMaterialPlanning } from '../src/data/materialPlanning.ts'
import { savedCutSheets } from '../src/domain/savedCutPlan.ts'
import { savedOutputPointer, savedOutputSourcePointer, savedOutputUrl } from '../src/lib/savedOutputNavigation.ts'
import { cutPlanFixture } from './support/cut-plan-fixture.ts'

test('saved output URLs retain exact source/output versions after navigation and reject incomplete pointers', () => {
  const id = randomUUID(), source = { id: randomUUID(), revision: 4, areaId: randomUUID() }
  for (const kind of ['requirements', 'cut_plans'] as const) {
    const url = new URL(savedOutputUrl(kind, id, 2, source), 'https://fixture.invalid')
    assert.equal(url.pathname, kind === 'requirements' ? '/material-plan' : '/build-lists')
    const params = new URLSearchParams(url.search), key = kind === 'requirements' ? 'requirement' : 'cut_plan'
    assert.deepEqual(savedOutputPointer(params, key), { id, revision: 2 })
    assert.deepEqual(savedOutputSourcePointer(params), { id: source.id, revision: 4 })
    assert.equal(params.get('area'), source.areaId)
    for (const bad of ['', '0', '-1', '2.5', 'NaN', '1e2', '1000000000']) {
      params.set('revision', bad); assert.equal(savedOutputPointer(params, key), null)
    }
    params.set('revision', '2'); params.set(key, 'not-an-id'); assert.equal(savedOutputPointer(params, key), null)
    params.delete('source_revision'); assert.equal(savedOutputSourcePointer(params), null)
  }
})

test('delivery read boundary preserves source, page cursor, honest historical state and active-project guards', async () => {
  const project = randomUUID(), artifact = randomUUID(), id = randomUUID()
  const page = { status: 'ok', projectId: project, artifact_id: artifact, revision: 2, current_revision: 3,
    source_state: 'changed', description: 'Saved description', resource: 'drawings', index_only: true,
    records: [{ id, revision: 1, current_revision: 2, title: 'Saved drawing', archived: false,
      step_links: [{ step_id: randomUUID(), in_current_plan: false }], source: { artifact_id: artifact, revision: 2 } }],
    truncated: true, next_after: id }
  let result: any = page, allowed = true, revokeOnRead = false, calls = 0
  const cursor = randomUUID()
  const client = { rpc: async (name: string, args: unknown) => {
    calls++; assert.equal(name, 'read_construction_delivery')
    assert.deepEqual(args, { p_project: project, p_artifact: artifact, p_revision: 2, p_resource: 'drawings', p_after: cursor })
    if (revokeOnRead) allowed = false
    return { data: result, error: null }
  } }
  const reader = createBuildPreparation(client as any, p => { assert.equal(p, project); return () => { if (!allowed) throw Error('project_changed') } })
  const read = () => reader.delivery(project, artifact, 2, 'drawings', cursor)
  assert.deepEqual(await read(), page)
  const mutations = [
    (p: any) => { p.projectId = randomUUID() }, (p: any) => { p.revision = 3 },
    (p: any) => { p.records[0].source.revision = 3 }, (p: any) => { p.resource = 'requirements' },
    (p: any) => { p.records[0].step_links = {} }, (p: any) => { p.records[0].title = {} },
    (p: any) => { p.next_after = cursor }, (p: any) => { p.next_after = null },
    (p: any) => { p.records = [] }, (p: any) => { p.records[0].current_revision = 0 },
  ]
  for (const mutate of mutations) { result = structuredClone(page); mutate(result); await assert.rejects(read()) }
  result = { ...page, records: [], truncated: false, next_after: null }; assert.deepEqual(await read(), result)
  allowed = false; const count = calls; await assert.rejects(read(), /project_changed/); assert.equal(calls, count)
  allowed = true; revokeOnRead = true; result = page; await assert.rejects(read(), /project_changed/)
})

test('real saved cut layout reopens through the UI facade at its exact revision without writes or refitting', async t => {
  const f = await cutPlanFixture(t), receipt = await f.write(f.payload)
  let result = await f.read(receipt.recordId, 1), allowed = true, revokeOnRead = false
  const client = { rpc: async (name: string, args: any) => {
    assert.equal(name, 'read_material_cut_plan')
    assert.deepEqual(args, { p_project: f.project, p_plan: receipt.recordId, p_revision: 1 })
    if (revokeOnRead) allowed = false
    return { data: result, error: null }
  } }
  const reader = createMaterialPlanning(client as any, project => { assert.equal(project, f.project); return () => { if (!allowed) throw Error('project_changed') } })
  const read = () => reader.cutPlanVersion(f.project, receipt.recordId, 1)
  const saved = await read(), before = JSON.stringify(saved), source = { id: f.construction.recordId, revision: 1 }
  const sheets = savedCutSheets(saved, source)
  assert.equal(sheets.length, 1); assert.equal(sheets[0].kind, 'hypothetical'); assert.equal(sheets[0].parts.length, 2)
  assert.equal(sheets[0].length, 2440); assert.equal(sheets[0].kerf, 3)
  assert.deepEqual(sheets[0].parts.map(p => [p.x, p.y, p.length, p.width]),
    saved.layout.placements.map((p: any) => [p.x_mm, p.y_mm, p.length_mm, p.width_mm]))
  assert.equal(sheets[0].cuts.length, saved.layout.cuts.length); assert.equal(sheets[0].offcuts.length, saved.layout.offcuts.length)
  assert.equal(JSON.stringify(saved), before)
  assert.throws(() => savedCutSheets(saved, { ...source, revision: 2 }))
  for (const mutation of [
    (p: any) => { p.layout.used_sheets.push('unknown:1') }, (p: any) => { p.layout.placements[0].sheet_id = 'unknown:1' },
    (p: any) => { p.layout.placements[0].x_mm = Infinity }, (p: any) => { p.layout.placements[0].length_mm = -1 },
    (p: any) => { p.layout.placements.push(p.layout.placements[0]) }, (p: any) => { p.layout.cuts[0].axis = 'z' },
    (p: any) => { p.candidate_sources = [] }, (p: any) => { p.candidates.push(p.candidates[0]) },
  ]) { const invalid = structuredClone(saved); mutation(invalid); assert.throws(() => savedCutSheets(invalid, source)) }
  // Historical layouts remain readable; the renderer must retain the source warning.
  assert.equal(savedCutSheets({ ...saved, source_state: 'changed', current_revision: 2 }, source).length, 1)
  for (const patch of [{ project_id: f.other }, { id: randomUUID() }, { revision: 2 }]) {
    result = { ...saved, ...patch }; await assert.rejects(read())
  }
  result = saved; revokeOnRead = true; await assert.rejects(read(), /project_changed/)
  assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1', [f.project])).rows[0].n, 0)
})
