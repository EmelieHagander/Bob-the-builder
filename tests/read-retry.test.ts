import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWithStatementRetry, withStatementRetry } from '../supabase/functions/_shared/read-retry.ts'

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

test('retry diagnostics identify the database code without exposing error messages or request data', async () => {
  const original = console.error
  const logs: string[] = []
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
  try {
    let calls = 0
    await readWithStatementRetry('read_construction_draft', async () => {
      calls++
      return calls === 1
        ? { data: null, error: { code: '57014', message: 'private material details' } }
        : { data: { status: 'ok' }, error: null }
    })
    assert.equal(calls, 2)
    assert.equal(logs.length, 2)
    assert.match(logs[0], /"code":"57014"/)
    assert.match(logs[0], /"retry":true/)
    assert.match(logs[1], /"attempt":2/)
    assert(!logs.join(' ').includes('private material details'))
  } finally { console.error = original }
})

test('thrown read errors are logged by category and are not silently retried', async () => {
  const original = console.error
  const logs: string[] = []
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
  try {
    let calls = 0
    await assert.rejects(readWithStatementRetry('read_construction_draft', async () => {
      calls++
      throw new Error('private database detail')
    }), /private database detail/)
    assert.equal(calls, 1)
    assert.match(logs[0], /"code":"thrown"/)
    assert(!logs[0].includes('private database detail'))
  } finally { console.error = original }
})

test('a write cancelled at the statement timeout is sent once more; slow saves are logged without content', async () => {
  const original = console.error
  const logs: string[] = []
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
  try {
    let calls = 0
    const saved = await withStatementRetry('bob_project_write_v16', async () => {
      calls++
      return calls === 1
        ? { data: null, error: { code: '57014', message: 'private drawing title' } }
        : { data: { recordId: 'a' }, error: null }
    }, undefined, { label: 'Write', slowMs: 3000 })
    assert.equal(calls, 2)
    assert.deepEqual(saved, { data: { recordId: 'a' }, error: null })
    assert.match(logs[0], /^\[Write outcome\]/)
    assert.match(logs[0], /"retry":true/)
    assert.match(logs[1], /"attempt":2.*"code":"ok"/)
    assert(!logs.join(' ').includes('private drawing title'))

    // A conflict or a refused write is never resent.
    calls = 0
    const conflict = { data: null, error: { code: 'PT409' } }
    assert.deepEqual(await withStatementRetry('w', async () => { calls++; return conflict }, undefined, { label: 'Write' }), conflict)
    assert.equal(calls, 1)

    // A fast success is silent; a slow success is logged once.
    logs.length = 0
    await withStatementRetry('w', async () => ({ data: 1, error: null }), undefined, { label: 'Write', slowMs: 3000 })
    assert.equal(logs.length, 0)
    await withStatementRetry('w', async () => ({ data: 1, error: null }), undefined, { label: 'Write', slowMs: 0 })
    assert.equal(logs.length, 1)
    assert.match(logs[0], /"code":"ok","retry":false/)
  } finally { console.error = original }
})

test('a write whose response is lost is not resent: its outcome is unknown', async () => {
  const original = console.error
  console.error = () => {}
  try {
    let calls = 0
    await assert.rejects(withStatementRetry('w', async () => { calls++; throw Object.assign(new Error('x'), { name: 'TimeoutError' }) }, undefined, { label: 'Write' }))
    assert.equal(calls, 1)
  } finally { console.error = original }
})
