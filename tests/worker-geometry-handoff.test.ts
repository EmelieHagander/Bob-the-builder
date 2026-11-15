import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorker, validWorkerProgress } from '../supabase/functions/_shared/bob-workers.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { constructionFormFixture } from './support/construction-form-fixture.ts'
import { constructionFormIssues } from '../supabase/functions/_shared/construction-form.ts'

test('the same geometry blocker returns to Bob, persists its terminal state and skips remaining writes', async () => {
  const catalog = catalogFixture(), states: any[] = [], events: any[] = []
  let models = 0, writes = 0
  const worker = { role: 'role.structure-worker', tool: 'ask_structure_worker', max_steps: 10,
    tools: ['save_construction_draft'], reads: [] }
  const opts = { aiCatalog: catalog, worker, userId: 'owner', job: { job: 'Improve the underfloor', findings: null },
    history: [], deadline: Date.now() + 60000, blockerHandoff: true,
    readCurrent: async () => null, readKnowledge: async () => ({}), hasAccess: async () => true,
    callModel: async () => { models++; return { success: true, data: null, model: 'fixture', responseId: 'r' + models,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, toolCalls: Array.from({ length: models === 3 ? 2 : 1 }, (_, i) => ({
        id: 'call' + models + i, type: 'function' as const, function: { name: 'save_construction_draft', arguments: '{}' } })) } },
    session: { prepare: async () => [catalog.tool('save_construction_draft')], execute: async () => { writes++; return { status: 'needs_data', reason: 'concept_geometry_changed',
      issues: [{ code: 'concept_geometry_changed', ids: ['floor'], message: 'Concept z 130..300 mm; parts z 0..275 mm.' }] } } },
    progress: { save: async (state: any) => { states.push(state) } }, onTool: (event: any) => events.push(event) }
  const result = await runWorker(opts)
  assert.equal(result.reason, 'concept_geometry_changed')
  assert.equal(result.status, 'needs_verification')
  assert.equal(models, 3)
  assert.equal(writes, 3, 'the fourth write in the same batch is deferred')
  assert.equal(events[0].rejection.code, 'concept_geometry_changed')
  assert(validWorkerProgress(states.at(-1), worker.max_steps))
  const oversized = structuredClone(states.at(-1)); oversized.terminal.details.message = 'x'.repeat(1501)
  assert.equal(validWorkerProgress(oversized, worker.max_steps), false)
  const legacy = { ...states.at(-1), receipts: [{}], terminal: { status: 'needs_verification', reason: 'concept_geometry_changed', receiptIndex: 0 } }
  assert.equal(validWorkerProgress(legacy, worker.max_steps), true, 'older receipt-based terminal states remain readable')
  const resumed = await runWorker({ ...opts, progress: { restored: states.at(-1), save: async () => {} } })
  assert.equal(resumed.reason, 'concept_geometry_changed')
  assert.match((resumed.blocker_details as any).issues[0].message, /130\.\.300/)
  assert.equal(models, 3, 'a resumed terminal state never calls the model again')
})

test('FORM permits hollow frames and explains missing outer bounds without demanding solid infill', () => {
  const { intent, recipe, refinement } = constructionFormFixture()
  assert.deepEqual(constructionFormIssues(intent, recipe, new Set(), refinement, true), [], 'two separated rails preserve the envelope')
  recipe.instances[1].placement.x -= 10
  const issue = constructionFormIssues(intent, recipe, new Set(), refinement, true).find(i => i.code === 'concept_geometry_changed')!
  assert.match(issue.message, /Gaps between parts are allowed/)
  assert.match(issue.message, /do not fill the empty volume/)
  assert.match(issue.message, /x 0\.\.600/)
})
