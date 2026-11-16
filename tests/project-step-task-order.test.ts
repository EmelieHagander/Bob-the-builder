import assert from 'node:assert/strict'
import test from 'node:test'
import { stepTasksInOrder, type WorkTask } from '../src/data/projectWork'

function task(name: string): WorkTask {
  return { name, id: name, primary_step_id: 'assembly', status: 'todo' }
}

test('assembly tasks follow their numbered sequence without changing the source list', () => {
  const tasks = ['4. Slats', '10. Review', '2. Gables', '1. Cut'].map(task)
  assert.deepEqual(stepTasksInOrder(tasks).map(t => t.name), ['1. Cut', '2. Gables', '4. Slats', '10. Review'])
  assert.equal(tasks[0].name, '4. Slats')
})

test('an incomplete numbering scheme keeps its existing order', () => {
  const tasks = ['2. Measure', 'Inspect the frame', '1. Mark'].map(task)
  assert.deepEqual(stepTasksInOrder(tasks), tasks)
})
