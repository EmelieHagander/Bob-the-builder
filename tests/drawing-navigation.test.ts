import assert from 'node:assert/strict'
import test from 'node:test'
import { drawingOrigin, type DrawingOrigin } from '../src/lib/drawingNavigation'

const origin: DrawingOrigin = { projectId: 'P', key: 'task-entry', path: '/tasks/prepare', label: 'Prepare opening',
  scrollY: 500, anchor: 'task:prepare:drawing', disclosures: [{ id: 'instruction-images-1', open: true }] }

test('drawing return context keeps work/position but cannot cross the active project', () => {
  assert.deepEqual(drawingOrigin({ drawingOrigin: origin }, 'P'), origin)
  assert.equal(drawingOrigin({ drawingOrigin: origin }, 'another-project'), null)
  assert.equal(drawingOrigin(null, 'P'), null)
})

test('drawing return context rejects external, unrelated and malformed destinations', () => {
  for (const path of ['https://example.test', '//example.test', '/account', '/project/extra', 'javascript:alert(1)']) {
    assert.equal(drawingOrigin({ drawingOrigin: { ...origin, path } }, 'P'), null)
  }
  assert.equal(drawingOrigin({ drawingOrigin: { ...origin, scrollY: Infinity } }, 'P'), null)
  assert.equal(drawingOrigin({ drawingOrigin: { ...origin, disclosures: [null] } }, 'P'), null)
  assert(drawingOrigin({ drawingOrigin: { ...origin, path: '/project?step=saved-step' } }, 'P'))
})
