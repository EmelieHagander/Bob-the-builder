import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareWorkingContext, type ContextFrame } from '../supabase/functions/_shared/bob-working-context.ts'
import { checkedBrief, readStoredBrief, BRIEF_LIMITS } from '../supabase/functions/_shared/bob-conversation-brief.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import type { ModelCall } from '../supabase/functions/_shared/project-answer.ts'

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const response = (data: unknown) => ({ success: true, data: data as any, responseId: 'memory-response', model: 'fixture', usage })
const repaired = { gist: 'The user changed the access opening to the room-facing edge. Exact older dimensions remain retrievable.', index: [{ seq: 23, descriptor: 'User correction' }, { seq: 24, descriptor: 'Assistant working interpretation' }] }
function fixture() {
  const previous = { gist: 'Earlier working notes. '.repeat(420), index: Array.from({ length: 20 }, (_, i) => ({ seq: i + 3, descriptor: `Earlier topic ${i + 3}` })) }
  const initial: ContextFrame = { projectId: 'A', threadId: 'thread', generation: 2, summary: JSON.stringify(previous), lastFoldedSeq: 22, foldThroughSeq: 24, hasMore: false,
    older: [{ seq: 23, role: 'user', text: 'Move the opening to the room-facing edge.', state: 'completed' }, { seq: 24, role: 'assistant', text: 'Working interpretation; not a verified save.', state: 'completed' }],
    recent: [25, 26, 27, 28, 29].map(seq => ({ seq, role: seq % 2 ? 'user' : 'assistant', text: seq === 29 ? 'Compare both reference images.' : `Original message ${seq}\n  Preserve spacing.`, state: seq === 29 ? 'pending' : 'completed' })),
  }
  let state = structuredClone(initial), saves = 0
  const opts = { projectId: 'A', threadId: 'thread', userId: 'user', generation: 2, message: initial.recent.at(-1)!.text, deadline: Date.now() + 100000, hasAccess: async () => true,
    store: { load: async () => structuredClone(state), search: async () => ({}), save: async (expected: number, through: number, summary: string) => {
      assert.equal(expected, state.lastFoldedSeq); assert.equal(through, state.foldThroughSeq)
      saves++; state = { ...state, summary, lastFoldedSeq: through, older: [] }; return { lastFoldedSeq: through }
    } },
  }
  return { opts, initial, previous, get saves() { return saves }, get state() { return state } }
}

test('an oversized fold repairs within the same request and keeps the exact recent messages', async () => {
  const f = fixture(); let calls = 0
  const context = await prepareWorkingContext({ ...f.opts, callModel: async options => {
    calls++
    const input = JSON.parse(String(options.messages![0].content))
    assert.deepEqual(input.previousBrief, f.previous); assert.deepEqual(input.olderMessages, f.initial.older)
    assert.equal(options.previousResponseId, undefined); assert.equal(options.tools, undefined)
    if (calls === 1) return response({ ...repaired, gist: 'x'.repeat(12386) })
    assert.equal(input.validationFeedback.reason, 'size')
    assert.deepEqual(input.validationFeedback.requiredSequences, [23, 24])
    return response(repaired)
  } })
  assert.equal(calls, 2); assert.equal(f.saves, 1); assert.equal(context.summary, repaired.gist)
  assert.deepEqual(context.recent, f.initial.recent); assert.equal(context.throughSeq, 24)
})

test('a missing sequence is repaired rather than advancing the history watermark with a gap', async () => {
  const f = fixture(); let calls = 0
  await prepareWorkingContext({ ...f.opts, callModel: async options => {
    if (++calls === 1) return response({ ...repaired, index: [repaired.index[1]] })
    assert.equal(JSON.parse(String(options.messages![0].content)).validationFeedback.reason, 'coverage')
    return response(repaired)
  } })
  assert.equal(calls, 2); assert.equal(f.saves, 1)
})

test('two rejected folds stop with the prior memory and transcript intact', async () => {
  const f = fixture(); let calls = 0
  await assert.rejects(prepareWorkingContext({ ...f.opts, callModel: async () => { calls++; return response({ ...repaired, gist: 'x'.repeat(12386) }) } }), /context_unavailable/)
  assert.equal(calls, 2); assert.equal(f.saves, 0); assert.deepEqual(f.state, f.initial)
})

test('legacy valid briefs above the new generation budget remain readable and can be recompressed', () => {
  const f = fixture()
  assert(f.previous.gist.length > BRIEF_LIMITS.gist)
  assert.deepEqual(readStoredBrief(f.initial.summary, 22), f.previous)
  assert.throws(() => checkedBrief(f.previous, 22, BRIEF_LIMITS.gist), /context_unavailable/)
})

test('a repair does not extend the preparation deadline or save an invalid fold', async () => {
  const f = fixture(); let calls = 0
  const opts = { ...f.opts, callModel: async () => { calls++; opts.deadline = Date.now(); return response({ ...repaired, gist: 'x'.repeat(12386) }) } }
  await assert.rejects(prepareWorkingContext(opts), /context_preparing/)
  assert.equal(calls, 1); assert.equal(f.saves, 0)
})

test('worker continuation replays the rejected fold and performs only the unpaid repair', async () => {
  const f = fixture(), entries: JournalEntry[] = []; let now = 0, calls = 0
  const model: ModelCall = async () => ++calls === 1 ? response({ ...repaired, gist: 'x'.repeat(12386) }) : response(repaired)
  const run = () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, 20000, () => now)
    return prepareWorkingContext({ ...f.opts, callModel: options => journal.run('model:context-summary', options, async () => {
      const result = await model(options); now = 15000; return result
    }, 10000) })
  }
  await assert.rejects(run(), error => error instanceof BobContinuation && error.kind === 'yield')
  assert.equal(calls, 1); assert.equal(f.saves, 0)
  now = 0
  assert.equal((await run()).summary, repaired.gist)
  assert.equal(calls, 2); assert.equal(f.saves, 1)
})
