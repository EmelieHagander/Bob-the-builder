import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkRecords } from '../supabase/functions/_shared/project-work-records.ts'
import { createPlanLinks } from '../supabase/functions/_shared/project-plan-links.ts'
import { createProjectEdits } from '../supabase/functions/_shared/project-edits.ts'
import { createSolutionActions } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createOperationalReader } from '../supabase/functions/_shared/project-operations.ts'
import { createMaterialCatalogReader } from '../supabase/functions/_shared/material-catalog.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createKnowledgeReader } from '../supabase/functions/_shared/building-knowledge.ts'
import { createRecordDetailReader } from '../supabase/functions/_shared/project-record-detail.ts'
import { createProjectCalculator } from '../supabase/functions/_shared/project-calculator.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { compactReceipts, createProjectWriter, type WritePayload, type WriteReadback } from '../supabase/functions/_shared/project-write.ts'
import { isBobAnswerEvidence } from '../src/data/bobEvidence.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'

const noError = (data: unknown) => ({ data, error: null })
const emptySources = async () => ({ project: new Map(), physical: new Map() })
const unexpectedRead = async (): Promise<any> => { throw Error('unexpected read') }
const readArgs = (resource: string) => ({ resource, query: null, next_ref: null })

for (const [label, factory, name, resource, limit] of [
  ['work', createWorkRecords, 'read_work_context', 'tasks', 24],
  ['plan links', createPlanLinks, 'read_plan_link_context', 'tasks', 24],
  ['project content', createProjectEdits, 'read_project_edit_context', 'project_description', 16],
  ['solution actions', createSolutionActions, 'read_solution_context', 'solutions', 16],
] as const) test(`${label} reads continue past the legacy allowance and still require access`, async () => {
  for (const unlimitedWork of [false, true]) {
    let allowed = true, reads = 0
    const reader = factory({ projectId: 'A', unlimitedWork, hasAccess: async () => allowed,
      read: async () => { reads++; return noError([]) } })
    for (let i = 0; i < limit; i++) assert.equal((await reader.execute(name, readArgs(resource))).status, 'ok')
    assert.equal((await reader.execute(name, readArgs(resource))).status, unlimitedWork ? 'ok' : 'budget_exhausted')
    assert.equal(reader.remaining, unlimitedWork ? Infinity : 0)
    if (unlimitedWork) {
      allowed = false
      assert.equal((await reader.execute(name, readArgs(resource))).status, 'denied')
      assert.equal(reads, limit + 1, 'revoked access never reaches the transport')
    }
  }
})

test('specialized readers remove total call quotas while preserving access and payload contracts', async () => {
  for (const unlimitedWork of [false, true]) {
    let allowed = true, detail: unknown = { steps: [] }
    const hasAccess = async () => allowed
    const operations = createOperationalReader('A', async () => noError({ projectId: 'A', records: [], truncated: false }), hasAccess, [], { unlimitedWork })
    const catalog = createMaterialCatalogReader('A', async () => noError({ status: 'not_found', projectId: 'A' }), hasAccess, [], 10000, { unlimitedWork })
    const construction = createConstructionTools({ projectId: 'A', message: 'Read the drafts', hasAccess, unlimitedWork,
      read: async () => ({ projectId: 'A', status: 'not_found' }), readSources: emptySources })
    const knowledge = createKnowledgeReader(hasAccess, () => new Date('2026-10-17'), { unlimitedWork })
    const sections = createRecordDetailReader(async () => detail, hasAccess, { unlimitedWork })
    const cases = [
      { reader: operations, limit: 16, status: 'empty', run: () => operations.execute({ resource: 'task_work', record_id: null, after_id: null }) },
      { reader: catalog, limit: 12, status: 'not_found', run: () => catalog.read('read_material_catalog', { entity: 'definition', id: '10000000-0000-4000-8000-000000000001', revision: 1 }) },
      { reader: construction, limit: 12, status: 'not_found', run: () => construction.execute('read_construction_draft', { artifact_id: null, revision: null, after: null }) },
      { reader: knowledge, limit: 8, status: 'no_match', run: () => knowledge.execute({ query: 'zzzz-no-reference', jurisdiction: 'general' }) },
      { reader: sections, limit: 16, status: 'ok', run: () => sections.execute({ dataset: 'plan', record_id: '3', revision: null, path: [] }) },
    ]
    for (const c of cases) {
      for (let i = 0; i < c.limit; i++) assert.equal((await c.run()).status, c.status)
      assert.equal((await c.run()).status, unlimitedWork ? c.status : 'budget_exhausted')
      assert.equal(c.reader.remaining, unlimitedWork ? Infinity : 0)
    }
    if (unlimitedWork) {
      detail = { content: 'x'.repeat(24001) }
      assert.equal((await cases.at(-1)!.run()).status, 'too_large')
      assert.equal((await sections.execute({ dataset: 'plan', record_id: '3', revision: null, path: ['constructor'] })).status, 'invalid')
      allowed = false
      for (const c of cases.slice(0, -1)) assert.equal((await c.run()).status, 'denied')
      await assert.rejects(cases.at(-1)!.run(), /project_denied/)
    }
  }
})

test('lookup keeps page validation after removing the total read allowance', async () => {
  const request = { dataset: 'tasks', query: null, status: null, area_id: null, record_id: null, after_id: null }
  for (const unlimitedWork of [false, true]) {
    let records: any[] = [], calls = 0
    const lookup = createProjectLookup('A', async () => { calls++; return noError({ records, related: [], truncated: false }) }, 10000, 3, 32768, { unlimitedWork })
    for (let i = 0; i < 3; i++) assert.equal((await lookup.search(request)).status, 'empty')
    assert.equal((await lookup.search(request)).status, unlimitedWork ? 'empty' : 'budget_exhausted')
    assert.equal(lookup.remaining, unlimitedWork ? Infinity : 0)
    if (unlimitedWork) {
      records = Array.from({ length: 26 }, (_, i) => ({ id: `task-${i}` }))
      const page = await lookup.search(request)
      assert.equal(page.status, 'ok')
      assert.equal(page.records.length, 25, 'individual pages remain bounded')
      assert.equal(page.truncated, true)
      assert.equal(calls, 5)
    }
  }
})

test('calculator continues after twelve results and still obeys live policy and access', async () => {
  const calculation = { calculation: { method: 'parameter_graph_v1', nodes: [
    { id: 'a', role: 'decision', value: 18, unit: 'mm', reason: 'Chosen thickness' },
    { id: 'n', role: 'decision', value: 2, unit: 'scalar', reason: 'Two panels' },
    { id: 'twice', role: 'derived', operation: 'multiply_v1', operands: ['a', 'n'], rounding: 'exact' },
  ], outputs: ['twice'] } }
  for (const unlimitedWork of [false, true]) {
    let allowed = true, enabled = true
    const calculator = createProjectCalculator({ projectId: 'A', unlimitedWork, hasAccess: async () => allowed,
      isEnabled: async () => enabled, readSources: emptySources, readSource: unexpectedRead, readConstruction: unexpectedRead, quotePacks: unexpectedRead })
    for (let i = 0; i < 12; i++) assert.equal((await calculator.execute(calculation)).status, 'calculated')
    assert.equal((await calculator.execute(calculation)).status, unlimitedWork ? 'calculated' : 'budget_exhausted')
    assert.equal(calculator.remaining, unlimitedWork ? Infinity : 0)
    assert.equal((await calculator.offered()).length, unlimitedWork ? 1 : 0)
    if (unlimitedWork) {
      enabled = false
      assert.equal((await calculator.execute(calculation)).status, 'unavailable')
      assert.equal((await calculator.offered()).length, 0)
      enabled = true; allowed = false
      assert.equal((await calculator.execute(calculation)).status, 'denied')
    }
  }
})

const time = '2026-10-17T12:00:00.000Z'
const payload = (id: string): WritePayload => ({ kind: 'task', record_id: id, expected_updated_at: time,
  expected_revision: null, request_quote: 'Update tasks', data: { name: id } })
const receipt = (id: string): WriteReadback => ({ projectId: 'A', dataset: 'tasks', recordId: id,
  label: id, operation: 'updated', savedAt: time, record: { id, name: id, status: 'todo' } })

test('writer allows more than 32 saves and 12 corrections only for newly opted-in jobs', async () => {
  for (const unlimitedWork of [false, true]) {
    let saved = 0
    const writer = createProjectWriter('A', 'Update tasks', async p => { saved++; return noError(receipt(p.record_id!)) },
      async () => noError([]), async () => noError({ generation: 2, receipts: [] }), { unlimitedWork })
    for (let i = 0; i < 32; i++) assert.equal((await writer.commit(payload(`task-${i}`))).status, 'saved')
    for (let i = 32; i < 40; i++) assert.equal((await writer.commit(payload(`task-${i}`))).status, unlimitedWork ? 'saved' : 'budget_exhausted')
    assert.equal(saved, unlimitedWork ? 40 : 32)
    assert.equal(writer.remaining, unlimitedWork ? Infinity : 0)
    const correcting = createProjectWriter('A', 'Update tasks', async p => noError(receipt(p.record_id!)),
      async () => noError([]), async () => noError({ generation: 2, receipts: [] }), { unlimitedWork })
    for (let i = 0; i < 12; i++) assert.equal((await correcting.commitBound('edit_work_record', `task-${i}`, null)).status, 'invalid')
    assert.equal(correcting.needsRepair, unlimitedWork)
    assert.equal(correcting.correctionsRemaining, unlimitedWork ? Infinity : 0)
    for (let i = 0; i < 12; i++) assert.equal((await correcting.commitBound('edit_work_record', `task-${i}`, payload(`task-${i}`))).status, unlimitedWork ? 'saved' : 'budget_exhausted')
    assert.equal(correcting.hasUnresolvedWrites, !unlimitedWork)
  }
})

test('large receipt recovery, settlement and transcript validation retain every valid saved target', async () => {
  const receipts = Array.from({ length: 40 }, (_, i) => receipt(`task-${i}`))
  const writer = createProjectWriter('A', 'Update tasks', unexpectedRead, async () => noError(receipts),
    async () => noError({ generation: 2, receipts }), { unlimitedWork: true })
  assert.equal((await writer.recover()).length, 40)
  assert.equal(await writer.settle(), 2)
  assert.equal(writer.receipts.length, 40)
  assert.equal(writer.remaining, 0, 'settlement still closes the writer')
  assert.equal((await writer.commit(payload('task-next'))).status, 'denied')
  const evidence = { kind: 'ai_assessment', partial: false, sources: [], writes: compactReceipts(receipts) }
  assert.equal(isBobAnswerEvidence(evidence, 'A'), true)
  assert.equal(isBobAnswerEvidence({ ...evidence, writes: [...evidence.writes, { ...evidence.writes[0], projectId: 'B' }] }, 'A'), false)
  assert.equal(isBobAnswerEvidence({ ...evidence, writes: [...evidence.writes, { ...evidence.writes[0], savedAt: 'invalid' }] }, 'A'), false)
  const legacy = createProjectWriter('A', 'Update tasks', unexpectedRead, async () => noError(receipts), async () => noError({ generation: 2, receipts }))
  await assert.rejects(legacy.recover(), /Write recovery unavailable/)
  await assert.rejects(legacy.settle(), /Write settlement unavailable/)
  const foreign = createProjectWriter('A', 'Update tasks', unexpectedRead, async () => noError([...receipts, { ...receipts[0], projectId: 'B' }]), async () => noError({ generation: 2, receipts: [] }), { unlimitedWork: true })
  await assert.rejects(foreign.recover())
  assert.equal(foreign.receipts.length, 0, 'one invalid receipt rejects recovery before exposing partial success')
})

test('unlimited writes still stop after an uncertain transport without repeating the mutation', async () => {
  let writes = 0
  const writer = createProjectWriter('A', 'Update tasks', async () => { writes++; throw Error('lost write response') },
    async () => noError([]), async () => noError({ generation: 2, receipts: [] }), { unlimitedWork: true })
  assert.equal((await writer.commit(payload('task-1'))).status, 'unknown')
  assert.equal(writer.uncertain, true)
  assert.equal(writer.remaining, 0)
  assert.equal((await writer.commit(payload('task-2'))).status, 'unknown')
  assert.equal(writes, 1)
})

test('both supported completion contracts refresh rejected task status through the real tool session', async () => {
  for (const version of [undefined, 0, 1, 2, 3, '2']) {
    let refreshes = 0
    const aiCatalog = catalogFixture(snapshot => {
      const contract = snapshot.definitions.find(row => row.prompt_key === 'agent-contract.ask-bob')!
      if (version === undefined) delete contract.metadata.work_completion_version
      else contract.metadata.work_completion_version = version
    })
    const writer = createProjectWriter('A', 'Update tasks', async () => ({ data: null, error: { code: 'P0001', message: 'Complete required checks before marking this task done.' } }),
      async () => noError([]), async () => noError({ generation: 2, receipts: [] }), { taskWorkDiagnostics: true })
    const snapshot = { project_id: 'A', resource: 'tasks' as const, key: 'task-A', scope_label: 'Assembly',
      record: { id: 'task-A', name: 'Inspect fastening', instructions: 'Inspect it', status: 'todo', updated_at: time },
      relations: { people: [], instructions: [{ id: 'private-check-id', title: 'Check fastening', instructions: 'Inspect it', required: true, is_checkpoint: true, completed_at: null }] } }
    const workRecords = createWorkRecords({ projectId: 'A', writer, hasAccess: async () => true, read: async () => noError([snapshot]),
      readSnapshot: async () => { refreshes++; return noError(snapshot) } })
    const tools = createBobToolSession({ aiCatalog, writer, workRecords, lookup: createProjectLookup('A', unexpectedRead),
      readPolicy: async () => ({ phase: 'design', tools: ['read_work_context', 'change_work_state'].map(name => ({ name, description: name, how_to: '', schema_version: 1, always_load: true, preload_phases: [], active: true })) }) })
    await tools.prepare()
    const read = await tools.execute('read_work_context', readArgs('tasks')) as any
    const result = await tools.execute('change_work_state', { ref: read.entries[0].ref, action: 'status', value: 'done', reason: 'Requested update', request_quote: 'Update tasks' }) as any
    const supported = version === 1 || version === 2
    assert.equal(result.status, 'invalid')
    assert.equal(result.validation.code, 'task_required_checks')
    assert.equal(refreshes, supported ? 1 : 0, `completion version ${version}`)
    if (supported) {
      assert.equal(result.current.content.status, 'todo')
      assert.equal(result.current.content.instruction_steps[0].completed, false)
      assert.equal(JSON.stringify(result.current).includes('private-check-id'), false)
    } else assert.equal(result.current, undefined)
  }
})
