import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cadFastenerSummary } from '../src/data/cadFasteners.ts'
import { fastenerSchedule } from './support/fastener-schedule-fixture.ts'

test('the drawing view groups the saved schedule like the sheet and names codes for people', () => {
  const schedule = fastenerSchedule()
  const summary = cadFastenerSummary({ annotations: { version: 2, coverage: 'complete', views: {}, fasteners: schedule } })
  assert.notEqual(typeof summary, 'string')
  if (typeof summary === 'string') return
  assert.deepEqual(summary.rows, [
    { number: 'F1', fastener: 'Nail', size: 'Ø 2.8 × 50', quantity: 3, basis: 'Chosen instead of the rule' },
    { number: 'F2', fastener: 'Screw', size: 'Ø 5.0 × 120', quantity: 4, basis: 'Rule of thumb' },
  ])
  assert.equal(summary.glue, 'Glue: 1 package for 1 glued joint.')
  assert.equal(summary.unsized, 1)
  assert.deepEqual(summary.notes, [{ label: 'No rule for this joint type', joints: 1 }, { label: 'Narrow contact surface', joints: 1 }])
  const shown = JSON.stringify(summary)
  for (const hidden of ['_', 'left_rail', 'nailed', 'fastener-rules', 'override', 'no_rule']) assert(!shown.includes(hidden), hidden)
  const mixed = cadFastenerSummary({ annotations: { fasteners: { ...schedule, totals: [{ ...schedule.totals[1], joint_ids: ['left_rail', 'nailed'] }] } } })
  assert.equal(typeof mixed !== 'string' && mixed.rows[0].basis, 'Rule of thumb and chosen')
  const unknownNote = cadFastenerSummary({ annotations: { fasteners: { ...schedule, joints: [{ ...schedule.joints[0], gaps: ['future_code'] }] } } })
  assert.deepEqual(typeof unknownNote !== 'string' && unknownNote.notes, [{ label: 'Other rule note', joints: 1 }])
})

test('a version without a schedule says so; a malformed one is not shown as complete', () => {
  assert.equal(cadFastenerSummary({ annotations: { version: 1, coverage: 'complete', views: {} } }), 'none')
  assert.equal(cadFastenerSummary({}), 'none')
  const schedule = fastenerSchedule()
  for (const fasteners of [null, { ...schedule, totals: 'none' }, { ...schedule, totals: [{ ...schedule.totals[0], kind: 'glue' }] }, { ...schedule, totals: [{ ...schedule.totals[0], count: 2.5 }] }])
    assert.equal(cadFastenerSummary({ annotations: { version: 2, fasteners } }), 'unreadable', JSON.stringify(fasteners).slice(0, 60))
  const empty = cadFastenerSummary({ annotations: { fasteners: { ...schedule, joints: [], totals: [], glue_packages: 0, complete: true } } })
  assert.deepEqual(empty, { rows: [], glue: null, unsized: 0, notes: [] })
})
