import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storageBoxGeometry, storageBoxSvg, storageBoxCutCsv, formatDrawingMm, type StorageBoxRecipe } from '../src/lib/storageBox.ts'
import { parseProjectWrite, createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { isBobAnswerEvidence } from '../src/data/bobEvidence.ts'

const recipe: StorageBoxRecipe = { generator: 'storage_box_v1', version: 1, width_mm: 800, height_mm: 350, depth_mm: 600, thickness_mm: 18 }
const id = '30000000-0000-4000-8000-000000000001'
const args = { record_id: null, create_area_id: 'areaA', expected_revision: 0, target_revision: 1,
  title: 'Storage box', description: 'Open-top box', assumptions: 'Proposed dimensions; site fit unverified.',
  width_mm: 800, height_mm: 350, depth_mm: 600, thickness_mm: 18, measurements: [], change_note: 'Chosen design', request_quote: 'Rita lådan' }

test('one immutable recipe drives external/internal dimensions and every finished part', () => {
  const source = structuredClone(recipe)
  const g = storageBoxGeometry(source)
  assert.deepEqual([g.innerWidthMm, g.innerHeightMm, g.innerDepthMm], [764, 332, 564])
  assert.deepEqual(g.parts.map(p => [p.id, p.count, p.lengthMm, p.widthMm, p.thicknessMm]),
    [['B1', 1, 800, 600, 18], ['S1', 2, 600, 332, 18], ['F1', 2, 764, 332, 18]])
  assert.deepEqual(source, recipe)
  assert.notEqual(source, g.recipe)
  g.recipe.width_mm = 900
  assert.equal(source.width_mm, 800)
  assert.match(storageBoxCutCsv(recipe), /F1,Front \/ back,2,764,332,18/)
})

test('decimal dimensions use integer micrometres without binary floating-point cut errors', () => {
  const g = storageBoxGeometry({ ...recipe, width_mm: 800.001, height_mm: 350.004, thickness_mm: 18.003 })
  assert.equal(g.innerWidthMm, 763.995)
  assert.equal(g.innerHeightMm, 332.001)
  for (const n of [0, 10, 800, 800.001, 0.001, 18.5]) assert.equal(Number(formatDrawingMm(n)), n)
  for (let i = 1; i <= 250; i++) {
    const w = 800000 + i, h = 350000 + i, d = 600000 + i, t = 18000 + i
    const actual = storageBoxGeometry({ ...recipe, width_mm: w / 1000, height_mm: h / 1000, depth_mm: d / 1000, thickness_mm: t / 1000 })
    assert.equal(actual.innerWidthMm, (w - 2 * t) / 1000)
    assert.equal(actual.parts[0].lengthMm, w / 1000)
    assert.equal(actual.parts[2].widthMm, (h - t) / 1000)
  }
})

test('malformed, unknown-version, non-numeric and impossible recipes fail closed', () => {
  for (const bad of [null, [], {}, { ...recipe, generator: 'freeform' }, { ...recipe, version: 2 }, { ...recipe, svg: '<script/>' },
    { ...recipe, width_mm: '800' }, { ...recipe, height_mm: NaN }, { ...recipe, depth_mm: Infinity }, { ...recipe, width_mm: 0 },
    { ...recipe, thickness_mm: -18 }, { ...recipe, width_mm: 36 }, { ...recipe, depth_mm: 35 }, { ...recipe, height_mm: 18 },
    { ...recipe, width_mm: 10000.001 }, { ...recipe, thickness_mm: 100.001 }, { ...recipe, width_mm: 800.0001 }]) {
    assert.throws(() => storageBoxGeometry(bad))
  }
})

test('vector exports preserve revision, written dimensions and assembly and cannot inject markup', () => {
  const stamp = { title: 'Box </text><script>alert(1)</script>', artifactId: id, revision: 3, status: 'Concept' }
  for (const view of ['front', 'plan', 'section'] as const) {
    const svg = storageBoxSvg(recipe, view, stamp)
    assert.equal(svg, storageBoxSvg(JSON.parse(JSON.stringify(recipe)), view, stamp))
    assert.match(svg, /Revision 3/); assert.match(svg, /NOT TO SCALE/); assert.match(svg, /Design specification/)
    assert.match(svg, /storage_box_v1 \/ 1/); assert.match(svg, /18 mm thick/)
    assert.doesNotMatch(svg, /<script|NaN|Infinity|onload=/)
    assert.match(svg, /&lt;script&gt;/)
  }
  assert.match(storageBoxSvg(recipe, 'front', stamp), /F1 width 764/)
  assert.match(storageBoxSvg(recipe, 'plan', stamp), /Inside 564/)
  assert.match(storageBoxSvg(recipe, 'section', stamp), /Inside height 332/)
  assert.match(storageBoxSvg(recipe, 'plan', { title: 'Preview' }), /UNSAVED PREVIEW/)
  assert.throws(() => storageBoxSvg(recipe, 'perspective' as any, stamp))
})

test('a height-only edit updates dependent parts in all views, never the previous recipe or footprint', () => {
  const before = storageBoxSvg(recipe, 'front', { title: 'Box', revision: 1 })
  const next = { ...recipe, height_mm: 300 }
  const g = storageBoxGeometry(next)
  assert.equal(g.innerHeightMm, 282)
  assert.deepEqual(g.parts[0], storageBoxGeometry(recipe).parts[0])
  assert.equal(g.parts[1].widthMm, 282); assert.equal(g.parts[2].widthMm, 282)
  assert.equal(before, storageBoxSvg(recipe, 'front', { title: 'Box', revision: 1 }))
  assert.match(storageBoxSvg(next, 'section', { title: 'Box', revision: 2 }), /Inside height 282/)
})

test('drawing tool parses a scoped full recipe, not SQL, arbitrary SVG, status or a building measurement write', () => {
  const p = parseProjectWrite('save_project_drawing', args, 'A', 'Rita lådan')!
  assert.equal(p.kind, 'drawing'); assert.deepEqual(p.data.recipe, recipe); assert.equal(p.expected_revision, 0)
  assert.equal(p.data.status, undefined); assert.equal(p.data.area_id, 'areaA')
  for (const edit of [{ project_id: 'B' }, { status: 'build_ready' }, { width_mm: '800' }, { height_mm: 18 }, { thickness_mm: 100.1 },
    { record_id: id, create_area_id: 'areaA', expected_revision: 1 }, { record_id: 'fake' }, { target_revision: 0 },
    { measurements: [{ id, revision: 0 }] }, { measurements: [{ id, revision: 1 }, { id: id.toUpperCase(), revision: 1 }] },
    { measurements: [{ id, revision: 1, source: 'invented' }] }, { request_quote: 'Prior message' }, { assumptions: '' }]) {
    assert.equal(parseProjectWrite('save_project_drawing', { ...args, ...edit }, 'A', 'Rita lådan'), null)
  }
  const edited = parseProjectWrite('save_project_drawing', { ...args, record_id: id, create_area_id: null, expected_revision: 2, height_mm: 300 }, 'A', 'Rita lådan')!
  assert.equal(edited.data.area_id, undefined); assert.equal(edited.data.change_note, args.change_note)
})

test('caller-scoped research derives the same parts from the saved recipe and preserves the source revision', async () => {
  const lookup = createProjectLookup('A', async () => ({ data: { records: [{ id, title: 'Box', revision: 2, parametric_recipe: recipe }], related: [], truncated: false }, error: null }))
  const result = await lookup.search({ dataset: 'artifacts', query: null, area_id: null, record_id: id, status: null, after_id: null })
  assert.equal(result.status, 'ok'); assert.equal(result.records[0].revision, 2)
  const derived = result.records[0].derived_drawing as any
  assert.equal(derived.truth, 'provided_spec'); assert.deepEqual(derived.finished_parts, storageBoxGeometry(recipe).parts)
  assert.equal(result.truth, 'unknown', 'a numerical recipe must not promote project evidence')
})

test('a drawing receipt restores exact-revision navigation; mismatches fail closed and uncertain saves are not retried', async () => {
  const receipt = { projectId: 'A', dataset: 'artifacts', recordId: id, label: 'Storage box', operation: 'created', savedAt: '2026-09-18T10:00:00Z',
    revision: 1, areaId: 'areaA', record: { id, revision: 1, area_id: 'areaA', recipe } }
  const evidence = { kind: 'ai_assessment', sources: [], partial: false, writes: [receipt] }
  assert(isBobAnswerEvidence(evidence, 'A'))
  for (const change of [{ revision: undefined }, { revision: 0 }, { revision: 1.5 }, { areaId: undefined }, { recordId: 'invalid' }, { projectId: 'B' }]) {
    assert(!isBobAnswerEvidence({ ...evidence, writes: [{ ...receipt, ...change }] }, 'A'))
  }
  let calls = 0
  const writer = createProjectWriter('A', 'Rita lådan', async () => { calls++; return { data: { ...receipt, record: { ...receipt.record, revision: 2 } }, error: null } },
    async () => ({ data: [receipt], error: null }), async () => ({ data: { generation: 2, receipts: [receipt] }, error: null }))
  assert.equal((await writer.write('save_project_drawing', args)).status, 'unknown')
  assert.equal((await writer.write('save_project_drawing', args)).status, 'unknown'); assert.equal(calls, 1)
  assert.equal(await writer.settle(), 2); assert.equal(writer.receipts[0].revision, 1)
})
