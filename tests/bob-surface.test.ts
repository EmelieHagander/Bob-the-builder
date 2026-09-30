import assert from 'node:assert/strict'
import test from 'node:test'
import { createBobSurfaceStore } from '../src/lib/bobSurface.ts'

test('page context is bound to current route/project and delayed cleanup cannot erase a new page', () => {
  const store = createBobSurfaceStore()
  const disposeA = store.publish('A', '/tasks/one', { pointer: { surface: 'task', taskId: 'one' }, label: 'First Task' })
  assert.equal(store.read('A', '/tasks/one')?.pointer.taskId, 'one')
  assert.equal(store.read('B', '/tasks/one'), null)
  assert.equal(store.read('A', '/people'), null, 'Navigation cannot retain a Task hint while another surface loads')
  const disposeB = store.publish('A', '/people', { pointer: { surface: 'people' }, label: 'People' })
  disposeA()
  assert.equal(store.read('A', '/people')?.pointer.surface, 'people')
  disposeB()
  assert.equal(store.read('A', '/people'), null)
})

test('semantic page focus beats shell fallback regardless of effect order; disposal restores fallback', () => {
  const store = createBobSurfaceStore()
  const disposeDetail = store.publish('A', '/artifacts', { pointer: { surface: 'drawings', artifactId: 'saved-one', artifactRevision: 1 }, label: 'Drawing v1' })
  store.publish('A', '/artifacts', { pointer: { surface: 'drawings' }, label: 'Drawings' }, 0)
  assert.equal(store.read('A', '/artifacts')?.pointer.artifactRevision, 1)
  disposeDetail()
  assert.equal(store.read('A', '/artifacts')?.pointer.artifactId, undefined)
})

test('a captured pointer retains the exact revision after navigation and cannot be mutated', () => {
  const store = createBobSurfaceStore()
  const input = { surface: 'drawings' as const, artifactId: 'saved-one', artifactRevision: 1 }
  const dispose = store.publish('A', '/artifacts', { pointer: input, label: 'Drawing v1' })
  const captured = store.read('A', '/artifacts')!.pointer
  input.artifactRevision = 2
  dispose()
  store.publish('A', '/artifacts', { pointer: { surface: 'drawings', artifactId: 'saved-one', artifactRevision: 3 }, label: 'Drawing v3' })
  assert.equal(captured.artifactRevision, 1, 'The original turn does not become the latest proposal')
  assert(Object.isFrozen(captured))
})
