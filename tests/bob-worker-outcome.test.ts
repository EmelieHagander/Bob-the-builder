import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorker, workerOutcome } from '../supabase/functions/_shared/bob-workers.ts'
import { createExecutionMetrics, type ExecutionEvent } from '../supabase/functions/_shared/execution-metrics.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// Owner runs 2026-11-08 (Våningssäng 2): Rita came back from several
// hand-overs without a drawing, and a report ending in text was status ok.
// What a hand-over delivered is read from its save receipts by code.
const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
const spec = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const catalog = { tool: spec, text: (key: string) => key } as unknown as AiCatalogSession
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const reply = (id: string, calls: ReturnType<typeof call>[]): OpenAIServiceResponse<string> => ({ success: true, data: null, model: 'fixture', responseId: id, usage, outputPhase: 'tool_calls', toolCalls: calls })
const rita = { role: 'role.drawing-worker', tool: 'ask_drawing_worker', max_steps: 4, tools: ['design_project_cad', 'save_cad_design'], reads: ['read_construction_draft'] }

function run(steps: OpenAIServiceResponse<string>[], results: Record<string, unknown>, worker = rita) {
  let n = 0
  return runWorker({ aiCatalog: catalog, worker, userId: 'owner', job: { job: 'Rita sängen.', findings: null }, history: [],
    callModel: async (_o: OpenAIServiceOptions) => steps[n++] ?? { success: true, data: 'Klar, ritningen är gjord.', model: 'fixture', responseId: 'end', usage },
    readCurrent: async () => null, hasAccess: async () => true, deadline: Date.now() + 60_000,
    readKnowledge: async () => ({}),
    session: { prepare: async () => [...worker.tools, ...worker.reads].map(spec), execute: async name => results[name] ?? { status: 'ok' } } })
}

test('a report of "done" with no saved drawing is not a delivery; a refused drawing names its blocker; a saved one is saved', async () => {
  const talked = await run([], {})
  assert.equal(talked.status, 'ok')
  assert.deepEqual(talked.outcome, { deliverable: 'not_saved', product: 'drawing', saved: {}, note: 'No drawing was saved in this hand-over.' })

  const refused = await run([reply('r1', [call('a', 'design_project_cad')])], { design_project_cad: { status: 'needs_data', reason: 'drawing_work_scope_ambiguous' } })
  assert.equal(refused.status, 'ok', 'the worker still ended its conversation')
  assert.deepEqual((refused.outcome as any).blocker, { tool: 'design_project_cad', status: 'needs_data', reason: 'drawing_work_scope_ambiguous' })
  assert.equal((refused.outcome as any).deliverable, 'blocked')
  assert.deepEqual((refused.calls as any[])[0], { tool: 'design_project_cad', status: 'needs_data', reason: 'drawing_work_scope_ambiguous' })

  const drawn = await run([reply('r1', [call('a', 'design_project_cad'), call('b', 'save_cad_design')])],
    { design_project_cad: { status: 'ready' }, save_cad_design: { status: 'saved', receipt: { projectId: 'p', recordId: 'd1', revision: 6 } } })
  assert.deepEqual(drawn.outcome, { deliverable: 'saved', product: 'drawing', saved: { drawing: 1 } })
})

test('a saved product at a limit is partial; checks and other products do not count as the worker\'s own', () => {
  const writes = new Set(['edit_construction_parts', 'continue_construction_change'])
  const receipts = [{ tool: 'edit_construction_parts', record_id: 'c', revision: 26 }, { tool: 'check_construction_draft', revision: 26, status: 'checked' }]
  assert.equal(workerOutcome('structure-worker', 'step_budget', [], receipts, writes).deliverable, 'partial')
  assert.deepEqual(workerOutcome('structure-worker', 'ok', [], receipts, writes).saved, { construction: 1 })
  const followUp = workerOutcome('structure-worker', 'ok', [{ tool: 'edit_construction_parts', status: 'invalid', reason: 'plan_required' }],
    [{ tool: 'continue_construction_change', record_id: 'need', revision: 3 }], writes)
  assert.equal(followUp.deliverable, 'blocked'); assert.deepEqual(followUp.saved, { follow_up: 1 })
  assert.equal(workerOutcome('materials-worker', 'ok', [{ tool: 'read_project_work', status: 'ok' }], [], new Set(['manage_project_material'])).deliverable, 'not_saved')
})

test('the hand-over\'s tool event counts what was delivered, per product, as codes and numbers only', async () => {
  const events: ExecutionEvent[] = []
  const metrics = createExecutionMetrics({ runId: 'r', turnId: 't', startedAt: 0, write: async e => { events.push(e) } })
  metrics.tool({ name: 'ask_drawing_worker', status: 'ok', step: 2, index: 0, ms: 9,
    diagnostics: { operation: 'worker_outcome', deliverable: 'blocked', product: 'drawing', saved: { construction: 0, material: 3, bogus: 9 } as any, blocker: 'drawing_work_scope_ambiguous' } })
  metrics.tool({ name: 'ask_materials_worker', status: 'ok', step: 3, index: 0, ms: 9, diagnostics: { operation: 'worker_outcome', deliverable: '<script>', blocker: 'Not a code' } })
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(events[0].counts, { tool: 'ask_drawing_worker', step: 2, work_operation: 'worker_outcome', worker_deliverable: 'blocked', worker_product: 'drawing', worker_saved_material: 3, worker_blocker: 'drawing_work_scope_ambiguous' })
  assert.deepEqual(events[1].counts, { tool: 'ask_materials_worker', step: 3, work_operation: 'worker_outcome', worker_deliverable: 'unknown' })
})

// Review of #508: without the gate Rita and Mattias keep their working note; only the refusal is gone.
test('a worker without the plan gate is still offered its working note and may save before writing one', async () => {
  const offered: string[][] = []
  let n = 0
  const steps = [reply('r1', [call('a', 'design_project_cad'), call('b', 'save_cad_design')])]
  const result = await runWorker({ aiCatalog: catalog, worker: rita, userId: 'owner', job: { job: 'Rita sängen.', findings: null }, history: [],
    callModel: async (o: OpenAIServiceOptions) => { offered.push((o.tools ?? []).map(t => t.function.name)); return steps[n++] ?? { success: true, data: 'Klar.', model: 'fixture', responseId: 'end', usage } },
    readCurrent: async () => null, hasAccess: async () => true, deadline: Date.now() + 60_000, readKnowledge: async () => ({}),
    workpadEnabled: true, workpad: { status: 'ok', revision: 0, note: null },
    session: { prepare: async () => [...rita.tools, ...rita.reads, 'update_workpad'].map(spec),
      execute: async name => name === 'save_cad_design' ? { status: 'saved', receipt: { projectId: 'p', recordId: 'd1', revision: 6 } } : { status: 'ready' } } })
  assert(offered.every(list => list.includes('update_workpad')))
  assert.equal((result.outcome as any).deliverable, 'saved')
})
