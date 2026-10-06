import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConstructionTools, CONSTRUCTION_LIST_TOOL, CONSTRUCTION_CUT_FIT_TOOL } from '../supabase/functions/_shared/construction-draft.ts'
import { constructionLists } from '../supabase/functions/_shared/construction-lists.ts'
import { constructionCutFit, type SheetCandidate } from '../supabase/functions/_shared/construction-cut-fit.ts'
import { schemaIssues } from '../supabase/functions/_shared/schema-issues.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'

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
 const tools = createConstructionTools({ projectId: 'p_fixture', message: 'Lists please', hasAccess: async () => !denied,
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

const candidate = (): SheetCandidate => ({ id: 'sheet', material_id: material, material_revision: 2,
 length_mm: 2440, width_mm: 1220, thickness_mm: 21, count: 1, kerf_mm: 3, trim_mm: 5,
 grain: 'length', basis: 'design_choice', note: 'Candidate format only, not physical stock or a verified product.' })
const grain = () => [{ definition_id: 'side', axis: 'z' as const }, { definition_id: 'panel', axis: 'x' as const }]
const cutInput = () => ({ artifact_id: artifact, revision: 4, candidates: [candidate()], blank_grain: grain() })

// Independent execution of the reported saw cuts: every operation must span
// an existing rectangle. The final pieces must match all placements/offcuts.
function verifyCutExecution(r: any, sheets: SheetCandidate[]) {
 let pieces = sheets.flatMap(s => Array.from({ length: s.count }, (_, i) => ({ sheet_id: `${s.id}:${i + 1}`,
  x_mm: s.trim_mm!, y_mm: s.trim_mm!, length_mm: s.length_mm! - 2 * s.trim_mm!, width_mm: s.width_mm! - 2 * s.trim_mm! })))
 for (const cut of r.cuts) {
  const length = cut.axis === 'length'
  const i = pieces.findIndex(p => p.sheet_id === cut.sheet_id
   && (length ? p.y_mm : p.x_mm) === cut.span_start_mm
   && (length ? p.y_mm + p.width_mm : p.x_mm + p.length_mm) === cut.span_end_mm
   && cut.position_mm > (length ? p.x_mm : p.y_mm)
   && cut.position_mm + cut.kerf_mm <= (length ? p.x_mm + p.length_mm : p.y_mm + p.width_mm))
  assert(i >= 0, JSON.stringify(cut))
  const p = pieces.splice(i, 1)[0]
  const first = { ...p }, second = { ...p }
  if (length) { first.length_mm = cut.position_mm - p.x_mm; second.x_mm = cut.position_mm + cut.kerf_mm; second.length_mm = p.x_mm + p.length_mm - second.x_mm }
  else { first.width_mm = cut.position_mm - p.y_mm; second.y_mm = cut.position_mm + cut.kerf_mm; second.width_mm = p.y_mm + p.width_mm - second.y_mm }
  pieces.push(first)
  if (second.length_mm > 0 && second.width_mm > 0) pieces.push(second)
 }
 const key = (p: any) => JSON.stringify([p.sheet_id, p.x_mm, p.y_mm, p.length_mm, p.width_mm])
 assert.deepEqual(pieces.map(key).sort(), [...r.placements, ...r.offcuts].map(key).sort())
}
test('cut-fit tool lays out every retained shelf blank with executable kerf cuts, grain and source pins without writes', async () => {
 const h = harness(), before = structuredClone(h.draft), v = cutInput()
 assert(h.tools.tools.some(t => t.function.name === 'check_construction_cut_fit'))
 const r = await h.tools.execute('check_construction_cut_fit', v)
 assert.equal(r.status, 'feasible', JSON.stringify(r)); assert.equal(r.projectId, h.draft.projectId)
 assert.deepEqual(r.source, { artifact_id: artifact, revision: 4 })
 assert.deepEqual(r.placements.map((p: any) => p.instance_id).sort(), h.draft.recipe.instances.map((i: any) => i.id).sort())
 assert(r.placements.every((p: any) => p.length_axis === p.grain_axis))
 assert.deepEqual(r.used_sheets, ['sheet:1']); assert.deepEqual(r.candidate_inputs, v.candidates)
 verifyCutExecution(r, v.candidates)
 for (const flag of ['saved', 'fabrication_ready', 'stock_reserved', 'shopping_ready', 'input_evidence_verified']) assert.equal(r[flag], false)
 assert.deepEqual(h.draft, before)
})
test('normal governed Bob toolbox offers and dispatches cut fit on the material shelf', async () => {
 const h = harness(), session = createBobToolSession({ constructionTools: h.tools,
  lookup: createProjectLookup('p_fixture', async () => ({ data: [], error: null }), async () => ({ data: [], error: null })), readPolicy: seedToolPolicy })
 assert((await session.prepare()).some(t => t.function.name === 'check_construction_cut_fit'))
 assert(session.toolbox.some(t => t.name === 'check_construction_cut_fit' && t.group === 'Materials, stock and Shopping'))
 assert.equal((await session.execute('check_construction_cut_fit', cutInput())).status, 'feasible')
})
test('sufficient area cannot hide an impossible blank width, material or thickness', async () => {
 for (const change of [(s: SheetCandidate) => { s.length_mm = 10000; s.width_mm = 299; s.trim_mm = 0 },
  (s: SheetCandidate) => { s.thickness_mm = 18 }, (s: SheetCandidate) => { s.material_revision = 3 }]) {
  const v = cutInput(); change(v.candidates[0]); const r = await harness().tools.execute('check_construction_cut_fit', v)
  assert(['infeasible', 'invalid'].includes(r.status), JSON.stringify(r)); assert.equal(r.placements, undefined)
 }
})
test('unknown kerf, format or grain blocks layouts; unsupported or duplicate grain cannot approve rotation', async () => {
 for (const key of ['length_mm', 'kerf_mm', 'trim_mm', 'grain'] as const) {
  const v = cutInput(); v.candidates[0][key] = null
  const r = await harness().tools.execute('check_construction_cut_fit', v); assert.equal(r.status, 'needs_data'); assert.equal(r.placements, undefined)
 }
 const { draft, catalog } = listFixture(), lists = constructionLists(draft, catalog, [])
 for (const g of [[{ definition_id: 'side', axis: null }, grain()[1]], [grain()[0], grain()[0]], [grain()[0]], [{ definition_id: 'side', axis: 'x' }, grain()[1]]]) {
  const r = constructionCutFit(lists, [candidate()], g as any)
  assert(['needs_data', 'invalid'].includes(r.status)); assert.equal((r as any).placements, undefined)
 }
})
test('cut-fit geometry distinguishes exact edges, kerf separation, grain rotation and trim', () => {
 const lists = { source: { artifact_id: artifact, revision: 9 }, bom: [{ definition_id: 'board', material_id: material, material_revision: 2 }],
  cuts: [0, 1].map(i => ({ instance_id: 'b' + i, definition_id: 'board', label: 'P' + i, material_id: material, material_revision: 2,
   blank_mm: { x: 1000, y: 300, z: 21 }, thickness_axes: ['z'] })) }
 const s = { ...candidate(), length_mm: 2000, width_mm: 300, trim_mm: 0 }, g = [{ definition_id: 'board', axis: 'x' as const }]
 assert.equal(constructionCutFit(lists, [s], g).status, 'no_layout_found') // 2 * 1000 + kerf > 2000
 const feasible = constructionCutFit(lists, [{ ...s, length_mm: 2003 }], g)
 assert.equal(feasible.status, 'feasible'); verifyCutExecution(feasible, [{ ...s, length_mm: 2003 }])
 const exact = constructionCutFit({ ...lists, cuts: lists.cuts.slice(0, 1) }, [{ ...s, length_mm: 1000 }], g)
 assert.equal(exact.status, 'feasible'); assert.deepEqual((exact as any).cuts, [])
 const rotated = { ...s, length_mm: 300, width_mm: 1000 }
 assert.equal(constructionCutFit({ ...lists, cuts: lists.cuts.slice(0, 1) }, [rotated], g).status, 'infeasible')
 const free = [{ definition_id: 'board', axis: 'none' as const }]
 assert.equal(constructionCutFit({ ...lists, cuts: lists.cuts.slice(0, 1) }, [rotated], free).status, 'feasible')
 assert.equal(constructionCutFit({ ...lists, cuts: lists.cuts.slice(0, 1) }, [{ ...rotated, trim_mm: 1 }], free).status, 'infeasible')
})
test('cut-fit cannot use stale journal heads, unchecked geometry, withdrawn access or foreign source data', async () => {
 for (const change of [(d: any) => { d.source_state = 'changed' }, (d: any) => { d.recipe.instances[2].placement.x = 10 },
  (d: any) => { d.projectId = 'another_project' }]) {
  const h = harness(change), r = await h.tools.execute('check_construction_cut_fit', cutInput())
  assert.notEqual(r.status, 'feasible'); assert.equal(r.placements, undefined)
 }
 const { draft, catalog } = listFixture(); let access = true
 const options = { projectId: draft.projectId, message: '', hasAccess: async () => access, read: async () => draft,
  readCurrent: async () => ({ ...draft, revision: 5 }), readCatalog: async () => ({ projectId: draft.projectId, status: 'ok', record: [...catalog.values()][0] }),
  readSources: async () => ({ project: new Map(), physical: new Map() }) }
 assert.equal((await createConstructionTools(options).execute('check_construction_cut_fit', cutInput())).status, 'conflict')
 assert.equal((await createConstructionTools({ ...options, readCurrent: async () => { access = false; return draft } }).execute('check_construction_cut_fit', cutInput())).status, 'denied')
})
test('cut-fit schema rejects supplied counts/placements and bounds the search; precision is not silently rounded', async () => {
 const v = cutInput(), schema = CONSTRUCTION_CUT_FIT_TOOL.function.parameters
 assert.equal(schemaIssues(schema, v).length, 0)
 for (const bad of [{ ...v, placements: [] }, { ...v, blank_count: 500 }, { ...v, candidates: [{ ...candidate(), count: 17 }] },
  { ...v, candidates: [{ ...candidate(), kerf_mm: -1 }] }, { ...v, candidates: [{ ...candidate(), width_mm: Infinity }] }]) assert(schemaIssues(schema, bad).length)
 const tooMany = cutInput(); tooMany.candidates = [{ ...candidate(), count: 16 }, { ...candidate(), id: 'other', count: 1 }]
 assert.equal((await harness().tools.execute('check_construction_cut_fit', tooMany)).status, 'unsupported')
 const precision = cutInput(); precision.candidates[0].kerf_mm = 0.0000005
 assert.equal((await harness().tools.execute('check_construction_cut_fit', precision)).status, 'unsupported')
})
test('a bounded packing failure remains search_limit rather than a false proof of impossibility', () => {
 const lists = { source: { artifact_id: artifact, revision: 4 }, bom: [{ definition_id: 'tile', material_id: material, material_revision: 2 }],
  cuts: Array.from({ length: 14 }, (_, i) => ({ instance_id: 'tile' + i, definition_id: 'tile', label: 'P' + i,
   material_id: material, material_revision: 2, blank_mm: { x: 100, y: 100, z: 21 }, thickness_axes: ['z'] })) }
 const r = constructionCutFit(lists, [{ ...candidate(), length_mm: 300, width_mm: 300, trim_mm: 0, kerf_mm: 0 }], [{ definition_id: 'tile', axis: 'none' }])
 assert.equal(r.status, 'search_limit'); assert.equal((r as any).placements, undefined); assert((r as any).search_states <= 20001)
})
