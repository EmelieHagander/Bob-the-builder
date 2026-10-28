import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { constructionFormFixture } from './support/construction-form-fixture.ts'
import { parameterPacket } from './support/cad-parameter-fixture.ts'
import { manufacturePolicy } from './support/construction-instance-policy-fixture.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { preConstructionWorkCatalogFixture } from './support/ai-catalog-fixture.ts'

test('explicit source reconciliation preserves construction identity, receipt and FORM guards', async t => {
  const publication = '20261028174802_ai_bob_cost_controls_catalog.sql'
  let beforeCatalog: any
  const pg = await projectSchema(async (db, name) => {
    if (name === publication) beforeCatalog = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  }, publication)
  t.after(() => pg.close())
  const rpc = async (uid: string | null, name: string, args: any[], role = 'authenticated'): Promise<any> =>
    ((await asProjectUser(pg, uid, `select ${name}(${args.map((_, n) => '$' + (n + 1)).join(',')}) result`, args, role)).rows[0] as any).result
  const owner = randomUUID(), outsider = randomUUID(), turn = randomUUID(), solution = randomUUID()
  const message = 'Widen this same frame, then keep its construction aligned with the selected solution.'
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [owner, 'refresh@example.test', outsider, 'outsider@example.test'])
  const project = (await rpc(owner, 'bob.create_project', [JSON.stringify({ name: 'Source reconciliation' })])).id
  const { intent, recipe, refinement } = constructionFormFixture()
  const body = { title: 'Frame and later drawer', description: 'Synthetic only', assumptions: 'Strength unknown', tradeoffs: 'Partial design', measurements: [], design_intent: intent }
  await rpc(owner, 'bob.solution_command', [project, 'create', solution, 0, JSON.stringify(body)])
  await rpc(owner, 'bob.solution_command', [project, 'select', solution, 0, JSON.stringify({ solution_revision: 1, reason: message })])
  const claim = await rpc(null, 'bob.bob_claim_turn', [project, owner, turn, message], 'service_role')
  const binding = [project, claim.thread_id, turn, claim.generation]
  const write = (payload: any) => rpc(owner, 'bob.bob_project_write_v17', [...binding, JSON.stringify(payload)])
  const material = await write({ kind: 'catalog', record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: message,
    data: { action: 'ensure', key: 'material', kind: 'material', name: 'Fixture plywood', aliases: [], profile_code: 'sheet_stock', profile_revision: 1, categories: ['wood.plywood', 'sheet'], properties: { thickness: { value: '18', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' } }, material_id: null, material_revision: null, notes: '', source_kind: 'design_choice', source_quote: message, source_seq: null } })
  const saved = await write({ kind: 'construction', record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: message,
    data: { key: 'initial', title: 'Frame', description: 'Two rails; later work remains', area_id: null, target_revision: 1, change_note: 'Initial', recipe, parameters: parameterPacket(project, recipe), materials: [{ definition_id: 'rail', material_id: material.recordId, material_revision: 1, part_id: null, part_revision: null }], joints: [], instance_policy: manufacturePolicy(recipe), open_questions: ['Joinery remains unverified'], form_refinement: refinement } })
  const id = saved.recordId, read = (revision: number | null = null) => rpc(owner, 'bob.read_construction_draft', [project, id, revision, null])
  const initial = await read()
  const sqlErrors: string[] = []
  const writer = createProjectWriter(project, message, async payload => {
    try { return { data: await write(payload), error: null } }
    catch (e: any) { sqlErrors.push(e.message); return { data: null, error: { code: e.code, message: e.message } } }
  }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }))
  const prepare = (payload: any, uid = owner) => rpc(uid, 'bob.prepare_construction_parameter_change', [...binding, JSON.stringify(payload)])
  const tools = createConstructionTools({ projectId: project, message, writer, constructionSourceRefresh: true, hasAccess: async () => true,
    read: (_id, revision) => read(revision), readSources: async () => ({ project: new Map(), physical: new Map() }), prepareParameterChange: async p => {
      try { return await prepare(p) } catch (e: any) { return { status: e.code === 'PT409' ? 'conflict' : e.code === '42501' ? 'denied' : 'invalid', reason: e.message } }
    } })
  const move = initial.parameters.bindings.find((b: any) => b.path === 'instances/right/placement/x').node
  const command = { key: 'wider', record_id: id, expected_revision: 1, target_revision: 2,
    changes: [{ id: move, role: 'decision', value: 602, unit: 'mm', reason: 'Same requested wider frame' }], change_note: 'Reconcile same frame', request_quote: message }
  const revise = async (revision: number) => {
    await rpc(owner, 'bob.solution_command', [project, 'revise', solution, revision, JSON.stringify({ ...body, change_note: 'Updated design' })])
    return rpc(owner, 'bob.solution_command', [project, 'select', solution, revision, JSON.stringify({ solution_revision: revision + 1, reason: message })])
  }
  let receipt: any
  await t.test('catalog publishes only the three intended versions and leaves historical pins intact', async () => {
    const current: any = (await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
    const keys = ['tools.change_construction_parameters', 'bob.tools', 'profile.ask-bob']
    for (const prior of beforeCatalog.definitions) {
      const row = current.definitions.find((r: any) => r.prompt_key === prior.prompt_key)
      if (!keys.includes(prior.prompt_key)) assert.deepEqual(row, prior)
      else { assert.equal(row.version, prior.version + 1); assert.deepEqual(row.definition, preConstructionWorkCatalogFixture().definition(row.prompt_key, row.definition_kind).definition) }
    }
    assert.equal(beforeCatalog.definitions.find((r: any) => r.prompt_key === 'profile.ask-bob').definition.reasoning_effort, 'high')
    assert.equal(current.definitions.find((r: any) => r.prompt_key === 'profile.ask-bob').definition.reasoning_effort, 'medium')
    assert.equal(beforeCatalog.definitions.find((r: any) => r.prompt_key === 'tools.change_construction_parameters').definition.parameters.properties.target_revision, undefined)
    await pg.exec(readFileSync(new URL('../supabase/migrations/' + publication, import.meta.url), 'utf8'))
    const again: any = (await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
    assert.deepEqual(again.definitions, current.definitions, 'publication retry does not create versions')
  })
  await t.test('source-only refresh cannot bless geometry from an older solution', async () => {
    ;(intent.model.nodes.find(n => n.id === 'frame_s0') as any).value = 620
    assert.equal((await revise(1)).revision, 2)
    assert.equal((await read()).source_state, 'changed')
    const result = await tools.execute('change_construction_parameters', { ...command, key: 'wrong-geometry', changes: [] })
    assert.notEqual(result.status, 'saved', JSON.stringify(result))
    assert(sqlErrors.some(e => /concept_geometry_changed/.test(e)), JSON.stringify(sqlErrors))
    assert.equal((await read()).revision, 1)
  })
  await t.test('bounded edit advances source and geometry together on the exact same artifact', async () => {
    receipt = await tools.execute('change_construction_parameters', command)
    assert.equal(receipt.status, 'saved', JSON.stringify({ receipt, sqlErrors }))
    assert.equal(receipt.receipt.recordId, id); assert.equal(receipt.receipt.revision, 2)
    const after = await read()
    assert.equal(after.target_revision, 2); assert.equal(after.solution_revision, 2); assert.equal(after.source_state, 'current')
    assert.equal(after.recipe.instances[1].placement.x, 602)
    for (const field of ['materials', 'joints', 'instance_policy', 'form_refinement']) assert.deepEqual(after[field], initial[field])
    assert.deepEqual((await read(1)).recipe, initial.recipe)
  })
  await t.test('text-only solution changes permit an explicit source-only revision; replay precedes later drift', async () => {
    body.description = 'Wider frame with clearer wording'
    await revise(2)
    const refreshed = await tools.execute('change_construction_parameters', { ...command, key: 'source-only', expected_revision: 2, target_revision: 3, changes: [] })
    assert.equal(refreshed.status, 'saved', JSON.stringify(refreshed)); assert.equal(refreshed.receipt.recordId, id)
    assert.equal((await read()).revision, 3); assert.equal((await read()).source_state, 'current')
    assert.deepEqual(await tools.execute('change_construction_parameters', command), receipt)
    assert.equal((await tools.execute('change_construction_parameters', { ...command, target_revision: 3 })).status, 'conflict')
  })
  await t.test('missing or wrong target, unresolved controlling inputs and cross-project callers stay blocked', async () => {
    const base = { ...command, key: 'blocked', expected_revision: 3, changes: [] }
    assert.equal((await tools.execute('change_construction_parameters', { ...base, target_revision: null })).status, 'invalid')
    assert.notEqual((await tools.execute('change_construction_parameters', { ...base, target_revision: 2 })).status, 'saved')
    const payload = { kind: 'construction_parameters', record_id: id, expected_revision: 3, expected_updated_at: null, request_quote: message,
      data: { key: 'outsider', change_note: 'Denied', changes: [], computed: null, target_revision: 3 } }
    await assert.rejects(prepare(payload, outsider), /project_denied|turn_not_claimed/)
    ;(intent.model.nodes.find(n => n.id === 'frame_s0') as any).role = 'unknown'
    delete (intent.model.nodes.find(n => n.id === 'frame_s0') as any).value
    await revise(3)
    const result = await tools.execute('change_construction_parameters', { ...base, target_revision: 4 })
    assert.equal(result.status, 'needs_data', JSON.stringify(result))
    assert.equal((await read()).revision, 3)
    assert.deepEqual(await tools.execute('change_construction_parameters', command), receipt)
  })
})
