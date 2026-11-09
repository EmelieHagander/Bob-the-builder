import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobJournal, BobContinuation, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { reconcileAiWork } from '../supabase/functions/_shared/ai-background.ts'

// 2026-11-09 entrance job: Konrad's model step lapsed with the sign-in at 60 min.
// After Reconnect the same reservation answered "expired" and Konrad was dropped.
test('a model step whose reservation lapsed is sent again as a new attempt with its own AI job', async () => {
  const entries: JournalEntry[] = []
  const attempts: number[] = []
  const run = () => {
    const journal = createBobJournal({ entries: JSON.parse(JSON.stringify(entries)), save: async e => { entries.push(structuredClone(e)) } }, Infinity)
    return journal.run('model:structure-worker', { request: 'same input' }, async identity => {
      attempts.push(identity.attempt)
      if (attempts.length === 1) throw new BobContinuation('yield', 'ai_wait', { id: 'ai-old', accepted: true })
      if (attempts.length === 2) throw new BobContinuation('yield', 'model_deadline_renewed')
      if (attempts.length === 3) throw new BobContinuation('yield', 'ai_wait', { id: 'ai-new', accepted: true })
      return 'saved'
    })
  }
  await assert.rejects(run, (e: any) => e.message === 'ai_wait')
  await assert.rejects(run, (e: any) => e.message === 'model_deadline_renewed')
  // The new attempt waits on a different AI job without counting as a changed continuation.
  await assert.rejects(run, (e: any) => e.message === 'ai_wait')
  assert.equal(await run(), 'saved')
  assert.deepEqual(attempts, [0, 0, 1, 1])
  assert.deepEqual(entries.filter(e => e.key.includes(':waiting')).map(e => [e.key.replace(/^.*:0/, ''), (e.value as any).id]),
    [[':waiting', 'ai-old'], [':waiting:1', 'ai-new']])
})

test('renewal stops after the normal retry limit instead of looping', async () => {
  const entries: JournalEntry[] = []
  const run = () => createBobJournal({ entries: JSON.parse(JSON.stringify(entries)), save: async e => { entries.push(structuredClone(e)) } }, Infinity)
    .run('model:structure-worker', { request: 'same input' }, async () => { throw new BobContinuation('yield', 'model_deadline_renewed') })
  await assert.rejects(run, /model_deadline_renewed/)
  await assert.rejects(run, /model_deadline_renewed/)
  await assert.rejects(run, /provider_retry_exhausted/)
})

test('a refused cancel of a finished response reads its final state once instead of retrying the cancel', async t => {
  const fetch = globalThis.fetch; t.after(() => { globalThis.fetch = fetch })
  const urls: string[] = [], calls: [string, any][] = []
  const final = { id: 'resp_done', status: 'completed', output: [], metadata: {} }
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url))
    return String(url).endsWith('/cancel')
      ? Response.json({ error: { code: null, message: 'Cannot cancel a completed response.' } }, { status: 400 })
      : Response.json(final)
  }) as typeof fetch
  const rpc = async (name: string, args: any) => {
    calls.push([name, args])
    return name === 'ai_work_claim' ? { response_id: 'resp_done', cancel: true } : true
  }
  const id = '11111111-1111-4111-8111-111111111111'
  await reconcileAiWork(rpc, 'fixture-key', 'job', id, '22222222-2222-4222-8222-222222222222')
  assert.deepEqual(urls.map(u => u.replace(/^.*responses/, '')), ['/resp_done/cancel', '/resp_done'])
  assert.deepEqual(calls.find(([n]) => n === 'ai_job_accept')?.[1], { p_job: id, p_response: final })
  assert(calls.some(([n]) => n === 'ai_work_finish'))
})
