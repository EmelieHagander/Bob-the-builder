import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorker, type WorkerProgress } from '../supabase/functions/_shared/bob-workers.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// Deep audit 2026-11-08 (owner: "Gå med rek."): Konrad's context ceiling and the
// turn's checkpoint size limit failed the whole turn. With the final-answer pin
// the hand-over now ends with what it saved, and Bob's turn goes on.

const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const catalog = { definition: () => ({ metadata: {} }), role: () => ({ systemMessage: 'Role.', providerAdapter: 'openai-responses-v1' }),
  schema: (name: string) => ({ name, schema: { type: 'object' } }), text: (key: string) => key, tool } as unknown as AiCatalogSession
const call = (id: string, name: string) => ({ id, type: 'function' as const, function: { name, arguments: '{}' } })
const saving = { success: true, model: 'f', responseId: 'r1', data: null, outputPhase: 'tool_calls', usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
  toolCalls: [call('a', 'edit_construction_parts')] } as OpenAIServiceResponse<any>

const run = (opts: { stopAsResult: boolean; second: () => Promise<OpenAIServiceResponse<any>>; save?: (p: WorkerProgress) => Promise<void> }) => {
  let n = 0
  return runWorker({ aiCatalog: catalog, worker: { role: 'role.structure-worker', tool: 'ask_structure_worker', tools: ['edit_construction_parts'], reads: [], max_steps: 6 } as any,
    callModel: async () => (++n === 1 ? saving : await opts.second()), userId: 'u', job: { job: 'Fortsätt.', findings: null }, history: [],
    session: { prepare: async () => [tool('edit_construction_parts')], execute: async () => ({ status: 'saved', receipt: { dataset: 'artifacts', recordId: 'c1', revision: 4, operation: 'updated' } }) },
    readCurrent: async () => null, readKnowledge: async () => ({}), hasAccess: async () => true, deadline: Infinity, ...(opts.stopAsResult ? { stopAsResult: true } : {}),
    ...(opts.save ? { progress: { save: opts.save } } : {}) } as any)
}
const ceiling = async () => { throw new Error('context_input_too_large') }

test('the context ceiling ends the hand-over with its receipts; without the pin it still fails the turn', async () => {
  const report = await run({ stopAsResult: true, second: ceiling }) as any
  assert.equal(report.status, 'context_limit')
  assert.deepEqual(report.receipts.map((r: any) => [r.record_id, r.revision]), [['c1', 4]])
  assert.match(report.note, /context limit/)
  await assert.rejects(run({ stopAsResult: false, second: ceiling }), /context_input_too_large/)
})

test('a checkpoint too large ends the hand-over with its receipts', async () => {
  const report = await run({ stopAsResult: true, second: async () => saving, save: async () => { throw new Error('turn_checkpoint_too_large') } }) as any
  assert.equal(report.status, 'state_limit');assert.match(report.note, /saved state/)
  assert.deepEqual(report.receipts.map((r: any) => r.revision), [4])
  await assert.rejects(run({ stopAsResult: false, second: async () => saving, save: async () => { throw new Error('turn_checkpoint_too_large') } }), /turn_checkpoint_too_large/)
})

test('a hand-over whose first step is already past the ceiling is a failed worker, not one to continue', async () => {
  let n = 0
  const report = await runWorker({ aiCatalog: catalog, worker: { role: 'role.structure-worker', tool: 'ask_structure_worker', tools: ['edit_construction_parts'], reads: [], max_steps: 6 } as any,
    callModel: async () => { n++; throw new Error('context_input_too_large') }, userId: 'u', job: { job: 'Fortsätt.', findings: null }, history: [],
    session: { prepare: async () => [tool('edit_construction_parts')], execute: async () => ({ status: 'ok' }) },
    readCurrent: async () => null, readKnowledge: async () => ({}), hasAccess: async () => true, deadline: Infinity, stopAsResult: true } as any) as any
  assert.deepEqual([report.status, report.reason, n], ['unavailable', 'context_limit', 1])
})
