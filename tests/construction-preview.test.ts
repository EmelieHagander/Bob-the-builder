import { test } from 'node:test'
import assert from 'node:assert/strict'
import { preliminaryConstructionList, preliminaryCutCsv } from '../src/domain/constructionPreview.ts'
import type { ConstructionPreparationSource } from '../src/data/buildPreparation.ts'

function fixture(): ConstructionPreparationSource {
  const draft: ConstructionPreparationSource['draft'] = {
    status: 'ok', projectId: 'p1', artifact_id: '11111111-1111-4111-8111-111111111111',
    revision: 6, current_revision: 6, area_id: 'a_bed', title: 'Säng',
    archived: false, source_state: 'current',
    recipe: {
      definitions: [
        { id: 'frame', primitive: 'box', x_mm: 18, y_mm: 150, z_mm: 1200 },
        { id: 'drawer_proxy', primitive: 'box', x_mm: 12, y_mm: 350, z_mm: 600 },
      ],
      instances: [
        { id: 'front', definition_id: 'frame' },
        { id: 'rear', definition_id: 'frame' },
        { id: 'drawer', definition_id: 'drawer_proxy' },
      ],
    },
    materials: [
      { definition_id: 'frame', material_id: 'mat1', material_revision: 3, part_id: null, part_revision: null },
      { definition_id: 'drawer_proxy', material_id: 'mat2', material_revision: 1, part_id: null, part_revision: null },
    ],
    joints: [], open_questions: ['Fasteners and fit not selected'],
    instance_policy: { version: 1, instances: [
      { instance_id: 'front', role: 'build_part', quantity_policy: 'manufacture', reason: 'build' },
      { instance_id: 'rear', role: 'build_part', quantity_policy: 'manufacture', reason: 'build' },
      { instance_id: 'drawer', role: 'reference', quantity_policy: 'exclude', reason: 'placeholder only' },
    ] },
  }
  const catalog = new Map<string, Record<string, any>>([
    ['mat1@3', { item_id: 'mat1', revision: 3, name: 'Plywood 18 mm', properties: { thickness: { value: '18' } } }],
    ['mat2@1', { item_id: 'mat2', revision: 1, name: 'Model-only proxy', properties: { thickness: { value: '12' } } }],
  ])
  return { draft, catalog }
}

test('preliminary list shares canonical role-aware blank arithmetic and excludes references', () => {
  const output = preliminaryConstructionList(fixture())
  assert.equal(output.status, 'preliminary')
  if (output.status !== 'preliminary') return
  assert.equal(output.partCount, 2)
  assert.equal(output.referenceCount, 1)
  assert.equal(output.parts.length, 1)
  assert.deepEqual(output.parts[0].partLabels, ['P1', 'P2'])
  assert.equal(output.parts[0].quantity, 2)
  assert.equal(output.parts[0].materialName, 'Plywood 18 mm')
  assert.deepEqual(output.parts[0].dimensions, { x: 18, y: 150, z: 1200 })
  assert.deepEqual(output.questions, ['Fasteners and fit not selected'])
  const csv = preliminaryCutCsv(output)
  assert.match(csv, /PRELIMINARY ONLY - NOT APPROVED FOR CUTTING/)
  assert.match(csv, /frame/)
  assert.doesNotMatch(csv, /drawer_proxy/)
})

test('stale draft revision, changed sources or archive never yield cut dimensions', () => {
  for (const change of [
    (source: ConstructionPreparationSource) => { source.draft.current_revision++ },
    (source: ConstructionPreparationSource) => { source.draft.source_state = 'changed' },
    (source: ConstructionPreparationSource) => { source.draft.archived = true },
    (source: ConstructionPreparationSource) => { source.draft.source_state = 'unavailable' },
  ]) {
    const source = fixture()
    change(source)
    const result = preliminaryConstructionList(source)
    assert.equal(result.status, 'changed')
    assert.equal('parts' in result, false)
  }
})

test('unknown instance roles, missing pinned material or malformed blank reject the whole list', () => {
  const sources = [fixture(), fixture(), fixture(), fixture()]
  sources[0].draft.instance_policy = null
  sources[1].catalog.delete('mat1@3')
  sources[2].draft.recipe.definitions[0].x_mm = 'not-a-length'
  sources[3].draft.instance_policy = { version: 1, instances: [] }
  for (const source of sources) {
    const result = preliminaryConstructionList(source)
    assert.equal(result.status, 'needs_data')
    assert.equal('parts' in result, false)
  }
})

test('CSV quotes spreadsheet formula-like material labels', () => {
  const source = fixture()
  source.catalog.get('mat1@3')!.name = '=HYPERLINK("https://example.invalid")'
  const result = preliminaryConstructionList(source)
  assert.equal(result.status, 'preliminary')
  if (result.status !== 'preliminary') return
  assert.match(preliminaryCutCsv(result), /"'=HYPERLINK/)
})

test('fastener schedule: exact server counts are parsed strictly and appended to the CSV without waste', async () => {
  const { parseConstructionFasteners } = await import('../src/data/buildPreparation.ts')
  const artifact = '11111111-1111-4111-8111-111111111111'
  const joint = (id: string, extra: Record<string, unknown> = {}) => ({ joint_id: id, source: 'rule', kind: 'screw', diameter_mm: 4, length_mm: 45, count: 3, gaps: [], ...extra })
  const schedule = { status: 'ok', artifact_id: artifact, revision: 6, rule_version: 'fastener-rules-v1', complete: false, glue_packages: 1,
    totals: [{ kind: 'screw', diameter_mm: 4, length_mm: 45, count: 6, joint_ids: ['j1', 'j2'] }],
    joints: [joint('j1'), joint('j2', { gaps: ['narrow_contact'] }), joint('j3', { source: 'no_rule', kind: null, count: null, gaps: ['no_rule_for_method'] }),
      joint('j4', { source: 'existing', kind: null, diameter_mm: null, length_mm: null, count: null })] }
  const parsed = parseConstructionFasteners(schedule, artifact, 6)
  assert.deepEqual(parsed, { complete: false, totals: [{ kind: 'screw', diameterMm: 4, lengthMm: 45, count: 6, joints: 2 }], gluePackages: 1, unsizedJoints: 1, flaggedJoints: 1 })
  // Another revision, another rule version or a malformed total is never shown as a count.
  assert.equal(parseConstructionFasteners(schedule, artifact, 7), null)
  assert.equal(parseConstructionFasteners({ ...schedule, rule_version: 'fastener-rules-v2' }, artifact, 6), null)
  assert.equal(parseConstructionFasteners({ ...schedule, totals: [{ ...schedule.totals[0], count: 2.5 }] }, artifact, 6), null)
  assert.equal(parseConstructionFasteners({ status: 'not_found' }, artifact, 6), null)
  // Chosen catalog items (2026-11-01): one row per item; an unchosen joint is not counted, not a warning.
  const chosen = { ...schedule, joints: [joint('c1', { source: 'chosen' }), joint('c1', { source: 'chosen', kind: 'glue', diameter_mm: null, length_mm: null, count: null, gaps: ['narrow_contact'] }),
    joint('c2', { source: 'none', kind: null, diameter_mm: null, length_mm: null, count: null, gaps: ['no_fastener_chosen'] }),
    joint('c3', { source: 'chosen', kind: 'bracket', diameter_mm: null, length_mm: null, count: null, gaps: ['count_unknown'] })] }
  assert.deepEqual([parseConstructionFasteners(chosen, artifact, 6)?.unsizedJoints, parseConstructionFasteners(chosen, artifact, 6)?.flaggedJoints], [2, 1])
  const list = preliminaryConstructionList(fixture())
  assert.equal(list.status, 'preliminary')
  if (list.status !== 'preliminary') return
  const plain = preliminaryCutCsv(list), withFasteners = preliminaryCutCsv(list, parsed)
  assert(withFasteners.startsWith(plain), 'parts rows are unchanged')
  assert.match(withFasteners, /"Fasteners - exact count from the saved joints, no waste added, not a strength calculation"/)
  assert.match(withFasteners, /"screw","4","45","6","2"/)
  assert.match(withFasteners, /"Glue packages","1"/)
  assert.match(withFasteners, /"Not counted","1 joint has no fastener rule or size yet"/)
})
