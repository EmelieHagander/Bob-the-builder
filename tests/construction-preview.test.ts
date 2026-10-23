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
