import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from './support/pglite.ts'
import { execFileSync } from 'node:child_process'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import { DATASETS, parseLookup } from '../supabase/functions/_shared/project-lookup.ts'

// Room dimensions (owner decisions 2026-10-25/26): a measurement says once what
// it measures; room snapshots mirror it; bob.project_room_dimensions and Bob's
// room_dimensions dataset read them per project room without deriving values.
const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'   // project A member
const two = '00000000-0000-0000-0000-000000000002'   // project B member
const both = '00000000-0000-0000-0000-000000000003'  // Building editor, member of A and B
const outsider = '00000000-0000-0000-0000-000000000004'
const three = '00000000-0000-0000-0000-000000000005' // project C member (room-only scope)
const u = (n: number) => '40000000-0000-0000-0000-' + String(n).padStart(12, '0')
const house = u(2), barnrum = u(4), hall = u(5)
let priorManifest: any, publishedManifest: any

async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
const data = async (uid: string | null, sql: string, params: unknown[] = []) => (await as(uid, sql, params)).rows[0] as any
const rows = async (uid: string | null, sql: string, params: unknown[] = []) => (await as(uid, sql, params)).rows as any[]
const owner = async (sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as any[]
const reject = (p: Promise<unknown>, pattern: RegExp) => assert.rejects(p, pattern)

async function node(buildingId: string, kind: string, action: string, id: string, expected: number, body: any = {}, uid = both) {
  return (await data(uid, 'select bob.physical_node_command($1,$2,$3,$4,$5,$6) data', [buildingId, kind, action, id, expected, JSON.stringify(body)])).data
}
async function scope(project: string, id: string, body: any, uid = both) {
  return (await data(uid, "select bob.physical_scope_command($1,'project','link',$2,$3) data", [project, id, JSON.stringify(body)])).data
}
async function evidence(action: string, id: string, expected: number, body: any, uid = both, project = 'A') {
  return (await data(uid, "select bob.evidence_command($1,'measurement',$2,$3,$4,$5) data", [project, action, id, expected, JSON.stringify(body)])).data
}
const length = (subject: string, value: number | null, extra: any = {}) => ({
  subject, value: value === null ? null : String(value), unit: 'mm', truth: value === null ? 'unknown' : 'measured',
  source: value === null ? '' : 'Laser, 2026-10-12', required: false, ...extra,
})
const revisionOf = async (id: string) => (await owner('select current_revision r from bob.measurements where id=$1', [id]))[0].r
const roomRevision = async (id: string) => (await owner('select accepted_revision r from bob.building_spaces where id=$1', [id]))[0].r
const snapshotsOf = async (space: string, revision?: number) => owner(
  'select measurement_id,measurement_revision,property,side,reference from bob.space_measurements where space_id=$1 and space_revision=$2 order by measurement_id',
  [space, revision ?? await roomRevision(space)])
const dims = (uid: string, project: string, space?: string) => rows(uid,
  `select space_name,property,side,reference,status,truth,millimetres,measurements from bob.project_room_dimensions
   where project_id=$1 and ($2::uuid is null or space_id=$2) order by space_name,property,side nulls first,reference nulls first`, [project, space ?? null])
const search = async (uid: string, dataset: string, extra: unknown[] = [null, null, null, null, null], project = 'A') =>
  (await data(uid, 'select bob.search_bob_project_data_v9($1,$2,$3,$4,$5,$6,$7) data', [project, dataset, ...extra])).data

before(async () => {
  await pg.exec([
    'create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;',
    'create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);',
    "create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;",
    "create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;",
    'grant usage on schema auth to anon,authenticated;',
    'create schema storage;',
    'create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);',
    'create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));',
    'alter table storage.buckets enable row level security; alter table storage.objects enable row level security;',
    'grant usage on schema storage to anon,authenticated; grant all on storage.objects,storage.buckets to anon,authenticated;',
  ].join('\n'))
  for (const [i, uid] of [one, two, both, outsider, three].entries()) await pg.query('insert into auth.users values($1,$2,now())', [uid, 'rooms' + i + '@example.test'])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, legacy), 'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Bunk bed'),('B','b','Floor'),('C','c','Hall paint')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2),('threeC','C','Three','TC',$3)", [one, two, three])
  await setupSharedSocial(pg)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
    if (f.endsWith('_ai_room_dimensions_catalog.sql')) priorManifest = (await owner("select shared.resolve_ai_catalog('bob',null) m"))[0].m
    await pg.exec(await readFile(new URL(f, dir), 'utf8'))
  }
  publishedManifest = (await owner("select shared.resolve_ai_catalog('bob',null) m"))[0].m
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Builder','BA',$1),('bothB','B','Builder','BB',$1)", [both])

  // One house; A and B link it whole; C has an older room-only row for the hall.
  await data(both, 'select bob.physical_building_command($1,$2,$3,$4) data', ['create', house, 0, JSON.stringify({ name: 'Main house', notes: '' })])
  await node(house, 'space', 'create', barnrum, 0, { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', measurements: [] })
  await node(house, 'space', 'create', hall, 0, { name: 'Hall', kind: 'hall', truth: 'unknown', measurements: [] })
  await scope('A', u(10), { target_kind: 'building', building_id: house })
  await scope('B', u(11), { target_kind: 'building', building_id: house })
  await pg.query("insert into bob.project_physical_scope(id,project_id,target_kind,building_id,space_id,created_by) values($1,'C','space',$2,$3,$4)", [u(12), house, hall, both])
})
after(() => pg.close())

test('classification is typed, validated and never writable directly', async () => {
  await evidence('create', u(20), 0, length('Rummets exakta längd', 3970))
  for (const [body, pattern] of [
    [{ property: 'room_size' }, /invalid_measurement_property/],
    [{ property: 'opening_width', side: 'NE' }, /invalid_measurement_side/],
    [{ side: 'N' }, /measurement_property_required/],
    [{ property: null, reference: 'vid fönstret' }, /measurement_property_required/],
    [{ property: 'other', reference: 'x'.repeat(121) }, /invalid_measurement_reference/],
    [{ property: 7 }, /invalid_measurement_property/],
    [{}, /measurement_property_required/],
    [{ property: 'room_length', subject: 'Renamed' }, /Unsupported fields/],
  ] as const) await reject(evidence('classify', u(20), 1, body), pattern)
  await reject(as(one, "update bob.measurements set property='room_length' where id=$1", [u(20)]), /permission denied/)
  await reject(as(one, "update bob.space_measurements set property='room_length'"), /permission denied/)
  for (const role of ['anon', 'authenticated']) for (const fn of ['guard_measurement_classification()', 'fill_space_measurement_property()', 'sync_space_measurement_property()'])
    assert.equal((await owner(`select has_function_privilege($1,'bob_private.${fn}','execute') ok`, [role]))[0].ok, false)
  assert.equal((await owner("select property from bob.measurements where id=$1", [u(20)]))[0].property, null)
})

test('classify fills once without a new revision, mirrors every snapshot and is refused afterwards', async () => {
  // Linked before classification: the snapshot starts unclassified.
  await node(house, 'space', 'revise', barnrum, 1, { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', change_note: 'Length', measurements: [{ id: u(20), revision: 1 }] })
  assert.deepEqual(await snapshotsOf(barnrum), [{ measurement_id: u(20), measurement_revision: 1, property: null, side: null, reference: null }])
  const before = { revisions: (await owner('select count(*)::int n from bob.measurement_revisions'))[0].n, room: await roomRevision(barnrum), measurement: await revisionOf(u(20)) }

  await reject(evidence('classify', u(20), 2, { property: 'room_length' }), /Record changed/)
  await reject(evidence('classify', u(20), 1, { property: 'room_length' }, two), /project_denied/)
  await reject(evidence('classify', u(20), 1, { property: 'room_length' }, outsider), /project_denied/)
  const saved = await evidence('classify', u(20), 1, { property: 'room_length' }, one)
  assert.deepEqual(saved, { id: u(20), revision: 1, property: 'room_length', side: null, reference: null })
  assert.equal(await revisionOf(u(20)), before.measurement, 'Classifying appends no measurement revision')
  assert.equal((await owner('select count(*)::int n from bob.measurement_revisions'))[0].n, before.revisions)
  assert.equal(await roomRevision(barnrum), before.room, 'Classifying appends no room revision')
  const audit = (await owner('select classified_by,classified_actor,classified_at is not null stamped from bob.measurements where id=$1', [u(20)]))[0]
  assert.deepEqual(audit, { classified_by: one, classified_actor: 'One', stamped: true })
  // Every snapshot of the measurement follows, on old room revisions too.
  assert.deepEqual((await snapshotsOf(barnrum)).map(r => r.property), ['room_length'])
  assert.deepEqual(await rows(one, 'select subject,property from bob.current_measurements where id=$1', [u(20)]), [{ subject: 'Rummets exakta längd', property: 'room_length' }])

  // Fill-once: the same answer is a no-op; a different one is refused, on every path.
  assert.equal((await evidence('classify', u(20), 1, { property: 'room_length' }, one)).property, 'room_length')
  await reject(evidence('classify', u(20), 1, { property: 'room_width' }), /measurement_already_classified/)
  await reject(evidence('classify', u(20), 1, { property: 'room_length', side: 'N' }), /measurement_already_classified/)
  await reject(evidence('revise', u(20), 1, { ...length('Rummets exakta längd', 3971), change_note: 'Re-measured', property: 'room_width' }), /measurement_already_classified/)
  await reject(owner("update bob.measurements set property='room_width' where id=$1", [u(20)]), /measurement_already_classified/)
  await reject(owner('update bob.measurements set property=null,side=null,reference=null,classified_by=null,classified_actor=null,classified_at=null where id=$1', [u(20)]), /measurement_already_classified/)
  // A value revision keeps the classification and leaves the field out.
  const revised = await evidence('revise', u(20), 1, { ...length('Rummets exakta längd', 3970), change_note: 'Same value, new source' })
  assert.equal(revised.revision, 2)
  assert.equal((await owner('select property from bob.measurements where id=$1', [u(20)]))[0].property, 'room_length')

  // Create and revise accept the classification while unclassified.
  const width = await evidence('create', u(21), 0, length('Rummets exakta bredd', 2700, { property: 'room_width' }))
  assert.equal(width.revision, 1)
  assert.equal((await owner('select property,classified_by from bob.measurements where id=$1', [u(21)]))[0].classified_by, both)
  await evidence('create', u(22), 0, length('Takhöjd vid sängens placering', 1920))
  await evidence('revise', u(22), 1, { ...length('Takhöjd vid sängens placering', 1920), change_note: 'Typed', property: 'ceiling_height' })
  assert.equal((await owner('select property from bob.measurements where id=$1', [u(22)]))[0].property, 'ceiling_height')
  // Archived measurements are restored before classifying.
  await evidence('create', u(23), 0, length('Garderob: djup', 600))
  await evidence('archive', u(23), 1, {})
  await reject(evidence('classify', u(23), 2, { property: 'other', reference: 'garderob' }), /Restore this record/)
})

test('new snapshots take the classification on every link path and carry forward when measurements are omitted', async () => {
  const rev = await roomRevision(barnrum)
  await node(house, 'space', 'revise', barnrum, rev, { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', change_note: 'Dimensions',
    measurements: [{ id: u(20), revision: 2 }, { id: u(21), revision: 1 }, { id: u(22), revision: 2 }] })
  assert.deepEqual((await snapshotsOf(barnrum)).map(r => r.property).sort(), ['ceiling_height', 'room_length', 'room_width'])
  // Omitting measurements keeps them (the bug lost them); notes change only.
  let next = await node(house, 'space', 'revise', barnrum, rev + 1, { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', notes: 'Sloped roof', change_note: 'Notes' })
  assert.equal(next.revision, rev + 2)
  assert.deepEqual((await snapshotsOf(barnrum)).map(r => [r.measurement_id, r.property]),
    [[u(20), 'room_length'], [u(21), 'room_width'], [u(22), 'ceiling_height']])
  // A proposal carries the latest revision; acceptance copies the proposal.
  next = await node(house, 'space', 'propose', barnrum, rev + 2, { project_id: 'A', name: 'Barnrum', kind: 'bedroom', truth: 'unknown', change_note: 'Rename idea' }, one)
  assert.equal(next.state, 'proposed')
  assert.equal((await snapshotsOf(barnrum, rev + 3)).length, 3)
  next = await node(house, 'space', 'accept', barnrum, rev + 3, {})
  assert.equal((await snapshotsOf(barnrum, rev + 4)).length, 3)
  // An explicit empty list still clears; a non-list is refused.
  await reject(node(house, 'space', 'revise', barnrum, rev + 4, { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', change_note: 'x', measurements: null }), /invalid_space_measurements/)
  const cleared = await node(house, 'space', 'revise', barnrum, rev + 4, { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', change_note: 'Clear', measurements: [] })
  assert.deepEqual(await snapshotsOf(barnrum, cleared.revision), [])
  // Restore the dimensions for the following tests.
  await node(house, 'space', 'revise', barnrum, cleared.revision, { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', change_note: 'Relink',
    measurements: [{ id: u(20), revision: 2 }, { id: u(21), revision: 1 }, { id: u(22), revision: 2 }] })
  assert.equal((await snapshotsOf(barnrum)).length, 3)
})

test('the view reports known, conflict and unknown with the strongest truth, never deriving a value', async () => {
  let view = await dims(one, 'A', barnrum)
  const brief = (list: any[]) => list.map(r => [r.property, r.side, r.reference, r.status, r.truth, r.millimetres, r.measurements.length])
  assert.deepEqual(brief(view), [
    ['ceiling_height', null, null, 'known', 'measured', '1920', 1],
    ['room_length', null, null, 'known', 'measured', '3970', 1],
    ['room_width', null, null, 'known', 'measured', '2700', 1],
  ])
  assert.deepEqual(view[1].measurements[0], { snapshot_id: view[1].measurements[0].snapshot_id, measurement_id: u(20), measurement_revision: 2,
    source_project_id: 'A', subject: 'Rummets exakta längd', value: '3970', unit: 'mm', millimetres: '3970', truth: 'measured', source: 'Laser, 2026-10-12' })
  // An unknown room still has its three rows; nothing is derived.
  assert.deepEqual(brief(await dims(one, 'A', hall)), [
    ['ceiling_height', null, null, 'unknown', null, null, 0], ['room_length', null, null, 'unknown', null, null, 0], ['room_width', null, null, 'unknown', null, null, 0],
  ])

  // Strongest truth wins; equal values in other units agree; differing values at the same strength conflict.
  const add = async (n: number, subject: string, value: number | null, extra: any) => {
    await evidence('create', u(n), 0, length(subject, value, extra)); return { id: u(n), revision: 1 }
  }
  const links = [
    { id: u(20), revision: 2 }, { id: u(21), revision: 1 }, { id: u(22), revision: 2 },
    await add(30, 'Längd, uppskattad', 4000, { truth: 'estimated', source: 'Guess', property: 'room_length' }),
    await add(31, 'Längd i cm', 397, { unit: 'cm', property: 'room_length' }),
    await add(32, 'Bredd vid dörren', 2710, { property: 'room_width' }),
    await add(33, 'Takhöjd vid fönstret', null, { property: 'ceiling_height', reference: 'vid fönstret' }),
    await add(34, 'N-sida: fönster karm-till-karm', 1030, { property: 'opening_width', side: 'N' }),
    await add(35, 'Höjd enligt ritning', 1950, { truth: 'provided_spec', source: 'Drawing', property: 'ceiling_height', reference: 'vid dörren' }),
    await add(36, 'Ospecificerat', 500, {}),
  ]
  await node(house, 'space', 'revise', barnrum, await roomRevision(barnrum), { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', change_note: 'More', measurements: links })
  view = await dims(one, 'A', barnrum)
  assert.deepEqual(brief(view), [
    ['ceiling_height', null, null, 'known', 'measured', '1920', 1],
    ['ceiling_height', null, 'vid dörren', 'known', 'provided_spec', '1950', 1],
    ['ceiling_height', null, 'vid fönstret', 'unknown', null, null, 1],
    ['opening_width', 'N', null, 'known', 'measured', '1030', 1],
    ['room_length', null, null, 'known', 'measured', '3970', 2],
    ['room_width', null, null, 'conflict', 'measured', null, 2],
  ])
  assert.deepEqual(view[4].measurements.map((m: any) => [m.subject, m.value, m.unit, m.millimetres]),
    [['Rummets exakta längd', '3970', 'mm', '3970'], ['Längd i cm', '397', 'cm', '3970']], 'The estimate is outranked, not averaged')
  assert.deepEqual(view[5].measurements.map((m: any) => m.millimetres), ['2700', '2710'], 'Both conflicting values are shown')
  assert.equal(view[2].measurements[0].value, null, 'A classified unknown stays unknown')
  assert.equal(view.some(r => r.property === null), false, 'Unclassified snapshots are not dimensions')
})

test('another linked project sees the room snapshots but never the measurements; room-only scope and outsiders stay bounded', async () => {
  const forB = await dims(two, 'B', barnrum)
  assert.deepEqual(forB.map(r => [r.property, r.reference, r.status]), (await dims(one, 'A', barnrum)).map(r => [r.property, r.reference, r.status]))
  assert.equal(forB.find(r => r.property === 'room_length').measurements[0].source_project_id, 'A')
  assert.deepEqual(await rows(two, 'select id from bob.measurements where project_id=$1', ['A']), [])
  assert.deepEqual(await rows(two, 'select id from bob.current_measurements where project_id=$1', ['A']), [])
  assert.deepEqual(await rows(two, "select project_id from bob.project_room_dimensions where project_id<>'B'"), [], 'B reads only its own project rows')
  // C covers only the hall: Barnrum is not revealed through C.
  assert.deepEqual([...new Set((await rows(three, 'select space_name from bob.project_room_dimensions')).map(r => r.space_name))], ['Hall'])
  assert.equal((await search(three, 'room_dimensions', [null, null, null, null, null], 'C')).records.map((r: any) => r.name).join(), 'Hall')
  assert.deepEqual(await rows(outsider, 'select * from bob.project_room_dimensions'), [])
  await reject(search(outsider, 'room_dimensions'), /project_denied/)
  await reject(search(two, 'room_dimensions'), /project_denied/)
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await owner("select has_table_privilege($1,'bob.project_room_dimensions','insert') ok", [role]))[0].ok, false)
  }
  assert.equal((await owner("select has_table_privilege('anon','bob.project_room_dimensions','select') ok"))[0].ok, false)
  assert((await owner("select reloptions from pg_class where oid='bob.project_room_dimensions'::regclass"))[0].reloptions.includes('security_invoker=true'))
})

test("Bob's room_dimensions dataset returns room and building names with typed dimensions", async () => {
  const result = await search(one, 'room_dimensions')
  assert.deepEqual(result.records.map((r: any) => [r.name, r.building_name, r.unit]), [['Barnrum', 'Main house', 'mm'], ['Hall', 'Main house', 'mm']])
  const barn = result.records.find((r: any) => r.name === 'Barnrum')
  assert.deepEqual(barn.dimensions.slice(0, 3).map((d: any) => [d.property, d.status, d.millimetres]),
    [['room_length', 'known', '3970'], ['room_width', 'conflict', null], ['ceiling_height', 'known', '1920']])
  assert.deepEqual(barn.dimensions.map((d: any) => [d.property, d.side, d.reference]).slice(3),
    [['ceiling_height', null, 'vid dörren'], ['ceiling_height', null, 'vid fönstret'], ['opening_width', 'N', null]])
  assert.equal(barn.revision, await roomRevision(barnrum))
  // Exact room, text filter, paging contract and invalid filters.
  assert.equal((await search(one, 'room_dimensions', [null, null, null, hall, null])).records.length, 1)
  assert.deepEqual((await search(one, 'room_dimensions', ['barnrum', null, null, null, null])).records.map((r: any) => r.name), ['Barnrum'])
  await reject(search(one, 'room_dimensions', [null, 'todo', null, null, null]), /invalid_lookup/)
  await reject(search(one, 'room_dimensions', [null, null, 'areaA', null, null]), /invalid_lookup/)
  // Other datasets are v8 unchanged.
  for (const dataset of ['measurements', 'physical_space_measurements', 'physical_spaces'])
    assert.deepEqual(await search(one, dataset), (await data(one, 'select bob.search_bob_project_data_v8($1,$2,null,null,null,null,null) data', ['A', dataset])).data)
  const def = (await owner("select p.prosecdef secdef, p.proconfig cfg from pg_proc p where p.oid='bob.search_bob_project_data_v9(text,text,text,text,text,text,text)'::regprocedure"))[0]
  assert.equal(def.secdef, false); assert.deepEqual(def.cfg, ['search_path=""'])
  assert.equal((await owner("select has_function_privilege('anon','bob.search_bob_project_data_v9(text,text,text,text,text,text,text)','execute') ok"))[0].ok, false)
})

test('the catalog publishes room_dimensions once; older manifests keep their dataset list', async () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-ai-room-dimensions-catalog.ts', 'supabase/migrations/20261026130500_ai_room_dimensions_catalog.sql', '--check'])
  const catalog = (m: any) => createAiCatalogSession({ rpc: async () => { throw Error('Pinned') } }, { app: 'bob', manifest: m })
  const enumOf = (session: any) => (session.tool('search_project_data').function.parameters as any).properties.dataset.enum
  assert.deepEqual(enumOf(catalog(publishedManifest)), [...DATASETS])
  assert.deepEqual(enumOf(catalog(priorManifest)), DATASETS.filter(name => name !== 'room_dimensions'))
  assert.match((catalog(publishedManifest).tool('search_project_data').function.parameters as any).properties.dataset.description, /room_dimensions gives each room/)
  assert.deepEqual(catalog(publishedManifest).definition('tools.search_project_data').definition, catalogFixture().definition('tools.search_project_data').definition)
  assert.equal(catalog(publishedManifest).definition('tools.search_project_data').metadata.publication, 'room-dimensions-v1')
  assert.deepEqual((await owner("select shared.resolve_ai_catalog('bob',$1) m", [priorManifest.manifest_id]))[0].m, priorManifest)
  const active = async () => (await owner("select active_version_id from shared.ai_prompts where app='bob' and prompt_key='tools.search_project_data'"))[0].active_version_id
  const before = await active()
  await pg.exec(await readFile(new URL('../supabase/migrations/20261026130500_ai_room_dimensions_catalog.sql', import.meta.url), 'utf8'))
  assert.equal(await active(), before, 'Re-running is a no-op')
  const lookup = { dataset: 'room_dimensions', query: null, status: null, area_id: null, record_id: null, after_id: null }
  assert.deepEqual(parseLookup(lookup), lookup)
  assert.equal(parseLookup({ ...lookup, area_id: 'areaA' }), null)
  assert.equal(parseLookup({ ...lookup, status: 'todo' }), null)
})

test('the Barnrum script classifies exactly the owner-approved list once, mirrors snapshots and aborts on any mismatch', async () => {
  const script = await readFile(new URL('../scripts/classify-barnrum-measurements.sql', import.meta.url), 'utf8')
  const run = async () => { try { await pg.exec(script) } catch (error) { await pg.exec('rollback'); throw error } }
  const project = 'p_barnrum_vaningssang', barnHouse = u(60), room = u(61)
  await pg.exec(`insert into bob.projects(id,slug,name) values('${project}','barnrum','Barnrum: våningssäng')`)
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothBarn',$1,'Builder','BB',$2)", [project, both])
  await data(both, 'select bob.physical_building_command($1,$2,$3,$4) data', ['create', barnHouse, 0, JSON.stringify({ name: 'Villa', notes: '' })])
  await node(barnHouse, 'space', 'create', room, 0, { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', measurements: [] })
  await scope(project, u(62), { target_kind: 'building', building_id: barnHouse })
  const subjects: [string, number][] = [['Rummets exakta längd', 3970], ['Rummets exakta bredd', 2700], ['Takhöjd vid sängens placering', 1920],
    ['N-sida: fönster karm-till-karm', 1030], ['Ö-sida: fönster karm-till-karm', 1040], ['S-sida: dörrfoder-till-dörrfoder', 880],
    ['V-sida: dörrfoder-till-dörrfoder', 890], ['N-sida: N/Ö-hörn till fönsterkarm', 600], ['Ö-sida: N/Ö-hörn till fönsterkarm', 610],
    ['S-sida: S/V-murstockshörn till dörrfoder', 400], ['V-sida: N/V-hörn till dörrfoder', 300], ['V-sida: dörrfoder till murstockshörn', 1200],
    ['Garderob: djup', 600]]
  const ids = subjects.map((_, i) => u(70 + i))
  for (const [i, [subject, mm]] of subjects.entries()) if (i !== 4) await evidence('create', ids[i], 0, length(subject, mm), both, project)
  // A missing subject aborts before anything is written.
  await assert.rejects(run(), /barnrum_subject_mismatch: "Ö-sida: fönster karm-till-karm" has 0 active matches/)
  assert.equal((await owner('select count(*)::int n from bob.measurements where project_id=$1 and property is not null', [project]))[0].n, 0)
  await evidence('create', ids[4], 0, length(subjects[4][0], subjects[4][1]), both, project)
  await node(barnHouse, 'space', 'revise', room, 1, { name: 'Barnrum', kind: 'bedroom', truth: 'unknown', change_note: 'Measured', measurements: ids.map(id => ({ id, revision: 1 })) })
  const revisions = (await owner('select count(*)::int n from bob.measurement_revisions where project_id=$1', [project]))[0].n

  await run()
  const saved = await owner(`select r.subject,h.property,h.side,h.reference,h.classified_by,h.classified_actor,h.current_revision from bob.measurements h
    join bob.measurement_revisions r on r.measurement_id=h.id and r.revision=h.current_revision where h.project_id=$1 order by h.id`, [project])
  assert.deepEqual(saved.map(r => [r.subject, r.property, r.side, r.reference]), [
    ['Rummets exakta längd', 'room_length', null, null], ['Rummets exakta bredd', 'room_width', null, null], ['Takhöjd vid sängens placering', 'ceiling_height', null, null],
    ['N-sida: fönster karm-till-karm', 'opening_width', 'N', null], ['Ö-sida: fönster karm-till-karm', 'opening_width', 'E', null],
    ['S-sida: dörrfoder-till-dörrfoder', 'opening_width', 'S', 'foder till foder'], ['V-sida: dörrfoder-till-dörrfoder', 'opening_width', 'W', 'foder till foder'],
    ['N-sida: N/Ö-hörn till fönsterkarm', 'opening_offset', 'N', 'N/Ö-hörn'], ['Ö-sida: N/Ö-hörn till fönsterkarm', 'opening_offset', 'E', 'N/Ö-hörn'],
    ['S-sida: S/V-murstockshörn till dörrfoder', 'opening_offset', 'S', 'S/V-murstockshörn'], ['V-sida: N/V-hörn till dörrfoder', 'opening_offset', 'W', 'N/V-hörn'],
    ['V-sida: dörrfoder till murstockshörn', 'opening_offset', 'W', 'murstockshörn'], ['Garderob: djup', null, null, null],
  ])
  assert(saved.slice(0, 12).every(r => r.classified_by === null && r.classified_actor === 'Owner-approved classification 2026-10-26' && r.current_revision === 1))
  assert.equal((await owner('select count(*)::int n from bob.measurement_revisions where project_id=$1', [project]))[0].n, revisions, 'No revision is added')
  assert.equal((await snapshotsOf(room)).filter(r => r.property).length, 12, 'Room snapshots mirror the classification')
  assert.deepEqual((await dims(both, project, room)).filter(r => !r.side && !r.reference).map(r => [r.property, r.status, r.millimetres]),
    [['ceiling_height', 'known', '1920'], ['room_length', 'known', '3970'], ['room_width', 'known', '2700']])
  // Re-running is a no-op; a changed value aborts and leaves everything as it was.
  await run()
  assert.equal((await owner('select count(*)::int n from bob.measurement_revisions where project_id=$1', [project]))[0].n, revisions)
  await evidence('revise', ids[1], 1, { ...length('Rummets exakta bredd', 2710), change_note: 'Re-measured' }, both, project)
  await assert.rejects(run(), /barnrum_value_mismatch: "Rummets exakta bredd" is 2710 mm, expected 2700 mm/)
  assert.equal((await owner('select property from bob.measurements where id=$1', [ids[1]]))[0].property, 'room_width')
})
