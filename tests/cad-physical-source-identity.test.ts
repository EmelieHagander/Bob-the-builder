import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { readPhysicalCadSources, PhysicalCadSourceError, splitDimensionBindings } from '../supabase/functions/_shared/cad-physical-lineage.ts'

const firstId = '30000000-0000-4000-8000-000000000031'
const secondId = '30000000-0000-4000-8000-000000000032'
const spaceId = '30000000-0000-4000-8000-000000000033'
const buildingId = '30000000-0000-4000-8000-000000000034'
const snapshot = { id: firstId, space_id: spaceId, building_id: buildingId, space_revision: 3,
  measurement_id: '30000000-0000-4000-8000-000000000035', measurement_revision: 2,
  value: '1.001', unit: 'm', truth: 'measured', source: 'Accepted physical snapshot' }

function fixture(records: Record<string, unknown>[]) {
  const reads: { dataset: string; id: string | null }[] = []
  const receipts: ReturnType<typeof createProjectLookup>['sources'] = []
  const makeLookup = () => createProjectLookup('destination', async (_project, q) => {
    reads.push({ dataset: q.dataset, id: q.record_id })
    const rows = q.dataset === 'physical_space_measurements'
      ? records.filter(record => record.id === q.record_id)
      : q.dataset === 'physical_spaces'
        ? [{ id: spaceId, building_id: buildingId, revision: 3, archived: false }]
        : q.dataset === 'physical_buildings'
          ? [{ id: buildingId, revision: 1, archived: false }] : []
    return { data: { records: rows, related: [], truncated: false }, error: null }
  }, 1000, 40)
  return { makeLookup, reads, receipts }
}

for (const field of ['space_id', 'building_id'] as const) {
  for (const [label, value] of [['null', null], ['number', 17], ['object', {}], ['malformed string', 'not-a-uuid']] as const) {
    test(`P1b: ${field} as ${label} is a technical source error, never a coerced lookup`, async () => {
      const f = fixture([{ ...snapshot, [field]: value }])
      await assert.rejects(
        readPhysicalCadSources(f.makeLookup, [{ space_measurement_id: firstId, space_revision: 3 }], f.receipts),
        (error: unknown) => error instanceof PhysicalCadSourceError && error.technical
          && error.issues.some(issue => issue.id === firstId && issue.reason === 'invalid_source_identity'),
      )
      assert.deepEqual(f.reads, [{ dataset: 'physical_space_measurements', id: firstId }],
        'do not follow either related identity after the snapshot fails validation')
      assert(f.receipts.some(receipt => receipt.recordId === firstId), 'retain the actual attempted source receipt')
    })
  }
}

test('P1b: valid snapshots preserve exact identities and reuse their shared room/building reads', async () => {
  const second = { ...snapshot, id: secondId }
  const f = fixture([snapshot, second])
  const records = await readPhysicalCadSources(f.makeLookup,
    [{ space_measurement_id: firstId, space_revision: 3 }, { space_measurement_id: secondId, space_revision: 3 }], f.receipts)
  assert.equal(records.size, 2)
  assert.equal(records.get(firstId)?.space_id, spaceId)
  assert.equal(records.get(secondId)?.building_id, buildingId)
  assert.equal(records.get(firstId)?.value, '1.001')
  assert.equal(f.reads.filter(read => read.dataset === 'physical_spaces').length, 1)
  assert.equal(f.reads.filter(read => read.dataset === 'physical_buildings').length, 1)
  assert(!f.reads.some(read => read.dataset === 'measurements'), 'do not reopen the donor project')
})

test('P1b: typed dimension validation retains the runtime allowlist', () => {
  const binding = { definition_id: 'panel', dimension: 'x_mm', space_measurement_id: firstId, space_revision: 3 }
  assert.deepEqual(splitDimensionBindings([binding]).physical, [binding])
  for (const dimension of ['x', 'constructor', null, 1]) {
    assert.throws(() => splitDimensionBindings([{ ...binding, dimension }]), /invalid_dimension_bindings/)
  }
})
