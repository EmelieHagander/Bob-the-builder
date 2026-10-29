import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { constructionFormFixture } from './support/construction-form-fixture.ts'
import { parameterPacket } from './support/cad-parameter-fixture.ts'
import { manufacturePolicy } from './support/construction-instance-policy-fixture.ts'
import { createConstructionTools, CONSTRUCTION_PARAMETER_REFRESH_TOOL } from '../supabase/functions/_shared/construction-draft.ts'
import { CONSTRUCTION_EDIT_TOOL } from '../supabase/functions/_shared/construction-edits.ts'
import { withConstructionWorkWrite } from '../supabase/functions/_shared/construction-work.ts'
import { createConstructionViews } from '../supabase/functions/_shared/construction-views.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectEdits } from '../supabase/functions/_shared/project-edits.ts'
import { readTaskSources } from '../supabase/functions/_shared/task-sources.ts'
import { recipeSize, sizeStatements, staleSizeText, withConstructionText } from '../supabase/functions/_shared/construction-text.ts'
import { catalogFixture, preTextHygieneCatalogFixture } from './support/ai-catalog-fixture.ts'

// Paid box run 2026-10-29: the title kept "400x300x250" after the width became
// 500 and the drawing copied it. A change may no longer leave a stated size wrong.
test('size statements: overall sizes in prose are found, material specs are not', () => {
  const title = 'Enkel förvaringslåda 400x300x250 i 12 mm plywood'
  const description = 'Öppen låda med yttermått 400 × 300 × 250 mm, 400 mm bred. Höjd: 25 cm. Gjord av 45x95 reglar.'
  assert.deepEqual(sizeStatements(title), [{ fragment: '400x300x250', mm: [400, 300, 250] }])
  assert.deepEqual(sizeStatements(description).map(s => s.mm), [[400, 300, 250], [45, 95], [400], [250]])
  const before = [400, 300, 250], after = [500, 300, 250]
  assert.deepEqual(staleSizeText({ title, description }, before, after), [
    { field: 'title', fragment: '400x300x250' },
    { field: 'description', fragment: '400 × 300 × 250 mm' },
    { field: 'description', fragment: '400 mm bred' },
  ], 'the height (25 cm = 250) and the 45x95 material size stay valid')
  assert.deepEqual(staleSizeText({ title: 'Låda 500x300x250', description: 'Ingen storlek.' }, before, after), [], 'text stating the new size passes')
  assert.deepEqual(staleSizeText({ title, description }, before, [300, 250, 400]), [], 'an unchanged overall size is never stale')
  assert.deepEqual(staleSizeText({ title, description }, null, after), [], 'unknown geometry asserts nothing')
  const recipe = { definitions: [{ id: 'panel', primitive: 'box', x_mm: 400, y_mm: 12, z_mm: 250 }],
    instances: [{ id: 'front', definition_id: 'panel', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } },
      { id: 'back', definition_id: 'panel', placement: { x: 0, y: 288, z: 0, rx: 0, ry: 0, rz: 0 } },
      { id: 'wall', definition_id: 'panel', placement: { x: 0, y: 900, z: 0, rx: 0, ry: 0, rz: 0 } }] }
  assert.deepEqual(recipeSize(recipe, { instances: [{ instance_id: 'wall', role: 'reference' }] }), [400, 300, 250], 'reference instances are context, not the object')
})

test('construction changes carry corrected text and never leave a stated size wrong; pinned tools are unchanged', async t => {
  const pg = await projectSchema(undefined, '20261029170100_bob_text_hygiene_catalog.sql'); t.after(() => pg.close())
  const rpc = async (uid: string | null, name: string, args: any[], role = 'authenticated'): Promise<any> =>
    ((await asProjectUser(pg, uid, `select ${name}(${args.map((_, n) => '$' + (n + 1)).join(',')}) result`, args, role)).rows[0] as any).result
  const owner = randomUUID(), turnId = randomUUID(), solution = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now())', [owner, 'text@example.test'])
  const message = 'Make this same frame wider and deeper; preserve the other requirements and check the result.'
  const project = (await rpc(owner, 'bob.create_project', [JSON.stringify({ name: 'Construction text fixture' })])).id
  const { intent, recipe, refinement } = constructionFormFixture()
  const body = { title: 'Frame and future drawer', description: 'Preserve the later drawer requirement.', assumptions: 'Strength unknown', tradeoffs: 'Partial concept', measurements: [], design_intent: intent }
  await rpc(owner, 'bob.solution_command', [project, 'create', solution, 0, JSON.stringify(body)])
  await rpc(owner, 'bob.solution_command', [project, 'select', solution, 0, JSON.stringify({ solution_revision: 1, reason: message })])
  const claim = await rpc(null, 'bob.bob_claim_turn', [project, owner, turnId, message], 'service_role')
  const binding = [project, claim.thread_id, turnId, claim.generation]
  const manifest = (await pg.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
  await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,status,
    claim_token,lease_until,credential,worker_url,expires_at,work_allowance_version,ai_catalog_manifest_id)
    values($1,$2,$3,$4,$5,$6,'running',$7,clock_timestamp()+interval '4 minutes','{"fixture":true}',
    'https://fixture.supabase.co/functions/v1/bob-worker',clock_timestamp()+interval '30 minutes',1,$8)`,
    [randomUUID(), project, owner, claim.thread_id, turnId, claim.generation, randomUUID(), manifest.manifest_id])
  const write = (payload: any) => rpc(owner, payload.kind === 'construction_work' ? 'bob.commit_construction_work' : 'bob.bob_project_write_v17', [...binding, JSON.stringify(payload)])
  const sqlErrors: string[] = []
  let writes = 0
  const writer = createProjectWriter(project, message, async (payload: any) => {
    writes++
    try { return { data: await write(payload), error: null } } catch (e: any) { sqlErrors.push(e.message); return { data: null, error: { code: e.code, message: e.message } } }
  }, async () => ({ data: [], error: null }), async () => ({ data: [], error: null }), { unlimitedWork: true })
  const material = await write({ kind: 'catalog', record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: message,
    data: { action: 'ensure', key: 'material', kind: 'material', name: 'Fixture plywood', aliases: [], profile_code: 'sheet_stock', profile_revision: 1, categories: ['wood.plywood', 'sheet'], properties: { thickness: { value: '18', unit: 'mm', truth: 'provided_spec', parameter: null, note: '' } }, material_id: null, material_revision: null, notes: '', source_kind: 'design_choice', source_quote: message, source_seq: null } })
  const size = recipeSize(recipe, manufacturePolicy(recipe))!
  const stated = size.join('x'), statedSpaced = size.join(' × ') + ' mm'
  const initial = await write({ kind: 'construction', record_id: null, expected_revision: 0, expected_updated_at: null, request_quote: message,
    data: { key: 'initial', title: `Frame ${stated}`, description: `Frame with outer size ${statedSpaced}; preserve the later drawer requirement.`, area_id: null, target_revision: 1, change_note: 'Initial', recipe, parameters: parameterPacket(project, recipe),
      materials: [{ definition_id: 'rail', material_id: material.recordId, material_revision: 1, part_id: null, part_revision: null }], joints: [], instance_policy: manufacturePolicy(recipe), open_questions: ['Joinery unverified'], form_refinement: refinement } })
  const id = initial.recordId, read = (revision: number | null = null) => rpc(owner, 'bob.read_construction_draft', [project, id, revision, null])
  const first = await read(), right = first.parameters.bindings.find((b: any) => b.path === 'instances/right/placement/x').node
  const depth = first.parameters.bindings.find((b: any) => b.path === 'definitions/rail/y_mm').node
  const edits = createProjectEdits({ projectId: project, writer, hasAccess: async () => true, unlimitedWork: true,
    read: async q => ({ data: await rpc(owner, 'bob.read_bob_edit_context', [project, q.resource, q.query, q.after]), error: null }),
    readSelected: async area => ({ data: await rpc(owner, 'bob.read_bob_selected_edit_context', [project, area]), error: null }) })
  const preparation = (name: string) => async (payload: any) => {
    try { return await rpc(owner, name, [...binding, JSON.stringify(payload)]) }
    catch (e: any) { return { status: e.code === '42501' ? 'denied' : ['PT409', '40001'].includes(e.code) ? 'conflict' : e.code === '22023' ? 'invalid' : 'unavailable', reason: e.message } }
  }
  const options: any = { projectId: project, message, writer, hasAccess: async () => true, unlimitedWork: true, constructionViews: true, formEvidence: true, constructionSourceRefresh: true, coherentWork: true,
    now: () => new Date('2026-10-29T17:00:00Z'), read: (_id: string | null, revision: number | null) => read(revision), readCurrent: () => read(),
    readSources: async () => ({ project: new Map(), physical: new Map() }),
    prepareEdit: preparation('bob.prepare_construction_edit'), prepareParameterChange: preparation('bob.prepare_construction_parameter_change'), prepareWork: preparation('bob.prepare_construction_work'), prepareSolutionEdit: edits.prepare,
    readCatalog: async (mid: string, revision: number) => ({ projectId: project, status: 'ok', record: { id: mid, revision, current_revision: revision, kind: 'material', source_kind: 'design_choice', profile_code: 'sheet_stock', categories: ['wood.plywood', 'sheet'], properties: { thickness: { value: '18', unit: 'mm', truth: 'provided_spec', parameter: null } } } }),
    readWorkSources: async (draft: any, stepId: string | null) => {
      const s = (await rpc(owner, 'bob.read_bob_selected_edit_context', [project, null]))[0]
      const packet = await readTaskSources({ area_id: draft?.area_id ?? null, step_id: stepId, construction: draft ? { artifact_id: id, revision: draft.revision } : null }, { projectId: project,
        search: async q => q.dataset === 'target' ? { status: 'ok', records: [{ id: 'project', revision: s.target.revision, solution_id: s.record.id, solution_revision: s.record.revision, design_intent: s.record.design_intent }] } : { status: 'empty', records: [] },
        construction: draft ? q => createConstructionViews(project).read(draft, q as any) : undefined })
      return { packet, solutionEdit: await edits.readSelected(null) }
    } }
  const textTools = createConstructionTools({ ...options, constructionText: true }), pinnedTools = createConstructionTools(options)
  const editRef = async () => {
    const work: any = await textTools.execute('read_construction_draft', { artifact_id: id, revision: null, after: null, view: 'work', ids: [], result_id: null, section: null, step_id: null, work_kind: 'parameters' })
    return work.items.find((r: any) => r.collection === 'solution_edit').value.entry.edit_ref
  }
  const solutionChanges = (width: number, deep: number) => [
    { op: 'set', path: `/design_intent/model/nodes/${intent.model.nodes.findIndex(n => n.id === 'frame_s0')}/value`, value_json: JSON.stringify(width) },
    { op: 'set', path: `/design_intent/model/nodes/${intent.model.nodes.findIndex(n => n.id === 'frame_s1')}/value`, value_json: JSON.stringify(deep) },
    { op: 'set', path: '/design_intent/alignment', value_json: JSON.stringify({ status: 'aligned', basis: 'Requested dimensions preserve the frame requirements and later drawer.' }) }]
  const change = async (key: string, revision: number, width: number, deep: number, extra: Record<string, unknown> = {}) => ({ key, record_id: id, expected_revision: revision, target_revision: null,
    request_quote: message, change_note: 'Change both frame dimensions together',
    solution_edit: { edit_ref: await editRef(), changes: solutionChanges(width, deep), reason: 'Requested wider and deeper frame' },
    changes: [{ id: right, role: 'decision', value: width - 18, unit: 'mm', reason: 'Requested frame width' }, { id: depth, role: 'decision', value: deep, unit: 'mm', reason: 'Requested frame depth' }], ...extra })

  await t.test('a change that would leave the stated size wrong saves nothing and names the fragments', async () => {
    const before = writes
    const result: any = await textTools.execute('change_construction_parameters', await change('stale', 1, 620, 450, { text: null }))
    assert.equal(result.status, 'invalid', JSON.stringify(result)); assert.equal(result.validation.code, 'stale_construction_text')
    assert.deepEqual(result.stale.map((s: any) => s.fragment), [stated, statedSpaced])
    assert.deepEqual(result.current_size_mm, [620, 450, 18]); assert.match(result.message, /620 × 450 × 18 mm/)
    assert.equal(writes, before, 'rejected before any write'); assert.equal((await read()).revision, 1)
    const still: any = await textTools.execute('change_construction_parameters', await change('still-stale', 1, 620, 450,
      { text: { title: `Frame ${stated}`, description: 'Wider frame.' } }))
    assert.equal(still.status, 'invalid'); assert.match(still.message, /supplied text still states/)
  })

  await t.test('the same change with corrected text commits title, description and geometry as one revision', async () => {
    const text = { title: 'Frame 620x450x18', description: 'Frame with outer size 620 × 450 × 18 mm; preserve the later drawer requirement.' }
    const saved: any = await textTools.execute('change_construction_parameters', await change('wider', 1, 620, 450, { text }))
    assert.equal(saved.status, 'saved', JSON.stringify({ saved, sqlErrors }))
    const after = await read()
    assert.equal(after.revision, 2); assert.equal(after.title, text.title); assert.equal(after.description, text.description)
    assert.equal(after.recipe.instances[1].placement.x, 602)
  })

  await t.test('a part edit carries text through the edit command; text:null keeps the saved text', async () => {
    const draft = await read(), node = draft.parameters.nodes.find((n: any) => n.id === depth), { normalized: _n, sources: _s, ...plain } = node
    const edit = { key: 'reason-only', record_id: id, expected_revision: draft.revision, target_revision: null, request_quote: message, change_note: 'Clarify the depth reason',
      solution_edit: null, changes: { nodes: { upsert: [{ ...plain, reason: 'Requested frame depth, confirmed' }], remove: [] } } }
    const kept: any = await textTools.execute('edit_construction_parts', { ...edit, text: null })
    assert.equal(kept.status, 'saved', JSON.stringify({ kept, sqlErrors })); assert.equal((await read()).title, 'Frame 620x450x18')
    const renamed: any = await textTools.execute('edit_construction_parts', { ...edit, key: 'renamed', expected_revision: draft.revision + 1,
      changes: { nodes: { upsert: [{ ...plain, reason: 'Requested frame depth, confirmed twice' }], remove: [] } }, text: { title: 'Wide frame 620x450x18', description: 'A frame for the later drawer.' } })
    assert.equal(renamed.status, 'saved', JSON.stringify({ renamed, sqlErrors }))
    const head = await read(); assert.equal(head.title, 'Wide frame 620x450x18'); assert.equal(head.description, 'A frame for the later drawer.')
  })

  await t.test('pinned tools and old payloads keep their behaviour; the database validates supplied text', async () => {
    assert.equal(pinnedTools.tools.find(s => s.function.name === 'change_construction_parameters')!.function.parameters.properties.text, undefined)
    const invalidText: any = await textTools.execute('change_construction_parameters', { ...(await change('bad-text', (await read()).revision, 640, 450)), text: { title: '', description: 'x' } })
    assert.equal(invalidText.status, 'invalid', 'schema rejects an empty title before the database')
    const head = (await read()).revision
    await assert.rejects(rpc(owner, 'bob.prepare_construction_parameter_change', [...binding, JSON.stringify({ kind: 'construction_parameters', record_id: id, expected_revision: head,
      expected_updated_at: null, request_quote: message, data: { key: 'sql-text', change_note: 'x', changes: [{ id: right, role: 'decision', value: 600, unit: 'mm', reason: 'x' }], computed: null, text: { title: ' ', description: 'x' } } })]), /invalid_parameter_change/)
    // The pinned runtime keeps its earlier behaviour: the size changes, the text is untouched.
    const legacy: any = await pinnedTools.execute('change_construction_parameters', await change('pinned', head, 640, 450))
    assert.equal(legacy.status, 'saved', JSON.stringify({ legacy, sqlErrors })); assert.equal((await read()).title, 'Wide frame 620x450x18')
  })
})

test('the publication versions two construction tools, the answer contract and two notes; schemas match the runtime', async () => {
  const publication = '20261029170100_bob_text_hygiene_catalog.sql'
  let before: any
  const pg = await projectSchema(async (db, name) => { if (name === publication) before = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m }, publication)
  try {
    const read = async () => (await pg.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
    const current = await read(), byKey = (m: any) => new Map<string, any>(m.definitions.map((d: any) => [d.prompt_key, d]))
    const was = byKey(before), now = byKey(current)
    assert.deepEqual([...now.keys()].filter(k => JSON.stringify(now.get(k)) !== JSON.stringify(was.get(k))).sort(),
      ['agent-contract.ask-bob', 'bob.note.answer-text', 'bob.note.answer-text-also', 'tools.change_construction_parameters', 'tools.edit_construction_parts'])
    const fixture = catalogFixture()
    for (const key of ['agent-contract.ask-bob', 'bob.note.answer-text', 'bob.note.answer-text-also', 'tools.change_construction_parameters', 'tools.edit_construction_parts']) {
      assert.deepEqual(fixture.definition(key).definition, now.get(key).definition, key); assert.equal(fixture.definition(key).content, now.get(key).content, key)
      assert.deepEqual(fixture.definition(key).metadata, now.get(key).metadata, key)
    }
    assert.equal(now.get('agent-contract.ask-bob').metadata.answer_text_version, 1)
    assert.equal(now.get('agent-contract.ask-bob').metadata.work_completion_version, 3)
    assert.deepEqual(fixture.tool('edit_construction_parts').function.parameters, withConstructionText(withConstructionWorkWrite(CONSTRUCTION_EDIT_TOOL)).function.parameters)
    assert.deepEqual(fixture.tool('change_construction_parameters').function.parameters, withConstructionText(withConstructionWorkWrite(CONSTRUCTION_PARAMETER_REFRESH_TOOL)).function.parameters)
    assert.equal((preTextHygieneCatalogFixture().tool('edit_construction_parts').function.parameters as any).properties.text, undefined)
    await pg.exec(readFileSync(new URL('../supabase/migrations/' + publication, import.meta.url), 'utf8'))
    assert.deepEqual(await read(), current, 're-applying is a no-op')
  } finally { await pg.close() }
})
