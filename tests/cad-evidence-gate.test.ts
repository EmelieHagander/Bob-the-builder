import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadAssistant, type CadPacket } from '../supabase/functions/_shared/cad-assistant.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import type { CadAssemblyRequest } from '../supabase/functions/_shared/cad-adapter.ts'
import { handoff, reviewReply } from './support/cad-review-fixture.ts'

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const response = (data: string | null) => ({ success: true, data, model: 'fixture', responseId: 'p0-response', usage })
const recipe: CadAssemblyRequest = { contract_version: 1, units: 'mm', assembly_id: 'p0-concept',
  definitions: [{ id: 'panel', primitive: 'box', x_mm: 600, y_mm: 300, z_mm: 18, material_ref: null }],
  instances: [{ id: 'panel-1', definition_id: 'panel', placement: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } }], views: ['front', 'top'] }
const design = { recipe, title: 'P0 concept', description: 'Synthetic concept, not physical evidence',
  assumptions: 'Working dimensions; physical fit remains unverified', target_revision: 1, measurements: [], dimension_bindings: [] }
const request = { brief: 'Draw the concept now.', handoff, area_id: null, component_id: null, step_id: null, artifact_id: null }

type Failure = 'none' | 'backend' | 'truncated' | 'repeated_cursor' | 'page_limit' | 'denied' | 'irrelevant_plan'
function fixture(failure: Failure) {
  let renders = 0, designerCalls = 0, reviewCalls = 0
  const reads: { dataset: string; after_id: string | null }[] = []
  const makeLookup = () => createProjectLookup('A', async (_project, q) => {
    reads.push({ dataset: q.dataset, after_id: q.after_id })
    if (q.dataset === 'physical_elements' && failure === 'backend') return { data: null, error: { code: 'backend_error' } }
    if (q.dataset === 'physical_elements' && failure === 'denied') return { data: null, error: { code: '42501' } }
    if (q.dataset === 'plan' && failure === 'irrelevant_plan') return { data: null, error: { code: 'backend_error' } }
    const paging = q.dataset === 'physical_elements' && ['truncated', 'repeated_cursor', 'page_limit'].includes(failure)
    const records = q.dataset === 'target' ? [{ id: 'project', revision: 1, solution_id: 'solution' }]
      : q.dataset === 'project' ? [{ id: 'A', name: 'P0 fixture' }]
      : paging ? [{ id: 'element-' + (q.after_id ?? '0'), label: 'Relevant site object' }] : []
    return { data: { records, related: [], truncated: paging,
      next_cursor: !paging || failure === 'truncated' ? null : failure === 'repeated_cursor' ? 'same' : (q.after_id ?? '') + 'x' }, error: null }
  }, 1000, 40)
  const assistant = createCadAssistant({ research: false, projectId: 'A', userId: 'u',
    ownerRequest: request.brief, hasAccess: async () => true, makeLookup, available: true,
    deadline: Date.now() + 300000, readArtifact: async () => null,
    render: async (r): Promise<CadPacket> => { renders++; return { recipe: r, manifest: { instances: r.instances },
      files: { front: 'Zml4dHVyZQ==' }, previews: Object.fromEntries(r.views.map(view => [view, 'Zml4dHVyZQ=='])) } },
    callModel: async o => {
      if (o.functionName === 'cad-reviewer') { reviewCalls++; return reviewReply() }
      if (++designerCalls === 1) return { ...response(null), toolCalls: [{ id: 'render', type: 'function' as const,
        function: { name: 'render_cad_candidate', arguments: JSON.stringify(design) } }] }
      return response('Ready for independent review.')
    },
  })
  return { assistant, reads, get renders() { return renders }, get reviewCalls() { return reviewCalls } }
}

for (const failure of ['backend', 'truncated', 'repeated_cursor', 'page_limit'] as const) {
  test(`P0: ${failure} in required reviewer sources cannot become a savable candidate despite model pass`, async () => {
    const f = fixture(failure), result = await f.assistant.consult(request)
    assert.equal(result.status, 'unavailable', 'incomplete source retrieval must not become ready')
    assert.equal(result.stage, 'review')
    assert.equal(f.assistant.candidate, null)
    assert.equal(f.assistant.quality, null)
    assert.equal(f.assistant.metrics.review_passed, false)
    assert.equal(f.reviewCalls, 0, 'do not pay a reviewer before its required inputs exist')
    assert.equal(f.renders, 1, 'source retrieval failure is not an invitation to redesign')
  })
}

test('P0: complete reviewer sources still expose the exact reviewed candidate', async () => {
  const f = fixture('none'), result = await f.assistant.consult(request)
  assert.equal(result.status, 'ready')
  assert.deepEqual(f.assistant.candidate!.packet.recipe, recipe)
  assert.equal(f.assistant.metrics.review_passed, true)
  assert.equal(f.reviewCalls, 1)
  assert.equal(f.renders, 1)
})

test('P0: no Step means an unrelated plan read is not a new review prerequisite', async () => {
  const f = fixture('irrelevant_plan'), result = await f.assistant.consult(request)
  assert.equal(result.status, 'ready')
  assert.equal(f.reads.some(q => q.dataset === 'plan'), false, 'review scope is server-defined, not every available dataset')
  assert.equal(f.reviewCalls, 1)
})

test('P0: denied reviewer access remains a permission error, never a measurement task', async () => {
  const f = fixture('denied')
  await assert.rejects(f.assistant.consult(request), /project_denied/)
  assert.equal(f.assistant.candidate, null)
  assert.equal(f.assistant.quality, null)
  assert.equal(f.reviewCalls, 0)
})
