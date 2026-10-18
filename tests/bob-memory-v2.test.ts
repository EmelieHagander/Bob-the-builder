import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareWorkingContext, type ContextFrame, type ContextStore } from '../supabase/functions/_shared/bob-working-context.ts'
import { BRIEF_TOKEN_POLICY, manageConversationBriefV2, type ConversationBrief } from '../supabase/functions/_shared/bob-conversation-brief.ts'
import { countContextTokens, countSerializedTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'

const result = (data: unknown) => ({ success: true, data: data as any, model: 'fixture', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } })
const correction: ConversationBrief = {
  gist: 'Beställaren önskar nu 80 cm bredd, vilket ersätter förslaget 90 cm. Bredden är ännu inte uppmätt. Måttkontrollen återstår.',
  index: [{ seq: 3, descriptor: 'Rättat önskemål, inte ett uppmätt mått.' }],
}
function fixture() {
  const transcript = Array.from({ length: 9 }, (_, i) => ({ seq: i + 1, role: i % 2 ? 'assistant' as const : 'user' as const,
    text: i === 0 ? 'Vi kanske kan göra sängen 90 cm bred, jag måste mäta först.'
      : i === 2 ? 'Rättelse: jag önskar 80 cm bredd. Jag har fortfarande inte mätt.' : `Original ${i + 1}\n  bevara mellanrum.`,
    state: i === 8 ? 'pending' as const : 'completed' as const }))
  const previous: ConversationBrief = { gist: '90 cm är föreslaget, inte uppmätt. [seq 1]', index: [{ seq: 1, descriptor: 'Tidigt breddförslag.' }] }
  let state: ContextFrame = { projectId: 'A', threadId: 'private', generation: 1, summary: JSON.stringify(previous),
    lastFoldedSeq: 2, foldThroughSeq: 4, older: transcript.slice(2, 4), recent: transcript.slice(4), hasMore: false }
  let saves = 0, refreshes = 0
  const store: ContextStore = {
    load: async () => structuredClone(state),
    save: async (expected, through, summary) => {
      assert.equal(expected, state.lastFoldedSeq); assert.equal(through, state.foldThroughSeq)
      saves++; state = { ...state, summary, lastFoldedSeq: through, older: [] }
      return { lastFoldedSeq: through }
    },
    refresh: async (expected, previousSummary, summary) => {
      assert.equal(expected, state.lastFoldedSeq); assert.equal(previousSummary, state.summary)
      assert.equal(state.older.length, 0)
      refreshes++; state = { ...state, summary }; return { lastFoldedSeq: expected }
    },
    search: async (query, before) => ({ projectId: 'A', threadId: 'private',
      messages: transcript.filter(message => message.text.includes(query) && message.seq < (before ?? Infinity)).slice(0, 5),
      truncated: false, nextBeforeSeq: null }),
  }
  const opts = { projectId: 'A', threadId: 'private', userId: 'owner', generation: 1, message: transcript.at(-1)!.text,
    memoryManagementVersion: 2 as const, unlimitedWork: true, store, deadline: Date.now() + 100000, hasAccess: async () => true }
  return { opts, store, transcript, previous, get state() { return state }, set state(value: ContextFrame) { state = value },
    get saves() { return saves }, get refreshes() { return refreshes } }
}

test('v2 replaces obsolete active hints, keeps correction provenance and leaves every original available', async () => {
  const f = fixture(), originals = structuredClone(f.transcript)
  const prepared = await prepareWorkingContext({ ...f.opts, callModel: async options => {
    assert.equal(options.catalogSchemaKey, 'bob_conversation_brief_v2')
    const input = JSON.parse(String(options.messages![0].content))
    assert.deepEqual(input.previousBrief, f.previous)
    assert.deepEqual(input.memoryPolicy, BRIEF_TOKEN_POLICY)
    assert.equal(input.throughSeq, 2); assert.equal(input.foldThroughSeq, 4)
    assert.deepEqual(input.olderMessages.map((message: { seq: number }) => message.seq), [3, 4])
    assert.equal(input.currentRequest.seq, 9)
    return result(correction)
  } })
  assert.equal(prepared.memoryManagementVersion, 2)
  assert.equal(prepared.summary, correction.gist)
  assert.deepEqual(prepared.historyIndex, correction.index)
  assert.equal(prepared.throughSeq, 4, 'coverage advances across both input messages even when only one hint remains')
  assert.deepEqual(prepared.recent, originals.slice(-5))
  assert.deepEqual(f.transcript, originals)
  const old = await prepared.history.search({ query: '90 cm', before_seq: null })
  assert.equal(old.status, 'ok')
  assert.deepEqual((old.messages as any[]).map(message => message.text), [originals[0].text])
})

test('o200k counting handles multilingual and special-token-looking user data without a character heuristic', () => {
  assert.equal(countContextTokens('hello world'), 2)
  assert.equal(countContextTokens('こんにちは世界'), 2)
  assert.equal(countContextTokens('<|endoftext|>'), 7, 'literal text is not a control token')
  const multilingual = { gist: '🪵'.repeat(600), index: [] }
  assert(multilingual.gist.length < 6000)
  assert(countSerializedTokens(multilingual) > 1600)
  assert.throws(() => manageConversationBriefV2(multilingual, correction, [], 4), /context_unavailable/)
  const repetitive = { gist: 'A'.repeat(6000), index: [] }
  assert(countSerializedTokens(repetitive) < 1600)
  assert.equal(manageConversationBriefV2(repetitive, correction, [], 4).gist, repetitive.gist)
})

test('the token bound includes the whole index, and overflow is repaired without slicing meaning or references', async () => {
  const f = fixture(), before = f.state.summary
  const tooLong = { gist: '測定した値ではありません。'.repeat(200), index: [{ seq: 1, descriptor: '🪵'.repeat(100) }] }
  assert(countContextTokens(tooLong.gist) < 1600)
  assert(countSerializedTokens(tooLong) > 1600)
  let attempts = 0
  const prepared = await prepareWorkingContext({ ...f.opts, callModel: async options => {
    assert.equal(f.state.summary, before)
    const input = JSON.parse(String(options.messages![0].content))
    if (++attempts === 1) return result(tooLong)
    assert.equal(input.validationFeedback.reason, 'size')
    assert.equal(input.validationFeedback.memoryPolicy.maxTokens, 1600)
    assert.equal(input.validationFeedback.requiredSequences, undefined)
    return result(correction)
  } })
  assert.equal(attempts, 2); assert.equal(f.saves, 1)
  assert.equal(prepared.summary, correction.gist)
  assert(countSerializedTokens(JSON.parse(f.state.summary)) <= 1600)
})

test('failed v2 compaction preserves its prior summary and cursor; a new attempt can recover', async () => {
  const f = fixture(), before = structuredClone(f.state)
  let calls = 0
  await assert.rejects(prepareWorkingContext({ ...f.opts, callModel: async () => {
    calls++; return result({ gist: '🪵'.repeat(600), index: [] })
  } }), /context_unavailable/)
  assert.equal(calls, 2); assert.equal(f.saves, 0); assert.deepEqual(f.state, before)
  const ready = await prepareWorkingContext({ ...f.opts, callModel: async () => result(correction) })
  assert.equal(ready.throughSeq, 4); assert.equal(f.saves, 1)
})

test('same-cursor refresh compacts a prior oversized brief even with no newly foldable messages', async () => {
  const f = fixture()
  f.state = { ...f.state, lastFoldedSeq: 4, older: [], summary: JSON.stringify({ gist: '🪵'.repeat(600), index: correction.index }) }
  const ready = await prepareWorkingContext({ ...f.opts, callModel: async options => {
    const input = JSON.parse(String(options.messages![0].content))
    assert.deepEqual(input.olderMessages, []); assert.equal(input.throughSeq, input.foldThroughSeq)
    return result(correction)
  } })
  assert.equal(f.saves, 0); assert.equal(f.refreshes, 1); assert.equal(ready.throughSeq, 4)
  assert.equal(ready.summary, correction.gist)
  assert.deepEqual(ready.recent, f.transcript.slice(-5))
})

test('v2 rejects gaps, future pointers and pointer provenance missing from the supplied sources', async () => {
  for (const seq of [2, 5]) {
    const f = fixture()
    await assert.rejects(prepareWorkingContext({ ...f.opts, callModel: async () => result({ gist: 'Candidate', index: [{ seq, descriptor: 'Unknown source' }] }) }), /context_unavailable/)
    assert.equal(f.saves, 0)
  }
  const f = fixture()
  f.state = { ...f.state, older: f.state.older.slice(1) }
  await assert.rejects(prepareWorkingContext({ ...f.opts, callModel: async () => { throw new Error('Must reject before model') } }), /context_unavailable/)
  assert.equal(f.saves, 0)
})

test('an initial empty memory and an older retried current request preserve the exact recent-message contract', async () => {
  const first = fixture()
  first.state = { ...first.state, summary: '', lastFoldedSeq: 0, foldThroughSeq: 0, older: [],
    recent: [{ ...first.transcript[0], state: 'pending' }] }
  const initial = await prepareWorkingContext({ ...first.opts, message: first.transcript[0].text,
    callModel: async () => { throw new Error('Nothing needs folding') } })
  assert.equal(initial.summary, ''); assert.equal(initial.recent.length, 1)

  const retried = fixture()
  retried.state = { ...retried.state, summary: '', lastFoldedSeq: 0,
    older: retried.transcript.slice(1, 4), recent: [...retried.transcript.slice(4, 8), { ...retried.transcript[0], state: 'pending' }] }
  const resumed = await prepareWorkingContext({ ...retried.opts, message: retried.transcript[0].text, callModel: async options => {
    const input = JSON.parse(String(options.messages![0].content))
    assert.deepEqual(input.olderMessages.map((message: { seq: number }) => message.seq), [2, 3, 4])
    assert.equal(input.currentRequest.seq, 1)
    return result(correction)
  } })
  assert.deepEqual(resumed.recent.map(message => message.seq), [5, 6, 7, 8, 1])
  assert.equal(resumed.throughSeq, 4)
})

test('v1 retains its original payload and deterministic new-message pointers after v2 introduction', async () => {
  const f = fixture()
  const ready = await prepareWorkingContext({ ...f.opts, memoryManagementVersion: 1, callModel: async options => {
    assert.equal(options.catalogSchemaKey, 'bob_conversation_brief')
    assert.deepEqual(Object.keys(JSON.parse(String(options.messages![0].content))), ['previousBrief', 'throughSeq', 'olderMessages'])
    return result({ gist: correction.gist, index: [] })
  } })
  assert.deepEqual(ready.historyIndex?.map(entry => entry.seq), [3, 4])
  assert.equal(ready.memoryManagementVersion, undefined)
})

test('v2 resumes a paid memory fold without another model call or duplicate save', async () => {
  const f = fixture(), entries: JournalEntry[] = []
  let now = 0, calls = 0
  const run = () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, 20000, () => now, new Map(), { unlimitedWork: true })
    return prepareWorkingContext({ ...f.opts, store: {
      ...f.store,
      load: () => journal.run('context:load', {}, f.store.load),
      save: (expected, through, summary) => journal.run('context:save', { expected, through, summary }, () => f.store.save(expected, through, summary)),
    }, callModel: options => journal.run('model:context-summary', options, async () => { calls++; now = 15000; return result(correction) }, 10000) })
  }
  await assert.rejects(run(), error => error instanceof BobContinuation && error.kind === 'yield')
  assert.equal(calls, 1); assert.equal(f.saves, 0)
  now = 0
  const ready = await run()
  assert.equal(calls, 1); assert.equal(f.saves, 1); assert.equal(ready.summary, correction.gist)
})

test('v2 delegates exact reads and query-specific retrieval without making either persistent relevance', async () => {
  const f = fixture()
  let indexed = 0
  const requests: unknown[] = []
  const ready = await prepareWorkingContext({ ...f.opts, callModel: async () => result(correction), retrieval: {
    index: async () => { indexed++ },
    read: async value => { requests.push(value); return { status: 'ok', message: f.transcript[0] } },
    search: async value => { requests.push(value); return { status: 'ok', messages: [f.transcript[2]] } },
  } })
  assert.equal(indexed, 1)
  assert.equal((await ready.history.read!({ seq: 1, offset: null })).status, 'ok')
  assert.equal((await ready.history.search({ query: 'önskad bredd', before_seq: null })).status, 'ok')
  assert.deepEqual(requests, [{ seq: 1, offset: null }, { query: 'önskad bredd', before_seq: null }])
  assert.deepEqual(Object.keys(JSON.parse(f.state.summary)), ['gist', 'index'])
})
