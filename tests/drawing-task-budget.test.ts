import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
const paid=(cost:number)=>({success:true,data:'Retained result',model:'fixture',usage:{total_tokens:2},estimatedCostUsd:cost})

test('upgrade keeps the existing request-wide ledger; the next real message starts the default period',async t=>{
 const owner=randomUUID(),id=randomUUID(),oldTurn=randomUUID();let project:string,claim:any,packet:any,before:any
 const rpc=async(db:any,uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(db,uid,`select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const pg=await projectSchema(async(db,name)=>{
  if(name!=='20261012090214_drawing_task_budget.sql')return
  await db.query('insert into auth.users values($1,$2,now())',[owner,'upgrade-task@example.test'])
  project=(await rpc(db,owner,'create_project',[{name:'Legacy cost history'}])).id
  claim=await rpc(db,null,'bob_claim_turn',[project,owner,oldTurn,'Draw saved concept'],'service_role')
  await rpc(db,owner,'create_drawing_request',[project,claim.thread_id,oldTurn,claim.generation,id,scope])
  packet={brief:scope,owner_request:'Draw saved concept',reference_refs:[],draft:{recipe:{assembly_id:'keep-draft'},source_fingerprint:'keep-sources'},retry:{fingerprint:'f'.repeat(64),outcome:{status:'unavailable',reason:'turn_budget_exhausted',stage:'review',saved:false}}}
  await rpc(db,null,'bob_drawing_request',[project,owner,claim.thread_id,oldTurn,claim.generation,'save',id,0,'retrieval_failed',packet,randomUUID()],'service_role')
  await db.query('insert into bob_private.drawing_budgets(request_id,calls,spent_usd,call_limit,usd_limit,unpriced,legacy_untracked) values($1,16,4.04,48,4,true,true)',[id])
  for(let n=0;n<16;n++)await db.query('insert into bob_private.drawing_model_calls(request_id,key,execution_id,thread_id,completed,cost_usd) values($1,$2,$3,$4,true,.2525)',[id,n.toString(16).padStart(64,'0'),randomUUID(),claim.thread_id])
  before=(await db.query<any>('select to_jsonb(b) result from bob_private.drawing_budgets b where request_id=$1',[id])).rows[0].result
  await rpc(db,null,'bob_fail_turn_v2',[project,owner,claim.thread_id,oldTurn,claim.generation],'service_role')
 })
 t.after(()=>pg.close())
 const existing=(await pg.query<any>('select to_jsonb(b) result from bob_private.drawing_budgets b where request_id=$1',[id])).rows[0].result
 assert.deepEqual(existing,{...before,period:1,turn_id:oldTurn,legacy_request_scope:true},'deployment neither grants nor rewrites old charges')
 const newTurn=randomUUID(),next=await rpc(pg,null,'bob_claim_turn',[project!,owner,newTurn,'Continue saved concept'],'service_role')
 const resumed=await rpc(pg,null,'bob_drawing_request',[project!,owner,next.thread_id,newTurn,next.generation,'load',id,0,null,null,null],'service_role')
 assert.deepEqual(resumed.payload.draft,packet.draft);assert.equal(resumed.payload.retry.fingerprint,'')
 const fresh=(await pg.query<any>('select to_jsonb(b) result from bob_private.drawing_budgets b where request_id=$1',[id])).rows[0].result
 assert.equal(fresh.usd_limit,3);assert.equal(fresh.call_limit,24);assert.equal(fresh.calls,0);assert.equal(fresh.spent_usd,0);assert.equal(fresh.unpriced,false);assert.equal(fresh.legacy_untracked,false);assert.equal(fresh.legacy_request_scope,false)
 assert.deepEqual((await pg.query<any>('select to_jsonb(b) result from bob_private.drawing_budget_periods b where request_id=$1',[id])).rows[0].result,existing)
 const retained=(await pg.query<any>('select count(*)::int calls,sum(cost_usd)::float8 cost from bob_private.drawing_model_calls where request_id=$1',[id])).rows[0]
 assert.deepEqual(retained,{calls:16,cost:4.04})
})

test('one owner task shares its cap across requests; the next message fully resets and retains work/accounting',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),other=randomUUID(),id=randomUUID(),second=randomUUID(),turn=randomUUID(),execution=randomUUID()
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const service=(name:string,args:unknown[])=>call(null,name,args,'service_role')
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'task-budget@example.test',other,'other-task@example.test'])
 const project=(await call(owner,'create_project',[{name:'Task budget fixture'}])).id
 let activeTurn=turn,claim=await service('bob_claim_turn',[project,owner,turn,'Draw this construction'])
 const request=(op:string,requestId=id,expected=0,payload:any=null)=>service('bob_drawing_request',[project,owner,claim.thread_id,activeTurn,claim.generation,op,requestId,expected,payload?'retrieval_failed':null,payload,payload?randomUUID():null])
 const budget=(op:string,key:string,requestId=id,response:any=null)=>service('bob_drawing_budget',[project,owner,claim.thread_id,activeTurn,claim.generation,requestId,execution,key,op,response])
 const state=async(requestId=id)=>(await pg.query<any>('select to_jsonb(b) result from bob_private.drawing_budgets b where request_id=$1',[requestId])).rows[0].result
 const draft={recipe:{assembly_id:'retained-geometry'},source_fingerprint:'unchanged-sources'}
 const packet={brief:scope,owner_request:'Draw this construction',reference_refs:[],draft,
  retry:{fingerprint:'f'.repeat(64),outcome:{status:'unavailable',stage:'review',reason:'turn_budget_exhausted',saved:false}}}
 await call(owner,'create_drawing_request',[project,claim.thread_id,turn,claim.generation,id,scope])
 await request('save',id,0,packet)
 const key='a'.repeat(64)
 await budget('reserve',key);await budget('complete',key,id,paid(3.1))
 const exhausted=await budget('reserve','b'.repeat(64))
 assert.deepEqual(exhausted.budget_stop,{scope:'task',reasons:['usd_limit'],calls:1,call_limit:24,spent_usd:3.1,usd_limit:3,pending_calls:0,unpriced:false})
 const old=await state(),working=await request('load')
 assert.equal((await state()).period,old.period,'same-turn loads and retries never reset')
 assert.equal(working.payload.retry.fingerprint,'f'.repeat(64))
 await call(owner,'create_drawing_request',[project,claim.thread_id,turn,claim.generation,second,scope])
 await request('save',second,0,{brief:scope,owner_request:'Same task',reference_refs:[]})
 assert.equal((await budget('reserve','c'.repeat(64),second)).status,'budget_exhausted','a new request ID cannot refill the same task')
 const projection=await call(owner,'drawing_request_work',[project,second])
 assert.equal(projection.budget.spent_usd,3.1,'another request displays the same task total')
 assert.equal(projection.budget.scope,'task')
 const explicitGrant=randomUUID()
 await call(owner,'grant_drawing_budget',[project,second,projection.budget.revision,explicitGrant])
 await call(owner,'grant_drawing_budget',[project,second,projection.budget.revision,explicitGrant])
 assert.equal((await call(owner,'drawing_request_work',[project,id])).budget.usd_limit,4,'a deliberate owner grant uses the shared task total')
 await assert.rejects(service('bob_drawing_budget',[project,other,claim.thread_id,turn,claim.generation,id,execution,key,'reserve',null]),/project_denied/)
 await service('bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation])
 activeTurn=randomUUID();claim=await service('bob_claim_turn',[project,owner,activeTurn,'Continue from the saved draft'])
 const resumed=await request('load')
 assert.deepEqual(resumed.payload.draft,draft);assert.equal(resumed.payload.retry.fingerprint,'')
 assert.equal(resumed.id,id);assert.equal(resumed.status,'retrieval_failed','reset does not invent readiness')
 const fresh=await state()
 assert.equal(fresh.calls,0);assert.equal(fresh.spent_usd,0);assert.equal(fresh.usd_limit,3);assert.equal(fresh.call_limit,24)
 assert.equal(fresh.period,old.period+1);assert.equal(fresh.turn_id,activeTurn)
 assert.deepEqual((await pg.query<any>('select to_jsonb(b) result from bob_private.drawing_budget_periods b where request_id=$1',[id])).rows[0].result,old)
 assert.deepEqual((await budget('reserve',key)).response,paid(3.1),'paid work recovers across tasks without charging the fresh period')
 assert.equal((await state()).calls,0)
 await request('load');assert.equal((await state()).period,fresh.period)
 assert.equal((await budget('reserve','d'.repeat(64))).status,'reserved')
 await budget('complete','d'.repeat(64),id,paid(.25))
 assert.equal((await state()).spent_usd,.25)
 assert.equal((await pg.query<any>('select count(*)::int result from bob_private.drawing_budget_grants')).rows[0].result,1,'next message adds no grant beyond the deliberately clicked one')
 for(const role of ['authenticated','anon','service_role'])await assert.rejects(asProjectUser(pg,owner,'select * from bob_private.drawing_budget_periods',[],role),/permission denied/)
 await assert.rejects(service('bob_drawing_budget',[project,owner,claim.thread_id,turn,claim.generation,id,execution,key,'reserve',null]),/turn_not_claimed/)
 const quality={...packet,retry:{fingerprint:'quality-stop',outcome:{status:'unavailable',stage:'review',reason:'review_failed',saved:false}}}
 await request('save',id,resumed.revision,quality)
 await service('bob_fail_turn_v2',[project,owner,claim.thread_id,activeTurn,claim.generation])
 activeTurn=randomUUID();claim=await service('bob_claim_turn',[project,owner,activeTurn,'Continue safely'])
 assert.deepEqual((await request('load')).payload.retry,quality.retry,'new funds do not release an unchanged quality failure')
})

test('a new task does not redispatch an unknown old call; late completion charges the old period once',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),id=randomUUID(),execution=randomUUID(),key='e'.repeat(64)
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const service=(name:string,args:unknown[])=>call(null,name,args,'service_role')
 await pg.query('insert into auth.users values($1,$2,now())',[owner,'late-task@example.test'])
 const project=(await call(owner,'create_project',[{name:'Late task receipt'}])).id
 let turn=randomUUID(),claim=await service('bob_claim_turn',[project,owner,turn,'Draw shelf'])
 await call(owner,'create_drawing_request',[project,claim.thread_id,turn,claim.generation,id,scope])
 await service('bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'save',id,0,'collecting',{brief:scope,owner_request:'Draw shelf',reference_refs:[]},randomUUID()])
 const budget=(op:string,k=key,response:any=null)=>service('bob_drawing_budget',[project,owner,claim.thread_id,turn,claim.generation,id,execution,k,op,response])
 await budget('reserve')
 await service('bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation])
 turn=randomUUID();claim=await service('bob_claim_turn',[project,owner,turn,'Continue shelf'])
 assert.equal((await budget('reserve')).status,'outcome_unknown')
 const pending=await budget('reserve','f'.repeat(64))
 assert.deepEqual(pending.budget_stop.reasons,['pending_outcome']);assert.equal(pending.budget_stop.calls,0)
 await budget('complete',key,paid(3.7));await budget('complete',key,paid(3.7))
 const current=(await pg.query<any>('select to_jsonb(b) result from bob_private.drawing_budgets b where request_id=$1',[id])).rows[0].result
 const old=(await pg.query<any>('select to_jsonb(b) result from bob_private.drawing_budget_periods b where request_id=$1',[id])).rows[0].result
 assert.equal(current.spent_usd,0);assert.equal(current.calls,0);assert.equal(old.spent_usd,3.7);assert.equal(old.calls,1)
 assert.deepEqual((await budget('reserve')).response,paid(3.7))
 assert.equal((await budget('reserve','f'.repeat(64))).status,'reserved','known old charges do not consume the new task')
 // A provider receipt received by the existing periodic reconciliation path
 // must have the same period ownership as a direct completed response.
 const secondTurn=turn
 await service('bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation])
 turn=randomUUID();claim=await service('bob_claim_turn',[project,owner,turn,'Continue after provider recovery'])
 await service('bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'load',id,0,null,null,null])
 await pg.exec("update shared_private.ai_runtime set worker_url='https://fixtureproject.supabase.co/functions/v1/ai-background-worker'; update shared_private.ai_receivers set enabled=true where app='bob'")
 const context={jobId:execution,role:'cad-designer'},fingerprint='f'.repeat(64)
 const provider=(await asProjectUser(pg,null,'select shared.ai_job_reserve($1,$2,$3,$4,$5,$6,$7) result',
  ['bob',execution+'/model:cad:late',fingerprint,'bob',context,new Date(Date.now()+600000).toISOString(),{user_id:owner,module:'cad',ai_function:'cad-designer',model:'fixture',input_price_per_1m:2,cached_price_per_1m:.5,output_price_per_1m:10}],'service_role')).rows[0].result as any
 const response={id:'resp_'+provider.id.replaceAll('-',''),status:'completed',metadata:{ai_job_id:provider.id},model:'fixture',output_text:'Late output',usage:{input_tokens:1000,output_tokens:200}}
 await asProjectUser(pg,null,'select shared.ai_job_accept($1,$2)',[provider.id,response],'service_role')
 await pg.exec('select bob_private.reconcile_drawing_costs()');await pg.exec('select bob_private.reconcile_drawing_costs()')
 const retained=(await pg.query<any>('select spent_usd::float8 cost from bob_private.drawing_budget_periods where request_id=$1 and turn_id=$2',[id,secondTurn])).rows[0]
 assert.equal(retained.cost,.004)
 assert.equal((await pg.query<any>('select spent_usd::float8 cost from bob_private.drawing_budgets where request_id=$1',[id])).rows[0].cost,0)
})
