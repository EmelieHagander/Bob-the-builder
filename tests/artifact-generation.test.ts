import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'
const two = '00000000-0000-0000-0000-000000000002'
const both = '00000000-0000-0000-0000-000000000003'
const outsider = '00000000-0000-0000-0000-000000000004'
const u = (n: number) => '50000000-0000-0000-0000-' + String(n).padStart(12, '0')

async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
async function site(id: string, data: any, uid = one) {
  return (await as(uid, 'select bob.physical_site_command($1,$2,$3,$4) data', ['create',id,0,JSON.stringify(data)])).rows[0].data as any
}
async function building(id: string, data: any, uid = one) {
  return (await as(uid, 'select bob.physical_building_command($1,$2,$3,$4) data', ['create',id,0,JSON.stringify(data)])).rows[0].data as any
}
async function node(buildingId: string, action: string, id: string, expected: number, data: any, uid = one) {
  return (await as(uid, 'select bob.physical_node_command($1,$2,$3,$4,$5,$6) data', [buildingId,'space',action,id,expected,JSON.stringify(data)])).rows[0].data as any
}
async function scope(project: string, id: string, buildingId: string, uid = one) {
  return (await as(uid, 'select bob.physical_scope_command($1,$2,$3,$4,$5) data', [project,'project','link',id,JSON.stringify({ target_kind:'building',building_id:buildingId })])).rows[0].data as any
}
async function fact(project: string, uid: string, action: string, id: string, expected: number, data: any) {
  const payload = action === 'revise' && !('change_note' in data) ? { ...data, change_note: 'Fixture measurement update' } : data
  return (await as(uid, "select bob.evidence_command($1,'measurement',$2,$3,$4,$5) data", [project,action,id,expected,JSON.stringify(payload)])).rows[0].data as any
}
async function solution(project: string, uid: string, action: string, id: string | null, expected: number, data: any) {
  return (await as(uid, 'select bob.solution_command($1,$2,$3,$4,$5) data', [project,action,id,expected,JSON.stringify(data)])).rows[0].data as any
}
async function generate(project: string, uid: string, action: string, artifactId: string, expected: number, data: any) {
  return (await as(uid, 'select bob.artifact_geometry_command($1,$2,$3,$4,$5) data', [project,action,artifactId,expected,JSON.stringify(data)])).rows[0].data as any
}
async function artifact(project: string, uid: string, action: string, id: string, expected: number, data: any = {}) {
  return (await as(uid, 'select bob.artifact_command($1,$2,$3,$4,$5) data', [project,action,id,expected,JSON.stringify(data)])).rows[0].data as any
}

const m = (subject: string, value: string | null, truth = 'measured') => ({
  subject, value, unit: 'mm', truth, source: truth === 'unknown' ? '' : truth === 'estimated' ? 'Rough estimate' : 'Tape measured', required: true,
})
const proposal = { title:'Stud wall', description:'Frame one wall with an opening.', assumptions:'Header still requires structural judgement.', tradeoffs:'Narrow V1 fixture' }
const measureIds = {
  wall_width:u(20), wall_height:u(21), opening_left:u(22), opening_sill_height:u(23), opening_width:u(24), opening_height:u(25),
}
const values: Record<keyof typeof measureIds,string> = {
  wall_width:'4200', wall_height:'2400', opening_left:'900', opening_sill_height:'850', opening_width:'1200', opening_height:'1200',
}
const inputRefs = (revisions: Partial<Record<keyof typeof measureIds,number>> = {}) => Object.fromEntries(
  Object.entries(measureIds).map(([role,id]) => [role,{ id, revision: revisions[role as keyof typeof measureIds] ?? 1 }]),
)
const generated = (spaceId: string, buildingId: string, extra: Record<string, unknown> = {}) => ({
  title:'Stud wall elevation', description:'Deterministic elevation of the selected wall and opening.', status:'measured', assumptions:'Opening framing is conceptual.',
  source_media_id:null, target_revision:1, area_id:'areaA', building_id:buildingId, space_id:spaceId, space_revision:1,
  stud_spacing_mm:600, inputs:inputRefs(), ...extra,
})

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
  for (const [i, uid] of [one,two,both,outsider].entries()) await pg.query('insert into auth.users values($1,$2,now())',[uid,'geometry'+i+'@example.test'])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,legacy),'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Wall A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)",[one,two])
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,dir),'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1)",[both])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','wall','Wall work'),('areaB','B','private','Private')")

  await site(u(1),{name:'Home'})
  await building(u(2),{site_id:u(1),name:'Main house'})
  await node(u(2),'create',u(3),0,{name:'Children room',kind:'bedroom',truth:'unknown',measurements:[]})
  await scope('A',u(4),u(2))

  for (const [role,id] of Object.entries(measureIds)) await fact('A',one,'create',id,0,m(role.replaceAll('_',' '),values[role as keyof typeof values]))
  await solution('A',one,'create',u(10),0,{...proposal,area_id:'areaA'})
  await solution('A',one,'select',u(10),0,{solution_revision:1,reason:'Use stud wall fixture'})
})
after(() => pg.close())

test('generated artifact stores exact physical target and role-mapped measurement revisions', async () => {
  await generate('A',one,'create',u(30),0,generated(u(3),u(2)))
  const recipe=(await as(one,'select * from bob.artifact_generation_details where artifact_id=$1 and artifact_revision=1',[u(30)])).rows[0] as any
  assert.equal(recipe.generator,'stud_wall_opening_v1')
  assert.equal(recipe.generator_version,1)
  assert.equal(recipe.space_id,u(3)); assert.equal(recipe.space_revision,1); assert.equal(recipe.current_space_revision,1)
  assert.equal(recipe.parameters.stud_spacing_mm,600)
  const inputs=(await as(one,'select role,measurement_id,measurement_revision,value,truth from bob.artifact_geometry_input_details where artifact_id=$1 order by role',[u(30)])).rows as any[]
  assert.equal(inputs.length,6)
  assert.deepEqual(new Set(inputs.map(row=>row.role)),new Set(Object.keys(measureIds)))
  assert(inputs.every(row=>row.measurement_revision===1 && row.truth==='measured'))
  const current=(await as(one,'select generator,generator_version,kind,status from bob.current_artifacts where id=$1',[u(30)])).rows[0] as any
  assert.deepEqual(current,{generator:'stud_wall_opening_v1',generator_version:1,kind:'elevation',status:'measured'})
})

test('unscoped physical targets and foreign project measurements are rejected', async () => {
  await building(u(5),{name:'Unscoped shed'},both)
  await node(u(5),'create',u(6),0,{name:'Shed',kind:'shed',truth:'unknown',measurements:[]},both)
  await assert.rejects(generate('A',both,'create',u(31),0,generated(u(6),u(5))),/Physical Space version unavailable/)

  await fact('B',two,'create',u(40),0,m('private width','1000'))
  await assert.rejects(generate('A',both,'create',u(31),0,generated(u(3),u(2),{
    inputs:{...inputRefs(),wall_width:{id:u(40),revision:1}},
  })),/Geometry measurement version unavailable/)
})

test('unknown geometry fails and estimates stay concept-only', async () => {
  await fact('A',one,'create',u(41),0,m('unknown opening',null,'unknown'))
  await assert.rejects(generate('A',one,'create',u(32),0,generated(u(3),u(2),{
    inputs:{...inputRefs(),opening_width:{id:u(41),revision:1}},
  })),/Unknown measurements cannot generate geometry/)

  await fact('A',one,'create',u(42),0,m('estimated opening','1190','estimated'))
  const estimatedInputs={...inputRefs(),opening_width:{id:u(42),revision:1}}
  await assert.rejects(generate('A',one,'create',u(32),0,generated(u(3),u(2),{inputs:estimatedInputs,status:'measured'})),/must stay Concept/)
  await generate('A',one,'create',u(32),0,generated(u(3),u(2),{inputs:estimatedInputs,status:'concept'}))
  assert.equal((await as(one,'select status from bob.current_artifacts where id=$1',[u(32)])).rows[0].status,'concept')
})

test('old generation stays pinned after measurements and accepted physical state change', async () => {
  await fact('A',one,'revise',measureIds.opening_width,1,m('opening width','1210','measured'))
  await node(u(2),'revise',u(3),1,{name:'Children room revised',kind:'bedroom',truth:'unknown',measurements:[],change_note:'Rename room'})
  const old=(await as(one,'select space_revision,current_space_revision from bob.artifact_generation_details where artifact_id=$1 and artifact_revision=1',[u(30)])).rows[0] as any
  assert.equal(old.space_revision,1); assert.equal(old.current_space_revision,2)
  const width=(await as(one,"select measurement_revision,value,latest_revision from bob.artifact_geometry_input_details where artifact_id=$1 and artifact_revision=1 and role='opening_width'",[u(30)])).rows[0] as any
  assert.equal(width.measurement_revision,1); assert.equal(width.value,'1200'); assert.equal(width.latest_revision,2)
})

test('archive/restore carries generation recipe while an ordinary geometry-changing revise must use Regenerate', async () => {
  await artifact('A',one,'archive',u(30),1)
  await artifact('A',one,'restore',u(30),2)
  for (const revision of [1,2,3]) {
    assert.equal((await as(one,'select count(*)::int n from bob.artifact_geometry_inputs where artifact_id=$1 and artifact_revision=$2',[u(30),revision])).rows[0].n,6)
    assert.equal((await as(one,'select generator from bob.artifact_generations where artifact_id=$1 and artifact_revision=$2',[u(30),revision])).rows[0].generator,'stud_wall_opening_v1')
  }

  const five=Object.entries(inputRefs()).slice(0,5).map(([,ref])=>ref)
  await assert.rejects(artifact('A',one,'revise',u(30),3,{
    title:'Unsafe manual geometry edit',description:'Should not drop a geometry role.',kind:'elevation',status:'measured',assumptions:'',source_media_id:null,
    target_revision:1,measurements:five,change_note:'Try to drop geometry input',
  }),/Use Regenerate/)
  assert.equal((await as(one,'select current_revision from bob.artifacts where id=$1',[u(30)])).rows[0].current_revision,3)
})

test('regeneration creates a new reproducible recipe and leaves the old recipe untouched', async () => {
  await generate('A',one,'regenerate',u(30),3,generated(u(3),u(2),{
    area_id:undefined,
    space_revision:2,
    inputs:inputRefs({opening_width:2}),
    change_note:'Use newly measured opening and current room revision',
  }))
  const old=(await as(one,"select value,measurement_revision from bob.artifact_geometry_input_details where artifact_id=$1 and artifact_revision=1 and role='opening_width'",[u(30)])).rows[0] as any
  const fresh=(await as(one,"select value,measurement_revision from bob.artifact_geometry_input_details where artifact_id=$1 and artifact_revision=4 and role='opening_width'",[u(30)])).rows[0] as any
  assert.deepEqual(old,{value:'1200',measurement_revision:1})
  assert.deepEqual(fresh,{value:'1210',measurement_revision:2})
  assert.equal((await as(one,'select space_revision from bob.artifact_generations where artifact_id=$1 and artifact_revision=4',[u(30)])).rows[0].space_revision,2)
  assert.equal((await as(one,'select current_revision from bob.artifacts where id=$1',[u(30)])).rows[0].current_revision,4)
})

test('generation tables deny raw mutation and outsiders cannot read recipes', async () => {
  for (const table of ['artifact_generations','artifact_geometry_inputs','artifact_generation_details','artifact_geometry_input_details']) {
    assert.equal((await as(outsider,'select * from bob.'+table)).rows.length,0)
    await assert.rejects(as(null,'select * from bob.'+table,[],'anon'),/permission denied/)
  }
  await assert.rejects(as(one,"delete from bob.artifact_generations where artifact_id='"+u(30)+"'"),/permission denied/)
})
