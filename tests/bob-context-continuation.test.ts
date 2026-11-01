import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { createBobJournal, fingerprint, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { countContextTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const catalog = {
  definition: () => ({ metadata: { continuation_input_tokens: 1000, context_input_ceiling_tokens: 96000, continuation_summary_tokens: 1600, retained_tool_exchanges: 1,
    continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Catalog-owned role instructions.' }),
  schema: (name: string) => ({ name, schema: { type: 'object', properties: { result: { type: 'string' } } } }),
  tool,
} as unknown as AiCatalogSession
const usage = { input_tokens: 950, output_tokens: 100, total_tokens: 1050 }
const call = (id: string, name = 'save_record') => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify({ record_id: id, width: 90 }) } })
const response = (id: string, calls = [call(id)]): OpenAIServiceResponse<any> => ({ success: true, model: 'fixture', responseId: id,
  data: null, usage, outputPhase: 'tool_calls', toolCalls: calls })
const seed: OpenAIServiceOptions = { app: 'bob', module: 'global', functionName: 'ask-bob', coworkerId: 'bob', aiFunction: 'ask-bob',
  catalogRoleKey: 'ask-bob', systemMessage: 'Exact current role. No phase-wide mandate.',
  messages: [{ role: 'user', content: 'Maybe 90 cm wide, but I must measure first. Finish the delegated drawing.' }], tools: [tool('save_record')] }
const output = (id: string, value: unknown = { status: 'saved', saved: true, record_id: id, revision: 7 }) => ({ role: 'tool' as const, tool_call_id: id, content: JSON.stringify(value) })
const handoff = (options: OpenAIServiceOptions) => {
  const source = JSON.parse(String(options.messages![0].content))
  return { success: true, model: 'mini-fixture', data: { summary: '90 cm remains an unconfirmed suggestion. Saved revision 7 exists.',
    open_questions: ['Owner must measure the width.'], next_steps: ['Continue the delegated drawing from the saved revision.'],
    source_refs: source.allowed_source_refs.slice(0, 1) }, usage }
}

const retentionCatalog = (version: unknown, keep = 2) => ({ ...catalog,
  definition: () => ({ metadata: { continuation_input_tokens: 10000, context_input_ceiling_tokens: 96000,
    continuation_summary_tokens: 1600, retained_tool_exchanges: keep,
    ...(version === undefined ? {} : { continuation_retention_version: version }) } }),
}) as unknown as AiCatalogSession

async function commentaryRollover(version: number | undefined, entries: JournalEntry[] = []) {
  const sent: OpenAIServiceOptions[] = []
  let main = 0, dispatched = 0
  const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, Date.now() + 100000)
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: retentionCatalog(version), callModel: async options => {
    sent.push(structuredClone(options))
    return journal.run('model:' + options.functionName, options, async () => {
      dispatched++
      if (options.catalogRoleKey === 'context-compactor') return handoff(options)
      const fixtures = [response('r1', [call('old')]), response('r2', [call('a1'), call('a2')]),
        { ...response('r3', []), data: 'Checking the first saved results.', outputPhase: 'commentary' as const },
        response('r4', [call('b')]),
        { ...response('r5', []), data: 'Checking whether the assignment is complete.', outputPhase: 'commentary' as const },
        { ...response('r6', []), data: 'Finished.', outputPhase: 'final_answer' as const }]
      const result = fixtures[main++]
      return { ...result, usage: { input_tokens: main === 5 ? 11000 : 1, output_tokens: 1, total_tokens: main === 5 ? 11001 : 2 } }
    })
  } })
  const firstReview = { role: 'user' as const, content: 'Completion review: the delegated drawing is still incomplete; continue.' }
  const finalReview = { role: 'user' as const, content: 'Completion review: verify the saved drawing before finishing.' }
  await adapter.call(seed)
  await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('old')] })
  await adapter.call({ ...seed, previousResponseId: 'r2', messages: [output('a2'), output('a1')] })
  await adapter.call({ ...seed, previousResponseId: 'r3', messages: [firstReview] })
  await adapter.call({ ...seed, previousResponseId: 'r4', messages: [output('b')] })
  const result = await adapter.call({ ...seed, previousResponseId: 'r5', messages: [finalReview] })
  return { sent, result, dispatched, firstReview, finalReview, adapter }
}

test('two completed exchanges survive intervening commentary, completion review and parallel outputs', async () => {
  const entries: JournalEntry[] = []
  const first = await commentaryRollover(2, entries)
  const fresh = first.sent.at(-1)!
  assert.equal(fresh.previousResponseId, undefined)
  assert.deepEqual(fresh.messages!.slice(2), [
    { role: 'assistant', content: '', tool_calls: [call('a1'), call('a2')] }, output('a2'), output('a1'),
    { role: 'assistant', content: 'Checking the first saved results.', phase: 'commentary' }, first.firstReview,
    { role: 'assistant', content: '', tool_calls: [call('b')] }, output('b'),
    { role: 'assistant', content: 'Checking whether the assignment is complete.', phase: 'commentary' }, first.finalReview,
  ])
  const summary = first.sent.find(value => value.catalogRoleKey === 'context-compactor')!
  const archived = JSON.parse(JSON.parse(String(summary.messages![0].content)).source_segment.text)
  assert.deepEqual(archived.flatMap((group: any[]) => group.flatMap(message => message.tool_calls ?? [])).map((value: any) => value.id), ['old'])
  assert.equal(first.adapter.readOperation({ call_id: 'old', after: null }, first.result.responseId).status, 'ok')
  const replay = await commentaryRollover(2, entries)
  assert.equal(replay.dispatched, 0, 'renewal replays paid responses instead of rerunning operations')
  assert.deepEqual(replay.result, first.result)
  assert.deepEqual(replay.sent, first.sent)
})

test('pre-fix pinned manifests preserve their exact journal inputs while new manifests opt into exchange counting', async () => {
  const entries: JournalEntry[] = []
  const prior = await commentaryRollover(undefined, entries)
  const fresh = prior.sent.at(-1)!
  assert.deepEqual(fresh.messages!.flatMap(message => message.tool_calls ?? []).map(value => value.id), ['b'])
  const summary = prior.sent.find(value => value.catalogRoleKey === 'context-compactor')!
  // Recorded with the pre-fix implementation, not derived by the new code.
  assert.equal(await fingerprint(summary), 'cc091ff556183139636b9dee92806c4907016e320f91b2910534c584f70bef71')
  assert.equal(await fingerprint(fresh), '4449d2209cf4401782a13b351bc53eecf55956a400090bf84dca1a0566084615')
  const replay = await commentaryRollover(undefined, entries)
  assert.equal(replay.dispatched, 0)
  assert.deepEqual(replay.result, prior.result)
  assert.deepEqual(replay.sent, prior.sent)
  await assert.rejects(commentaryRollover(2, entries), /continuation_changed/)
})

test('unknown retention policies fail before a provider request instead of selecting an implicit algorithm', () => {
  for (const version of [0, 3, null, '2']) assert.throws(() => createBobContextContinuation({ version: 1, aiCatalog: retentionCatalog(version),
    callModel: async () => { throw new Error('Invalid policy reached provider') } }), /context_strategy_invalid/)
})

test('late parallel outputs retain the complete owning exchange across the selected suffix boundary', async () => {
  const sent: OpenAIServiceOptions[] = []
  let main = 0
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: retentionCatalog(2), callModel: async options => {
    sent.push(structuredClone(options))
    if (options.catalogRoleKey === 'context-compactor') return handoff(options)
    const calls = [[call('old')], [call('a1'), call('a2')], [call('b')], [call('c')], []][main++]
    return { ...response('r' + main, calls), usage: { input_tokens: main >= 3 ? 11000 : 1, output_tokens: 1, total_tokens: main >= 3 ? 11001 : 2 } }
  } })
  await adapter.call(seed)
  await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('old')] })
  await adapter.call({ ...seed, previousResponseId: 'r2', messages: [output('a1')] })
  await adapter.call({ ...seed, previousResponseId: 'r3', messages: [output('b')] })
  assert.equal(sent.at(-1)!.previousResponseId, 'r3', 'the incomplete a2 batch keeps its original provider chain')
  assert(!sent.some(value => value.catalogRoleKey === 'context-compactor'))
  await adapter.call({ ...seed, previousResponseId: 'r4', messages: [output('c'), output('a2')] })
  const fresh = sent.at(-1)!
  assert.equal(fresh.previousResponseId, undefined)
  const calls = fresh.messages!.flatMap(message => message.tool_calls ?? []).map(value => value.id)
  const outputs = fresh.messages!.filter(message => message.role === 'tool').map(value => value.tool_call_id)
  assert.deepEqual(calls, ['a1', 'a2', 'b', 'c'])
  assert.deepEqual(outputs, ['a1', 'b', 'c', 'a2'])
  assert.deepEqual([...outputs].sort(), [...calls].sort(), 'fresh native calls have exactly one paired result each')
})

test('commentary cannot evict the only completed exchange while the retention count is not yet filled', async () => {
  const sent: OpenAIServiceOptions[] = []
  let main = 0
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: retentionCatalog(2), callModel: async options => {
    sent.push(structuredClone(options))
    assert.notEqual(options.catalogRoleKey, 'context-compactor')
    main++
    return { ...response('r' + main, main === 1 ? [call('only')] : []),
      data: main === 1 ? null : 'Reviewing the unfinished assignment.', outputPhase: main === 1 ? 'tool_calls' : 'commentary',
      usage: { input_tokens: main >= 3 ? 11000 : 1, output_tokens: 1, total_tokens: main >= 3 ? 11001 : 2 } }
  } })
  await adapter.call(seed)
  await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('only')] })
  const review = { role: 'user' as const, content: 'Completion review: continue the remaining delegated work.' }
  await adapter.call({ ...seed, previousResponseId: 'r2', messages: [review] })
  await adapter.call({ ...seed, previousResponseId: 'r3', messages: [review] })
  assert.equal(sent.at(-1)!.previousResponseId, 'r3')
  assert.deepEqual(sent.at(-1)!.messages, [review])
})

test('rollover keeps exact assignment, latest instructions, native call/output pairs and accessible originals', async () => {
  const sent: OpenAIServiceOptions[] = [], rollovers: string[] = []
  let sequence = 0
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog,
    onRollover: value => rollovers.push(value.functionName), snapshot: () => ({ receipts: [{ record_id: 'r1', revision: 7 }] }),
    callModel: async options => { sent.push(structuredClone(options)); return options.catalogRoleKey === 'context-compactor' ? handoff(options) : response('r' + ++sequence) } })
  await adapter.call(seed)
  await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('r1')] })
  await adapter.call({ ...seed, systemMessage: 'Updated exact tool instructions.', previousResponseId: 'r2', messages: [output('r2')] })
  const fresh = sent.at(-1)!
  assert.equal(fresh.previousResponseId, undefined)
  assert.equal(fresh.systemMessage, 'Updated exact tool instructions.')
  assert.deepEqual(fresh.messages![0], seed.messages![0])
  assert(fresh.tools?.some(value => value.function.name === 'get_work_history'))
  assert.equal(fresh.messages!.at(-2)!.tool_calls![0].id, 'r2')
  assert.deepEqual(fresh.messages!.at(-1), output('r2'))
  const packet = JSON.parse(String(fresh.messages![1].content))
  assert.deepEqual(packet.confirmed_work_state, { receipts: [{ record_id: 'r1', revision: 7 }] })
  assert.deepEqual(packet.completed_operations.map((value: any) => [value.call_id, value.status, value.saved]), [['r1', 'saved', true], ['r2', 'saved', true]])
  assert.deepEqual(rollovers, ['ask-bob'])
  const original = adapter.readOperation({ call_id: 'r1', after: null }, 'r3')
  assert.equal(original.status, 'ok')
  assert.deepEqual(JSON.parse(String(original.content)), { arguments: call('r1').function.arguments, output: output('r1').content })
  assert.equal(adapter.readOperation({ call_id: 'different-turn', after: null }, 'r3').status, 'not_found')
  assert.equal(adapter.readOperation({ call_id: 'r1', after: -1 }, 'r3').status, 'invalid')
})

test('context refresh does not replay paid models or saved operations during worker reconstruction', async () => {
  const entries: JournalEntry[] = []
  let paid = 0, saved = 0, summaries = 0
  const run = async () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, Date.now() + 100000)
    const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: options => journal.run('model:' + options.functionName, options, async () => {
      paid++
      if (options.catalogRoleKey === 'context-compactor') { summaries++; return handoff(options) }
      return response('r' + paid)
    }) })
    let result = await adapter.call(seed)
    for (let i = 0; i < 4; i++) {
      const id = result.toolCalls![0].id
      const write = await journal.run('write', { id }, async () => { saved++; return output(id) })
      result = await adapter.call({ ...seed, previousResponseId: result.responseId, messages: [write] })
    }
    return { result, archive: adapter.readOperation({ call_id: null, after: null }, result.responseId) }
  }
  const first = await run(), counts = { paid, saved, summaries }
  assert(summaries > 0)
  assert.equal(saved, 4)
  assert.deepEqual(await run(), first)
  assert.deepEqual({ paid, saved, summaries }, counts)
})

test('legacy manifests pass identical request and response objects without reading new catalog definitions', async () => {
  const result = response('legacy')
  const adapter = createBobContextContinuation({ version: 0, aiCatalog: new Proxy({} as AiCatalogSession, { get() { throw new Error('legacy catalog touched') } }),
    callModel: async options => { assert.equal(options, seed); return result } })
  assert.equal(await adapter.call(seed), result)
  assert.equal(adapter.readOperation({ call_id: null, after: null }).status, 'invalid')
})

test('incomplete parallel native results keep their provider chain instead of being compacted', async () => {
  const sent: OpenAIServiceOptions[] = []
  let main = 0
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: async options => {
    sent.push(options)
    assert.notEqual(options.catalogRoleKey, 'context-compactor')
    main++
    return response('r' + main, main === 2 ? [call('p1'), call('p2')] : [call('r1')])
  } })
  await adapter.call(seed)
  await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('r1')] })
  await adapter.call({ ...seed, previousResponseId: 'r2', messages: [output('p1')] })
  assert.equal(sent.at(-1)!.previousResponseId, 'r2')
  assert.deepEqual(sent.at(-1)!.messages, [output('p1')])
})

test('specialists can read history internally and mixed batches retain every native output', async () => {
  const sent: OpenAIServiceOptions[] = []
  let main = 0
  const read = (id: string) => ({ id, type: 'function' as const, function: { name: 'get_work_history', arguments: JSON.stringify({ call_id: 'r1', after: null }) } })
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: async options => {
    sent.push(structuredClone(options))
    if (options.catalogRoleKey === 'context-compactor') return handoff(options)
    main++
    if (main === 3) return response('r3', [read('read1')])
    if (main === 4) return response('r4', [read('read2'), call('external')])
    return response('r' + main)
  } })
  const specialist = { ...seed, functionName: 'plan-reviewer', catalogRoleKey: 'plan-reviewer', catalogSchemaKey: 'bob_plan_review' }
  await adapter.call(specialist)
  await adapter.call({ ...specialist, previousResponseId: 'r1', messages: [output('r1')] })
  const mixed = await adapter.call({ ...specialist, previousResponseId: 'r2', messages: [output('r2')] })
  assert.deepEqual(mixed.toolCalls?.map(value => value.id), ['external'])
  const historyOnly = sent.find(value => value.messages?.some(message => message.tool_call_id === 'read1'))!
  assert(historyOnly.messages?.some(value => value.tool_call_id === 'read1'))
  assert.equal(historyOnly.structuredToolOutput, true)
  assert.equal(JSON.parse(String(historyOnly.messages!.find(value => value.tool_call_id === 'read1')!.content)).call_id, 'r1')
  await adapter.call({ ...specialist, previousResponseId: 'r4', messages: [output('external')] })
  // A subsequent rollover may resend the pair in a fresh chain; both calls and
  // outputs must nevertheless remain present and matched, never re-executed.
  const following = sent.at(-1)!
  assert(following.messages?.some(value => value.tool_call_id === 'read2'))
  assert(following.messages?.some(value => value.tool_call_id === 'external'))
})

test('original operation pages reassemble exactly without imposing a work limit', async () => {
  const content = 'Ångström 🪵 dimension 90 cm, not measured. '.repeat(400)
  let sequence = 0
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: async options =>
    options.catalogRoleKey === 'context-compactor' ? handoff(options) : response('r' + ++sequence) })
  await adapter.call(seed)
  const original = output('r1', { status: 'ok', content })
  await adapter.call({ ...seed, previousResponseId: 'r1', messages: [original] })
  let after: number | null = null, rebuilt = '', pages = 0
  do {
    const page = adapter.readOperation({ call_id: 'r1', after }, 'r2')
    assert.equal(page.status, 'ok')
    assert(countContextTokens(String(page.content)) <= 1500)
    rebuilt += page.content
    after = page.next_after as number | null
    pages++
  } while (after !== null)
  assert(pages > 1)
  assert.equal(rebuilt, JSON.stringify({ arguments: call('r1').function.arguments, output: original.content }))
})

test('unverifiable handoff references fail before dropping provider history', async () => {
  let main = 0, attempts = 0
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: async options => {
    if (options.catalogRoleKey === 'context-compactor') {
      attempts++
      const result = handoff(options)
      result.data.source_refs = ['operation:invented-saved-receipt']
      return result
    }
    return response('r' + ++main)
  } })
  await adapter.call(seed)
  await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('r1')] })
  await assert.rejects(adapter.call({ ...seed, previousResponseId: 'r2', messages: [output('r2')] }), /context_compaction_unavailable/)
  assert.equal(attempts, 2)
  assert.equal(main, 2)
})

test('independent colleague chains cannot read each other’s operations or inherit private context', async () => {
  const sent: OpenAIServiceOptions[] = []
  let main = 0
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog, callModel: async options => {
    sent.push(structuredClone(options))
    if (options.catalogRoleKey === 'context-compactor') return handoff(options)
    main++
    if (main === 5) return response('r5', [{ id: 'cross-read', type: 'function', function: { name: 'get_work_history', arguments: JSON.stringify({ call_id: 'r1', after: null }) } }])
    return response('r' + main)
  } })
  await adapter.call(seed)
  await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('r1', { status: 'ok', private_text: 'Owner private detail' })] })
  const reviewer = { ...seed, functionName: 'cad-reviewer', catalogRoleKey: 'cad-reviewer', messages: [{ role: 'user' as const, content: 'Review only this independent drawing.' }] }
  await adapter.call(reviewer)
  await adapter.call({ ...reviewer, previousResponseId: 'r3', messages: [output('r3')] })
  const final = await adapter.call({ ...reviewer, previousResponseId: 'r4', messages: [output('r4')] })
  assert.equal(adapter.readOperation({ call_id: 'r1', after: null }, final.responseId).status, 'not_found')
  const index = adapter.readOperation({ call_id: null, after: null }, final.responseId)
  assert(!(index.operations as any[]).some(item => item.call_id === 'r1'))
  const reviewerWire = sent.filter(value => value.functionName === 'cad-reviewer')
  assert(!JSON.stringify(reviewerWire).includes('Owner private detail'))
  const lookupOutput = reviewerWire.flatMap(value => value.messages ?? []).find(value => value.tool_call_id === 'cross-read')!
  assert.deepEqual(JSON.parse(String(lookupOutput.content)), { status: 'not_found' })
  await assert.rejects(adapter.call({ ...reviewer, previousResponseId: 'r2', messages: [] }), /context_chain_scope_mismatch/)
})

test('token estimates resolve catalog output and tool schemas before deciding to refresh', async () => {
  let main = 0, summaries = 0
  const schemaText = 'A detailed schema description for a nested required field. '.repeat(150)
  const withSchema = { ...catalog, schema: (name: string) => ({ name, description: schemaText,
    schema: { type: 'object', properties: { result: { type: 'string', description: schemaText } } } }) } as AiCatalogSession
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: withSchema, callModel: async options => {
    if (options.catalogRoleKey === 'context-compactor') { summaries++; return handoff(options) }
    assert.equal(options.schema, undefined, 'counting must not mutate the original journalled request')
    return { ...response('r' + ++main), usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }
  } })
  const request = { ...seed, catalogSchemaKey: 'complex_specialist_output' }
  await adapter.call(request)
  await adapter.call({ ...request, previousResponseId: 'r1', messages: [output('r1')] })
  await adapter.call({ ...request, previousResponseId: 'r2', messages: [output('r2')] })
  assert.equal(summaries, 1)
})

test('oversized indispensable input returns an explicit error without truncation or model dispatch', async () => {
  let sent = 0
  const smallEnvelope = { ...catalog, definition: () => ({ metadata: { continuation_input_tokens: 1000,
    context_input_ceiling_tokens: 2000, continuation_summary_tokens: 1600, retained_tool_exchanges: 1 } }) } as unknown as AiCatalogSession
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: smallEnvelope,
    callModel: async () => { sent++; return response('r1') } })
  const text = 'This exact original must never be silently cut. '.repeat(1000)
  await assert.rejects(adapter.call({ ...seed, messages: [{ role: 'user', content: text }] }), /context_input_too_large/)
  assert.equal(sent, 0)
  await adapter.call(seed)
  await assert.rejects(adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('r1', { status: 'ok', text })] }), /context_input_too_large/)
  assert.equal(sent, 1)
  const hugeSchema = { ...smallEnvelope, schema: (name: string) => ({ name, schema: { type: 'string', description: text } }) } as AiCatalogSession
  const specialist = createBobContextContinuation({ version: 1, aiCatalog: hugeSchema,
    callModel: async () => { throw new Error('Oversized resolved schema reached provider') } })
  await assert.rejects(specialist.call({ ...seed, catalogSchemaKey: 'huge' }), /context_input_too_large/)
})

test('several interleaved colleague chains compact, finish and replay without extra paid or saved work', async () => {
  const entries: JournalEntry[] = []
  const roles = ['ask-bob', 'plan-reviewer', 'cad-reviewer', 'plan-compiler']
  const rounds = new Map<string, number>()
  let paid = 0, saves = 0, summaries = 0
  const run = async () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, Date.now() + 100000)
    const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog,
      callModel: options => journal.run('model:' + options.functionName, options, async () => {
        paid++
        if (options.catalogRoleKey === 'context-compactor') { summaries++; return handoff(options) }
        const round = (rounds.get(options.functionName) ?? 0) + 1
        rounds.set(options.functionName, round)
        return round === 6 ? { ...response(options.functionName + '-finished', []), data: 'Finished delegated work.', outputPhase: 'final_answer' as const }
          : response(options.functionName + '-' + round)
      }) })
    const states = new Map<string, OpenAIServiceResponse<any>>()
    for (const role of roles) states.set(role, await adapter.call({ ...seed, functionName: role, catalogRoleKey: role,
      messages: [{ role: 'user', content: 'Exact delegated assignment for ' + role }] }))
    for (let step = 0; step < 5; step++) for (const role of roles) {
      const before = states.get(role)!, id = before.toolCalls![0].id
      const write = await journal.run('tool:' + role, { id }, async () => { saves++; return output(id) })
      states.set(role, await adapter.call({ ...seed, functionName: role, catalogRoleKey: role,
        previousResponseId: before.responseId, messages: [write] }))
    }
    // Finished specialist chains are dropped; only Bob's own head stays resumable.
    assert.deepEqual(adapter.exportState().chains.map(([id]) => id), ['ask-bob-finished'])
    return roles.filter(role => role === 'ask-bob').map(role => {
      const state = states.get(role)!
      assert.equal(state.outputPhase, 'final_answer')
      const archive = adapter.readOperation({ call_id: null, after: null }, state.responseId)
      assert.equal((archive.operations as any[]).length, 5)
      assert((archive.operations as any[]).every(item => item.call_id.startsWith(role + '-')))
      return { state, archive }
    })
  }
  const first = await run(), counts = { paid, saves, summaries }
  assert(summaries >= roles.length * 3)
  assert.equal(saves, 20)
  assert.deepEqual(await run(), first)
  assert.deepEqual({ paid, saves, summaries }, counts)
})

test('rollover atomically refreshes the tool surface and retains it through internal history calls', async () => {
  const surfaceCatalog = { ...catalog, definition: () => ({ metadata: { continuation_input_tokens: 10000,
    context_input_ceiling_tokens: 96000, continuation_summary_tokens: 1600, retained_tool_exchanges: 1 } }) } as unknown as AiCatalogSession
  const sent: OpenAIServiceOptions[] = []
  let main = 0, refreshed = 0
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: surfaceCatalog,
    refreshSurface: async () => { refreshed++; return { systemMessage: 'Fresh compact role and directory.', tools: [tool('describe_tool')],
      catalogSchemaParameters: { include_manual: false }, catalogToolParameters: undefined } },
    callModel: async options => {
      sent.push(structuredClone(options))
      if (options.catalogRoleKey === 'context-compactor') return handoff(options)
      main++
      if (main === 3) return { ...response('r3', [{ id: 'read', type: 'function', function: { name: 'get_work_history',
        arguments: JSON.stringify({ call_id: 'r1', after: null }) } }]), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
      return { ...response('r' + main), usage: { input_tokens: main < 3 ? 11000 : 1, output_tokens: 1, total_tokens: 11001 } }
    } })
  await adapter.call(seed)
  await adapter.call({ ...seed, previousResponseId: 'r1', messages: [output('r1')] })
  await adapter.call({ ...seed, previousResponseId: 'r2', messages: [output('r2')] })
  assert.equal(refreshed, 1)
  const freshCalls = sent.filter(value => value.functionName === 'ask-bob').slice(2)
  assert.equal(freshCalls.length, 2)
  for (const request of freshCalls) {
    assert.equal(request.systemMessage, 'Fresh compact role and directory.')
    assert.deepEqual(request.tools?.map(value => value.function.name), ['describe_tool', 'get_work_history'])
    assert.deepEqual(request.catalogSchemaParameters, { include_manual: false })
  }
})

test('native image token allowance is independent of URL/base64 encoding and preserves provider pixels', async () => {
  const inline = 'data:image/jpeg;base64,' + 'QWERTYabcd12345'.repeat(60000)
  const reference = 'private-image:same-image/1'
  const sent: OpenAIServiceOptions[] = []
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: catalog,
    callModel: async options => { sent.push(options); return response('image-' + sent.length) } })
  for (const image_url of [inline, reference]) {
    const request = { ...seed, messages: [{ role: 'user' as const,
      content: [{ type: 'text' as const, text: 'Inspect this exact image.' }, { type: 'image_url' as const, image_url }] }] }
    await adapter.call(request)
    assert.deepEqual(sent.at(-1)!.messages, request.messages)
  }
  assert.equal(sent.length, 2)
  const small = { ...catalog, definition: () => ({ metadata: { continuation_input_tokens: 1000,
    context_input_ceiling_tokens: 2000, continuation_summary_tokens: 1600, retained_tool_exchanges: 1 } }) } as unknown as AiCatalogSession
  const guarded = createBobContextContinuation({ version: 1, aiCatalog: small, callModel: async () => { throw new Error('Image allowance was ignored') } })
  await assert.rejects(guarded.call({ ...seed, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: reference }] }] }), /context_input_too_large/)
})

test('reported input is counted once, so a refreshed request is not summarized again on every step', async () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => 'ord' + (i % 97)).join(' ')
  const run = async (rolloverVersion?: 1) => {
    const policy = { definition: () => ({ metadata: { continuation_input_tokens: 10000, context_input_ceiling_tokens: 96000,
      continuation_summary_tokens: 1600, retained_tool_exchanges: 2, continuation_retention_version: 2 } }) }
    const big = { type: 'function' as const, function: { name: 'read_construction_draft', description: words(3000), parameters: { type: 'object' } } }
    let rollovers = 0, main = 0, provider = 0
    const adapter = createBobContextContinuation({ version: 1, ...(rolloverVersion ? { rolloverVersion } : {}), aiCatalog: { ...catalog, ...policy } as unknown as AiCatalogSession,
      onRollover: () => { rollovers++ }, callModel: async options => {
        if (options.catalogRoleKey === 'context-compactor') return handoff(options)
        main++
        // Provider input includes instructions, tools and the whole chain.
        provider = options.previousResponseId ? provider + 50 + countContextTokens(JSON.stringify(options.messages))
          : countContextTokens(JSON.stringify({ system: options.systemMessage, tools: options.tools, messages: options.messages }))
        return { ...response('r' + main, [call('c' + main, 'read_construction_draft')]), usage: { input_tokens: provider, output_tokens: 600, total_tokens: provider + 600 } }
      } })
    const start = { ...seed, tools: [big], messages: [{ role: 'user' as const, content: 'Finish the delegated drawing. ' + words(500) }] }
    let last = await adapter.call(start)
    for (let step = 1; step < 30; step++) last = await adapter.call({ ...start, previousResponseId: last.responseId,
      messages: [output('c' + main, { status: 'ok', page: words(300) })] })
    return { rollovers, main }
  }
  const before = await run(), after = await run(1)
  assert.equal(before.main, 30); assert.equal(after.main, 30)
  assert(before.rollovers >= 20, `pinned version 0 reproduces the per-step refresh: ${before.rollovers}`)
  assert(after.rollovers <= 6, `a refresh happens only when it frees real room: ${after.rollovers}`)
})

// Live 2026-10-20: a CAD review with four high-detail previews, two reference
// photos and the checked construction stopped at the main-turn 96k ceiling.
test('a specialist request uses its own wider envelope while Bob keeps the main ceiling', async () => {
  let sent = 0
  const envelope = { ...catalog, definition: () => ({ metadata: { continuation_input_tokens: 64000,
    context_input_ceiling_tokens: 96000, continuation_summary_tokens: 1600, retained_tool_exchanges: 1 } }) } as unknown as AiCatalogSession
  const adapter = createBobContextContinuation({ version: 1, aiCatalog: envelope, callModel: async () => { sent++; return response('r' + sent) } })
  const preview = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA', detail: 'high' as const } }
  const review = [{ role: 'user' as const, content: [...Array.from({ length: 12 }, () => preview)] }]
  const reviewer = { ...seed, functionName: 'cad-reviewer', aiFunction: 'cad-reviewer', catalogRoleKey: 'cad-reviewer', messages: review }
  await adapter.call(reviewer)
  assert.equal(sent, 1)
  await assert.rejects(adapter.call({ ...seed, messages: review }), /context_input_too_large/)
  await assert.rejects(adapter.call({ ...reviewer, messages: [{ role: 'user', content: Array.from({ length: 30 }, () => preview) }] }), /context_input_too_large/)
  assert.equal(sent, 1)
})

// Live 2026-11-01 (job da79a46e): Konrad's chain refreshed at Bob's 64k limit on a
// 70-part construction, about 20 reads, 7 summaries and no save.
test('a worker refreshes at the pinned specialist limit while Bob keeps his own', async () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => 'ord' + (i % 97)).join(' ')
  const run = async (role: string, specialistContinuationTokens?: number) => {
    const policy = { definition: () => ({ metadata: { continuation_input_tokens: 10000, context_input_ceiling_tokens: 96000,
      continuation_summary_tokens: 1600, retained_tool_exchanges: 2, continuation_retention_version: 2 } }) }
    let rollovers = 0, main = 0, provider = 0
    const adapter = createBobContextContinuation({ version: 1, rolloverVersion: 1, ...(specialistContinuationTokens ? { specialistContinuationTokens } : {}),
      aiCatalog: { ...catalog, ...policy } as unknown as AiCatalogSession,
      onRollover: () => { rollovers++ }, callModel: async options => {
        if (options.catalogRoleKey === 'context-compactor') return handoff(options)
        main++
        provider = options.previousResponseId ? provider + 50 + countContextTokens(JSON.stringify(options.messages))
          : countContextTokens(JSON.stringify({ system: options.systemMessage, tools: options.tools, messages: options.messages }))
        return { ...response('r' + main, [call('c' + main, 'read_construction_draft')]), usage: { input_tokens: provider, output_tokens: 600, total_tokens: provider + 600 } }
      } })
    const start = { ...seed, functionName: role, aiFunction: role, catalogRoleKey: role, tools: [tool('read_construction_draft')],
      messages: [{ role: 'user' as const, content: 'Build the bunk bed. ' + words(500) }] }
    let last = await adapter.call(start)
    for (let step = 1; step < 40; step++) last = await adapter.call({ ...start, previousResponseId: last.responseId,
      messages: [output('c' + main, { status: 'ok', page: words(800) })] })
    return rollovers
  }
  assert((await run('structure-worker')) >= 3, 'without the pin a worker refreshes at Bob\'s limit')
  assert.equal(await run('structure-worker', 150000), 0)
  assert((await run('ask-bob', 150000)) >= 3, 'Bob keeps his own limit')
})
