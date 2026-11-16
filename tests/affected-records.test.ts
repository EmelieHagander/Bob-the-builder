import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constructionAffected, createConstructionViews, namedConstructionIds } from '../supabase/functions/_shared/construction-views.ts'
import { affectedSubject } from '../supabase/functions/_shared/construction-draft.ts'
import { compactConstructionCheck } from '../supabase/functions/_shared/write-state.ts'

// Audit 2026-11-16 (point 2): 31 % of all tool calls were construction reads,
// many of them looking up what a refusal or a check had just named.
const draft = () => ({ projectId: 'p', status: 'ok', artifact_id: 'a1', revision: 7,
  recipe: {
    definitions: [{ id: 'post', primitive: 'box', x_mm: 45, y_mm: 95, z_mm: 1800 }, { id: 'rail', primitive: 'box', x_mm: 1600, y_mm: 45, z_mm: 95 }],
    instances: [{ id: 'post_1', definition_id: 'post', position: { x: 0, y: 0, z: 0 } }, { id: 'post_2', definition_id: 'post', position: { x: 1555, y: 0, z: 0 } },
      { id: 'rail_1', definition_id: 'rail', position: { x: 0, y: 95, z: 900 } }, { id: 'rail_2', definition_id: 'rail', position: { x: 0, y: 95, z: 1700 } }] },
  parameters: { nodes: [{ id: 'width', role: 'decision', value: 1600, unit: 'mm' }], bindings: [{ path: 'definitions/rail/x_mm', node: 'width' }] },
  joints: [{ id: 'j1', method: 'butt', first: { instance_id: 'post_1', face: 'y+' }, second: { instance_id: 'rail_1', face: 'y-' } },
    { id: 'j2', method: 'butt', first: { instance_id: 'post_2', face: 'y+' }, second: { instance_id: 'rail_1', face: 'y-' } },
    { id: 'j3', method: 'butt', first: { instance_id: 'post_1', face: 'y+' }, second: { instance_id: 'rail_2', face: 'y-' } }] })

test('names are read from ID-bearing keys and slash paths, never from prose or echoed work', () => {
  const names = namedConstructionIds({ status: 'invalid', message: 'post_2 is wrong', issues: [{ code: 'joint_endpoint_missing', path: 'joints/j2/first/instance_id' }, { code: 'collision', ids: ['rail_1'] }],
    unused_nodes: ['spare'], sketch: { ids: ['rail_2'] } })
  assert.deepEqual(names.sort(), ['j2', 'joints/j2/first/instance_id', 'rail_1', 'spare'])
})

test('a named part comes with its definition and joints; a named joint with both parts', () => {
  const a: any = constructionAffected(draft(), ['rail_2', 'unknown'])
  assert.equal(a.revision, 7)
  assert.deepEqual(a.records.instances.map((r: any) => r.id), ['rail_2', 'post_1'], 'the joint pulls in the part at its other end')
  assert.deepEqual(a.records.joints.map((r: any) => r.id), ['j3'])
  assert.deepEqual(a.records.definitions.map((r: any) => r.id).sort(), ['post', 'rail'])
  const j: any = constructionAffected(draft(), ['j2'])
  assert.deepEqual(j.records.joints.map((r: any) => r.id), ['j2']); assert.deepEqual(j.records.instances.map((r: any) => r.id), ['post_2', 'rail_1'])
  const n: any = constructionAffected(draft(), ['width'])
  assert.deepEqual(n.records.nodes.map((r: any) => r.id), ['width']); assert.deepEqual(n.records.bindings, [{ path: 'definitions/rail/x_mm', node: 'width' }])
  assert.equal(constructionAffected(draft(), ['roof', 'nothing']), null, 'IDs the draft does not hold add nothing')
})

test('what does not fit the budget is listed by the view that opens it', () => {
  const big = draft()
  big.joints = Array.from({ length: 300 }, (_, i) => ({ id: 'jx' + i, method: 'butt', first: { instance_id: 'post_1', face: 'y+' }, second: { instance_id: 'rail_' + (1 + i % 2), face: 'y-' } }))
  const a: any = constructionAffected(big, ['post_1'], 2000)
  assert(JSON.stringify(a).length < 2000 * 5, String(JSON.stringify(a).length))
  assert.equal(a.records.instances[0].id, 'post_1', 'the named part always comes first'); assert.deepEqual(a.records.definitions.map((r: any) => r.id)[0], 'post', 'then its definition, before neighbors')
  assert.equal(a.omitted.joints.length, 20); assert(a.omitted_more > 0)
})

test('the part of a reply that names IDs, and the revision they belong to', () => {
  const refused = { status: 'invalid', issues: [{ code: 'collision', ids: ['rail_1'] }] }
  assert.deepEqual(affectedSubject('edit_construction_parts', { record_id: 'a1', expected_revision: 6 }, refused), { id: 'a1', revision: null, value: refused })
  const saved = { status: 'saved', receipt: { dataset: 'artifacts', recordId: 'a1', revision: 7 }, check: { status: 'checked', issues: [{ code: 'collision', ids: ['rail_1'] }] } }
  assert.deepEqual(affectedSubject('edit_construction_parts', { record_id: 'a1' }, saved), { id: 'a1', revision: 7, value: { issues: saved.check.issues } })
  const checked = { status: 'checked', findings: { issues: [{ code: 'collision', ids: ['rail_1'] }] } }
  assert.deepEqual(affectedSubject('check_construction_draft', { artifact_id: 'a1', revision: 7 }, checked), { id: 'a1', revision: 7, value: checked.findings })
  assert.equal(affectedSubject('read_construction_draft', { artifact_id: 'a1', revision: 7 }, refused), null)
  assert.equal(affectedSubject('save_construction_draft', { record_id: null }, refused), null, 'a refused new construction has no saved records')
})

test('a saved write shows the issues of its inline check instead of sending the worker to read them', async () => {
  const output = { status: 'checked', projectId: 'p', concept_ready: false, issue_count: 3, fabrication_gap_count: 2,
    issues: [{ code: 'collision', ids: ['post_1', 'rail_1'], message: 'Overlap' }, { code: 'collision', ids: ['post_2', 'rail_1'], message: 'Overlap' }, { code: 'contact_without_joint', ids: ['rail_2'], message: 'No joint' }],
    fabrication_gaps: [{ code: 'joint_product_and_capacity_unverified', ids: ['j1'], message: 'x' }, { code: 'joint_product_and_capacity_unverified', ids: ['j2'], message: 'x' }] }
  const summary = await createConstructionViews('p', () => new Date('2026-11-16T12:00:00Z'), false, true).observe('check', 'a1', 7, output)
  const compact = compactConstructionCheck(summary, { groupedFindings: true })
  assert.deepEqual(compact.issues.map((r: any) => [r.code, r.count]), [['collision', 2], ['contact_without_joint', 1]])
  assert.deepEqual(compact.fabrication_gaps, [{ code: 'joint_product_and_capacity_unverified', count: 2 }])
  assert.equal(compact.findings_omitted, undefined, 'grouped rows cover every finding')
  // Jobs without the pin keep the old reply: the pointer to the result.
  const old = compactConstructionCheck(summary)
  assert.deepEqual(old.issues, []); assert.equal(old.findings_omitted, 5)
})
