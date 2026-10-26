import { test } from 'node:test'
import assert from 'node:assert/strict'
import { humanTextIssues, humanTextRejection, proseFields } from '../supabase/functions/_shared/human-text.ts'
import { createProjectWriter, WRITE_TOOLS, WRITE_TOOL_PROSE, type WritePayload } from '../supabase/functions/_shared/project-write.ts'
import { createWorkRecords, type WorkSnapshot } from '../supabase/functions/_shared/project-work-records.ts'
import { createProjectEdits, type EditSnapshot } from '../supabase/functions/_shared/project-edits.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createProjectImageTools } from '../supabase/functions/_shared/project-image-tools.ts'
import { createOperationalReader, recordLabel } from '../supabase/functions/_shared/project-operations.ts'
import type { ProjectSource } from '../src/data/provenance.ts'

const id = '3f2a9c1e-4b5d-4c3a-9e8f-1a2b3c4d5e6f'
const kinds = (text: string) => humanTextIssues(text).map(i => i.kind)

test('audit fragments are found with their kind', () => {
  const cases: [string, string[], string[]][] = [
    [`Mät väggen igen [${id}@1].`, ['record_id'], [`${id}@1`]],
    [`Måttet har ersatts av ${id}@3.`, ['record_id'], [`${id}@3`]],
    [`Revision av artifact ${id} rev1`, ['record_id', 'revision_ref'], [id, 'rev1']],
    ['Bredd 900 mm (provided_spec)', ['internal_code'], ['provided_spec']],
    ['Gaveln left_gable sitter mot shelf_panel@2', ['internal_code', 'internal_code'], ['left_gable', 'shelf_panel@2']],
    ['Ritningen väntar: needs_data', ['internal_code'], ['needs_data']],
    ['Ändra med edit_work_record eller read_construction_draft', ['tool_name', 'tool_name'], ['edit_work_record', 'read_construction_draft']],
    ['Tabellen bob_project_write_v21 och work_9f8e7d6c', ['internal_code', 'internal_code'], ['bob_project_write_v21', 'work_9f8e7d6c']],
    ['Ritningen (rev 4) och ritningen rev 3 visar hyllan.', ['revision_ref', 'revision_ref'], ['rev 4', 'rev 3']],
    ['Se Revision 2 av planen.', ['revision_ref'], ['Revision 2']],
    ['Öppna /tasks/abc eller #/artifacts?drawing=x', ['internal_link', 'internal_link'], ['/tasks/abc', '#/artifacts?drawing=x']],
    ['Se [ritningen](/artifacts?drawing=x&revision=2).', ['internal_link'], ['[ritningen](/artifacts?drawing=x&revision=2)']],
    ['Se https://emeliehagander.github.io/Bob-the-builder/#/tasks/abc', ['internal_link'], ['https://emeliehagander.github.io/Bob-the-builder/#/tasks/abc']],
    ['Fältet recordId saknas', ['internal_code'], ['recordId']],
    ['Hash 9f8e7d6c5b4a39281706f5e4d3c2b1a0', ['record_id'], ['9f8e7d6c5b4a39281706f5e4d3c2b1a0']],
  ]
  for (const [text, expectedKinds, fragments] of cases) {
    const issues = humanTextIssues(text)
    assert.deepEqual(issues.map(i => i.kind), expectedKinds, text)
    assert.deepEqual(issues.map(i => i.fragment), fragments, text)
  }
})

test('ordinary Swedish and English prose, measurements, web addresses and file names pass', () => {
  for (const text of [
    'N-sida: fönster karm-till-karm 1180 mm, mätt av Emelie 2026-10-20.',
    'Vi rev 3 väggar i köket. Vi rev 3. Emelie rev 40 kvm kakel igår. Rev 2 skåp i hallen.',
    'Reglar 45x95 C24, c/c 600, och/eller 12/24 V. Tak/golv ska tätas; ca 1 200 kr/m², Ø8 @150.',
    'Version 2 av ritningen är klar; byt till plan B om leveransen dröjer.',
    'Measure the north wall from frame to frame and keep a 10 mm gap.',
    'Se https://www.bauhaus.se/produkt_123?id=a1b2 och mejla anna_svensson@example.com.',
    'Bild IMG_2041.jpg och IMG_2042 visar sprickan; ritning_v2.pdf är bifogad.',
    'iPhone-bild, macOS, 760 mmHg. _Viktigt_: __Obs__ – täta skarvarna.',
    '[Leverantörens datablad](https://example.com/data_blad.pdf)',
    '', '   ',
  ]) assert.deepEqual(humanTextIssues(text), [], text)
})

test('prose paths select only human text, at any index or key', () => {
  const value = { title: 'Hylla', key: 'left_gable', design_intent: { purpose: 'concept', choices: [{ id: 'c_1', question: 'Q', status: 'open', alternatives: ['A', 'B'] }], features: [{ id: 'f_1', description: 'D', basis: 'user_request' }] }, properties: { thickness: { value: '18', note: 'N' } } }
  assert.deepEqual(proseFields(value, ['title', 'design_intent.choices.*.question', 'design_intent.choices.*.alternatives.*', 'design_intent.features.*.description', 'properties.*.note']),
    [['title', 'Hylla'], ['design_intent.choices.0.question', 'Q'], ['design_intent.choices.0.alternatives.0', 'A'], ['design_intent.choices.0.alternatives.1', 'B'], ['design_intent.features.0.description', 'D'], ['properties.thickness.note', 'N']])
  assert.deepEqual(proseFields({ question: 'Q' }, ['design_intent.choices.*.question'], ['design_intent', 'choices', '-']), [['design_intent.choices.-.question', 'Q']])
})

test('the rejection names fields and kinds, shows the fragments and suggests no wording', () => {
  assert.equal(humanTextRejection([['name', 'Montera hyllan'], ['notes', null]]), null)
  const rejection = humanTextRejection([['instructions', `Se ${id}@1 och needs_data`], ['name', 'Montera hyllan'], ['change_note', 'Bytt via edit_work_record']])!
  assert.deepEqual(rejection.fields, ['instructions', 'change_note'])
  assert.deepEqual(rejection.kinds, ['record_id', 'internal_code', 'tool_name'])
  assert.match(rejection.message, /^instructions, change_note: database IDs and internal codes and tool names found \("3f2a9c1e-[^"]+@1", "needs_data", "edit_work_record"\)\. /)
  assert.doesNotMatch(rejection.message, /e\.g\.|for example|such as|like "|t\.ex/i)
})

test('every human prose path names a field the write tool offers', () => {
  const offered = (schema: any, path: string[]): boolean => {
    if (!path.length) return true
    if (schema?.anyOf) return schema.anyOf.some((s: any) => offered(s, path))
    const [head, ...rest] = path
    if (head === '*') return offered(schema?.items ?? schema?.additionalProperties ?? {}, rest) || schema?.type === 'object' && !schema.properties
    if (schema?.properties?.[head]) return offered(schema.properties[head], rest)
    return schema?.additionalProperties === true || schema?.type === 'object' && !schema.properties
  }
  for (const [name, paths] of Object.entries(WRITE_TOOL_PROSE)) {
    const tool = WRITE_TOOLS.find(t => t.function.name === name)
    assert(tool, name)
    for (const path of paths) assert(offered(tool.function.parameters, path.split('.')), name + ' ' + path)
  }
})

const message = 'Spara uppgiften och ändra mätningen'
const receipt = (dataset: string, recordId: string, label: string, record: Record<string, unknown> = {}) =>
  ({ projectId: 'A', dataset, recordId, label, operation: 'updated', savedAt: '2026-10-26T10:00:00.000Z', record: { id: recordId, ...record } })
function writerFixture(reply: (payload: WritePayload) => unknown = p => receipt('tasks', 'taskA', 'Task')) {
  const sent: WritePayload[] = []
  const writer = createProjectWriter('A', message, async payload => { sent.push(payload); return { data: reply(payload), error: null } },
    async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }), { unlimitedWork: true })
  return { writer, sent }
}

test('legacy writes reject prose with IDs or codes as invalid with no write, and save clean text', async () => {
  const { writer, sent } = writerFixture()
  const task = { record_id: null, area_id: 'areaA', step_id: null, name: 'Montera hyllan', instructions: `Följ ritningen [${id}@1].`, expected_updated_at: null, request_quote: 'Spara uppgiften' }
  const rejected = await writer.write('save_project_task', task)
  assert.equal(rejected.status, 'invalid'); assert.deepEqual(rejected.validation, { code: 'human_text', fields: ['instructions'] })
  assert.match(rejected.message!, /^No change made\. instructions: database IDs found/); assert.equal(sent.length, 0)
  assert.deepEqual(writer.unresolvedTools, ['save_project_task'])
  const saved = await writer.write('save_project_task', { ...task, instructions: 'Följ ritningen för hyllan.' })
  assert.equal(saved.status, 'saved'); assert.equal(sent.length, 1); assert.equal(sent[0].data.instructions, 'Följ ritningen för hyllan.')
  assert.equal(writer.hasUnresolvedWrites, false)
  // Typed fields keep their identifiers; quotes of the owner are not prose fields.
  const solution = await writer.write('save_building_context', { building_id: null, expected_building_revision: 0, new_building_name: 'Huset', new_building_notes: 'Tvåvåningshus.',
    operations: [{ key: 'kok_1', kind: 'space', record_id: null, expected_revision: 0, mode: 'existing', source_quote: 'Spara uppgiften', source_seq: null, fields: { name: 'Kök', kind: 'kitchen_area', notes: '' } }], request_quote: 'Spara uppgiften' })
  assert.equal(solution.status, 'invalid'); assert.deepEqual(solution.validation, { code: 'human_text', fields: ['operations.0.fields.kind'] }); assert.equal(sent.length, 1)
})

test('text another colleague wrote (a compiled plan) can skip the check; Bob\'s own calls cannot', async () => {
  const { writer, sent } = writerFixture()
  const task = { record_id: null, area_id: 'areaA', step_id: null, name: 'Montera needs_data', instructions: '', expected_updated_at: null, request_quote: 'Spara uppgiften' }
  assert.equal((await writer.write('save_project_task', task)).validation?.code, 'human_text')
  assert.equal((await writer.write('save_project_task', task, { humanText: false })).status, 'saved'); assert.equal(sent.length, 1)
})

const task: WorkSnapshot = { project_id: 'A', resource: 'tasks', key: 'taskA', scope_label: 'Assembly',
  record: { id: 'taskA', name: 'Montera', instructions: `Gammal text med needs_data och ${id}`, area_id: 'areaA', primary_step_id: null, status: 'todo', updated_at: '2026-10-20T10:00:00.000Z' },
  relations: { people: [], instructions: [], needs: [], dependencies: [] } }
const measurement: WorkSnapshot = { project_id: 'A', resource: 'measurements', key: id, scope_label: 'Assembly',
  record: { id, subject: 'Bredd', value: '900', unit: 'mm', truth: 'measured', source: 'Måttband', notes: '', required: true, revision: 2, source_media_id: null },
  relations: {} }
function workFixture() {
  const { writer, sent } = writerFixture(p => p.data.domain && (p.data.domain as WritePayload).kind === 'measurement'
    ? { ...receipt('measurements', id, 'Bredd'), revision: 3 } : receipt('tasks', 'taskA', 'Montera hyllan'))
  const work = createWorkRecords({ projectId: 'A', writer, hasAccess: async () => true, unlimitedWork: true,
    read: async input => ({ data: input.resource === 'tasks' ? [task] : [measurement], error: null }) })
  return { work, sent }
}

test('work records reject only the prose a change supplies; unchanged saved text never blocks an edit', async () => {
  const { work, sent } = workFixture()
  const [taskRef] = (await work.execute('read_work_context', { resource: 'tasks', query: null, next_ref: null }, 2)).entries.map((e: any) => e.ref)
  const bad = await work.execute('edit_work_record', { ref: taskRef, changes: [{ op: 'append_text', path: '/instructions', value: ' Se /tasks/taskB.' }], reason: 'Ägaren bad', request_quote: 'Spara uppgiften' }, 2)
  assert.equal(bad.status, 'invalid'); assert.deepEqual(bad.validation, { code: 'human_text', fields: ['instructions'] }); assert.match(bad.message, /^No change made\. instructions: app links or paths found/)
  assert.equal(sent.length, 0)
  const renamed = await work.execute('edit_work_record', { ref: taskRef, changes: [{ op: 'set', path: '/name', value: 'Montera hyllan' }], reason: 'Ägaren bad', request_quote: 'Spara uppgiften' }, 2)
  assert.equal(renamed.status, 'saved'); assert.equal(sent.length, 1)
  assert.equal(((sent[0].data.domain as WritePayload).data as any).instructions, task.record.instructions, 'existing text is preserved untouched')
  // A JSON-encoded schema-1 value is checked the same way.
  const legacy = await work.execute('edit_work_record', { ref: taskRef, changes: [{ op: 'set', path: '/name', value_json: JSON.stringify('Montera left_gable') }], reason: 'Ägaren bad', request_quote: 'Spara uppgiften' }, 1)
  assert.deepEqual(legacy.validation, { code: 'human_text', fields: ['name'] }); assert.equal(sent.length, 1)
})

test('a measurement reason becomes its change note and must be prose; other reasons are not saved', async () => {
  const { work, sent } = workFixture()
  const [ref] = (await work.execute('read_work_context', { resource: 'measurements', query: null, next_ref: null }, 2)).entries.map((e: any) => e.ref)
  const bad = await work.execute('edit_work_record', { ref, changes: [{ op: 'set', path: '/value', value: '910' }], reason: `Ersätter ${id}@2`, request_quote: 'ändra mätningen' }, 2)
  assert.deepEqual(bad.validation, { code: 'human_text', fields: ['reason'] }); assert.equal(sent.length, 0)
  const unit = await work.execute('edit_work_record', { ref, changes: [{ op: 'set', path: '/truth', value: 'provided_spec' }], reason: 'Ägaren angav måttet', request_quote: 'ändra mätningen' }, 2)
  assert.equal(unit.status, 'saved', 'typed values such as truth are not prose'); assert.equal(sent.length, 1)
  const [taskRef] = (await work.execute('read_work_context', { resource: 'tasks', query: null, next_ref: null }, 2)).entries.map((e: any) => e.ref)
  const status = await work.execute('change_work_state', { ref: taskRef, action: 'status', value: 'doing', reason: 'Bytt via change_work_state', request_quote: 'Spara uppgiften' }, 2)
  assert.notEqual(status.validation?.code, 'human_text')
})

test('project edits and solution actions reject coded prose in content, reasons and notes', async () => {
  const { writer, sent } = writerFixture(() => ({ ...receipt('solutions', 'sol1', 'Hylla', { title: 'Hylla', description: 'Ny', assumptions: '', tradeoffs: '', source_media_id: null, design_intent: null }), revision: 2, related_receipts: [] }))
  const snapshot: EditSnapshot = { project_id: 'A', key: 'sol1', resource: 'solutions', scope_label: 'Project',
    record: { id: 'sol1', revision: 1, title: 'Hylla', description: 'Gammal', assumptions: '', tradeoffs: '', source_media_id: null, design_intent: null }, measurements: [], target: null }
  const edits = createProjectEdits({ projectId: 'A', writer, hasAccess: async () => true, unlimitedWork: true, read: async () => ({ data: [snapshot], error: null }) })
  const [{ edit_ref }] = (await edits.execute('read_project_edit_context', { resource: 'solutions', query: null, next_ref: null })).entries
  const set = (path: string, value: unknown) => ({ op: 'set', path, value_json: JSON.stringify(value) })
  const bad = await edits.execute('edit_project_record', { edit_ref, changes: [set('/description', 'Se rev 3'), set('/design_intent/summary', 'Hylla med shelf_panel')], reason: 'Ägaren bad', request_quote: 'Spara uppgiften' })
  assert.equal(bad.status, 'invalid'); assert.deepEqual(bad.validation, { code: 'human_text', fields: ['description', 'design_intent.summary'] }); assert.equal(sent.length, 0)
  const saved = await edits.execute('edit_project_record', { edit_ref, changes: [set('/description', 'Ny')], reason: 'Ägaren bad', request_quote: 'Spara uppgiften' })
  assert.equal(saved.status, 'saved'); assert.equal(sent.length, 1)

  const actions = createSolutionActions({ projectId: 'A', writer, hasAccess: async () => true, unlimitedWork: true, read: async () => ({ data: [], error: null }) })
  const select = await actions.execute('select_solution_alternative', { solution_ref: 'x', scope_ref: 'y', reason: `Valde ${id}`, request_quote: 'Spara uppgiften' })
  assert.deepEqual(select.validation, { code: 'human_text', fields: ['reason'] })
  const created = await actions.execute('create_solution_alternative', { scope_ref: 'y', base_ref: null, changes: [set('/design_intent/choices/-', { question: 'Vilken gavel?', alternatives: ['left_gable'] })], reason: 'Ägaren bad', request_quote: 'Spara uppgiften' })
  assert.deepEqual(created.validation, { code: 'human_text', fields: ['design_intent.choices.-.alternatives.0'] })
  const clean = await actions.execute('select_solution_alternative', { solution_ref: 'x', scope_ref: 'y', reason: 'Ägaren valde', request_quote: 'Spara uppgiften' })
  assert.equal(clean.status, 'invalid'); assert.equal(clean.validation, undefined, 'clean prose reaches the ordinary checks')
  assert.equal(sent.length, 1)
})

test('construction writes reject coded prose before any preparation; typed instance IDs are fine', async () => {
  let prepared = 0
  const { writer } = writerFixture()
  const tools = createConstructionTools({ projectId: 'A', message: 'Klassa delarna', writer, hasAccess: async () => true, unlimitedWork: true,
    read: async () => null, readSources: async () => ({ project: new Map(), physical: new Map() }), prepareRoleChange: async () => { prepared++; return { status: 'unavailable' } } })
  const roles = { key: 'roles-1', record_id: id, expected_revision: 1, change_note: 'Gaveln tillverkas', request_quote: 'Klassa delarna',
    changes: [{ instance_id: 'left_gable', role: 'build_part', quantity_policy: 'manufacture', reason: 'Snickras av ägaren (provided_spec)' }] }
  const bad = await tools.execute('change_construction_roles', roles)
  assert.equal(bad.status, 'invalid'); assert.deepEqual(bad.validation, { code: 'human_text', fields: ['changes.0.reason'] }); assert.equal(prepared, 0)
  const clean = await tools.execute('change_construction_roles', { ...roles, changes: [{ ...roles.changes[0], reason: 'Snickras av ägaren' }] })
  assert.equal(clean.status, 'unavailable'); assert.equal(prepared, 1)
})

test('an image title must be prose before anything is generated', async () => {
  let generated = 0
  const tools = createProjectImageTools({ projectId: 'A', message: 'Gör bilden', deadline: Date.now() + 200000, hasAccess: async () => true,
    writer: { remaining: 8, commit: async () => ({ status: 'saved' }) } as any, generate: async () => { generated++; return { ok: false as const, error: 'no' } }, upload: async () => {} })
  const result = await tools.execute('generate_project_image', { prompt: 'Hylla i hallen', title: 'Hylla shelf_panel', purpose: 'proposal', target_kind: 'project', target_id: 'A', reference_image_ids: [], request_quote: 'Gör bilden' })
  assert.equal(result.status, 'invalid'); assert.deepEqual(result.validation, { code: 'human_text', fields: ['title'] }); assert.equal(generated, 0)
})

test('receipt and source labels never fall back to a raw record ID', async () => {
  assert.equal(recordLabel('stock', { id }), 'Stock item'); assert.equal(recordLabel('build_day', { id, title: ' ' }), 'Build day')
  assert.equal(recordLabel('task_work', { id, task_name: 'Montera' }), 'Montera'); assert.equal(recordLabel('unknown', { id }), 'Project record')
  const sources: ProjectSource[] = []
  const reader = createOperationalReader('A', async () => ({ data: { projectId: 'A', records: [{ id, quantity: 2 }], truncated: false }, error: null }), async () => true, sources)
  await reader.execute({ resource: 'stock', record_id: null, after_id: null })
  assert.equal(sources[0].label, 'Stock item')
  const { writer } = writerFixture(() => ({ ...receipt('media', id, id), operation: 'deleted' }))
  const saved = await writer.commit({ kind: 'lifecycle', record_id: id, expected_updated_at: null, expected_revision: null, request_quote: 'Spara uppgiften', data: {} })
  assert.equal(saved.receipt?.label, 'Image')
})
