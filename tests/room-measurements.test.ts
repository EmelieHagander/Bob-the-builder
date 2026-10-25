import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBuildingContext, type SpaceMeasurementSnapshot } from '../src/data/buildingContext.ts'
import {
  currentRoomMeasurements, measurementKey, measurementValue, physicalTruthLabel, roomRevisionFilter,
} from '../src/lib/roomMeasurements.ts'

// Rendered states (rows, Show all, source, empty, failure and retry on the
// Building page and the Area Rooms panel) are proven by
// scripts/check-project-rooms-browser.mjs.

const snapshot = (row: Partial<SpaceMeasurementSnapshot>): SpaceMeasurementSnapshot => ({
  id: 'm', spaceId: 'kids', buildingId: 'house', spaceRevision: 2, sourceProjectId: 'P', measurementId: 'mid',
  measurementRevision: 1, subject: 'Rummets exakta längd', value: '3970', unit: 'mm', truth: 'measured', source: 'Laser', ...row,
})

test('truth labels are human and never upgrade an unrecognised class', () => {
  assert.equal(physicalTruthLabel('measured'), 'Measured')
  assert.equal(physicalTruthLabel('provided_spec'), 'Specification')
  assert.equal(physicalTruthLabel('estimated'), 'Estimated')
  assert.equal(physicalTruthLabel('unknown'), 'Unknown')
  assert.equal(physicalTruthLabel('ai_assessment'), 'AI assessment')
  assert.equal(physicalTruthLabel('surveyed'), 'Unknown')
})

test('values are shown as saved and a missing value is never invented', () => {
  assert.equal(measurementValue({ value: '3970', unit: 'mm' }), '3970 mm')
  assert.equal(measurementValue({ value: '2.5', unit: 'm' }), '2.5 m')
  assert.equal(measurementValue({ value: null, unit: 'mm' }), 'Not measured yet')
})

test('only snapshots of the shown room revision are current', () => {
  const rooms = [{ id: 'kids', revision: 2 }, { id: 'landing', revision: 1 }]
  const byRoom = currentRoomMeasurements(rooms, [
    snapshot({ id: 'old', spaceRevision: 1, subject: 'Old length', value: '4100' }),
    snapshot({ id: 'a', subject: 'N-sida: fönster karm-till-karm', value: '1030' }),
    snapshot({ id: 'b', subject: 'Rummets exakta bredd', value: '2700' }),
    snapshot({ id: 'b', subject: 'Rummets exakta bredd', value: '2700' }),
    snapshot({ id: 'other', spaceId: 'kitchen', spaceRevision: 1 }),
  ])
  assert.deepEqual(byRoom.get(measurementKey({ id: 'kids', revision: 2 }))?.map(item => item.id), ['a', 'b'],
    'Older revisions, duplicates and unrequested rooms are dropped; read order is kept')
  assert.deepEqual(byRoom.get(measurementKey({ id: 'landing', revision: 1 })), [], 'A room read without snapshots is a real empty')
  assert.equal(byRoom.get(measurementKey({ id: 'kids', revision: 1 })), undefined, 'An older revision is not an answer for the current one')
  assert.equal(byRoom.size, 2)
})

test('the exact-revision filter is quoted, de-duplicated and skips unusable revisions', () => {
  assert.equal(roomRevisionFilter([{ id: 'kids', revision: 2 }, { id: 'kids', revision: 2 }, { id: 'bad', revision: 0 }, { id: 'hall', revision: 1 }]),
    'and(space_id.eq."kids",space_revision.eq.2),and(space_id.eq."hall",space_revision.eq.1)')
})

type Call = { table: string; or?: string; orders: string[]; range?: [number, number] }
function fakeClient(rows: Record<string, unknown>[], options: { fail?: string } = {}) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, orders: [] }
      calls.push(call)
      const query = {
        select() { return query },
        or(filter: string) { call.or = filter; return query },
        order(column: string) { call.orders.push(column); return query },
        range(from: number, to: number) { call.range = [from, to]; return query },
        then(resolve: (value: unknown) => unknown) {
          if (options.fail) return Promise.resolve({ data: null, error: { message: options.fail } }).then(resolve)
          const wanted = [...(call.or ?? '').matchAll(/space_id\.eq\."([^"]+)",space_revision\.eq\.(\d+)/g)].map(match => `${match[1]}@${match[2]}`)
          const matching = rows.filter(row => wanted.includes(`${row.space_id}@${row.space_revision}`))
          const [from, to] = call.range ?? [0, matching.length]
          return Promise.resolve({ data: matching.slice(from, to + 1), error: null }).then(resolve)
        },
      }
      return query
    },
  }
  return { calls, client: client as any }
}
const row = (id: string, space: string, revision: number, subject: string, value: number | null) => ({
  id, space_id: space, building_id: 'house', space_revision: revision, source_project_id: 'P', measurement_id: 'm-' + id,
  measurement_revision: 3, subject, value, unit: 'mm', truth: value === null ? 'unknown' : 'measured', source: 'Laser, 2026-10-12',
})

test('one read covers every listed room at its exact revision', async () => {
  const { client, calls } = fakeClient([
    row('1', 'kids', 2, 'Rummets exakta längd', 3970), row('2', 'kids', 2, 'Takhöjd', null),
    row('3', 'kids', 1, 'Old length', 4100), row('4', 'hall', 1, 'Bredd', 1200),
  ])
  const guards: string[] = []
  const context = createBuildingContext(client, projectId => { guards.push(projectId); return () => {} })
  const byRoom = await context.measurements('P', [{ id: 'kids', revision: 2 }, { id: 'hall', revision: 1 }, { id: 'loft', revision: 4 }])
  assert.equal(calls.length, 1, 'Not one read per room')
  assert.equal(calls[0].table, 'space_measurement_details')
  assert.deepEqual(calls[0].orders, ['space_id', 'subject', 'id'])
  assert.deepEqual(guards, ['P'], 'Explicit project context is captured')
  const kids = byRoom.get('kids@2') ?? []
  assert.deepEqual(kids.map(item => [item.subject, item.value, item.truth]), [['Rummets exakta längd', '3970', 'measured'], ['Takhöjd', null, 'unknown']])
  assert.equal(kids[0].measurementRevision, 3)
  assert.equal(kids[0].source, 'Laser, 2026-10-12')
  assert.deepEqual(byRoom.get('loft@4'), [])
})

test('large reads follow every page and split very long room lists', async () => {
  const many = Array.from({ length: 501 }, (_, index) => row(`p${index}`, 'kids', 2, `Mått ${index}`, index))
  let { client, calls } = fakeClient(many)
  const byRoom = await createBuildingContext(client, () => () => {}).measurements('P', [{ id: 'kids', revision: 2 }])
  assert.equal(byRoom.get('kids@2')?.length, 501, 'A full page is followed, not treated as everything')
  assert.deepEqual(calls.map(call => call.range), [[0, 499], [500, 999]])

  ;({ client, calls } = fakeClient([]))
  const rooms = Array.from({ length: 41 }, (_, index) => ({ id: `r${index}`, revision: 1 }))
  const empty = await createBuildingContext(client, () => () => {}).measurements('P', rooms)
  assert.equal(calls.length, 2, 'Room filters stay short enough for a URL')
  assert.equal(empty.size, 41)
})

test('a failed read is an error, never an empty answer', async () => {
  const { client } = fakeClient([], { fail: 'Measurements unavailable' })
  await assert.rejects(createBuildingContext(client, () => () => {}).measurements('P', [{ id: 'kids', revision: 2 }]), /Measurements unavailable/)
  const { client: idle, calls } = fakeClient([])
  assert.equal((await createBuildingContext(idle, () => () => {}).measurements('P', [])).size, 0)
  assert.equal(calls.length, 0, 'No rooms, no read')
})
