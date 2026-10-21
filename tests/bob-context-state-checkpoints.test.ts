import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobContextContinuation } from '../supabase/functions/_shared/bob-context-continuation.ts'
import { prepareWorkingContext, restoreWorkingContext, type ContextStore } from '../supabase/functions/_shared/bob-working-context.ts'
import { boundProjectOrientation, restoreOrientationDirectory } from '../supabase/functions/_shared/bob-orientation-directory.ts'
import { createExecutionMetrics, type ExecutionEvent } from '../supabase/functions/_shared/execution-metrics.ts'
import type { AiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import type { ProjectOrientation } from '../supabase/functions/_shared/bob-project-orientation.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

const disk = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } })
const toolCall = (id: string, name = 'read_record') => ({ id, type: 'function' as const, function: { name, arguments: '{}' } })
const output = (id: string) => ({ role: 'tool' as const, tool_call_id: id, content: JSON.stringify({ status: 'ok', record_id: id, revision: 3 }) })
const catalog = (limit = 64_000) => ({
  definition: () => ({ metadata: { continuation_input_tokens: limit, context_input_ceiling_tokens: 96_000,
    continuation_summary_tokens: 1600, retained_tool_exchanges: 1, continuation_retention_version: 2 } }),
  role: () => ({ systemMessage: 'Catalog instructions.' }),
  schema: (name: string) => ({ name, schema: { type: 'object', properties: {} } }), tool,
}) as unknown as AiCatalogSession
const request: OpenAIServiceOptions = { app: 'bob', coworkerId: 'bob', module: 'global', aiFunction: 'ask-bob', functionName: 'ask-bob',
  catalogRoleKey: 'ask-bob', messages: [{ role: 'user', content: [
    { type: 'text', text: 'Continue the drawing. The width is still unmeasured.' },
    { type: 'image_url', image_url: { url: 'private-image:fixture-original', detail: 'low' } },
  ] }], tools: [tool('read_record')] }
const result = (id: string, calls = [toolCall(id)]): OpenAIServiceResponse => ({ success: true, data: null, model: 'fixture', responseId: id,
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, toolCalls: calls, outputPhase: 'tool_calls' })

test('40 restored model actions retain exact native image and operation state without replaying earlier calls', async () => {
  async function run(resume: boolean) {
    const sent: OpenAIServiceOptions[] = []
    const opts = { version: 1, aiCatalog: catalog(), callModel: async (options: OpenAIServiceOptions) => {
      sent.push(structuredClone(options)); return result('r' + sent.length)
    } }
    let continuation = createBobContextContinuation(opts)
    for (let i = 0; i < 40; i++) {
      if (resume) {
        const saved = disk(continuation.exportState())
        continuation = createBobContextContinuation(opts)
        continuation.restoreState(saved)
        assert.deepEqual(continuation.exportState(), saved)
      }
      await continuation.call(i === 0 ? request : { ...request, previousResponseId: 'r' + i, messages: [output('r' + i)] })
      assert.equal(sent.length, i + 1)
    }
    return { sent, saved: disk(continuation.exportState()), archived: continuation.readOperation({ call_id: 'r1', after: null }, 'r40') }
  }
  const direct = await run(false), resumed = await run(true)
  assert.deepEqual(resumed, direct)
  assert.equal(resumed.saved.chains.length, 1)
  assert.equal(resumed.saved.chains[0][1].operations.length, 39)
  assert.equal(resumed.archived.status, 'ok')
  assert.deepEqual(resumed.saved.chains[0][1].seed, request.messages)
})

test('restore preserves compaction handoff and mixed native history outputs pending the next model action', async () => {
  async function run(resume: boolean) {
    const sent: OpenAIServiceOptions[] = []
    let main = 0
    const opts = { version: 1, aiCatalog: catalog(1000), callModel: async (options: OpenAIServiceOptions) => {
      sent.push(structuredClone(options))
      if (options.catalogRoleKey === 'context-compactor') {
        const source = JSON.parse(String(options.messages![0].content))
        return { ...result('summary', []), data: { summary: 'Measurements remain unconfirmed.', open_questions: [], next_steps: ['Read next record.'],
          source_refs: source.allowed_source_refs.slice(0, 1) } }
      }
      main++
      const calls = main === 3 ? [toolCall('history', 'get_work_history'), toolCall('r3')] : [toolCall('r' + main)]
      if (main === 3) calls[0].function.arguments = JSON.stringify({ call_id: 'r1', after: null })
      return { ...result('r' + main, calls), usage: { input_tokens: 2000, output_tokens: 100, total_tokens: 2100 } }
    } }
    let continuation = createBobContextContinuation(opts)
    await continuation.call(request)
    await continuation.call({ ...request, previousResponseId: 'r1', messages: [output('r1')] })
    const mixed = await continuation.call({ ...request, previousResponseId: 'r2', messages: [output('r2')] })
    assert.deepEqual(mixed.toolCalls?.map(call => call.id), ['r3'])
    const saved = disk(continuation.exportState())
    assert.equal(saved.chains[0][1].pendingInternal[0].tool_call_id, 'history')
    assert.equal(saved.chains[0][1].handoff?.summary, 'Measurements remain unconfirmed.')
    if (resume) { continuation = createBobContextContinuation(opts); continuation.restoreState(saved) }
    await continuation.call({ ...request, previousResponseId: 'r3', messages: [output('r3')] })
    return { sent, saved: disk(continuation.exportState()) }
  }
  assert.deepEqual(await run(true), await run(false))
})

test('invalid continuation versions and duplicate provider heads fail without modifying restored state', async () => {
  const continuation = createBobContextContinuation({ version: 1, aiCatalog: catalog(), callModel: async () => result('r1') })
  await continuation.call(request)
  const saved = continuation.exportState()
  assert.throws(() => continuation.restoreState({ ...saved, version: 2 } as any), /context_checkpoint_invalid/)
  assert.throws(() => continuation.restoreState({ ...saved, chains: [...saved.chains, ...saved.chains] }), /context_checkpoint_invalid/)
  assert.throws(() => continuation.restoreState({ ...saved, strategyVersion: 0 }), /context_checkpoint_invalid/)
  assert.deepEqual(continuation.exportState(), saved)
  saved.chains[0][1].seed[0].content = 'mutated external snapshot'
  assert.deepEqual(continuation.exportState().chains[0][1].seed, request.messages)
})

test('working-context restoration keeps history counters and immutable startup without loading or folding again', async () => {
  let loads = 0, searches = 0, allowed = true
  const store: ContextStore = {
    load: async () => { loads++; return { projectId: 'project', threadId: 'thread', generation: 1, summary: '', lastFoldedSeq: 0,
      foldThroughSeq: 0, older: [], hasMore: false, recent: [{ seq: 1, role: 'user', state: 'pending', text: 'Continue.' }] } },
    save: async () => { throw new Error('Unexpected fold') },
    search: async () => { searches++; return { projectId: 'project', threadId: 'thread', messages: [], truncated: false, nextBeforeSeq: null } },
  }
  const opts = { projectId: 'project', threadId: 'thread', message: 'Continue.', store, hasAccess: async () => allowed }
  const prepared = await prepareWorkingContext({ ...opts, userId: 'user', generation: 1, deadline: Date.now() + 10000,
    callModel: async () => { throw new Error('Unexpected model') } })
  for (let i = 0; i < 3; i++) await prepared.history.search({ query: '', before_seq: null })
  const saved = disk(prepared.exportState())
  const restored = restoreWorkingContext(saved, opts)
  assert.equal(loads, 1)
  assert.equal(searches, 3)
  assert.equal(restored.history.remaining, 1)
  assert.deepEqual(restored.exportState(), saved)
  assert.equal((await restored.history.search({ query: '', before_seq: null })).status, 'empty')
  assert.equal((await restored.history.search({ query: '', before_seq: null })).status, 'budget_exhausted')
  restored.restoreState(saved)
  allowed = false
  assert.equal((await restored.history.search({ query: '', before_seq: null })).status, 'denied')
  assert.equal(searches, 4)
  assert.throws(() => restoreWorkingContext(saved, { ...opts, projectId: 'other' }), /context_checkpoint_invalid/)
  assert.throws(() => restoreWorkingContext(saved, { ...opts, threadId: 'other' }), /context_checkpoint_invalid/)
  assert.throws(() => restoreWorkingContext(saved, { ...opts, message: 'Different turn.' }), /context_checkpoint_invalid/)
})

function orientation(): ProjectOrientation {
  const project = { id: 'project', name: 'Project', level: 'project' as const, status: null, phase: null, sourceId: 'project-source' }
  const presentation = { text: '', kind: 'original' as const, sourceIds: [], tokens: 0, maxTokens: 150 }
  return { projectId: 'project', project, overview: presentation, focus: { origin: 'project', card: project, description: presentation },
    ancestors: [], siblings: [], children: [], completionRequirements: [{ sourceId: 'plan-source', record: { id: 'requirement',
      description: '🪵 Exact unconfirmed measurement and saved completion criterion. '.repeat(1200) } }],
    workingPlan: { status: 'approved', revision: 3, pendingProposal: null }, recentSharedFacts: [],
    completeness: { areas: true, plan: true, hierarchy: true, requirements: true },
    sources: [{ id: 'project-source', projectId: 'project', dataset: 'project', recordId: 'project' },
      { id: 'plan-source', projectId: 'project', dataset: 'plan', recordId: '3', revision: 3, itemId: 'requirement' }],
    warnings: [], footer: presentation }
}

test('orientation restores deferred exact records and fragment cursors with fresh access checks', async () => {
  let allowed = true
  const bound = await boundProjectOrientation(orientation(), { maxTokens: 2048, pageMaxTokens: 2048, hasAccess: async () => true })
  const firstArgs = { section: 'completionRequirements', snapshot_id: bound.orientation.directory!.snapshotId, after_cursor: null }
  const first = await bound.reader.execute(firstArgs) as any
  assert.equal(first.status, 'partial_record')
  const nextArgs = { ...firstArgs, after_cursor: first.next_cursor }
  const saved = disk(bound.reader.exportState())
  const restored = restoreOrientationDirectory(saved, { projectId: 'project', hasAccess: async () => allowed })
  assert.deepEqual(restored.orientation, bound.orientation)
  assert.deepEqual(restored.reader.exportState(), saved)
  assert.deepEqual(await restored.reader.execute(nextArgs), await bound.reader.execute(nextArgs))
  saved.snapshot.completionRequirements[0].record.description = 'External mutation'
  assert.deepEqual(await restored.reader.execute(firstArgs), first)
  allowed = false
  await assert.rejects(restored.reader.execute(nextArgs), /project_denied/)
  assert.throws(() => restoreOrientationDirectory(saved, { projectId: 'other', hasAccess: async () => true }), /context_checkpoint_invalid/)
})

test('delivery metrics restore cumulative observations and the original start time without writing events', async () => {
  const events: ExecutionEvent[] = []
  const options = { runId: 'run', turnId: 'turn', startedAt: 100, now: () => 1000, write: async (event: ExecutionEvent) => { events.push(event) } }
  const original = createExecutionMetrics(options)
  original.observe({ steps: 40, tool_calls: 39, deferred_calls: 0, completion_checks: 2, nudges: 1, end: 'answered', output_phase: 'final_answer' })
  const saved = disk(original.exportState())
  const restored = createExecutionMetrics({ ...options, startedAt: 900 })
  restored.restoreState(saved)
  assert.equal(events.length, 0)
  assert.deepEqual(restored.exportState(), saved)
  await restored.finish({ ok: true, writes: 3 })
  assert.equal(events[0].duration_ms, 900)
  assert.equal(events[0].counts.steps, 40)
  assert.equal(events[0].counts.tool_calls, 39)
  assert.throws(() => restored.restoreState({ ...saved, turnId: 'different' }), /metrics_checkpoint_invalid/)
  assert.deepEqual(restored.exportState(), saved)
})

test('a finished specialist chain leaves no pixels in checkpoint state; Bob keeps his resumable head', async () => {
  const pixels = 'data:image/png;base64,' + 'A'.repeat(200_000)
  const reviewer: OpenAIServiceOptions = { ...request, aiFunction: 'cad-reviewer', functionName: 'cad-reviewer', catalogRoleKey: 'cad-reviewer', tools: undefined,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Review this candidate.' }, { type: 'image_url', image_url: { url: pixels, detail: 'high' } }] }] }
  let n = 0
  const replies: OpenAIServiceResponse[] = []
  const continuation = createBobContextContinuation({ version: 1, aiCatalog: catalog(), callModel: async () => replies[n++] })
  // A specialist mid-loop (tool calls pending) must stay resumable.
  replies.push(result('s1'), { ...result('s2', []), toolCalls: undefined, outputPhase: 'final' } as OpenAIServiceResponse)
  await continuation.call(reviewer)
  assert.deepEqual(disk(continuation.exportState()).chains.map(([id]) => id), ['s1'])
  await continuation.call({ ...reviewer, previousResponseId: 's1', messages: [output('s1')] })
  assert.deepEqual(disk(continuation.exportState()).chains, [])
  assert.ok(JSON.stringify(continuation.exportState()).length < 1000)
  // Bob's final message can still be nudged or completion-checked.
  replies.push({ ...result('b1', []), toolCalls: undefined, outputPhase: 'final' } as OpenAIServiceResponse)
  await continuation.call(request)
  assert.deepEqual(disk(continuation.exportState()).chains.map(([id]) => id), ['b1'])
})
