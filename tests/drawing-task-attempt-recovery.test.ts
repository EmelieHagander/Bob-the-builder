import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {PGlite} from '@electric-sql/pglite'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
let pg:PGlite
before(async()=>{pg=await projectSchema()})
after(()=>pg.close())
const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
const one=async(sql:string,args:unknown[]=[]) => (await pg.query<any>(sql,args)).rows[0]
const invoke=async(name:string,args:unknown[],user:string|null=null,role='service_role') =>
 (await asProjectUser(pg,user,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result as any
async function fixture(guarded=false){
 const owner=randomUUID(),request=randomUUID(),key='a'.repeat(64)
 await pg.query('insert into auth.users values($1,$2,now())',[owner,randomUUID()+'@attempt.test'])
 const project=(await invoke('bob.create_project',[{name:'Explicit task recovery'}],owner,'authenticated')).id
 let turn=randomUUID(),execution=randomUUID(),claim=await invoke('bob.bob_claim_turn',[project,owner,turn,'Draw concept'])
 await invoke('bob.create_drawing_request',[project,claim.thread_id,turn,claim.generation,request,scope],owner,'authenticated')
 const draft={recipe:{assembly_id:'retain-original'},source_fingerprint:'retain-evidence'}
 await invoke('bob.bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'save',request,0,'collecting',{brief:scope,owner_request:'Draw concept',draft,reference_refs:[]},randomUUID()])
 const budget=(op:string,input=key,response:any=null,job=execution)=>invoke('bob.bob_drawing_budget',[project,owner,claim.thread_id,turn,claim.generation,request,job,input,op,response])
 await budget('reserve')
 await pg.exec("update shared_private.ai_runtime set worker_url='https://fixtureproject.supabase.co/functions/v1/ai-background-worker';update shared_private.ai_receivers set enabled=true where app='bob'")
 const oldExecution=execution
 const provider=await invoke(guarded?'shared.ai_job_prepare':'shared.ai_job_reserve',['bob',execution+'/review',key,'bob',{jobId:execution,role:'cad-reviewer'},new Date(Date.now()+600000).toISOString(),
  {user_id:owner,module:'cad',ai_function:'cad-reviewer',model:'fixture',input_price_per_1m:2,cached_price_per_1m:.5,output_price_per_1m:10}])
 const next=async()=>{
  await invoke('bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation])
  turn=randomUUID();execution=randomUUID();claim=await invoke('bob.bob_claim_turn',[project,owner,turn,'Continue same concept'])
 }
 return {owner,project,request,key,draft,provider,oldExecution,budget,next,get execution(){return execution}}
}
test('new explicit task starts one distinct attempt; old uncertainty and late billing stay in the original period',async()=>{
 const f=await fixture()
 await pg.query("update shared_private.ai_jobs set status='expired',finished_at=now() where id=$1",[f.provider.id])
 await f.next()
 const fresh=await f.budget('reserve')
 assert.equal(fresh.status,'reserved');assert.notEqual(fresh.key,f.key);assert.equal(fresh.prior_outcome_unknown,true)
 assert.equal((await f.budget('reserve',f.key,null,randomUUID())).status,'outcome_unknown','same-task worker changes cannot create another attempt')
 assert.deepEqual(await one('select completed,cost_usd from bob_private.drawing_model_calls where request_id=$1 and key=$2',[f.request,f.key]),{completed:false,cost_usd:null})
 assert.equal((await one('select count(*)::int n from bob_private.drawing_model_calls where request_id=$1',[f.request])).n,2)
 const late={id:'resp_'+f.provider.id.replaceAll('-',''),status:'completed',metadata:{ai_job_id:f.provider.id},usage:{input_tokens:1000,output_tokens:100}}
 await invoke('shared.ai_job_accept',[f.provider.id,late]);await pg.exec('select bob_private.reconcile_drawing_costs()');await pg.exec('select bob_private.reconcile_drawing_costs()')
 assert.equal((await one('select spent_usd::float8 cost from bob_private.drawing_budget_periods where request_id=$1 and period=1',[f.request])).cost,.003)
 assert.deepEqual(await one('select calls,spent_usd::float8 cost from bob_private.drawing_budgets where request_id=$1',[f.request]),{calls:1,cost:0})
 const paid={success:true,data:'New verdict',responseId:'resp_new_task',model:'fixture',usage:{total_tokens:2},estimatedCostUsd:.15}
 await f.budget('complete',f.key,paid);await f.budget('complete',fresh.key,paid)
 assert.deepEqual(await one('select calls,spent_usd::float8 cost from bob_private.drawing_budgets where request_id=$1',[f.request]),{calls:1,cost:.15})
 assert.deepEqual((await f.budget('reserve')).response,paid)
 await f.next()
 const cached=await f.budget('reserve');assert.equal(cached.status,'completed');assert.deepEqual(cached.response,paid);assert.equal(cached.prior_outcome_unknown,false)
 assert.deepEqual(await one('select calls,spent_usd::float8 cost from bob_private.drawing_budgets where request_id=$1',[f.request]),{calls:0,cost:0})
 assert.deepEqual((await one('select payload from bob_private.drawing_requests where id=$1',[f.request])).payload.draft,f.draft)
 assert.equal((await one('select response from shared_private.ai_jobs where id=$1',[f.provider.id])).response,null,'late output never revives its expired task')
})
test('active older work stays fenced; only its terminal state allows the already-authorized new task',async()=>{
 const f=await fixture();await f.next()
 const blocked=await f.budget('reserve');assert.equal(blocked.status,'budget_exhausted');assert.deepEqual(blocked.budget_stop.reasons,['pending_outcome']);assert.equal(blocked.budget_stop.calls,0)
 await pg.query("update shared_private.ai_jobs set status='expired',finished_at=now() where id=$1",[f.provider.id])
 const fresh=await f.budget('reserve');assert.equal(fresh.status,'reserved');assert.notEqual(fresh.key,f.key)
 assert.equal((await f.budget('reserve','b'.repeat(64))).status,'budget_exhausted','one pending new attempt still bounds the current task')
})
test('an available paid provider result is recovered before buying a new task attempt',async()=>{
 const f=await fixture()
 await invoke('shared.ai_job_accept',[f.provider.id,{id:'resp_'+f.provider.id.replaceAll('-',''),status:'completed',metadata:{ai_job_id:f.provider.id},usage:{input_tokens:10,output_tokens:10}}])
 await f.next()
 const recovered=await f.budget('reserve');assert.equal(recovered.status,'recover');assert.equal(recovered.execution_id,f.oldExecution);assert.equal(recovered.recovery.key,f.oldExecution+'/review');assert.equal(recovered.recovery.fingerprint,f.key)
 assert.equal((await one('select count(*)::int n from bob_private.drawing_model_calls where request_id=$1',[f.request])).n,1)
 assert.deepEqual(await one('select calls,spent_usd::float8 cost from bob_private.drawing_budgets where request_id=$1',[f.request]),{calls:0,cost:0})
})
test('a preparation that never reached submission settles at zero without inventing uncertainty',async()=>{
 const f=await fixture(true)
 await pg.query("update shared_private.ai_jobs set status='expired',finished_at=now() where id=$1",[f.provider.id])
 await pg.exec('select bob_private.reconcile_drawing_costs()')
 assert.deepEqual(await one('select completed,cost_usd::float8 cost from bob_private.drawing_model_calls where request_id=$1 and key=$2',[f.request,f.key]),{completed:true,cost:0})
 await f.next()
 const fresh=await f.budget('reserve');assert.equal(fresh.status,'reserved');assert.notEqual(fresh.key,f.key);assert.equal(fresh.prior_outcome_unknown,false)
 assert.equal((await one('select count(*)::int n from shared.ai_usage_events where background_job_id=$1',[f.provider.id])).n,0)
})
test('reconciled legacy callers recover the provider fingerprint rather than the new opaque attempt key',async()=>{
 const f=await fixture()
 await pg.query("update shared_private.ai_jobs set status='expired',finished_at=now() where id=$1",[f.provider.id])
 await f.next();const fresh=await f.budget('reserve')
 const provider=await invoke('shared.ai_job_reserve',['bob',f.execution+'/review',f.key,'bob',{jobId:f.execution,role:'cad-reviewer'},new Date(Date.now()+600000).toISOString(),
  {user_id:f.owner,module:'cad',ai_function:'cad-reviewer',model:'fixture',input_price_per_1m:2,cached_price_per_1m:.5,output_price_per_1m:10}])
 await invoke('shared.ai_job_accept',[provider.id,{id:'resp_'+provider.id.replaceAll('-',''),status:'completed',metadata:{ai_job_id:provider.id},usage:{input_tokens:10,output_tokens:10}}])
 await pg.exec('select bob_private.reconcile_drawing_costs()')
 assert.equal((await one('select completed from bob_private.drawing_model_calls where request_id=$1 and key=$2',[f.request,fresh.key])).completed,true)
 const recovered=await f.budget('reserve');assert.equal(recovered.status,'recover');assert.equal(recovered.key,fresh.key);assert.equal(recovered.recovery.fingerprint,f.key)
 assert.equal(recovered.execution_id,f.execution)
})
