import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {PGlite} from '@electric-sql/pglite'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
let pg:PGlite
before(async()=>{pg=await projectSchema(undefined,'20261017101000_bob_unlimited_model_work.sql')})
after(()=>pg?.close())
const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
const paid=(cost:number|null,data='Saved model result')=>({success:true,data,model:'fixture',usage:{total_tokens:2},estimatedCostUsd:cost})
const one=async(sql:string,args:unknown[]=[]) => (await pg.query<any>(sql,args)).rows[0]
const invoke=async(name:string,args:unknown[],user:string|null=null,role='service_role') =>
 (await asProjectUser(pg,user,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result as any
async function fixture(unlimited:boolean){
 const owner=randomUUID(),turn=randomUUID(),execution=randomUUID(),request=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now())',[owner,randomUUID()+'@unlimited-model.test'])
 const project=(await invoke('bob.create_project',[{name:'Unmetered work'}],owner,'authenticated')).id
 const claim=await invoke('bob.bob_claim_turn',[project,owner,turn,'Draw the requested construction'])
 const manifest=(await one("select shared.resolve_ai_catalog('bob') value")).value.manifest_id
 await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,status,credential,worker_url,expires_at,lease_until,work_allowance_version,ai_catalog_manifest_id)
  values($1,$2,$3,$4,$5,$6,'running','{}','https://fixture.invalid/bob-worker',now()+interval '10 minutes',now()+interval '2 minutes',$7,$8)`,
  [execution,project,owner,claim.thread_id,turn,claim.generation,unlimited?1:0,unlimited?manifest:null])
 await invoke('bob.create_drawing_request',[project,claim.thread_id,turn,claim.generation,request,scope],owner,'authenticated')
 await invoke('bob.bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'save',request,0,'collecting',{brief:scope,owner_request:'Draw the requested construction',reference_refs:[]},randomUUID()])
 const budget=(operation:string,key:string,response:any=null,job=execution)=>invoke('bob.bob_drawing_budget',[project,owner,claim.thread_id,turn,claim.generation,request,job,key,operation,response])
 const projection=()=>invoke('bob.drawing_request_work',[project,request],owner,'authenticated')
 return {owner,project,turn,execution,request,claim,budget,projection}
}
test('new pinned drawing work passes all former spend/call/unknown-price thresholds and records each result once',async()=>{
 const f=await fixture(true)
 let spent=0
 for(let index=0;index<30;index++){
  const key=index.toString(16).padStart(64,'0'),cost=index===0?null:index===1?101:2
  assert.equal((await f.budget('reserve',key)).status,'reserved')
  const response=paid(cost,index===1?'x'.repeat(300001):'Saved model result')
  await f.budget('complete',key,response);await f.budget('complete',key,response)
  assert.deepEqual((await f.budget('reserve',key)).response,response)
  spent+=cost??0
 }
 assert.deepEqual(await one('select calls,spent_usd::float8 spent,unpriced from bob_private.drawing_budgets where request_id=$1',[f.request]),{calls:30,spent,unpriced:true})
 const view=(await f.projection()).budget
 assert.equal(view.unlimited_work,true);assert.equal(view.unpriced,true);assert.equal(view.outcome_unknown,false)
 const grant=await invoke('bob.grant_drawing_budget',[f.project,f.request,view.revision,randomUUID()],f.owner,'authenticated')
 assert.equal(grant.unlimited_work,true)
 assert.deepEqual(await one('select calls,spent_usd::float8 spent,call_limit,usd_limit::float8 usd_limit from bob_private.drawing_budgets where request_id=$1',[f.request]),{calls:30,spent,call_limit:24,usd_limit:3})
})
test('pending exact operations and scoped authority remain fenced after budgets are removed',async()=>{
 const f=await fixture(true),key='a'.repeat(64)
 assert.equal((await f.budget('reserve',key)).status,'reserved')
 const blocked=await f.budget('reserve','b'.repeat(64))
 assert.deepEqual(blocked.budget_stop.reasons,['pending_outcome'])
 assert.equal(blocked.budget_stop.unlimited_work,true)
 assert.equal((await f.projection()).budget.outcome_unknown,true)
 assert.equal((await f.budget('reserve',key,null,randomUUID())).status,'outcome_unknown')
 await f.budget('complete',key,paid(101))
 const wrongJob=await f.budget('reserve','c'.repeat(64),null,randomUUID())
 assert.deepEqual(wrongJob.budget_stop.reasons,['usd_limit'],'an unrelated execution cannot borrow the unlimited job policy')
 assert.equal((await f.budget('reserve','d'.repeat(64))).status,'reserved')
 await assert.rejects(f.budget('complete','d'.repeat(64),paid(-1)),/invalid_budget_cost/)
})
test('recovered unlimited receipts keep their original policy and cost period after a new owner turn',async()=>{
 const f=await fixture(true),key='8'.repeat(64)
 await f.budget('reserve',key)
 await pg.query("update bob_private.bob_jobs set status='failed',credential=null where id=$1",[f.execution])
 await invoke('bob.bob_fail_turn_v2',[f.project,f.owner,f.claim.thread_id,f.turn,f.claim.generation])
 const turn=randomUUID(),claim=await invoke('bob.bob_claim_turn',[f.project,f.owner,turn,'Continue the saved construction'])
 await invoke('bob.bob_drawing_request',[f.project,f.owner,claim.thread_id,turn,claim.generation,'load',f.request,0,null,null,null])
 const response=paid(101,'x'.repeat(300001))
 const complete=()=>invoke('bob.bob_drawing_budget',[f.project,f.owner,claim.thread_id,turn,claim.generation,f.request,f.execution,key,'complete',response])
 await complete();await complete()
 assert.deepEqual(await one('select calls,spent_usd::float8 spent from bob_private.drawing_budget_periods where request_id=$1 and period=1',[f.request]),{calls:1,spent:101})
 assert.deepEqual(await one('select calls,spent_usd::float8 spent from bob_private.drawing_budgets where request_id=$1',[f.request]),{calls:0,spent:0})
})
test('older pinned drawing jobs keep their original allocation and exact response behavior',async()=>{
 const f=await fixture(false),key='e'.repeat(64)
 await f.budget('reserve',key)
 await assert.rejects(f.budget('complete',key,paid(3.1,'x'.repeat(300001))),/invalid_budget_receipt/)
 await f.budget('complete',key,paid(3.1))
 assert.deepEqual((await f.budget('reserve','f'.repeat(64))).budget_stop.reasons,['usd_limit'])
 assert.equal((await f.projection()).budget.unlimited_work,undefined)
 assert.deepEqual((await f.budget('reserve',key)).response,paid(3.1))
})
test('automatic drawing wakes retain their pinned policy and ignore only new-mode monetary stops',async()=>{
 for(const unlimited of [false,true]){
  const f=await fixture(unlimited),key='9'.repeat(64)
  await f.budget('reserve',key);await f.budget('complete',key,paid(unlimited?null:3.1))
  await invoke('bob.bob_renew_drawing_authority',[f.project,f.owner,f.request,f.turn,{},new Date(Date.now()+600000).toISOString(),'https://fixtureproject.supabase.co/functions/v1/bob-worker'])
  await invoke('bob.bob_fail_turn_v2',[f.project,f.owner,f.claim.thread_id,f.turn,f.claim.generation])
  await pg.query("update bob_private.bob_jobs set status='completed',credential=null where id=$1",[f.execution])
  await pg.query('insert into bob_private.drawing_project_events(project_id) values($1) on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1',[f.project])
  await pg.exec('select bob_private.queue_drawing_events()')
  const queued=(await pg.query<any>('select work_allowance_version,ai_catalog_manifest_id from bob_private.bob_jobs where drawing_request_id=$1',[f.request])).rows
  assert.equal(queued.length,unlimited?1:0)
  if(unlimited){
   assert.equal(queued[0].work_allowance_version,1)
   assert.equal(queued[0].ai_catalog_manifest_id,(await one('select ai_catalog_manifest_id from bob_private.bob_jobs where id=$1',[f.execution])).ai_catalog_manifest_id)
  }
 }
})
