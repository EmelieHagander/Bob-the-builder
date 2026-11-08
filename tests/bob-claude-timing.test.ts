import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLAUDE_BACKGROUND_TIMEOUT_MS, CLAUDE_JOURNAL_SLACK_MS, claudeDispatchWindow, claudeJournalReserveMs } from '../supabase/functions/_shared/bob-model-timing.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'

test('Claude reserves a long streamed call and never crosses the journal receipt margin', () => {
  assert.equal(CLAUDE_BACKGROUND_TIMEOUT_MS, 120_000)
  assert.equal(claudeJournalReserveMs(120_000), 90_000)
  assert.equal(claudeJournalReserveMs(30_000), 30_000)
  assert.deepEqual(claudeDispatchWindow(120_000, 140_000), { ready: true, timeoutMs: 120_000 })
  assert.deepEqual(claudeDispatchWindow(120_000, 115_000), { ready: true, timeoutMs: 107_000 })
  assert.deepEqual(claudeDispatchWindow(120_000, 98_000), { ready: true, timeoutMs: 90_000 })
  assert.deepEqual(claudeDispatchWindow(120_000, 97_999), { ready: false, timeoutMs: 89_999 })
  assert.deepEqual(claudeDispatchWindow(30_000, 38_000), { ready: true, timeoutMs: 30_000 })
  assert.equal(CLAUDE_JOURNAL_SLACK_MS, 8_000)
})

test('Claude yields after slow pre-dispatch work without spending a paid retry', async () => {
  const entries: JournalEntry[] = []
  const store = { entries, save: async (entry: JournalEntry) => { entries.push(structuredClone(entry)) } }
  let now = 0, preworkMs = 50_000, sends = 0
  const run = () => {
    const journal = createBobJournal(store, 140_000, () => now)
    return journal.run('model:structure-worker', { request: 'same' }, async () => {
      now = preworkMs
      const window = claudeDispatchWindow(CLAUDE_BACKGROUND_TIMEOUT_MS, journal.remaining())
      if (!window.ready) throw new BobContinuation('yield')
      sends++
      return window.timeoutMs
    }, claudeJournalReserveMs(CLAUDE_BACKGROUND_TIMEOUT_MS))
  }
  await assert.rejects(run(), error => error instanceof BobContinuation && error.kind === 'yield')
  assert.equal(sends, 0)
  assert.equal(entries.length, 0, 'pre-dispatch yield has no uncertain-retry marker')

  now = 0
  preworkMs = 10_000
  assert.equal(await run(), 120_000)
  assert.equal(sends, 1)
  assert.equal(await run(), 120_000, 'replayed success does not send again')
  assert.equal(sends, 1)
})
