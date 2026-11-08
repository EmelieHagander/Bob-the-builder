import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectWriter, MATERIAL_REFUSALS, type WriteReadback } from '../supabase/functions/_shared/project-write.ts'
import { compactRequirementPage, createOperationalReader, MATERIAL_DATA_KEYS, parseOperationalWrite } from '../supabase/functions/_shared/project-operations.ts'
import { parseCatalogWrite } from '../supabase/functions/_shared/material-catalog.ts'
import type { WriteValidationIssue } from '../supabase/functions/_shared/project-write.ts'

// Våningssäng 2 run, 2026-11-08 16:06–16:28.
const noError = (data: unknown) => ({ data, error: null })
const id = '91ef4e5a-e0bf-4cfd-aad8-3d52a7be59a9'

test('stock/requirement commands take only the fields the database accepts; archive, restore and publish take data {}', () => {
  const issues: WriteValidationIssue[] = []
  const write = (action: string, data: Record<string, unknown>, resource = 'requirement') => parseOperationalWrite('manage_project_material',
    { resource, action, record_id: action === 'create' ? null : id, expected_revision: action === 'create' ? 0 : 2, expected_updated_at: null, request_quote: 'A', data }, issue => issues.push(issue))
  assert.equal(write('archive', { change_note: 'Panelen finns inte längre' }), null)
  assert.deepEqual(issues.pop()?.fields, ['data.change_note'])
  assert.equal(write('publish', { change_note: 'x' }), null)
  assert.equal(issues.pop()?.code, 'domain_fields')
  assert.equal(write('restore', { reason: 'x' }, 'stock'), null)
  assert.deepEqual(write('archive', {})?.data, { resource: 'requirement', action: 'archive', fields: {} })
  assert.equal(write('create', { name: 'Skruv', unit: 'pcs', required_quantity: '4', revision: 3 }), null)
  assert.deepEqual(issues.pop()?.fields, ['data.revision'])
  assert(write('revise', { name: 'Plywood', sheet_format: null, household_stock_id: null }, 'stock'))
  assert.deepEqual(Object.keys(MATERIAL_DATA_KEYS.requirement).sort(), ['archive', 'create', 'publish', 'restore', 'revise'])
})

test('a known database sentence becomes a code and fixed guidance, never the raw text or an unexplained db_p0001', async () => {
  for (const [sentence, [code, , conflict]] of Object.entries(MATERIAL_REFUSALS)) {
    const writer = createProjectWriter('A', 'A', async () => ({ data: null, error: { code: 'P0001', message: sentence } }), async () => noError([]), async () => noError({ generation: 2, receipts: [] }), { rejectionReasons: true })
    const result = await writer.write('manage_project_material', { resource: 'requirement', action: 'archive', record_id: id, expected_revision: 2, expected_updated_at: null, request_quote: 'A', data: {} })
    assert.equal(result.status, conflict ? 'conflict' : 'invalid', sentence)
    assert.equal((result as { reason?: string }).reason, code)
    assert.match(result.message ?? '', /^No change made\. /)
    assert(!(result.message ?? '').includes(sentence), sentence)
  }
  const writer = createProjectWriter('A', 'A', async () => ({ data: null, error: { code: 'P0001', message: 'Some other sentence' } }), async () => noError([]), async () => noError({ generation: 2, receipts: [] }), { rejectionReasons: true })
  const other = await writer.write('manage_project_material', { resource: 'requirement', action: 'archive', record_id: id, expected_revision: 2, expected_updated_at: null, request_quote: 'A', data: {} })
  assert.equal((other as { reason?: string }).reason, 'db_p0001')
})

test('a delegated design choice is sourced from the current request by code; an owner statement still needs its own quote', () => {
  const args = { action: 'ensure', key: 'plywood', kind: 'material', record_id: null, expected_revision: 0, name: 'Plywood 1220×2440', aliases: [],
    profile_code: 'sheet_stock', profile_revision: 1, categories: ['wood.plywood', 'sheet'], properties: {}, material_id: null, material_revision: null,
    notes: '', source_kind: 'design_choice', source_quote: 'Använd hela plywoodskivor 1220×2440', source_seq: 4, request_quote: 'gör färdigt planeringen' }
  const chosen = parseCatalogWrite(args)!
  assert.equal(chosen.data.source_quote, 'gör färdigt planeringen'); assert.equal(chosen.data.source_seq, null)
  const stated = parseCatalogWrite({ ...args, source_kind: 'user_statement' })!
  assert.equal(stated.data.source_quote, 'Använd hela plywoodskivor 1220×2440'); assert.equal(stated.data.source_seq, 4)
})

test('a requirement list page keeps current facts, lists archived rows apart and leaves an exact read complete', async () => {
  const row = (n: number, archived = false) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, requirement_id: `0000000${n}-0000-4000-8000-000000000000`, revision: 2, name: 'Panel ' + n,
    project_id: 'A', archived, unit: 'pcs', required_quantity: 4, basis: 'Counted from the saved construction. This is not a purchase.', assumptions: '', change_note: 'x',
    area_title: '', task_title: '', actor_label: 'Project creator', recorded_by: 'u', artifact_title: 'Säng', solution_title: 'Rak säng', stock_allocations: [],
    artifact_changed: archived, stock_changed: false, sheet_layer: null, recorded_at: '2026-11-08T16:12:46Z' })
  const page = compactRequirementPage({ resource: 'requirement', projectId: 'A', records: [row(1), row(2, true)], truncated: false, next_cursor: null }) as any
  assert.deepEqual(page.records, [{ id: row(1).id, revision: 2, name: 'Panel 1', unit: 'pcs', required_quantity: 4 }])
  assert.deepEqual(page.archived, [{ id: row(2).id, revision: 2, name: 'Panel 2' }])
  assert.equal(page.status, 'ok'); assert.equal(page.truncated, false)
  const reads: unknown[] = []
  const reader = createOperationalReader('A', async v => { reads.push(v); return noError({ resource: 'requirement', projectId: 'A', records: [row(2, true)], truncated: false }) }, async () => true, [])
  const exact = await reader.execute({ resource: 'requirement', record_id: row(2).id, after_id: null }) as any
  assert.equal(exact.records[0].archived, true); assert.equal(exact.records[0].basis, row(2).basis)
  const list = await reader.execute({ resource: 'requirement', record_id: null, after_id: null }) as any
  assert.deepEqual(list.records, []); assert.equal(list.archived.length, 1); assert.equal(list.status, 'ok')
})
