import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBobRequest } from '../supabase/functions/_shared/bob-complete-request.ts'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { readResponseItems } from '../supabase/functions/_shared/openai-content.ts'
import { buildBobCompleteHands } from '../supabase/functions/_shared/bob-prompt.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { createResumeProbe } from '../scripts/benchmark-bob-resume.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

const disk = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: 'Exact manual for ' + name, parameters: { type: 'object' } } })
const call = (id: string, name = 'read_record') => ({ id, type: 'function' as const, function: { name, arguments: '{}' } })
const output = (id: string, text = 'Exact source revision 3') => ({ role: 'tool' as const, tool_call_id: id, content: text })
const native = (id: string, calls = [call(id)]) => [
  { type: 'reasoning', id: 'rs_' + id, summary: [], encrypted_content: 'opaque-fixture-' + id },
  { type: 'message', id: 'msg_' + id, role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Reading next record.', annotations: [] }] },
  ...calls.map(c => ({ type: 'function_call', id: 'fc_' + c.id, call_id: c.id, name: c.function.name, arguments: c.function.arguments, status: 'completed' })),
]
const response = (id: string, calls = [call(id)]): OpenAIServiceResponse => ({ success: true, responseId: id, model: 'fixture', data: null,
  toolCalls: calls, outputItems: native(id, calls), outputPhase: 'tool_calls', usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, reasoning_tokens: 10 } })
const seed: OpenAIServiceOptions = { app: 'bob', coworkerId: 'bob', module: 'global', functionName: 'ask-bob', aiFunction: 'ask-bob', catalogRoleKey: 'ask-bob',
  responseItemsMode: 'preserve', messages: [{ role: 'user', content: 'Build from this unmeasured proposal.' }], tools: [tool('read_record')] }
const catalog = (limit = 64000) => ({
  definition: () => ({ metadata: { continuation_input_tokens: limit, context_input_ceiling_tokens: 96000, continuation_summary_tokens: 1600,
    retained_tool_exchanges: 1, continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Exact catalog instructions.' }), tool,
}) as unknown as AiCatalogSession

test('40 complete requests restore exact native items and image inputs without replaying model work', async () => {
  async function run(resume: boolean) {
    const sent: OpenAIServiceOptions[] = []
    const opts = { version: 1, aiCatalog: catalog(), callModel: async (request: OpenAIServiceOptions) => {
      sent.push(disk(request)); return response('r' + sent.length)
    } }
    let adapter = createBobContextContinuation(opts)
    for (let i = 0; i < 40; i++) {
      if (resume) { const saved = disk(adapter.exportState()); adapter = createBobContextContinuation(opts); adapter.restoreState(saved) }
      await adapter.call(i === 0 ? seed : { ...seed, previousResponseId: 'r' + i, messages: [output('r' + i),
        ...(i === 1 ? [{ role: 'user' as const, content: [{ type: 'image_url' as const, image_url: { url: 'private-image:original/rev3', detail: 'low' as const } }] }] : [])] })
      assert.equal(sent.length, i + 1)
      assert.equal(sent[i].previousResponseId, undefined)
      assert.deepEqual(sent[i].messages![0], seed.messages![0])
      assert.equal(sent[i].messages!.filter(m => m.nativeOutput).length, i)
      if (i) assert.deepEqual(sent[i].messages![1].nativeOutput, native('r1'))
      if (i > 1) assert(JSON.stringify(sent[i].messages).includes('private-image:original/rev3'))
    }
    return { sent, state: disk(adapter.exportState()) }
  }
  assert.deepEqual(await run(true), await run(false))
})

test('transitional compaction restores images and mixed history outputs; ciphertext never enters the summarizer', async () => {
  async function run(resume: boolean) {
    const sent: OpenAIServiceOptions[] = []; let main = 0, summaries = 0
    const opts = { version: 1, aiCatalog: catalog(1000), callModel: async (request: OpenAIServiceOptions) => {
      sent.push(disk(request))
      if (request.catalogRoleKey === 'context-compactor') {
        summaries++; assert(!JSON.stringify(request).includes('opaque-fixture-'))
        return { success: true, model: 'fixture', data: { summary: 'Still unmeasured.', open_questions: [], next_steps: ['Read source.'], source_refs: [] }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
      }
      main++
      const calls = main === 3 ? [call('history', 'get_work_history'), call('r3')] : [call('r' + main)]
      if (main === 3) calls[0].function.arguments = JSON.stringify({ call_id: 'r1', after: null })
      return response('r' + main, calls)
    } }
    let adapter = createBobContextContinuation(opts)
    await adapter.call(seed)
    await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('r1', 'Source detail. '.repeat(600)),
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'private-image:keep/rev2', detail: 'low' } }] }] })
    const mixed = await adapter.call({ ...seed, previousResponseId: 'r2', messages: [output('r2')] })
    assert.deepEqual(mixed.toolCalls?.map(c => c.id), ['r3'])
    assert(summaries > 0)
    const saved = disk(adapter.exportState())
    if (resume) { adapter = createBobContextContinuation(opts); adapter.restoreState(saved) }
    await adapter.call({ ...seed, previousResponseId: 'r3', messages: [output('r3')] })
    const final = sent.at(-1)!
    assert.equal(final.previousResponseId, undefined)
    assert(JSON.stringify(final.messages).includes('private-image:keep/rev2'))
    assert(final.messages!.some(m => m.role === 'tool' && m.tool_call_id === 'history'))
    assert.equal(adapter.readOperation({ call_id: 'r1', after: null }, 'r4').status, 'ok')
    return { sent, state: disk(adapter.exportState()) }
  }
  assert.deepEqual(await run(true), await run(false))
})

test('native protocol fails closed on missing reasoning, orphan outputs, unfinished or duplicate calls', () => {
  assert.throws(() => readResponseItems([{ type: 'reasoning', summary: [] }]), /native_reasoning_content_missing/)
  const assistant = { role: 'assistant' as const, content: '', nativeOutput: native('a') }
  for (const [history, error] of [
    [[output('a')], /bob_native_output_orphan/],
    [[assistant], /bob_native_call_unfinished/],
    [[assistant, output('a'), output('a')], /bob_native_output_orphan/],
    [[assistant, assistant, output('a')], /bob_native_call_duplicate/],
  ] as const) assert.throws(() => buildBobRequest(seed, { seed: seed.messages!, history: [...history] }), error)
  const request = buildBobRequest({ ...seed, previousResponseId: 'local-cursor' }, { seed: seed.messages!, history: [assistant, output('a')] })
  assert.equal(request.previousResponseId, undefined)
  assert.deepEqual(request.messages![1].nativeOutput, native('a'))
})

test('all authorized directory cards precede workflows and keep their prefix when callability changes', () => {
  const aiCatalog = catalogFixture()
  const names = ['describe_tool', 'read_project_edit_context', 'save_project_task']
  const shelf = names.map(name => ({ name, group: 'Tools', state: 'offered' as const, description: aiCatalog.tool(name, { card: true }).function.description, instructionLoaded: false }))
  const first = buildBobCompleteHands(aiCatalog, [aiCatalog.tool('describe_tool')], shelf)
  const second = buildBobCompleteHands(aiCatalog, names.map(name => aiCatalog.tool(name)), shelf.map(s => ({ ...s, instructionLoaded: true })))
  assert.equal(first.split('{"tool_availability":')[0], second.split('{"tool_availability":')[0])
  for (const name of names) assert(first.includes('- ' + name + ': '))
})

test('main loop resumes complete requests across every boundary with manuals and two ledger writes intact', async () => {
  const requests: OpenAIServiceOptions[] = []
  const baseline = createResumeProbe({ checkpoint: true, yieldMode: 'none', completeRequest: true })
  const expected = await baseline.runToEnd()
  const resumed = createResumeProbe({ checkpoint: true, yieldMode: 'boundary', completeRequest: true,
    onRequest: request => { if (request.functionName === 'ask-bob') requests.push(disk(request)) } })
  assert.deepEqual(await resumed.runToEnd(), expected)
  assert.equal(resumed.totals().writes, 2)
  assert.equal(resumed.totals().providerPosts, baseline.totals().providerPosts)
  assert.equal(resumed.totals().toolTraversals, baseline.totals().toolTraversals)
  assert.equal(resumed.totals().modelRequests, baseline.totals().modelRequests)
  assert(requests.length >= 40)
  for (const request of requests) {
    assert.equal(request.previousResponseId, undefined)
    assert.equal(request.responseItemsMode, 'preserve')
    assert(JSON.stringify(request.messages).includes('private-image:'))
    assert(request.systemMessage!.includes('- save_project_task:'))
  }
  const loaded = requests.slice(1)
  for (const request of loaded) {
    assert.deepEqual(request.catalogToolParameters?.save_project_task, { card: false, include_manual: true })
    // Native, or (tool-sheet manifests, 2026-10-30) described in the conversation and callable through use_tool.
    assert(request.tools!.some(t => t.function.name === 'save_project_task') || request.tools!.some(t => t.function.name === 'use_tool')
      && request.messages!.some(m => typeof m.content === 'string' && m.content.includes('"name":"save_project_task"')))
  }
  assert.deepEqual(resumed.receipts, baseline.receipts)
})
