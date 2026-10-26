import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conceptFixture } from './support/solution-concept-fixtures.ts'
import { conceptConstructionIssues, conceptSvg, conceptView, evaluateConcept, parseConceptModel } from '../supabase/functions/_shared/solution-concept.ts'
import { applyProjectDelta, type EditSnapshot } from '../supabase/functions/_shared/project-edits.ts'
import { designIntentHandoff, parseDesignIntent } from '../supabase/functions/_shared/project-design-intent.ts'
import { handoff } from './support/cad-review-fixture.ts'

const snapshot = (kind: 'box' | 'bed' | 'barn'): EditSnapshot => ({ project_id: 'A', key: 'candidate', resource: 'solutions', scope_label: 'Project', measurements: [], target: null,
  record: { title: 'Concept', description: 'Synthetic early design', assumptions: '', tradeoffs: '', design_intent: conceptFixture(kind) } })
const set = (path: string, value: unknown) => ({ op: 'set', path, value_json: JSON.stringify(value) })

for (const kind of ['box', 'bed', 'barn'] as const) test(`${kind}: same model produces deterministic plan/profile and survives serialization`, () => {
  const intent = conceptFixture(kind)
  assert(parseDesignIntent(intent)); assert(parseConceptModel(intent.model))
  const read = parseDesignIntent(JSON.parse(JSON.stringify(intent)))!
  for (const view of intent.model.views) assert.equal(conceptSvg(intent, view.id), conceptSvg(read, view.id))
  const plan = conceptView(read, 'plan'), profile = conceptView(read, 'profile')
  for (const shape of profile.shapes) assert.equal(shape.width, plan.shapes.find(s => s.id === shape.id)!.width)
})

test('box: changing height retains IDs and unrelated bottom; changing wall thickness recomputes placement', async () => {
  const s = snapshot('box'), before = evaluateConcept(s.record.design_intent)
  const h = s.record.design_intent.model.nodes.findIndex((n: any) => n.id === 'height')
  const next = await applyProjectDelta(s, [set(`/design_intent/model/nodes/${h}/value`, 450)], 'Raise the walls')
  assert.deepEqual(evaluateConcept(next.design_intent).boxes[0], before.boxes[0])
  assert.equal(conceptView(next.design_intent, 'profile').shapes.find(s => s.id === 'front')!.height, 450)
  const w = s.record.design_intent.model.nodes.findIndex((n: any) => n.id === 'wall')
  const thick = await applyProjectDelta(s, [set(`/design_intent/model/nodes/${w}/value`, 25)], 'Thicker walls')
  assert.equal(evaluateConcept(thick.design_intent).boxes.find(b => b.id === 'back')!.min[1], 375)
  assert.equal(thick.design_intent.alignment.status, 'draft')
})

test('bed: targeted ladder correction preserves drawers and features; wrong side is detected', async () => {
  const s = snapshot('bed'), ix = s.record.design_intent.model.nodes.findIndex((n: any) => n.id === 'ladder_x')
  const changes = [set(`/design_intent/model/nodes/${ix}/value`, 100)]
  const next = await applyProjectDelta(s, changes, 'Move the ladder closer')
  assert.deepEqual(next, await applyProjectDelta(s, changes, 'Move the ladder closer'))
  const a = evaluateConcept(s.record.design_intent), b = evaluateConcept(next.design_intent)
  assert.deepEqual(a.boxes.find(b => b.id === 'drawer'), b.boxes.find(b => b.id === 'drawer'))
  assert.deepEqual(next.design_intent.features, s.record.design_intent.features)
  assert.deepEqual(b.issues, [])
  next.design_intent.model.nodes.find((n: any) => n.id === 'ladder_y').value = 860
  assert(evaluateConcept(next.design_intent).issues.some(i => i.code === 'constraint_conflict'))
  next.design_intent.model.components.find((c: any) => c.id === 'drawer').active = false
  assert(evaluateConcept(next.design_intent).issues.some(i => i.code === 'feature_missing' && i.ids.includes('drawer_storage')))
})

test('barn: three rooms along X, closed end lofts, actual named slice filters ladders/windows, impossible height remains', () => {
  const intent = conceptFixture('barn'), section = conceptView(intent, 'profile'), wall = conceptView(intent, 'wall_section')
  assert.deepEqual(section.axes, [0, 2, 1]); assert.equal(section.at, 1500)
  assert.deepEqual(section.shapes.filter(s => ['first', 'middle', 'last'].includes(s.id)).map(s => s.x), [0, 2000, 4000])
  assert.equal(section.shapes.filter(s => s.id.endsWith('_loft')).length, 2)
  assert.equal(section.shapes.filter(s => s.id.endsWith('_ceiling')).length, 2)
  assert.equal(section.shapes.filter(s => /ladder|window/.test(s.id)).length, 0)
  assert.equal(wall.shapes.filter(s => /ladder|window/.test(s.id)).length, 4)
  assert(section.issues.some(i => i.code === 'constraint_conflict' && i.ids.includes('height_stack')))
  assert(section.issues.some(i => i.code === 'unsupported' && i.message.includes('Pitched roof')))
  intent.model.views[1].plane = 'YZ'
  assert(evaluateConcept(intent).issues.some(i => i.code === 'view_plane_conflict'))
  assert.equal(conceptView(intent, 'profile').shapes.filter(s => ['first', 'middle', 'last'].includes(s.id)).length, 1)
  assert.match(conceptSvg(intent, 'profile'), /YZ principle section at X = 1500/)
})

test('unknowns, missing features, cycles, units and unsupported shapes cannot become known geometry', () => {
  const intent = conceptFixture('box')
  intent.model.nodes[1] = { id: 'length', role: 'unknown', unit: 'mm', reason: 'Length not supplied' }
  assert.equal(evaluateConcept(intent).boxes.length, 0)
  assert.match(conceptSvg(intent, 'plan'), /not measured/)
  intent.features.push({ id: 'missing', description: 'Required lid', basis: 'user_request', source_ref: null })
  assert(evaluateConcept(intent).issues.some(i => i.code === 'feature_missing'))
  assert.equal(parseConceptModel({ ...intent.model, rotation: 45 }), null)
  const cycle = conceptFixture('box'); cycle.model.nodes[1] = { id: 'length', role: 'derived', operation: 'add_v1', operands: ['length', 'zero'], rounding: 'exact' }
  assert(evaluateConcept(cycle).issues.some(i => i.code === 'parameter_unresolved'))
  const unit = conceptFixture('box'); (unit.model.nodes[1] as any).unit = 'scalar'
  assert(evaluateConcept(unit).issues.some(i => i.code === 'component_unresolved'))
  const empty = conceptFixture('box'); empty.features = []; empty.choices = []
  empty.model.components.forEach(c => { c.active = false; c.features = []; c.choices = [] })
  assert(evaluateConcept(empty).issues.some(i => i.code === 'empty_model'))
  const malformed = conceptFixture('box'); (malformed.model.constraints as unknown[]).push(null)
  assert.equal(parseConceptModel(malformed.model), null)
})

test('CAD receives the selected concept frame, even if the caller describes different axes', () => {
  const intent = conceptFixture('barn')
  const result = designIntentHandoff(handoff, intent, { version: 1, project_id: 'A', area_id: null, target_revision: 3, solution_id: 'selected', solution_revision: 2, purpose: 'construction' })
  assert.deepEqual(result.coordinates, { origin: intent.model.frame.origin, positive_x: intent.model.frame.x, positive_y: intent.model.frame.y, positive_z: intent.model.frame.z })
  assert.notDeepEqual(result.coordinates, handoff.coordinates)
  assert(result.requirements.some(r => r.id === 'intent_fixture_form'))
})

test('component identity replacement and arbitrary executable/markup content are rejected or escaped', async () => {
  for (const path of ['/design_intent/model', '/design_intent/model/components/0/id', '/design_intent/model/components', '/design_intent/model/components/0'])
    await assert.rejects(applyProjectDelta(snapshot('box'), [set(path, {})], 'Replace'))
  const intent = conceptFixture('box'); intent.model.views[0].label = '<script>alert(1)</script>'
  const svg = conceptSvg(intent, 'plan'); assert(!svg.includes('<script>')); assert(svg.includes('&lt;script&gt;'))
})

test('construction handoff keeps exact component dimensions; changed, missing or unsupported pieces fail', () => {
  const intent = conceptFixture('box'), boxes = evaluateConcept(intent).boxes
  const recipe: any = { contract_version: 1, units: 'mm', assembly_id: 'test', views: ['top', 'front'],
    definitions: boxes.map(b => ({ id: b.id, primitive: 'box', material_ref: null, x_mm: b.size_mm[0], y_mm: b.size_mm[1], z_mm: b.size_mm[2] })),
    instances: boxes.map(b => ({ id: b.id, definition_id: b.id, placement: { x: b.min[0], y: b.min[1], z: b.min[2], rx: 0, ry: 0, rz: 0 } })) }
  assert.deepEqual(conceptConstructionIssues(intent, recipe, new Set()), [])
  recipe.instances[1].placement.x = 1; assert.equal(conceptConstructionIssues(intent, recipe, new Set())[0].code, 'concept_geometry_changed')
  recipe.instances[1].placement.rx = 45; assert.equal(conceptConstructionIssues(intent, recipe, new Set())[0].code, 'concept_mapping_unsupported')
  recipe.instances.pop(); assert(conceptConstructionIssues(intent, recipe, new Set()).some(i => i.code === 'concept_part_missing'))
})
