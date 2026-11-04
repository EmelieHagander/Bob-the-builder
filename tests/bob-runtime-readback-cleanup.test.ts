import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from './support/pglite.ts'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {manufacturePolicy} from './support/construction-instance-policy-fixture.ts'

let pg:PGlite,owner:string,stranger:string
const migration='20261104211000_bob_runtime_readback_and_terminal_cleanup.sql'
const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
 (await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
const service=(name:string,args:unknown[])=>call(null,'bob.'+name,args,'service_role')
const createProject=()=>call(owner,'bob.create_project',[{name:'Readback fixture'}])
const queued=async(project:string)=>service('bob_enqueue_job_v4',[project,owner,randomUUID(),'Keep saved work',{ciphertext:'fixture'},new Date(Date.now()+3600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker',null,null])
const claim=async(job:string)=>service('bob_claim_job_v2',[job,(await pg.query<any>('select capability from bob_private.bob_jobs where id=$1',[job])).rows[0].capability])
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;
   create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 })
 owner=randomUUID();stranger=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'owner@test.invalid',stranger,'stranger@test.invalid'])
})
after(()=>pg.close())

test('thin summary matches exact full-reader metadata and counts, with historical/archive/access semantics',async()=>{
 const project=(await createProject()).id,other=(await createProject()).id,solution=randomUUID(),turn=randomUUID(),message='Develop the frame; leave later work open.'
 const {intent,recipe,refinement}=constructionFormFixture()
 await call(owner,'bob.solution_command',[project,'create',solution,0,{title:'Frame',description:'Synthetic',assumptions:'Not measured',tradeoffs:'Not approved',measurements:[],design_intent:intent}])
 const target=await call(owner,'bob.solution_command',[project,'select',solution,0,{solution_revision:1,reason:'Fixture'}])
 const c=await service('bob_claim_turn',[project,owner,turn,message])
 const write=(payload:any)=>call(owner,'bob.bob_project_write_v17',[project,c.thread_id,turn,c.generation,payload])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const saved=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'frame',title:'Frame',description:'Checkpoint',area_id:null,target_revision:target.revision,change_note:'Initial',recipe,parameters:parameterPacket(project,recipe),materials:[{definition_id:'rail',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],instance_policy:manufacturePolicy(recipe),open_questions:[],form_refinement:refinement}})
 const id=saved.recordId
 const full=await call(owner,'bob.read_construction_draft',[project,id,1,null])
 const summary=await call(owner,'bob.read_construction_summary',[project,id,1])
 for(const k of ['projectId','artifact_id','revision','current_revision','archived','source_state','title','area_id','target_revision'])assert.deepEqual(summary[k],full[k],k)
 assert.deepEqual(summary.counts,{definitions:full.recipe.definitions.length,instances:full.recipe.instances.length,nodes:full.parameters.nodes.length,bindings:full.parameters.bindings.length,joints:full.joints.length,materials:full.materials.length,open_questions:full.open_questions.length,roles_recorded:true,unknown_roles:0})
 assert(!('recipe'in summary));assert(!('parameters'in summary));assert(JSON.stringify(summary).length<2500)
 assert.equal((await call(owner,'bob.read_construction_summary',[other,id,1])).status,'not_found')
 assert.equal((await call(owner,'bob.read_construction_summary',[project,id,999])).status,'not_found')
 await assert.rejects(call(stranger,'bob.read_construction_summary',[project,id,1]),/project_denied/)
 await assert.rejects(call(null,'bob.read_construction_summary',[project,id,1],'anon'),/permission denied/)
 await assert.rejects(service('read_construction_summary',[project,id,1]),/permission denied/)
 await assert.rejects(call(owner,'bob.read_construction_summary',[project,id,0]),/invalid_construction_read/)
 await call(owner,'bob.artifact_command',[project,'archive',id,1,{}])
 const historical=await call(owner,'bob.read_construction_summary',[project,id,1])
 assert.equal(historical.archived,true);assert.equal(historical.current_revision,2);assert.equal(historical.revision,1)
 const historicalFull=await call(owner,'bob.read_construction_draft',[project,id,1,null])
 assert.equal(historical.source_state,historicalFull.source_state)
 await pg.query('insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,$3,$4,$5)',['reader',project,'Reader','R',stranger])
 assert.equal((await call(stranger,'bob.read_construction_summary',[project,id,1])).status,'ok')
 await pg.query('delete from bob.people where project_id=$1 and auth_user_id=$2',[project,stranger])
 await assert.rejects(call(stranger,'bob.read_construction_summary',[project,id,1]),/project_denied/)
})

test('cancel clears only its terminal working journal, fences late saves and preserves receipts and domain results',async()=>{
 const project=(await createProject()).id,q=await queued(project),c=await claim(q.jobId)
 const area=randomUUID()
 await pg.query('insert into bob.areas(id,project_id,slug,name) values($1,$2,$3,$4)',[area,project,'work','Work'])
 const payload={kind:'task',record_id:null,expected_updated_at:null,expected_revision:null,request_quote:'Keep saved work',data:{area_id:area,name:'Saved task',instructions:'Build'}}
 const receipt=await call(owner,'bob.bob_project_write',[project,c.threadId,c.clientTurnId,c.generation,payload])
 assert(receipt.recordId)
 await service('bob_save_job_step',[q.jobId,c.claimToken,'fixture:0','e'.repeat(64),{ok:true,result:receipt}])
 const steps=async(id:string)=>(await pg.query<any>('select count(*)::int n from bob_private.bob_job_steps where job_id=$1',[id])).rows[0].n
 assert.equal(await steps(q.jobId),1)
 const otherProject=(await createProject()).id,control=await queued(otherProject),controlClaim=await claim(control.jobId)
 await service('bob_save_job_step',[control.jobId,controlClaim.claimToken,'fixture:0','f'.repeat(64),{ok:true,result:'active'}])
 await call(owner,'bob.bob_cancel_job',[project,q.jobId])
 assert.equal(await steps(q.jobId),0);assert.equal(await steps(control.jobId),1)
 assert.equal((await pg.query<any>('select count(*)::int n from bob.tasks where project_id=$1 and id=$2',[project,receipt.recordId])).rows[0].n,1)
 assert.equal((await pg.query<any>('select count(*)::int n from bob_private.bob_write_receipts where project_id=$1',[project])).rows[0].n,1)
 await assert.rejects(service('bob_save_job_step',[q.jobId,c.claimToken,'late:0','e'.repeat(64),{}]),/job_not_claimed/)
 await call(owner,'bob.bob_cancel_job',[project,q.jobId]);assert.equal(await steps(q.jobId),0)
 await pg.query("update bob_private.bob_jobs set status='paused' where id=$1",[control.jobId]);assert.equal(await steps(control.jobId),1)
 await pg.query("update bob_private.bob_jobs set status='failed' where id=$1",[control.jobId]);assert.equal(await steps(control.jobId),0)
})

test('migration drains active jobs and backfills terminal journals without touching paused work',async()=>{
 const sql=readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8')
 const project=(await createProject()).id,q=await queued(project),c=await claim(q.jobId)
 await service('bob_save_job_step',[q.jobId,c.claimToken,'fixture:0','e'.repeat(64),{ok:true,result:'retained'}])
 await assert.rejects(pg.exec(sql),/bob_jobs_active/);await pg.exec('rollback')
 await pg.query("update bob_private.bob_jobs set status='paused' where id=$1",[q.jobId])
 // Recreate the pre-fix gap while the trigger is disabled in this isolated DB.
 await pg.exec('alter table bob_private.bob_jobs disable trigger bob_clear_job_steps')
 const terminalProject=(await createProject()).id,t=await queued(terminalProject),tc=await claim(t.jobId)
 await service('bob_save_job_step',[t.jobId,tc.claimToken,'fixture:0','f'.repeat(64),{ok:true,result:'old working copy'}])
 await pg.query("update bob_private.bob_jobs set status='cancelled' where id=$1",[t.jobId])
 await pg.exec('alter table bob_private.bob_jobs enable trigger bob_clear_job_steps')
 // Apply only the backfill statement: DDL already exists after projectSchema.
 await pg.exec(sql.slice(sql.indexOf('delete from bob_private.bob_job_steps s using'),sql.indexOf("notify pgrst")))
 const rows=(await pg.query<any>('select job_id from bob_private.bob_job_steps where job_id=any($1::uuid[])',[[q.jobId,t.jobId]])).rows
 assert.deepEqual(rows.map(r=>r.job_id),[q.jobId])
 await call(owner,'bob.bob_cancel_job',[project,q.jobId])
})
