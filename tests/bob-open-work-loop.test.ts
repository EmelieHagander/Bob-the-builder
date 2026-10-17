import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { prepareWorkingContext, type ContextFrame, type WorkingContext } from '../supabase/functions/_shared/bob-working-context.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const response = (data: string | null, toolCalls?: any[], phase: 'final_answer' | 'refusal' = 'final_answer') => ({ success: true, data, model: 'fixture', responseId: 'response', usage, outputPhase: phase, toolCalls })
const tool = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const search = (id: string) => tool(id, 'search_project_data', { dataset: 'tasks', query: id, status: null, area_id: null, record_id: null, after_id: null })
const payload = (dataset: string) => ({ data: { records: dataset === 'project' ? [{ id: 'A', name: 'Fixture' }] : [], related: [], truncated: false }, error: null })
const catalog = () => catalogFixture(snapshot => {
  const contract = snapshot.definitions.find(row => row.prompt_key === 'agent-contract.ask-bob')!
  contract.metadata.work_allowance_version = 1
  contract.metadata.work_completion_version = 2
})
const base = () => ({ aiCatalog: catalog(), unlimitedWork: true, projectId: 'A', userId: 'u', message: 'Continue the delegated planning work.', hasAccess: async () => true,
  lookup: createProjectLookup('A', async (_project, input) => payload(input.dataset), 1000, 1000), deadline: Infinity })

test('productive work continues beyond 24 rounds and executes the whole tool batch without a quota envelope', async () => {
  let calls = 0
  const observations: any[] = []
  const result = await runProjectAnswer({ ...base(), observe: value => observations.push(value), callModel: async options => {
    calls++
    assert.equal(options.responsePhaseMode, 'aware')
    assert(options.tools?.length, 'the tool bench remains available beyond the old final round')
    assert(Number.isFinite(options.timeoutMs), 'an individual provider call still has a technical timeout')
    if (calls === 1) {
      assert.doesNotMatch(String(options.messages![0].content), /Execution limits for this turn/)
      return response(null, Array.from({ length: 10 }, (_, index) => search(`batch-${index}`)))
    }
    if (calls === 2) assert.equal(options.messages!.length, 10)
    for (const message of options.messages!) {
      const result = JSON.parse(String(message.content))
      assert.notEqual(result.status, 'deferred')
      assert.equal(Object.hasOwn(result, 'execution_budget'), false)
    }
    return calls <= 26 ? response(null, [search(`round-${calls}`)]) : response('The delegated research is complete.')
  } })
  assert(result.ok); assert.equal(calls, 27)
  assert.equal(observations.at(-1).tool_calls, 35)
  assert.equal(observations.at(-1).deferred_calls, 0)
  assert.equal(observations.at(-1).end, 'answered')
})

test('a new catalog alone does not uncap a synchronous or legacy job', async () => {
  let calls = 0
  const result = await runProjectAnswer({ ...base(), unlimitedWork: false, callModel: async options => {
    if (++calls === 1) return response(null, Array.from({ length: 9 }, (_, index) => search(`sync-${index}`)))
    const results = options.messages!.map(message => JSON.parse(String(message.content)))
    assert.equal(results.at(-1).status, 'deferred')
    assert.equal(results[0].execution_budget.model_steps, 23)
    return response('The synchronous reply is complete.')
  } })
  assert(result.ok); assert.equal(calls, 2)
})

test('a read-only promise receives one review in the existing memory chain and finishes the authorized write', async () => {
  const message = 'Fortsätt.'
  const context: WorkingContext = {
    summary: 'The owner delegated the planning instructions and a drawing brief, using a working width rather than a site measurement.', throughSeq: 4,
    historyIndex: [{ seq: 1, descriptor: 'Delegated planning outcome' }],
    recent: [{ seq: 5, role: 'user', text: 'Change the working width to 174 cm; keep the site measurement unverified.', state: 'completed' },
      { seq: 6, role: 'assistant', text: 'The next authorized action is the drawing brief.', state: 'completed' },
      { seq: 7, role: 'user', text: message, state: 'pending' }],
    history: { remaining: Infinity, search: async () => ({ status: 'empty' }) },
  }
  let calls = 0, writes = 0
  const observations: any[] = []
  const writer = createProjectWriter('A', message, async input => {
    writes++
    assert.equal(input.data.instructions, 'Working width 174 cm. Confirm the physical width on site.')
    return { data: { projectId: 'A', dataset: 'tasks', recordId: 'drawing', label: 'Drawing brief', operation: 'created', savedAt: '2026-10-17T12:00:00Z', record: { id: 'drawing' } }, error: null }
  }, async () => ({ data: [], error: null }))
  const result = await runProjectAnswer({ ...base(), message, context, writer, observe: value => observations.push(value), callModel: async options => {
    calls++
    if (calls === 1) {
      assert.match(String(options.messages![0].content), /delegated the planning instructions and a drawing brief/)
      assert.deepEqual(options.messages!.slice(-3).map(row => row.content), context.recent.map(row => row.text))
      assert(options.tools?.some(entry => entry.function.name === 'search_conversation_history'))
      return { ...response('Next I can prepare the drawing brief.'), responseId: 'candidate-final' }
    }
    if (calls === 2) {
      assert.equal(options.previousResponseId, 'candidate-final', 'the review retains the original memory and latest correction')
      assert.match(String(options.messages![0].content), /Fortsätt\./)
      assert.match(String(options.messages![0].content), /"writes":\[\]/)
      return response(null, [tool('save', 'save_project_task', { record_id: null, area_id: 'area', step_id: null, name: 'Drawing brief', instructions: 'Working width 174 cm. Confirm the physical width on site.', expected_updated_at: null })])
    }
    assert.equal(JSON.parse(String(options.messages![0].content)).status, 'saved')
    return response('The drawing brief is saved. The physical width still needs measuring.')
  } })
  assert(result.ok); assert.equal(writes, 1); assert.equal(calls, 3)
  assert.equal(observations.at(-1).completion_checks, 1)
})

test('v2 preserves a real refusal and revoked authority without another model call', async () => {
  for (const stop of ['refusal', 'revoked'] as const) {
    let calls = 0, access = true
    const writer = createProjectWriter('A', 'Continue.', async () => { throw Error('No write is authorized here') }, async () => ({ data: [], error: null }))
    const result = await runProjectAnswer({ ...base(), message: 'Continue.', writer, hasAccess: async () => access, callModel: async () => {
      calls++
      if (stop === 'revoked') access = false
      return response('I cannot perform this action.', undefined, stop === 'refusal' ? 'refusal' : 'final_answer')
    } })
    assert.equal(calls, 1)
    if (stop === 'refusal') { assert(result.ok); assert.equal(result.evidence.partial, true) }
    else assert.deepEqual(result, { ok: false, error: 'project_denied' })
  }
})

test('three identical rejected tool calls stop while thirteen different corrections remain available', async () => {
  for (const repeated of [true, false]) {
    let calls = 0
    const writer = createProjectWriter('A', 'Continue.', async () => { throw Error('Invalid calls cannot reach the database') }, async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }), { unlimitedWork: true })
    const result = await runProjectAnswer({ ...base(), message: 'Continue.', writer, callModel: async options => {
      if (calls > 0 && calls <= 13) assert.equal(JSON.parse(String(options.messages![0].content)).status, 'invalid')
      if (++calls <= 13) return response(null, [tool('edit-' + calls, 'save_project_task', {
        record_id: 'task', area_id: 'area', step_id: null, name: repeated ? 'Unchanged task' : `Corrected task ${calls}`,
        instructions: 'Planning instructions.', expected_updated_at: null,
      })])
      return response('The requested update still needs a fresh record version.')
    } })
    if (repeated) { assert.deepEqual(result, { ok: false, error: 'tool_no_progress' }); assert.equal(calls, 3) }
    else { assert(result.ok); assert.equal(calls, 15, 'thirteen different rejections, candidate answer, one completion review') }
  }
})

test('a technical yield within a tool batch replays completed calls and resumes the same response', async () => {
  const entries: JournalEntry[] = []
  const readIds: string[] = []
  let modelCalls = 0, yielded = false
  const segment = () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, Date.now() + 100000)
    const lookup = createProjectLookup('A', (_project, input) => journal.run('read', input, async () => {
      if (input.query === 'batch-4' && !yielded) { yielded = true; throw new BobContinuation('yield') }
      if (input.query) readIds.push(input.query)
      return payload(input.dataset)
    }), 1000, 1000)
    return runProjectAnswer({ ...base(), lookup, callModel: options => journal.run('model', options, async () => {
      if (++modelCalls === 1) return response(null, Array.from({ length: 10 }, (_, index) => search(`batch-${index}`)))
      assert.equal(options.previousResponseId, 'response')
      assert.equal(options.messages!.length, 10)
      return response('All ten reads completed.')
    }) })
  }
  await assert.rejects(segment, BobContinuation)
  assert.deepEqual(readIds, ['batch-0', 'batch-1', 'batch-2', 'batch-3'])
  const result = await segment()
  assert(result.ok); assert.equal(modelCalls, 2)
  assert.deepEqual(readIds, Array.from({ length: 10 }, (_, index) => `batch-${index}`))
})

function memoryFixture(unlimitedWork: boolean) {
  const message = 'Stop the old drawing and finish only the corrected planning notes.'
  const recent: ContextFrame['recent'] = [{ seq: 100, role: 'user', text: message, state: 'pending' }]
  let folded = 0, summary = '', searches = 0
  const older = (seq: number): ContextFrame['older'] => [{ seq, role: seq % 2 ? 'user' : 'assistant', text: `Original message ${seq}`, state: 'completed' }]
  return {
    get folded() { return folded }, get searches() { return searches }, recent,
    opts: { projectId: 'A', userId: 'u', threadId: 'thread', generation: 1, message, unlimitedWork, deadline: Infinity, hasAccess: async () => true,
      store: {
        load: async (): Promise<ContextFrame> => ({ projectId: 'A', threadId: 'thread', generation: 1, summary, lastFoldedSeq: folded, foldThroughSeq: Math.min(6, folded + 1), recent, older: folded < 6 ? older(folded + 1) : [], hasMore: folded < 5 }),
        save: async (expected: number, through: number, next: string) => { assert.equal(expected, folded); folded = through; summary = next; return { lastFoldedSeq: folded } },
        search: async () => { searches++; return { projectId: 'A', threadId: 'thread', messages: older(1), truncated: false, nextBeforeSeq: null } },
      },
      callModel: async (options: any) => {
        assert(Number.isFinite(options.timeoutMs))
        const input = JSON.parse(String(options.messages[0].content))
        return { ...response(null), data: { gist: 'Remember the delegated planning outcome, corrections and open site checks.', index: [...input.previousBrief.index, ...input.olderMessages.map((row: any) => ({ seq: row.seq, descriptor: 'Exact original message' }))] } as any }
      },
    },
  }
}

test('memory can fold and search beyond the old quotas without changing the current instruction or exact-history boundary', async () => {
  const fixture = memoryFixture(true)
  const context = await prepareWorkingContext(fixture.opts)
  assert.equal(fixture.folded, 6); assert.deepEqual(context.recent, fixture.recent)
  assert.equal(context.history.remaining, Infinity)
  for (let search = 0; search < 7; search++) assert.equal((await context.history.search({ query: 'Original', before_seq: null })).status, 'ok')
  assert.equal(fixture.searches, 7)
  assert.equal((await context.history.search({ query: '', before_seq: null, projectId: 'foreign' })).status, 'invalid')
  assert.equal(fixture.searches, 7)
})

test('legacy memory still stops after four folds', async () => {
  const fixture = memoryFixture(false)
  await assert.rejects(prepareWorkingContext(fixture.opts), /context_preparing/)
  assert.equal(fixture.folded, 4)
})
