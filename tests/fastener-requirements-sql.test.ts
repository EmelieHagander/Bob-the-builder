// Fastener and glue needs on the material list (owner decisions 2026-10-26,
// B3): one need per schedule group (kind and size), one glue package per
// construction, buyable through Shopping and pack purchases while blank needs
// keep their guards. Rule-of-thumb proposals, not a strength calculation.
// The need is the exact schedule count, without a waste allowance (owner
// decision 2026-10-26, 20261026190000_exact_fastener_needs.sql).
import { designIntent } from './support/design-intent-fixture.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { parameterPlan } from './support/cad-parameter-fixture.ts'
import { manufacturePolicy } from './support/construction-instance-policy-fixture.ts'
import { compileCadParameters } from '../supabase/functions/_shared/cad-parameters.ts'
import { humanTextIssues } from '../supabase/functions/_shared/human-text.ts'

const message = 'Put the screws, nails and glue for the shelf unit on the material list and Shopping.'
const box = (id: string, x: number, y: number, z: number) => ({ id, primitive: 'box', material_ref: null, x_mm: x, y_mm: y, z_mm: z })
const at = (id: string, definition_id: string, x: number, z: number) => ({ id, definition_id, placement: { x, y: 0, z, rx: 0, ry: 0, rz: 0 } })
const joint = (id: string, method: string, first: [string, string], second: [string, string], extra: Record<string, unknown> = {}) =>
 ({ id, method, first: { instance_id: first[0], face: first[1] }, second: { instance_id: second[0], face: second[1] }, reason: 'Fixture joint', ...extra })
const nails = { kind: 'nail', diameter_mm: 2.8, length_mm: 50, count: null, spacing_mm: null, reason: 'Owner prefers nails here' }

/** Two 18 mm gables and three shelves 300 deep: two screwed joints (4 x 45,
 * three each), one glued, one nailed by override and one dowel without a rule. */
function shelfUnit(depth = 300, nailed = true) {
 const recipe: any = { contract_version: 1, units: 'mm', assembly_id: 'shelf_unit', views: ['front'],
  definitions: [box('gable', 18, depth, 800), box('shelf', 564, depth, 18)],
  instances: [at('left', 'gable', 0, 0), at('right', 'gable', 582, 0), at('middle', 'shelf', 18, 400), at('bottom', 'shelf', 18, 0), at('top', 'shelf', 18, 700)] }
 const joints = [
  joint('left_middle', 'screwed_butt', ['left', 'x_max'], ['middle', 'x_min']),
  joint('middle_right', 'screwed_butt', ['middle', 'x_max'], ['right', 'x_min']),
  joint('left_bottom', 'glued_butt', ['left', 'x_max'], ['bottom', 'x_min']),
  joint('bottom_right', 'screwed_butt', ['bottom', 'x_max'], ['right', 'x_min'], nailed ? { fastener: nails } : {}),
  joint('left_top', 'dowel', ['left', 'x_max'], ['top', 'x_min']),
 ]
 return { recipe, joints }
}

async function fixture(t: any) {
 const pg = await projectSchema(); t.after(() => pg.close())
 const user = randomUUID(), other = randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [user, 'fasteners@test.example', other, 'fasteners-other@test.example'])
 const call = async (name: string, args: any[], uid: string | null = user, role = 'authenticated'): Promise<any> =>
  (await asProjectUser(pg, uid, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
 const project = (await call('bob.create_project', [JSON.stringify({ name: 'Fastener needs fixture' })])).id
 const solution = randomUUID()
 await call('bob.solution_command', [project, 'create', solution, 0, JSON.stringify({ area_id: null, title: 'Shelf unit', description: 'Fixture', assumptions: 'Products unknown', tradeoffs: 'Synthetic', measurements: [], design_intent: designIntent() })])
 await call('bob.solution_command', [project, 'select', solution, 0, JSON.stringify({ solution_revision: 1, reason: 'Fixture' })])
 const session = { turn: randomUUID(), claim: null as any }
 session.claim = await call('bob.bob_claim_turn', [project, user, session.turn, message], null, 'service_role')
 const newTurn = async () => {
  await call('bob.bob_fail_turn_v2', [project, user, session.claim.thread_id, session.turn, session.claim.generation], null, 'service_role')
  session.turn = randomUUID(); session.claim = await call('bob.bob_claim_turn', [project, user, session.turn, message], null, 'service_role')
 }
 const binding = () => [project, session.claim.thread_id, session.turn, session.claim.generation]
 const write = (payload: any) => call('bob.bob_project_write_v16', [...binding(), JSON.stringify(payload)])
 const base = { record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: 'Put the screws, nails and glue' }
 const material = await write({ ...base, kind: 'catalog', data: { action: 'ensure', key: 'plywood', kind: 'material', name: 'Plywood 18', aliases: [], profile_code: 'sheet_stock', profile_revision: 1, categories: ['wood.plywood', 'sheet'],
  properties: { thickness: { value: '18', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' } }, material_id: null, material_revision: null, notes: '', source_kind: 'design_choice', source_quote: 'screws, nails and glue', source_seq: null } })
 const constructionData = (depth: number, nailed: boolean, key: string) => {
  const { recipe, joints } = shelfUnit(depth, nailed)
  return { key, title: 'Shelf unit', description: 'Concept fixture', area_id: null, target_revision: 1, change_note: 'Fixture', recipe,
   parameters: compileCadParameters(project, recipe, parameterPlan(recipe), new Map(), new Map()),
   materials: recipe.definitions.map((d: any) => ({ definition_id: d.id, material_id: material.recordId, material_revision: 1, part_id: null, part_revision: null })),
   joints, open_questions: ['Fastener products unverified'], instance_policy: manufacturePolicy(recipe) }
 }
 const construction = await write({ ...base, kind: 'construction', data: constructionData(300, true, 'construction') })
 const fields = (patch: Record<string, unknown> = {}): any => ({ name: 'Screws 4 x 45', category: 'Fasteners & glue', area_id: null, task_id: null, waste_percent: '0', purchase_increment: '1',
  assumptions: 'Rule of thumb', artifact_id: construction.recordId, artifact_revision: 1, target_revision: 1, stock_allocations: [], component_allocations: [], change_note: 'From the joint schedule',
  quantity_mode: 'fasteners', fastener_kind: 'screw', diameter_mm: 4, length_mm: 45, ...patch })
 const glue = (patch: Record<string, unknown> = {}) => { const f = fields({ name: 'Wood glue', quantity_mode: 'glue', ...patch }); delete f.fastener_kind; delete f.diameter_mm; delete f.length_mm; return f }
 const derive = (f: any, action = 'create', id: string = randomUUID(), expected = 0, uid = user) => call('bob.material_requirement_cad_command', [project, action, id, expected, JSON.stringify(f)], uid)
 const need = async (id: string) => (await asProjectUser(pg, user, 'select * from bob.current_material_requirements where id=$1', [id])).rows[0] as any
 const sources = async (id: string) => (await asProjectUser(pg, user, 'select * from bob.material_requirement_fastener_sources where requirement_id=$1 order by requirement_revision', [id])).rows as any[]
 return { pg, call, user, other, project, write, base, newTurn, binding, material, construction, constructionData, fields, glue, derive, need, sources }
}

test('derive saves one need per fastener group and one glue package; unsized joints stay uncounted gaps', async t => {
 const f = await fixture(t)
 const schedule = await f.call('bob.read_construction_fasteners', [f.project, f.construction.recordId, 1])
 assert.equal(schedule.complete, false)
 assert.deepEqual(schedule.totals.map((r: any) => [r.kind, r.diameter_mm, r.length_mm, r.count]), [['nail', 2.8, 50, 3], ['screw', 4.0, 45, 6]])
 assert.equal(schedule.glue_packages, 1)

 const payload = { ...f.base, kind: 'operational', data: { resource: 'cad_requirement', action: 'create', fields: f.fields() } }
 const screws = await f.write(payload)
 assert.equal(screws.dataset, 'requirements'); assert.equal(screws.revision, 1)
 assert.deepEqual(await f.write(payload), screws, 'an exact retry returns the saved receipt')
 const record = (await f.call('bob.read_project_work', [f.project, JSON.stringify({ resource: 'requirement', record_id: screws.recordId, after_id: null })])).records[0]
 assert.equal(Number(record.required_quantity), 6); assert.equal(record.unit, 'pcs'); assert.equal(Number(record.purchase_quantity), 6)
 assert.equal(record.source_kind, 'deterministic'); assert.equal(record.method_key, 'construction_fasteners'); assert.equal(record.method_version, '1')
 assert.equal(record.artifact_id, f.construction.recordId); assert.equal(record.artifact_changed, false)
 assert.equal(record.basis, 'Counted from the saved construction "Shelf unit": 6 screws of 4 x 45 mm over 2 joints, from the joint fastener schedule. A rule-of-thumb proposal, not a strength calculation; the product, pilot holes and edge distances are still open. 1 other joint has no fastener size or rule yet and is not counted.')
 assert.deepEqual(humanTextIssues(record.basis), [])
 const [source] = await f.sources(screws.recordId)
 assert.deepEqual({ ...source, diameter_mm: Number(source.diameter_mm), length_mm: Number(source.length_mm) }, { project_id: f.project, requirement_id: screws.recordId, requirement_revision: 1,
  artifact_id: f.construction.recordId, artifact_revision: 1, rule_version: 'fastener-rules-v1', kind: 'screw', diameter_mm: 4, length_mm: 45, quantity: 6,
  joint_ids: ['left_middle', 'middle_right'], schedule_complete: false })

 const nailId = randomUUID()
 await f.derive(f.fields({ name: 'Nails 2.8 x 50', fastener_kind: 'nail', diameter_mm: 2.8, length_mm: 50 }), 'create', nailId)
 assert.equal(Number((await f.need(nailId)).required_quantity), 3)
 assert.match((await f.need(nailId)).basis, /: 3 nails of 2\.8 x 50 mm over 1 joint, from the joint fastener schedule\./)
 const glueId = randomUUID()
 await f.derive(f.glue(), 'create', glueId)
 const glued = await f.need(glueId)
 assert.equal(Number(glued.required_quantity), 1); assert.equal(glued.unit, 'pcs'); assert.equal(glued.method_key, 'construction_glue')
 assert.match(glued.basis, /^One glue package for the saved construction "Shelf unit", which has 1 glued joint\. /); assert.deepEqual(humanTextIssues(glued.basis), [])
 assert.deepEqual((await f.sources(glueId)).map(s => [s.kind, s.diameter_mm, s.length_mm, s.quantity, s.joint_ids]), [['glue', null, null, 1, ['left_bottom']]])

 // One active need per construction and group; sizes come only from the schedule.
 await assert.rejects(f.derive(f.fields({ name: 'More screws' })), /fastener_requirement_exists/)
 await assert.rejects(f.derive(f.glue({ name: 'Second glue' })), /fastener_requirement_exists/)
 await assert.rejects(f.derive(f.fields({ name: 'Wrong size', diameter_mm: 5, length_mm: 50 })), /fastener_group_not_in_schedule/)
 await assert.rejects(f.derive(f.fields({ name: 'Forged', required_quantity: '99' })), /invalid_cad_requirement/)
 await assert.rejects(f.derive(f.fields({ name: 'Staples', fastener_kind: 'staple' })), /invalid_cad_requirement/)
 await assert.rejects(f.derive(f.fields({ name: 'Text size', diameter_mm: '4' })), /invalid_cad_requirement/)
 await assert.rejects(f.derive({ ...f.glue({ name: 'Sized glue' }), diameter_mm: 4 }), /invalid_cad_requirement/)
 await assert.rejects(f.derive(f.fields({ name: 'Size change' }), 'revise', nailId, 1), /construction_requirement_identity_changed/)
 // Manual edits cannot strip the typed provenance; blank derivation cannot take it over.
 await assert.rejects(f.call('bob.material_requirement_command', [f.project, 'revise', glueId, 1, JSON.stringify({ name: 'Glue', category: 'Fasteners & glue', area_id: null, task_id: null, unit: 'pcs', required_quantity: '3', waste_percent: '0', purchase_increment: '1', basis: 'Manual', assumptions: '', artifact_id: f.construction.recordId, artifact_revision: 1, target_revision: 1, stock_allocations: [], component_allocations: [], change_note: 'Manual' })]), /construction_derive_required/)
 const blank = { ...f.fields({ name: 'Shelf blank', category: 'Timber', definition_id: 'shelf', quantity_mode: 'pieces' }) }
 delete blank.fastener_kind; delete blank.diameter_mm; delete blank.length_mm
 await assert.rejects(f.derive(blank, 'revise', glueId, 1), /construction_requirement_identity_changed/)

 // Archive/restore carries the provenance; a restored duplicate is fenced.
 assert.equal((await f.call('bob.material_requirement_command', [f.project, 'archive', glueId, 1, '{}'])).revision, 2)
 assert.equal((await f.sources(glueId))[1].requirement_revision, 2)
 const replacement = randomUUID()
 await f.derive(f.glue({ name: 'Replacement glue' }), 'create', replacement)
 await assert.rejects(f.call('bob.material_requirement_command', [f.project, 'restore', glueId, 2, '{}']), /fastener_requirement_exists/)
 await f.call('bob.material_requirement_command', [f.project, 'archive', replacement, 1, '{}'])
 assert.equal((await f.call('bob.material_requirement_command', [f.project, 'restore', glueId, 2, '{}'])).revision, 3)
 assert.deepEqual((await f.sources(glueId)).map(s => [s.requirement_revision, s.kind, s.quantity]), [[1, 'glue', 1], [2, 'glue', 1], [3, 'glue', 1]])
})

test('fastener needs reach Shopping, stock and pack purchases; blank needs of the same construction keep their guards', async t => {
 const f = await fixture(t)
 const screws = randomUUID(), nailsId = randomUUID(), blankId = randomUUID()
 // Leftover screws of the same size reduce the purchase through the derive path.
 const stock = randomUUID()
 await f.call('bob.stock_command', [f.project, 'create', stock, 0, JSON.stringify({ name: 'Leftover screws 4 x 45', specification: 'Counted box', quantity: '4', unit: 'pcs', status: 'available', area_id: null, notes: 'Declared by member', change_note: 'Fixture' })])
 await f.derive(f.fields({ stock_allocations: [{ id: stock, revision: 1, quantity: '4' }] }), 'create', screws)
 const screwNeed = await f.need(screws)
 assert.equal(Number(screwNeed.stock_quantity), 4); assert.equal(Number(screwNeed.purchase_quantity), 2)
 const published = await f.call('bob.material_requirement_command', [f.project, 'publish', screws, 1, '{}'])
 const row = (await f.pg.query('select * from bob.materials where id=$1', [published.material_id])).rows[0] as any
 assert.equal(row.qty, '2 pcs'); assert.equal(row.name, 'Screws 4 x 45'); assert.equal(row.status, 'needed'); assert.equal(row.category_icon, 'nut')

 const blank = { ...f.fields({ name: 'Shelf blank', category: 'Timber', definition_id: 'shelf', quantity_mode: 'pieces' }) }
 delete blank.fastener_kind; delete blank.diameter_mm; delete blank.length_mm
 await f.derive(blank, 'create', blankId)
 await assert.rejects(f.call('bob.material_requirement_command', [f.project, 'publish', blankId, 1, '{}']), /construction_cut_fit_required/)
 await assert.rejects(f.derive({ ...blank, name: 'Allocated blank', stock_allocations: [{ id: stock, revision: 1, quantity: '1' }] }, 'revise', blankId, 1), /construction_cut_fit_required/)

 // A pack purchase aggregates the nails need; the blank need cannot join it.
 await f.derive(f.fields({ name: 'Nails 2.8 x 50', fastener_kind: 'nail', diameter_mm: 2.8, length_mm: 50 }), 'create', nailsId)
 const nail = await f.write({ ...f.base, kind: 'catalog', data: { action: 'ensure', key: 'nail', kind: 'material', name: 'Nail 2.8 x 50', aliases: [], profile_code: 'fastener', profile_revision: 1, categories: ['metal', 'fastener'],
  properties: { diameter: { value: '2.8', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' }, length: { value: '50', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' } },
  material_id: null, material_revision: null, notes: 'Generic definition, no SKU', source_kind: 'user_statement', source_quote: 'screws, nails and glue', source_seq: null } })
 const article = randomUUID()
 await f.call('bob.supplier_article_command', [f.project, 'create', article, 0, JSON.stringify({ catalog_item_id: nail.recordId, catalog_item_revision: 1, title: 'Nail 2.8 x 50', supplier: 'Fixture supplier', manufacturer: '', article_number: 'N-2850', variant: 'Bright',
  source_url: 'https://supplier.test.example/n-2850', source_document: '', source_version: '2026-10', source_date: '2026-10-01', supported_fields: ['title', 'article_number', 'purchase_unit', 'content_per_purchase_unit', 'content_unit'],
  purchase_unit: 'pack', content_per_purchase_unit: '100', content_unit: 'pcs', notes: 'Synthetic test article', change_note: 'Bind source' })])
 await assert.rejects(f.call('bob.pack_purchase_command', [f.project, 'publish', article, 1, 0, JSON.stringify([{ id: blankId, revision: 1 }]), 'Blanks are not packs']), /pack_construction_blank/)
 const pack = await f.call('bob.pack_purchase_command', [f.project, 'publish', article, 1, 0, JSON.stringify([{ id: nailsId, revision: 1 }]), 'Nails as one pack'])
 assert.equal(pack.purchase_count, 1); assert.equal(Number(pack.total_quantity), 3); assert.equal(Number(pack.surplus_quantity), 97)
 await assert.rejects(f.call('bob.material_requirement_command', [f.project, 'publish', nailsId, 1, '{}']), /pack_requirement_claimed/)
})

test('fastener and glue needs are exact: a waste allowance is refused; absent or 0 is stored as 0 on create and revise', async t => {
 // Owner decision 2026-10-26: show the exact count; Bob may recommend a spare in words.
 const f = await fixture(t)
 const screws = randomUUID(), glueId = randomUUID(), nailsId = randomUUID()
 const stored = async (id: string) => { const n = await f.need(id); return [n.required_quantity, n.waste_percent, n.required_with_waste, n.purchase_quantity].map(Number) }
 const without = (fields: any) => { const copy = { ...fields }; delete copy.waste_percent; return copy }
 const exact = (e: any) => e.code === '22023' && /fastener_quantity_exact/.test(e.message)
 for (const waste_percent of ['10', 5, '0.001', '-2', 'ten', ''])
  await assert.rejects(f.derive(f.fields({ waste_percent }), 'create', screws), exact, JSON.stringify(waste_percent))
 await assert.rejects(f.derive(f.glue({ waste_percent: '10' }), 'create', glueId), exact)
 assert.equal(await f.need(screws), undefined); assert.equal(await f.need(glueId), undefined)
 // Absent or null is accepted and stored as 0: the need is the schedule count.
 await f.derive(without(f.fields()), 'create', screws)
 assert.deepEqual(await stored(screws), [6, 0, 6, 6])
 await f.derive(f.glue({ waste_percent: null }), 'create', glueId)
 assert.deepEqual(await stored(glueId), [1, 0, 1, 1])
 // Revise follows the same rule.
 await assert.rejects(f.derive(f.fields({ waste_percent: '15' }), 'revise', screws, 1), exact)
 await assert.rejects(f.derive(f.glue({ waste_percent: 100 }), 'revise', glueId, 1), exact)
 assert.equal((await f.derive(f.fields({ waste_percent: '0.000' }), 'revise', screws, 1)).revision, 2)
 assert.equal((await f.derive(without(f.fields()), 'revise', screws, 2)).revision, 3)
 assert.equal((await f.derive(f.glue({ waste_percent: 0 }), 'revise', glueId, 1)).revision, 2)
 assert.deepEqual(await stored(screws), [6, 0, 6, 6]); assert.deepEqual(await stored(glueId), [1, 0, 1, 1])
 // A pack size buys whole packs; it is not waste, and the need stays exact.
 await f.derive(f.fields({ name: 'Nails 2.8 x 50', fastener_kind: 'nail', diameter_mm: 2.8, length_mm: 50, purchase_increment: '100' }), 'create', nailsId)
 assert.deepEqual(await stored(nailsId), [3, 0, 3, 100])
 // Bob's claimed-turn writer surfaces the same specific refusal.
 await assert.rejects(f.write({ ...f.base, kind: 'operational', data: { resource: 'cad_requirement', action: 'create', fields: f.fields({ name: 'Screws with spare', waste_percent: '10' }) } }), exact)
 // Blank needs keep their allowance; the rule covers only fastener and glue modes.
 const blank = { ...f.fields({ name: 'Shelf blank', category: 'Timber', definition_id: 'shelf', quantity_mode: 'pieces', waste_percent: '10' }) }
 delete blank.fastener_kind; delete blank.diameter_mm; delete blank.length_mm
 const blankId = randomUUID()
 await f.derive(blank, 'create', blankId)
 assert.equal(Number((await f.need(blankId)).waste_percent), 10)
})

test('a construction change makes fastener needs stale; continuation and re-derive revise the same needs or retire a vanished group', async t => {
 const f = await fixture(t)
 const screws = await f.write({ ...f.base, kind: 'operational', data: { resource: 'cad_requirement', action: 'create', fields: f.fields() } })
 const nailsId = randomUUID(), glueId = randomUUID()
 await f.derive(f.fields({ name: 'Nails 2.8 x 50', fastener_kind: 'nail', diameter_mm: 2.8, length_mm: 50 }), 'create', nailsId)
 await f.derive(f.glue(), 'create', glueId)
 // A need saved with an allowance before the exact-count rule (2026-10-26):
 // change work recalculates it exact instead of copying the allowance.
 await f.pg.query('update bob.material_requirement_revisions set waste_percent=10,required_with_waste=6.6,purchase_quantity=7 where requirement_id=$1 and revision=1', [screws.recordId])
 await f.newTurn()
 // Deeper parts and no nail override: four screws per joint, the nail group disappears.
 await f.write({ ...f.base, kind: 'construction', record_id: f.construction.recordId, expected_revision: 1, data: f.constructionData(450, false, 'construction2') })
 for (const id of [screws.recordId, nailsId, glueId]) assert.equal((await f.need(id)).artifact_changed, true, id)
 await assert.rejects(f.call('bob.material_requirement_command', [f.project, 'publish', screws.recordId, 1, '{}']))
 await assert.rejects(f.derive(f.fields(), 'revise', screws.recordId, 1), /construction_source_changed/)

 const work = await f.call('bob.read_construction_changes', [f.project, f.construction.recordId, 2, null])
 const item = (id: string) => work.items.find((i: any) => i.kind === 'requirement' && i.output_id === id)
 for (const id of [screws.recordId, nailsId, glueId]) assert.equal(item(id).state, 'pending')
 const continuation = (id: string, key: string) => ({ ...f.base, kind: 'construction_consequence', record_id: f.construction.recordId, expected_revision: 2,
  data: { key, item_id: item(id).id, action: 'recalculate', review_note: null, output_revision: null, change_note: 'Recalculate after the deeper shelves', computed: null } })
 const prepared = await f.call('bob.prepare_construction_consequence', [...f.binding(), JSON.stringify(continuation(screws.recordId, 'screws'))])
 assert.equal(prepared.status, 'ready'); assert.equal(prepared.kind, 'requirement')
 // The same need, group and decisions at the new construction revision; no quantity input and no allowance.
 assert.deepEqual(prepared.domain.data.fields, { ...f.fields(), waste_percent: '0', purchase_increment: '1.0000', artifact_revision: 2, change_note: 'Recalculate after the deeper shelves' })
 const saved = await f.write(continuation(screws.recordId, 'screws'))
 assert.equal(saved.recordId, screws.recordId); assert.equal(saved.revision, 2)
 assert.deepEqual(await f.write(continuation(screws.recordId, 'screws')), saved)
 const current = await f.need(screws.recordId)
 assert.equal(Number(current.required_quantity), 12); assert.equal(current.artifact_revision, 2); assert.equal(current.artifact_changed, false)
 assert.equal(Number(current.waste_percent), 0); assert.equal(Number(current.purchase_quantity), 12)
 assert.match(current.basis, /: 12 screws of 4 x 45 mm over 3 joints, from the joint fastener schedule\./)
 assert.deepEqual((await f.sources(screws.recordId)).map(s => [s.requirement_revision, s.artifact_revision, s.quantity]), [[1, 1, 6], [2, 2, 12]], 'history keeps the old count')

 const retire = await f.call('bob.prepare_construction_consequence', [...f.binding(), JSON.stringify(continuation(nailsId, 'nails'))])
 assert.equal(retire.kind, 'requirement_retire')
 assert.equal((await f.write(continuation(nailsId, 'nails'))).revision, 2)
 assert.equal((await f.need(nailsId)).archived, true)

 // A direct re-derive on the same need also completes its saved item.
 assert.equal((await f.derive(f.glue({ artifact_revision: 2 }), 'revise', glueId, 1)).revision, 2)
 const after = await f.call('bob.read_construction_changes', [f.project, f.construction.recordId, 2, null])
 const states = Object.fromEntries(after.items.filter((i: any) => i.kind === 'requirement').map((i: any) => [i.output_id, i.state]))
 assert.deepEqual(states, { [screws.recordId]: 'updated', [nailsId]: 'retired', [glueId]: 'updated' })
 assert.equal((await f.call('bob.material_requirement_command', [f.project, 'publish', screws.recordId, 2, '{}'])).revision, 2)
})

test('only project members read or derive fastener needs; provenance and private helpers are not client-writable', async t => {
 const f = await fixture(t)
 const id = randomUUID()
 await f.derive(f.fields(), 'create', id)
 assert.equal((await asProjectUser(f.pg, f.other, 'select * from bob.material_requirement_fastener_sources')).rows.length, 0)
 await assert.rejects(f.derive(f.fields({ name: 'Outsider' }), 'create', randomUUID(), 0, f.other), /project_denied/)
 await assert.rejects(f.call('bob.material_requirement_command', [f.project, 'publish', id, 1, '{}'], f.other), /project_denied/)
 await assert.rejects(f.call('bob.material_requirement_cad_command', [f.project, 'create', randomUUID(), 0, JSON.stringify(f.fields({ name: 'Anon' }))], null, 'anon'), /permission denied/)
 await assert.rejects(asProjectUser(f.pg, f.user, 'delete from bob.material_requirement_fastener_sources'), /permission denied/)
 await assert.rejects(asProjectUser(f.pg, f.user, "update bob.material_requirement_fastener_sources set quantity=99"), /permission denied/)
 for (const fn of ['bob_private.material_requirement_fastener_command(text,text,uuid,integer,jsonb)', 'bob_private.material_requirement_cad_before_fasteners(text,text,uuid,integer,jsonb)',
  'bob_private.fastener_consequence(text,uuid,integer,uuid,integer,jsonb,text)', 'bob_private.fastener_requirement_taken(text,uuid,uuid,text,numeric,numeric)', 'bob_private.complete_fastener_change_output()'])
  for (const role of ['anon', 'authenticated', 'service_role'])
   assert.equal((await f.pg.query("select has_function_privilege($1,$2,'execute') allowed", [role, fn])).rows[0].allowed, false, `${role} ${fn}`)
 const policies = (await f.pg.query("select relrowsecurity from pg_class where oid='bob.material_requirement_fastener_sources'::regclass")).rows[0] as any
 assert.equal(policies.relrowsecurity, true)
})

// Owner decision 2026-11-01: the structural designer adds joint hardware the
// catalog lacks (profile joint_hardware) and its needs reach the material list,
// with or without a size.
test('hardware the designer adds is saved like any definition, held in joints and derived as needs of its own kind', async t => {
 const { catalogFastenerWrite } = await import('../supabase/functions/_shared/material-catalog.ts')
 const f = await fixture(t)
 await f.newTurn()
 const add = async (input: Record<string, unknown>) => {
  const built: any = catalogFastenerWrite({ key: input.kind, name: input.name, kind: input.kind, counting: input.counting, material_category: input.material_category,
   diameter_mm: input.diameter_mm ?? null, length_mm: input.length_mm ?? null, request_quote: 'Put the screws, nails and glue' })
  assert.ok(built && 'payload' in built, JSON.stringify(built))
  return f.write(built.payload)
 }
 const dowel = await add({ name: 'Träplugg, bok 8 × 40', kind: 'dowel', counting: 'along_contact', material_category: 'wood', diameter_mm: 8, length_mm: 40 })
 const bracket = await add({ name: 'Vinkeljärn 40 × 40', kind: 'bracket', counting: 'per_joint', material_category: 'metal' })
 const missing: any = catalogFastenerWrite({ key: 'k', name: 'Plugg', kind: 'dowel', counting: 'along_contact', material_category: 'wood', diameter_mm: null, length_mm: null, request_quote: 'q' })
 assert.deepEqual(missing.issue.fields, ['diameter_mm', 'length_mm'], 'counted along the contact needs a size')
 const item = async (id: string) => (await f.pg.query('select bob_private.joint_fastener_item($1,1) i', [id])).rows[0].i
 assert.deepEqual(await item(dowel.recordId), { kind: 'dowel', counting: 'along_contact', project_id: f.project, diameter_mm: 8, length_mm: 40 })
 assert.deepEqual(await item(bracket.recordId), { kind: 'bracket', counting: 'per_joint', project_id: f.project, diameter_mm: null, length_mm: null })
 const pick = (id: string, count: number | null = null) => ({ material_id: id, material_revision: 1, count, spacing_mm: null })
 const data: any = f.constructionData(300, false, 'hardware')
 data.joints = [
  { id: 'left_middle', method: 'butt', first: { instance_id: 'left', face: 'x_max' }, second: { instance_id: 'middle', face: 'x_min' }, reason: 'Dowelled', fasteners: [pick(dowel.recordId)] },
  { id: 'middle_right', method: 'butt', first: { instance_id: 'middle', face: 'x_max' }, second: { instance_id: 'right', face: 'x_min' }, reason: 'Bracketed', fasteners: [pick(bracket.recordId, 2)] },
  { id: 'left_top', method: 'butt', first: { instance_id: 'left', face: 'x_max' }, second: { instance_id: 'top', face: 'x_min' }, reason: 'Bracket, count open', fasteners: [pick(bracket.recordId)] },
 ]
 const saved = await f.write({ ...f.base, kind: 'construction', data })
 const schedule = await f.call('bob.read_construction_fasteners', [f.project, saved.recordId, 1])
 assert.deepEqual(schedule.totals.map((r: any) => [r.kind, r.diameter_mm, r.length_mm, r.count]), [['bracket', null, null, 2], ['dowel', 8, 40, 3]])
 assert.deepEqual(schedule.joints.find((r: any) => r.joint_id === 'left_top').gaps, ['count_unknown']); assert.equal(schedule.complete, false)
 const base = { artifact_id: saved.recordId, artifact_revision: 1 }
 const derive = (fields: any) => f.write({ ...f.base, kind: 'operational', data: { resource: 'cad_requirement', action: 'create', fields } })
 const read = async (id: string) => (await f.call('bob.read_project_work', [f.project, JSON.stringify({ resource: 'requirement', record_id: id, after_id: null })])).records[0]
 const dowels = await derive(f.fields({ ...base, name: 'Träplugg', fastener_kind: 'dowel', diameter_mm: 8, length_mm: 40 }))
 const dowelNeed = await read(dowels.recordId)
 assert.equal(Number(dowelNeed.required_quantity), 3); assert.match(dowelNeed.basis, /3 dowels of 8 x 40 mm over 1 joint/)
 assert.match(dowelNeed.basis, /1 other joint has no fastener size or rule yet/, 'the bracket joint without a count stays open')
 const brackets = await derive(f.fields({ ...base, name: 'Vinkeljärn', fastener_kind: 'bracket', diameter_mm: null, length_mm: null }))
 const bracketNeed = await read(brackets.recordId)
 assert.equal(Number(bracketNeed.required_quantity), 2); assert.match(bracketNeed.basis, /2 brackets over 1 joint/)
 assert.deepEqual((await f.sources(brackets.recordId)).map((s: any) => [s.kind, s.diameter_mm, s.length_mm]), [['bracket', null, null]])
 await assert.rejects(derive(f.fields({ ...base, name: 'Skruv', fastener_kind: 'screw', diameter_mm: null, length_mm: null })), /invalid_cad_requirement/, 'screws still need their size')
})
