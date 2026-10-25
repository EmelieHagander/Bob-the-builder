import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { catalogFixture, preBuildingScopeCatalogFixture } from './support/ai-catalog-fixture.ts'
import { createBuildingScope, BUILDING_SCOPE_TOOLS, type BuildingScopeResource } from '../supabase/functions/_shared/project-building-scope.ts'
import { createProjectWriter, parseProjectWrite, type WritePayload } from '../supabase/functions/_shared/project-write.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import { createBobToolSession, TOOLBOX_SHELVES } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { bobWorkflows } from '../supabase/functions/_shared/bob-prompt.ts'
import { countContextTokens } from '../supabase/functions/_shared/bob-token-budget.ts'
import seed from '../supabase/functions/_shared/project-tools/catalog-seed.json' with { type: 'json' }

// Owner decisions 2026-10-25: Bob lists only Buildings the caller can edit and
// Buildings this project already targets; links an identified Building and says
// what became shared; may unlink it except under a Site link or household follow.
const owner = '00000000-0000-4000-8000-000000000001', member = '00000000-0000-4000-8000-000000000002'
const other = '00000000-0000-4000-8000-000000000003', outsider = '00000000-0000-4000-8000-000000000004'
const id = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const house = id(1, 1), garage = id(1, 2), cabin = id(1, 3), shed = id(1, 4), site = id(3, 1), level = id(4, 1)
const bathroom = id(2, 1), hall = id(2, 2), kitchen = id(2, 3), cabinRoom = id(2, 4)
const household = id(5, 1)
const quote = 'The project is the bathroom and hall in our house.'
let pg: Awaited<ReturnType<typeof projectSchema>>, priorManifest: any, publishedManifest: any
let thread: string, turn: string, generation: number, claimed: string | undefined
const as = (uid: string | null, sql: string, values: unknown[] = []) => asProjectUser(pg, uid, sql, values)
const rows = async (sql: string, values: unknown[] = []) => (await pg.query<any>(sql, values)).rows

before(async () => {
  pg = await projectSchema(async (db, name) => {
    if (name.endsWith('_ai_building_scope_catalog.sql')) priorManifest = (await db.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
  })
  publishedManifest = (await pg.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
  for (const [i, uid] of [owner, member, other, outsider].entries()) await pg.query('insert into auth.users values($1,$2,now())', [uid, `scope${i}@example.test`])
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Bathroom renovation'),('B','b','Garage work')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('ownerA','A','Owner','OA',$1),('memberA','A','Member','MA',$2),('ownerB','B','Owner','OB',$1),('otherB','B','Other','XB',$3)", [owner, member, other])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','wet-room','Wet room work'),('areaB','B','garage','Garage work')")
  const building = (uid: string, b: string, name: string, data: object = {}) => as(uid, 'select bob.physical_building_command($1,$2,$3,$4)', ['create', b, 0, JSON.stringify({ name, notes: '', ...data })])
  const space = (b: string, s: string, name: string, data: object = {}) => as(owner, 'select bob.physical_node_command($1,$2,$3,$4,$5,$6)', [b, 'space', 'create', s, 0, JSON.stringify({ name, kind: 'room', truth: 'unknown', measurements: [], ...data })])
  await as(owner, 'select bob.physical_site_command($1,$2,$3,$4)', ['create', site, 0, JSON.stringify({ name: 'Home site', notes: '' })])
  await building(owner, house, 'Our house', { site_id: site })
  await as(owner, 'select bob.physical_node_command($1,$2,$3,$4,$5,$6)', [house, 'level', 'create', level, 0, JSON.stringify({ name: 'Ground floor', position: 0 })])
  await space(house, bathroom, 'Bathroom', { kind: 'bathroom', level_id: level }); await space(house, hall, 'Hall', { kind: 'hall', level_id: level }); await space(house, kitchen, 'Kitchen', { kind: 'kitchen', level_id: level })
  await building(owner, shed, 'Shed', { site_id: site })
  // Reachable for the owner only through project B; never offered in project A.
  await building(other, garage, 'Garage')
  await as(other, 'select bob.physical_scope_command($1,$2,$3,$4,$5)', ['B', 'project', 'link', randomUUID(), JSON.stringify({ target_kind: 'building', building_id: garage })])
  // Editable for the owner through an explicitly shared household.
  await building(other, cabin, 'Cabin')
  await as(other, 'select bob.physical_node_command($1,$2,$3,$4,$5,$6)', [cabin, 'space', 'create', cabinRoom, 0, JSON.stringify({ name: 'Loft', kind: 'bedroom', truth: 'unknown', measurements: [] })])
  await pg.query("insert into shared.households(id,name) values($1,'Family')", [household])
  await pg.query("insert into shared.household_access(household_id,user_id,status) values($1,$2,'active')", [household, owner])
  await pg.query('insert into bob.building_household_shares(building_id,household_id,changed_by) values($1,$2,$3)', [cabin, household, other])
})
after(async () => { await pg?.close() })

async function claim(uid = owner, message = quote) {
  if (turn && claimed) await asProjectUser(pg, null, 'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)', ['A', claimed, thread, turn, generation], 'service_role')
  turn = randomUUID()
  const r: any = (await asProjectUser(pg, null, "select bob.bob_claim_turn('A',$1,$2,$3) r", [uid, turn, message], 'service_role')).rows[0].r
  assert.equal(r.status, 'claimed'); thread = r.thread_id; generation = r.generation; claimed = uid
}
const read = (uid: string) => async (i: { resource: BuildingScopeResource; building: string | null; query: string | null; after: string | null }) =>
  ({ data: (await as(uid, 'select bob.read_bob_building_scope_context($1,$2,$3,$4,$5) r', ['A', i.resource, i.building, i.query, i.after])).rows[0].r, error: null })
async function rpc(p: WritePayload, uid = claimed!) {
  try { return { data: (await as(uid, 'select bob.bob_project_write_v21($1,$2,$3,$4,$5::jsonb) r', ['A', thread, turn, generation, JSON.stringify(p)])).rows[0].r, error: null } }
  catch (e: any) { return { data: null, error: { code: e.code, message: e.message } } }
}
function setup(uid = claimed!, message = quote) {
  const payloads: WritePayload[] = []
  const writer = createProjectWriter('A', message, p => { payloads.push(structuredClone(p)); return rpc(p, uid) }, async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }))
  return { writer, payloads, tools: createBuildingScope({ projectId: 'A', writer, hasAccess: async () => true, read: read(uid) }) }
}
type Tools = ReturnType<typeof createBuildingScope>
async function list(tools: Tools, resource: BuildingScopeResource, building_ref: string | null = null, query: string | null = null) {
  const r = await tools.execute('read_building_scope', { resource, building_ref, query, next_ref: null }); assert.equal(r.status, 'ok', JSON.stringify(r)); return r.entries as any[]
}
const named = (entries: any[], name: string) => { const e = entries.find(e => e.content.name === name); assert.ok(e, name); return e }
const change = (tools: Tools, action: string, building_ref: string, room_refs: string[] = [], area_ref: string | null = null) =>
  tools.execute('change_building_scope', { action, building_ref, room_refs, area_ref, request_quote: quote })
const scopeRows = (project = 'A') => rows('select target_kind,site_id,building_id,space_id from bob.project_physical_scope where project_id=$1 order by target_kind,space_id', [project])

test('lists only buildings the caller can edit or this project targets', async () => {
  await claim(); const { tools } = setup()
  const entries = await list(tools, 'buildings')
  assert.deepEqual(entries.map(e => e.content.name).sort(), ['Cabin', 'Our house', 'Shed'])
  assert.deepEqual(named(entries, 'Cabin').content, { name: 'Cabin', link: 'none', can_edit: true, marked_rooms: 0, area_mappings: 0 }, 'household-shared editor')
  assert.equal((await as(owner, 'select count(*)::int n from bob.current_buildings where id=$1', [garage])).rows[0].n, 1, 'the garage is readable through project B')
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(entries)), 'no database identities reach Bob')
  assert.deepEqual(await list(setup(member).tools, 'buildings'), [], 'a plain member edits nothing and the project targets nothing yet')
  await assert.rejects(as(outsider, "select bob.read_bob_building_scope_context('A','buildings')"), /project_denied/)
  await assert.rejects(asProjectUser(pg, null, "select bob.read_bob_building_scope_context('A','buildings')", [], 'anon'), /permission denied/)
  assert.equal((await list(tools, 'buildings', null, 'hous')).length, 1)
  assert.equal((await tools.execute('read_building_scope', { resource: 'rooms', building_ref: null, query: null, next_ref: null })).status, 'invalid')
})

test('an editor links the whole building and Bob learns what was shared; marks and Areas then follow', async () => {
  await claim(); const { tools, payloads } = setup()
  const cabinRef = named(await list(tools, 'buildings'), 'Cabin').ref
  const loft = named(await list(tools, 'rooms', cabinRef), 'Loft')
  const unlinked = await change(tools, 'link', cabinRef, [loft.ref])
  assert.equal(unlinked.status, 'invalid'); assert.match(unlinked.message, /does not link this building as a whole/)
  const areaRef = named(await list(tools, 'areas'), 'Wet room work').ref
  assert.equal((await change(tools, 'link', cabinRef, [], areaRef)).status, 'invalid', 'an Area needs the whole-building link too')
  const houseRef = named(await list(tools, 'buildings'), 'Our house').ref
  const linked = await change(tools, 'link', houseRef)
  assert.equal(linked.status, 'saved', JSON.stringify(linked)); assert.match(linked.message, /rooms, notes and measurements, is now visible to every member/)
  assert.deepEqual(await scopeRows(), [{ target_kind: 'building', site_id: null, building_id: house, space_id: null }])
  const fresh = linked.current.find((c: any) => c.resource === 'buildings')
  assert.equal(fresh.content.link, 'whole')
  const rooms = await list(tools, 'rooms', fresh.ref)
  assert.deepEqual(rooms.map(r => r.content.name).sort(), ['Bathroom', 'Hall', 'Kitchen']); assert.equal(named(rooms, 'Hall').content.level, 'Ground floor')
  const marked = await change(tools, 'link', fresh.ref, [named(rooms, 'Bathroom').ref, named(rooms, 'Hall').ref])
  assert.equal(marked.status, 'saved', JSON.stringify(marked))
  assert.deepEqual(marked.changes.map((c: any) => [c.name, c.result]).sort(), [['Bathroom', 'marked'], ['Hall', 'marked']])
  const after = marked.current.find((c: any) => c.resource === 'buildings'), bath = marked.current.find((c: any) => c.content.name === 'Bathroom')
  assert.equal(after.content.marked_rooms, 2); assert.equal(bath.content.marked, true)
  const mapped = await change(tools, 'link', after.ref, [bath.ref], named(await list(tools, 'areas'), 'Wet room work').ref)
  assert.equal(mapped.status, 'saved', JSON.stringify(mapped))
  const whole = await change(tools, 'link', mapped.current[0].ref, [], mapped.current.find((c: any) => c.resource === 'areas').ref)
  assert.equal(whole.status, 'saved', JSON.stringify(whole))
  assert.deepEqual(whole.current.find((c: any) => c.resource === 'areas').content.mapped_to,
    [{ target: 'building', building: 'Our house', room: null }, { target: 'space', building: 'Our house', room: 'Bathroom' }])
  const receipt = (await rows("select receipt,before_record from bob_private.bob_write_receipts where operation_key like 'bound_building_scope:%' order by created_at"))
  assert.equal(receipt.length, 4); assert.equal(receipt[0].receipt.dataset, 'building_context'); assert.equal(receipt[0].receipt.recordId, house)
  assert.deepEqual(receipt[0].before_record.pins, payloads.find(p => p.kind === 'bound_building_scope' && (p.data.command as any).space_ids.length === 0 && !(p.data.command as any).area_id)!.data.pins)
  // A plain member may now mark a room, but cannot link a whole building.
  await claim(member); const plain = setup(member)
  const memberHouse = named(await list(plain.tools, 'buildings'), 'Our house')
  assert.equal(memberHouse.content.can_edit, false)
  assert.equal((await change(plain.tools, 'link', memberHouse.ref, [named(await list(plain.tools, 'rooms', memberHouse.ref), 'Kitchen').ref])).status, 'saved')
  assert.equal((await list(plain.tools, 'buildings')).length, 1, 'the project targets only the house')
})

test('a non-editor is refused a whole-building link without ending the turn', async () => {
  await claim(); const linkSite = await as(owner, 'select bob.physical_scope_command($1,$2,$3,$4,$5) r', ['A', 'project', 'link', randomUUID(), JSON.stringify({ target_kind: 'site', site_id: site })])
  assert.ok(linkSite.rows[0])
  await claim(member); const { tools } = setup(member)
  const shedEntry = named(await list(tools, 'buildings'), 'Shed')
  assert.deepEqual(shedEntry.content, { name: 'Shed', link: 'site', can_edit: false, marked_rooms: 0, area_mappings: 0, site_link: true })
  const refused = await change(tools, 'link', shedEntry.ref)
  assert.equal(refused.status, 'invalid', 'building_denied is answerable, not a lost project'); assert.match(refused.message, /needs edit rights/)
  assert.equal((await rows("select count(*)::int n from bob.project_physical_scope where project_id='A' and building_id=$1", [shed]))[0].n, 0)
  // Site coverage keeps the Building linked: unlinking it alone is refused.
  await claim(); const editor = setup()
  const covered = await change(editor.tools, 'unlink', named(await list(editor.tools, 'buildings'), 'Shed').ref)
  assert.equal(covered.status, 'invalid'); assert.match(covered.message, /site link covers this building/)
  const houseLinked = await change(editor.tools, 'unlink', named(await list(editor.tools, 'buildings'), 'Our house').ref)
  assert.equal(houseLinked.status, 'invalid', 'the house is covered by the same Site link'); assert.match(houseLinked.message, /site link/)
  await pg.query("delete from bob.project_physical_scope where project_id='A' and target_kind='site'")
})

test('household follow blocks unlinking the Building; room marks may still change', async () => {
  await claim(); const { tools } = setup()
  await pg.query("insert into bob.project_household_shares(project_id,building_id,changed_by) values('A',$1,$2)", [house, owner])
  const houseRef = named(await list(tools, 'buildings'), 'Our house')
  assert.equal(houseRef.content.household_follow, true)
  const refused = await change(tools, 'unlink', houseRef.ref)
  assert.equal(refused.status, 'invalid'); assert.match(refused.message, /household/)
  assert.ok((await scopeRows()).some(r => r.target_kind === 'building' && r.building_id === house))
  const kitchenRef = named(await list(tools, 'rooms', houseRef.ref), 'Kitchen').ref
  const unmarked = await change(tools, 'unlink', houseRef.ref, [kitchenRef])
  assert.equal(unmarked.status, 'saved', JSON.stringify(unmarked)); assert.deepEqual(unmarked.changes.map((c: any) => c.result), ['unmarked'])
  await pg.query("delete from bob.project_household_shares where project_id='A'")
})

test('stale reads conflict; exact replay returns the same receipt; a changed retry conflicts', async () => {
  await claim(); const { tools, payloads, writer } = setup()
  let houseEntry = named(await list(tools, 'buildings'), 'Our house')
  const kitchenEntry = named(await list(tools, 'rooms', houseEntry.ref), 'Kitchen')
  await as(member, 'select bob.physical_scope_command($1,$2,$3,$4,$5)', ['A', 'project', 'link', randomUUID(), JSON.stringify({ target_kind: 'space', building_id: house, space_id: kitchen })])
  const stale = await change(tools, 'unlink', houseEntry.ref, [kitchenEntry.ref])
  assert.equal(stale.status, 'conflict', JSON.stringify(stale)); assert.match(stale.message, /Read building scope again/)
  assert.equal((await rows("select count(*)::int n from bob.project_physical_scope where project_id='A' and space_id=$1", [kitchen]))[0].n, 1)
  houseEntry = named(await list(tools, 'buildings'), 'Our house')
  const saved = await change(tools, 'unlink', houseEntry.ref, [named(await list(tools, 'rooms', houseEntry.ref), 'Kitchen').ref])
  assert.equal(saved.status, 'saved')
  const original = payloads.at(-1)!, first = writer.receipts.at(-1)!
  const replay = await rpc(original)
  assert.equal(replay.error, null); assert.deepEqual(replay.data, (await rows('select receipt from bob_private.bob_write_receipts where turn_id=$1 order by created_at desc limit 1', [turn]))[0].receipt)
  assert.equal(replay.data.savedAt, first.savedAt)
  const changed = structuredClone(original); changed.request_quote = 'The project is the bathroom'
  assert.equal((await rpc(changed)).error?.code, 'PT409')
})
test('forged pins, raw identities, a lost claim, a wrong quote and the receipt budget are refused', async () => {
  await claim(); const { tools, payloads } = setup()
  const houseEntry = named(await list(tools, 'buildings'), 'Our house')
  assert.equal((await change(tools, 'link', house)).status, 'invalid', 'a raw building id is not a ref')
  assert.equal((await tools.execute('change_building_scope', { action: 'link', building_ref: houseEntry.ref, room_refs: [], area_ref: null, request_quote: quote, building_id: house })).status, 'invalid')
  const bath = named(await list(tools, 'rooms', houseEntry.ref), 'Bathroom')
  assert.equal((await change(tools, 'link', houseEntry.ref, [bath.ref, bath.ref])).status, 'invalid', 'distinct rooms')
  const cabinEntry = named(await list(tools, 'buildings'), 'Cabin')
  assert.equal((await change(tools, 'link', cabinEntry.ref, [bath.ref])).status, 'invalid', 'a room of another building')
  assert.equal((await change(tools, 'link', houseEntry.ref, [bath.ref])).status, 'saved')
  const good = payloads.at(-1)!
  const forged = structuredClone(good); (forged.data.pins as any[])[0].record.can_edit = false
  assert.equal((await rpc(forged)).error?.code, 'PT409', 'a pin that differs from the current read')
  const swapped = structuredClone(good); (swapped.data.command as any).space_ids = [kitchen]
  assert.equal((await rpc(swapped)).error?.code, '22023', 'the command must use exactly the pinned rooms')
  const wrongQuote = structuredClone(good); wrongQuote.request_quote = 'Unlink everything'
  assert.match((await rpc(wrongQuote)).error?.message ?? '', /invalid_bound_building_scope/)
  assert.ok((await rpc(good, member)).error, 'another member cannot use this claim')
  for (let i = 0; i < 32; i++) await pg.query("insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,receipt) values('A',$1,$2,$3,'{}','{}')", [owner, turn, 'fixture:' + i])
  const fresh = named(await list(tools, 'buildings'), 'Our house')
  const exhausted = await change(tools, 'unlink', fresh.ref, [named(await list(tools, 'rooms', fresh.ref), 'Bathroom').ref])
  assert.equal(exhausted.status, 'invalid'); assert.match((await rpc(payloads.at(-1)!)).error?.message ?? '', /write_budget_exhausted/)
  await asProjectUser(pg, null, 'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)', ['A', owner, thread, turn, generation], 'service_role'); claimed = undefined
  assert.match((await rpc(good, owner)).error?.message ?? '', /turn_not_claimed/)
})

test('unlinking the whole Building removes its room marks and Area mappings and reports them', async () => {
  await claim(); const { tools } = setup()
  const before = await scopeRows()
  assert.ok(before.some(r => r.target_kind === 'space'))
  const targets = (await rows("select count(*)::int n from bob.area_physical_targets where project_id='A'"))[0].n
  assert.ok(targets > 0)
  const marks = before.filter(r => r.target_kind === 'space').length
  const removed = await change(tools, 'unlink', named(await list(tools, 'buildings'), 'Our house').ref)
  assert.equal(removed.status, 'saved', JSON.stringify(removed))
  assert.match(removed.message, new RegExp(`${marks} room marks and ${targets} Area mappings`))
  assert.deepEqual(await scopeRows(), []); assert.equal((await rows("select count(*)::int n from bob.area_physical_targets where project_id='A'"))[0].n, 0)
  assert.deepEqual((await scopeRows('B')).map(r => r.building_id), [garage], 'another project keeps its own links')
  const again = await change(tools, 'unlink', removed.current[0].ref)
  assert.equal(again.status, 'invalid', 'nothing left to unlink'); assert.match(again.message, /does not link this building/)
})

test('other write kinds still reach v20 through the new adapter', async () => {
  await claim(); const task = parseProjectWrite('save_project_task', { record_id: null, area_id: 'areaA', step_id: null, name: 'Tile the floor', instructions: 'Lay the tiles.', expected_updated_at: null, request_quote: quote }, 'A', quote)!
  const saved = await rpc(task)
  assert.equal(saved.error, null, JSON.stringify(saved.error)); assert.equal(saved.data.dataset, 'tasks')
  for (const role of ['anon', 'service_role']) assert.equal((await pg.query("select has_function_privilege($1,'bob.bob_project_write_v21(text,uuid,uuid,bigint,jsonb)','execute') ok", [role])).rows[0].ok, false)
})

test('restart reconstructs refs and reuses exact receipts, with live access checks', async () => {
  await claim(); const entries: JournalEntry[] = []; let reads = 0, writes = 0, allowed = true
  const run = async () => {
    const journal = createBobJournal({ entries, save: async e => { entries.push(structuredClone(e)) } }, Infinity)
    const writer = createProjectWriter('A', quote, p => journal.run('write', p, async () => { writes++; return rpc(p) }), async () => ({ data: [], error: null }), async () => ({ data: { generation: 2, receipts: [] }, error: null }))
    const tools = createBuildingScope({ projectId: 'A', writer, hasAccess: async () => allowed, read: i => journal.run('read', i, async () => { reads++; return read(owner)(i) }) })
    const r = await tools.execute('read_building_scope', { resource: 'buildings', building_ref: null, query: 'Our', next_ref: null })
    return r.status === 'ok' ? change(tools, 'link', r.entries[0].ref) : r
  }
  assert.equal((await run()).status, 'saved'); assert.equal((await run()).status, 'saved'); assert.equal(reads, 1); assert.equal(writes, 1)
  allowed = false; assert.equal((await run()).status, 'denied'); assert.equal(writes, 1)
  // Checkpoint state carries refs and pages into a new runtime.
  const { tools, writer } = setup(), first = await tools.execute('read_building_scope', { resource: 'buildings', building_ref: null, query: null, next_ref: null })
  const restored = createBuildingScope({ projectId: 'A', writer, hasAccess: async () => true, read: read(owner) })
  assert.equal(restored.used, false); restored.restoreState(tools.exportState()); assert.equal(restored.used, true)
  const houseEntry = named(first.entries, 'Our house')
  assert.equal((await change(restored, 'link', houseEntry.ref, [named(await list(restored, 'rooms', houseEntry.ref), 'Hall').ref])).status, 'saved')
  assert.throws(() => restored.restoreState({ ...tools.exportState(), projectId: 'B' }), /invalid_building_scope_state/)
})

test('published contracts, fixture and manuals agree; older pinned manifests keep their bench', async () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-ai-building-scope-catalog.ts', 'supabase/migrations/20261025150500_ai_building_scope_catalog.sql', '--check'])
  const catalog = (m: any) => createAiCatalogSession({ rpc: async () => { throw Error('Pinned') } }, { app: 'bob', manifest: m })
  const current = catalog(publishedManifest), fixture = catalogFixture()
  for (const key of ['tools.read_building_scope', 'tools.change_building_scope', 'tools.save_building_context', 'bob.tools', 'bob.workflows']) {
    assert.deepEqual(current.definition(key).definition, fixture.definition(key).definition, key)
    assert.deepEqual(current.definition(key).metadata, fixture.definition(key).metadata, key)
  }
  for (const spec of BUILDING_SCOPE_TOOLS) {
    assert.deepEqual(current.tool(spec.function.name).function.parameters, spec.function.parameters)
    assert.ok(!(current.tool(spec.function.name, { server_quote: true }).function.parameters as any).required.includes('request_quote'))
    assert.deepEqual((await rows('select name,description,how_to,schema_version,always_load,preload_phases,active from bob.tool_catalog where name=$1', [spec.function.name]))[0], seed.find(r => r.name === spec.function.name))
  }
  const intake = current.definition('tools.save_building_context').definition.additional_description as string
  assert.match(intake, /change_building_scope/); assert.doesNotMatch(intake, /manual linking/)
  const facts = bobWorkflows(current).find(w => w.name === 'workflow_facts_and_site')!
  assert.ok(facts.tools.includes('read_building_scope') && facts.tools.includes('change_building_scope'))
  assert.ok(countContextTokens(facts.card) <= 80)
  assert.deepEqual(TOOLBOX_SHELVES.find(s => s.label === 'Building and site')!.tools, (current.definition('bob.tools').definition.shelves as any[]).find(s => s.label === 'Building and site').tools)
  assert.deepEqual((await pg.query("select shared.resolve_ai_catalog('bob',$1) m", [priorManifest.manifest_id])).rows[0].m, priorManifest)
  assert.deepEqual(publishedManifest.models, priorManifest.models)
  const { writer, tools } = setup(), lookup = createProjectLookup('A', async () => ({ data: { records: [], related: [], truncated: false }, error: null }))
  const options = { message: quote, lookup, writer, buildingScope: tools, readPolicy: seedToolPolicy }
  const names = async (aiCatalog: any) => (await createBobToolSession({ ...options, aiCatalog }).prepare()).map(t => t.function.name)
  const fresh = await names(current)
  assert.ok(fresh.includes('read_building_scope') && fresh.includes('change_building_scope') && fresh.includes('save_building_context'))
  for (const old of [catalog(priorManifest), preBuildingScopeCatalogFixture()]) {
    const bench = await names(old)
    assert.ok(!bench.includes('read_building_scope') && !bench.includes('change_building_scope')); assert.ok(bench.includes('save_building_context'))
  }
  const guest = await createBobToolSession({ ...options, writer: undefined, aiCatalog: current }).prepare()
  assert.ok(!guest.some(t => t.function.name === 'change_building_scope'), 'no write tool without a claimed writer')
})

test('refusal codes become answerable results; only a lost project ends the turn', async () => {
  const payload = { kind: 'bound_building_scope', record_id: house, expected_updated_at: null, expected_revision: null, request_quote: quote, data: { pins: [], command: {} } } as WritePayload
  const outcome = async (code: string, message: string) => createProjectWriter('A', quote, async () => ({ data: null, error: { code, message } }), async () => ({ data: [], error: null }), async () => ({ data: null, error: null })).commit(payload)
  for (const [code, message, pattern] of [['22023', 'space_not_in_building', /room is not in this building/], ['22023', 'element_not_in_building', /element is not in this building/],
    ['22023', 'building_not_linked', /does not link this building as a whole/], ['42501', 'building_denied', /needs edit rights/],
    ['22023', 'building_site_covered', /site link/], ['22023', 'building_household_follow', /household/]] as const) {
    const r = await outcome(code, message); assert.equal(r.status, 'invalid', message); assert.match(r.message ?? '', pattern)
  }
  assert.deepEqual(await outcome('42501', 'project_denied'), { status: 'denied', reason: 'access' })
  for (const code of ['PT409', '40001', '40P01']) assert.equal((await outcome(code, 'record_changed')).status, 'conflict')
})

test('pages are bounded and cursors stay bound to their filter', async () => {
  for (let i = 1; i <= 9; i++) await pg.query("insert into bob.areas(id,project_id,slug,name) values($1,'A',$2,$3)", ['zone' + i, 'zone-' + i, 'Zone ' + i])
  await pg.query("update bob.areas set archived_at=now() where id='zone9'")
  await claim(); const { tools } = setup()
  const first = await tools.execute('read_building_scope', { resource: 'areas', building_ref: null, query: null, next_ref: null })
  assert.equal(first.entries.length, 8); assert.ok(first.next_ref)
  const next = await tools.execute('read_building_scope', { resource: 'areas', building_ref: null, query: null, next_ref: first.next_ref })
  assert.deepEqual(next.entries.map((e: any) => e.content.name), ['Zone 8'], 'archived Areas are left out'); assert.equal(next.next_ref, null)
  assert.ok(first.entries.some((e: any) => e.content.name === 'Wet room work'))
  assert.equal((await tools.execute('read_building_scope', { resource: 'buildings', building_ref: null, query: null, next_ref: first.next_ref })).status, 'invalid')
  assert.equal((await tools.execute('read_building_scope', { resource: 'areas', building_ref: null, query: 'Zone', next_ref: first.next_ref })).status, 'invalid')
})
