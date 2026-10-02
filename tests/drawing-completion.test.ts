import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {createDrawingBudget} from '../supabase/functions/_shared/drawing-budget.ts'

const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
test('P2: request-wide reservations, replay, allocation and private results survive the right boundaries',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),other=randomUUID(),id=randomUUID(),turn=randomUUID()
 const call=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'budget-owner@example.test',other,'budget-other@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Budget fixture'})])).id
 const claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,'Draw the construction'],'service_role')
 await call(owner,'bob.create_drawing_request',[project,claim.thread_id,turn,claim.generation,id,JSON.stringify(scope)])
 const working={brief:{...scope},owner_request:'PRIVATE words',reference_refs:[],assessment:{checks:[{id:'clearance',action:'measurement',blocking:true,detail:'PRIVATE assessment'}],additional_needs:[]}}
 const save=(expected:number,packet:any=working)=>call(null,'bob.bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'save',id,expected,'needs_data',packet,randomUUID()],'service_role')
 await save(0)
 const work=()=>call(owner,'bob.drawing_request_work',[project,id])
 const initial=await work(),gap=initial.gaps[0].id
 assert.equal(initial.gaps.length,1);assert(!JSON.stringify(initial).includes('PRIVATE'))
 await save(1);assert.equal((await work()).gaps[0].id,gap,'assessment delivery reuses stable gap')
 const execution=randomUUID(),key='a'.repeat(64)
 const budget=(operation:string,k=key,run=execution,response:any=null)=>call(null,'bob.bob_drawing_budget',[project,owner,claim.thread_id,turn,claim.generation,id,run,k,operation,response],'service_role')
 assert.equal((await budget('reserve')).status,'reserved')
 assert.equal((await budget('reserve')).status,'outcome_unknown','synchronous dispatch cannot be repeated after uncertain outcome')
 assert.equal((await budget('reserve',key,randomUUID())).status,'outcome_unknown')
 const pending=await budget('reserve','b'.repeat(64),randomUUID())
 assert.equal(pending.status,'budget_exhausted','new operation cannot bypass uncertain charge')
 assert.deepEqual(pending.budget_stop.reasons,['pending_outcome']);assert.equal(pending.budget_stop.pending_calls,1)
 assert.equal((await budget('reserve','b'.repeat(64),execution)).status,'budget_exhausted','same execution cannot disguise a new uncertain operation')
 await assert.rejects(call(owner,'bob.grant_drawing_budget',[project,id,1,randomUUID()]),/budget_outcome_unknown/)
 const response={success:true,data:'PRIVATE provider response',model:'fixture',usage:{total_tokens:10},estimatedCostUsd:1.01}
 await budget('complete',key,execution,response)
 await budget('complete',key,execution,response)
 assert.deepEqual((await budget('reserve',key,randomUUID())).response,response,'same logical call is recovered without dispatch')
 assert.equal((await work()).budget.calls,1);assert.equal((await work()).budget.spent_usd,1.01)
 const spent=await budget('reserve','b'.repeat(64))
 assert.equal(spent.status,'budget_exhausted');assert.deepEqual(spent.budget_stop.reasons,['usd_limit'])
 assert.equal(spent.budget_stop.spent_usd,1.01);assert.equal(spent.budget_stop.usd_limit,1)
 assert.equal(spent.budget_stop.scope,'drawing_request');assert.equal(spent.budget_stop.calls,1)
 await assert.rejects(call(other,'bob.grant_drawing_budget',[project,id,1,randomUUID()]),/project_denied/)
 const grant=randomUUID();await call(owner,'bob.grant_drawing_budget',[project,id,1,grant]);await call(owner,'bob.grant_drawing_budget',[project,id,1,grant])
 assert.equal((await work()).budget.usd_limit,2,'duplicate grant never increases allocation twice')
 assert.equal((await budget('reserve','b'.repeat(64))).status,'reserved')
 await budget('complete','b'.repeat(64),execution,{success:true,data:'x',model:'fixture',usage:{total_tokens:2}})
 assert.equal((await work()).budget.outcome_unknown,true,'unpriced usage is not free')
 const unpriced=await budget('reserve','c'.repeat(64))
 assert.equal(unpriced.status,'budget_exhausted');assert.deepEqual(unpriced.budget_stop.reasons,['unpriced_usage'])
 assert.equal(unpriced.budget_stop.unpriced,true)
 await pg.query('update bob_private.drawing_budgets set unpriced=false,call_limit=calls where request_id=$1',[id])
 const counted=await budget('reserve','c'.repeat(64))
 assert.deepEqual(counted.budget_stop.reasons,['call_limit']);assert.equal(counted.budget_stop.call_limit,2)
 await pg.query('delete from bob_private.drawing_model_results where request_id=$1 and key=$2',[id,key])
 const cleared=await budget('reserve')
 assert.equal(cleared.status,'context_cleared');assert.deepEqual(cleared.budget_stop.reasons,['context_cleared'])
 assert.equal((await work()).budget.calls,2,'diagnostic/recovery reads never allocate another call')
 await assert.rejects(call(owner,'bob.bob_drawing_budget',[project,owner,claim.thread_id,turn,claim.generation,id,execution,key,'reserve',null]),/permission denied/)
 await assert.rejects(asProjectUser(pg,owner,'select * from bob_private.drawing_model_results'),/permission denied/)
 await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
 const thread=(await pg.query('select next_seq from bob.bob_threads where id=$1',[claim.thread_id])).rows[0]
 await call(owner,'bob.bob_reset_conversation',[project,claim.thread_id,thread.next_seq])
 assert.equal((await pg.query('select count(*)::int n from bob_private.drawing_model_results')).rows[0].n,0)
 assert.equal((await work()).budget.calls,2,'reset never replenishes budget')
 assert.equal((await work()).gaps[0].id,gap,'operational gap survives reset')
})

test('P2 budget wrapper reserves before dispatch and recovers response without another paid call',async()=>{
 const events:string[]=[]
 const response:any={success:true,data:'ok',model:'fixture',usage:{total_tokens:2},estimatedCostUsd:0.1}
 const options:any={functionName:'cad-designer',messages:[{role:'user',content:'source'}]}
 let saved:any=null
 const budget=createDrawingBudget({executionId:randomUUID(),command:async input=>{
  events.push(input.p_operation as string)
  if(input.p_operation==='complete'){saved=input.p_response;return {status:'completed'}}
  return saved?{status:'completed',response:saved}:{status:'reserved'}
 }})
 const paid=async()=>{events.push('paid');return response}
 assert.deepEqual(await budget('request',options,paid),response)
 assert.deepEqual(await budget('request',{...options,timeoutMs:1},paid),response)
 assert.deepEqual(events,['reserve','paid','complete','reserve'])
})

test('P2 events: UI/chat domain changes resume the original mandate, deduplicate jobs and fence revocation',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 await pg.exec(`create schema cron; create schema net; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint'`)
 const owner=randomUUID(),turn=randomUUID(),id=randomUUID()
 const call=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const service=(name:string,args:any[])=>call(null,'bob.'+name,args,'service_role')
 await pg.query('insert into auth.users values($1,$2,now())',[owner,'event-owner@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Event fixture'})])).id
 const c=await service('bob_claim_turn',[project,owner,turn,'Draw the shelf from saved measurements'])
 // Older inactive requests must not occupy the bounded dispatch page forever.
 for(let n=0;n<21;n++){
  const old=randomUUID();await call(owner,'bob.create_drawing_request',[project,c.thread_id,turn,c.generation,old,scope])
  await service('bob_drawing_request',[project,owner,c.thread_id,turn,c.generation,'save',old,0,'needs_data',{brief:{...scope},owner_request:'Draw the shelf from saved measurements',reference_refs:[]},randomUUID()])
 }
 const intent='a'.repeat(64)
 await call(owner,'bob.resolve_drawing_request',[project,c.thread_id,turn,c.generation,id,scope,intent])
 const repeated=await call(owner,'bob.resolve_drawing_request',[project,c.thread_id,turn,c.generation,randomUUID(),scope,intent])
 assert.equal(repeated.id,id);assert(repeated.reused,'new request UUID cannot bypass the existing identity')
 const working={brief:{...scope,brief:'Shelf'},owner_request:'Draw the shelf from saved measurements',reference_refs:[],assessment:{checks:[{id:'width',action:'measurement',blocking:true}],additional_needs:[]}}
 const saved=await service('bob_drawing_request',[project,owner,c.thread_id,turn,c.generation,'save',id,0,'needs_data',working,randomUUID()])
 await service('bob_commit_turn_v2',[project,owner,c.thread_id,turn,c.generation,'Please record the missing width',{kind:'ai_assessment',references:[],sources:[],partial:true},'resp_fixture'])
 await service('bob_renew_drawing_authority',[project,owner,id,turn,{version:1,ciphertext:'fixture'},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker'])
 await pg.query("insert into bob.tasks(id,project_id,name,status,skill,hours,materials) values('measure',$1,'Measure width','todo','novice','1h','')",[project])
 const work=await call(owner,'bob.drawing_request_work',[project,id]),gap=work.gaps[0].id
 await call(owner,'bob.link_drawing_gap',[project,id,saved.revision,gap,'measure',null])
 await call(owner,'bob.link_drawing_gap',[project,id,saved.revision,gap,'measure',null])
 assert.equal((await call(owner,'bob.drawing_work_list',[project,null,'measure'])).items.length,1)
 await service('bob_dispatch_jobs',[]);await service('bob_dispatch_jobs',[])
 const jobs=(await pg.query('select * from bob_private.bob_jobs where drawing_request_id=$1',[id])).rows
 assert.equal(jobs.length,1,'duplicate event delivery creates one active execution')
 const job=jobs[0]
 const claimed=await service('bob_claim_job',[job.id,job.capability])
 assert.equal(claimed.status,'claimed');assert.equal(claimed.drawingRequestId,id);assert.equal(claimed.clientTurnId,turn)
 assert.equal(claimed.message,'Draw the shelf from saved measurements')
 assert.equal((await pg.query("select count(*)::int n from bob.bob_messages where role='user'")).rows[0].n,1,'event never fabricates a user message')
 const loaded=await service('bob_drawing_request',[project,owner,c.thread_id,turn,claimed.generation,'load',id,0,null,null,null])
 assert.equal(loaded.id,id,'audited event can read its own private packet under the original instruction')
 await asProjectUser(pg,owner,"update bob.tasks set status='done' where id='measure'")
 assert.equal((await call(owner,'bob.drawing_request_work',[project,id])).gaps[0].blocking,true,'Task completion is no measurement evidence')
 await call(owner,'bob.cancel_drawing_request',[project,id,loaded.revision])
 await assert.rejects(service('bob_drawing_request',[project,owner,c.thread_id,turn,claimed.generation,'save',id,loaded.revision,'reviewed',working,randomUUID()]),/turn_not_claimed|drawing_request_cancelled/)
 await service('bob_finish_job',[job.id,claimed.claimToken,'cancelled'])
 await service('bob_dispatch_jobs',[])
 assert.equal((await pg.query('select count(*)::int n from bob_private.bob_jobs where drawing_request_id=$1',[id])).rows[0].n,1)
 assert.equal((await pg.query("select delivery_state from bob.bob_messages where role='user'")).rows[0].delivery_state,'completed','event does not rewrite original chat delivery')
 const remaining=randomUUID();await pg.query('insert into auth.users values($1,$2,now())',[remaining,'remaining@example.test']);await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('remaining',$1,'Remaining','RE',$2)",[project,remaining])
 await pg.query('delete from bob.people where project_id=$1 and auth_user_id=$2',[project,owner])
 await assert.rejects(service('bob_renew_drawing_authority',[project,owner,id,turn,{},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker']),/project_denied/)
 await pg.query('delete from bob.projects where id=$1',[project])
 assert.equal((await pg.query('select count(*)::int n from bob_private.drawing_project_events')).rows[0].n,0,'project deletion does not recreate an event row')
})

test('P2: a late provider receipt reconciles once and recovers its original transport',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),id=randomUUID(),turn=randomUUID(),execution=randomUUID(),key='e'.repeat(64)
 const call=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now())',[owner,'late-budget@example.test'])
 const project=(await call(owner,'bob.create_project',[{name:'Late budget fixture'}])).id
 const c=await call(null,'bob.bob_claim_turn',[project,owner,turn,'Draw shelf'],'service_role')
 await call(owner,'bob.create_drawing_request',[project,c.thread_id,turn,c.generation,id,scope])
 await call(null,'bob.bob_drawing_request',[project,owner,c.thread_id,turn,c.generation,'save',id,0,'collecting',{brief:scope,owner_request:'Draw shelf',reference_refs:[],retry:{fingerprint:'f'.repeat(64),outcome:{status:'unavailable',reason:'turn_budget_exhausted'}}},randomUUID()],'service_role')
 const budget=(op:string,run=execution,result:any=null)=>call(null,'bob.bob_drawing_budget',[project,owner,c.thread_id,turn,c.generation,id,run,key,op,result],'service_role')
 await budget('reserve')
 await pg.exec("update shared_private.ai_runtime set worker_url='https://fixtureproject.supabase.co/functions/v1/ai-background-worker'; update shared_private.ai_receivers set enabled=true where app='bob'")
 const context={jobId:execution,role:'cad-designer'},operation=execution+'/model:cad:0'
 const ai=await call(null,'shared.ai_job_reserve',['bob',operation,key,'bob',context,new Date(Date.now()+600000).toISOString(),{user_id:owner,module:'cad',ai_function:'cad-designer',model:'fixture',input_price_per_1m:2,cached_price_per_1m:.5,output_price_per_1m:10}],'service_role')
 const response={id:'resp_'+ai.id.replaceAll('-',''),status:'completed',metadata:{ai_job_id:ai.id},model:'fixture',output_text:'Exact late output',usage:{input_tokens:1000,output_tokens:200}}
 await call(null,'shared.ai_job_accept',[ai.id,response],'service_role')
 for(let n=0;n<2;n++)await pg.exec('select bob_private.reconcile_drawing_costs()')
 const work=await call(owner,'bob.drawing_request_work',[project,id])
 assert.equal(work.budget.calls,1);assert.equal(work.budget.spent_usd,.004);assert.equal(work.budget.outcome_unknown,false)
 const checkpoint=(await pg.query<any>('select revision,payload from bob_private.drawing_requests where id=$1',[id])).rows[0]
 assert.equal(checkpoint.revision,2);assert.equal(checkpoint.payload.retry.fingerprint,'');assert.equal(checkpoint.payload.retry.outcome.reason,'turn_budget_exhausted','late receipt releases the gate without discarding phase recovery')
 const recovered=await budget('reserve',randomUUID());assert.equal(recovered.status,'recover');assert.equal(recovered.execution_id,execution);assert.equal(recovered.recovery.key,operation);assert.deepEqual(recovered.recovery.context,context)
 const parsed={success:true,data:'Exact late output',model:'fixture',estimatedCostUsd:.004,usage:{total_tokens:1200}}
 await budget('complete',execution,parsed)
 assert.deepEqual((await budget('reserve',randomUUID())).response,parsed)
 assert.equal((await call(owner,'bob.drawing_request_work',[project,id])).budget.spent_usd,.004,'parsed recovery never charges the same receipt twice')
})

test('P2: shared requirements create one canonical Task and private needs cannot publish prose',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),id=randomUUID(),turn=randomUUID()
 const call=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now())',[owner,'gap-task@example.test'])
 const project=(await call(owner,'bob.create_project',[{name:'Gap Task fixture'}])).id
 const requirement={requirement_id:null,type:'measurement',title:'Measure shelf width',description:'Canonical shared instruction',resolution:'open',responsible_kind:'bob',responsible_person_id:null,evidence_selector:{kind:'none',id:null,subject:null,area_id:null}}
 const proposal=await call(owner,'bob_private.project_plan_propose',[project,0,{summary:'Drawing input',reason:'Fixture',steps:[{step_id:null,title:'Drawing',goal:'Shelf concept',state:'active',phase:'planning',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[requirement]}],task_links:[]}],'postgres')
 const plan=(await call(owner,'bob_private.project_plan_decide',[project,0,proposal.record.revision,'approve','Use requirements'],'postgres')).record
 const step=plan.steps[0],rid=step.requirements[0].id
 const c=await call(null,'bob.bob_claim_turn',[project,owner,turn,'Draw shelf'],'service_role')
 await call(owner,'bob.create_drawing_request',[project,c.thread_id,turn,c.generation,id,{...scope,step_id:step.id}])
 const payload={brief:{...scope,step_id:step.id,handoff:{requirements:[{id:'width',basis:'project_record',source_ref:rid}]}},owner_request:'PRIVATE words',reference_refs:[],assessment:{checks:[{id:'width',action:'measurement',blocking:true,detail:'PRIVATE needs'}],additional_needs:[{id:'other',action:'measurement',blocking:true,detail:'PRIVATE other'}]}}
 const save=(rev:number)=>call(null,'bob.bob_drawing_request',[project,owner,c.thread_id,turn,c.generation,'save',id,rev,'needs_data',payload,randomUUID()],'service_role')
 await save(0)
 const rows=(await pg.query<any>('select id,requirement_key from bob_private.drawing_gaps where request_id=$1',[id])).rows
 const gid=rows.find(g=>g.requirement_key==='width')!.id,privateId=rows.find(g=>g.requirement_key==='other')!.id
 await assert.rejects(call(owner,'bob.ensure_drawing_gap_task',[project,id,1,privateId,rid,plan.revision]),/canonical_requirement_required/)
 const task=await call(owner,'bob.ensure_drawing_gap_task',[project,id,1,gid,rid,plan.revision])
 assert.equal((await call(owner,'bob.ensure_drawing_gap_task',[project,id,1,gid,rid,plan.revision])).task_id,task.task_id)
 const shared=(await pg.query<any>('select name,instructions from bob.tasks where id=$1',[task.task_id])).rows[0]
 assert.deepEqual(shared,{name:requirement.title,instructions:requirement.description});assert(!JSON.stringify(shared).includes('PRIVATE'))
 payload.assessment.additional_needs=[];await save(1)
 assert.equal((await pg.query<any>('select blocking from bob_private.drawing_gaps where id=$1',[privateId])).rows[0].blocking,false,'retired needs keep identity without blocking forever')
 assert.equal((await pg.query<any>('select count(*)::int n from bob.tasks where project_id=$1',[project])).rows[0].n,1)
})


test('P2: an unpriced transport failure cannot release its uncertain reservation',async()=>{
 const operations:string[]=[]
 const budget=createDrawingBudget({executionId:randomUUID(),command:async input=>{operations.push(String(input.p_operation));return {status:'reserved'}}})
 const failure:any={success:false,data:null,model:'fixture',error:'Network error: timeout',usage:{input_tokens:0,output_tokens:0,total_tokens:0}}
 assert.deepEqual(await budget('request',{functionName:'cad-designer'} as any,async()=>failure),failure)
 assert.deepEqual(operations,['reserve'])
})
