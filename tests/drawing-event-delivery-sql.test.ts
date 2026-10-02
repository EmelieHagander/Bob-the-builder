import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

test('P4: event completion delivers its exact private question once and fences cancellation, revocation and stale claims',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 await pg.exec("create schema cron; create schema net; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint'")
 const owner=randomUUID(),other=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'event-delivery@example.test',other,'event-other@example.test'])
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const service=(name:string,args:unknown[])=>call(null,name,args,'service_role')
 for(const mode of ['deliver','changed','cancel','revoke']){
  const project=(await call(owner,'create_project',[{name:'Private event '+mode}])).id,turn=randomUUID(),id=randomUUID()
  const c=await service('bob_claim_turn',[project,owner,turn,'Draw the requested construction'])
  await call(owner,'create_drawing_request',[project,c.thread_id,turn,c.generation,id,{area_id:null,component_id:null,step_id:null,artifact_id:null}])
  const packet={brief:{},owner_request:'Draw the requested construction',reference_refs:[],assessment:{checks:[{id:'depth',action:'owner_decision',blocking:true,detail:'PRIVATE choose depth'}],additional_needs:[]}}
  await service('bob_drawing_request',[project,owner,c.thread_id,turn,c.generation,'save',id,0,'needs_data',packet,randomUUID()])
  await service('bob_commit_turn_v2',[project,owner,c.thread_id,turn,c.generation,'Please choose depth',{kind:'ai_assessment',references:[],sources:[],partial:true},'resp_fixture'])
  await service('bob_renew_drawing_authority',[project,owner,id,turn,{version:1,ciphertext:'synthetic'},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker'])
  await pg.query("insert into bob.tasks(id,project_id,name,status,skill,hours,materials) values($1,$2,'Supply depth','todo','novice','','')",['depth-'+mode,project])
  const gap=(await call(owner,'drawing_request_work',[project,id])).gaps[0].id
  await call(owner,'link_drawing_gap',[project,id,1,gap,'depth-'+mode,null])
  await service('bob_dispatch_jobs',[])
  const job=(await pg.query<any>('select id,capability from bob_private.bob_jobs where drawing_request_id=$1',[id])).rows[0]
  const claim=await service('bob_claim_job',[job.id,job.capability])
  assert.equal(claim.status,'claimed')
  const answer='Bredd och höjd finns kvar. Vilket djup vill du ha?'
  await assert.rejects(call(owner,'bob_finish_drawing_job',[job.id,claim.claimToken,answer]),/permission denied/)
  await assert.rejects(service('bob_finish_drawing_job',[job.id,randomUUID(),answer]),/job_not_claimed/)
  if(mode==='cancel')await call(owner,'cancel_drawing_request',[project,id,1])
  if(mode==='revoke'){
   await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,'Other','OT',$3)",['other-'+mode,project,other])
   await pg.query('delete from bob.people where project_id=$1 and auth_user_id=$2',[project,owner])
  }
  if(mode==='cancel'||mode==='revoke'){
   await assert.rejects(service('bob_finish_drawing_job',[job.id,claim.claimToken,answer]),/project_denied/)
   assert.equal((await pg.query<any>('select count(*)::int n from bob.bob_messages where turn_id=$1',[job.id])).rows[0].n,0)
   continue
  }
  if(mode==='changed')await service('bob_drawing_request',[project,owner,c.thread_id,turn,claim.generation,'save',id,1,'needs_data',packet,randomUUID()])
  // Both a suppressed attempt and the compatibility notice preserve the reply.
  await service('bob_finish_drawing_job',[job.id,claim.claimToken,answer])
  const messages=(await pg.query<any>('select role,text,evidence from bob.bob_messages where turn_id=$1',[job.id])).rows
  assert.equal(messages.length,1);assert.equal(messages[0].text,answer);assert.equal(messages[0].evidence.partial,true);assert.deepEqual(messages[0].evidence.writes,[])
  await assert.rejects(service('bob_finish_drawing_job',[job.id,claim.claimToken,answer]),/job_not_claimed/)
  assert.equal((await pg.query<any>('select count(*)::int n from bob.bob_messages where turn_id=$1',[job.id])).rows[0].n,1)
  assert.equal((await pg.query<any>("select delivery_state from bob.bob_messages where turn_id=$1 and role='user'",[turn])).rows[0].delivery_state,'completed')
 }
})
