import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {PGlite} from '@electric-sql/pglite'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
let pg:PGlite
const invoke=async(name:string,args:unknown[],role='service_role') => (await asProjectUser(pg,null,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result as any
const one=async(sql:string,args:unknown[]=[]) => (await pg.query<any>(sql,args)).rows[0]
const accounting={user_id:null,module:'fixture',ai_function:'guard',model:'fixture',input_price_per_1m:2,cached_price_per_1m:.5,output_price_per_1m:10}
const reserve=(guarded=true)=>invoke(guarded?'shared.ai_job_prepare':'shared.ai_job_reserve',['guard_fixture',randomUUID(),'a'.repeat(64),'main',{},new Date(Date.now()+600000).toISOString(),accounting])
before(async()=>{
 pg=await projectSchema()
 await pg.exec("insert into shared_private.ai_receivers values('guard_fixture','main','shared_private','guard_fixture_receiver',true);update shared_private.ai_runtime set worker_url='https://fixtureproject.supabase.co/functions/v1/ai-background-worker'")
})
after(()=>pg.close())
test('one guarded submission intent; response wait starts at submission, while legacy intents remain uncertain',async()=>{
 const guarded=await reserve(),legacy=await reserve(false)
 assert.equal((await one('select submission_state from shared_private.ai_jobs where id=$1',[legacy.id])).submission_state,null)
 assert.equal((await one('select submission_state from shared_private.ai_jobs where id=$1',[guarded.id])).submission_state,'prepared')
 await pg.query("update shared_private.ai_jobs set created_at=now()-interval '119 seconds' where id=$1",[guarded.id])
 assert.deepEqual(await invoke('shared.ai_job_start_submission',[guarded.id]),{submit:true,status:'submitting'})
 const started=(await one('select submit_started_at::text as submit_started_at from shared_private.ai_jobs where id=$1',[guarded.id])).submit_started_at
 assert.deepEqual(await invoke('shared.ai_job_start_submission',[guarded.id]),{submit:false,status:'submitting'})
 assert.equal((await one('select submit_started_at::text as submit_started_at from shared_private.ai_jobs where id=$1',[guarded.id])).submit_started_at,started)
 await pg.query("update shared_private.ai_jobs set created_at=now()-interval '3 minutes' where id=$1",[guarded.id])
 const cap=(await one('select capability from shared_private.ai_jobs where id=$1',[guarded.id])).capability
 assert.deepEqual(await invoke('shared.ai_work_claim',['job',guarded.id,cap]),{response_id:null})
 assert.equal((await one('select status from shared_private.ai_jobs where id=$1',[guarded.id])).status,'submitting','preparation time cannot consume the acknowledgement window')
 await pg.query("update shared_private.ai_jobs set submit_started_at=now()-interval '3 minutes',lease_until=null where id=$1",[guarded.id])
 assert.equal((await invoke('shared.ai_work_claim',['job',guarded.id,cap])).cancel,true)
 assert.equal((await one("select error_code from shared_private.ai_background_failures where job_id=$1 and phase='expire'",[guarded.id])).error_code,'receipt_missing','an intent to POST still has uncertain billing')
})
test('expired preparation and cancellation prevent submission; only never-started preparation is classified as not submitted',async()=>{
 const prepared=await reserve(),cancelled=await reserve()
 await pg.query("update shared_private.ai_jobs set created_at=now()-interval '3 minutes' where id=$1",[prepared.id])
 assert.deepEqual(await invoke('shared.ai_job_start_submission',[prepared.id]),{submit:false,status:'expired'})
 assert.equal((await one("select error_code from shared_private.ai_background_failures where job_id=$1 and phase='expire'",[prepared.id])).error_code,'not_submitted')
 await pg.query("update shared_private.ai_jobs set status='cancelled',finished_at=now() where id=$1",[cancelled.id])
 assert.deepEqual(await invoke('shared.ai_job_start_submission',[cancelled.id]),{submit:false,status:'cancelled'})
 assert.equal((await one('select count(*)::int n from shared.ai_usage_events where background_job_id in ($1,$2)',[prepared.id,cancelled.id])).n,0)
 for(const role of ['anon','authenticated']){
  await assert.rejects(()=>invoke('shared.ai_job_start_submission',[prepared.id],role),/permission denied/)
  await assert.rejects(()=>invoke('shared.ai_job_prepare',['guard_fixture','denied','a'.repeat(64),'main',{},new Date(Date.now()+600000).toISOString(),accounting],role),/permission denied/)
 }
})
