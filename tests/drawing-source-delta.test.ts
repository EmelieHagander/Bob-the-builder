import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDrawingSourceChanges } from '../src/data/drawingSources.ts'

test('safe source deltas retain revision changes and revoked-source anonymity', () => {
  const changed = { kind: 'project_measurement', id: 'measurement', saved_revision: 2, current_revision: 5, parameter_ids: ['width', 'inside'], state: 'changed' }
  const revoked = { kind: 'space_measurement', id: null, saved_revision: 2, current_revision: null, parameter_ids: ['width'], state: 'unavailable' }
  assert.deepEqual(parseDrawingSourceChanges({ changes: [changed, revoked], truncated: true }), { changes: [changed, revoked], changesTruncated: true })
  assert.deepEqual(parseDrawingSourceChanges({ changes: [], truncated: false }), { changes: [], changesTruncated: false })
})

test('malformed or unbounded source change responses degrade to unavailable rather than crashing the saved revision', () => {
  const valid = { kind: 'drawing', id: 'saved', saved_revision: 1, current_revision: 2, parameter_ids: [], state: 'changed' }
  for (const bad of [null, { changes: [null], truncated: false }, { changes: [valid], truncated: 'false' },
    { changes: [{ ...valid, parameter_ids: null }], truncated: false },
    { changes: [{ ...valid, parameter_ids: [null] }], truncated: false },
    { changes: [{ ...valid, private_prose: 'Unexpected field' }], truncated: false },
    { changes: [{ ...valid, saved_revision: -1 }], truncated: false },
    { changes: Array(201).fill(valid), truncated: true }]) assert.equal(parseDrawingSourceChanges(bad), null)
})
