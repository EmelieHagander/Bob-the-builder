import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'
import { parseLookup } from '../supabase/functions/_shared/project-lookup.ts'

const pg = new PGlite(), user = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002'
const query = async (area: string | null = null, id: string | null = null, after: string | null = null) => pg.transaction(async tx => {
  await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:user})])
  await tx.exec('set local role authenticated')
  return (await tx.query<any>('select bob.search_bob_project_data_v2($1,$2,null,null,$3,$4,$5) d', ['A','target',area,id,after])).rows[0].d
})
before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated; grant all on storage.objects,storage.buckets to anon,authenticated;`)
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[user,'scope@example.test',other,'other@example.test'])
  const legacy = new URL('../db/migrations/',import.meta.url)
  for(const f of (await readdir(legacy)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,legacy),'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','A'),('B','b','B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('owner','A','Owner','OW',$1),('ownerB','B','Other','OT',$2)",[user,other])
  await setupSharedSocial(pg)
  const dir=new URL('../supabase/migrations/',import.meta.url)
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,dir),'utf8'))
  await pg.transaction(async tx=>{
    for(let i=0;i<31;i++) {
      const area=i===0?null:'area'+String(i).padStart(2,'0'), solution=randomUUID(), measurement=randomUUID()
      if(area) await tx.query('insert into bob.areas(id,project_id,slug,name) values($1,\'A\',$1,$1)',[area])
      await tx.query('insert into bob.solutions(id,project_id,area_id,current_revision) values($1,\'A\',$2,1)',[solution,area])
      await tx.query('insert into bob.solution_revisions(solution_id,project_id,revision,title,description,change_note,recorded_by,actor_label) values($1,\'A\',1,$2,$2,\'Fixture\',$3,\'Fixture\')',[solution,'Chosen '+(area??'project'),user])
      await tx.query('insert into bob.measurements(id,project_id,area_id) values($1,\'A\',$2)',[measurement,area])
      await tx.query('insert into bob.measurement_revisions(measurement_id,project_id,revision,subject,value,unit,truth,source,change_note,recorded_by,actor_label) values($1,\'A\',1,$2,70,\'cm\',\'provided_spec\',\'Fixture\',\'Fixture\',$3,\'Fixture\')',[measurement,'Width '+(area??'project'),user])
      await tx.query('insert into bob.solution_measurements(project_id,solution_id,solution_revision,measurement_id,measurement_revision) values(\'A\',$1,1,$2,1)',[solution,measurement])
      await tx.query('insert into bob.project_targets(project_id,current_revision,area_id) values(\'A\',$1,$2)',[i+1,area])
      await tx.query('insert into bob.target_revisions(project_id,revision,solution_id,solution_revision,reason,recorded_by,actor_label,area_id) values(\'A\',$1,$2,1,\'Fixture\',$3,\'Fixture\',$4)',[i+1,solution,user,area])
    }
    await tx.exec("insert into bob.areas(id,project_id,slug,name) values('unselected','A','unselected','Unselected'),('foreign','B','foreign','Foreign')")
  })
})
after(()=>pg.close())

test('target research pages keep Project and Area choices uniquely identified with scoped evidence',async()=>{
  const first=await query();assert.equal(first.records.length,25);assert(first.next_cursor)
  const next=await query(null,null,first.next_cursor);assert.equal(next.records.length,6);assert.equal(next.next_cursor,null)
  assert.equal(new Set([...first.records,...next.records].map((r:any)=>r.id)).size,31)
  for(const page of [first,next]) assert(page.related.every((r:any)=>page.records.some((p:any)=>p.id===r.parent_id&&p.area_id===r.area_id)))
  const project=await query(null,'project');assert.equal(project.records.length,1);assert.equal(project.records[0].area_id,null)
  assert.equal(project.related.length,1);assert.equal(project.related[0].subject,'Width project')
  const area=await query('area01');assert.equal(area.records.length,1);assert.equal(area.records[0].id,'area:area01')
  assert.equal(area.related.length,1);assert.equal(area.related[0].subject,'Width area01')
  assert(parseLookup({dataset:'target',query:null,status:null,record_id:null,area_id:'area01',after_id:null}))
})

test('an explicitly cleared Area does not become the Project target or leak another Area evidence',async()=>{
  await pg.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user})]);await tx.exec('set local role authenticated')
    await tx.query("select bob.solution_command('A','clear',null,2,$1)",[JSON.stringify({area_id:'area01',reason:'Clear this Area only'})])
  })
  const cleared=await query('area01');assert.equal(cleared.records.length,1);assert.equal(cleared.records[0].solution_id,null);assert.equal(cleared.related.length,0)
  assert.equal((await query(null,'project')).records[0].description,'Chosen project')
  assert.equal((await query('area02')).records[0].description,'Chosen area02')
  assert.equal((await query('unselected')).records.length,0)
  assert.equal((await query('foreign')).records.length,0)
})
