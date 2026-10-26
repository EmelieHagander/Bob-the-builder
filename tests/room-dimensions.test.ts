import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createBuildingContext } from '../src/data/buildingContext.ts'
import { classification } from '../src/data/projectFacts.ts'
import { measurementPropertyLabel } from '../src/lib/labels.ts'
import { roomDimensionsByRoom, roomSize, type RoomDimension } from '../src/lib/roomDimensions.ts'
import { orderRoomMeasurements } from '../src/lib/roomMeasurements.ts'
import { userErrorMessage } from '../src/lib/userErrors.ts'
import { DATASETS, parseLookup, SEARCH_TOOL } from '../supabase/functions/_shared/project-lookup.ts'

// Rendered states (size line, truth, conflicts, failure and retry on the
// Building page and the Area Rooms panel) are proven by
// scripts/check-project-rooms-browser.mjs; the view by room-dimensions-sql.

const value = (mm: string, truth = 'measured') => ({ snapshotId: 's' + mm, measurementId: 'm' + mm, measurementRevision: 1, subject: 'Mått ' + mm,
  value: mm, unit: 'mm', millimetres: mm, truth, source: 'Laser' })
const dim = (property: RoomDimension['property'], status: RoomDimension['status'], millimetres: string | null, truth: string | null, extra: Partial<RoomDimension> = {}): RoomDimension => ({
  spaceId: 'kids', spaceRevision: 2, property, side: null, reference: null, status, truth, millimetres,
  measurements: millimetres ? [value(millimetres, truth ?? 'measured')] : [], ...extra,
})

test('a known room reads as length × width · height with one truth', () => {
  const size = roomSize([dim('room_length', 'known', '3970', 'measured'), dim('room_width', 'known', '2700', 'measured'), dim('ceiling_height', 'known', '1920', 'measured')])
  assert.equal(size.text, '3970 × 2700 mm · height 1920 mm')
  assert.deepEqual(size.truths, ['Measured'])
  assert.deepEqual(size.conflicts, [])
})

test('unknown parts are named and never derived; mixed truths are shown per part', () => {
  assert.equal(roomSize([dim('room_length', 'unknown', null, null), dim('room_width', 'unknown', null, null), dim('ceiling_height', 'unknown', null, null)]).text,
    'Length and width unknown · height unknown')
  assert.equal(roomSize([]).text, 'Length and width unknown · height unknown', 'Missing rows are unknown, not zero')
  const partial = roomSize([dim('room_length', 'known', '3970', 'measured'), dim('room_width', 'unknown', null, null), dim('ceiling_height', 'known', '1920', 'estimated')])
  assert.equal(partial.text, 'Length 3970 mm, width unknown · height 1920 mm')
  assert.deepEqual(partial.truths, ['Length: Measured', 'Height: Estimated'])
  // A local height (with a reference) or a side value is not the room's own size.
  const local = roomSize([dim('room_length', 'known', '3970', 'provided_spec'), dim('room_width', 'known', '2700', 'provided_spec'),
    dim('ceiling_height', 'known', '1950', 'measured', { reference: 'vid fönstret' }), dim('room_width', 'known', '900', 'measured', { side: 'N' })])
  assert.equal(local.text, '3970 × 2700 mm · height unknown')
  assert.deepEqual(local.truths, ['Specification'])
})

test('a conflict names every value at the winning truth', () => {
  const size = roomSize([dim('room_length', 'known', '3970', 'measured'),
    dim('room_width', 'conflict', null, 'measured', { measurements: [value('2700'), value('2710'), value('2710')] }),
    dim('ceiling_height', 'conflict', null, 'provided_spec', { measurements: [value('1900', 'provided_spec'), value('1920', 'provided_spec'), value('1950', 'provided_spec')] })])
  assert.equal(size.text, 'Length 3970 mm, width conflicting · height conflicting')
  assert.deepEqual(size.conflicts, [
    'Width: different measured values, 2700 mm and 2710 mm. Check which is right.',
    'Height: different specification values, 1900 mm, 1920 mm and 1950 mm. Check which is right.',
  ])
  assert.deepEqual(size.truths, ['Measured'])
})

test('dimensions are kept only for the requested room revisions', () => {
  const byRoom = roomDimensionsByRoom([{ id: 'kids', revision: 2 }, { id: 'hall', revision: 1 }], [
    dim('room_length', 'known', '3970', 'measured'), dim('room_length', 'known', '4100', 'estimated', { spaceRevision: 1 }),
    dim('room_width', 'unknown', null, null, { spaceId: 'loft', spaceRevision: 1 }),
  ])
  assert.deepEqual([...byRoom.keys()], ['kids@2'])
  assert.equal(byRoom.get('kids@2')?.length, 1)
  assert.equal(byRoom.get('hall@1'), undefined, 'A room without rows is outside the project, not empty')
})

test('classified measurements are listed first, the rest keep their order', () => {
  const item = (id: string, property: any = null, side: any = null, reference: string | null = null) => ({ id, property, side, reference })
  assert.deepEqual(orderRoomMeasurements([item('garderob'), item('n-window', 'opening_width', 'N'), item('e-door', 'opening_width', 'E'),
    item('local', 'ceiling_height', null, 'vid fönstret'), item('another'), item('height', 'ceiling_height'), item('length', 'room_length'), item('width', 'room_width')]).map(row => row.id),
  ['length', 'width', 'height', 'local', 'n-window', 'e-door', 'garderob', 'another'])
})

test('labels say what a measurement measures; unknown codes stay unclassified', () => {
  assert.equal(measurementPropertyLabel({ property: 'opening_width', side: 'S', reference: 'foder till foder' }), 'Opening width · South side · foder till foder')
  assert.equal(measurementPropertyLabel({ property: 'opening_offset', side: 'W', reference: null }), 'Distance to opening · West side')
  assert.equal(measurementPropertyLabel({ property: null, side: null, reference: null }), null)
  assert.deepEqual(classification({ property: 'room_size', side: 'N', reference: 'x' }), { property: null, side: null, reference: null })
  assert.deepEqual(classification({ property: 'room_width', side: 'NE', reference: '  ' }), { property: 'room_width', side: null, reference: null })
  assert.equal(userErrorMessage({ code: '55000', message: 'measurement_already_classified' }),
    'This measurement already says what it measures. To change that, archive it and add a new measurement.')
  assert.equal(userErrorMessage({ code: '22023', message: 'invalid_measurement_side' }), 'Choose north, east, south or west, or no side.')
})

type Call = { table: string; eq: [string, unknown][]; or?: string; orders: string[]; range?: [number, number] }
function fakeClient(rows: Record<string, unknown>[], fail?: string) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, eq: [], orders: [] }
      calls.push(call)
      const query = {
        select() { return query },
        eq(column: string, value: unknown) { call.eq.push([column, value]); return query },
        or(filter: string) { call.or = filter; return query },
        order(column: string) { call.orders.push(column); return query },
        range(from: number, to: number) { call.range = [from, to]; return query },
        then(resolve: (value: unknown) => unknown) {
          if (fail) return Promise.resolve({ data: null, error: { code: '57014', message: fail } }).then(resolve)
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
      return query
    },
  }
  return { calls, client: client as any }
}
const row = (space: string, revision: number, property: string, status: string, millimetres: string | null) => ({
  project_id: 'P', building_id: 'house', space_id: space, space_revision: revision, space_name: 'Kids room', property, side: null, reference: null,
  status, truth: millimetres ? 'measured' : null, millimetres,
  measurements: millimetres ? [{ snapshot_id: 's', measurement_id: 'm', measurement_revision: 3, subject: 'Rummets exakta längd', value: millimetres, unit: 'mm', millimetres, truth: 'measured', source: 'Laser' }] : [],
})

test('one project-scoped read sizes every listed room', async () => {
  const { client, calls } = fakeClient([row('kids', 2, 'room_length', 'known', '3970'), row('kids', 2, 'room_width', 'unknown', null)])
  const guards: string[] = []
  const byRoom = await createBuildingContext(client, projectId => { guards.push(projectId); return () => {} })
    .dimensions('P', [{ id: 'kids', revision: 2 }, { id: 'hall', revision: 1 }])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].table, 'project_room_dimensions')
  assert.deepEqual(calls[0].eq, [['project_id', 'P']])
  assert.equal(calls[0].or, 'and(space_id.eq."kids",space_revision.eq.2),and(space_id.eq."hall",space_revision.eq.1)')
  assert.deepEqual(guards, ['P'])
  const kids = byRoom.get('kids@2')!
  assert.deepEqual(kids.map(item => [item.property, item.status, item.millimetres]), [['room_length', 'known', '3970'], ['room_width', 'unknown', null]])
  assert.equal(kids[0].measurements[0].measurementRevision, 3)
  assert.equal(roomSize(kids).text, 'Length 3970 mm, width unknown · height unknown')
})

test('a failed size read is an error; another project row is refused; no rooms means no read', async () => {
  await assert.rejects(createBuildingContext(fakeClient([], 'canceling statement').client, () => () => {}).dimensions('P', [{ id: 'kids', revision: 2 }]), { name: 'DataError' })
  await assert.rejects(createBuildingContext(fakeClient([{ ...row('kids', 2, 'room_length', 'known', '1'), project_id: 'Q' }]).client, () => () => {})
    .dimensions('P', [{ id: 'kids', revision: 2 }]), /context mismatch/)
  const { client, calls } = fakeClient([])
  assert.equal((await createBuildingContext(client, () => () => {}).dimensions('P', [])).size, 0)
  assert.equal(calls.length, 0)
})

test("Bob's lookup accepts room_dimensions without Area or status filters", () => {
  const input = { dataset: 'room_dimensions', query: null, status: null, area_id: null, record_id: null, after_id: null }
  assert.deepEqual(parseLookup(input), input)
  assert.equal(parseLookup({ ...input, area_id: 'area-1' }), null)
  assert.equal(parseLookup({ ...input, status: 'done' }), null)
  assert.equal(DATASETS.at(-1), 'room_dimensions')
  const schema = SEARCH_TOOL.function.parameters.properties.dataset as { enum: string[]; description: string }
  assert.ok(schema.enum.includes('room_dimensions'))
  assert.match(schema.description, /room_dimensions gives each room/)
})

test('search v9 is pinned per job; journals without the pin keep v8 (2026-10-26)', async () => {
  const code = await readFile(new URL('../supabase/functions/_shared/ask-openai.ts', import.meta.url), 'utf8')
  const identity = code.slice(code.indexOf("memo('execution:identity'"), code.indexOf('modelBudget = createBobModelBudget'))
  assert.match(identity, /roomDimensionsVersion: 1 as const,/)
  assert.match(code, /let lookupRpc: 'search_bob_project_data_v8' \| 'search_bob_project_data_v9' = 'search_bob_project_data_v8'/)
  assert.match(code, /rpc\(lookupRpc, \{/)
  assert.match(code, /execution\.roomDimensionsVersion !== 1\) throw new Error\('room_dimensions_version_invalid'\)/)
  assert.match(code, /if \(execution\.roomDimensionsVersion === 1\) lookupRpc = 'search_bob_project_data_v9'/)
})
