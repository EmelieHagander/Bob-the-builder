import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWithStatementRetry } from '../supabase/functions/_shared/read-retry.ts'

const timeout = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }

test('a read cancelled at the statement timeout is retried once with a fresh signal', async () => {
  const signals: AbortSignal[] = []
  let calls = 0
  const result = await readWithStatementRetry('read_construction_draft', async signal => {
    signals.push(signal); calls++
    return calls === 1 ? timeout : { data: { status: 'ok' }, error: null }
  })
  assert.equal(calls, 2)
  assert.deepEqual(result, { data: { status: 'ok' }, error: null })
  assert.notEqual(signals[0], signals[1])
})

test('a second timeout, other errors and an aborted outer signal are returned without more attempts', async () => {
  let calls = 0
  assert.deepEqual(await readWithStatementRetry('r', async () => { calls++; return timeout }), timeout)
  assert.equal(calls, 2)
  calls = 0
  const denied = { data: null, error: { code: '42501' } }
  assert.deepEqual(await readWithStatementRetry('r', async () => { calls++; return denied }), denied)
  assert.equal(calls, 1)
  calls = 0
  const outer = new AbortController(); outer.abort()
  assert.deepEqual(await readWithStatementRetry('r', async () => { calls++; return timeout }, outer.signal), timeout)
  assert.equal(calls, 1)
})
