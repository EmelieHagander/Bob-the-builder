import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'

const pg=new PGlite()
const owner='00000000-0000-0000-0000-000000000701'
const carl='00000000-0000-0000-0000-000000000702'
const outsider='00000000-0000-0000-0000-000000000703'
const id=(n:number)=>'97000000-0000-4000-8000-'+String(n).padStart(12,'0')

async function as(uid:string|null,sql:string,params:unknown[]=[],role='authenticated'){
  return pg.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid})])
    await tx.exec('set local role '+role)
    return tx.query(sql,params)
  })
}
async function server(uid:string,sql:string,params:unknown[]=[]){
  return pg.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid})])
    return tx.query(sql,params)
  })
}
async function propose(expected:number,data:any,uid=owner){
  return (await server(uid,'select bob_private.project_plan_propose($1,$2,$3) result',['A',expected,JSON.stringify(data)])).rows[0].result as any
}
async function decide(expected:number,proposal:number,action='approve',uid=owner){
  return (await server(uid,'select bob_private.project_plan_decide($1,$2,$3,$4,$5) result',['A',expected,proposal,action,'decision'])).rows[0].result as any
}
async function briefing(uid=owner){
  return (await as(uid,'select bob.project_plan_briefing($1) result',['A'])).rows[0].result as any
}
async function fact(kind:string,action:string,record:string,expected:number,data:any,uid=carl){
  return (await as(uid,'select bob.evidence_command($1,$2,$3,$4,$5,$6) result',['A',kind,action,record,expected,JSON.stringify(data)])).rows[0].result as any
}
const selector=(subject:string)=>({kind:'measurement',id:null,subject,area_id:'areaA'})
const req=(title:string,sel:any=selector(title))=>({requirement_id:null,type:'measurement',title,description:'Needed before cutting',resolution:'open',
  responsible_kind:'person',responsible_person_id:'carlA',evidence_selector:sel})
const step=(state='active',changes:any={})=>({step_id:null,title:'Verify opening',goal:'Know the real opening before framing',state,area_id:'areaA',
  responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[req('Opening width')],...changes})
const plan=(steps:any[]= [step()])=>({summary:'Measure then frame',reason:'Current project state',steps})
const measurement=(subject:string,value:string|null,truth='unknown')=>({subject,unit:'mm',value,truth,source:value?'Tape measurement':'',
  notes:'',required:true,area_id:'areaA',component_id:null,source_media_id:null,change_note:value?'Measured':'Placeholder'})

before(async()=>{
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
    'grant usage on schema storage to anon,authenticated;grant all on storage.objects,storage.buckets to anon,authenticated;',
    'create policy broad_o on storage.objects for all to anon,authenticated using(true) with check(true);',
    'create policy broad_b on storage.buckets for all to anon,authenticated using(true) with check(true);',
    "insert into storage.buckets(id,name) values('other-app','other-app');",
  ].join('\n'))
  for(const [i,u] of [owner,carl,outsider].entries()) await pg.query('insert into auth.users values($1,$2,now())',[u,'plan'+i+'@example.test'])
  const legacy=new URL('../db/migrations/',import.meta.url)
  for(const f of (await readdir(legacy)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,legacy),'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Shared porch'),('B','b','Private project')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('ownerA','A','Owner','OW',$1),('carlA','A','Carl','CA',$2),('outB','B','Out','OU',$3)",[owner,carl,outsider])
  await setupSharedSocial(pg)
  const migrations=new URL('../supabase/migrations/',import.meta.url)
  for(const f of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,migrations),'utf8'))
  await pg.exec("insert into bob.areas(id,project_id,slug,name,phase) values('areaA','A','porch','Porch','planning'),('areaB','B','private','Private','planning')")
})
after(()=>pg.close())

test('living-plan tools are core even when the Project has no lifecycle phase',async()=>{
  const project=(await as(owner,"select phase from bob.projects where id='A'")).rows[0]
  assert.equal(project.phase,null,'Legacy/unclassified projects reproduce the production null-phase case')
  const rows=(await as(owner,`select name,always_load,description from bob.tool_catalog
    where name in ('propose_project_plan','decide_project_plan','link_project_plan_evidence','save_project_task')
    order by name`)).rows as Array<{name:string;always_load:boolean;description:string}>
  assert.equal(rows.length,4)
  for(const name of ['propose_project_plan','decide_project_plan','link_project_plan_evidence']){
    const row=rows.find(r=>r.name===name)
    assert.equal(row?.always_load,true,`${name} must remain visible without a Project phase`)
  }
  assert.match(rows.find(r=>r.name==='save_project_task')?.description ?? '',/not a living Project Plan/)
})

test('shared measurement satisfies a living-plan requirement for every authorised member',async()=>{
  const proposed=await propose(0,plan())
  assert.equal(proposed.record.status,'proposed')
  assert.equal((await briefing()).status,'not_initialized')
  await decide(0,1)
  let b=await briefing()
  assert.equal(b.status,'ok');assert.equal(b.current_revision,1)
  assert.equal(b.current_step.requirements[0].status.state,'missing')

  await fact('measurement','create',id(1),0,measurement('Opening width','910','measured'))
  b=await briefing(owner)
  assert.equal(b.current_step.requirements[0].status.state,'satisfied')
  assert.equal(b.current_step.requirements[0].status.evidence[0].actor,'Carl')
  const carlView=await briefing(carl)
  assert.equal(carlView.current_step.requirements[0].status.state,'satisfied')
  assert.equal(carlView.current_step.requirements[0].status.evidence[0].value,'910')
})

test('project briefing v8 carries the compact living-plan story and plan dataset exposes exact plan',async()=>{
  const project=(await as(owner,"select bob.search_bob_project_data_v8('A','project',null,null,null,null,null) result")).rows[0].result as any
  assert.equal(project.records[0].working_plan.current_revision,1)
  assert.equal(project.records[0].working_plan.current_step.title,'Verify opening')
  const exact=(await as(owner,"select bob.search_bob_project_data_v8('A','plan',null,null,null,'1',null) result")).rows[0].result as any
  assert.equal(exact.records[0].revision,1)
  assert.equal(exact.records[0].steps[0].requirements[0].status.state,'satisfied')
  await assert.rejects(as(outsider,"select bob.search_bob_project_data_v8('A','plan',null,null,null,null,null)"),/project_denied|permission denied/)
})

test('replanning carries completed history and rejects invented stable IDs',async()=>{
  const current=(await as(owner,"select bob.project_plan_read('A',1) result")).rows[0].result.record as any
  const currentStep=current.steps[0]
  const oldReq=currentStep.requirements[0]
  const completed={step_id:currentStep.id,title:currentStep.title,goal:currentStep.goal,state:'completed',area_id:'areaA',
    responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[{
      requirement_id:oldReq.id,type:oldReq.type,title:oldReq.title,description:oldReq.description,resolution:oldReq.resolution,
      responsible_kind:oldReq.responsible_kind,responsible_person_id:oldReq.responsible_person_id,evidence_selector:oldReq.evidence_selector
    }]}
  const future={step_id:null,title:'Frame opening',goal:'Build from verified dimensions',state:'active',area_id:'areaA',
    responsible_kind:'person',responsible_person_id:'ownerA',notes:'',requirements:[]}
  const p2=await propose(1,{summary:'Measured opening, now frame',reason:'Opening width is known',steps:[completed,future]})
  await decide(1,2)
  const approved=(await as(owner,"select bob.project_plan_read('A',2) result")).rows[0].result.record as any
  assert.equal(approved.steps[0].id,currentStep.id)
  assert.equal(approved.steps[0].state,'completed')
  assert.equal(approved.steps[1].title,'Frame opening')
  await assert.rejects(propose(2,{summary:'Bad',reason:'Invented id',steps:[{...future,step_id:id(99)}]}),/plan_unknown_step_id/)
})

test('pinned evidence becomes stale after the source revision changes',async()=>{
  const approved=(await as(owner,"select bob.project_plan_read('A',2) result")).rows[0].result.record as any
  const active=approved.steps.find((s:any)=>s.state==='active')
  const noSelector={kind:'none',id:null,subject:null,area_id:null}
  const activeWrite={step_id:active.id,title:active.title,goal:active.goal,state:active.state,area_id:active.area_id,
    responsible_kind:active.responsible_kind,responsible_person_id:active.responsible_person_id,notes:active.notes,requirements:[
      {requirement_id:null,type:'measurement',title:'Pinned opening',description:'Pin exact measurement',resolution:'open',
        responsible_kind:'bob',responsible_person_id:null,evidence_selector:noSelector}
    ]}
  const p3=await propose(2,{summary:'Frame with one check',reason:'Need exact evidence pin',steps:[activeWrite]})
  await decide(2,3)
  const p=(await as(owner,"select bob.project_plan_read('A',3) result")).rows[0].result.record as any
  const q=p.steps.find((s:any)=>s.state==='active').requirements[0]
  await server(owner,'select bob_private.project_plan_link_evidence($1,$2,$3,$4,$5,$6,$7)',[
    'A',3,q.id,'measurement',id(1),1,'resolves'
  ])
  let b=await briefing()
  assert.equal(b.current_step.requirements[0].status.state,'satisfied')
  const revisedMeasurement:any=measurement('Opening width','915','measured')
  delete revisedMeasurement.area_id
  delete revisedMeasurement.component_id
  await fact('measurement','revise',id(1),1,revisedMeasurement)
  b=await briefing()
  assert.equal(b.current_step.requirements[0].status.state,'stale')
})

test('raw writes are denied while caller-scoped reads stay isolated',async()=>{
  await assert.rejects(as(owner,"insert into bob.project_plans(project_id) values('B')"),/permission denied/)
  assert.equal((await as(outsider,'select * from bob.project_plans')).rows.length,0)
  assert.equal((await as(outsider,"select * from bob.project_plan_revisions where project_id='A'")).rows.length,0)
})
