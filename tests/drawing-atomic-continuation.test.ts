import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {PGlite} from '@electric-sql/pglite'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

let pg:PGlite
before(async()=>{pg=await projectSchema()})
after(()=>pg?.close())
const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
const one=async(sql:string,args:unknown[]=[]) => (await pg.query<any>(sql,args)).rows[0]
const invoke=async(name:string,args:unknown[],user:string|null=null,role='service_role') =>
 (await asProjectUser(pg,user,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result as any

async function fixture(){
 const owner=randomUUID(),request=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now())',[owner,randomUUID()+'@continuation.test'])
 const project=(await invoke('bob.create_project',[{name:'Drawing continuation'}],owner,'authenticated')).id
 const catalog=(await one("select shared.resolve_ai_catalog('bob') value")).value
 let turn:string,execution:string,manifest:string,claim:any
 const start=async()=>{
  turn=randomUUID();execution=randomUUID();manifest=randomUUID()
  const pinned={...catalog,manifest_id:manifest,fixture_turn:turn}
  await pg.query("insert into shared.ai_catalog_manifests(id,app,payload,payload_hash) values($1,'bob',$2,shared.ai_catalog_hash($2))",[manifest,pinned])
  claim=await invoke('bob.bob_claim_turn',[project,owner,turn,'Continue the saved drawing'])
  await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,status,credential,worker_url,expires_at,lease_until,work_allowance_version,ai_catalog_manifest_id)
   values($1,$2,$3,$4,$5,$6,'running',$7,'https://fixtureproject.supabase.co/functions/v1/bob-worker',now()+interval '10 minutes',now()+interval '2 minutes',1,$8)`,
   [execution,project,owner,claim.thread_id,turn,claim.generation,{fixture_turn:turn},manifest])
 }
 const finish=async()=>{
  await invoke('bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation])
  await pg.query("update bob_private.bob_jobs set status='failed',credential=null where id=$1",[execution])
 }
 const load=()=>invoke('bob.bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'load',request])
 const save=(expected:number,payload:any,key=randomUUID())=>invoke('bob.bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'save',request,expected,'collecting',payload,key])
 const budget=(op:string,key:string,response:any=null,job=execution)=>invoke('bob.bob_drawing_budget',[project,owner,claim.thread_id,turn,claim.generation,request,job,key,op,response])
 const state=()=>one(`select to_jsonb(r) request,to_jsonb(b) ledger,to_jsonb(p) packet,to_jsonb(a) authority
  from bob_private.project_drawing_requests r left join bob_private.drawing_budgets b on b.request_id=r.id
  left join bob_private.drawing_requests p on p.id=r.id left join bob_private.drawing_authorities a on a.request_id=r.id where r.id=$1`,[request])
 const wake=async()=>{
  await pg.query('insert into bob_private.drawing_project_events(project_id) values($1) on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1',[project])
  await pg.exec('select bob_private.queue_drawing_events()')
  return one('select turn_id,credential,ai_catalog_manifest_id,work_allowance_version from bob_private.bob_jobs where drawing_request_id=$1 order by created_at desc limit 1',[request])
 }
 await start()
 await invoke('bob.create_drawing_request',[project,claim.thread_id,turn!,claim.generation,request,scope],owner,'authenticated')
 const payload={brief:scope,owner_request:'Continue the saved drawing',reference_refs:[],draft:{source_fingerprint:'retained'}}
 await save(0,payload)
 return {owner,project,request,payload,start,finish,load,save,budget,state,wake,get manifest(){return manifest},get turn(){return turn},get execution(){return execution},get claim(){return claim}}
}

test('read then interrupted new message leaves packet, period and background authority on the last successful save',async()=>{
 const f=await fixture(),old=await f.state(),originalManifest=f.manifest
 await f.finish();await f.start()
 assert.deepEqual((await f.load()).payload,f.payload)
 assert.deepEqual(await f.state(),old,'load must have no ownership, revision or accounting side effects')
 await assert.rejects(f.budget('reserve','a'.repeat(64)),/drawing_continuation_mismatch/)
 await f.finish()
 const wake=await f.wake()
 assert.equal(wake.turn_id,old.request.origin_turn_id)
 assert.deepEqual(wake.credential,old.authority.credential)
 assert.equal(wake.ai_catalog_manifest_id,originalManifest)
 assert.notEqual(wake.ai_catalog_manifest_id,f.manifest)
 assert.equal(wake.work_allowance_version,1)
})

test('successful save adopts message, period and exact job authority together; replay cannot adopt another message',async()=>{
 const f=await fixture(),old=await f.state(),key=randomUUID()
 await f.finish();await f.start()
 const loaded=await f.load()
 await assert.rejects(f.save(loaded.revision,{...f.payload,brief:{...scope,area_id:'wrong'}},key),/drawing_scope_changed/)
 assert.deepEqual(await f.state(),old,'failed validation rolls back the entire handoff')
 const saved=await f.save(loaded.revision,f.payload,key),adopted=await f.state()
 assert.equal(saved.revision,loaded.revision+1)
 assert.equal(adopted.ledger.period,old.ledger.period+1)
 assert.equal(adopted.ledger.turn_id,f.turn)
 assert.equal(adopted.request.origin_turn_id,f.turn)
 assert.deepEqual(adopted.authority.credential,{fixture_turn:f.turn})
 assert.deepEqual(await f.save(loaded.revision,f.payload,key),saved)
 assert.deepEqual(await f.state(),adopted)
 const savedTurn=f.turn,savedManifest=f.manifest
 await f.finish();await f.start()
 await assert.rejects(f.save(loaded.revision,f.payload,key),/drawing_write_turn_changed/)
 assert.deepEqual(await f.state(),adopted)
 await f.finish()
 const wake=await f.wake()
 assert.equal(wake.turn_id,savedTurn)
 assert.equal(wake.ai_catalog_manifest_id,savedManifest)
 assert.notEqual(wake.ai_catalog_manifest_id,f.manifest)
})

test('exact old receipts settle once in their original period after atomic adoption',async()=>{
 const f=await fixture(),execution=f.execution,key='b'.repeat(64)
 await f.budget('reserve',key)
 await f.finish();await f.start()
 const loaded=await f.load();await f.save(loaded.revision,loaded.payload)
 const response={success:true,data:'Retained paid output',model:'fixture',usage:{total_tokens:2},estimatedCostUsd:101}
 await f.budget('complete',key,response,execution);await f.budget('complete',key,response,execution)
 assert.deepEqual(await one('select calls,spent_usd::float8 spent from bob_private.drawing_budget_periods where request_id=$1',[f.request]),{calls:1,spent:101})
 assert.deepEqual(await one('select calls,spent_usd::float8 spent from bob_private.drawing_budgets where request_id=$1',[f.request]),{calls:0,spent:0})
 assert.deepEqual((await f.budget('reserve',key)).response,response)
})

test('inconsistent persisted continuation is quarantined, never repaired by guessing; a real saved message can recover it',async()=>{
 const f=await fixture(),oldTurn=f.turn
 await f.finish();await f.start()
 // Exact shape left by the former read-side period switch.
 await pg.query('update bob_private.drawing_budgets set turn_id=$2 where request_id=$1',[f.request,f.turn])
 await f.finish()
 assert.equal(await f.wake(),undefined)
 const broken=await f.state()
 assert.equal(broken.request.reason,'drawing_continuation_mismatch')
 assert.equal(broken.request.origin_turn_id,oldTurn)
 assert.notEqual(broken.ledger.turn_id,oldTurn)
 await f.start()
 const loaded=await f.load();await f.save(loaded.revision,loaded.payload)
 const repaired=await f.state()
 assert.equal(repaired.request.reason,null)
 assert.equal(repaired.request.origin_turn_id,repaired.ledger.turn_id)
 await f.finish();assert.equal((await f.wake()).turn_id,repaired.request.origin_turn_id)
})

test('unregistered legacy packets cannot be loaded or saved through a private fallback',async()=>{
 const f=await fixture(),id=randomUUID()
 await pg.query("insert into bob_private.drawing_requests(id,thread_id,status,payload) values($1,$2,'collecting',$3)",[id,f.claim.thread_id,f.payload])
 await assert.rejects(invoke('bob.bob_drawing_request',[f.project,f.owner,f.claim.thread_id,f.turn,f.claim.generation,'load',id]),/drawing_request_legacy_unsupported/)
 await assert.rejects(invoke('bob.bob_drawing_request',[f.project,f.owner,f.claim.thread_id,f.turn,f.claim.generation,'save',id,1,'collecting',f.payload,randomUUID()]),/drawing_request_legacy_unsupported/)
 assert.equal((await invoke('bob.bob_drawing_request',[f.project,f.owner,f.claim.thread_id,f.turn,f.claim.generation,'list'])).some((r:any)=>r.id===id),false)
})


test('mismatched event jobs and ambiguous execution authority fail explicitly without state changes',async()=>{
 const f=await fixture(),loaded=await f.load(),before=await f.state()
 const other=randomUUID()
 await invoke('bob.create_drawing_request',[f.project,f.claim.thread_id,f.turn,f.claim.generation,other,scope],f.owner,'authenticated')
 await pg.query('update bob_private.bob_jobs set drawing_request_id=$2 where id=$1',[f.execution,other])
 await assert.rejects(f.load(),/drawing_continuation_mismatch/)
 await assert.rejects(f.save(loaded.revision,loaded.payload),/drawing_continuation_mismatch/)
 await assert.rejects(f.budget('reserve','c'.repeat(64)),/drawing_continuation_mismatch/)
 assert.deepEqual(await f.state(),before,'another request in the same owner turn cannot borrow this event job')
 await pg.query('update bob_private.bob_jobs set drawing_request_id=null where id=$1',[f.execution])
 // Corrupt execution metadata is an error, never permission to pick a credential.
 await pg.query(`insert into bob_private.bob_jobs(project_id,actor_id,thread_id,turn_id,generation,status,credential,worker_url,expires_at,lease_until,drawing_request_id,drawing_event_revision)
  values($1,$2,$3,$4,$5,'running','{}','https://fixtureproject.supabase.co/functions/v1/bob-worker',now()+interval '10 minutes',now()+interval '2 minutes',$6,1)`,
  [f.project,f.owner,f.claim.thread_id,f.turn,f.claim.generation,f.request])
 await assert.rejects(f.save(loaded.revision,loaded.payload),/drawing_execution_ambiguous/)
 assert.deepEqual(await f.state(),before)
 await pg.query('update bob_private.drawing_budgets set turn_id=$2 where request_id=$1',[f.request,randomUUID()])
 const broken=await f.state()
 await assert.rejects(f.load(),/drawing_continuation_mismatch/)
 assert.deepEqual(await f.state(),broken)
})

test('legacy request delegates are removed and the canonical command remains service-only',async()=>{
 const removed=await one("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('bob','bob_private') and (p.proname like 'bob_drawing_request_before_%' or p.proname='begin_drawing_budget_period')")
 assert.equal(removed.n,0)
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text)','execute') allowed",[role])).allowed,false)
})
