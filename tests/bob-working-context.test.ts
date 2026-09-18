import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { prepareWorkingContext, type ContextStore, type ContextFrame } from '../supabase/functions/_shared/bob-working-context.ts'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'

const pg = new PGlite()
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002'
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
const result = (data: string) => ({ success: true, data, responseId: 'resp_fixture', model: 'fixture', usage })
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated'): Promise<any> {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
type Claim = { projectId: string; userId: string; threadId: string; generation: number; turn: string; message: string }
async function claim(message: string, userId = one, projectId = 'A'): Promise<Claim> {
  const turn = randomUUID()
  const row = (await as(null, 'select bob.bob_claim_turn($1,$2,$3,$4) d', [projectId,userId,turn,message], 'service_role')).rows[0].d
  assert.equal(row.status, 'claimed')
  return { projectId, userId, threadId: row.thread_id, generation: row.generation, turn, message }
}
const bind = (c: Claim) => [c.projectId,c.userId,c.threadId,c.turn,c.generation]
function store(c: Claim): ContextStore {
  const call = async (sql: string, args: unknown[] = []) => (await as(null,sql,[...bind(c),...args],'service_role')).rows[0].d
  return {
    load: () => call('select bob.bob_load_context($1,$2,$3,$4,$5) d'),
    save: (expected, through, summary) => call('select bob.bob_save_context_summary($1,$2,$3,$4,$5,$6,$7,$8) d',[expected,through,summary]),
    search: (query, before) => call('select bob.bob_search_context_history($1,$2,$3,$4,$5,$6,$7) d',[query,before]),
  }
}
async function commit(c: Claim, answer: string) {
  await as(null,'select bob.bob_commit_turn_v2($1,$2,$3,$4,$5,$6,$7,$8)',[...bind(c),answer,JSON.stringify({kind:'ai_assessment',sources:[],partial:false}),'resp_old'],'service_role')
}
async function fail(c: Claim) { await as(null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',bind(c),'service_role') }
async function clean() { await pg.exec('truncate bob.bob_threads cascade') }
const research = async (dataset: string, query: string | null=null, after: string | null=null, user=one, project='A', id: string | null=null) =>
  (await as(user,'select bob.search_bob_project_data_v2($1,$2,$3,null,null,$4,$5) d',[project,dataset,query,id,after])).rows[0].d
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
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[one,'one@example.test',two,'two@example.test'])
  const legacy = new URL('../db/migrations/', import.meta.url)
  for (const f of (await readdir(legacy)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,legacy),'utf8'))
  await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Plan A'),('B','b','Private B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','ON',$1),('twoB','B','Two','TW',$2)",[one,two])
  await setupSharedSocial(pg)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(f,dir),'utf8'))
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('twoA','A','Two','TW',$1)",[two])
  await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','main','Main'),('areaB','B','private','Private')")
})
after(()=>pg.close())

test('T1 contains exactly five individual verbatim messages; T2 folds only older prefix and advances incrementally', async () => {
  await clean()
  const texts: string[] = []
  for (let i=0;i<5;i++) {
    const question=`Fråga ${i}\n  exakt 70 × 160 cm.`
    const answer=`Svar ${i}\n${i===4?'ä'.repeat(20000):'Arbetsförslag, ej uppmätt.'}`
    const c=await claim(question); await commit(c,answer); texts.push(question,answer)
  }
  const c=await claim('Aktuell fråga\n  exakt!')
  const frame=await store(c).load() as ContextFrame
  assert.deepEqual(frame.recent.map(m=>m.text),[...texts.slice(-4),c.message])
  assert.deepEqual(frame.older.map(m=>m.text),texts.slice(0,6))
  assert.equal(frame.lastFoldedSeq,0); assert.equal(frame.foldThroughSeq,6)
  await store(c).save(0,6,'Dimension 70 × 160 cm. Bara arbetsförslag. [seq 1–6]')
  const ready=await store(c).load() as ContextFrame
  assert.equal(ready.older.length,0); assert.equal(ready.summary,'Dimension 70 × 160 cm. Bara arbetsförslag. [seq 1–6]')
  await assert.rejects(store(c).save(0,6,'Stale replacement'),/context_changed/)
  await commit(c,'Svar på aktuell fråga')
  const next=await claim('Nästa fråga')
  const nextFrame=await store(next).load() as ContextFrame
  assert.equal(nextFrame.lastFoldedSeq,6)
  assert.deepEqual(nextFrame.older.map(m=>m.seq),[7,8]); assert.equal(nextFrame.recent.length,5)
  await fail(next)
})

test('summary/history are service-only, owner/project/turn fenced, revoked and stale workers cannot read or write', async () => {
  await clean(); const c=await claim('Own question')
  await assert.rejects(as(one,'select bob.bob_load_context($1,$2,$3,$4,$5)',bind(c)),/permission denied/)
  await assert.rejects(as(null,'select bob.bob_load_context($1,$2,$3,$4,$5)',bind(c),'anon'),/permission denied/)
  await assert.rejects(as(one,'select * from bob_private.bob_thread_summary'),/permission denied/)
  await assert.rejects(store({...c,userId:two}).load(),/project_denied/)
  await assert.rejects(store({...c,projectId:'B',userId:two}).search('',null),/project_denied/)
  await assert.rejects(store({...c,generation:c.generation-1}).load(),/turn_not_claimed/)
  await pg.exec("delete from bob.people where id='oneA'")
  await assert.rejects(store(c).load(),/project_denied/)
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','ON',$1)",[one])
  await fail(c)
})

test('exact old-message search is paginated and reset erases summary/history, not project data', async () => {
  await clean()
  for(let i=0;i<5;i++){const c=await claim(`needle fråga ${i}`); await commit(c,`needle svar ${i}`)}
  const c=await claim('Latest'), other=await claim('OTHER PERSON',two)
  const frame=await store(c).load() as ContextFrame
  await store(c).save(frame.lastFoldedSeq,frame.foldThroughSeq,'needle summary')
  const page1=await store(c).search('needle',null) as any
  assert.equal(page1.messages.length,5); assert(page1.truncated)
  const page2=await store(c).search('needle',page1.nextBeforeSeq) as any
  assert.equal(page2.messages.length,5); assert(!page2.truncated)
  assert.equal(new Set([...page1.messages,...page2.messages].map(m=>m.seq)).size,10)
  assert(!JSON.stringify(page1).includes('OTHER PERSON'))
  assert.equal((await store(c).search("'; drop table bob.projects; --",null) as any).messages.length,0)
  await fail(c); await fail(other)
  const revision=(await pg.query('select next_seq from bob.bob_threads where id=$1',[c.threadId])).rows[0].next_seq
  await as(one,'select bob.bob_reset_conversation($1,$2,$3)',['A',c.threadId,revision])
  assert.equal((await pg.query('select * from bob_private.bob_thread_summary where thread_id=$1',[c.threadId])).rows.length,0)
  assert.equal((await pg.query("select * from bob.projects where id='A'")).rows.length,1)
  await assert.rejects(store(c).load(),/project_denied/)
  assert.equal((await pg.query('select * from bob.bob_threads where id=$1',[other.threadId])).rows.length,1)
})

test('real orchestration folds once, replays full recent messages, drops old provider cursor and exposes historical retrieval', async () => {
  await clean()
  for(let i=0;i<4;i++){ const c=await claim(`U ${i}`); await commit(c,`A ${i}`) }
  const c=await claim('Välj höjderna, ta ett arbetsbeslut.')
  let summaries=0
  const prepared=await prepareWorkingContext({...c,store:store(c),hasAccess:async()=>true,deadline:Date.now()+100000,
    callModel:async options=>{summaries++;assert.equal(options.previousResponseId,undefined); assert.equal(options.tools,undefined);return result('Earlier working choices, not measured [seq 1–4]')},
  })
  assert.equal(summaries,1); assert.equal(prepared.recent.length,5)
  const calls:any[]=[]
  const answer=await runProjectAnswer({projectId:'A',userId:one,message:c.message,context:prepared,previousResponseId:'FORBIDDEN_OLD_CHAIN',hasAccess:async()=>true,
    lookup:createProjectLookup('A',async()=>({data:{records:[{id:'A',description:'Current plan'}],related:[],truncated:false},error:null}),1000,12),
    callModel:async options=>{calls.push(options);return result('Jag väljer ett tydligt arbetsmått, med angiven frigång.')},
  })
  assert(answer.ok);assert.equal(calls[0].previousResponseId,undefined)
  assert.deepEqual(calls[0].messages.slice(-5).map((m:any)=>m.content),prepared.recent.map(m=>m.text))
  assert(calls[0].tools.some((t:any)=>t.function.name==='search_conversation_history'))
  assert(!calls[0].systemMessage.includes('Earlier working choices'))
  assert.equal((await prepared.history.search({query:'U 0',before_seq:null})).status,'ok')
  assert.equal((await prepared.history.search({query:'',before_seq:null,projectId:'B'})).status,'invalid')
  await fail(c)
})

test('summary failure never generates an answer from partial history; retry can continue from saved chunks', async () => {
  await clean()
  for(let i=0;i<5;i++){const c=await claim('Question '+i);await commit(c,'Answer '+i)}
  const c=await claim('Current')
  const beforeFrame=await store(c).load() as ContextFrame
  await assert.rejects(prepareWorkingContext({...c,store:store(c),hasAccess:async()=>true,deadline:Date.now()+10000,
    callModel:async()=>({...result(''),success:false})}),/context_unavailable/)
  assert.equal((await store(c).load() as ContextFrame).lastFoldedSeq,beforeFrame.lastFoldedSeq)
  let answers=0,failures=0
  const out=await runClaimedProjectTurn({projectId:'A',userId:one,message:'Current',hasAccess:async()=>true,
    lookup:createProjectLookup('A',async()=>({data:null,error:null})),
    callModel:async()=>{answers++;return result('Wrong partial answer')},
    prepareContext:async()=>{throw new Error('context_unavailable')},fail:async()=>{failures++},
  })
  assert.deepEqual(out,{ok:false,error:'context_unavailable'}); assert.equal(answers,0); assert.equal(failures,1)
  const ready=await prepareWorkingContext({...c,store:store(c),hasAccess:async()=>true,deadline:Date.now()+10000,callModel:async()=>result('Recovered summary')})
  assert.equal(ready.summary,'Recovered summary');await fail(c)
})

test('research pagination finds records beyond the first page and enforces caller/project/field boundaries', async () => {
  for(let i=0;i<31;i++) await pg.query("insert into bob.tasks(id,area_id,name,instructions) values($1,'areaA',$2,$3)",['page_'+String(i).padStart(2,'0'),'Drawer '+i,'Castors + bottom + mattress + clearance'])
  await pg.exec("insert into bob.tasks(id,area_id,name) values('foreign','areaB','Private dimension')")
  const first=await research('tasks','Drawer'); assert.equal(first.records.length,25);assert(first.next_cursor)
  const next=await research('tasks','Drawer',first.next_cursor);assert.equal(next.records.length,6);assert.equal(next.next_cursor,null)
  assert.equal(new Set([...first.records,...next.records].map(r=>r.id)).size,31)
  assert(first.records.every(r=>r.instructions.includes('clearance')))
  assert.equal((await research('tasks',null,null,two,'A','foreign')).records.length,0)
  await assert.rejects(research('tasks',null,null,one,'B'),/project_denied/)
  await assert.rejects(research('auth.users'),/invalid_lookup/)
  assert.equal((await research('tasks',"'; drop table bob.tasks; --")).records.length,0)
  for (const dataset of ['measurements','components','solutions','target','artifacts','requirements']) assert(Array.isArray((await research(dataset)).records))
})

test('selected target returns its EXACT solution version, not the newer unselected alternative; component fields have no identity leakage', async () => {
  const solution=randomUUID(), component=randomUUID()
  await pg.transaction(async tx=>{
    await tx.query("insert into bob.solutions(id,project_id,current_revision) values($1,'A',2)",[solution])
    for(let rev=1;rev<=2;rev++) await tx.query("insert into bob.solution_revisions(solution_id,project_id,revision,title,description,change_note,recorded_by,actor_label) values($1,'A',$2,$3,$4,'fixture',$5,'Fixture')",[solution,rev,'Option '+rev,rev===1?'Selected 70 × 160 cm':'NOT SELECTED 90 × 200 cm',one])
    await tx.exec("insert into bob.project_targets(project_id,current_revision) values('A',1)")
    await tx.query("insert into bob.target_revisions(project_id,revision,solution_id,solution_revision,reason,recorded_by,actor_label) values('A',1,$1,1,'Selected exact version',$2,'Fixture')",[solution,one])
    await tx.query("insert into bob.existing_components(id,project_id) values($1,'A')",[component])
    await tx.query("insert into bob.component_revisions(component_id,project_id,revision,name,specification,change_note,recorded_by,actor_label) values($1,'A',1,'Frame','Fits 70 × 160','Fixture',$2,'Fixture')",[component,one])
  })
  const target=await research('target')
  assert.equal(target.records[0].description,'Selected 70 × 160 cm');assert.equal(target.records[0].solution_revision,1)
  assert.equal((await research('solutions')).records[0].description,'NOT SELECTED 90 × 200 cm')
  const components=await research('components');assert.equal(components.records[0].specification,'Fits 70 × 160')
  assert(!JSON.stringify(components).includes('recorded_by'));assert(!JSON.stringify(components).includes(one))
})

test('paging is byte-bounded without silently dropping the first record or losing the resume cursor', async()=>{
  for(let i=0;i<4;i++) await pg.query("insert into bob.tasks(id,area_id,name,instructions) values($1,'areaA',$2,$3)",['large_'+i,'Large fixture '+i,'x'.repeat(11000)])
  const first=await research('tasks','Large fixture')
  assert(first.truncated);assert(first.records.length>0);assert(Buffer.byteLength(JSON.stringify(first))<=30000)
  const next=await research('tasks','Large fixture',first.next_cursor)
  assert.equal(first.records.length+next.records.length,4)
  await pg.query("insert into bob.tasks(id,area_id,name,instructions) values('too_large','areaA','Oversized','x'||$1)",['🪵'.repeat(9000)])
  await assert.rejects(research('tasks','Oversized'),/lookup_record_too_large/)
})
