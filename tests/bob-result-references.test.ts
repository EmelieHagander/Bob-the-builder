import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bobResultPage, projectBobResult, BOB_RESULT_PAGE_TOKENS, type BobArchivedOperation } from '../supabase/functions/_shared/bob-result-references.ts'
import { countSerializedTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { createResumeProbe } from '../scripts/benchmark-bob-resume.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

const disk = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: 'Manual ' + name, parameters: { type: 'object' } } })
const catalog = { definition: () => ({ metadata: { continuation_input_tokens: 1000, context_input_ceiling_tokens: 96000,
  continuation_summary_tokens: 1600, retained_tool_exchanges: 1, continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Keep uncertainty explicit.' }), tool } as unknown as AiCatalogSession
const call = (id: string, name = 'read_record', args: unknown = {}) => ({ id, type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) } })
const response = (id: string, calls = [call(id)]): OpenAIServiceResponse => ({ success: true, model: 'fixture', data: null,
  responseId: id, toolCalls: calls, outputPhase: 'tool_calls', usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140, reasoning_tokens: 20 },
  outputItems: [{ type: 'reasoning', id: 'rs_' + id, summary: [], encrypted_content: 'opaque-' + id },
    ...calls.map(c => ({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments }))] })
const seed: OpenAIServiceOptions = { app: 'bob', coworkerId: 'bob', module: 'global', functionName: 'ask-bob', catalogRoleKey: 'ask-bob',
  responseItemsMode: 'preserve', tools: [tool('read_record'), tool('save_record')], messages: [
    { role: 'user', content: 'Do not treat the proposed 90 cm width as measured.' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'private-image:revision3', detail: 'low' } }] },
  ] }
const output = (id: string, content = 'Exact observed record.') => ({ role: 'tool' as const, tool_call_id: id, content })
const large = JSON.stringify({ status: 'ok', revision: 3, details: 'å😀\\\"\nMeasure before cutting. '.repeat(1500) })
const operation: BobArchivedOperation = { call_id: 'first', tool_name: 'read_record', arguments: '{"revision":3}', output: large }

test('bounded Unicode pages recover the exact original including escaping and trailing constraints', () => {
  let recovered = '', after = 0, pages = 0
  do {
    const page = bobResultPage(operation, after)
    assert(countSerializedTokens(JSON.stringify(page)) <= BOB_RESULT_PAGE_TOKENS)
    assert.equal(page.after, after)
    recovered += page.content
    pages++
    if (page.next_after === null) break
    assert(Number(page.next_after) > after)
    after = Number(page.next_after)
  } while (pages < 300)
  assert(pages > 1 && pages < 300)
  assert.deepEqual(JSON.parse(recovered), { arguments: operation.arguments, output: large })
  for (const cursor of [-1, 0.5, NaN, Infinity, 99999999]) assert.throws(() => bobResultPage(operation, cursor), /context_cursor_invalid/)
  const projected = String(projectBobResult(operation, false))
  assert(countSerializedTokens(projected) <= BOB_RESULT_PAGE_TOKENS)
  assert.equal(JSON.parse(String(projectBobResult(operation, true))).observed_result.revision, 3)
  assert.equal(operation.output, large)
})

test('old writes, repair feedback and image results retain their content rather than becoming read references', () => {
  for (const [name, body] of [ ['save_record', { saved: true, status: 'saved', revision: 7 }],
    ['read_record', { status: 'denied', error: 'No authority.' }], ['check_record', { status: 'ok', issues: ['Unmeasured width.'] }] ] as const) {
    const content = JSON.stringify(body)
    assert.equal(projectBobResult({ ...operation, tool_name: name, output: content }, true), content)
  }
  const pixels = seed.messages![1].content
  assert.deepEqual(projectBobResult({ ...operation, output: pixels }, true), pixels)
})

test('43 native steps restore references and exact originals, without compaction or repeated dispatch', async () => {
  async function run(resume: boolean) {
    const sent: OpenAIServiceOptions[] = []
    const opts = { version: 1, mainResultReferences: 1 as const, aiCatalog: catalog, callModel: async (request: OpenAIServiceOptions) => {
      assert.equal(request.functionName, 'ask-bob', 'no paid summary calls even at a 1000-token legacy threshold')
      sent.push(disk(request)); return response('r' + sent.length)
    } }
    let adapter = createBobContextContinuation(opts)
    for (let i = 0; i < 43; i++) {
      if (resume) { const saved = disk(adapter.exportState()); adapter = createBobContextContinuation(opts); adapter.restoreState(saved) }
      await adapter.call(i === 0 ? seed : { ...seed, previousResponseId: 'r' + i, messages: [output('r' + i, large)] })
    }
    const last = sent.at(-1)!
    assert.equal(sent.length, 43)
    assert.equal(last.previousResponseId, undefined)
    assert.deepEqual(last.messages!.slice(0, 2), seed.messages)
    assert.equal(last.messages!.filter(m => m.nativeOutput).length, 42)
    assert(last.tools!.some(t => t.function.name === 'get_work_history'))
    assert(last.tools!.some(t => t.function.name === 'save_record'))
    const results = last.messages!.filter(m => m.role === 'tool')
    assert.equal(results.filter(m => JSON.parse(String(m.content)).content_omitted).length, 40)
    for (const result of results) assert(countSerializedTokens(String(result.content)) <= BOB_RESULT_PAGE_TOKENS)
    // Fixture estimate only: real reasoning/image usage still needs measured acceptance.
    assert(countSerializedTokens(last) + 42 * 20 + 1024 < 64000)
    assert.equal(adapter.readOperation({ call_id: 'r1', after: null }, 'other-turn').status, 'not_found')
    assert.equal(adapter.readOperation({ call_id: 'unknown', after: null }, 'r43').status, 'not_found')
    assert.equal(adapter.readOperation({ call_id: 'r1', after: -1 }, 'r43').status, 'invalid')
    let original = '', cursor: number | null = null
    do { const page = adapter.readOperation({ call_id: 'r1', after: cursor }, 'r43'); original += page.content; cursor = page.next_after as number | null } while (cursor !== null)
    assert.equal(JSON.parse(original).output, large)
    const state = disk(adapter.exportState())
    assert.equal(state.chains.length, 1)
    assert.equal(state.chains[0][1].operations.length, 42)
    assert.equal(state.chains[0][1].compacted, false)
    assert.throws(() => createBobContextContinuation({ ...opts, mainResultReferences: undefined }).restoreState(state), /context_checkpoint_invalid/)
    return { sent, state }
  }
  assert.deepEqual(await run(true), await run(false))
})

test('mixed history and external calls resume as exact paired outputs without re-executing archived writes', async () => {
  let step = 0
  const requests: OpenAIServiceOptions[] = []
  const opts = { version: 1, mainResultReferences: 1 as const, aiCatalog: catalog, callModel: async (request: OpenAIServiceOptions) => {
    requests.push(disk(request)); step++
    return response('r' + step, step === 1 ? [call('write', 'save_record')] : step === 2
      ? [call('recall', 'get_work_history', { call_id: 'write', after: null }), call('fresh')] : [call('next')])
  } }
  let adapter = createBobContextContinuation(opts)
  await adapter.call(seed)
  const receipt = JSON.stringify({ saved: true, revision: 7, record_id: 'actual-save' })
  const mixed = await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('write', receipt)] })
  assert.deepEqual(mixed.toolCalls?.map(t => t.id), ['fresh'])
  const saved = disk(adapter.exportState()); adapter = createBobContextContinuation(opts); adapter.restoreState(saved)
  await adapter.call({ ...seed, previousResponseId: 'r2', messages: [output('fresh')] })
  const final = requests.at(-1)!
  const recall = final.messages!.find(m => m.tool_call_id === 'recall')!
  assert.equal(JSON.parse(JSON.parse(String(recall.content)).content).output, receipt)
  assert.equal(requests.length, 3)
  assert.equal(final.messages!.filter(m => m.tool_call_id === 'write').length, 1)
})

test('history-only followups recheck dispatch authorization and cannot cross into another chain', async () => {
  let posts = 0, checks = 0
  const adapter = createBobContextContinuation({ version: 1, mainResultReferences: 1, aiCatalog: catalog,
    callModel: async (_request, beforeDispatch) => { await beforeDispatch?.(); posts++;
      return response('r' + posts, [call('history' + posts, 'get_work_history', { call_id: 'foreign-call', after: null })]) } })
  await assert.rejects(adapter.call(seed, async () => { if (++checks > 1) throw new Error('access_revoked') }), /access_revoked/)
  assert.equal(posts, 1)
  assert.equal(adapter.exportState().chains[0][1].pendingInternal[0].content, '{"status":"not_found"}')
})

test('large indispensable native reasoning reports existing capacity boundary without summarizing or silently discarding it', async () => {
  let posts = 0
  const adapter = createBobContextContinuation({ version: 1, mainResultReferences: 1, aiCatalog: catalog, callModel: async () => {
    posts++; return { ...response('r1'), usage: { input_tokens: 100, output_tokens: 100000, total_tokens: 100100, reasoning_tokens: 99000 } }
  } })
  await adapter.call(seed)
  await assert.rejects(adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('r1')] }), /context_input_too_large/)
  assert.equal(posts, 1)
  assert.equal(adapter.exportState().chains[0][1].groups[0][0].nativeReasoningTokens, 99000)
})

test('specialist still uses its pinned compactor even when the main-turn version is enabled', async () => {
  let summaries = 0, main = 0
  const adapter = createBobContextContinuation({ version: 1, mainResultReferences: 1, aiCatalog: catalog, callModel: async request => {
    if (request.catalogRoleKey === 'context-compactor') { summaries++; return { success: true, model: 'fixture', data: {
      summary: 'Exact original remains archived.', open_questions: [], next_steps: [], source_refs: [] }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }
    main++; const { outputItems: _items, ...legacy } = response('r' + main); return legacy
  } })
  const specialist = { ...seed, functionName: 'cad-assistant', catalogRoleKey: 'cad-assistant', responseItemsMode: undefined }
  await adapter.call(specialist)
  await adapter.call({ ...specialist, previousResponseId: 'r1', messages: [output('r1', 'Large source. '.repeat(700))] })
  await adapter.call({ ...specialist, previousResponseId: 'r2', messages: [output('r2', 'Large source. '.repeat(700))] })
  assert(summaries > 0)
})

test('actual main loop with images and lost write checkpoint completes offline without summaries or duplicate writes', async () => {
  const options = { checkpoint: true, completeRequest: true, resultReferences: true, stress: true }
  const baseline = createResumeProbe({ ...options, yieldMode: 'none' })
  const expected = await baseline.runToEnd()
  const resumed = createResumeProbe({ ...options, yieldMode: 'boundary', loseWriteCheckpoint: true, waitModelAt: 12 })
  let actual: Awaited<ReturnType<typeof resumed.runToEnd>> | undefined
  let waits = 0
  for (let claims = 0; claims < 250; claims++) {
    const result = await resumed.runClaim()
    if (result.status === 'done') { actual = result.result; break }
    if (result.reason === 'ai_wait') { waits++; resumed.completeWaitingModel() }
  }
  assert.equal(waits, 1)
  assert.deepEqual(actual, expected)
  assert.equal(resumed.totals().summaryPosts, 0)
  assert.equal(resumed.totals().writes, 2)
  assert.equal(resumed.totals().providerPosts, baseline.totals().providerPosts)
  assert.deepEqual(resumed.receipts, baseline.receipts)
  assert(resumed.totals().toolTraversals >= 40)
})

test('a token window keeps the newest results whole, so a reopened result survives the next exchanges', async () => {
  const sent: OpenAIServiceOptions[] = []
  const opts = { version: 1, mainResultReferences: 1 as const, resultWindowTokens: 5000, aiCatalog: catalog, callModel: async (request: OpenAIServiceOptions) => {
    sent.push(disk(request)); return response('r' + sent.length)
  } }
  let adapter = createBobContextContinuation(opts)
  const page = projectBobResult({ ...operation, call_id: 'x' }, false)
  const size = countSerializedTokens(page)
  for (let i = 0; i < 12; i++) {
    const saved = disk(adapter.exportState()); adapter = createBobContextContinuation(opts); adapter.restoreState(saved)
    await adapter.call(i === 0 ? seed : { ...seed, previousResponseId: 'r' + i, messages: [output('r' + i, large)] })
  }
  const results = sent.at(-1)!.messages!.filter(m => m.role === 'tool')
  const omitted = results.map(m => !!JSON.parse(String(m.content)).content_omitted)
  const kept = Math.floor(5000 / size)
  // Two latest exchanges are always whole; the window adds the newest older ones, contiguously.
  assert.deepEqual(omitted, results.map((_, i) => i < results.length - 2 - kept))
  assert(kept >= 1 && omitted.some(Boolean))
  // Without the window only the two latest exchanges stay whole (pinned older jobs).
  const legacy: OpenAIServiceOptions[] = []
  const old = createBobContextContinuation({ ...opts, resultWindowTokens: undefined, callModel: async (request: OpenAIServiceOptions) => { legacy.push(disk(request)); return response('r' + legacy.length) } })
  for (let i = 0; i < 12; i++) await old.call(i === 0 ? seed : { ...seed, previousResponseId: 'r' + i, messages: [output('r' + i, large)] })
  assert.equal(legacy.at(-1)!.messages!.filter(m => m.role === 'tool' && !JSON.parse(String(m.content)).content_omitted).length, 2)
})
