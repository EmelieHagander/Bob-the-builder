import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequestScope } from '../src/lib/projectRequest.ts'

test('A → B → A and sign-out invalidate pending responses, including remounts', async () => {
  const scope = createRequestScope()
  const oldA = scope.capture()
  scope.invalidate() // B
  const b = scope.capture()
  scope.invalidate() // A again
  const newA = scope.capture()
  assert.equal(oldA(), false)
  assert.equal(b(), false)
  assert.equal(newA(), true)
  scope.invalidate() // sign-out / component cleanup
  assert.equal(newA(), false)
})
