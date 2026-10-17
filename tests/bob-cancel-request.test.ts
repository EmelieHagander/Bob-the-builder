import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobHandler } from '../supabase/functions/_shared/bob-request.ts'

const jobId = '11111111-1111-4111-8111-111111111111'
const request = (body: unknown, authorization = 'Bearer owner-token') => new Request('https://bob.invalid', {
  method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const noAnswer = async () => { throw Error('Cancellation must not start a model turn') }

test('Stop forwards only the authenticated actor, project and exact job to cancellation', async () => {
  let calls = 0
  const handler = createBobHandler({ authenticate: async () => 'owner', answer: noAnswer, cancel: async input => {
    calls++
    assert.deepEqual(input, { authHeader: 'Bearer owner-token', userId: 'owner', projectId: 'A', jobId })
    return { ok: true, status: 'cancelled', projectId: 'A', jobId }
  } })
  const response = await handler(request({ action: 'cancel', projectId: 'A', jobId }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, status: 'cancelled', projectId: 'A', jobId })
  assert.equal(calls, 1)
})

test('Stop rejects forged actor/transcript fields and invalid jobs before cancellation', async () => {
  let calls = 0
  const handler = createBobHandler({ authenticate: async () => 'owner', answer: noAnswer, cancel: async () => { calls++; return { ok: true } } })
  for (const body of [
    { action: 'cancel', projectId: 'A', jobId, userId: 'another-member' },
    { action: 'cancel', projectId: 'A', jobId, message: 'replacement instruction' },
    { action: 'cancel', projectId: 'A', jobId: 'invalid' },
    { action: 'cancel', projectId: '', jobId },
  ]) assert.equal((await handler(request(body))).status, 400)
  assert.equal((await handler(request({ action: 'cancel', projectId: 'A', jobId }, ''))).status, 401)
  assert.equal(calls, 0)
})

test('completed work and denied access remain explicit cancellation failures', async () => {
  for (const [error, status] of [['turn_not_in_flight', 409], ['project_denied', 403], ['service_unavailable', 503]] as const) {
    const handler = createBobHandler({ authenticate: async () => 'owner', answer: noAnswer, cancel: async () => ({ ok: false, error }) })
    const response = await handler(request({ action: 'cancel', projectId: 'A', jobId }))
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { ok: false, error })
  }
})
