import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parseBobScreen,BOB_SCREEN_SURFACES} from '../src/domain/bobScreen.ts'

test('P3 screen capture is private, immutable, validated, and stable across retries and worker leases',async t=>{
 const pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 });t.after(()=>pg.close())
 const owner=randomUUID(),member=randomUUID(),other=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'screen@example.test',member,'member@example.test',other,'other@example.test'])
 const call=async(user:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,user,`select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const project=(await call(owner,'create_project',[{name:'Screen fixture'}])).id
 const foreign=(await call(other,'create_project',[{name:'Other screen fixture'}])).id
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,'Member','M',$3)",[randomUUID(),project,member])
 const turn=randomUUID(),screen={surface:'task',taskId:'taskA',areaId:'areaA'}
 const enqueue=(s:any=null,msg='Do the current task.',id=turn)=>call(null,'bob_enqueue_job_v2',[project,owner,id,msg,{ciphertext:'fixture'},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker',s],'service_role')
 const queued=await enqueue(screen)
 assert.deepEqual(queued.screen,screen)
 assert.deepEqual((await enqueue()).screen,screen,'legacy omission preserves first capture')
 await assert.rejects(enqueue({surface:'people'}),/turn_screen_changed/)
 assert.deepEqual((await call(owner,'bob_job_status',[project,turn])).screen,screen,'reload can recover original screen')
 assert.equal(await call(member,'bob_job_status',[project,turn]),null,'shared project membership does not expose private focus')
 await assert.rejects(call(other,'bob_job_status',[project,turn]),/project_denied/)
 for(const role of ['authenticated','service_role'])await assert.rejects(asProjectUser(pg,owner,'select * from bob_private.bob_turn_screens',[],role),/permission denied/)
 await assert.rejects(call(owner,'bob_capture_turn_screen',[project,owner,randomUUID(),turn,1,screen]),/permission denied/)
 const job:any=(await pg.query('select capability from bob_private.bob_jobs where id=$1',[queued.jobId])).rows[0]
 const claimed=await call(null,'bob_claim_job',[queued.jobId,job.capability],'service_role')
 assert.deepEqual(claimed.screen,screen)
 const capture=(generation=claimed.generation,s:any=null,user=owner,p=project)=>call(null,'bob_capture_turn_screen',[p,user,claimed.threadId,turn,generation,s],'service_role')
 assert.deepEqual(await capture(),{screen})
 await assert.rejects(capture(claimed.generation,{surface:'project'}),/turn_screen_changed/)
 await assert.rejects(capture(claimed.generation,screen,other,foreign),/project_denied/)
 await call(null,'bob_yield_job',[queued.jobId,claimed.claimToken],'service_role')
 const resumed=await call(null,'bob_claim_job',[queued.jobId,job.capability],'service_role')
 assert.deepEqual(resumed.screen,screen);assert(resumed.generation>claimed.generation)
 await assert.rejects(capture(),/turn_not_claimed/)
 await call(null,'bob_finish_job',[queued.jobId,resumed.claimToken,'fixture_retry'],'service_role')
 const retried=await enqueue(null)
 assert.deepEqual(retried.screen,screen,'failed job replacement keeps logical turn focus')
 const replacement:any=(await pg.query('select capability from bob_private.bob_jobs where id=$1',[retried.jobId])).rows[0]
 const retriedClaim=await call(null,'bob_claim_job',[retried.jobId,replacement.capability],'service_role')
 await call(null,'bob_finish_job',[retried.jobId,retriedClaim.claimToken,'fixture_done'],'service_role')

 await t.test('SQL shape validator agrees with TypeScript parser and malformed enqueue rolls back',async()=>{
  const invalid=[{},[],{surface:'task'},{surface:'area'},{surface:'event'},{surface:'project',projectId:foreign},{surface:'task',taskId:'a/b'},
   {surface:'drawings',artifactId:'x'},{surface:'solutions',solutionRevision:1},{surface:'drawings',artifactId:'x',artifactRevision:1.2},{surface:'drawings',artifactId:'x',artifactRevision:2147483648},{surface:'project',planStepId:null}]
  for(const s of invalid){assert.throws(()=>parseBobScreen(s),/invalid_screen/);await assert.rejects(enqueue(s,'Invalid',randomUUID()),/invalid_screen/)}
  for(const surface of BOB_SCREEN_SURFACES){
   const s={surface,...(surface==='task'?{taskId:'t'}:surface==='area'?{areaId:'a'}:surface==='event'?{eventId:'e'}:{})}
   parseBobScreen(s)
   const id=randomUUID(),c=await call(null,'bob_claim_turn',[project,owner,id,'Check shape.'],'service_role')
   assert.deepEqual(await call(null,'bob_capture_turn_screen',[project,owner,c.thread_id,id,c.generation,s],'service_role'),{screen:s})
   await call(null,'bob_fail_turn_v2',[project,owner,c.thread_id,id,c.generation],'service_role')
  }
 })
 await t.test('ordinary pre-P3/legacy enqueue freezes null and cancelled claim cannot capture',async()=>{
  const id=randomUUID(),q=await call(null,'bob_enqueue_job',[project,owner,id,'Legacy job.',{},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker'],'service_role')
  await assert.rejects(enqueue(screen,'Legacy job.',id),/turn_screen_changed/)
  const j:any=(await pg.query('select capability from bob_private.bob_jobs where id=$1',[q.jobId])).rows[0]
  const c=await call(null,'bob_claim_job',[q.jobId,j.capability],'service_role')
  assert.equal(c.screen,null)
  await assert.rejects(call(null,'bob_capture_turn_screen',[project,owner,c.threadId,id,c.generation,screen],'service_role'),/turn_screen_changed/)
  await call(null,'bob_finish_job',[q.jobId,c.claimToken,'fixture_done'],'service_role')
  await assert.rejects(call(null,'bob_capture_turn_screen',[project,owner,c.threadId,id,c.generation,null],'service_role'),/turn_not_claimed/)
 })
})

test('P3 upgrade freezes an already queued job without changing its lease, journal, or conversation',async t=>{
 const owner=randomUUID(),turn=randomUUID();let project:string='',queued:any
 const pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
  if(name!=='20260930112431_bob_p3_context_and_source_changes.sql')return
  await db.query('insert into auth.users values($1,$2,now())',[owner,'upgrade-screen@example.test'])
  project=((await asProjectUser(db,owner,'select bob.create_project($1) result',[{name:'Old queued job'}])).rows[0].result as any).id
  queued=(await asProjectUser(db,null,'select bob.bob_enqueue_job($1,$2,$3,$4,$5,$6,$7) result',[project,owner,turn,'Continue old turn.',{ciphertext:'fixture'},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker'],'service_role')).rows[0].result
 });t.after(()=>pg.close())
 const captured:any=(await pg.query('select screen from bob_private.bob_turn_screens where turn_id=$1',[turn])).rows[0]
 assert.equal(captured.screen,null)
 await assert.rejects(asProjectUser(pg,null,'select bob.bob_enqueue_job_v2($1,$2,$3,$4,$5,$6,$7,$8)',[project,owner,turn,'Continue old turn.',{ciphertext:'fixture'},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker',{surface:'project'}],'service_role'),/turn_screen_changed/)
 const job:any=(await pg.query('select * from bob_private.bob_jobs where id=$1',[(queued as any).jobId])).rows[0]
 assert.equal(job.status,'queued');assert.equal(job.claim_token,null);assert.equal(job.total_claims,0)
 const claimed:any=(await asProjectUser(pg,null,'select bob.bob_claim_job($1,$2) result',[job.id,job.capability],'service_role')).rows[0].result
 assert.equal(claimed.screen,null);assert.equal(claimed.message,'Continue old turn.');assert.deepEqual(claimed.entries,[])
})
