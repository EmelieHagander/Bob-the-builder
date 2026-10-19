import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGroundedModelCall } from '../supabase/functions/_shared/project-grounding.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

const disk = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const usage = { input_tokens: 950, output_tokens: 100, total_tokens: 1050 }
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const catalog = {
  definition: () => ({ metadata: { continuation_input_tokens: 1000, context_input_ceiling_tokens: 96000,
    continuation_summary_tokens: 1600, retained_tool_exchanges: 1, continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Inspect the selected image without inventing dimensions.' }),
  schema: (name: string) => ({ name, schema: { type: 'object' } }), tool,
} as unknown as AiCatalogSession
const seed: OpenAIServiceOptions = { app: 'bob', module: 'global', functionName: 'ask-bob', aiFunction: 'ask-bob',
  coworkerId: 'bob', catalogRoleKey: 'ask-bob', tools: [tool('read_record')], messages: [{ role: 'user', content: 'Inspect the image.' }] }
const output = (id: string) => ({ role: 'tool' as const, tool_call_id: id, content: '{"status":"ok"}' })

test('image grounding survives reversed read timing and an asynchronous compactor after a restored boundary', async () => {
  const entries: JournalEntry[] = [], requests: OpenAIServiceOptions[] = [], summaries: string[] = []
  let reads = 0, mainPosts = 0, summaryPosts = 0, resumed = false
  let summaryReceipt: OpenAIServiceResponse<any> | undefined
  const make = () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(disk(entry)) } }, Infinity)
    const lookup = createProjectLookup('A', Object.assign(async (project: string, request: any) =>
      journal.run('rpc:search_bob_project_data_v8', { project, request }, async () => {
        reads++
        return { data: { records: [{ id: request.dataset, name: request.dataset, revision: 1 }], related: [], truncated: false }, error: null }
      }), { checkpointed: true }), 1000, 20, undefined, {
      observationTime: async input => {
        const time = await journal.run('lookup:observed_at', { projectId: 'A', input }, async () => new Date().toISOString())
        // Cold persistence and warm journal replay can complete in opposite
        // orders. The RPC cursor must not depend on this scheduling difference.
        if ((input as any).dataset === (resumed ? 'measurements' : 'project')) await new Promise(resolve => setTimeout(resolve, 10))
        return time
      },
    })
    const continuation = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: async options => {
      if (options.catalogRoleKey === 'context-compactor') summaries.push(String(options.messages![0].content))
      return journal.run('model:' + options.functionName, options, async () => {
        if (options.catalogRoleKey === 'context-compactor') {
          if (!summaryReceipt) {
            summaryPosts++
            const source = JSON.parse(String(options.messages![0].content))
            summaryReceipt = { success: true, model: 'fixture', usage, data: { summary: 'Inspect the selected image; dimensions remain unknown.',
              open_questions: [], next_steps: ['Inspect the image.'], source_refs: source.allowed_source_refs } }
            throw new BobContinuation('yield', 'ai_wait', { id: 'accepted-summary', accepted: true, role: 'context-summary' })
          }
          return summaryReceipt
        }
        requests.push(disk(options))
        const id = 'r' + ++mainPosts
        return { success: true, model: 'fixture', usage, responseId: id, data: null, outputPhase: 'tool_calls',
          toolCalls: [{ id, type: 'function', function: { name: 'read_record', arguments: '{}' } }] }
      })
    } })
    const grounded = createGroundedModelCall({ groundingInstruction: 'Keep project facts and measurements distinct.', projectId: 'A', message: 'Inspect the image.',
      lookup, callModel: continuation.call, hasAccess: async () => true, validateImages: async () => true, deadline: Infinity, readOrder: 'serial' })
    return { journal, lookup, continuation, grounded }
  }
  const first = make()
  for (let i = 0; i < 6; i++) await first.lookup.search({ dataset: 'solutions', query: null, status: null, area_id: null, record_id: 'source' + i, after_id: null })
  await first.grounded(seed)
  await first.grounded({ ...seed, previousResponseId: 'r1', messages: [output('r1')] })
  const saved = disk({ journal: first.journal.exportState(), lookup: first.lookup.exportState(), continuation: first.continuation.exportState() })
  const imageRequest: OpenAIServiceOptions = { ...seed, previousResponseId: 'r2', messages: [output('r2'),
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'private-image:original', detail: 'low' } }] }] }
  await assert.rejects(first.grounded(imageRequest), error => error instanceof BobContinuation && error.message === 'ai_wait')
  assert.equal(reads, 8)
  resumed = true
  const next = make()
  next.journal.restoreState(saved.journal)
  next.lookup.restoreState(saved.lookup)
  next.continuation.restoreState(saved.continuation)
  const result = await next.grounded(imageRequest)
  assert.equal(result.responseId, 'r3')
  assert.equal(reads, 8, 'the active grounding reads come from the journal; completed history is not rerun')
  assert.equal(summaryPosts, 1, 'the accepted summary is not submitted again')
  assert.equal(mainPosts, 3)
  assert.equal(summaries.length, 2)
  assert.equal(summaries[1], summaries[0], 'the pending compactor input is identical after restart')
  assert.match(JSON.stringify(requests.at(-1)!.messages), /private-image:original/)
  assert.deepEqual(next.lookup.sources, first.lookup.sources)
})
