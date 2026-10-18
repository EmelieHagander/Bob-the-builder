import test from 'node:test'
import assert from 'node:assert/strict'
import { createJournalledMemoryEmbedder } from '../supabase/functions/_shared/bob-memory-embedding.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'

const success = () => ({ success: true, data: [[1, 0]], model: 'pinned-model', usage: { input_tokens: 2, output_tokens: 0, total_tokens: 2 } })
function fixture() {
  const entries: JournalEntry[] = []
  let calls = 0, uncertain = 0, loseResult = false, allowed = true
  const run = () => {
    const journal = createBobJournal({ entries, save: async entry => {
      if (loseResult && entry.key.startsWith('memory:embedding-result:')) { loseResult = false; throw new Error('lost checkpoint') }
      entries.push(structuredClone(entry))
    } }, 100000, () => 0, new Map(), { unlimitedWork: true })
    return createJournalledMemoryEmbedder({ model: 'pinned-model', identity: { manifest: 'pinned', dimensions: 256 },
      memo: (stream, input, work, reserve) => journal.run(stream, input, work, reserve),
      hasAccess: async () => allowed, onUncertain: () => { uncertain++ },
      invoke: async () => { calls++; return success() },
    })
  }
  return { run, entries, get calls() { return calls }, get uncertain() { return uncertain },
    loseResult() { loseResult = true }, revoke() { allowed = false } }
}
test('embedding response is reused across replay with no duplicate paid dispatch', async () => {
  const f = fixture()
  assert.deepEqual(await f.run().embed(['source']), [[1, 0]])
  assert.deepEqual(await f.run().embed(['source']), [[1, 0]])
  assert.equal(f.calls, 1); assert.equal(f.uncertain, 0)
})
test('lost embedding result checkpoint falls back without another paid dispatch', async () => {
  const f = fixture(); f.loseResult()
  await assert.rejects(f.run().embed(['source']), error => error instanceof BobContinuation && error.kind === 'yield')
  await assert.rejects(f.run().embed(['source']), /embedding_unavailable/)
  await assert.rejects(f.run().embed(['source']), /embedding_unavailable/)
  assert.equal(f.calls, 1); assert.equal(f.uncertain, 2)
})
test('embedding replay remains bound to source input and live access', async () => {
  const f = fixture(); await f.run().embed(['source'])
  await assert.rejects(f.run().embed(['different']), /continuation_changed/)
  f.revoke(); await assert.rejects(f.run().embed(['source']), /project_denied/)
  assert.equal(f.calls, 1)
})
test('known provider uncertainty is checkpointed for lexical fallback, not resent', async () => {
  const entries: JournalEntry[] = []; let calls = 0, uncertain = 0
  const run = () => {
    const journal = createBobJournal({ entries, save: async entry => { entries.push(entry) } }, 100000, () => 0)
    return createJournalledMemoryEmbedder({ model: 'pinned-model', identity: {}, memo: (s, i, w, r) => journal.run(s, i, w, r),
      hasAccess: async () => true, onUncertain: () => { uncertain++ }, invoke: async () => {
        calls++; return { ...success(), success: false, data: null, error: 'timeout', priorAttemptUncertain: true }
      } })
  }
  await assert.rejects(run().embed(['source']), /embedding_unavailable/)
  await assert.rejects(run().embed(['source']), /embedding_unavailable/)
  assert.equal(calls, 1); assert.equal(uncertain, 2)
})
