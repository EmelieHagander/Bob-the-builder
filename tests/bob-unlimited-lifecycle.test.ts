import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from '@electric-sql/pglite'

let pg:PGlite
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002'
const worker='https://fixture.supabase.co/functions/v1/bob-worker'
let oldVersion:string,newVersion:string
const service=async(name:string,args:unknown[]=[]) => (await asProjectUser(pg,null,`select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,'service_role')).rows[0].result as any
const row=async(id:string)=>(await pg.query<any>('select * from bob_private.bob_jobs where id=$1',[id])).rows[0]
const claim=async(id:string)=>service('bob_claim_job',[id,(await row(id)).capability])
const status=async(turn:string)=>(await asProjectUser(pg,owner,'select bob.bob_job_status($1,$2) result',['A',turn])).rows[0].result as any
const activate=async(version:string)=>pg.query("update shared.ai_prompts set active_version_id=$1 where app='bob' and prompt_key='agent-contract.ask-bob'",[version])
async function enqueue(){const turn=randomUUID();return {...await service('bob_enqueue_job_v3',['A',owner,turn,'Uppdatera alla uppgifter.',{ciphertext:'fixture'},new Date(Date.now()+3600000).toISOString(),worker,null,null]),turn}}
async function cancel(id:string){return (await asProjectUser(pg,owner,'select bob.bob_cancel_job($1,$2) result',['A',id])).rows[0].result as any}
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron; create schema net; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint'; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 },'20261017100000_bob_unlimited_work_lifecycle.sql')
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'owner@test.invalid',other,'other@test.invalid'])
 await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Build'); insert into bob.areas(id,project_id,slug,name) values('areaA','A','work','Work');")
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('one','A','Owner','O',$1),('two','A','Other','T',$2)",[owner,other])
 oldVersion=(await pg.query<any>("select active_version_id from shared.ai_prompts where app='bob' and prompt_key='agent-contract.ask-bob'")).rows[0].active_version_id
 newVersion=(await pg.query<any>(`insert into shared.ai_prompt_versions(prompt_id,version,content,metadata,available_variables,flow,definition_kind,definition_format_version,definition)
 select prompt_id,(select max(version)+1 from shared.ai_prompt_versions where prompt_id=v.prompt_id),content,metadata||'{"work_allowance_version":1}',available_variables,flow,definition_kind,definition_format_version,definition
 from shared.ai_prompt_versions v where id=$1 returning id`,[oldVersion])).rows[0].id
 await activate(newVersion)
})
after(()=>pg.close())

test('new jobs pin policy and full JWT authority; old queued jobs remain legacy after publication',async()=>{
 await activate(oldVersion)
 const legacy=await enqueue()
 assert.equal((await row(legacy.jobId)).work_allowance_version,0)
 assert(Date.parse((await row(legacy.jobId)).expires_at)-Date.now()<21*60000)
 await activate(newVersion)
 const oldClaim=await claim(legacy.jobId)
 assert.equal(oldClaim.workAllowanceVersion,undefined)
 assert.equal((await row(legacy.jobId)).ai_catalog_manifest_id,null)
 await cancel(legacy.jobId)
 const q=await enqueue(),j=await row(q.jobId),c=await claim(q.jobId)
 assert.equal(j.work_allowance_version,1);assert(j.ai_catalog_manifest_id)
 assert(Date.parse(j.expires_at)-Date.now()>50*60000)
 assert.equal(c.catalogManifestId,j.ai_catalog_manifest_id);assert.equal(c.workAllowanceVersion,1);assert.equal(c.pagedJournal,true)
 await activate(oldVersion)
 await service('bob_yield_job',[q.jobId,c.claimToken])
 assert.equal((await claim(q.jobId)).catalogManifestId,j.ai_catalog_manifest_id)
 await cancel(q.jobId);await activate(newVersion)
 await assert.rejects(asProjectUser(pg,owner,"update bob_private.bob_jobs set work_allowance_version=1"),/permission denied/)
})

test('productive jobs pass 60 claims and 512 entries; replay pages retain every exact result',async()=>{
 const q=await enqueue()
 let c:any
 for(let i=0;i<62;i++){
  c=await claim(q.jobId);assert.equal(c.status,'claimed',`productive claim ${i+1}`)
  await service('bob_save_job_step',[q.jobId,c.claimToken,`model:${String(i).padStart(4,'0')}`,'a'.repeat(64),{ok:true,result:i}])
  if(i<61)await service('bob_yield_job',[q.jobId,c.claimToken])
 }
 await pg.query("insert into bob_private.bob_job_steps(job_id,key,fingerprint,value) select $1,'write:'||lpad(i::text,4,'0'),repeat('b',64),jsonb_build_object('ok',true,'result',i) from generate_series(1,520) i",[q.jobId])
 await service('bob_save_job_step',[q.jobId,c.claimToken,'write:0521','c'.repeat(64),{ok:true,result:521}])
 let after:string|null=null,keys:string[]=[]
 do{const page=await service('bob_job_steps_page',[q.jobId,c.claimToken,after]);keys.push(...page.entries.map((e:any)=>e.key));after=page.next}while(after)
 assert.equal(keys.length,583);assert.equal(new Set(keys).size,583)
 const old=c.claimToken
 await service('bob_yield_job',[q.jobId,c.claimToken]);c=await claim(q.jobId)
 assert.deepEqual(c.entries,[])
 await assert.rejects(service('bob_job_steps_page',[q.jobId,old,null]),/job_not_claimed/)
 await cancel(q.jobId)
})

test('unlimited journal passes aggregate quota but keeps a per-checkpoint transport boundary',async()=>{
 const q=await enqueue(),c=await claim(q.jobId)
 for(let i=0;i<4;i++)await pg.query("select bob_private.bob_save_job_step($1,$2,$3,repeat('a',64),to_jsonb(repeat('x',17000000)))",[q.jobId,c.claimToken,'large:'+i])
 assert(Number((await pg.query<any>('select sum(value_bytes) bytes from bob_private.bob_job_steps where job_id=$1',[q.jobId])).rows[0].bytes)>64000000)
 const page=await service('bob_job_steps_page',[q.jobId,c.claimToken,null])
 assert.equal(page.entries.length,1);assert.equal(page.next,'large:0')
 await assert.rejects(pg.query("select bob_private.bob_save_job_step($1,$2,'oversized',repeat('a',64),to_jsonb(repeat('x',24000001)))",[q.jobId,c.claimToken]),/journal_limit/)
 await cancel(q.jobId)
})

test('five no-progress segments still stop an unlimited job',async()=>{
 const q=await enqueue()
 for(let i=0;i<5;i++){const c=await claim(q.jobId);assert.equal(c.status,'claimed');await service('bob_yield_job',[q.jobId,c.claimToken])}
 assert.equal((await claim(q.jobId)).status,'failed')
 assert.equal((await row(q.jobId)).error_code,'background_stalled')
})

test('expired ordinary authority pauses with journal; renewal continues the same turn and immutable pin',async()=>{
 const q=await enqueue(),c=await claim(q.jobId),pin=c.catalogManifestId
 await service('bob_save_job_step',[q.jobId,c.claimToken,'model:0','d'.repeat(64),{ok:true,result:'paid result'}])
 await pg.query("update bob_private.bob_jobs set expires_at=now()-interval '1 second' where id=$1",[q.jobId])
 await service('bob_dispatch_jobs')
 const paused=await row(q.jobId)
 assert.equal(paused.status,'paused');assert.equal(paused.credential,null)
 assert.equal((await status(q.turn)).jobId,q.jobId)
 assert.equal((await status(q.turn)).error,'authentication_expired')
 await pg.query("update bob_private.bob_thread_provider_state set lock_started_at=now()-interval '1 hour' where thread_id=$1",[c.threadId])
 assert.equal((await service('bob_claim_turn',['A',owner,randomUUID(),'New work'])).status,'thread_busy')
 await assert.rejects(service('bob_save_job_step',[q.jobId,c.claimToken,'late','d'.repeat(64),{}]),/job_not_claimed/)
 await assert.rejects(asProjectUser(pg,owner,'select bob.bob_renew_job($1,$2,$3,$4,$5)',['A',owner,q.jobId,{},new Date(Date.now()+3600000).toISOString()]),/permission denied/)
 assert.equal(await service('bob_renew_job',['A',owner,q.jobId,{ciphertext:'renewed'},new Date(Date.now()+3600000).toISOString()]),true)
 const resumed=await claim(q.jobId)
 assert.equal(resumed.catalogManifestId,pin);assert(resumed.generation>c.generation)
 assert.equal((await service('bob_job_steps_page',[q.jobId,resumed.claimToken,null])).entries[0].value.result,'paid result')
 await cancel(q.jobId)
})

test('provider completion and expiry while auth-paused do not finish or lose the task; renewal clears terminal waits',async()=>{
 for(const providerStatus of ['completed','expired']){
  const q=await enqueue(),c=await claim(q.jobId),aiId=randomUUID()
  await pg.query("update bob_private.bob_jobs set async_models=true where id=$1",[q.jobId])
  await pg.query(`insert into shared_private.ai_jobs(id,app,operation_key,fingerprint,receiver,context,accounting,status,expires_at)
   values($1,'bob',$2,repeat('a',64),'bob',$3,'{}','pending',now()+interval '1 hour')`,[aiId,'fixture:'+aiId,JSON.stringify({jobId:q.jobId})])
  await service('bob_save_job_step',[q.jobId,c.claimToken,'before-wait:0','a'.repeat(64),{ok:true,result:'preserved'}])
  await service('bob_wait_for_ai',[q.jobId,c.claimToken,aiId])
  await pg.query("update bob_private.bob_jobs set expires_at=now()-interval '1 second' where id=$1",[q.jobId])
  await service('bob_dispatch_jobs')
  await pg.query('update shared_private.ai_jobs set status=$2 where id=$1',[aiId,providerStatus])
  await pg.query('select bob_private.bob_ai_ready($1,$2,$3)',[aiId,JSON.stringify({jobId:q.jobId}),providerStatus])
  assert.equal((await row(q.jobId)).status,'paused')
  assert.equal((await row(q.jobId)).waiting_ai_job,aiId)
  assert.equal(await service('bob_renew_job',['A',owner,q.jobId,{ciphertext:'renewed'},new Date(Date.now()+3600000).toISOString()]),true)
  assert.equal((await row(q.jobId)).waiting_ai_job,null)
  const resumed=await claim(q.jobId)
  assert.equal(resumed.status,'claimed')
  assert.equal((await service('bob_job_steps_page',[q.jobId,resumed.claimToken,null])).entries[0].value.result,'preserved')
  await cancel(q.jobId)
 }
})

test('unfinished drawing work retains its original policy pin beyond terminal-chat cleanup',async()=>{
 const q=await enqueue(),c=await claim(q.jobId),drawing=randomUUID()
 await pg.query("insert into bob_private.project_drawing_requests(id,project_id,owner_user_id,thread_id,origin_turn_id,status,reason,scope) values($1,'A',$2,$3,$4,'collecting',null,'{}')",[drawing,owner,c.threadId,q.turn])
 await service('bob_commit_turn_v2',['A',owner,c.threadId,q.turn,c.generation,'Drawing is pending.',{kind:'ai_assessment',partial:true,sources:[],writes:[]},'resp_fixture'])
 await service('bob_finish_job',[q.jobId,c.claimToken,null])
 await pg.query("update bob_private.bob_jobs set updated_at=now()-interval '8 days' where id=$1",[q.jobId])
 await service('bob_dispatch_jobs')
 assert.equal((await row(q.jobId)).ai_catalog_manifest_id,c.catalogManifestId)
 await pg.query("update bob_private.project_drawing_requests set status='cancelled',reason='owner_cancelled' where id=$1",[drawing])
 await service('bob_dispatch_jobs')
 assert.equal(await row(q.jobId),undefined)
})

test('cancel is owner-scoped, idempotent and fences writes while preserving verified receipts and journal',async()=>{
 const q=await enqueue(),c=await claim(q.jobId)
 const receipt=(await asProjectUser(pg,owner,'select bob.bob_project_write($1,$2,$3,$4,$5) result',['A',c.threadId,q.turn,c.generation,{kind:'task',record_id:null,expected_updated_at:null,expected_revision:null,request_quote:'Uppdatera alla uppgifter.',data:{area_id:'areaA',name:'Saved task',instructions:'Build'}}])).rows[0].result as any
 await service('bob_save_job_step',[q.jobId,c.claimToken,'write:0','e'.repeat(64),{ok:true,result:receipt}])
 assert.deepEqual((await asProjectUser(pg,other,'select bob.bob_cancel_job($1,$2) result',['A',q.jobId])).rows[0].result,{ok:false,error:'turn_not_in_flight'})
 const drawing=randomUUID()
 await pg.query("insert into bob_private.project_drawing_requests(id,project_id,owner_user_id,thread_id,origin_turn_id,status,reason,scope) values($1,'A',$2,$3,$4,'collecting',null,'{}')",[drawing,owner,c.threadId,q.turn])
 await pg.query("insert into bob_private.drawing_authorities values($1,$2,'{}',now()+interval '1 hour',$3)",[drawing,c.threadId,worker])
 const resumedDrawing=randomUUID(),untouchedDrawing=randomUUID()
 for(const id of [resumedDrawing,untouchedDrawing])await pg.query("insert into bob_private.project_drawing_requests(id,project_id,owner_user_id,thread_id,origin_turn_id,status,reason,scope) values($1,'A',$2,$3,$4,'collecting',null,'{}')",[id,owner,c.threadId,randomUUID()])
 await pg.query('insert into bob_private.drawing_budgets(request_id,turn_id) values($1,$2)',[resumedDrawing,q.turn])
 const pendingAi=randomUUID()
 await pg.query("insert into shared_private.ai_jobs(id,app,operation_key,fingerprint,receiver,context,accounting,status,expires_at) values($1,'bob',$2,repeat('a',64),'bob',$3,'{}','pending',now()+interval '1 hour')",[pendingAi,'cancel:'+pendingAi,JSON.stringify({jobId:q.jobId})])
 const cancelled=await cancel(q.jobId)
 assert.equal(cancelled.status,'cancelled');assert.deepEqual(await cancel(q.jobId),cancelled)
 const result=await status(q.turn)
 assert.equal((await pg.query<any>('select status from shared_private.ai_jobs where id=$1',[pendingAi])).rows[0].status,'cancelled')
 assert.equal(result.status,'cancelled');assert.equal(result.writes.length,1);assert.equal(result.writes[0].record,undefined)
 assert.equal(result.writes[0].recordId,receipt.recordId)
 const notices=(await pg.query<any>("select text,evidence from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='assistant'",[c.threadId,q.turn])).rows
 assert.equal(notices.length,1);assert.match(notices[0].text,/Stopped at your request/);assert.equal(notices[0].evidence.partial,true)
 assert.equal(notices[0].evidence.writes[0].recordId,receipt.recordId)
 assert.equal((await pg.query<any>('select status from bob_private.project_drawing_requests where id=$1',[drawing])).rows[0].status,'cancelled')
 assert.equal((await pg.query<any>('select status from bob_private.project_drawing_requests where id=$1',[resumedDrawing])).rows[0].status,'cancelled')
 assert.equal((await pg.query<any>('select status from bob_private.project_drawing_requests where id=$1',[untouchedDrawing])).rows[0].status,'collecting')
 assert.equal((await pg.query<any>('select count(*)::int n from bob_private.drawing_authorities where request_id=$1',[drawing])).rows[0].n,0)
 assert.equal(await service('bob_renew_drawing_authority',['A',owner,drawing,q.turn,{},new Date(Date.now()+3600000).toISOString(),worker]),false)
 assert.equal((await pg.query<any>('select count(*)::int n from bob_private.bob_job_steps where job_id=$1',[q.jobId])).rows[0].n,1)
 await assert.rejects(service('bob_save_job_step',[q.jobId,c.claimToken,'late','e'.repeat(64),{}]),/job_not_claimed/)
 assert.equal(await service('bob_renew_job',['A',owner,q.jobId,{},new Date(Date.now()+3600000).toISOString()]),false)
 assert.equal((await claim(q.jobId)).status,'inactive')
 assert.equal((await service('bob_claim_turn',['A',owner,randomUUID(),'Next work'])).status,'claimed')
})
