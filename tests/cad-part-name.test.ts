// The app's parts list names parts like the drawing sheets (bob_cad annotations.part_name).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cadPartName } from '../src/lib/labels.ts'

test('part names drop sizes, units and definition prefixes, as on the sheets', () => {
  assert.equal(cadPartName('leg_45x45x430'), 'Leg')
  assert.equal(cadPartName('sidePanel.left'), 'Side panel left')
  assert.equal(cadPartName('def_front_back'), 'Front back')
  assert.equal(cadPartName('definitionLeg'), 'Leg')
  assert.equal(cadPartName('P1'), 'Part')
})
