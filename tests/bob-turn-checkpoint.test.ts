import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOB_CHECKPOINT_MAX_CHARS, checkpointErrorClass, createBobTurnCheckpoint } from '../supabase/functions/_shared/bob-turn-checkpoint.ts'
import { BobContinuation, createBobJournal } from '../supabase/functions/_shared/bob-job-journal.ts'

const binding = { jobId: '11111111-1111-4111-8111-111111111111', turnId: '22222222-2222-4222-8222-222222222222', catalogManifestId: '33333333-3333-4333-8333-333333333333' }
const journal = () => createBobJournal({ entries: [], save: async () => {} }, Date.now() + 60000)

test('checkpoint error classes are bounded and never carry error text', () => {
  assert.equal(checkpointErrorClass(new Error('job_not_claimed')), 'job_not_claimed')
  assert.equal(checkpointErrorClass(new Error('AbortError: signal is aborted without reason')), 'timeout')
  assert.equal(checkpointErrorClass(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout')
  assert.equal(checkpointErrorClass(new RangeError('Invalid string length secret-project-name')), 'RangeError')
  assert.equal(checkpointErrorClass('secret'), 'other')
})

test('a failed save yields checkpoint_unavailable and logs phase, size and class only', async () => {
  const logs: string[] = [], original = console.error
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
  try {
    const store = createBobTurnCheckpoint({ ...binding, checkpoint: null, journal: journal(),
      save: async () => { throw new Error('AbortError: secret project text') } })
    await assert.rejects(store.commit({ answer: 'secret project text' }), (e: unknown) => e instanceof BobContinuation && e.message === 'checkpoint_unavailable')
  } finally { console.error = original }
  const line = logs.find(l => l.startsWith('[Checkpoint unavailable]'))!
  assert(line, logs.join('\n'))
  const detail = JSON.parse(line.slice('[Checkpoint unavailable] '.length))
  assert.equal(detail.phase, 'save'); assert.equal(detail.error, 'timeout'); assert.equal(detail.job_id, binding.jobId)
  assert(Number.isSafeInteger(detail.state_chars) && detail.state_chars > 0)
  assert.doesNotMatch(line, /secret/)
})

test('an oversized snapshot fails the job without writing and logs only key sizes', async () => {
  const logs: string[] = [], original = console.warn
  console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
  let saves = 0
  try {
    const store = createBobTurnCheckpoint({ ...binding, checkpoint: null, journal: journal(), save: async () => { saves++; return null } })
    const state = { version: 1, components: { contextContinuation: 'secret'.repeat(BOB_CHECKPOINT_MAX_CHARS / 6 + 1), metrics: 'ok' } }
    await assert.rejects(store.commit(state), (e: unknown) => !(e instanceof BobContinuation) && e instanceof Error && e.message === 'turn_checkpoint_too_large')
  } finally { console.warn = original }
  assert.equal(saves, 0)
  const line = logs.find(l => l.startsWith('[Checkpoint size]'))!
  assert(line, logs.join('\n'))
  const detail = JSON.parse(line.slice('[Checkpoint size] '.length))
  assert.equal(detail.largest[0][0], 'components.contextContinuation')
  assert.doesNotMatch(line, /secret/)
})
