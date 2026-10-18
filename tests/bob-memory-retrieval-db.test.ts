import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { createMemoryRetrieval, memoryRetrievalStore } from '../supabase/functions/_shared/bob-memory-retrieval.ts'

let pg: PGlite
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002'
const model = 'test-pinned-embedding-model'
const v = (axis = 0) => Array.from({ length: 256 }, (_, i) => Number(i === axis))
type Claim = { project: string; user: string; thread: string; turn: string; generation: number }
const bind = (c: Claim) => [c.project, c.user, c.thread, c.turn, c.generation]
async function service(sql: string, params: unknown[]) {
  return (await asProjectUser(pg, null, sql, params, 'service_role')).rows[0] as any
}
async function claim(text: string, user = one, project = 'memory-A'): Promise<Claim> {
  const turn = randomUUID(), row = (await service('select bob.bob_claim_turn($1,$2,$3,$4) d', [project,user,turn,text])).d
  assert.equal(row.status, 'claimed')
  return { project,user,thread:row.thread_id,turn,generation:row.generation }
}
async function commit(c: Claim, answer: string) {
  await service('select bob.bob_commit_turn_v2($1,$2,$3,$4,$5,$6,$7,$8) d', [...bind(c),answer,JSON.stringify({kind:'ai_assessment',sources:[],partial:false}),'test-response'])
}
async function clean() { await pg.exec('truncate bob.bob_threads cascade') }
const pending = async (c: Claim, useModel = model, limit = 8) => (await service('select bob.bob_context_index_pending($1,$2,$3,$4,$5,$6,$7) d', [...bind(c),limit,useModel])).d
const save = async (c: Claim, items: unknown[], useModel = model) => (await service('select bob.bob_context_index_save($1,$2,$3,$4,$5,$6,$7) d', [...bind(c),JSON.stringify(items),useModel])).d
const search = async (c: Claim, query: string, embedding: number[] | null = null, useModel = model, before: number | null = null) =>
  (await service('select bob.bob_search_context_memory($1,$2,$3,$4,$5,$6,$7,$8,$9) d', [...bind(c),query,before,embedding && JSON.stringify(embedding),useModel])).d
const read = async (c: Claim, seq: number, offset = 0) => (await service('select bob.bob_read_context_message($1,$2,$3,$4,$5,$6,$7) d',[...bind(c),seq,offset])).d
before(async () => {
  pg = await projectSchema()
  await pg.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[one,'memory-one@example.test',two,'memory-two@example.test'])
  await pg.exec("insert into bob.projects(id,slug,name) values('memory-A','memory-a','Memory A'),('memory-B','memory-b','Memory B')")
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('memory-one','memory-A','One','ON',$1),('memory-two','memory-A','Two','TW',$2),('memory-two-b','memory-B','Two','TW',$2)",[one,two])
})
after(async () => { await pg?.close() })

test('source retrieval reads exact Unicode pages, with stable source identity and explicit bounds', async () => {
  await clean()
  const original = '🛠️'.repeat(2300) + '\n90 cm är ett förslag, jag måste mäta först.'
  const initial = await claim('Spara originalunderlaget.'); await commit(initial,original)
  const c = await claim('Fortsätt')
  const first = await read(c,2), second = await read(c,2,first.nextOffset)
  assert.equal(first.status,'ok'); assert.equal(first.message.seq,2); assert.equal(first.offset,0)
  assert.equal(first.nextOffset,4000); assert.equal(second.nextOffset,null)
  assert.equal(first.message.text+second.message.text,original)
  assert.equal(first.source.fingerprint,second.source.fingerprint)
  assert.equal(first.totalCharacters,[...original].length)
  assert.equal((await read(c,2,first.totalCharacters)).status,'invalid_offset')
  assert.equal((await read(c,999)).status,'missing')
})

test('real pgvector search joins semantic and lexical relevance within one private thread', async () => {
  await clean()
  const initial = await claim('Avståndet från överslafen till taket måste mätas.'); await commit(initial,'Måttet är ännu okänt.')
  const other = await claim('PRIVATE OTHER MEMBER SECRET',two); await commit(other,'Hidden')
  const c = await claim('Hur mycket frihöjd finns?')
  const batch = await pending(c)
  assert.deepEqual(batch.chunks.map((x: any)=>x.seq),[1,2])
  assert(!JSON.stringify(batch).includes('PRIVATE'))
  const saved = await save(c,batch.chunks.map((x: any)=>({seq:x.seq,chunkStart:x.chunkStart,fingerprint:x.fingerprint,embedding:v(x.seq===1?0:1)})))
  assert.equal(saved.saved,2)
  assert.equal((await pending(c)).chunks.length,0)
  const semantic = await search(c,'frihöjd',v())
  assert.equal(semantic.searchMode,'hybrid'); assert.equal(semantic.messages[0].seq,1)
  assert.equal(semantic.semanticCoverage,'on_demand'); assert(!Object.hasOwn(semantic,'semanticPendingChunks'))
  const lexical = await search(c,'mätas')
  assert.equal(lexical.searchMode,'lexical'); assert.equal(lexical.messages[0].seq,1)
  assert.equal(lexical.sources[0].fingerprint,semantic.sources[0].fingerprint)
  assert.equal((await search(c,'PRIVATE')).messages.length,0)
  const browse = await search(c,''); assert.equal(browse.searchMode,'browse'); assert.deepEqual(browse.messages.map((x:any)=>x.seq),[2,1])
})

test('old conversations backfill in bounded chunks and model/version changes invalidate embeddings', async () => {
  await clean()
  const initial = await claim('Preserve the long source'); await commit(initial,'long original '.repeat(1800))
  const c = await claim('Read history')
  let total = 0, calls = 0
  while (true) {
    const batch = await pending(c); if (!batch.chunks.length) break
    assert(batch.chunks.length<=8); assert(batch.chunks.every((x:any)=>[...x.text].length<=2000))
    await save(c,batch.chunks.map((x:any)=>({seq:x.seq,chunkStart:x.chunkStart,fingerprint:x.fingerprint,embedding:v()})))
    total+=batch.chunks.length; calls++
  }
  assert(calls>1); assert(total>8)
  await pg.query('delete from bob_private.bob_message_embeddings where thread_id=$1 and seq=2 and chunk_start=2000',[c.thread])
  const hole=await pending(c); assert.deepEqual(hole.chunks.map((x:any)=>[x.seq,x.chunkStart]),[[2,2000]])
  await save(c,hole.chunks.map((x:any)=>({...x,embedding:v()})))
  const changedModel = await pending(c,'other-pinned-model'); assert.equal(changedModel.chunks.length,8)
  await pg.query("update bob.bob_messages set text='Revised original source' where thread_id=$1 and seq=2",[c.thread])
  const stale = await search(c,'unrelated meaning',v())
  assert(!stale.messages.some((x:any)=>x.seq===2)); assert.equal(stale.semanticCoverage,'on_demand')
  const changed = await pending(c); assert.equal(changed.chunks.length,1); assert.equal(changed.chunks[0].seq,2)
  await assert.rejects(save(c,[{...changed.chunks[0],fingerprint:'a'.repeat(32),embedding:v()}]),/context_source_changed/)
  assert.equal((await read(c,2)).message.text,'Revised original source')
})

test('claim, ownership, membership and table boundaries protect every memory entry point', async () => {
  await clean()
  const first=await claim('Private source'); await commit(first,'Saved')
  const c=await claim('Continue')
  const pendingSql='select bob.bob_context_index_pending($1,$2,$3,$4,$5,$6,$7) d'
  for (const role of ['anon','authenticated']) {
    await assert.rejects(asProjectUser(pg,one,pendingSql,[...bind(c),8,model],role),/permission denied/)
    await assert.rejects(asProjectUser(pg,one,'select * from bob_private.bob_message_embeddings',[],role),/permission denied/)
  }
  await assert.rejects(pending({...c,user:two}),/project_denied/)
  await assert.rejects(read({...c,project:'memory-B'},1),/project_denied/)
  await assert.rejects(read({...c,generation:c.generation+1},1),/turn_not_claimed/)
  await pg.query("delete from bob.people where id='memory-one'")
  await assert.rejects(search(c,'Private',v()),/project_denied/)
  await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('memory-one','memory-A','One','ON',$1)",[one])
})

test('same-watermark summary refresh uses exact CAS and reset cascades the derived cache', async () => {
  await clean()
  const initial=await claim('Maybe 90 cm'); await commit(initial,'Await measurement')
  const c=await claim('Continue')
  const frame=(await service('select bob.bob_load_context($1,$2,$3,$4,$5) d',bind(c))).d
  const summary=JSON.stringify({gist:'90 cm remains a proposal; measurement is missing.',index:[{seq:1,descriptor:'Proposed size'}]})
  const refresh=async(previous:string)=>(await service('select bob.bob_refresh_context_summary($1,$2,$3,$4,$5,$6,$7,$8) d',[...bind(c),frame.lastFoldedSeq,previous,summary])).d
  assert.deepEqual(await refresh(frame.summary),{lastFoldedSeq:frame.lastFoldedSeq})
  await assert.rejects(refresh(frame.summary),/context_changed/)
  assert.equal((await service('select bob.bob_load_context($1,$2,$3,$4,$5) d',bind(c))).d.summary,summary)
  const batch=await pending(c); await save(c,batch.chunks.map((x:any)=>({...x,embedding:v()})))
  assert(Number((await pg.query('select count(*) n from bob_private.bob_message_embeddings')).rows[0].n)>0)
  await pg.query('delete from bob.bob_threads where id=$1',[c.thread])
  assert.equal(Number((await pg.query('select count(*) n from bob_private.bob_message_embeddings')).rows[0].n),0)
})

test('the runtime adapter performs real on-demand indexing then source-linked history lookup', async () => {
  await clean()
  const initial=await claim('Det finns ett rör bakom väggen.'); await commit(initial,'Röret behöver beaktas.')
  const c=await claim('Vad vet vi om installationerna?')
  const order = ['p_project','p_user','p_thread','p_turn','p_generation']
  const values = Object.fromEntries(order.map((k,i)=>[k,bind(c)[i]]))
  const store=memoryRetrievalStore(async(name,args={})=>{
    const all={...values,...args}, params=Object.values(all)
    return (await service(`select bob.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) d`,params)).d
  })
  const retrieval=createMemoryRetrieval({projectId:c.project,threadId:c.thread,store,hasAccess:async()=>true,embedder:{model,embed:async texts=>texts.map(()=>v())}})
  const result=await retrieval.search({query:'installationer',before_seq:null})
  assert.equal(result.status,'ok'); assert.equal(result.searchMode,'hybrid')
  assert.equal((await pending(c)).chunks.length,0)
  assert.equal((await retrieval.read({seq:1,offset:null})).status,'ok')
})


test('completed long-history prefix is skipped before chunk expansion and search avoids global coverage counts', async t => {
  await clean()
  const initial=await claim('Keep the historical context'); await commit(initial,'Preserved')
  await pg.query(`insert into bob.bob_messages(thread_id,seq,turn_id,role,text)
    select $1,n,gen_random_uuid(),'assistant',repeat('Historical construction details. ',600) from generate_series(3,82) n`,[initial.thread])
  await pg.query('update bob.bob_threads set next_seq=83 where id=$1',[initial.thread])
  await pg.query(`insert into bob_private.bob_message_embeddings(thread_id,seq,chunk_start,model,source_fingerprint,embedding)
    select m.thread_id,m.seq,c,$2,md5(m.text),$3::extensions.vector(256) from bob.bob_messages m
    cross join lateral generate_series(0,char_length(m.text)-1,2000) c where m.thread_id=$1`,[initial.thread,model,JSON.stringify(v())])
  const c=await claim('Find a detail')
  const started=performance.now(), batch=await pending(c), pendingMs=performance.now()-started
  assert.deepEqual(batch.chunks,[]); assert.equal(batch.hasMore,false)
  await pg.query('delete from bob_private.bob_message_embeddings where thread_id=$1 and seq=82 and chunk_start=4000',[c.thread])
  const hole=await pending(c); assert.deepEqual(hole.chunks.map((x:any)=>[x.seq,x.chunkStart]),[[82,4000]])
  const searchStart=performance.now(), result=await search(c,'construction',v()), searchMs=performance.now()-searchStart
  assert.equal(result.searchMode,'hybrid'); assert.equal(result.semanticCoverage,'on_demand')
  assert.equal(result.messages.length,5); assert(!Object.hasOwn(result,'semanticPendingChunks'))
  t.diagnostic(`82 historical messages, ~1.6M source characters: pending ${pendingMs.toFixed(0)}ms, search ${searchMs.toFixed(0)}ms in local PGlite; not a hosted latency guarantee.`)
})
