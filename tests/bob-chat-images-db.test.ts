import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectSchema, asProjectUser } from './support/project-schema.ts'

test('chat images are private, same-project, ready, immutable and durable across worker retries', async t => {
  const pg = await projectSchema(async (db, name) => {
    if (name === '20260924120448_bob_background_jobs.sql') await db.exec(`create schema cron; create schema net;
      create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
  })
  t.after(() => pg.close())
  const owner = randomUUID(), member = randomUUID(), other = randomUUID()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())', [owner,'photos@example.test',member,'member@example.test',other,'other@example.test'])
  const call = async (user: string | null, name: string, args: unknown[], role='authenticated'): Promise<any> =>
    (await asProjectUser(pg,user,`select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
  const project = (await call(owner,'create_project',[{name:'Chat image fixture'}])).id
  const foreign = (await call(other,'create_project',[{name:'Other project'}])).id
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,'Member','M',$3)",[randomUUID(),project,member])
  const photo = randomUUID(), second = randomUUID(), outside = randomUUID(), pending = randomUUID()
  for (const [id,pid,actor,state] of [[photo,project,owner,'ready'],[second,project,owner,'ready'],[outside,foreign,other,'ready'],[pending,project,owner,'pending']]) {
    await pg.query(`insert into bob.media_assets(id,project_id,title,original_name,purpose,content_type,byte_size,width,height,created_by,state)
      values($1,$2,'Place','place.png','reference','image/png',8,1,1,$3,$4)`,[id,pid,actor,state])
  }
  const enqueue = (turn: string, images: unknown) => call(null,'bob_enqueue_job_v3',[project,owner,turn,'Make a mockup here.',{ciphertext:'fixture'},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker',null,images],'service_role')
  for (const ids of [[outside],[pending],[photo,photo],[photo,second,outside,pending,randomUUID()],[null]]) {
    const turn = randomUUID()
    await assert.rejects(enqueue(turn,ids),/image_unavailable|invalid_images/)
    assert.equal((await pg.query('select id from bob_private.bob_jobs where turn_id=$1',[turn])).rows.length,0,'invalid enqueue is rolled back')
    assert.equal((await pg.query('select id from bob.bob_messages where turn_id=$1',[turn])).rows.length,0)
  }
  const turn=randomUUID(), queued=await enqueue(turn,[photo,second])
  assert.deepEqual(queued.imageIds,[photo,second])
  assert.deepEqual((await enqueue(turn,null)).imageIds,[photo,second],'omission retains the original photo set')
  await assert.rejects(enqueue(turn,[second,photo]),/turn_images_changed/)
  await assert.rejects(enqueue(turn,[]),/turn_images_changed/)
  const own=await asProjectUser(pg,owner,'select image_ids from bob.bob_messages where turn_id=$1',[turn])
  assert.deepEqual(own.rows[0].image_ids,[photo,second])
  assert.equal((await asProjectUser(pg,member,'select image_ids from bob.bob_messages where turn_id=$1',[turn])).rows.length,0,'project membership does not expose another private chat')
  await assert.rejects(asProjectUser(pg,owner,'update bob.bob_messages set image_ids=$1 where turn_id=$2',[[outside],turn]),/permission denied/)
  const capability:any=(await pg.query('select capability from bob_private.bob_jobs where id=$1',[queued.jobId])).rows[0]
  const claimed=await call(null,'bob_claim_job',[queued.jobId,capability.capability],'service_role')
  const capture=(generation=claimed.generation,ids: unknown=null)=>call(null,'bob_capture_turn_images',[project,owner,claimed.threadId,turn,generation,ids],'service_role')
  assert.deepEqual(await capture(),{imageIds:[photo,second]})
  await assert.rejects(capture(claimed.generation,[outside]),/turn_images_changed/)
  await assert.rejects(call(owner,'bob_capture_turn_images',[project,owner,claimed.threadId,turn,claimed.generation,[photo,second]]),/permission denied/)
  await call(null,'bob_yield_job',[queued.jobId,claimed.claimToken],'service_role')
  const resumed=await call(null,'bob_claim_job',[queued.jobId,capability.capability],'service_role')
  await assert.rejects(capture(),/turn_not_claimed/)
  assert.deepEqual(await capture(resumed.generation),{imageIds:[photo,second]})
  await call(null,'bob_finish_job',[queued.jobId,resumed.claimToken,'fixture_retry'],'service_role')
  assert.deepEqual((await enqueue(turn,null)).imageIds,[photo,second],'failed job replacement keeps the same photos')
})
