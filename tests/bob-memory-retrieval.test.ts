import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryRetrieval, MEMORY_EMBEDDING_DIMENSIONS, journalMemoryStore, type MemoryContextStore, type MemoryRetrievalStore } from '../supabase/functions/_shared/bob-memory-retrieval.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'

const fingerprint = 'a'.repeat(32)
const v = (position = 0) => Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, (_, i) => Number(i === position))
const scope = { projectId: 'A', threadId: 'private-one' }
const message = { seq: 7, role: 'user', text: 'Vi kanske kan göra sängen 90 cm bred. Jag måste mäta först.', state: 'completed' }
function fixture(overrides: Partial<MemoryRetrievalStore> = {}) {
  const calls: { kind: string; args: unknown[] }[] = []
  const store: MemoryRetrievalStore = {
    exact: async (...args) => { calls.push({ kind: 'exact', args }); return { ...scope, status: 'ok', message, source: { seq: 7, fingerprint }, offset: 0, nextOffset: null, totalCharacters: message.text.length } },
    indexPending: async (...args) => { calls.push({ kind: 'pending', args }); return { ...scope, chunks: [{ seq: 7, chunkStart: 0, fingerprint, text: message.text }], hasMore: true } },
    indexSave: async (...args) => { calls.push({ kind: 'save', args }); return { ...scope, saved: 1 } },
    searchHybrid: async (...args) => { calls.push({ kind: 'search', args }); return { ...scope, messages: [message], sources: [{ seq: 7, fingerprint }], searchMode: args[2] ? 'hybrid' : 'lexical' } },
    ...overrides,
  }
  const retrieval = createMemoryRetrieval({ ...scope, store, hasAccess: async () => true, embedder: { model: 'catalog-embedding-model', embed: async texts => { calls.push({ kind: 'embed', args: [texts] }); return texts.map(() => v()) } } })
  return { calls, store, retrieval }
}

test('private retrieval indexes a bounded source batch and uses fresh query embeddings with source links', async () => {
  const { calls, retrieval } = fixture()
  const result = await retrieval.search({ query: 'bekräftad bredd', before_seq: null })
  assert.equal(result.status, 'ok'); assert.equal(result.truth, 'conversation_only'); assert.equal(result.searchMode, 'hybrid')
  assert.deepEqual(calls.map(c => c.kind), ['pending', 'embed', 'save', 'embed', 'search'])
  assert.deepEqual(calls[0].args, [8, 'catalog-embedding-model'])
  assert.deepEqual((calls[2].args[0] as any[])[0], { seq: 7, chunkStart: 0, fingerprint, embedding: v() })
  assert.deepEqual(calls[4].args, ['bekräftad bredd', null, v(), 'catalog-embedding-model'])
  assert.deepEqual(result.sources, [{ seq: 7, fingerprint }])
  assert.deepEqual(await retrieval.read({ seq: 7, offset: null }), { ...scope, status: 'ok', message, source: { seq: 7, fingerprint }, offset: 0, nextOffset: null, totalCharacters: message.text.length, truth: 'conversation_only' })
})

test('an unavailable embedding service leaves originals and text search usable and labelled', async () => {
  const f = fixture()
  const retrieval = createMemoryRetrieval({ ...scope, store: f.store, hasAccess: async () => true, embedder: { model: 'embedding', embed: async () => { throw new Error('provider_unavailable') } } })
  assert.equal((await retrieval.index() as any).status, 'lexical_only')
  const result = await retrieval.search({ query: '90 cm', before_seq: null })
  assert.equal(result.status, 'ok'); assert.equal(result.searchMode, 'lexical')
  assert.equal((await retrieval.read({ seq: 7, offset: 0 })).status, 'ok')
  assert(!f.calls.some(c => c.kind === 'save'))
})

test('empty query browses without a paid embedding and original pages are explicit', async () => {
  const f = fixture({ exact: async (seq, offset) => ({ ...scope, status: 'ok', message: { ...message, seq, text: 'x'.repeat(4000) }, source: { seq, fingerprint }, offset, totalCharacters: 9000, nextOffset: 8000 }) })
  await f.retrieval.search({ query: '', before_seq: 9 })
  assert.deepEqual(f.calls.map(c => c.kind), ['search'])
  const page = await f.retrieval.read({ seq: 7, offset: 4000 })
  assert.equal(page.status, 'ok'); assert.equal(page.offset, 4000); assert.equal(page.nextOffset, 8000)
})

test('another thread response, invented source link, and malformed vectors fail closed', async () => {
  for (const mutation of [
    { searchHybrid: async () => ({ ...scope, threadId: 'other-private', messages: [message], sources: [{ seq: 7, fingerprint }], searchMode: 'hybrid' }) },
    { searchHybrid: async () => ({ ...scope, messages: [message], sources: [{ seq: 8, fingerprint }], searchMode: 'hybrid' }) },
  ]) {
    assert.equal((await fixture(mutation).retrieval.search({ query: 'size', before_seq: null })).status, 'unavailable')
  }
  const f = fixture()
  const bad = createMemoryRetrieval({ ...scope, store: f.store, hasAccess: async () => true, embedder: { model: 'embedding', embed: async () => [[NaN]] } })
  assert.equal((await bad.index() as any).status, 'unavailable')
  assert(!f.calls.some(c => c.kind === 'save'))
  const wrongSource = fixture({ exact: async () => ({ ...scope, status: 'ok', message, source: { seq: 8, fingerprint }, offset: 0, totalCharacters: 100, nextOffset: null }) })
  assert.equal((await wrongSource.retrieval.read({ seq: 7 })).status, 'unavailable')
})

test('revoked authority prevents indexing and suppresses results if revoked during retrieval', async () => {
  const f = fixture(); let checks = 0
  const noAccess = createMemoryRetrieval({ ...scope, store: f.store, hasAccess: async () => false })
  assert.equal((await noAccess.read({ seq: 7 })).status, 'denied')
  assert.equal((await noAccess.search({ query: '', before_seq: null })).status, 'denied')
  assert.equal(f.calls.length, 0)
  const revoked = createMemoryRetrieval({ ...scope, store: f.store, hasAccess: async () => ++checks === 1 })
  assert.equal((await revoked.read({ seq: 7 })).status, 'denied')
})

test('worker continuation escapes semantic fallback and invalid input never touches storage', async () => {
  const f = fixture({ indexPending: async () => { throw new BobContinuation('yield') } })
  await assert.rejects(f.retrieval.index(), error => error instanceof BobContinuation)
  for (const value of [{ query: 'x', before_seq: null, projectId: 'B' }, { query: 'x'.repeat(201), before_seq: null }, { query: 'x', before_seq: -1 }]) {
    assert.equal((await f.retrieval.search(value)).status, 'invalid')
  }
  assert.equal((await f.retrieval.read({ seq: 0 })).status, 'invalid')
  assert.equal(f.calls.length, 0)
})

test('journal replay preserves the selected source batch after the cache save committed but its checkpoint was lost', async () => {
  const entries: JournalEntry[] = [], indexed = new Set<number>(), writes: number[] = []
  let pendingReads = 0, paidCalls = 0, loseCheckpoint = true
  const source: MemoryContextStore = {
    load: async () => ({}), save: async () => ({}), search: async () => ({}),
    indexPending: async () => {
      pendingReads++
      const seq = [7,8].find(n => !indexed.has(n))
      return { ...scope, chunks: seq ? [{ seq, chunkStart: 0, fingerprint, text: `Original ${seq}` }] : [], hasMore: seq === 7 }
    },
    indexSave: async items => { writes.push(items[0].seq); indexed.add(items[0].seq); return { ...scope, saved: items.length } },
  }
  const run = () => {
    const journal = createBobJournal({ entries, save: async entry => {
      if (entry.key === 'context:index_save:0' && loseCheckpoint) { loseCheckpoint = false; throw new Error('checkpoint lost') }
      entries.push(structuredClone(entry))
    } }, Date.now() + 100000)
    const store = journalMemoryStore(source, (stream, input, work) => journal.run(stream, input, work))
    return createMemoryRetrieval({ ...scope, store, hasAccess: async () => true, embedder: {
      model: 'pinned-model', embed: texts => journal.run('embedding:memory', { texts }, async () => { paidCalls++; return texts.map(() => v()) }),
    } })
  }
  await assert.rejects(run().index(), error => error instanceof BobContinuation && error.message === 'checkpoint_unavailable')
  assert.deepEqual([...indexed], [7]); assert.equal(paidCalls, 1)
  const resumed = run()
  assert.deepEqual(await resumed.index(), { status: 'indexed', indexed: 1, remaining: true })
  assert.deepEqual(writes, [7,7]); assert.equal(pendingReads, 1); assert.equal(paidCalls, 1)
  await resumed.index()
  assert.deepEqual(writes, [7,7,8]); assert.equal(pendingReads, 2); assert.equal(paidCalls, 2)
  assert.deepEqual([...indexed], [7,8])
})

test('journalled summary refresh reconciles an exact committed CAS after checkpoint loss without accepting different text', async () => {
  const entries: JournalEntry[] = []
  let summary = 'prior', refreshWrites = 0, loseCheckpoint = true
  const source: MemoryContextStore = {
    load: async () => ({ lastFoldedSeq: 6, summary }), save: async () => ({}), search: async () => ({}),
    refresh: async (expected, previous, next) => {
      if (expected !== 6 || previous !== summary) throw new Error('context_changed')
      refreshWrites++; summary = next; return { lastFoldedSeq: expected }
    },
  }
  const run = () => {
    const journal = createBobJournal({ entries, save: async entry => {
      if (loseCheckpoint) { loseCheckpoint = false; throw new Error('checkpoint lost') }
      entries.push(structuredClone(entry))
    } }, Date.now() + 100000)
    return journalMemoryStore(source, (stream, input, work) => journal.run(stream, input, work))
  }
  await assert.rejects(run().refresh!(6, 'prior', 'compact'), error => error instanceof BobContinuation)
  assert.equal(summary, 'compact')
  assert.deepEqual(await run().refresh!(6, 'prior', 'compact'), { lastFoldedSeq: 6 })
  assert.equal(refreshWrites, 1)
  const direct = journalMemoryStore(source, (_stream, _input, work) => work())
  await assert.rejects(direct.refresh!(6, 'prior', 'different'), /context_changed/)
})

test('journalled original and hybrid reads replay exact results while retrieval still checks current authority', async () => {
  const f = fixture(), entries: JournalEntry[] = []
  let access = true
  const run = () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(structuredClone(entry)) } }, Date.now() + 100000)
    const store = journalMemoryStore({ ...f.store, load: async () => ({}), save: async () => ({}), search: async () => ({}) }, (stream, input, work) => journal.run(stream, input, work))
    return createMemoryRetrieval({ ...scope, store, hasAccess: async () => access })
  }
  const first = run(), original = await first.read({ seq: 7 }), search = await first.search({ query: '', before_seq: null })
  const resumed = run()
  assert.deepEqual(await resumed.read({ seq: 7 }), original)
  assert.deepEqual(await resumed.search({ query: '', before_seq: null }), search)
  assert.deepEqual(f.calls.map(c => c.kind), ['exact','search'])
  access = false
  assert.equal((await run().read({ seq: 7 })).status, 'denied')
})

test('unhandled uncertain dispatch flags escape index and query fallback without another provider attempt', async () => {
  const uncertain = Object.assign(new Error('embedding outcome unknown'), { priorAttemptUncertain: true })
  let calls = 0
  for (const queryOnly of [false, true]) {
    const f = fixture(queryOnly ? { indexPending: async () => ({ ...scope, chunks: [], hasMore: false }) } : {})
    const retrieval = createMemoryRetrieval({ ...scope, store: f.store, hasAccess: async () => true,
      embedder: { model: 'pinned-model', embed: async () => { calls++; throw uncertain } } })
    await assert.rejects(queryOnly ? retrieval.search({ query: 'meaning', before_seq: null }) : retrieval.index(), error => error === uncertain)
    assert(!f.calls.some(c => ['save','search'].includes(c.kind)))
  }
  assert.equal(calls, 2)
})
