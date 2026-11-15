import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listText } from '../src/lib/share'

test('shared list puts needed items first, marks ticked ones and skips empty sections', () => {
  const text = listText('Shopping list', [
    { heading: 'Boards and sheets', items: [] },
    { heading: 'Screws', items: [{ name: 'Wood screw 4×40', detail: '200 pcs', done: true }, { name: 'Wood screw 5×80', done: false }] },
  ])
  assert.equal(text, 'Shopping list\n\nSCREWS\n☐ Wood screw 5×80\n✓ Wood screw 4×40 – 200 pcs')
})
