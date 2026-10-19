import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pinBobModelDeadline } from '../supabase/functions/_shared/bob-model-deadline.ts'
import { createBobJournal, BobContinuation, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { backgroundResponse, AIBackgroundPending } from '../supabase/functions/_shared/ai-background.ts'

test('renewing owner authority during ai_wait preserves the accepted operation and never pays for a second POST', async t => {
  const fetch = globalThis.fetch; t.after(() => { globalThis.fetch = fetch })
  async function scenario(pin: boolean) {
    const entries: JournalEntry[] = []
    let expiry = '2030-01-01T01:00:00Z', posts = 0, complete = false
    let reservation: any
    const result = { id: 'resp_original', status: 'completed', output: [{ type: 'function_call', call_id: 'read', name: 'check_construction_draft', arguments: '{}' }] }
    globalThis.fetch = async () => { posts++; return Response.json({ ...result, status: 'queued', output: [] }) }
    const rpc = async (name: string, args: any) => {
      if (name === 'ai_job_prepare') {
        const submit = !reservation
        if (!reservation) reservation = structuredClone(args)
        // The same SQL identity check that rejected the observed live resume.
        if (reservation.p_expires !== args.p_expires || reservation.p_fingerprint !== args.p_fingerprint) throw new Error('ai_operation_changed')
        return { id: '11111111-1111-4111-8111-111111111111', submit, status: complete ? 'completed' : 'pending', response_id: result.id, response: complete ? result : null }
      }
      if (name === 'ai_job_start_submission') return { submit: true, status: 'submitting' }
      return true
    }
    const run = async () => {
      const journal = createBobJournal({ entries: JSON.parse(JSON.stringify(entries)), save: async e => { entries.push(structuredClone(e)) } }, Infinity)
      return journal.run('model:ask-bob', { request: 'exact input' }, async identity => {
        const expiresAt = pin ? await pinBobModelDeadline(journal.run.bind(journal), identity, expiry) : expiry
        try { return await backgroundResponse(rpc, 'fixture-key', 'bob', { key: 'job/' + identity.key, fingerprint: identity.fingerprint,
          receiver: 'bob', context: { jobId: 'job', role: 'ask-bob' }, expiresAt }, {},
          { user_id: null, module: 'global', ai_function: 'ask-bob', model: 'fixture', input_price_per_1m: 0, output_price_per_1m: 0, cached_price_per_1m: 0 }) }
        catch (error) { if (error instanceof AIBackgroundPending) throw new BobContinuation('yield', 'ai_wait', { id: error.jobId, accepted: true }); throw error }
      })
    }
    await assert.rejects(run, BobContinuation)
    expiry = '2030-01-01T02:00:00Z'; complete = true
    if (!pin) await assert.rejects(run, /ai_operation_changed/)
    else { assert.deepEqual(await run(), result); assert.deepEqual(await run(), result) }
    assert.equal(posts, 1)
    assert.equal(reservation.p_expires, '2030-01-01T01:00:00Z')
    if (pin) {
      const journal = createBobJournal({ entries, save: async e => { entries.push(e) } }, Infinity)
      assert.equal(await pinBobModelDeadline(journal.run.bind(journal), { key: 'model:ask-bob:1', fingerprint: 'b'.repeat(64), attempt: 0 }, expiry), expiry,
        'new model work uses renewed authority, not the old turn-start deadline')
    }
  }
  await scenario(false)
  await scenario(true)
})
