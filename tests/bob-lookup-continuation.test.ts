import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

const usage = { input_tokens: 950, output_tokens: 100, total_tokens: 1050 }
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const catalog = {
  definition: () => ({ metadata: { continuation_input_tokens: 1000, context_input_ceiling_tokens: 96000,
    continuation_summary_tokens: 1600, retained_tool_exchanges: 1, continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Read the selected design; ask the owner before changing it.' }),
  schema: (name: string) => ({ name, schema: { type: 'object' } }), tool,
} as unknown as AiCatalogSession
const seed: OpenAIServiceOptions = { app: 'bob', module: 'global', functionName: 'ask-bob', aiFunction: 'ask-bob',
  coworkerId: 'bob', catalogRoleKey: 'ask-bob', tools: [tool('search_project_data')],
  messages: [{ role: 'user', content: 'Inspect the mockup and confirm with me before changing the selected design.' }] }
const input = (record: string) => ({ dataset: 'solutions', query: null, status: null, area_id: null, record_id: record, after_id: null })
const firstTime = Date.parse('2026-10-18T18:58:24Z')

test('a pending context compaction resumes with the original lookup observation times and no repeated paid work', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: firstTime })
  const entries: JournalEntry[] = [], compactedInputs: string[] = []
  let mainCalls = 0, paidCompactions = 0, reads = 0
  let receipt: OpenAIServiceResponse<any> | undefined
  const run = async () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, Infinity)
    const lookup = createProjectLookup('A', async (project, request) => journal.run('lookup:records', { project, request }, async () => {
      reads++
      return { data: { records: [{ id: request.record_id, revision: 6, updated_at: '2026-10-18T18:40:31Z',
        name: 'Selected design', width_mm: 900 }], related: [], truncated: false }, error: null }
    }), 1000, 10, undefined, { observationTime: request => journal.run('lookup:observed_at', { projectId: 'A', input: request }, async () => new Date().toISOString()) })
    const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: async options => {
      if (options.catalogRoleKey === 'context-compactor') compactedInputs.push(String(options.messages![0].content))
      return journal.run('model:' + options.functionName, options, async () => {
        if (options.catalogRoleKey === 'context-compactor') {
          if (!receipt) {
            paidCompactions++
            const packet = JSON.parse(String(options.messages![0].content))
            receipt = { success: true, model: 'fixture', usage, data: { summary: 'Version 6 must be compared with the mockup. No change authorised.',
              open_questions: ['Owner confirmation is pending.'], next_steps: ['Inspect the mockup.'], source_refs: packet.allowed_source_refs } }
            throw new BobContinuation('yield', 'ai_wait', { id: 'pending-compactor', accepted: true, role: 'context-summary' })
          }
          return receipt
        }
        const id = 'r' + ++mainCalls
        return { success: true, model: 'fixture', responseId: id, data: null, usage, outputPhase: 'tool_calls',
          toolCalls: [{ id, type: 'function', function: { name: 'search_project_data', arguments: JSON.stringify(input(id)) } }] }
      })
    } })
    let answer = await adapter.call(seed)
    for (let index = 0; index < 2; index++) {
      const id = answer.toolCalls![0].id
      const result = await lookup.search(input(id))
      assert.equal(result.records[0].revision, 6)
      assert.equal(result.records[0].updated_at, '2026-10-18T18:40:31Z')
      answer = await adapter.call({ ...seed, previousResponseId: answer.responseId,
        messages: [{ role: 'tool', tool_call_id: id, content: JSON.stringify(result) }] })
    }
    return { answer, sources: lookup.sources }
  }
  await assert.rejects(run(), error => error instanceof BobContinuation && error.message === 'ai_wait')
  t.mock.timers.setTime(firstTime + 15000)
  const resumed = await run()
  assert.equal(resumed.answer.responseId, 'r3')
  assert.deepEqual(compactedInputs[1], compactedInputs[0], 'nested compaction source must retain the first observation time')
  assert.equal(reads, 2)
  assert.equal(paidCompactions, 1)
  assert.equal(mainCalls, 3)
  assert(resumed.sources.every(source => source.retrievedAt === new Date(firstTime).toISOString()))
})

test('replayed reads keep their observation but a genuinely new read gets a new time and scope changes fail closed', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: firstTime })
  const entries: JournalEntry[] = []
  let reads = 0
  const reader = (projectId = 'A') => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, Infinity)
    return createProjectLookup(projectId, (project, request) => journal.run('lookup:records', { project, request }, async () => {
      reads++
      return { data: { records: [{ id: request.record_id, revision: 6 }], related: [], truncated: false }, error: null }
    }), 1000, 10, undefined, { observationTime: request => journal.run('lookup:observed_at', { projectId, input: request }, async () => new Date().toISOString()) })
  }
  const original = await reader().search(input('selected'))
  t.mock.timers.setTime(firstTime + 60000)
  const resumed = reader()
  assert.deepEqual(await resumed.search(input('selected')), original)
  const fresh = await resumed.search(input('selected'))
  assert.equal(fresh.retrievedAt, new Date(firstTime + 60000).toISOString())
  assert.notEqual(fresh.retrievedAt, original.retrievedAt)
  assert.equal(reads, 2)
  await assert.rejects(reader().search(input('different-record')), /continuation_changed/)
  await assert.rejects(reader('another-project').search(input('selected')), /continuation_changed/)
  assert.equal(reads, 2, 'changed replay authority must fail before a database operation')
})

test('invalid and unavailable lookup results also retain observation identity; missing checkpoints never fall back to a new clock', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: firstTime })
  const entries: JournalEntry[] = []
  let reads = 0
  const reader = () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, Infinity)
    return createProjectLookup('A', (project, request) => journal.run('lookup:records', { project, request }, async () => {
      reads++
      return { data: null, error: { code: 'XX000' } }
    }), 1000, 10, undefined, { observationTime: request => journal.run('lookup:observed_at', { projectId: 'A', input: request }, async () => new Date().toISOString()) })
  }
  const first = reader()
  const invalid = await first.search({ unexpected: true })
  const unavailable = await first.search(input('selected'))
  assert.equal(invalid.status, 'invalid')
  assert.equal(unavailable.status, 'unavailable')
  t.mock.timers.setTime(firstTime + 60000)
  const replay = reader()
  assert.deepEqual(await replay.search({ unexpected: true }), invalid)
  assert.deepEqual(await replay.search(input('selected')), unavailable)
  assert.equal(reads, 1)
  const denied = createProjectLookup('A', async () => { throw new Error('Unexpected database operation') }, 1000, 10, undefined,
    { observationTime: async () => { throw new BobContinuation('yield', 'checkpoint_unavailable') } })
  await assert.rejects(denied.search(input('selected')), error => error instanceof BobContinuation && error.message === 'checkpoint_unavailable')
  const corrupt = createProjectLookup('A', async () => { throw new Error('Unexpected database operation') }, 1000, 10, undefined,
    { observationTime: async () => 'not-a-timestamp' })
  await assert.rejects(corrupt.search(input('selected')), /lookup_observation_unavailable/)
})
