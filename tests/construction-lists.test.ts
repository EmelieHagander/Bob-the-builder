import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConstructionTools, CONSTRUCTION_LIST_TOOL } from '../supabase/functions/_shared/construction-draft.ts'
import { constructionLists } from '../supabase/functions/_shared/construction-lists.ts'
import { schemaIssues } from '../supabase/functions/_shared/schema-issues.ts'

const artifact = '11111111-1111-4111-8111-111111111111', material = '22222222-2222-4222-8222-222222222222'
export function listFixture() {
 const placement = (x = 0, z = 0) => ({ x, y: 0, z, rx: 0, ry: 0, rz: 0 })
 const draft: any = { projectId: 'p_fixture', status: 'ok', artifact_id: artifact, revision: 4, current_revision: 4, source_state: 'current', archived: false,
  recipe: { contract_version: 1, units: 'mm', assembly_id: 'retained_600', definitions: [
   { id: 'side', primitive: 'box', material_ref: null, x_mm: 21, y_mm: 300, z_mm: 800 },
   { id: 'panel', primitive: 'box', material_ref: null, x_mm: 658, y_mm: 300, z_mm: 21 }],
  instances: [{ id: 'left', definition_id: 'side', placement: placement() }, { id: 'right', definition_id: 'side', placement: placement(679) },
   ...[0, 389.5, 779].map((z, i) => ({ id: 'panel' + i, definition_id: 'panel', placement: placement(21, z) }))], views: ['front'] },
  materials: ['side', 'panel'].map(definition_id => ({ definition_id, material_id: material, material_revision: 2, part_id: null, part_revision: null })),
  joints: [0, 1, 2].flatMap(i => ['left', 'right'].map(side => ({ id: side + i, method: 'screwed_butt', first: { instance_id: side, face: side === 'left' ? 'x_max' : 'x_min' }, second: { instance_id: 'panel' + i, face: side === 'left' ? 'x_min' : 'x_max' }, reason: 'Concept joint' }))),
  open_questions: ['No specified screw product or stock sheet'] }
 const catalog = new Map([[material + '@2', { id: material, revision: 2, current_revision: 2, kind: 'material', profile_code: 'sheet_stock', categories: ['wood.plywood', 'sheet'],
  properties: { thickness: { value: '21', unit: 'mm', truth: 'provided_spec', parameter: null } } }]])
 return { draft, catalog }
}
function harness(change?: (draft: any) => void, denied = false) {
 const { draft, catalog } = listFixture(); change?.(draft)
 let reads = 0
 const tools = createConstructionTools({ projectId: draft.projectId, message: 'Lists please', hasAccess: async () => !denied,
  read: async () => { reads++; return draft }, readCatalog: async () => ({ projectId: draft.projectId, status: 'ok', record: [...catalog.values()][0] }),
  readSources: async () => ({ project: new Map(), physical: new Map() }), now: () => new Date('2026-10-05') })
 return { tools, draft, catalog, reads: () => reads }
}
const input = { artifact_id: artifact, revision: 4, assembly_dependencies: [] }

test('current checked lists use changed dimensions, actual instances and stable local blanks; no invented hardware or purchase', async () => {
 const h = harness(), before = structuredClone(h.draft)
 const result = await h.tools.execute('derive_construction_lists', input)
 assert.equal(result.status, 'derived', JSON.stringify(result))
 assert.deepEqual(result.bom.map((r: any) => r.quantity), [2, 3]); assert.equal(result.cuts.length, 5)
 assert.deepEqual(result.cuts.map((r: any) => r.instance_id), ['left', 'right', 'panel0', 'panel1', 'panel2'])
 assert.deepEqual(result.cuts[4].blank_mm, { x: 658, y: 300, z: 21 }); assert.equal(result.cuts[4].label, 'P5')
 assert.equal(result.source.revision, 4); assert.equal(result.bom[0].material_revision, 2)
 assert.equal(result.fabrication_ready, false); assert.equal(result.delivery.saved, false)
 assert(result.joints.every((j: any) => j.hardware_quantity === null))
 assert.equal(result.assembly.status, 'needs_dependencies'); assert.equal(result.assembly.access_verified, false)
 assert(result.gaps.some((g: any) => g.code === 'raw_stock_cutting_unverified'))
 assert.deepEqual(h.draft, before)
})
test('physical joint cycles remain valid while a separate proposed assembly DAG is ordered', async () => {
 const h = harness()
 const dependencies = h.draft.joints.map((j: any, i: number) => ({ joint_id: j.id, depends_on: i ? [h.draft.joints[i - 1].id] : [] }))
 const r = await h.tools.execute('derive_construction_lists', { ...input, assembly_dependencies: dependencies })
 assert.equal(r.status, 'derived'); assert.equal(r.assembly.status, 'proposed_order')
 assert.deepEqual(r.assembly.steps.map((s: any) => s.joints[0].joint_id), h.draft.joints.map((j: any) => j.id))
 assert.equal(r.assembly.access_verified, false)
})
test('cycles, omitted joints, unknown prerequisites and duplicate entries cannot claim a valid assembly order', () => {
 const { draft, catalog } = listFixture(), all = draft.joints.map((j: any) => ({ joint_id: j.id, depends_on: [] as string[] }))
 const cyclic = structuredClone(all); cyclic[0].depends_on = [all[1].joint_id]; cyclic[1].depends_on = [all[0].joint_id]
 for (const bad of [cyclic, all.slice(1), [...all.slice(1), all[1]], all.map((d: any, i: number) => i ? d : { ...d, depends_on: ['private_other_joint'] })]) {
  const r = constructionLists(draft, catalog, bad); assert.equal(r.status, 'invalid'); assert.equal((r as any).bom, undefined)
 }
})
test('stale, unchecked, colliding and unsupported sources return no list quantities', async () => {
 for (const change of [(d: any) => { d.source_state = 'changed' }, (d: any) => { d.current_revision = 5; d.revision = 5 },
  (d: any) => { d.recipe.instances[2].placement.x = 10 }, (d: any) => { d.recipe.definitions[1].x_mm = 600 },
  (d: any) => { d.recipe.instances[0].placement.rz = 45 }]) {
  const h = harness(change), r = await h.tools.execute('derive_construction_lists', input)
  assert.notEqual(r.status, 'derived'); assert.equal(r.bom, undefined)
 }
})
test('authority is checked before reads and after source recheck; private read errors are not copied', async () => {
 const h = harness(undefined, true); assert.equal((await h.tools.execute('derive_construction_lists', input)).status, 'denied'); assert.equal(h.reads(), 0)
 const { draft, catalog } = listFixture(); let allowed = true
 const tools = createConstructionTools({ projectId: draft.projectId, message: '', hasAccess: async () => allowed,
  read: async (_id, revision) => { if (revision === null) allowed = false; return draft },
  readCatalog: async () => ({ projectId: draft.projectId, status: 'ok', record: [...catalog.values()][0] }),
  readSources: async () => ({ project: new Map(), physical: new Map() }) })
 assert.equal((await tools.execute('derive_construction_lists', input)).status, 'denied')
 const failed = createConstructionTools({ projectId: draft.projectId, message: '', hasAccess: async () => true,
  read: async () => { throw Error('PRIVATE diagnostic') }, readCatalog: async () => ({}),
  readSources: async () => ({ project: new Map(), physical: new Map() }) })
 const r = await failed.execute('derive_construction_lists', input); assert.equal(r.status, 'unavailable'); assert(!JSON.stringify(r).includes('PRIVATE'))
})
test('list schema rejects model supplied quantities or extra plan fields', () => {
 assert.equal(schemaIssues(CONSTRUCTION_LIST_TOOL.function.parameters, input).length, 0)
 assert(schemaIssues(CONSTRUCTION_LIST_TOOL.function.parameters, { ...input, bom: [{ quantity: 100 }] }).length)
 assert(schemaIssues(CONSTRUCTION_LIST_TOOL.function.parameters, { ...input, assembly_dependencies: [{ joint_id: 'left0', depends_on: [], quantity: 10 }] }).length)
})
test('a resumed turn cannot use an earlier journal head as proof that list sources are still current', async () => {
 const { draft, catalog } = listFixture(); let liveReads = 0
 const tools = createConstructionTools({ projectId: draft.projectId, message: '', hasAccess: async () => true,
  read: async () => draft, readCurrent: async () => { liveReads++; return { ...draft, revision: 5, current_revision: 5 } },
  readCatalog: async () => ({ projectId: draft.projectId, status: 'ok', record: [...catalog.values()][0] }),
  readSources: async () => ({ project: new Map(), physical: new Map() }) })
 const result = await tools.execute('derive_construction_lists', input)
 assert.equal(result.status, 'conflict'); assert.equal(result.bom, undefined); assert.equal(liveReads, 1)
})
