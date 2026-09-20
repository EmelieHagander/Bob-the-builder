import { createMediaAdapter } from '../supabase/functions/_shared/project-context/media.ts'
import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Real migrations/RLS. Local Storage rows emulate API metadata writes, not S3.
const pg = new PGlite()
const one = '00000000-0000-0000-0000-000000000001'
const two = '00000000-0000-0000-0000-000000000002'
const both = '00000000-0000-0000-0000-000000000003'
const outsider = '00000000-0000-0000-0000-000000000004'
const imageId = (n: number) => '10000000-0000-0000-0000-' + String(n).padStart(12, '0')
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated') {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
async function media(uid: string | null, project: string, action: string, id: string, data = {}) {
  return (await as(uid, 'select bob.media_command($1,$2,$3,$4) as data', [project, action, id, JSON.stringify(data)])).rows[0].data
}
const reservation = (kind = 'area', target = 'areaA') => ({
  original_name: 'entry.png', title: 'Entry before work', purpose: 'current_state',
  content_type: 'image/png', byte_size: 123, width: 320, height: 480,
  target_kind: kind, target_id: target,
})
async function upload(uid: string, id: string, project = 'A', size = 123) {
  return as(uid, "insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,$2)",
    [project + '/' + id, JSON.stringify({ size, mimetype: 'image/png' })])
}
async function steps(uid: string, action: string, step: string | null = null, data = {}, project = 'A', task = 'taskA') {
  return as(uid, 'select bob.task_steps_command($1,$2,$3,$4,$5)', [project, task, action, step, JSON.stringify(data)])
}
async function stepRows() { return (await as(one, "select * from bob.task_steps where task_id='taskA' order by position")).rows as any[] }

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
    // Broader than production: Bob's restrictive guards must still win.
    'create policy unrelated_broad_objects on storage.objects for all to anon,authenticated using(true) with check(true);',
    'create policy unrelated_broad_buckets on storage.buckets for all to anon,authenticated using(true) with check(true);',
    "insert into storage.buckets(id,name) values('other-app','other-app');",
  ].join('\n'))
  for (const [i, uid] of [one, two, both, outsider].entries()) await pg.query('insert into auth.users values($1,$2,now())', [uid, 'person' + i + '@example.test'])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, legacy), 'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Porch A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)", [one, two])
  await setupSharedSocial(pg)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, dir), 'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1)", [both])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','entry','Entry'),('areaB','B','private','Private'); insert into bob.tasks(id,area_id,name) values('taskA','areaA','Prepare opening'),('taskB','areaB','Private work')")
})
after(() => pg.close())

test('image adapter consumes actual caller-RLS media/storage rows and cannot widen the explicit project', async () => {
  const a=imageId(51),b=imageId(52),pending=imageId(53)
  for(const [id,project]of[[a,'A'],[b,'B'],[pending,'A']]) {
    await media(both,project,'reserve',id,{...reservation(),target_kind:'project',target_id:project,byte_size:8})
    if(id!==pending){await upload(both,id,project,8);await media(both,project,'finalize',id)}
  }
  let downloads=0
  const rows=async (sql:string,args:unknown[]=[])=> (await as(both,sql,args)).rows as any[]
  const adapter=createMediaAdapter('A',{
    count:async()=>Number((await rows("select count(*) from bob.media_assets where project_id='A' and state='ready'"))[0].count),
    list:async()=> (await rows("select to_jsonb(m) as row from bob.media_assets m where project_id='A' and state='ready' order by id limit 13")).map(x=>x.row),
    read:async id=>(await rows("select to_jsonb(m) as row from bob.media_assets m where project_id='A' and id=$1 and state='ready'",[id]))[0]?.row??null,
    download:async row=>{
      assert.equal((await rows("select name from storage.objects where bucket_id=$1 and name=$2",[row.bucket_id,row.object_path])).length,1)
      downloads++;return Uint8Array.from([137,80,78,71,13,10,26,10])
    },
  })
  const signal=new AbortController().signal
  const list=await adapter.list({category:'images',query:null,area_id:null,after_id:null},signal)
  assert.deepEqual(list.items.map(i=>i.ref),[`image:${a}`]);assert.equal(downloads,0)
  const opened=await adapter.open(`image:${a}`,signal);assert.equal(downloads,1)
  assert.equal(opened.source.dataset,'image_pixels');assert.equal(opened.source.projectId,'A')
  await assert.rejects(adapter.open(`image:${b}`,signal),'Even membership of B is not authority to read B in an A turn')
  await assert.rejects(adapter.open(`image:${pending}`,signal));assert.equal(downloads,1)
  await pg.exec("delete from bob.people where id='bothA'")
  assert.equal(await adapter.current(`image:${a}`,opened.version,signal),false)
  await assert.rejects(adapter.open(`image:${a}`,signal));assert.equal(downloads,1)
})
