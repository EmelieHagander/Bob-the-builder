import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { runWorker } from '../supabase/functions/_shared/bob-workers.ts'
import { latestObservations } from '../supabase/functions/_shared/construction-draft.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// 2026-11-02, bunk bed (70 parts): Konrad stopped at his step budget, his last
// chain stayed in Bob's checkpoint, and with every older check the state grew past
// 2 MB, so the turn died before the drawing was made.

const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const usage = { input_tokens: 10, output_tokens: 1, total_tokens: 11 }
const catalog = {
  definition: () => ({ metadata: { continuation_input_tokens: 100000, context_input_ceiling_tokens: 200000, continuation_summary_tokens: 1600, retained_tool_exchanges: 2,
    continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Role.' }),
  schema: (name: string) => ({ name, schema: { type: 'object' } }),
  text: (key: string) => key,
  tool,
} as unknown as AiCatalogSession

test('a worker stopped by its step budget releases its chain from the checkpoint', async () => {
  let n = 0
  const continuation = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: async () => {
    n++
    return { success: true, model: 'fixture', responseId: 'w' + n, data: null, usage, outputPhase: 'tool_calls',
      toolCalls: [{ id: 'c' + n, type: 'function', function: { name: 'read_construction_draft', arguments: '{}' } }] } as OpenAIServiceResponse<any>
  } })
  const callModel = (options: OpenAIServiceOptions) => continuation.call({ ...options, systemMessage: 'Role.' })
  const chains = () => (continuation.exportState() as any).chains.map(([id]: [string]) => id)
  const released: string[] = []
  const report = await runWorker({ aiCatalog: catalog, worker: { role: 'role.structure-worker', tool: 'ask_structure_worker', tools: [], reads: ['read_construction_draft'], max_steps: 3 },
    callModel, userId: 'u', job: { job: 'Fix the side panel.', findings: null }, history: [],
    session: { prepare: async () => [tool('read_construction_draft')], execute: async () => ({ status: 'ok', parts: 'x'.repeat(1000) }) },
    readCurrent: async () => null, hasAccess: async () => true, deadline: Date.now() + 60000,
    releaseChain: id => { released.push(id); continuation.release(id) } })
  assert.equal(report.status, 'step_budget')
  assert.deepEqual(released, ['w3'])
  assert.deepEqual(chains(), [], 'nothing of the finished worker is left to checkpoint')
})

test('checkpointed construction observations keep only the newest revision of each build', () => {
  const o = (artifact_id: string, revision: number, kind = 'check') => ({ id: `cs_${artifact_id}${revision}${kind}`, projectId: 'p', artifact_id, revision, kind, observed_at: '2026-11-02T16:00:00Z', output: {} })
  const rows = [o('bed', 5), o('bed', 6), o('bed', 6, 'lists'), o('bed', 8), o('ladder', 2), o('bed', 8, 'cut_fit')]
  assert.deepEqual(latestObservations(rows).map(r => r.id), ['cs_bed8check', 'cs_ladder2check', 'cs_bed8cut_fit'])
})
