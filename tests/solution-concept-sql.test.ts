import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { conceptFixture } from './support/solution-concept-fixtures.ts'
import { conceptSvg, evaluateConcept } from '../supabase/functions/_shared/solution-concept.ts'
import { createProjectEdits } from '../supabase/functions/_shared/project-edits.ts'
import { createProjectWriter, type WritePayload } from '../supabase/functions/_shared/project-write.ts'
import { parseDesignReadiness } from '../supabase/functions/_shared/project-design-intent.ts'
import { parameterPacket } from './support/cad-parameter-fixture.ts'
import { manufacturePolicy } from './support/construction-instance-policy-fixture.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import { PROJECT_EDIT_TOOLS } from '../supabase/functions/_shared/project-edits.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'

test('FORM uses canonical Solution saves, bound edits, receipts, target pins and RLS', async t => {
  const pg = await projectSchema(); t.after(() => pg.close())
  const owner = randomUUID(), stranger = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [owner, 'concept@example.test', stranger, 'stranger@example.test'])
  const call = async (uid: string | null, name: string, args: unknown[], role = 'authenticated'): Promise<any> => (await asProjectUser(pg, uid, `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args, role)).rows[0].result
  const project = (await call(owner, 'bob.create_project', [JSON.stringify({ name: 'Concept acceptance' })])).id
  await t.test('published tool and on-demand FORM method match the implemented capability', async () => {
    const manifest: any = (await pg.query("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
    const catalog = createAiCatalogSession({ rpc: async () => ({ data: null, error: null }) } as any, { app: 'bob', manifest })
    assert.equal(catalog.tool('edit_project_record').function.description, PROJECT_EDIT_TOOLS[1].function.description)
    const workflows = manifest.definitions.find((d: any) => d.prompt_key === 'bob.workflows').definition.workflows
    assert(workflows.some((w: any) => w.name === 'workflow_solution_concept' && w.tools.includes('edit_project_record')))
    for (const key of ['tools.edit_project_record', 'bob.workflows']) {
      const actual = manifest.definitions.find((d: any) => d.prompt_key === key)
      assert.deepEqual(catalogFixture().definition(key, actual.definition_kind).definition, actual.definition)
    }
  })
  const bodies = new Map<string, any>(), ids = new Map<string, string>()
  for (const kind of ['box', 'bed', 'barn'] as const) {
    const id = randomUUID(), intent = conceptFixture(kind)
    const body = { title: kind, description: 'Synthetic concept acceptance', assumptions: 'Not measured', tradeoffs: '', measurements: [], design_intent: intent }
    bodies.set(kind, body); ids.set(kind, id)
    await t.test(`${kind}: unselected candidate persists and all views reopen exactly; SQL/TS agree`, async () => {
      await call(owner, 'bob.solution_command', [project, 'create', id, 0, JSON.stringify(body)])
      const read: any = (await asProjectUser(pg, owner, 'select * from bob.solution_revisions where project_id=$1 and solution_id=$2 and revision=1', [project, id])).rows[0]
      assert.deepEqual(read.design_intent, intent)
      for (const v of intent.model.views) assert.equal(conceptSvg(read.design_intent, v.id), conceptSvg(intent, v.id))
      const check = await call(owner, 'bob_private.solution_concept_result', [JSON.stringify(intent)])
      const local = evaluateConcept(intent)
      assert.deepEqual(check.boxes, local.boxes)
      assert.deepEqual([...new Set(check.issues.map((i: any) => i.code))], [...new Set(local.issues.map(i => i.code))])
      assert.equal((await pg.query('select count(*)::int n from bob.target_revisions where project_id=$1', [project])).rows[0].n, 0)
    })
  }
  await t.test('unknown and malformed geometry cannot be turned into measured truth by direct RPC', async () => {
    const intent = conceptFixture('box')
    intent.model.nodes[1] = { id: 'length', role: 'unknown', unit: 'mm', reason: 'Not supplied' }
    const check = await call(owner, 'bob_private.solution_concept_result', [JSON.stringify(intent)])
    assert.equal(check.boxes.length, 0); assert(check.issues.some((i: any) => i.code === 'parameter_unresolved'))
    const empty = conceptFixture('box'); empty.features = []; empty.choices = []
    empty.model.components.forEach(c => { c.active = false; c.features = []; c.choices = [] })
    const emptyCheck = await call(owner, 'bob_private.solution_concept_result', [JSON.stringify(empty)])
    assert.deepEqual(emptyCheck.issues.map((i: any) => i.code), ['empty_model'])
    const axis = conceptFixture('barn'); axis.model.views[1].plane = 'YZ'
    const axisCheck = await call(owner, 'bob_private.solution_concept_result', [JSON.stringify(axis)])
    assert(axisCheck.issues.some((i: any) => i.code === 'view_plane_conflict'))
    for (const mutate of [(m: any) => { m.nodes[1].role = 'measured' }, (m: any) => { m.views[1].plane = 'ZX' }, (m: any) => { m.components[0].rotation = 45 }, (m: any) => { m.nodes[1].value = 1.00000001 }]) {
      const x = conceptFixture('box'); mutate(x.model)
      await assert.rejects(call(owner, 'bob.solution_command', [project, 'create', randomUUID(), 0, JSON.stringify({ ...bodies.get('box'), design_intent: x })]), /invalid_concept/)
    }
    const bad = structuredClone(bodies.get('box')); bad.design_intent.model.components[0].id = 'replacement'
    await assert.rejects(call(owner, 'bob.solution_command', [project, 'revise', ids.get('box'), 1, JSON.stringify({ ...bad, change_note: 'Replace identity' })]), /concept_identity_required/)
    await assert.rejects(call(stranger, 'bob.read_bob_edit_context', [project, 'solutions', null, null]), /project_denied/)
    await assert.rejects(call(stranger, 'bob.solution_command', [project, 'revise', ids.get('box'), 1, JSON.stringify({ ...bodies.get('box'), change_note: 'Cross project' })]), /project_denied/)
    assert.equal((await asProjectUser(pg, stranger, 'select * from bob.solution_revisions where project_id=$1', [project])).rows.length, 0)
  })
  const message = 'Move the ladder without changing the drawers.', turn = randomUUID()
  const claim = await call(null, 'bob.bob_claim_turn', [project, owner, turn, message], 'service_role')
  const payloads: WritePayload[] = []
  const rpc = async (payload: WritePayload) => {
    try { return { data: await call(owner, 'bob.bob_project_write_v17', [project, claim.thread_id, turn, claim.generation, JSON.stringify(payload)]), error: null } }
    catch (e: any) { return { data: null, error: { code: e.code, message: e.message } } }
  }
  const writer = createProjectWriter(project, message, p => { payloads.push(structuredClone(p)); return rpc(p) }, async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }))
  const read = async (input: any) => ({ data: await call(owner, 'bob.read_bob_edit_context', [project, input.resource, input.query, input.after]), error: null })
  const edits = createProjectEdits({ projectId: project, writer, read, hasAccess: async () => true })
  let target: any
  await t.test('selected edit is exact/idempotent, survives worker reset and never overwrites a concurrent correction', async () => {
    target = await call(owner, 'bob.solution_command', [project, 'select', ids.get('bed'), 0, JSON.stringify({ solution_revision: 1, reason: 'Choose this bed' })])
    const context = await edits.execute('read_project_edit_context', { resource: 'selected_solutions', query: null, next_ref: null })
    assert.equal(context.status, 'ok', JSON.stringify(context))
    const ix = bodies.get('bed').design_intent.model.nodes.findIndex((n: any) => n.id === 'ladder_x')
    const args = { edit_ref: context.entries[0].edit_ref, changes: [{ op: 'set', path: `/design_intent/model/nodes/${ix}/value`, value_json: '100' }], reason: 'Move ladder only', request_quote: message }
    const restored = createProjectEdits({ projectId: project, writer, read, hasAccess: async () => true }); restored.restoreState(edits.exportState())
    const saved = await restored.execute('edit_project_record', args)
    assert.equal(saved.status, 'saved', JSON.stringify(saved)); assert.equal(saved.selected_updated, true)
    assert.equal((await rpc(payloads[0])).error, null)
    const reread = await restored.execute('read_project_edit_context', { resource: 'selected_solutions', query: null, next_ref: null })
    const content = reread.entries[0].content
    assert.equal(content.design_intent.model.nodes[ix].value, 100)
    assert.deepEqual(content.design_intent.model.components, bodies.get('bed').design_intent.model.components)
    assert.equal(content.concept_check.issues.length, 0)
    const conflict = await restored.execute('edit_project_record', { ...args, changes: [{ ...args.changes[0], value_json: '200' }] })
    assert.equal(conflict.status, 'conflict', JSON.stringify(conflict))
    assert.equal((await pg.query('select current_revision from bob.solutions where id=$1', [ids.get('bed')])).rows[0].current_revision, 2)
    const historical: any = (await asProjectUser(pg, owner, 'select design_intent from bob.solution_revisions where solution_id=$1 and revision=1', [ids.get('bed')])).rows[0]
    assert.equal(historical.design_intent.model.nodes[ix].value, 50)
    target = (await asProjectUser(pg, owner, 'select * from bob.current_target where project_id=$1', [project])).rows[0]
    assert.equal(target.solution_revision, 2)
  })
  await t.test('impossible height cannot produce construction readiness, even with asserted alignment', async () => {
    const body = structuredClone(bodies.get('barn')); body.design_intent.purpose = 'construction'
    await call(owner, 'bob.solution_command', [project, 'revise', ids.get('barn'), 1, JSON.stringify({ ...body, change_note: 'Request detailed construction' })])
    const chosen = await call(owner, 'bob.solution_command', [project, 'select', ids.get('barn'), target.revision, JSON.stringify({ solution_revision: 2, reason: 'Use this barn' })])
    const readiness = await call(owner, 'bob.read_design_readiness', [project, null, chosen.revision, 'construction'])
    assert.equal(readiness.status, 'needs_data'); assert.equal(readiness.pin, null); assert(parseDesignReadiness(readiness))
    assert(readiness.issues.some((i: any) => i.code === 'concept_reconciliation_required'))
    target = chosen
  })
  await t.test('construction saves and reopens exact concept; direct writes reject geometry drift; reselected revision marks output stale', async () => {
    const body = structuredClone(bodies.get('box')); body.design_intent.purpose = 'construction'
    await call(owner, 'bob.solution_command', [project, 'revise', ids.get('box'), 1, JSON.stringify({ ...body, change_note: 'Develop the selected concept' })])
    target = await call(owner, 'bob.solution_command', [project, 'select', ids.get('box'), target.revision, JSON.stringify({ solution_revision: 2, reason: 'Choose this exact geometry' })])
    const save = (p: any) => call(owner, 'bob.bob_project_write_v16', [project, claim.thread_id, turn, claim.generation, JSON.stringify(p)])
    const material = await save({ kind: 'catalog', record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: message,
      data: { action: 'ensure', key: 'concept_material', kind: 'material', name: 'Synthetic plywood', aliases: [], profile_code: 'sheet_stock', profile_revision: 1, categories: ['wood.plywood', 'sheet'],
        properties: { thickness: { value: '18', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' } }, material_id: null, material_revision: null, notes: '', source_kind: 'design_choice', source_quote: message, source_seq: null } })
    const boxes = evaluateConcept(body.design_intent).boxes
    const recipe: any = { contract_version: 1, units: 'mm', assembly_id: 'concept_fixture', views: ['top', 'front'],
      definitions: boxes.map(b => ({ id: b.id, primitive: 'box', material_ref: null, x_mm: b.size_mm[0], y_mm: b.size_mm[1], z_mm: b.size_mm[2] })),
      instances: boxes.map(b => ({ id: b.id, definition_id: b.id, placement: { x: b.min[0], y: b.min[1], z: b.min[2], rx: 0, ry: 0, rz: 0 } })) }
    const payload = { kind: 'construction', record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: message,
      data: { key: 'concept_checkpoint', title: 'Box construction concept', description: 'Synthetic only', area_id: null, target_revision: target.revision, change_note: 'Exact concept handoff', recipe, parameters: parameterPacket(project, recipe), instance_policy: manufacturePolicy(recipe),
        materials: recipe.definitions.map((d: any) => ({ definition_id: d.id, material_id: material.recordId, material_revision: 1, part_id: null, part_revision: null })), joints: [], open_questions: ['Physical joints and safety still require assessment.'] } }
    const wrong = structuredClone(payload); wrong.data.key = 'wrong_geometry'; wrong.data.recipe.definitions[0].x_mm += 1; wrong.data.parameters = parameterPacket(project, wrong.data.recipe)
    await assert.rejects(save(wrong), /concept_geometry_changed/)
    const missing = structuredClone(payload); missing.data.key = 'missing_piece'; missing.data.recipe.instances[0].id = 'another_component'; missing.data.parameters = parameterPacket(project, missing.data.recipe); missing.data.instance_policy = manufacturePolicy(missing.data.recipe)
    await assert.rejects(save(missing), /concept_part_missing/)
    const saved = await save(payload)
    assert.equal(saved.dataset, 'artifacts'); assert.deepEqual(await save(payload), saved)
    const read = () => call(owner, 'bob.read_construction_draft', [project, saved.recordId, 1, null])
    const checkpoint = await read()
    assert.equal(checkpoint.solution_revision, 2); assert.deepEqual(checkpoint.design_intent.model, body.design_intent.model); assert.equal(checkpoint.source_state, 'current')
    body.design_intent.model.nodes.find((n: any) => n.id === 'height').value = 450
    await call(owner, 'bob.solution_command', [project, 'revise', ids.get('box'), 2, JSON.stringify({ ...body, change_note: 'Raise the walls' })])
    assert.equal((await read()).source_state, 'current', 'unselected candidate cannot silently replace the selected geometry')
    target = await call(owner, 'bob.solution_command', [project, 'select', ids.get('box'), target.revision, JSON.stringify({ solution_revision: 3, reason: 'Choose the raised version' })])
    assert.equal((await read()).source_state, 'changed')
    assert.deepEqual((await read()).recipe, recipe, 'stale output is retained, never rewritten silently')
  })
  await t.test('a changed linked measurement blocks construction until the same Solution reconciles that exact source revision', async () => {
    const measurement = randomUUID(), solution = randomUUID(), intent = conceptFixture('box')
    intent.purpose = 'construction'
    const evidence = { subject: 'Available space', unit: 'mm', value: '700', truth: 'measured', source: 'Synthetic tape observation', required: true }
    await call(owner, 'bob.evidence_command', [project, 'measurement', 'create', measurement, 0, JSON.stringify(evidence)])
    const body = { ...bodies.get('box'), design_intent: intent, measurements: [{ id: measurement, revision: 1 }] }
    await call(owner, 'bob.solution_command', [project, 'create', solution, 0, JSON.stringify(body)])
    target = await call(owner, 'bob.solution_command', [project, 'select', solution, target.revision, JSON.stringify({ solution_revision: 1, reason: 'Select linked concept' })])
    assert.equal((await call(owner, 'bob.read_design_readiness', [project, null, target.revision, 'construction'])).status, 'ready')
    await call(owner, 'bob.evidence_command', [project, 'measurement', 'revise', measurement, 1, JSON.stringify({ ...evidence, value: '680', change_note: 'Correct the measurement' })])
    const stale = await call(owner, 'bob.read_design_readiness', [project, null, target.revision, 'construction'])
    assert.equal(stale.status, 'conflict'); assert.equal(stale.pin, null)
    assert(stale.issues.some((i: any) => i.code === 'concept_source_changed'))
    assert(parseDesignReadiness(stale))
    await call(owner, 'bob.solution_command', [project, 'revise', solution, 1, JSON.stringify({ ...body, measurements: [{ id: measurement, revision: 2 }], change_note: '600 mm still fits the corrected measured space' })])
    target = await call(owner, 'bob.solution_command', [project, 'select', solution, target.revision, JSON.stringify({ solution_revision: 2, reason: 'Select reconciled concept' })])
    assert.equal((await call(owner, 'bob.read_design_readiness', [project, null, target.revision, 'construction'])).status, 'ready')
  })
})
