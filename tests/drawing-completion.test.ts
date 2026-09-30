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
 assert.equal((await budget('reserve','b'.repeat(64),randomUUID())).status,'budget_exhausted','new operation cannot bypass uncertain charge')
 await assert.rejects(call(owner,'bob.grant_drawing_budget',[project,id,1,randomUUID()]),/budget_outcome_unknown/)
 const response={success:true,data:'PRIVATE provider response',model:'fixture',usage:{total_tokens:10},estimatedCostUsd:1.01}
 await budget('complete',key,execution,response)
 await budget('complete',key,execution,response)
 assert.deepEqual((await budget('reserve',key,randomUUID())).response,response,'same logical call is recovered without dispatch')
 assert.equal((await work()).budget.calls,1);assert.equal((await work()).budget.spent_usd,1.01)
 assert.equal((await budget('reserve','b'.repeat(64))).status,'budget_exhausted')
 await assert.rejects(call(other,'bob.grant_drawing_budget',[project,id,1,randomUUID()]),/project_denied/)
 const grant=randomUUID();await call(owner,'bob.grant_drawing_budget',[project,id,1,grant]);await call(owner,'bob.grant_drawing_budget',[project,id,1,grant])
 assert.equal((await work()).budget.usd_limit,2,'duplicate grant never increases allocation twice')
 assert.equal((await budget('reserve','b'.repeat(64))).status,'reserved')
 await budget('complete','b'.repeat(64),execution,{success:true,data:'x',model:'fixture',usage:{total_tokens:2}})
 assert.equal((await work()).budget.outcome_unknown,true,'unpriced usage is not free')
 assert.equal((await budget('reserve','c'.repeat(64))).status,'budget_exhausted')
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
