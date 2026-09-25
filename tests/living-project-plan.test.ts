import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createPlanAssistant } from '../supabase/functions/_shared/plan-assistant.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { runProjectAnswer } from './support/bob-model-routing.ts'
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
  responsible_kind:'bob',responsible_person_id:null,notes:'Lock the opening geometry before framing; measurements and requirements control completion.',requirements:[req('Opening width')],...changes})
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
  await pg.exec("insert into bob.tasks(id,area_id,name,status,instructions) values('taskA','areaA','Control-measure opening','todo','Measure the actual opening before framing.'),('taskB','areaB','Private task','todo','Private')")
})
after(()=>pg.close())

test('a whole-house plan accepts 100 Steps while rejecting 101 without changing saved state',async()=>{
 await pg.exec("insert into bob.projects(id,slug,name) values('large','large','Whole-house renovation')")
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('largeOwner','large','Owner','OW',$1)",[owner])
 const steps=Array.from({length:100},(_,i)=>step(i===0?'active':'planned',{title:`Renovation step ${i+1}`,area_id:null,phase:'planning',requirements:[]}))
 const payload={...plan(steps),task_links:[]}
 const saved:any=(await server(owner,'select bob_private.project_plan_propose($1,$2,$3) result',['large',0,JSON.stringify(payload)])).rows[0].result
 assert.equal(saved.record.steps.length,100)
 await assert.rejects(server(owner,'select bob_private.project_plan_propose($1,$2,$3)',['large',0,JSON.stringify({...payload,steps:[...steps,step('planned',{area_id:null})]})]),/plan_invalid_proposal/)
})

test('living-plan tools stay available without a Project lifecycle phase, with reviewed compilation as the core proposal path',async()=>{
  const project=(await as(owner,"select phase from bob.projects where id='A'")).rows[0]
  assert.equal(project.phase,null,'Legacy/unclassified projects reproduce the production null-phase case')
  const rows=(await as(owner,`select name,always_load,active,description from bob.tool_catalog
    where name in ('compile_project_plan','audit_project_plan','save_compiled_project_plan','propose_project_plan',
      'decide_project_plan','link_project_plan_evidence','link_project_plan_task','save_project_task')
    order by name`)).rows as Array<{name:string;always_load:boolean;active:boolean;description:string}>
  assert.equal(rows.length,8)
  for(const name of ['compile_project_plan','audit_project_plan','save_compiled_project_plan',
    'decide_project_plan','link_project_plan_evidence','link_project_plan_task']){
    const row=rows.find(r=>r.name===name)
    assert.equal(row?.active,true)
    assert.equal(row?.always_load,true,`${name} must remain visible without a Project phase`)
  }
  const manual=rows.find(r=>r.name==='propose_project_plan')
  assert.equal(manual?.active,true,'manual proposal remains an implemented fallback')
  assert.equal(manual?.always_load,false,'manual nested proposal JSON is no longer the core path')
  assert.match(rows.find(r=>r.name==='save_project_task')?.description ?? '',/not a living Project Plan/)
})

test('shared measurement satisfies a living-plan requirement for every authorised member',async()=>{
  assert.equal((await briefing()).pending_proposal,null)
  assert.equal((await briefing()).plan_needed,true)
  const proposed=await propose(0,plan())
  assert.equal(proposed.record.status,'proposed')
  const pending=await briefing()
  assert.equal(pending.status,'not_initialized')
  assert.equal(pending.plan_needed,false,'a saved proposal needs a decision, not another plan')
  assert.equal(pending.pending_proposal.revision,1)
  assert.equal(pending.pending_proposal.record_id,'1')
  assert.equal(pending.pending_proposal.based_on_revision,0)
  await assert.rejects(briefing(outsider),/project_denied|permission denied/)
  await decide(0,1)
  let b=await briefing()
  assert.equal(b.pending_proposal,null,'an approved proposal is no longer pending')
  assert.equal(b.status,'ok');assert.equal(b.current_revision,1)
  assert.equal(b.plan_spine.length,1);assert.equal(b.plan_spine[0].title,'Verify opening')
  assert.match(b.current_step.brief,/Lock the opening geometry/)
  assert.equal(b.current_step.requirements[0].status.state,'missing')
  assert.equal(b.current_step.tasks.length,0)
  await server(owner,'select bob_private.project_plan_link_task($1,$2,$3,$4,$5)',[
    'A',1,b.current_step.id,'taskA','link'
  ])
  b=await briefing()
  assert.equal(b.current_step.task_count,1)
  assert.deepEqual(b.current_step.tasks.map((t:any)=>[t.id,t.name,t.status]),[['taskA','Control-measure opening','todo']])

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
  const awaiting=await briefing()
  assert.equal(awaiting.current_revision,1,'a pending replan does not replace the approved plan')
  assert.equal(awaiting.pending_proposal.revision,2)
  assert.equal(awaiting.pending_proposal.based_on_revision,1)
  await decide(1,2)
  const approved=(await as(owner,"select bob.project_plan_read('A',2) result")).rows[0].result.record as any
  assert.equal(approved.steps[0].id,currentStep.id)
  assert.equal(approved.steps[0].state,'completed')
  assert.equal(approved.steps[1].title,'Frame opening')
  const b=await briefing()
  assert.deepEqual(b.plan_spine.map((s:any)=>[s.title,s.state]),[['Verify opening','completed'],['Frame opening','active']])
  assert.equal(b.current_step.tasks.length,0,'Task links stay with their stable Step and do not bleed into a different active Step')
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
  assert.equal((await as(outsider,"select * from bob.project_plan_step_tasks where project_id='A'")).rows.length,0)
  await assert.rejects(server(outsider,'select bob_private.project_plan_link_task($1,$2,$3,$4,$5)',[
    'A',3,(await briefing(owner)).current_step.id,'taskB','link'
  ]),/project_denied/)
})


test('Bob sees nano feedback, requests repair, rejects a mistaken veto and saves a real proposed revision through the claimed writer',async()=>{
  const project='bob-led-fixture',turn=id(900)
  await pg.query('insert into bob.projects(id,slug,name) values($1,$1,$2)',[project,'Bob-led fixture'])
  await pg.query('insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,$3,$4,$5)',[project,project,'Owner','OW',owner])
  const message='Okej, kör vidare :)'
  const claim=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',[project,owner,turn,message],'service_role')).rows[0].result as any
  assert.equal(claim.status,'claimed')
  const binding=[project,claim.thread_id,turn,claim.generation]
  const query=async(sql:string,params:unknown[])=>({data:(await as(owner,sql,params)).rows[0].result,error:null})
  const writer=createProjectWriter(project,message,
    payload=>query('select bob.bob_project_write_v8($1,$2,$3,$4,$5) result',[...binding,JSON.stringify(payload)]),
    ()=>query('select bob.bob_read_write_receipts($1,$2,$3,$4) result',binding),
    ()=>query('select bob.bob_settle_project_writes($1,$2,$3,$4) result',binding))
  const lookup=()=>createProjectLookup(project,async(_project,input)=>query(
    'select bob.search_bob_project_data_v8($1,$2,$3,$4,$5,$6,$7) result',
    [project,input.dataset,input.query,input.status,input.area_id,input.record_id,input.after_id]),10000,12)
  const usage={input_tokens:1,output_tokens:1,total_tokens:2}
  const response=(data:any)=>({success:true,data,model:'fixture',usage})
  const proposal={expected_revision:0,summary:'Kontrollera dörren',reason:'Mått och placering behöver kontrolleras',
    steps:[step('active',{area_id:null,requirements:[{...req('Centrerad dörr',{kind:'none',id:null,subject:null,area_id:null}),
      responsible_kind:'bob',responsible_person_id:null,description:'Kontrollera dörrens bredd.'}]})],task_candidates:[],observations:[]}
  const order:string[]=[]
  let compilerCalls=0,mainCalls=0
  const assistant=createPlanAssistant({projectId:project,userId:owner,hasAccess:async()=>true,makeLookup:lookup,
    callModel:async o=>{
      order.push(o.functionName!)
      if(o.functionName==='plan-compiler'){
        compilerCalls++
        if(compilerCalls===2){
          const input=JSON.parse(String(o.prompt))
          assert.match(input.plan_intent,/centrering/)
          assert.equal(input.repair_feedback.review.issues[0].code,'evidence_mismatch')
          proposal.steps[0].requirements[0].description='Kontrollera centrering mot öppningens mitt; mätning återstår.'
        }
        return response(structuredClone(proposal))
      }
      return response({ready_to_save:false,summary:'Review advice',issues:[{
        severity:'error',code:compilerCalls===1?'evidence_mismatch':'identity_mismatch',step_position:1,requirement_position:1,evidence_id:null,
        message:compilerCalls===1?'Bredd är inte centrering.':'New requirement_id is null.',suggestion:'Check this criterion.'}]})
    }})
  const result=await runProjectAnswer({projectId:project,userId:owner,message,lookup:lookup(),writer,planAssistant:assistant,hasAccess:async()=>true,
    readToolPolicy:async()=>({phase:null,tools:(await as(owner,'select * from bob.tool_catalog')).rows as any}),
    callModel:async o=>{
      mainCalls++;order.push('bob')
      const call=(name:string,args:any)=>({...response(null),responseId:'main_'+mainCalls,
        toolCalls:[{id:'call_'+mainCalls,type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
      if(mainCalls===1)return call('compile_project_plan',{plan_intent:'Kontrollera dörrens centrering.'})
      const toolResult=JSON.parse(String(o.messages?.find(m=>m.role==='tool')?.content))
      if(mainCalls===2){
        assert.ok(toolResult.review,JSON.stringify(toolResult))
        assert.equal(toolResult.review.issues[0].code,'evidence_mismatch')
        assert.equal(compilerCalls,1,'Bob must see the review before another compiler call')
        assert.equal(writer.receipts.length,0)
        return call('compile_project_plan',{plan_intent:'Behåll kravet men beskriv centrering, inte bredd. Lämna det öppet.'})
      }
      if(mainCalls===3){
        assert.equal(toolResult.review.ready_to_save,false)
        assert.equal(toolResult.server_validation.valid,true)
        assert(o.tools?.some(t=>t.function.name==='save_compiled_project_plan'),'nano cannot hide the valid save')
        return call('save_compiled_project_plan',{request_quote:message})
      }
      assert.equal(mainCalls,4);assert.equal(toolResult.status,'saved')
      assert.equal(toolResult.receipt.record.status,'proposed')
      return {...response('Förslaget är sparat. Centreringen återstår att mäta.'),responseId:'final'}
    }})
  assert.equal(result.ok,true)
  assert.deepEqual(order,['bob','plan-compiler','plan-reviewer','bob','plan-compiler','plan-reviewer','bob','bob'])
  assert.equal(writer.receipts.length,1)
  const saved=(await as(owner,'select bob.project_plan_read($1,1) result',[project])).rows[0].result as any
  assert.equal(saved.record.status,'proposed')
  assert.match(saved.record.steps[0].requirements[0].description,/centrering/)
  assert.equal(saved.record.steps[0].requirements[0].evidence_selector.kind,'none')
  assert.match(saved.record.steps[0].requirements[0].id,/^[0-9a-f-]{36}$/,'database assigns the new null identity')
  assert.equal(((await as(owner,'select bob.project_plan_briefing($1) result',[project])).rows[0].result as any).status,'not_initialized','save never approves the plan')
  assert.equal(((await as(owner,'select bob.bob_read_write_receipts($1,$2,$3,$4) result',binding)).rows[0].result as any[]).length,1)
})

test('a claimed turn discovers and approves the saved proposal then performs two further writes without recompiling',async()=>{
  const project='continuation-fixture',area='continuation-area',turn=id(901)
  await pg.query('insert into bob.projects(id,slug,name) values($1,$1,$2)',[project,'Continuation fixture'])
  await pg.query('insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,$3,$4,$5)',[project,project,'Owner','OW',owner])
  await pg.query('insert into bob.areas(id,project_id,slug,name,phase) values($1,$2,$1,$3,$4)',[area,project,'Work area','planning'])
  await server(owner,'select bob_private.project_plan_propose($1,0,$2)',[project,JSON.stringify(plan([
    step('active',{area_id:area,requirements:[]})
  ]))])
  const message='Godkänn förslaget och fortsätt med arbetsuppgifterna.'
  const claim=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',[project,owner,turn,message],'service_role')).rows[0].result as any
  assert.equal(claim.status,'claimed')
  const binding=[project,claim.thread_id,turn,claim.generation]
  const query=async(sql:string,params:unknown[])=>({data:(await as(owner,sql,params)).rows[0].result,error:null})
  const writer=createProjectWriter(project,message,
    payload=>query('select bob.bob_project_write_v8($1,$2,$3,$4,$5) result',[...binding,JSON.stringify(payload)]),
    ()=>query('select bob.bob_read_write_receipts($1,$2,$3,$4) result',binding),
    ()=>query('select bob.bob_settle_project_writes($1,$2,$3,$4) result',binding))
  const lookup=()=>createProjectLookup(project,async(_project,input)=>query(
    'select bob.search_bob_project_data_v8($1,$2,$3,$4,$5,$6,$7) result',
    [project,input.dataset,input.query,input.status,input.area_id,input.record_id,input.after_id]),10000,12)
  const assistant=createPlanAssistant({projectId:project,userId:owner,hasAccess:async()=>true,makeLookup:lookup,
    callModel:async()=>{throw new Error('Approval of an existing proposal must not require compilation')}})
  const usage={input_tokens:1,output_tokens:1,total_tokens:2}
  let calls=0,proposalRevision=0
  const result=await runProjectAnswer({projectId:project,userId:owner,message,lookup:lookup(),writer,planAssistant:assistant,hasAccess:async()=>true,
    readToolPolicy:async()=>({phase:'planning',tools:(await as(owner,'select * from bob.tool_catalog')).rows as any}),
    callModel:async o=>{
      calls++
      const base={success:true,model:'fixture',usage,responseId:'continue_'+calls}
      const tool=(name:string,args:any,index=0)=>({id:'call_'+calls+'_'+index,type:'function' as const,function:{name,arguments:JSON.stringify(args)}})
      if(calls===1){
        const frame=String(o.messages![0].content)
        const fresh=JSON.parse(frame.split('Fresh project briefing:\n\n')[1])
        const desk=fresh.records[0].working_plan
        assert.equal(desk.current_revision,null)
        assert.equal(desk.plan_needed,false)
        proposalRevision=desk.pending_proposal.revision
        return {...base,data:null,toolCalls:[tool('search_project_data',{
          dataset:'plan',query:null,status:null,area_id:null,record_id:desk.pending_proposal.record_id,after_id:null
        })]}
      }
      const outputs=o.messages!.filter(m=>m.role==='tool').map(m=>JSON.parse(String(m.content)))
      if(calls===2){
        assert.equal(outputs[0].records[0].revision,proposalRevision)
        assert.equal(outputs[0].records[0].status,'proposed')
        return {...base,data:null,toolCalls:[tool('decide_project_plan',{
          action:'approve',proposal_revision:proposalRevision,expected_revision:0,decision_note:'User approved the saved proposal.',request_quote:message
        })]}
      }
      if(calls===3){
        assert.equal(outputs[0].status,'saved')
        assert.equal(outputs[0].receipt.record.status,'approved')
        assert(o.tools?.some(t=>t.function.name==='save_project_task'),'a successful write leaves the next tools available')
        return {...base,data:null,toolCalls:['Control measure','Prepare layout'].map((name,i)=>tool('save_project_task',{
          record_id:null,area_id:area,name,instructions:'Prepare the next work from the approved plan.',expected_updated_at:null,request_quote:message
        },i))}
      }
      assert.equal(calls,4)
      assert.equal(outputs.length,2,'both calls from one model response receive independent receipts')
      assert(outputs.every(r=>r.status==='saved'))
      return {...base,data:'Planen är godkänd och arbetsuppgifterna är sparade.'}
    }})
  assert.equal(result.ok,true)
  assert.equal(calls,4)
  assert.equal(writer.receipts.length,3)
  const desk=(await as(owner,'select bob.project_plan_briefing($1) result',[project])).rows[0].result as any
  assert.equal(desk.current_revision,1)
  assert.equal(desk.pending_proposal,null)
  assert.equal((await as(owner,'select name from bob.tasks where area_id=$1',[area])).rows.length,2)
  assert.equal((await as(owner,'select revision from bob.project_plan_revisions where project_id=$1',[project])).rows.length,1,'no replacement proposal was made')
  assert.equal(((await as(owner,'select bob.bob_read_write_receipts($1,$2,$3,$4) result',binding)).rows[0].result as any[]).length,3)
  await assert.rejects(as(outsider,'select bob.project_plan_briefing($1)',[project]),/project_denied|permission denied/)
})
