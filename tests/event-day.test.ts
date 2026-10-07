import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventDayInputValue, formatEventDay, parseEventDay, pickNextEvent, spotsWithTaken } from '../src/lib/eventDay.ts'

const today = new Date(2026, 9, 7) // 7 Oct 2026

test('reads ISO days and authored Swedish or English labels', () => {
  assert.deepEqual(parseEventDay('2026-10-11', today), new Date(2026, 9, 11))
  assert.deepEqual(parseEventDay('Lör 24 okt', today), new Date(2026, 9, 24))
  assert.deepEqual(parseEventDay('Sat 5 Dec', today), new Date(2026, 11, 5))
  assert.equal(parseEventDay('Next weekend', today), null)
  assert.equal(parseEventDay('2026-02-31', today), null)
})

test('a label without a year far in the past means next year', () => {
  assert.deepEqual(parseEventDay('Lör 5 juli', new Date(2027, 0, 20)), new Date(2027, 6, 5))
  assert.deepEqual(parseEventDay('Lör 5 juli', today), new Date(2026, 6, 5))
  assert.deepEqual(parseEventDay('Sat 9 Jan', new Date(2026, 11, 20)), new Date(2027, 0, 9))
})

test('next build day is the soonest upcoming day, not the first created', () => {
  const events = [
    { id: 'past', day: 'Lör 5 juli' },
    { id: 'later', day: '2026-11-01' },
    { id: 'soon', day: '2026-10-10' },
    { id: 'undated', day: 'TBC' },
  ]
  assert.equal(pickNextEvent(events, today)?.id, 'soon')
  assert.equal(pickNextEvent([{ id: 'today', day: '2026-10-07' }], today)?.id, 'today')
  assert.equal(pickNextEvent([events[0], events[3]], today)?.id, 'undated')
  assert.equal(pickNextEvent([events[0]], today), undefined)
})

test('headcount follows the attendee rows and keeps capacity', () => {
  assert.equal(spotsWithTaken('3 / 8', 5), '5 / 8')
  assert.equal(spotsWithTaken('12 / 20', 0), '0 / 20')
  assert.equal(spotsWithTaken('', 2), '2 / 0')
})

test('date picker value and label round-trip', () => {
  assert.equal(eventDayInputValue('Lör 24 okt', today), '2026-10-24')
  assert.equal(eventDayInputValue('TBC', today), '')
  assert.equal(formatEventDay('2026-10-10'), 'Sat 10 Oct')
  assert.equal(formatEventDay('Lör 5 juli'), 'Lör 5 juli')
})
