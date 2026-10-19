import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkRecords, type WorkSnapshot } from '../supabase/functions/_shared/project-work-records.ts'
import { createProjectEdits, type EditSnapshot } from '../supabase/functions/_shared/project-edits.ts'
import { createSolutionActions, type SolutionContext } from '../supabase/functions/_shared/project-solution-actions.ts'
import { createPlanLinks, type PlanLinkSnapshot } from '../supabase/functions/_shared/project-plan-links.ts'
import { createMaterialCatalogReader } from '../supabase/functions/_shared/material-catalog.ts'
import { createRecordDetailReader } from '../supabase/functions/_shared/project-record-detail.ts'
import { createOperationalReader } from '../supabase/functions/_shared/project-operations.ts'
import { createKnowledgeReader } from '../supabase/functions/_shared/building-knowledge.ts'
import type { ProjectWriter, WritePayload } from '../supabase/functions/_shared/project-write.ts'
import type { ProjectSource } from '../src/data/provenance.ts'

const projectId = 'project-a'
const updated = '2026-10-19T10:00:00Z'
const solutionId = '10000000-0000-4000-8000-000000000001'
const stepId = '20000000-0000-4000-8000-000000000001'
const quote = 'Update this record'
const change = { op: 'set', path: '/description', value_json: JSON.stringify('Requested content') }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const source = (): ProjectSource => ({ projectId, dataset: 'project', recordId: projectId, label: 'Project', retrievedAt: updated, updatedAt: updated, truth: 'unknown' })
function captureWriter() {
  const calls: { name: string; key: string; payload: WritePayload | null }[] = []
  const writer = { unresolvedTools: [], async commitBound(name: string, key: string, payload: WritePayload | null) {
    calls.push({ name, key, payload: structuredClone(payload) })
    // Simulate the canonical boundary rejecting stale pins. Restore must not
    // refresh, bypass or discard that outcome.
    return payload ? { status: 'conflict', message: 'Current record changed' } : { status: 'invalid', message: 'Invalid write' }
  } } as unknown as ProjectWriter
  return { calls, writer }
}

test('work checkpoint preserves issued refs, pagination, current records and live authority', async () => {
  const rows: WorkSnapshot[] = ['area-1', 'area-2', 'area-3'].map(id => ({ project_id: projectId, resource: 'areas', key: id, scope_label: 'Project', record: { id, updated_at: updated, name: id, description: 'Original', archived: false }, relations: {} }))
  const readInputs: unknown[] = [], { writer, calls } = captureWriter()
  let allowed = true
  const make = (id = projectId) => createWorkRecords({ projectId: id, writer, hasAccess: async () => allowed, read: async input => { readInputs.push(input); return { data: input.after ? [rows[2]] : rows, error: null } } })
  const initial = make(), first = await initial.execute('read_work_context', { resource: 'areas', query: null, next_ref: null })
  assert.equal(first.status, 'ok'); assert.ok(first.next_ref)
  const saved = copy(initial.exportState()), resumed = make()
  resumed.restoreState(saved)
  assert.deepEqual(resumed.exportState(), saved)
  assert.deepEqual(copy(resumed.currentRecords), copy(initial.currentRecords))
  assert.equal(resumed.remaining, 23)
  assert.equal(readInputs.length, 1, 'restore never reruns a read')
  saved.snapshots[0][1].record.name = 'Mutated external checkpoint'
  assert.equal(resumed.currentRecords[0].content.name, 'area-1')
  const args = { ref: first.entries[0].ref, changes: [change], reason: 'Requested change', request_quote: quote }
  assert.equal((await resumed.execute('edit_work_record', args)).status, 'conflict')
  assert.equal(calls[0].payload?.kind, 'bound_work')
  assert.equal((calls[0].payload?.data.pins as WorkSnapshot[])[0].record.updated_at, updated)
  assert.equal((calls[0].payload?.data.domain as WritePayload).record_id, 'area-1')
  assert.equal((await resumed.execute('read_work_context', { resource: 'areas', query: 'changed filter', next_ref: first.next_ref })).status, 'invalid')
  const next = await resumed.execute('read_work_context', { resource: 'areas', query: null, next_ref: first.next_ref })
  assert.equal(next.status, 'ok'); assert.deepEqual(readInputs.at(-1), { resource: 'areas', query: null, after: 'area-2' })
  allowed = false
  const before = calls.length
  assert.equal((await resumed.execute('edit_work_record', args)).status, 'denied')
  assert.equal(calls.length, before)
  assert.throws(() => make('other-project').restoreState(initial.exportState()), /invalid_work_records_state/)
})

test('edit checkpoint retains exact revisions, source array identity and issued page handles', async () => {
  const rows: EditSnapshot[] = ['solution-1', 'solution-2', 'solution-3'].map((key, index) => ({ project_id: projectId, resource: 'solutions', key, scope_label: 'Project', record: { id: solutionId.slice(0, -1) + (index + 1), revision: 7, title: key, description: 'Original', assumptions: '', tradeoffs: '', source_media_id: null, design_intent: null }, measurements: [], target: null }))
  let allowed = true
  const inputs: unknown[] = [], { writer, calls } = captureWriter()
  const make = (sources: ProjectSource[]) => createProjectEdits({ projectId, writer, sources, hasAccess: async () => allowed, read: async input => { inputs.push(input); return { data: input.after ? [rows[2]] : rows, error: null } } })
  const originalSources: ProjectSource[] = [], initial = make(originalSources)
  const first = await initial.execute('read_project_edit_context', { resource: 'solutions', query: null, next_ref: null })
  const restoredSources: ProjectSource[] = [source()], resumed = make(restoredSources), saved = copy(initial.exportState())
  resumed.restoreState(saved)
  assert.deepEqual(restoredSources, originalSources); assert.equal(restoredSources.length, 2)
  assert.deepEqual(resumed.exportState(), saved); assert.equal(resumed.remaining, 15)
  const args = { edit_ref: first.entries[0].edit_ref, changes: [change], reason: 'Requested change', request_quote: quote }
  assert.equal((await resumed.execute('edit_project_record', args)).status, 'conflict')
  assert.equal(calls[0].payload?.record_id, rows[0].record.id); assert.equal(calls[0].payload?.expected_revision, 7)
  assert.equal((await resumed.execute('read_project_edit_context', { resource: 'solutions', query: null, next_ref: first.next_ref })).status, 'ok')
  assert.deepEqual(inputs.at(-1), { resource: 'solutions', query: null, after: 'solution-2' })
  assert.equal(restoredSources.length, 3, 'future reads keep writing into the same shared array')
  allowed = false
  assert.equal((await resumed.execute('edit_project_record', args)).status, 'denied'); assert.equal(calls.length, 1)
})

test('solution checkpoint keeps evidence-bound choice refs and cannot restore caller authority', async () => {
  const row: SolutionContext = { project_id: projectId, resource: 'solutions', key: solutionId, scope_label: 'Project', record: { id: solutionId, revision: 3, title: 'Bed', description: 'Bed', assumptions: '', tradeoffs: '', source_media_id: 'old-image', design_intent: null }, measurements: [], target: null }
  let allowed = true
  const inputs: unknown[] = [], { writer, calls } = captureWriter()
  const make = () => createSolutionActions({ projectId, writer, hasAccess: async () => allowed, read: async input => { inputs.push(input); return { data: input.after ? [] : [row, { ...row, key: 'second' }, { ...row, key: 'third' }], error: null } } })
  const initial = make(), first = await initial.execute('read_solution_context', { resource: 'solutions', query: null, next_ref: null })
  const resumed = make(), saved = copy(initial.exportState()); resumed.restoreState(saved)
  assert.deepEqual(resumed.exportState(), saved); assert.equal(resumed.remaining, 15)
  const args = { solution_ref: first.entries[0].ref, action: 'clear_primary_image', source_ref: null, item_index: null, role: null, note: null, reason: 'Requested change', request_quote: quote }
  assert.equal((await resumed.execute('change_solution_evidence', args)).status, 'conflict')
  assert.equal(calls[0].payload?.kind, 'bound_solution_evidence'); assert.equal(calls[0].payload?.expected_revision, 3)
  assert.equal((await resumed.execute('read_solution_context', { resource: 'solutions', query: null, next_ref: first.next_ref })).status, 'ok')
  assert.deepEqual(inputs.at(-1), { resource: 'solutions', query: null, after: 'second' })
  allowed = false
  assert.equal((await resumed.execute('change_solution_evidence', args)).status, 'denied'); assert.equal(calls.length, 1)
})

test('plan checkpoint restores issued focus refs and retains the original plan revision', async () => {
  const row: PlanLinkSnapshot = { project_id: projectId, resource: 'steps', key: stepId, scope_label: 'Project', head: { current_revision: 4, focus_step_id: null }, record: { id: stepId, title: 'Prepare', goal: 'Cut', state: 'planned', notes: '', phase: 'design', area_name: null }, links: [] }
  let allowed = true
  const inputs: unknown[] = [], { writer, calls } = captureWriter()
  const make = () => createPlanLinks({ projectId, writer, hasAccess: async () => allowed, read: async input => { inputs.push(input); return { data: input.after ? [] : [row, row, row], error: null } } })
  const initial = make(), first = await initial.execute('read_plan_link_context', { resource: 'steps', query: null, next_ref: null })
  const resumed = make(), saved = copy(initial.exportState()); resumed.restoreState(saved)
  assert.deepEqual(resumed.exportState(), saved); assert.equal(resumed.remaining, 23)
  const args = { ref: first.entries[0].ref, action: 'set', reason: 'Requested change', request_quote: quote }
  assert.equal((await resumed.execute('change_plan_focus', args)).status, 'conflict')
  assert.equal(calls[0].payload?.kind, 'bound_plan_link')
  assert.equal((calls[0].payload?.data.pins as PlanLinkSnapshot[])[0].head.current_revision, 4)
  assert.equal((await resumed.execute('read_plan_link_context', { resource: 'steps', query: null, next_ref: first.next_ref })).status, 'ok')
  assert.deepEqual(inputs.at(-1), { resource: 'steps', query: null, after: stepId })
  allowed = false
  assert.equal((await resumed.execute('change_plan_focus', args)).status, 'denied'); assert.equal(calls.length, 1)
})

test('catalog checkpoint preserves read count, partial state and shared source evidence', async () => {
  let allowed = true, reads = 0
  const record = { id: solutionId, revision: 2, name: 'Pine', recorded_at: updated, has_unknown: true, properties: {} }
  const make = (sources: ProjectSource[]) => createMaterialCatalogReader(projectId, async () => { reads++; return { data: { projectId, status: 'ok', record }, error: null } }, async () => allowed, sources)
  const initialSources: ProjectSource[] = [], initial = make(initialSources)
  assert.equal((await initial.read('read_material_catalog', { entity: 'definition', id: solutionId, revision: 2 })).status, 'ok')
  await initial.read('read_material_catalog', {})
  const sources = [source()], resumed = make(sources), saved = copy(initial.exportState()); resumed.restoreState(saved)
  assert.deepEqual(sources, initialSources); assert.deepEqual(resumed.exportState(), saved)
  assert.equal(resumed.partial, true); assert.equal(resumed.remaining, 10); assert.equal(reads, 1)
  allowed = false
  assert.equal((await resumed.read('read_material_catalog', { entity: 'definition', id: solutionId, revision: 2 })).status, 'denied')
  assert.equal(reads, 1)
})

test('operational checkpoint preserves counters, partial reads and externally shared sources', async () => {
  let allowed = true, reads = 0
  const make = (sources: ProjectSource[]) => createOperationalReader(projectId, async () => { reads++; return { data: { projectId, records: [{ id: 'stock-1', name: 'Sheet', updated_at: updated }], truncated: true }, error: null } }, async () => allowed, sources)
  const initialSources: ProjectSource[] = [], initial = make(initialSources)
  const args = { resource: 'stock', record_id: null, after_id: null }
  await initial.execute(args)
  const sources = [source()], resumed = make(sources), saved = copy(initial.exportState()); resumed.restoreState(saved)
  assert.deepEqual(sources, initialSources); assert.deepEqual(resumed.exportState(), saved)
  assert.equal(resumed.partial, true); assert.equal(resumed.remaining, 15)
  allowed = false
  assert.equal((await resumed.execute(args)).status, 'denied'); assert.equal(reads, 1)
})

test('record detail checkpoint retains budget and checks access before reading', async () => {
  let allowed = true, reads = 0
  const make = () => createRecordDetailReader(async () => { reads++; return { summary: 'Current plan' } }, async () => allowed)
  const initial = make(), args = { dataset: 'plan', record_id: '4', revision: null, path: ['summary'] }
  assert.equal((await initial.execute(args)).status, 'ok')
  const resumed = make(), saved = copy(initial.exportState()); resumed.restoreState(saved)
  assert.deepEqual(resumed.exportState(), saved); assert.equal(resumed.remaining, 15)
  allowed = false
  await assert.rejects(resumed.execute(args), /project_denied/); assert.equal(reads, 1)
})

test('knowledge checkpoint keeps reference identity and original evidence without authorizing a read', async () => {
  let allowed = true
  const make = () => createKnowledgeReader(async () => allowed, () => new Date(updated))
  const initial = make(), args = { query: 'trä fukt', jurisdiction: 'SE' }
  assert.equal((await initial.execute(args)).status, 'ok'); assert.ok(initial.references.length)
  const resumed = make(), references = resumed.references, saved = copy(initial.exportState()); resumed.restoreState(saved)
  assert.equal(resumed.references, references); assert.deepEqual(references, initial.references)
  assert.deepEqual(resumed.exportState(), saved); assert.equal(resumed.remaining, 7)
  saved.references[0].title = 'External mutation'
  assert.notEqual(references[0].title, 'External mutation')
  allowed = false
  assert.equal((await resumed.execute(args)).status, 'denied')
})

test('all component checkpoints reject unknown versions and invalid counters without changing state', () => {
  const access = async () => true, read = async () => ({ data: [], error: null })
  const components = [
    createWorkRecords({ projectId, read, hasAccess: access }),
    createProjectEdits({ projectId, read, hasAccess: access }),
    createSolutionActions({ projectId, read, hasAccess: access }),
    createPlanLinks({ projectId, read, hasAccess: access }),
    createMaterialCatalogReader(projectId, read, access, []),
    createOperationalReader(projectId, read, access, []),
    createRecordDetailReader(async () => ({}), access),
    createKnowledgeReader(access),
  ]
  for (const component of components) {
    const state = component.exportState()
    assert.throws(() => component.restoreState({ ...state, version: 2 } as never), /invalid_.*_state/)
    assert.deepEqual(component.exportState(), state)
    const count = 'reads' in state ? 'reads' : 'used'
    assert.throws(() => component.restoreState({ ...state, [count]: -1 } as never), /invalid_.*_state/)
    assert.deepEqual(component.exportState(), state)
  }
})

test('bound readers preserve partial read status when a worker is reconstructed', async () => {
  const options = { projectId, hasAccess: async () => true, read: async () => ({ data: null, error: new Error('unavailable') }) }
  const readers = [
    { make: () => createWorkRecords(options), name: 'read_work_context', resource: 'areas' },
    { make: () => createProjectEdits(options), name: 'read_project_edit_context', resource: 'solutions' },
    { make: () => createSolutionActions(options), name: 'read_solution_context', resource: 'solutions' },
    { make: () => createPlanLinks(options), name: 'read_plan_link_context', resource: 'steps' },
  ]
  for (const { make, name, resource } of readers) {
    const initial = make()
    assert.equal((await initial.execute(name, { resource, query: null, next_ref: null })).status, 'unavailable')
    const resumed = make(); resumed.restoreState(copy(initial.exportState()) as never)
    assert.equal(resumed.partial, true); assert.equal(resumed.remaining, initial.remaining)
  }
})
