import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { catalogWorkers } from '../supabase/functions/_shared/bob-workers.ts'
import { buildTree, createBuildTree, summarize, zoom, type FlatTree } from '../supabase/functions/_shared/build-tree.ts'
import { CONSTRUCTION_SAVE_TOOL, withSubBuild } from '../supabase/functions/_shared/construction-draft.ts'

const u = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
// House > Upper floor > Children room > Bedroom furniture > Beds > Bunk bed; a ladder and a desk in Snickeriet.
const flat: FlatTree = { version: 1,
  spaces: [
    { space_id: u(10), name: 'Office', level_id: u(2), level_name: 'Ground floor', level_position: 0, building_id: u(1), building_name: 'House' },
    { space_id: u(11), name: 'Children room', level_id: u(3), level_name: 'Upper floor', level_position: 1, building_id: u(1), building_name: 'House' },
  ],
  builds: [
    { id: u(20), kind: 'sub_build', title: 'Bedroom furniture', revision: 1, area_id: null, parent_id: null, space_id: u(11), parts: null, in_sub_builds: [] },
    { id: u(21), kind: 'sub_build', title: 'Beds', revision: 2, area_id: 'areaA', parent_id: u(20), space_id: null, parts: null, in_sub_builds: [] },
    { id: u(22), kind: 'construction', title: 'Bunk bed', revision: 5, area_id: null, parent_id: u(21), space_id: null, parts: 70, in_sub_builds: [] },
    { id: u(23), kind: 'construction', title: 'Ladder', revision: 1, area_id: null, parent_id: null, space_id: null, parts: 9, in_sub_builds: [] },
    { id: u(24), kind: 'drawing', title: 'Bed sketch', revision: 1, area_id: null, parent_id: null, space_id: null, parts: null, in_sub_builds: [u(21)] },
    { id: u(25), kind: 'construction', title: 'Desk', revision: 1, area_id: null, parent_id: null, space_id: null, parts: null, in_sub_builds: [] },
  ] }

test('the tree follows the house, sub-builds hold builds, and unplaced builds sit in Snickeriet', () => {
  const root = buildTree(flat)
  assert.deepEqual(root.children.map(c => [c.kind, c.name]), [['building', 'House'], ['workshop', 'Snickeriet']])
  const house = root.children[0]
  assert.deepEqual(house.children.map(l => [l.name, l.children.map(r => r.name)]), [['Ground floor', ['Office']], ['Upper floor', ['Children room']]])
  // A drawing pinned by exactly one sub-build sits in it.
  const beds = house.children[1].children[0].children[0].children[0]
  assert.deepEqual(beds.children.map(c => c.name), ['Bunk bed', 'Bed sketch'])
  assert.deepEqual(root.children[1].children.map(c => c.name), ['Ladder', 'Desk'])
  // Counted by code, unknown part counts kept apart.
  assert.deepEqual(summarize(root), { rooms: 2, sub_builds: 2, constructions: 3, drawings: 1, parts: 79, parts_unknown: 1 })
  assert.deepEqual(summarize(house), { rooms: 2, sub_builds: 2, constructions: 1, drawings: 1, parts: 70, parts_unknown: 0 })
})

test('zoom shows the path above, the summary and what is directly inside; search finds down and shows the way up', () => {
  const root = buildTree(flat)
  const top = zoom(root, null, null) as any
  assert.deepEqual(top.path, []); assert.deepEqual(top.children.map((c: any) => c.name), ['House', 'Snickeriet'])
  assert.deepEqual(top.children[1].summary, { constructions: 2, parts: 9, parts_unknown: 1 })
  const room = zoom(root, u(11), null) as any
  assert.deepEqual(room.path.map((p: any) => p.name), ['House', 'Upper floor'])
  assert.deepEqual(room.node, { kind: 'room', id: u(11), name: 'Children room', summary: { sub_builds: 2, constructions: 1, drawings: 1, parts: 70 } })
  assert.deepEqual(room.children.map((c: any) => [c.kind, c.name]), [['sub_build', 'Bedroom furniture']])
  const found = zoom(root, null, 'bunk') as any
  assert.deepEqual(found.matches, [{ kind: 'construction', id: u(22), name: 'Bunk bed', path: 'House › Upper floor › Children room › Bedroom furniture › Beds › Bunk bed' }])
  // Search stays below the focus.
  assert.deepEqual((zoom(root, u(10), 'bunk') as any).matches, [])
  assert.equal((zoom(root, u(99), null) as any).status, 'not_found')
})

test('the tools read through one call, place through one command and report refusals with their code', async () => {
  const placed: unknown[] = []
  const created: unknown[] = []
  const tools = createBuildTree({ projectId: 'A', hasAccess: async () => true, read: async () => ({ data: flat, error: null }),
    create: async (...args) => { created.push(args); return { data: { status: 'saved', id: u(20), kind: 'sub_build', revision: 1, parent_id: null, space_id: args[3], place: 'room' }, error: null } },
    place: async (...args) => { placed.push(args); return args[0] === u(20) ? { data: null, error: { message: 'build_nesting_limit' } } : { data: { status: 'saved', id: args[0], kind: 'construction', parent_id: args[1], space_id: args[2], place: 'sub_build' }, error: null } } })
  assert.equal((await tools.execute('read_build_tree', { focus: null })).status, 'invalid')
  const saved = await tools.execute('place_build', { build_id: u(23), sub_build_id: u(21), room_id: null })
  assert.equal(saved.status, 'saved'); assert.equal(saved.path, 'Snickeriet › Ladder', 'the path comes from a fresh read (this fixture read is fixed)')
  const refused = await tools.execute('place_build', { build_id: u(20), sub_build_id: u(21), room_id: null })
  assert.deepEqual([refused.status, refused.code], ['invalid', 'build_nesting_limit'])
  assert.deepEqual(placed, [[u(23), u(21), null], [u(20), u(21), null]])
  // An empty sub-build is made in its room, with its path read back.
  const made = await tools.execute('create_sub_build', { title: ' Bedroom furniture ', description: 'Beds and the ladder', sub_build_id: null, room_id: u(11) })
  assert.deepEqual([made.status, made.path], ['saved', 'House › Upper floor › Children room › Bedroom furniture'])
  assert.deepEqual(created, [['Bedroom furniture', 'Beds and the ladder', null, u(11)]])
  assert.equal((await tools.execute('create_sub_build', { title: '', description: 'x', sub_build_id: null, room_id: null })).status, 'invalid')
  const broken = createBuildTree({ projectId: 'A', hasAccess: async () => true, read: async () => ({ data: { version: 1 }, error: null }), place: async () => ({ data: null, error: null }), create: async () => ({ data: null, error: null }) })
  assert.equal((await broken.execute('read_build_tree', { focus: null, query: null })).status, 'unavailable'); assert.equal(broken.partial, true)
})

test('the catalog publishes both tools, keeps placing with Bob and gives every colleague the outline', () => {
  const catalog = catalogFixture()
  for (const name of ['read_build_tree', 'place_build']) assert.equal(catalog.definition('tools.' + name, 'tool_contract').metadata.publication, 'build-tree-v1')
  const box = catalog.definition('bob.tools', 'tool_contract').definition as any
  assert(box.shelves.find((s: any) => s.label === 'Building and site').tools.includes('read_build_tree'))
  const workers = catalogWorkers(catalog)!
  for (const worker of Object.values(workers)) {
    assert(worker.reads.includes('read_build_tree'))
    assert.deepEqual(worker.knowledge!.find(k => k.label === 'build_map'), { label: 'build_map', tool: 'read_build_tree', arguments: { focus: null, query: null } })
    assert(!worker.tools.includes('place_build'), 'placing is never owned by one colleague, so Bob keeps it')
  }
})

test('owner decision 2026-11-02: Bob gives a build its place, Konrad splits it inside and places his parts', () => {
  const catalog = catalogFixture(), workers = catalogWorkers(catalog)!
  assert.equal(catalog.definition('tools.create_sub_build', 'tool_contract').metadata.publication, 'build-split-v1')
  assert(workers.structure.reads.includes('create_sub_build') && workers.structure.reads.includes('place_build'))
  assert(!workers.drawing.reads.includes('place_build') && !workers.materials.reads.includes('place_build'))
  const persona = catalog.manifest().definitions.find(d => d.prompt_key === 'structure-worker.persona')!.content
  assert.match(persona, /Var bygget hör hemma bestämmer Bob/)
  const handover = catalog.definition('tools.ask_structure_worker', 'tool_contract').definition as any
  assert.match(handover.additional_description, /give it its place/)
  assert.doesNotMatch(handover.additional_description, /A large build may come back/)
  const box = catalog.definition('bob.tools', 'tool_contract').definition as any
  assert.match(box.catalog.find((p: any) => p.name === 'ask_structure_worker').how_to, /create_sub_build/)
  assert(box.shelves.find((s: any) => s.label === 'Building and site').tools.includes('create_sub_build'))
})

test('owner decision 2026-11-02 ("Bygg först"): Konrad\'s save names its sub-build; publication build-place-v1 matches the code schema',()=>{
 const now=catalogFixture()
 const row=now.manifest().definitions.find(r=>r.prompt_key==='tools.save_construction_draft')!
 assert.equal(row.metadata?.build_place_version,1);assert.equal(row.metadata?.publication,'build-place-v1')
 const params=now.tool('save_construction_draft').function.parameters as any
 assert(params.required.includes('sub_build_id'));assert.deepEqual(params.properties.sub_build_id,(withSubBuild(CONSTRUCTION_SAVE_TOOL).function.parameters as any).properties.sub_build_id)
 const persona=now.definition('structure-worker.persona') as any
 assert.match(persona.content,/Varje del sparar du för sig, direkt i delbygget/)
})
