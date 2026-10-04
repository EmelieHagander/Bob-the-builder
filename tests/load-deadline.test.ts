import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withLoadDeadline } from '../src/lib/loadDeadline.ts'

test('a stalled read becomes a connection error, never an empty result', async () => {
  await assert.rejects(withLoadDeadline(new Promise(() => {}), 10), /connection took too long/)
})

test('a timed-out read cannot replace a newer successful retry', async () => {
  let finish!: (value: string) => void
  const original = withLoadDeadline(new Promise<string>(resolve => { finish = resolve }), 10)
  await assert.rejects(original, /connection took too long/)
  const retry = await withLoadDeadline(Promise.resolve('current account'), 50)
  finish('late account')
  assert.equal(retry, 'current account')
  await assert.rejects(original, /connection took too long/)
})

test('a real read failure remains a failure before the deadline', async () => {
  const denied = new Error('Account access denied')
  await assert.rejects(withLoadDeadline(Promise.reject(denied), 50), error => error === denied)
})
