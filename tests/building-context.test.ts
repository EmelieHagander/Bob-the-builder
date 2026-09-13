import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

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
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,dir),'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Builder','BA',$1),('bothB','B','Builder','BB',$1)",[both])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','child-room','Children room work'),('areaB','B','garage','Garage work')")
})
after(() => pg.close())

test('fixture A: physical context exists before a renovation project scopes it', async () => {
  await site('create',u(1),0,{ name:'Home site', notes:'Persistent property context' })
  await building('create',u(2),0,{ site_id:u(1), name:'Main house', notes:'Exists independently of projects' })
  await node(u(2),'level','create',u(3),0,{ name:'Ground floor', position:0 })
  await node(u(2),'space','create',u(4),0,{ name:"Children's room", kind:'bedroom', level_id:u(3), truth:'unknown', measurements:[] })
  await node(u(2),'space','create',u(5),0,{ name:'Office', kind:'office', level_id:u(3), truth:'unknown', measurements:[] })

  assert.equal((await as(one,'select * from bob.current_buildings')).rows.length,0,'project membership is not implicit building access')
  assert.equal((await as(both,'select name from bob.current_spaces where building_id=$1 order by name',[u(2)])).rows.length,2)

  await scope('A','project','link',u(30),{ target_kind:'building', building_id:u(2) })
  const names = (await as(one,"select name from bob.project_spaces where project_id='A' order by name")).rows.map(r=>r.name)
  assert.deepEqual(names,["Children's room",'Office'])
  assert.equal((await as(one,'select * from bob.current_buildings where id=$1',[u(2)])).rows.length,1,'explicit project scope grants contextual read')
})

test('fixture B: one room can gain exact dimensions and a later inferred neighbour without fake fact promotion', async () => {
  await evidence('create',u(40),0,length({ area_id:'areaA' }))
  await evidence('revise',u(40),1,length({ value:'3.250',unit:'m',truth:'measured',source:'Tape measured wall to wall',change_note:'Measured room width' }))
  await node(u(2),'space','revise',u(4),1,{
    name:"Children's room",kind:'bedroom',level_id:u(3),truth:'measured',source:'Tape measurements linked below',notes:'Only this room is measured so far',
    measurements:[{id:u(40),revision:2}],change_note:'Attach measured room width',
  })
  const snap = (await as(one,'select * from bob.space_measurement_details where space_id=$1',[u(4)])).rows[0]
  assert.equal(Number(snap.value),3.25); assert.equal(snap.unit,'m'); assert.equal(snap.measurement_revision,2)

  await evidence('revise',u(40),2,length({ value:'3260',truth:'measured',source:'Repeat tape reading',change_note:'Newer site reading' }))
  const still = (await as(one,'select * from bob.space_measurement_details where space_id=$1',[u(4)])).rows[0]
  assert.equal(Number(still.value),3.25); assert.equal(still.measurement_revision,2,'space revision pins the exact earlier fact')

  await node(u(2),'relationship','create',u(6),0,{
    subject_space_id:u(4),object_space_id:u(5),relation:'shares_boundary_with',truth:'ai_assessment',source:'Layout inference awaiting confirmation',notes:'Possible services need site check',
  })
  const relation = (await as(one,'select relation,truth,source from bob.project_relationships where project_id=$1',['A'])).rows[0]
  assert.equal(relation.relation,'shares_boundary_with'); assert.equal(relation.truth,'ai_assessment')
  assert.match(relation.source,/awaiting confirmation/)
})

test('fixture C: two buildings on one site stay isolated in explicit project context', async () => {
  await building('create',u(7),0,{ site_id:u(1), name:'Garage', notes:'Separate structure' })
  await node(u(7),'space','create',u(8),0,{ name:'Workshop bay',kind:'workshop',truth:'unknown',measurements:[] })
  await node(u(7),'element','create',u(9),0,{ space_id:u(8),kind:'outlet',name:'Bench outlet',truth:'provided_spec',source:'Electrical drawing' })
  await scope('B','project','link',u(31),{ target_kind:'building',building_id:u(7) })

  const aSpaces=(await as(both,"select building_id,name from bob.project_spaces where project_id='A' order by name")).rows
  const bSpaces=(await as(both,"select building_id,name from bob.project_spaces where project_id='B' order by name")).rows
  assert(aSpaces.every(r=>r.building_id===u(2))); assert.deepEqual(bSpaces.map(r=>r.name),['Workshop bay'])
  assert.equal((await as(both,"select * from bob.project_elements where project_id='A'")).rows.length,0)
  assert.equal((await as(both,"select name from bob.project_elements where project_id='B'")).rows[0].name,'Bench outlet')
  assert.equal((await as(outsider,'select * from bob.current_spaces')).rows.length,0)
  await assert.rejects(as(null,'select * from bob.current_spaces',[],'anon'),/permission denied/)
})

test('fixture D: proposal does not replace current physical truth until explicit acceptance', async () => {
  const before=(await as(one,'select revision,name,has_proposal from bob.current_spaces where id=$1',[u(4)])).rows[0]
  assert.equal(before.revision,2); assert.equal(before.has_proposal,false)
  await node(u(2),'space','propose',u(4),2,{
    project_id:'A',name:"Children's room + alcove",kind:'bedroom',level_id:u(3),truth:'estimated',source:'Renovation proposal',notes:'Proposed enlarged room',measurements:[],change_note:'Open wall toward alcove',
  })
  const current=(await as(one,'select revision,name,has_proposal,latest_revision from bob.current_spaces where id=$1',[u(4)])).rows[0]
  assert.equal(current.name,"Children's room"); assert.equal(current.revision,2); assert.equal(current.latest_revision,3); assert.equal(current.has_proposal,true)
  const proposed=(await as(one,'select revision,name,state from bob.latest_space_proposals where id=$1',[u(4)])).rows[0]
  assert.equal(proposed.name,"Children's room + alcove"); assert.equal(proposed.state,'proposed')

  await node(u(2),'space','accept',u(4),3,{})
  const accepted=(await as(one,'select revision,name,has_proposal from bob.current_spaces where id=$1',[u(4)])).rows[0]
  assert.equal(accepted.revision,4); assert.equal(accepted.name,"Children's room + alcove"); assert.equal(accepted.has_proposal,false)
  const history=(await as(one,'select revision,state,name from bob.space_revisions where space_id=$1 order by revision',[u(4)])).rows
  assert.deepEqual(history.map(r=>r.state),['accepted','accepted','proposed','accepted'])
  assert.equal(history[1].name,"Children's room"); assert.equal(history[2].name,"Children's room + alcove")
})

test('authority, stale writes and forged parents/actors fail at the backend boundary', async () => {
  await assert.rejects(node(u(2),'space','revise',u(4),4,{ name:'Denied',kind:'room',truth:'unknown',measurements:[],change_note:'No direct building authority' },one),/building_denied/)
  await assert.rejects(node(u(2),'space','propose',u(4),4,{ project_id:'B',name:'Wrong project',kind:'room',truth:'unknown',measurements:[],change_note:'Cross building proposal' }),/project_denied/)
  await assert.rejects(node(u(2),'space','propose',u(4),3,{ project_id:'A',name:'Stale',kind:'room',truth:'unknown',measurements:[],change_note:'Stale' }),/Space changed/)
  await assert.rejects(node(u(2),'space','propose',u(4),4,{ project_id:'A',name:'Spoof',kind:'room',truth:'unknown',measurements:[],recorded_by:outsider,change_note:'Spoof' }),/Unsupported space fields/)
  for (const sql of [
    "update bob.space_revisions set name='raw'",'delete from bob.building_spaces',"insert into bob.building_members(building_id,auth_user_id) values('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004')",
  ]) await assert.rejects(as(both,sql),/permission denied/)
})

test('Area mapping is project-owned and deleting work zones does not delete persistent physical context', async () => {
  await scope('A','area','link',u(32),{ area_id:'areaA',target_kind:'space',building_id:u(2),space_id:u(4) })
  assert.equal((await as(one,"select * from bob.area_physical_targets where project_id='A' and area_id='areaA'")).rows.length,1)
  await as(one,"delete from bob.areas where id='areaA'")
  assert.equal((await as(both,"select * from bob.area_physical_targets where project_id='A'")).rows.length,0)
  assert.equal((await as(both,'select name from bob.current_spaces where id=$1',[u(4)])).rows[0].name,"Children's room + alcove")
})

test('explicit physical deletion requires direct authority, archived state and detached project context', async () => {
  const siteId=u(50), buildingId=u(51), scopeId=u(52)
  await site('create',siteId,0,{ name:'Disposable delete site', notes:'Deletion boundary fixture' })
  await building('create',buildingId,0,{ site_id:siteId, name:'Disposable delete building', notes:'Deletion boundary fixture' })

  await assert.rejects(building('delete',buildingId,1,{},outsider),/building_denied/)
  await assert.rejects(building('delete',buildingId,1,{}),/Archive building before deleting/)

  await scope('A','project','link',scopeId,{ target_kind:'building', building_id:buildingId })
  await building('archive',buildingId,1,{})
  await assert.rejects(building('delete',buildingId,2,{},one),/building_denied/,'project context does not grant persistent delete authority')
  await assert.rejects(building('delete',buildingId,2,{}),/still used by a project/)

  await site('archive',siteId,1,{})
  await assert.rejects(site('delete',siteId,2,{}),/still contains buildings/)

  await scope('A','project','unlink',scopeId,{})
  await assert.rejects(building('delete',buildingId,1,{}),/Building changed/,'stale physical delete is denied')
  const removedBuilding=await building('delete',buildingId,2,{})
  assert.equal(removedBuilding.removed,true)
  assert.equal((await as(both,'select * from bob.buildings where id=$1',[buildingId])).rows.length,0)

  const removedSite=await site('delete',siteId,2,{})
  assert.equal(removedSite.removed,true)
  assert.equal((await as(both,'select * from bob.sites where id=$1',[siteId])).rows.length,0)
})
