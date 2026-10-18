import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prepareWorkingContext, type ContextFrame, type ContextMessage, type ContextStore } from './support/colleague-catalog-fixture.ts'
import { runProjectAnswer } from './support/bob-model-routing.ts'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { BRIEF_LIMITS, type ConversationBrief } from '../supabase/functions/_shared/bob-conversation-brief.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const response = (data: unknown) => ({ success: true, data: data as any, responseId: 'managed-memory-fixture', model: 'fixture', usage })
const hint = (seq: number) => ({ seq, descriptor: `Earlier topic ${seq}` })
const message = (seq: number, latest: number): ContextMessage => ({
  seq, role: seq === latest || seq % 2 ? 'user' : 'assistant',
  text: `Exact original ${seq}\n  Återanvänd 70 × 160 cm; preserve spacing.`, state: seq === latest ? 'pending' : 'completed',
})
const compactGist = 'The owner wants the same drawing completed. Older statements are conversation history, not verified project state.'

/** Reproduces the production boundary: 39 stored hints, two newly older
 * messages, and exactly five current messages. The transcript is independent
 * of the compact brief and is never rewritten by a memory save. */
function fixture(lastFolded = 39, newMessages = 2, previousHints = 39) {
  const latest = lastFolded + newMessages + 5
  const previous: ConversationBrief = { gist: compactGist, index: Array.from({ length: Math.min(lastFolded, previousHints) }, (_, i) => hint(i + 1)) }
  const transcript = Array.from({ length: latest }, (_, i) => message(i + 1, latest))
  const initial: ContextFrame = {
    projectId: 'A', threadId: 'managed-thread', generation: 2, summary: JSON.stringify(previous),
    lastFoldedSeq: lastFolded, foldThroughSeq: lastFolded + newMessages, hasMore: false,
    older: transcript.slice(lastFolded, -5), recent: transcript.slice(-5),
  }
  let state = structuredClone(initial), saves = 0
  const store: ContextStore = {
    load: async () => structuredClone(state),
    save: async (expected, through, summary) => {
      assert.equal(expected, state.lastFoldedSeq)
      assert.equal(through, state.foldThroughSeq)
      assert([...summary].length <= BRIEF_LIMITS.characters)
      saves++
      state = { ...state, summary, lastFoldedSeq: through, older: [] }
      return { lastFoldedSeq: through }
    },
    search: async (query, before) => {
      const matches = transcript.filter(m => m.seq < (before ?? Infinity) && m.text.includes(query)).toReversed()
      const messages = matches.slice(0, 5)
      return { projectId: 'A', threadId: 'managed-thread', messages, truncated: matches.length > messages.length, nextBeforeSeq: matches.length > messages.length ? messages.at(-1)!.seq : null }
    },
  }
  const opts = { projectId: 'A', threadId: 'managed-thread', userId: 'owner', generation: 2, message: initial.recent.at(-1)!.text,
    deadline: Date.now() + 100000, hasAccess: async () => true, memoryManagementVersion: 1 as const, store }
  return { opts, store, initial, previous, transcript, get saves() { return saves }, get state() { return state } }
}

test('managed memory crosses the actual 39 + 2 boundary in one fold and gives main Bob only the exact latest five', async () => {
  const f = fixture(), beforeTranscript = structuredClone(f.transcript)
  let folds = 0
  const prepared = await prepareWorkingContext({ ...f.opts, callModel: async options => {
    folds++
    assert.equal(options.previousResponseId, undefined)
    assert.equal(options.tools, undefined)
    const input = JSON.parse(String(options.messages![0].content))
    assert.deepEqual(input.previousBrief, f.previous)
    assert.deepEqual(input.olderMessages, f.initial.older)
    assert(!String(options.messages![0].content).includes(f.initial.recent[0].text))
    // This exact pointer result previously omitted 41 on both repair attempts.
    return response({ gist: compactGist, index: Array.from({ length: 40 }, (_, i) => hint(i + 1)) })
  } })
  assert.equal(folds, 1)
  assert.equal(f.saves, 1)
  assert.equal(prepared.throughSeq, 41)
  assert.deepEqual(prepared.recent, f.initial.recent)
  assert.equal(prepared.historyIndex?.length, 40)
  assert(prepared.historyIndex?.some(e => e.seq === 40))
  assert(prepared.historyIndex?.some(e => e.seq === 41))
  assert.deepEqual(f.transcript, beforeTranscript)

  let mainCalls = 0
  const answer = await runProjectAnswer({ projectId: 'A', userId: 'owner', message: f.opts.message,
    context: prepared, previousResponseId: 'DO_NOT_REPLAY_FULL_PROVIDER_HISTORY', hasAccess: async () => true,
    lookup: createProjectLookup('A', async () => ({ data: { records: [{ id: 'A', description: 'Current saved project truth' }], related: [], truncated: false }, error: null })),
    callModel: async options => {
      mainCalls++
      assert.equal(options.previousResponseId, undefined)
      assert.equal(options.messages?.length, 6)
      assert.deepEqual(options.messages!.slice(-5).map(m => m.content), f.initial.recent.map(m => m.text))
      const input = JSON.stringify(options.messages)
      for (const old of f.initial.older) assert(!input.includes(JSON.stringify(old.text).slice(1, -1)))
      assert(options.tools?.some(t => t.function.name === 'search_conversation_history'))
      return response('I will continue using the current saved construction.')
    },
  })
  assert(answer.ok)
  assert.equal(mainCalls, 1)
})

test('hundreds of older messages roll through bounded memory without growing main context or losing exact history', async () => {
  let summary = JSON.stringify({ gist: compactGist, index: Array.from({ length: 39 }, (_, i) => hint(i + 1)) })
  let maximumMemorySize = 0
  for (let through = 41; through <= 241; through += 2) {
    const f = fixture(through - 2)
    // The durable memory is carried forward; every turn adds only its new prefix.
    const originalLoad = f.store.load
    f.store.load = async () => {
      const loaded = await originalLoad() as ContextFrame
      return { ...loaded, summary: loaded.older.length ? summary : loaded.summary }
    }
    const prepared = await prepareWorkingContext({ ...f.opts, callModel: async options => {
      const input = JSON.parse(String(options.messages![0].content))
      assert.equal(input.olderMessages.length, 2)
      assert(input.previousBrief.index.length <= BRIEF_LIMITS.entries)
      return response({ gist: compactGist, index: [...input.previousBrief.index, hint(through - 1)].slice(-40) })
    } })
    assert.equal(prepared.throughSeq, through)
    assert.equal(prepared.recent.length, 5)
    assert(prepared.historyIndex!.length <= 40)
    assert(prepared.historyIndex!.some(e => e.seq === through))
    summary = f.state.summary
    maximumMemorySize = Math.max(maximumMemorySize, [...summary].length)
    if (through === 241) {
      assert(!prepared.historyIndex!.some(e => e.seq === 1))
      const found = await prepared.history.search({ query: 'Exact original 1\n', before_seq: null })
      assert.equal(found.status, 'ok')
      assert.deepEqual((found.messages as ContextMessage[]).map(m => m.seq), [1])
      assert.equal((found.messages as ContextMessage[])[0].text, f.transcript[0].text)
    }
  }
  assert(maximumMemorySize <= BRIEF_LIMITS.characters)
})

test('omitted navigation hints get source-backed pointers while optional old hints yield to the complete new batch', async () => {
  const f = fixture()
  let calls = 0
  const prepared = await prepareWorkingContext({ ...f.opts, callModel: async () => { calls++; return response({ gist: compactGist, index: [] }) } })
  assert.equal(calls, 1)
  assert.deepEqual(prepared.historyIndex!.map(e => e.seq), [40, 41])
  assert(prepared.historyIndex!.every(e => e.descriptor.length > 0 && e.descriptor.length <= BRIEF_LIMITS.descriptor))
  assert.equal(prepared.summary, compactGist)
  assert.equal((await prepared.history.search({ query: 'Exact original 1\n', before_seq: null })).status, 'ok')
})

test('serialized memory stays bounded when valid long descriptors fill the optional old-hint budget', async () => {
  const f = fixture()
  const prepared = await prepareWorkingContext({ ...f.opts, callModel: async () => response({
    gist: 'x'.repeat(BRIEF_LIMITS.gist),
    index: Array.from({ length: 40 }, (_, i) => ({ seq: i + 1, descriptor: 'A'.repeat(BRIEF_LIMITS.descriptor) })),
  }) })
  assert.equal([...prepared.summary].length, BRIEF_LIMITS.gist)
  assert([...f.state.summary].length <= BRIEF_LIMITS.characters)
  assert(prepared.historyIndex!.length < BRIEF_LIMITS.entries)
  assert(prepared.historyIndex!.some(e => e.seq === 40))
  assert(prepared.historyIndex!.some(e => e.seq === 41))
  assert(prepared.historyIndex!.filter(e => e.seq <= 40).every(e => e.descriptor === 'A'.repeat(BRIEF_LIMITS.descriptor)), 'evict whole optional hints rather than cutting their meaning')
})

test('a full stored index makes room for all sixteen newly folded sources without raising the forty-hint cap', async () => {
  const f = fixture(40, 16, 40)
  const prepared = await prepareWorkingContext({ ...f.opts, callModel: async options => {
    const input = JSON.parse(String(options.messages![0].content))
    assert.equal(input.previousBrief.index.length, 40)
    assert.equal(input.olderMessages.length, 16)
    return response({ gist: compactGist, index: f.previous.index })
  } })
  assert.equal(f.saves, 1)
  assert.equal(prepared.throughSeq, 56)
  assert.equal(prepared.historyIndex!.length, BRIEF_LIMITS.entries)
  assert.deepEqual(prepared.historyIndex!.filter(e => e.seq > 40).map(e => e.seq), Array.from({ length: 16 }, (_, i) => i + 41))
  assert.equal(prepared.historyIndex!.filter(e => e.seq <= 40).length, 24)
  assert.deepEqual(prepared.recent.map(m => m.seq), [57, 58, 59, 60, 61])
})

test('escaped JSON preserves the exact gist and every new source while optional hints and long descriptions yield', async () => {
  const f = fixture(40, 16, 40), gist = '"\\'.repeat(2400), descriptor = '"\\'.repeat(100)
  const prepared = await prepareWorkingContext({ ...f.opts, callModel: async () => response({
    gist, index: Array.from({ length: 40 }, (_, i) => ({ seq: i + 17, descriptor })),
  }) })
  assert.equal(f.saves, 1)
  assert.equal(prepared.summary, gist)
  assert.equal(JSON.parse(f.state.summary).gist, gist)
  assert([...f.state.summary].length <= BRIEF_LIMITS.characters)
  assert(prepared.historyIndex!.length <= BRIEF_LIMITS.entries)
  const required = prepared.historyIndex!.filter(e => e.seq > 40)
  assert.deepEqual(required.map(e => e.seq), Array.from({ length: 16 }, (_, i) => i + 41))
  assert(required.some(e => e.descriptor === descriptor), 'retain supplied descriptions that fit')
  assert(required.some(e => e.descriptor !== descriptor), 'use neutral source metadata when an escaped description cannot fit')
  for (const entry of required.filter(e => e.descriptor !== descriptor)) {
    const source = f.initial.older.find(m => m.seq === entry.seq)!
    assert(entry.descriptor.includes(String(source.seq)))
    assert(entry.descriptor.includes(source.role))
    assert(entry.descriptor.includes(source.state))
  }
  assert(prepared.historyIndex!.filter(e => e.seq <= 40).length < 24)
})

test('invented references and invalid gists never advance managed memory or alter the transcript', async t => {
  const cases = [
    { name: 'future pointer', value: { gist: compactGist, index: [hint(47)] } },
    { name: 'not in supplied sources', value: { gist: compactGist, index: [hint(39)] }, withoutPriorPointer: true },
    { name: 'duplicate pointer', value: { gist: compactGist, index: [hint(40), hint(40)] } },
    { name: 'overlong gist', value: { gist: 'x'.repeat(BRIEF_LIMITS.gist + 1), index: [hint(40)] } },
    { name: 'gist fits logical length but cannot fit escaped storage', value: { gist: '\\'.repeat(BRIEF_LIMITS.gist), index: [] } },
    { name: 'empty gist', value: { gist: ' ', index: [] } },
  ]
  for (const row of cases) await t.test(row.name, async () => {
    const f = fixture(), beforeTranscript = structuredClone(f.transcript)
    if (row.withoutPriorPointer) {
      const load = f.store.load
      f.store.load = async () => ({ ...await load() as ContextFrame, summary: JSON.stringify({ gist: compactGist, index: [] }) })
    }
    let calls = 0
    await assert.rejects(prepareWorkingContext({ ...f.opts, callModel: async () => { calls++; return response(row.value) } }), /context_unavailable/)
    assert.equal(calls, 2)
    assert.equal(f.saves, 0)
    assert.equal(f.state.lastFoldedSeq, 39)
    assert.deepEqual(f.transcript, beforeTranscript)
  })
})

test('old executions retain their original model payload and legacy coverage repair behavior', async () => {
  const f = fixture(), { memoryManagementVersion: _version, ...legacy } = f.opts
  let calls = 0
  await assert.rejects(prepareWorkingContext({ ...legacy, callModel: async options => {
    const input = JSON.parse(String(options.messages![0].content))
    if (++calls === 1) assert.deepEqual(Object.keys(input), ['previousBrief', 'throughSeq', 'olderMessages'])
    else assert.deepEqual(input.validationFeedback.requiredSequences, [40, 41])
    return response({ gist: compactGist, index: Array.from({ length: 40 }, (_, i) => hint(i + 1)) })
  } }), /context_unavailable/)
  assert.equal(calls, 2)
  assert.equal(f.saves, 0)
})

test('a yielded managed-memory fold replays its paid response and saves the same compact result once', async () => {
  const f = fixture(), entries: JournalEntry[] = []
  let now = 0, modelCalls = 0, identities = 0
  const run = async () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, 20000, () => now, new Map(), { unlimitedWork: true })
    const execution = await journal.run('execution:identity', {}, async () => { identities++; return { id: 'pinned-turn', memoryManagementVersion: 1 as const } })
    return prepareWorkingContext({ ...f.opts, memoryManagementVersion: execution.memoryManagementVersion,
      store: {
        load: () => journal.run('context:load', {}, f.store.load),
        save: (expected, through, summary) => journal.run('context:save', { expected, through, summary }, () => f.store.save(expected, through, summary)),
        search: (query, before) => journal.run('context:search', { query, before }, () => f.store.search(query, before)),
      },
      callModel: options => journal.run('model:context-summary', options, async () => {
        modelCalls++; now = 15000
        return response({ gist: compactGist, index: Array.from({ length: 40 }, (_, i) => hint(i + 1)) })
      }, 10000),
    })
  }
  await assert.rejects(run(), error => error instanceof BobContinuation && error.kind === 'yield')
  assert.equal(modelCalls, 1)
  assert.equal(f.saves, 0)
  assert.equal(identities, 1)
  assert.equal((entries.find(e => e.key === 'execution:identity:0')!.value as any).result.memoryManagementVersion, 1)
  now = 0
  const prepared = await run()
  assert.equal(modelCalls, 1)
  assert.equal(f.saves, 1)
  assert.equal(identities, 1)
  assert.equal(prepared.throughSeq, 41)
  assert(prepared.historyIndex!.some(e => e.seq === 41))
  assert.deepEqual(prepared.recent, f.initial.recent)
  const replayed = await run()
  assert.equal(modelCalls, 1)
  assert.equal(f.saves, 1)
  assert.equal(replayed.summary, prepared.summary)
  assert.deepEqual(replayed.historyIndex, prepared.historyIndex)
  assert.deepEqual(replayed.recent, prepared.recent)
})

test('replaying a legacy execution identity does not opt its old memory operations into the new manager', async () => {
  const f = fixture(), entries: JournalEntry[] = [], journalStore = { entries, save: async (entry: JournalEntry) => { entries.push(structuredClone(entry)) } }
  const oldJournal = createBobJournal(journalStore, Date.now() + 100000)
  await oldJournal.run('execution:identity', {}, async () => ({ id: 'legacy-turn', constructionReplayVersion: 2 }))
  const journal = createBobJournal(journalStore, Date.now() + 100000)
  let newIdentities = 0, calls = 0
  const execution = await journal.run<{ id: string; memoryManagementVersion?: 1 }>('execution:identity', {}, async () => {
    newIdentities++; return { id: 'new-turn', memoryManagementVersion: 1 }
  })
  assert.equal(newIdentities, 0)
  assert.equal(execution.id, 'legacy-turn')
  assert.equal(execution.memoryManagementVersion, undefined)
  await assert.rejects(prepareWorkingContext({ ...f.opts, memoryManagementVersion: execution.memoryManagementVersion,
    callModel: options => journal.run('model:context-summary', options, async () => {
      calls++; return response({ gist: compactGist, index: Array.from({ length: 40 }, (_, i) => hint(i + 1)) })
    }),
  }), /context_unavailable/)
  assert.equal(calls, 2)
  assert.equal(f.saves, 0)
  assert.equal(f.state.lastFoldedSeq, 39)
})

test('real SQL keeps exact messages searchable after their hints leave managed memory and isolates another private thread', async t => {
  const pg = await projectSchema()
  t.after(() => pg.close())
  const owner = randomUUID(), other = randomUUID()
  await pg.query("insert into auth.users(id,email) values($1,'owner@example.test'),($2,'other@example.test')", [owner, other])
  await pg.exec("insert into bob.projects(id,slug,name) values('memory-project','memory-project','Memory project')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('memory-owner','memory-project','Owner','OW',$1),('memory-other','memory-project','Other','OT',$2)", [owner, other])
  const rpc = async (name: string, values: unknown[]) => (await asProjectUser(pg, null, `select bob.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) result`, values, 'service_role')).rows[0].result as any
  let claim: any, turn: string
  for (let i = 0; i < 31; i++) {
    turn = randomUUID()
    claim = await rpc('bob_claim_turn', ['memory-project', owner, turn, `Older owner message ${i}\n  exact 70 × 160 cm.`])
    assert.equal(claim.status, 'claimed')
    await rpc('bob_commit_turn_v2', ['memory-project', owner, claim.thread_id, turn, claim.generation, `Owner answer ${i}`, JSON.stringify({ kind: 'ai_assessment', sources: [], partial: false }), null])
  }
  const foreign = await rpc('bob_claim_turn', ['memory-project', other, randomUUID(), 'OTHER PRIVATE CONVERSATION'])
  const current = 'Continue the same saved drawing.'
  turn = randomUUID()
  claim = await rpc('bob_claim_turn', ['memory-project', owner, turn, current])
  const bind = ['memory-project', owner, claim.thread_id, turn, claim.generation]
  const store: ContextStore = {
    load: () => rpc('bob_load_context', bind),
    save: (expected, through, summary) => rpc('bob_save_context_summary', [...bind, expected, through, summary]),
    search: (query, before) => rpc('bob_search_context_history', [...bind, query, before]),
  }
  const prepared = await prepareWorkingContext({ projectId: 'memory-project', userId: owner, threadId: claim.thread_id, generation: claim.generation,
    message: current, memoryManagementVersion: 1, store, hasAccess: async () => true, deadline: Date.now() + 100000,
    callModel: async () => response({ gist: compactGist, index: [] }),
  })
  assert.equal(prepared.throughSeq, 58)
  assert.deepEqual(prepared.recent.map(m => m.seq), [59, 60, 61, 62, 63])
  assert(!prepared.historyIndex!.some(e => e.seq === 1))
  const stored = await store.load() as ContextFrame
  assert.equal(stored.lastFoldedSeq, 58)
  assert.deepEqual(JSON.parse(stored.summary).index, prepared.historyIndex)
  const exact = await prepared.history.search({ query: 'Older owner message 0\n', before_seq: null })
  assert.equal(exact.status, 'ok')
  assert.deepEqual((exact.messages as ContextMessage[]).map(m => m.text), ['Older owner message 0\n  exact 70 × 160 cm.'])
  const first = await prepared.history.search({ query: 'Older owner message', before_seq: null })
  const second = await prepared.history.search({ query: 'Older owner message', before_seq: first.nextBeforeSeq })
  assert.equal((first.messages as ContextMessage[]).length, 5)
  assert.equal((second.messages as ContextMessage[]).length, 5)
  assert.equal(new Set([...(first.messages as ContextMessage[]), ...(second.messages as ContextMessage[])].map(m => m.seq)).size, 10)
  assert.equal((await prepared.history.search({ query: 'OTHER PRIVATE', before_seq: null })).status, 'empty')
  assert.notEqual(foreign.thread_id, claim.thread_id)
  assert.equal((await pg.query('select count(*)::integer n from bob.bob_messages where thread_id=$1', [claim.thread_id])).rows[0].n, 63)
})
