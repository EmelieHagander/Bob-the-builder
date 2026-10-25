import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from './support/pglite.ts'

const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'
const two = '00000000-0000-0000-0000-000000000002'
const both = '00000000-0000-0000-0000-000000000003'
const outsider = '00000000-0000-0000-0000-000000000004'
const u = (n: number) => '30000000-0000-0000-0000-' + String(n).padStart(12, '0')

async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
async function site(action: string, id: string, expected: number, data: any = {}, uid = both) {
  return (await as(uid, 'select bob.physical_site_command($1,$2,$3,$4) data', [action,id,expected,JSON.stringify(data)])).rows[0].data as any
}
async function building(action: string, id: string, expected: number, data: any = {}, uid = both) {
  return (await as(uid, 'select bob.physical_building_command($1,$2,$3,$4) data', [action,id,expected,JSON.stringify(data)])).rows[0].data as any
}
async function node(buildingId: string, kind: string, action: string, id: string, expected: number, data: any = {}, uid = both) {
  return (await as(uid, 'select bob.physical_node_command($1,$2,$3,$4,$5,$6) data', [buildingId,kind,action,id,expected,JSON.stringify(data)])).rows[0].data as any
}
async function scope(project: string, kind: string, action: string, id: string, data: any = {}, uid = both) {
  return (await as(uid, 'select bob.physical_scope_command($1,$2,$3,$4,$5) data', [project,kind,action,id,JSON.stringify(data)])).rows[0].data as any
}
async function evidence(action: string, id: string, expected: number, data: any, project = 'A', uid = both) {
  return (await as(uid, "select bob.evidence_command($1,'measurement',$2,$3,$4,$5) data", [project,action,id,expected,JSON.stringify(data)])).rows[0].data as any
}
const length = (data: any = {}) => ({ subject: 'Room width', value: null, unit: 'mm', truth: 'unknown', source: '', required: true, ...data })

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
    'create policy unrelated_broad_objects on storage.objects for all to anon,authenticated using(true) with check(true);',
    'create policy unrelated_broad_buckets on storage.buckets for all to anon,authenticated using(true) with check(true);',
    "insert into storage.buckets(id,name) values('other-app','other-app');",
  ].join('\n'))
  for (const [i, uid] of [one,two,both,outsider].entries()) await pg.query('insert into auth.users values($1,$2,now())',[uid,'physical'+i+'@example.test'])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,legacy),'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Bunk bed'),('B','b','Garage work')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)",[one,two])
  await setupSharedSocial(pg)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,dir),'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Builder','BA',$1),('bothB','B','Builder','BB',$1)",[both])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','child-room','Children room work'),('areaB','B','garage','Garage work')")
})
after(() => pg.close())

// Owner decision 2026-10-25: a project links a whole Building, then marks its
// rooms; Areas map to rooms of that Building. Building links still need a
// Building editor; room marks and Area rooms need project access only.
const reject = (p: Promise<unknown>, pattern: RegExp) => assert.rejects(p, pattern)
const rows = async (sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as any[]

test('a room mark and an Area room need the whole-building link, then any project member may set them', async () => {
  await site('create',u(1),0,{ name:'Home site', notes:'' })
  await building('create',u(2),0,{ site_id:u(1), name:'Main house', notes:'' })
  await node(u(2),'level','create',u(3),0,{ name:'Ground floor', position:0 })
  await node(u(2),'space','create',u(4),0,{ name:'Bathroom', kind:'bathroom', level_id:u(3), truth:'unknown', measurements:[] })
  await node(u(2),'space','create',u(5),0,{ name:'Hall', kind:'hall', level_id:u(3), truth:'unknown', measurements:[] })
  const room = { target_kind:'space', building_id:u(2), space_id:u(4) }
  await reject(scope('A','project','link',u(10),room,one),/building_not_linked/)
  await reject(scope('A','area','link',u(11),{ area_id:'areaA', ...room },one),/building_not_linked/)
  // Linking the whole Building shares it with every member, so it needs a Building editor.
  await reject(scope('A','project','link',u(12),{ target_kind:'building', building_id:u(2) },one),/building_denied/)
  const linked = await scope('A','project','link',u(12),{ target_kind:'building', building_id:u(2) })
  assert.equal(linked.id,u(12))
  assert.deepEqual(await scope('A','project','link',u(13),{ target_kind:'building', building_id:u(2) }),{ id:u(12), target_kind:'building', existing:true })
  // A plain member (not a Building editor) marks rooms and maps an Area.
  assert.equal((await scope('A','project','link',u(10),room,one)).id,u(10))
  assert.deepEqual(await scope('A','project','link',u(14),room,one),{ id:u(10), target_kind:'space', existing:true })
  assert.equal((await scope('A','area','link',u(11),{ area_id:'areaA', ...room },one)).id,u(11))
  assert.deepEqual(await scope('A','area','link',u(15),{ area_id:'areaA', ...room },one),{ id:u(11), target_kind:'space', existing:true })
  assert.equal((await as(one,"select count(*)::int n from bob.project_physical_scope where project_id='A' and target_kind='space'")).rows[0].n,1)
  assert.equal((await as(one,"select space_id from bob.area_physical_targets where area_id='areaA'")).rows[0].space_id,u(4))
  // Boundaries: another project's Area, a room of another Building, non-members.
  await reject(scope('A','area','link',u(16),{ area_id:'areaB', ...room },one),/project_denied/)
  await building('create',u(20),0,{ name:'Shed', notes:'' })
  await node(u(20),'space','create',u(21),0,{ name:'Shed room', kind:'storage', truth:'unknown', measurements:[] })
  await reject(scope('A','project','link',u(17),{ target_kind:'space', building_id:u(2), space_id:u(21) },one),/building_denied/)
  await reject(scope('A','project','link',u(17),{ target_kind:'space', building_id:u(20), space_id:u(21) },one),/building_not_linked/)
  await reject(scope('A','project','link',u(18),room,two),/project_denied/)
  await reject(scope('A','project','link',u(18),room,outsider),/project_denied/)
  await reject(scope('A','area','link',u(19),{ area_id:'areaA', target_kind:'site', site_id:u(1) },one),/Unsupported area target fields/)
})

test('unlinking the whole Building removes its room marks and Area rooms, unless the Site still covers it', async () => {
  // Site coverage keeps the Building whole for this project.
  const siteScope = await scope('A','project','link',u(30),{ target_kind:'site', site_id:u(1) })
  assert.equal(siteScope.id,u(30))
  let removed = await scope('A','project','unlink',u(12),{},one)
  assert.deepEqual(removed,{ id:u(12), removed:true, removed_rooms:0, removed_area_targets:0 })
  assert.equal((await rows("select count(*)::int n from bob.project_physical_scope where project_id='A' and target_kind='space'"))[0].n,1)
  // An older room-only row elsewhere is not touched by this cleanup.
  await pg.query("insert into bob.project_physical_scope(id,project_id,target_kind,building_id,space_id,created_by) values($1,'A','space',$2,$3,$4)",[u(31),u(20),u(21),both])
  removed = await scope('A','project','unlink',u(30),{},one)
  assert.deepEqual(removed,{ id:u(30), removed:true, removed_rooms:1, removed_area_targets:1 })
  assert.deepEqual((await rows("select id from bob.project_physical_scope where project_id='A' order by id")).map(r=>r.id),[u(31)])
  assert.equal((await rows("select count(*)::int n from bob.area_physical_targets where project_id='A'"))[0].n,0)
  // Project B keeps its own links to the same Building.
  await scope('B','project','link',u(40),{ target_kind:'building', building_id:u(2) })
  await scope('B','project','link',u(41),{ target_kind:'space', building_id:u(2), space_id:u(5) },two)
  await scope('A','project','link',u(42),{ target_kind:'building', building_id:u(2) })
  await scope('A','project','link',u(43),{ target_kind:'space', building_id:u(2), space_id:u(5) },one)
  assert.equal((await scope('A','project','unlink',u(42),{},one)).removed_rooms,1)
  assert.deepEqual((await rows("select id from bob.project_physical_scope where project_id='B' order by id")).map(r=>r.id),[u(40),u(41)])
  // Unlinking a missing row or another project's row removes nothing.
  assert.deepEqual(await scope('A','project','unlink',u(40),{},one),{ id:u(40), removed:true, removed_rooms:0, removed_area_targets:0 })
  assert.equal((await rows("select count(*)::int n from bob.project_physical_scope where id=$1",[u(40)]))[0].n,1)
})

test('the command keeps its privileges: no direct table writes, wrapper executable by members only', async () => {
  for (const role of ['anon','authenticated']) {
    assert.equal((await pg.query("select has_function_privilege($1,'bob_private.project_targets_whole_building(text,uuid)','execute') ok",[role])).rows[0].ok,false)
    assert.equal((await pg.query("select has_table_privilege($1,'bob.project_physical_scope','insert') ok",[role])).rows[0].ok,false)
    assert.equal((await pg.query("select has_table_privilege($1,'bob.area_physical_targets','delete') ok",[role])).rows[0].ok,false)
  }
  const def = (await pg.query("select p.prosecdef secdef, p.proconfig cfg from pg_proc p where p.oid='bob_private.physical_scope_command(text,text,text,uuid,jsonb)'::regprocedure")).rows[0] as any
  assert.equal(def.secdef,true);assert.deepEqual(def.cfg,['search_path=""'])
  await reject(as(null,"select bob.physical_scope_command('A','project','link',$1,$2)",[u(50),JSON.stringify({ target_kind:'building', building_id:u(2) })],'anon'),/permission denied|project_denied/)
})
