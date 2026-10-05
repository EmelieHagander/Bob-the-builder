import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { parameterPlan } from './support/cad-parameter-fixture.ts'
import { compileCadParameters } from '../supabase/functions/_shared/cad-parameters.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'

test('construction blanks use ordinary receipts and material revisions; lineage, duplicate, authority, allocation and stale-source guards', async t => {
 const pg = await projectSchema(); t.after(() => pg.close())
 const user = randomUUID(), other = randomUUID(), message = 'Save concept blanks from this construction. No stock reservation or Shopping.'
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [user, 'k4@test.example', other, 'k4-other@test.example'])
 const call = async (name: string, args: any[], uid: string | null = user, role = 'authenticated'): Promise<any> =>
  (await asProjectUser(pg, uid, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
 const project = (await call('bob.create_project', [JSON.stringify({ name: 'K4 isolated fixture' })])).id
 const solution = randomUUID()
 await call('bob.solution_command', [project, 'create', solution, 0, JSON.stringify({ area_id: null, title: 'Concept bracket', description: 'Fixture', assumptions: 'Product unknown', tradeoffs: 'Synthetic', measurements: [] })])
 await call('bob.solution_command', [project, 'select', solution, 0, JSON.stringify({ solution_revision: 1, reason: 'Fixture' })])
 let turn = randomUUID(), claim = await call('bob.bob_claim_turn', [project, user, turn, message], null, 'service_role')
 const write = (payload: any) => call('bob.bob_project_write_v14', [project, claim.thread_id, turn, claim.generation, JSON.stringify(payload)])
 const base = { record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: 'Save concept blanks' }
 const material = await write({ ...base, kind: 'catalog', data: { action: 'ensure', key: 'material', kind: 'material', name: 'Plywood 18', aliases: [], profile_code: 'sheet_stock', profile_revision: 1, categories: ['wood.plywood', 'sheet'],
  properties: { thickness: { value: '18', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' } }, material_id: null, material_revision: null, notes: '', source_kind: 'design_choice', source_quote: 'concept blanks', source_seq: null } })
 const placement = (x: number, z: number) => ({ x, y: 0, z, rx: 0, ry: 0, rz: 0 })
 const recipe: any = { contract_version: 1, units: 'mm', assembly_id: 'bracket', definitions: [
  { id: 'base', primitive: 'box', material_ref: null, x_mm: 200, y_mm: 100, z_mm: 18 },
  { id: 'upright', primitive: 'box', material_ref: null, x_mm: 18, y_mm: 100, z_mm: 100 }], instances: [
  { id: 'foot', definition_id: 'base', placement: placement(0, 0) }, { id: 'back', definition_id: 'upright', placement: placement(0, 18) }], views: ['front'] }
 const data: any = { key: 'construction', title: 'Two-part bracket', description: 'Concept fixture', area_id: null, target_revision: 1, change_note: 'Fixture', recipe,
  parameters: compileCadParameters(project, recipe, parameterPlan(recipe), new Map(), new Map()),
  materials: recipe.definitions.map((d: any) => ({ definition_id: d.id, material_id: material.recordId, material_revision: 1, part_id: null, part_revision: null })),
  joints: [{ id: 'join', method: 'glued_butt', first: { instance_id: 'foot', face: 'z_max' }, second: { instance_id: 'back', face: 'z_min' }, reason: 'Concept only' }], open_questions: ['Adhesive and raw stock unverified'] }
 const construction = await write({ ...base, kind: 'construction', data })
 const fields: any = { name: 'Base blank', category: 'Timber', area_id: null, task_id: null, waste_percent: '0', purchase_increment: '1', assumptions: 'Concept only',
  artifact_id: construction.recordId, artifact_revision: 1, target_revision: 1, definition_id: 'base', quantity_mode: 'pieces', stock_allocations: [], component_allocations: [], change_note: 'Counted blank' }
 const payload: any = { ...base, kind: 'operational', data: { resource: 'cad_requirement', action: 'create', fields } }
 let requirement: any
 await t.test('canonical write receipt and independent caller read pin quantity, local cut dimensions, material and actual instance', async () => {
  requirement = await write(payload); assert(requirement.recordId); assert.equal(requirement.revision, 1)
  assert.deepEqual(await write(payload), requirement)
  const record = (await call('bob.read_project_work', [project, JSON.stringify({ resource: 'requirement', record_id: requirement.recordId, after_id: null })])).records[0]
  assert.equal(record.required_quantity, 1); assert.equal(record.method_key, 'construction_blank_pieces'); assert.equal(record.method_version, '1')
  assert.equal(record.artifact_id, construction.recordId); assert.equal(record.artifact_revision, 1); assert.match(record.basis, /200 x 100 x 18/)
  const source: any = (await asProjectUser(pg, user, 'select * from bob.material_requirement_construction_sources where requirement_id=$1', [requirement.recordId])).rows[0]
  assert.deepEqual(source.instance_ids, ['foot']); assert.deepEqual(source.blank_mm, { x: 200, y: 100, z: 18 }); assert.equal(source.material_binding.material_id, material.recordId)
 })
 await t.test('second paid-turn create cannot duplicate an active need; forged quantities, stock allocation and publish cannot pass', async () => {
  const helper = (f: any, uid = user) => call('bob.material_requirement_cad_command', [project, 'create', randomUUID(), 0, JSON.stringify(f)], uid)
  await assert.rejects(helper(fields), /construction_requirement_exists/)
  await assert.rejects(helper({ ...fields, required_quantity: '999' }), /invalid_cad_requirement/)
  await assert.rejects(helper({ ...fields, stock_allocations: [{ id: randomUUID(), revision: 1, quantity: '1' }] }), /construction_cut_fit_required/)
  await assert.rejects(call('bob.material_requirement_command', [project, 'publish', requirement.recordId, 1, '{}']), /construction_cut_fit_required/)
  assert.equal((await pg.query('select count(*)::int n from bob.materials where project_id=$1', [project])).rows[0].n, 0)
  assert.equal((await pg.query('select count(*)::int n from bob.material_requirement_stock where project_id=$1', [project])).rows[0].n, 0)
  const writer = createProjectWriter(project, message, async () => ({ data: null, error: { code: '22023', message: 'construction_cut_fit_required PRIVATE' } }), async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const rejected = await writer.commit(payload); assert.equal(rejected.status, 'invalid'); assert.match(rejected.message!, /Raw-stock/); assert(!JSON.stringify(rejected).includes('PRIVATE'))
 })
 await t.test('outsider/guest cannot read provenance or derive; authenticated API has select only and invoker views', async () => {
  assert.equal((await asProjectUser(pg, other, 'select * from bob.material_requirement_construction_sources')).rows.length, 0)
  await assert.rejects(call('bob.material_requirement_cad_command', [project, 'create', randomUUID(), 0, JSON.stringify(fields)], other), /project_denied/)
  await assert.rejects(call('bob.material_requirement_cad_command', [project, 'create', randomUUID(), 0, JSON.stringify(fields)], null, 'anon'), /permission denied/)
  await assert.rejects(asProjectUser(pg, user, 'delete from bob.material_requirement_construction_sources'), /permission denied/)
  const views: any = (await pg.query("select reloptions from pg_class where oid='bob.current_material_requirements'::regclass")).rows[0]; assert(views.reloptions.includes('security_invoker=true'))
 })
 await t.test('changed construction marks the need stale; revise the same need to the new source, keeping old history and dimensions', async () => {
  const changed = structuredClone(data); changed.key = 'construction2'; changed.recipe.definitions[0].x_mm = 250
  changed.parameters = compileCadParameters(project, changed.recipe, parameterPlan(changed.recipe), new Map(), new Map())
  await write({ ...base, kind: 'construction', record_id: construction.recordId, expected_revision: 1, data: changed })
  const current = async () => (await asProjectUser(pg, user, 'select * from bob.current_material_requirements where id=$1', [requirement.recordId])).rows[0] as any
  assert.equal((await current()).artifact_changed, true)
  await assert.rejects(call('bob.material_requirement_cad_command', [project, 'revise', requirement.recordId, 1, JSON.stringify(fields)]), /construction_source_changed/)
  const next = await call('bob.material_requirement_cad_command', [project, 'revise', requirement.recordId, 1, JSON.stringify({ ...fields, artifact_revision: 2 })])
  assert.equal(next.revision, 2); assert.equal((await current()).artifact_changed, false)
  const history: any[] = (await asProjectUser(pg, user, 'select * from bob.material_requirement_construction_sources where requirement_id=$1 order by requirement_revision', [requirement.recordId])).rows as any[]
  assert.deepEqual(history.map(h => h.blank_mm.x), [200, 250]); assert.deepEqual(history.map(h => h.artifact_revision), [1, 2])
  await assert.rejects(call('bob.material_requirement_cad_command', [project, 'revise', requirement.recordId, 2, JSON.stringify({ ...fields, artifact_revision: 2, definition_id: 'upright' })]), /construction_requirement_identity_changed/)
 })
 await t.test('catalog change without a construction revision still marks the saved need stale and stops derivation', async () => {
  await call('bob.bob_fail_turn_v2', [project, user, claim.thread_id, turn, claim.generation], null, 'service_role')
  turn = randomUUID(); claim = await call('bob.bob_claim_turn', [project, user, turn, message], null, 'service_role')
  const original: any = (await call('bob.catalog_read', [project, JSON.stringify({ action: 'read', id: material.recordId, revision: 1, kind: null, query: null, after: null, profile_code: null, categories: [], properties: {} })])).record
  await write({ ...base, kind: 'catalog', record_id: material.recordId, expected_revision: 1, data: { action: 'revise', key: 'newmaterial', kind: 'material', name: original.name, aliases: original.aliases, profile_code: original.profile_code, profile_revision: original.profile_revision, categories: original.categories,
   properties: { ...original.properties, thickness: { value: '21', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' } }, material_id: null, material_revision: null, notes: original.notes, source_kind: 'design_choice', source_quote: 'concept blanks', source_seq: null } })
  const current: any = (await asProjectUser(pg, user, 'select * from bob.current_material_requirements where id=$1', [requirement.recordId])).rows[0]
  assert.equal(current.artifact_changed, true); assert.equal(current.artifact_revision, 2)
  await assert.rejects(call('bob.material_requirement_cad_command', [project, 'revise', requirement.recordId, 2, JSON.stringify({ ...fields, artifact_revision: 2 })]), /construction_source_changed/)
  const old: any = (await asProjectUser(pg, user, 'select * from bob.material_requirement_revisions where requirement_id=$1 and revision=1', [requirement.recordId])).rows[0]
  assert.equal(Number(old.required_quantity), 1); assert.match(old.basis, /200 x 100 x 18/)
 })
})
