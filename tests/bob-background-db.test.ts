import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const pg = new PGlite()
const one = '00000000-0000-4000-8000-000000000001'
const two = '00000000-0000-4000-8000-000000000002'
const both = '00000000-0000-4000-8000-000000000003'
const guest = '00000000-0000-4000-8000-000000000004'
let sequence = 0
const newId = () => '30000000-0000-4000-8000-' + String(++sequence).padStart(12, '0')
const message = 'Spara måtten och arbetsuppgiften enligt mitt val A.'
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated'): Promise<any> {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
before(async () => {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated; grant all on storage.objects,storage.buckets to anon,authenticated;
  `)
  await pg.exec(`create schema cron; create schema net; create table net.sent(url text,headers jsonb,body jsonb); create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint'; create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$ begin insert into net.sent values(url,headers,body); return 1; end $$;`)
  for (const [i, uid] of [one,two,both,guest].entries()) await pg.query('insert into auth.users values($1,$2,now())', [uid,uid===guest?'guest@bob.local':`write${i}@example.test`])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, legacy), 'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Porch A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)", [one,two])
  await setupSharedSocial(pg)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f, dir), 'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1),('guestA','A','Guest','G',$2)", [both,guest])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','entry','Entry'),('areaB','B','private','Private'); insert into bob.tasks(id,area_id,name,hours) values('taskA','areaA','Original','2h'),('taskB','areaB','Private work','')")
})
after(() => pg.close())


async function service(name: string, args: unknown[]) {
  return (await as(null, `select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`, args, 'service_role')).rows[0].result
}
async function enqueue(user=one, project='A', turn=newId()) {
  return {...await service('bob_enqueue_job',[project,user,turn,message,{version:1,ciphertext:'fixture'},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker']),turn}
}
async function secret(id: string) {return (await pg.query<any>('select * from bob_private.bob_jobs where id=$1',[id])).rows[0]}
async function claimJob(id: string) { return service('bob_claim_job',[id,(await secret(id)).capability]) }

test('queued jobs are private, idempotent, capability-bound and guest-isolated',async()=>{
  const q=await enqueue()
  assert.equal(q.status,'accepted')
  assert.equal((await enqueue(one,'A',q.turn)).jobId,q.jobId)
  await assert.rejects(service('bob_enqueue_job',['A',one,q.turn,'changed',{},new Date(Date.now()+600000).toISOString(),'https://fixture.supabase.co/functions/v1/bob-worker']),/turn_reused/)
  assert.equal((await as(one,'select bob.bob_job_status($1,$2) result',['A',q.turn])).rows[0].result.status,'queued')
  assert.equal((await as(both,'select bob.bob_job_status($1,$2) result',['A',q.turn])).rows[0].result,null)
  await assert.rejects(as(two,'select bob.bob_job_status($1,$2)',['A',q.turn]),/project_denied/)
  await assert.rejects(as(one,'select * from bob_private.bob_jobs'),/permission denied/)
  await assert.rejects(as(one,'select bob.bob_claim_job($1,$2)',[q.jobId,newId()]),/permission denied/)
  await assert.rejects(service('bob_claim_job',[q.jobId,newId()]),/job_denied/)
  const c=await claimJob(q.jobId)
  assert.equal(c.status,'claimed')
  assert.equal((await claimJob(q.jobId)).status,'inactive')
  await service('bob_finish_job',[q.jobId,c.claimToken,'fixture_done'])
  assert.equal((await enqueue(guest)).mode,'local_only')
})

test('server driver dispatches without a browser; continuation fences stale workers and never repeats a committed write',async()=>{
  const q=await enqueue()
  assert.equal(await service('bob_dispatch_jobs',[]),1)
  assert.equal(await service('bob_dispatch_jobs',[]),0)
  assert.equal((await pg.query<any>('select body from net.sent order by ctid desc limit 1')).rows[0].body.jobId,q.jobId)
  const c=await claimJob(q.jobId)
  const payload={kind:'task',record_id:null,expected_updated_at:null,expected_revision:null,request_quote:'Spara',data:{area_id:'areaA',name:'Background task',instructions:'Once only'}}
  const write=async(g:number)=>(await as(one,'select bob.bob_project_write($1,$2,$3,$4,$5) result',['A',c.threadId,q.turn,g,payload])).rows[0].result
  const receipt=await write(c.generation)
  await service('bob_save_job_step',[q.jobId,c.claimToken,'model:0','a'.repeat(64),{responseId:'resp_fixture'}])
  await service('bob_yield_job',[q.jobId,c.claimToken])
  const resumed=await claimJob(q.jobId)
  assert(resumed.generation>c.generation)
  assert.equal(resumed.entries.length,1)
  await assert.rejects(write(c.generation),/turn_not_claimed/)
  await assert.rejects(service('bob_save_job_step',[q.jobId,c.claimToken,'late:0','b'.repeat(64),{}]),/job_not_claimed/)
  await assert.rejects(service('bob_finish_job',[q.jobId,c.claimToken,'late']),/job_not_claimed/)
  assert.deepEqual(await write(resumed.generation),receipt)
  assert.equal((await pg.query<any>("select count(*)::int n from bob.tasks where name='Background task'")).rows[0].n,1)
  const settled=(await as(one,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',['A',c.threadId,q.turn,resumed.generation])).rows[0].result
  await service('bob_commit_turn_v2',['A',one,c.threadId,q.turn,settled.generation,'Done',{kind:'ai_assessment',sources:[],partial:false,writes:[receipt]},'resp_fixture'])
  await service('bob_finish_job',[q.jobId,resumed.claimToken,null])
  assert.equal((await secret(q.jobId)).status,'completed')
  assert.equal((await secret(q.jobId)).credential,null)
  assert.equal((await pg.query<any>('select count(*)::int n from bob_private.bob_job_steps where job_id=$1',[q.jobId])).rows[0].n,0)
  assert.equal((await claimJob(q.jobId)).status,'inactive')
})

test('killed worker resumes after lease expiry; expired job fails honestly and erases its token',async()=>{
  const q=await enqueue(),first=await claimJob(q.jobId)
  await pg.query("update bob_private.bob_jobs set lease_until=now()-interval '1 second' where id=$1",[q.jobId])
  const resumed=await claimJob(q.jobId)
  assert.notEqual(resumed.claimToken,first.claimToken)
  await pg.query("update bob_private.bob_jobs set expires_at=now()-interval '1 second' where id=$1",[q.jobId])
  await service('bob_dispatch_jobs',[])
  const j=await secret(q.jobId)
  assert.equal(j.status,'failed');assert.equal(j.credential,null)
  assert.equal((await pg.query<any>("select delivery_state from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='user'",[j.thread_id,q.turn])).rows[0].delivery_state,'failed')
  // Explicit retry of that turn remains possible, with the existing write ledger.
  const retry=await enqueue(one,'A',q.turn)
  assert.equal(retry.status,'accepted');assert.notEqual(retry.jobId,q.jobId)
  const c=await claimJob(retry.jobId);await service('bob_finish_job',[retry.jobId,c.claimToken,'fixture_done'])
})
