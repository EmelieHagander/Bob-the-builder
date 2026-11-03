import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anthropicRequestBody, nativeItems, type AnthropicCallContext } from '../supabase/functions/_shared/anthropic-service.ts'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { runWorker } from '../supabase/functions/_shared/bob-workers.ts'
import { textContinuationMode } from '../supabase/functions/_shared/ai-catalog.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

// This is the actual provider boundary, with no HTTP, model charge or hosted write.
// The loop itself may carry a local response cursor, but Claude must receive
// the assistant's exact tool_use/thinking blocks and each matching tool_result.
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
const catalog = {
  definition: () => ({ metadata: { continuation_input_tokens: 64000, context_input_ceiling_tokens: 96000,
    continuation_summary_tokens: 1600, retained_tool_exchanges: 2, continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Build carefully.', model: { provider: 'anthropic' }, providerAdapter: 'anthropic-messages-v1' }),
  tool,
  text: (key: string) => key,
} as unknown as AiCatalogSession
const claude: AnthropicCallContext = {
  apiKey: 'local-fixture', model: { model_name: 'claude-fixture', input_cost_per_1m_tokens: 1,
    output_cost_per_1m_tokens: 1, cached_input_cost_per_1m_tokens: null },
  systemMessage: 'Build carefully.', maxOutputTokens: 8000, effort: 'high', timeoutMs: 5000,
  log: async () => {},
}
const calls = (ids: string[], name: string) => ids.map(id => ({ id, type: 'function' as const,
  function: { name, arguments: '{}' } }))
const toolReply = (id: string, name: string, ids: string[]): OpenAIServiceResponse<string> => ({
  success: true, data: null, model: 'claude-fixture', responseId: id, usage, outputPhase: 'tool_calls',
  toolCalls: calls(ids, name),
  outputItems: nativeItems([{ type: 'thinking', thinking: 'Read the current revision.', signature: 'signed-thinking' },
    ...ids.map(callId => ({ type: 'tool_use', id: callId, name, input: {} }))]),
})
const finalReply = (id: string): OpenAIServiceResponse<string> => ({
  success: true, data: 'Readback complete.', model: 'claude-fixture', responseId: id, usage,
  outputItems: nativeItems([{ type: 'text', text: 'Readback complete.' }]),
})

test('text provider adapters explicitly choose cursor or replay; non-text adapters fail closed', () => {
  assert.equal(textContinuationMode('openai-responses-v1'), 'provider-cursor')
  assert.equal(textContinuationMode('anthropic-messages-v1'), 'message-replay')
  for (const adapter of ['openai-images-v1', 'openai-embeddings-v1', 'unknown-v1']) {
    assert.throws(() => textContinuationMode(adapter as 'openai-responses-v1'), /ai_profile_incompatible: text continuation adapter/)
  }
})

test('OpenAI Responses keeps its own cursor instead of replaying the local chain', async () => {
  const sent: OpenAIServiceOptions[] = []
  const openaiCatalog = { ...catalog, role: () => ({ systemMessage: 'Build carefully.',
    model: { provider: 'openai' }, providerAdapter: 'openai-responses-v1' }) } as unknown as AiCatalogSession
  const continuation = createBobContextContinuation({ version: 1, aiCatalog: openaiCatalog,
    callModel: async options => {
      sent.push(structuredClone(options))
      return sent.length === 1 ? { ...toolReply('resp_first', 'read_construction_draft', ['call_one']), outputItems: undefined }
        : finalReply('resp_second')
    } })
  const request: OpenAIServiceOptions = { app: 'bob', module: 'global', coworkerId: 'bob',
    functionName: 'structure-worker', aiFunction: 'structure-worker', catalogRoleKey: 'structure-worker',
    messages: [{ role: 'user', content: 'Read the current construction revision.' }],
    tools: [tool('read_construction_draft')] }
  const first = await continuation.call(request)
  await continuation.call({ ...request, previousResponseId: first.responseId,
    messages: [{ role: 'tool', tool_call_id: 'call_one', content: '{"revision":4}' }] })
  assert.equal(sent.length, 2)
  assert.equal(sent[1].previousResponseId, 'resp_first')
  assert.deepEqual(sent[1].messages, [{ role: 'tool', tool_call_id: 'call_one', content: '{"revision":4}' }])
})

test('an unsupported text-loop adapter stops before a paid model dispatch', async () => {
  let posts = 0
  const invalid = { ...catalog, role: () => ({ providerAdapter: 'openai-images-v1' }) } as unknown as AiCatalogSession
  const continuation = createBobContextContinuation({ version: 1, aiCatalog: invalid,
    callModel: async () => { posts++; return finalReply('unexpected') } })
  await assert.rejects(continuation.call({ app: 'bob', module: 'global', coworkerId: 'bob',
    functionName: 'structure-worker', aiFunction: 'structure-worker', catalogRoleKey: 'structure-worker',
    messages: [{ role: 'user', content: 'Check the construction.' }] }), /ai_profile_incompatible: text continuation adapter/)
  assert.equal(posts, 0)
})

test('Bob replays complete Claude tool batches across a saved context checkpoint', async () => {
  const once = async (resume: boolean) => {
    const requests: Record<string, unknown>[] = []
    const create = () => createBobContextContinuation({ version: 1, aiCatalog: catalog, mainResultReferences: 1,
      callModel: async (options: OpenAIServiceOptions) => {
        assert.equal(options.previousResponseId, undefined, 'the local cursor must not enter the Claude request')
        requests.push(await anthropicRequestBody(options, claude))
        return requests.length === 1 ? toolReply('msg_a', 'read_construction_draft', ['call_a', 'call_b']) : finalReply('msg_b')
      } })
    let continuation = create()
    const request: OpenAIServiceOptions = { app: 'bob', module: 'global', functionName: 'ask-bob',
      aiFunction: 'ask-bob', catalogRoleKey: 'ask-bob', coworkerId: 'bob', responseItemsMode: 'preserve',
      messages: [{ role: 'user', content: 'Check the two saved construction details.' }],
      tools: [tool('read_construction_draft')] }
    const first = await continuation.call(request)
    assert.equal(first.responseId, 'msg_a')
    if (resume) {
      const checkpoint = structuredClone(continuation.exportState())
      continuation = create()
      continuation.restoreState(checkpoint)
    }
    const second = await continuation.call({ ...request, previousResponseId: first.responseId,
      messages: [{ role: 'tool', tool_call_id: 'call_a', content: '{"status":"ok","revision":4}' },
        { role: 'tool', tool_call_id: 'call_b', content: '{"status":"ok","revision":5}' }] })
    assert.equal(second.data, 'Readback complete.')
    assert.equal(requests.length, 2, 'checkpoint recovery never replays a paid model call')
    const transcript = requests[1].messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
    assert.deepEqual(transcript.map(m => m.role), ['user', 'assistant', 'user'])
    assert.deepEqual(transcript[1].content.map(b => b.type), ['thinking', 'tool_use', 'tool_use'])
    assert.equal(transcript[1].content[0].signature, 'signed-thinking')
    assert.deepEqual(transcript[2].content.map(b => b.tool_use_id), ['call_a', 'call_b'])
    return requests
  }
  assert.deepEqual(await once(true), await once(false))
})

test('two consecutive Claude tool decisions survive provider-neutral checkpoint recovery', async () => {
  const requests: Record<string, unknown>[] = []
  const create = () => createBobContextContinuation({ version: 1, aiCatalog: catalog,
    callModel: async options => {
      assert.equal(options.previousResponseId, undefined)
      requests.push(await anthropicRequestBody(options, claude))
      return requests.length === 1 ? toolReply('step_one', 'read_construction_draft', ['read_one'])
        : requests.length === 2 ? toolReply('step_two', 'edit_construction_parts', ['edit_two'])
        : finalReply('step_three')
    } })
  const request: OpenAIServiceOptions = { app: 'bob', module: 'global', coworkerId: 'bob',
    functionName: 'structure-worker', aiFunction: 'structure-worker', catalogRoleKey: 'structure-worker',
    messages: [{ role: 'user', content: 'Read the barn wall, then add one window.' }],
    tools: [tool('read_construction_draft'), tool('edit_construction_parts')] }
  let continuation = create()
  const first = await continuation.call(request)
  const checkpointOne = structuredClone(continuation.exportState())
  continuation = create()
  continuation.restoreState(checkpointOne)
  const second = await continuation.call({ ...request, previousResponseId: first.responseId,
    messages: [{ role: 'tool', tool_call_id: 'read_one', content: '{"status":"ok","revision":4}' }] })
  const checkpointTwo = structuredClone(continuation.exportState())
  continuation = create()
  continuation.restoreState(checkpointTwo)
  const third = await continuation.call({ ...request, previousResponseId: second.responseId,
    messages: [{ role: 'tool', tool_call_id: 'edit_two', content: '{"status":"saved","revision":5}' }] })
  assert.equal(third.data, 'Readback complete.')
  assert.equal(requests.length, 3, 'no paid call is replayed after either checkpoint')
  const transcript = requests[2].messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
  assert.deepEqual(transcript.map(message => message.role), ['user', 'assistant', 'user', 'assistant', 'user'])
  assert.deepEqual(transcript.filter(message => message.role === 'assistant').flatMap(message => message.content.map(block => block.type)),
    ['thinking', 'tool_use', 'thinking', 'tool_use'])
  assert.deepEqual(transcript.filter(message => message.role === 'user').flatMap(message => message.content.filter(block => block.type === 'tool_result').map(block => block.tool_use_id)),
    ['read_one', 'edit_two'])
})

test('Konrad receives native Claude tool results after the shared stateless continuation', async () => {
  const requests: Record<string, unknown>[] = []
  const continuation = createBobContextContinuation({ version: 1, aiCatalog: catalog,
    callModel: async options => {
      assert.equal(options.previousResponseId, undefined)
      requests.push(await anthropicRequestBody(options, claude))
      return requests.length === 1 ? toolReply('worker_a', 'read_construction_draft', ['worker_call']) : finalReply('worker_b')
    } })
  const executed: string[] = [], released: string[] = []
  const result = await runWorker({ aiCatalog: catalog, worker: { role: 'role.structure-worker', tool: 'ask_structure_worker',
    tools: [], reads: ['read_construction_draft'], max_steps: 3 },
    callModel: options => continuation.call(options), userId: 'owner', job: { job: 'Check the first window.', findings: null },
    history: [], readCurrent: async () => ({ revision: 4 }), hasAccess: async () => true,
    deadline: Date.now() + 60_000,
    session: { prepare: async () => [tool('read_construction_draft')], execute: async name => {
      executed.push(name); return { status: 'ok', revision: 4 }
    } },
    releaseChain: id => { released.push(id); continuation.release(id) },
  })
  assert.equal(result.status, 'ok')
  assert.deepEqual(executed, ['read_construction_draft'])
  assert.deepEqual(released, ['worker_a'])
  assert.equal(requests.length, 2)
  const transcript = requests[1].messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
  const assistant = transcript.find(m => m.role === 'assistant' && m.content.some(b => b.type === 'tool_use'))
  assert.deepEqual(assistant?.content.map(b => b.type), ['thinking', 'tool_use'])
  assert.deepEqual(transcript.at(-1)?.content.map(b => b.tool_use_id), ['worker_call'])
})
