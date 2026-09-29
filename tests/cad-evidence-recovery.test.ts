import { test } from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant} from './support/cad-parameter-fixture.ts'
import type { DrawingRequest, DrawingRequestStore } from '../supabase/functions/_shared/cad-intake.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { handoff, reviewReply } from './support/cad-review-fixture.ts'

const id = '30000000-0000-4000-8000-000000000091'
const sourceId = '30000000-0000-4000-8000-000000000092'
const request = { request_id: null, handoff, brief: 'Draw this concept.', area_id: null, component_id: null, step_id: 'work', artifact_id: null }
const recipe = { contract_version: 1 as const, units: 'mm' as const, assembly_id: 'p0-recovery',
  definitions: [{ id: 'panel', primitive: 'box' as const, material_ref: null, x_mm: 600, y_mm: 300, z_mm: 18 }],
  instances: [{ id: 'panel', definition_id: 'panel', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front' as const, 'top' as const] }
const metadata = { purpose: 'project', title: 'Concept', description: 'Synthetic recovery test', assumptions: 'Site fit unverified', target_revision: 1, measurements: [] }
const reply = (name?: string, args: unknown = {}) => ({ success: true, data: null, responseId: 'response', model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  ...(name ? { toolCalls: [{ id: 'call', type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] } : {}) })
const assessment = { checks: [{ id: 'shape', status: 'known', blocking: false, source_refs: ['requirement:shape'], action: 'none', detail: 'Concept dimensions supplied in the request.' }], additional_needs: [] }

function fixture() {
  let row: DrawingRequest | null = null, renders = 0, reviews = 0, checkpointsFail = false, renderedThisConsultation = false
  const broken = new Set(['physical_elements'])
  const statuses: string[] = [], reads: string[] = []
  const store: DrawingRequestStore = {
    list: async () => row ? [{ id: row.id, status: row.status }] : [],
    load: async key => row?.id === key ? structuredClone(row) : null,
    save: async (key, expected, status, payload) => {
      assert.equal(key, row?.id ?? null); assert.equal(expected, row?.revision ?? 0)
      if (checkpointsFail && status === 'retrieval_failed') throw new Error('checkpoint_unavailable')
      row = { id, revision: expected + 1, status, payload: structuredClone(payload) }
      statuses.push(status)
      return structuredClone(row)
    },
  }
  const assistant = (options: { savedPart?: boolean; finalRound?: boolean } = {}) => {
    let designerCalls = 0
    return createCadAssistant({ requestStore: store, research: !options.finalRound, projectId: 'A', userId: 'u',
      ownerRequest: request.brief, hasAccess: async () => true, available: true, deadline: Date.now() + 300000,
      makeLookup: () => createProjectLookup('A', async (_p, q) => {
        reads.push(q.dataset)
        if (q.dataset === 'target') renderedThisConsultation = false
        // Intake succeeds; inject failure only after this consultation renders.
        if (renderedThisConsultation && broken.has(q.dataset)) return { data: null, error: { code: 'backend_error' } }
        return { data: { records: q.dataset === 'target' ? [{ id: 'project', revision: 1, solution_id: 'solution' }] : [], related: [], truncated: false }, error: null }
      }, 1000, 40),
      readArtifact: async key => key === sourceId ? { recipe: structuredClone(recipe), revision: 1 } : null,
      render: async r => { renders++; renderedThisConsultation = true; return { recipe: r, manifest: { instances: r.instances }, files: { front: 'PRIVATE_EXPORT' }, previews: { front: 'PRIVATE_PIXELS', top: 'PRIVATE_PIXELS' } } },
      callModel: async o => {
        if (o.functionName === 'cad-research') return reply('finish_cad_research', assessment)
        if (o.functionName === 'cad-reviewer') { reviews++; return reviewReply() }
        designerCalls++
        if (options.finalRound && designerCalls < 10) return reply('search_project_data', { dataset: 'measurements', query: null, status: null, area_id: null, record_id: null, after_id: null })
        if (options.finalRound || designerCalls % 2 === 1) return options.savedPart
          ? reply('render_saved_cad_candidate', { ...metadata, source_artifact_id: sourceId, source_revision: 1, part_ids: ['panel'] })
          : reply('render_cad_candidate', { ...metadata, recipe, dimension_bindings: [] })
        return reply()
      },
    })
  }
  return { assistant, broken, statuses, reads, failCheckpoint: () => { checkpointsFail = true },
    get row() { return row }, get renders() { return renders }, get reviews() { return reviews } }
}

test('P0: all failed mandatory reads return together, preserve the draft and cannot restart unchanged work', async () => {
  const f = fixture(); f.broken.add('plan'); f.broken.add('physical_relationships')
  const a = f.assistant(), result = await a.consult(request)
  assert.equal(result.status, 'unavailable'); assert.equal(result.stage, 'review')
  assert.equal(result.reason, 'review_sources_incomplete'); assert.equal(result.request_id, id)
  assert.deepEqual(result.incomplete_datasets, ['plan', 'physical_elements', 'physical_relationships'])
  assert.equal(f.row?.status, 'retrieval_failed')
  assert.deepEqual(f.row?.payload.incomplete, result.incomplete_datasets)
  assert.deepEqual((f.row?.payload.draft as any).recipe, recipe)
  assert.deepEqual(f.row?.payload.assessment, assessment)
  assert(!JSON.stringify(f.row).includes('PRIVATE_'))
  assert(!f.statuses.includes('reviewed')); assert.equal(f.reviews, 0); assert.equal(a.metrics.reviews, 0)
  assert.equal(a.candidate, null); assert.equal(a.quality, null); assert.equal(a.remaining, 0)
  const readCount = f.reads.length
  assert.deepEqual(await a.consult(request), result)
  await a.markSaved()
  assert.equal(f.row?.status, 'retrieval_failed'); assert.equal(f.reads.length, readCount); assert.equal(f.renders, 1)
})

test('P0: repaired retrieval resumes the same stored request but never treats its draft as approval', async () => {
  const f = fixture(), first = await f.assistant().consult(request)
  assert.equal(first.status, 'unavailable')
  f.broken.clear()
  const next = f.assistant()
  assert.equal(next.candidate, null, 'loading a new worker does not approve the stored draft')
  const result = await next.consult({ ...request, request_id: id })
  assert.equal(result.status, 'ready'); assert.equal(result.request_id, id)
  assert.equal(f.row?.id, id); assert.equal(f.row?.status, 'reviewed')
  assert.equal(f.renders, 2); assert.equal(f.reviews, 1)
  assert.deepEqual(next.candidate?.packet.recipe, recipe)
  assert.equal(f.row?.payload.owner_request, request.brief)
  await next.markSaved(); assert.equal(f.row?.status, 'saved')
})

test('P0: a failed retrieval checkpoint cannot expose a candidate or turn into a design failure', async () => {
  const f = fixture(); f.failCheckpoint()
  const a = f.assistant(), result = await a.consult(request)
  assert.equal(result.status, 'unavailable'); assert.equal(result.stage, 'review')
  assert.equal(result.reason, 'review_sources_incomplete'); assert.equal(result.request_state_saved, false)
  assert.equal(a.candidate, null); assert.equal(a.quality, null); assert.equal(f.reviews, 0)
  assert.equal(f.row?.status, 'draft', 'the last successful checkpoint remains retrievable')
  await a.markSaved(); assert.equal(f.row?.status, 'draft')
  assert.deepEqual(await a.consult(request), result); assert.equal(f.renders, 1)
})

for (const [name, options] of [['saved detail', { savedPart: true }], ['last designer call', { finalRound: true }]] as const) {
  test(`P0: ${name} cannot bypass mandatory review evidence`, async () => {
    const f = fixture(), a = f.assistant(options), result = await a.consult(request)
    assert.equal(result.status, 'unavailable'); assert.equal(result.stage, 'review')
    assert.equal(a.candidate, null); assert.equal(f.reviews, 0); assert.equal(f.renders, 1)
  })
}

test('P0: a failed second consultation clears an earlier pending approval', async () => {
  const f = fixture(); f.broken.clear()
  const a = f.assistant()
  assert.equal((await a.consult(request)).status, 'ready'); assert(a.candidate)
  f.broken.add('physical_elements')
  const result = await a.consult({ ...request, request_id: id })
  assert.equal(result.status, 'unavailable'); assert.equal(result.stage, 'review')
  assert.equal(a.candidate, null); assert.equal(a.quality, null); assert.equal(f.reviews, 1)
})
