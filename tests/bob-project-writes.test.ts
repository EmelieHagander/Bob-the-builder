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
type Claim = { project: string; user: string; turn: string; thread: string; generation: number }
async function claim(user = one, project = 'A'): Promise<Claim> {
  const turn = newId()
  const row: any = (await as(null, 'select bob.bob_claim_turn($1,$2,$3,$4) result', [project,user,turn,message], 'service_role')).rows[0].result
  assert.equal(row.status, 'claimed')
  return { project,user,turn,thread: row.thread_id,generation: row.generation }
}
async function fail(c: Claim) {
  await as(null, 'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)', [c.project,c.user,c.thread,c.turn,c.generation], 'service_role')
}
async function write(c: Claim, payload: unknown, user: string | null = c.user, role = 'authenticated'): Promise<any> {
  return (await as(user, 'select bob.bob_project_write($1,$2,$3,$4,$5) result',
    [c.project,c.thread,c.turn,c.generation,JSON.stringify(payload)], role)).rows[0].result
}
async function receipts(c: Claim, user = c.user): Promise<any[]> {
  return (await as(user, 'select bob.bob_read_write_receipts($1,$2,$3,$4) result', [c.project,c.thread,c.turn,c.generation])).rows[0].result
}
const task = (name: string, data = {}) => ({ kind:'task', record_id:null, expected_updated_at:null, expected_revision:null,
  request_quote:'Spara', data:{ area_id:'areaA', name, instructions:'Mät, kontrollera och dokumentera.', ...data } })
const measurement = (subject: string, data = {}) => ({ kind:'measurement', record_id:null, expected_updated_at:null, expected_revision:0,
  request_quote:'måtten', data:{ subject, value:'70', unit:'cm', truth:'provided_spec', source:'User selected 70 cm design dimension', notes:'Design size, not a site measurement', required:false, change_note:'Chosen dimension', ...data } })
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

test('project write commits description and receipt atomically, preserves other fields and rejects stale CAS', async () => {
  const c = await claim()
  const original: any = (await pg.query("select * from bob.projects where id='A'")).rows[0]
  const payload = {kind:'project',record_id:'A',expected_updated_at:original.updated_at,expected_revision:null,request_quote:'Spara',data:{description:'Chosen design: 70 × 160 cm. Estimate only.'}}
  const saved = await write(c,payload)
  assert.equal(saved.record.description,payload.data.description)
  assert.equal(saved.recordId,'A'); assert.equal(saved.operation,'updated')
  assert.equal((await as(one,"select name from bob.projects where id='A'")).rows[0].name,original.name)
  assert.deepEqual(await write(c,payload),saved)
  assert.equal((await receipts(c)).length,1)
  await fail(c)
  const next=await claim()
  await assert.rejects(write(next,payload), /record_changed/)
  assert.equal((await receipts(next)).length,0)
  await fail(next)
})

test('tasks create as todo and revisions preserve unrelated fields and status; no foreign Area even for dual member', async () => {
  const c=await claim()
  const saved=await write(c,task('Build chosen frame'))
  assert.equal(saved.record.status,'todo'); assert.equal(saved.operation,'created')
  assert.equal(saved.record.instructions,'Mät, kontrollera och dokumentera.')
  await assert.rejects(write(c,task('Rejected status',{status:'done'})), /unsupported_write_fields/)
  const row: any=(await pg.query("select * from bob.tasks where id='taskA'")).rows[0]
  const edit={...task('Updated instructions'),record_id:'taskA',expected_updated_at:row.updated_at}
  const revised=await write(c,edit)
  assert.equal(revised.operation,'updated')
  assert.equal((await pg.query("select hours from bob.tasks where id='taskA'")).rows[0].hours,'2h')
  await fail(c)
  const d=await claim(both)
  await assert.rejects(write(d,task('Foreign Area',{area_id:'areaB'})),/project_denied/)
  await assert.rejects(write(d,{...task('Foreign task',{area_id:'areaB'}),record_id:'taskB',expected_updated_at:row.updated_at}),/project_denied/)
  await fail(d)
})

test('measurements use canonical version history and sources; unknown/invalid facts leave no rows', async () => {
  const c=await claim()
  const saved=await write(c,measurement('Chosen bed width'))
  assert.equal(saved.record.truth,'provided_spec'); assert.equal(saved.record.value,'70'); assert.equal(saved.record.revision,1)
  assert.equal((await pg.query('select recorded_by from bob.measurement_revisions where measurement_id=$1',[saved.recordId])).rows[0].recorded_by,one)
  await assert.rejects(write(c,measurement('Bogus measurement',{truth:'measured',source:''})),/check constraint/)
  assert.equal((await pg.query("select * from bob.current_measurements where subject='Bogus measurement'")).rows.length,0)
  await fail(c)
  const d=await claim()
  const edit={...measurement('Chosen bed width',{value:'71',truth:'measured',source:'User measured with tape',notes:'Measured later'}),record_id:saved.recordId,expected_revision:1}
  const revised=await write(d,edit)
  assert.equal(revised.record.revision,2)
  assert.deepEqual((await pg.query('select truth from bob.measurement_revisions where measurement_id=$1 order by revision',[saved.recordId])).rows.map((r:any)=>r.truth),['provided_spec','measured'])
  await fail(d)
  const e=await claim()
  await assert.rejects(write(e,edit),/Record changed/)
  await fail(e)
})

test('exact-current-request quote, raw privileges, project, owner, generation and anonymous boundaries are enforced', async () => {
  const c=await claim()
  await assert.rejects(write(c,{...task('Unrequested'),request_quote:'Invented approval'}),/request_quote_required/)
  await assert.rejects(write(c,{...task('Spoofed'),actor_id:two}),/invalid_write/)
  await assert.rejects(write(c,task('Other user'),two),/project_denied/)
  await assert.rejects(write(c,task('Anonymous'),null),/project_denied/)
  await assert.rejects(write(c,task('Anon role'),null,'anon'),/permission denied/)
  await assert.rejects(write({...c,generation:c.generation-1},task('Stale')),/turn_not_claimed/)
  await assert.rejects(write({...c,project:'B'},task('Other project'),both),/project_denied/)
  await assert.rejects(receipts(c,two),/project_denied/)
  await assert.rejects(as(one,'select * from bob_private.bob_write_receipts'),/permission denied/)
  await assert.rejects(as(one,'select bob.bob_commit_turn_v2($1,$2,$3,$4,$5,$6,$7,$8)',[c.project,c.user,c.thread,c.turn,c.generation,'Spoof','{}','resp']),/permission denied/)
  await fail(c)
})

test('one create per semantic target/turn, bounded to eight writes, with idempotent readback', async () => {
  const c=await claim()
  const payload=task('Unique task')
  const first=await write(c,payload)
  assert.deepEqual(await write(c,payload),first)
  await assert.rejects(write(c,task('Unique task',{instructions:'Different content'})),/operation_reused/)
  for(let i=0;i<7;i++) await write(c,task('Bounded task '+i))
  await assert.rejects(write(c,task('Ninth write')),/write_budget_exhausted/)
  assert.equal((await receipts(c)).length,8)
  assert.equal((await pg.query("select * from bob.tasks where name='Unique task'")).rows.length,1)
  await fail(c)
})

test('receipt failure rolls domain mutation back in the same transaction', async () => {
  const c=await claim()
  await pg.exec(`create function bob_private.fixture_receipt_failure() returns trigger language plpgsql as $$ begin
    if new.receipt->>'label'='Rollback fixture' then raise exception 'receipt_fixture_failure'; end if; return new; end $$;
    create trigger fixture_receipt_failure before insert on bob_private.bob_write_receipts for each row execute function bob_private.fixture_receipt_failure();`)
  await assert.rejects(write(c,task('Rollback fixture')),/receipt_fixture_failure/)
  assert.equal((await pg.query("select * from bob.tasks where name='Rollback fixture'")).rows.length,0)
  assert.equal((await receipts(c)).length,0)
  await pg.exec('drop trigger fixture_receipt_failure on bob_private.bob_write_receipts; drop function bob_private.fixture_receipt_failure()')
  await fail(c)
})

test('settlement fences delayed writes and stale commits; receipt-only completion starts fresh provider context', async () => {
  const c=await claim()
  await write(c,task('Interrupted response'))
  const settled=(await as(one,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',[c.project,c.thread,c.turn,c.generation])).rows[0].result
  assert.equal(settled.receipts.length,1); assert.equal(settled.generation,c.generation+1)
  await assert.rejects(write(c,task('Delayed write')),/turn_not_claimed/)
  const args=[c.project,c.user,c.thread,c.turn,c.generation,'Recovered answer',JSON.stringify({kind:'ai_assessment',sources:[],partial:true}),null]
  await assert.rejects(as(null,'select bob.bob_commit_turn_v2($1,$2,$3,$4,$5,$6,$7,$8)',args,'service_role'),/turn_not_claimed/)
  args[4]=settled.generation
  await as(null,'select bob.bob_commit_turn_v2($1,$2,$3,$4,$5,$6,$7,$8)',args,'service_role')
  const turn=newId()
  const next=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',['A',one,turn,message],'service_role')).rows[0].result
  assert.equal(next.previous_response_id,null)
  await fail({project:'A',user:one,thread:next.thread_id,turn,generation:next.generation})
})

test('failed-turn retry recovers saved receipts and older generation cannot unlock it; audit survives transcript deletion', async () => {
  const c=await claim()
  const saved=await write(c,task('Retry-safe saved task'))
  await fail(c)
  const retry=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',[c.project,c.user,c.turn,message],'service_role')).rows[0].result
  const d={...c,generation:retry.generation}
  await fail(c)
  assert.equal((await receipts(d))[0].recordId,saved.recordId)
  await assert.rejects(write(c,task('Old-worker edit')),/turn_not_claimed/)
  await fail(d)
  const thread=(await pg.query('select next_seq from bob.bob_threads where id=$1',[c.thread])).rows[0] as any
  await as(one,'select bob.bob_reset_conversation($1,$2,$3)',['A',c.thread,thread.next_seq])
  await assert.rejects(write(d,task('After reset')),/project_denied/)
  assert.equal((await pg.query('select * from bob.tasks where id=$1',[saved.recordId])).rows.length,1)
  assert.equal((await pg.query('select * from bob_private.bob_write_receipts where turn_id=$1',[c.turn])).rows.length,1)
})

test('lookup extension preserves task instructions, measurement provenance, boundaries and byte limit', async () => {
  const rows=(await as(one,"select bob.search_bob_project_data('A','measurements') result")).rows[0].result
  assert(rows.records.some((r:any)=>r.subject==='Chosen bed width'&&r.revision===2&&r.truth==='measured'))
  assert(!JSON.stringify(rows).includes('recorded_by')); assert(!JSON.stringify(rows).includes('owner_user_id'))
  const tasks=(await as(one,"select bob.search_bob_project_data('A','tasks',null,null,null,'taskA') result")).rows[0].result
  assert.equal(tasks.records[0].instructions,'Mät, kontrollera och dokumentera.')
  await assert.rejects(as(two,"select bob.search_bob_project_data('A','measurements')"),/project_denied/)
  assert.equal((await as(both,"select bob.search_bob_project_data('A','tasks',null,null,null,'taskB') result")).rows[0].result.records.length,0)
  const empty=(await as(one,"select bob.search_bob_project_data('A','measurements',$1) result",["'; delete from bob.projects; --"])).rows[0].result
  assert.equal(empty.records.length,0)
  assert(Buffer.byteLength(JSON.stringify(rows))<=14000)
})

test('measurement revision preserves an existing source image attachment', async () => {
  const c=await claim()
  const image=newId(), fact=newId()
  await pg.query("insert into bob.media_assets(id,project_id,original_name,title,purpose,content_type,byte_size,width,height,created_by,state) values($1,'A','fixture.png','Tape reading','reference','image/png',70,1,1,$2,'ready')",[image,one])
  await as(one,"select bob.evidence_command('A','measurement','create',$1,0,$2)",[fact,JSON.stringify({...measurement('Image-backed length').data,source_media_id:image})])
  await write(c,{...measurement('Image-backed length',{value:'71'}),record_id:fact,expected_revision:1})
  const row=(await as(one,'select source_media_id,revision from bob.current_measurements where id=$1',[fact])).rows[0]
  assert.equal(row.source_media_id,image); assert.equal(row.revision,2)
  await fail(c)
})


async function expertWrite(c:Claim,payload:unknown){return (await as(c.user,'select bob.bob_project_write_v9($1,$2,$3,$4,$5) result',[c.project,c.thread,c.turn,c.generation,JSON.stringify(payload)])).rows[0].result}
test('expert tools archive with history, assign only project people, and preserve idempotent receipts',async()=>{
 const c=await claim();const m=await write(c,measurement('Retired CAD test measurement'))
 const archived=await expertWrite(c,{kind:'measurement_state',record_id:m.recordId,expected_updated_at:null,expected_revision:1,request_quote:'Spara',data:{action:'archive'}})
 assert.equal(archived.record.archived,true);assert.equal(archived.record.revision,2)
 const t:any=(await pg.query("select * from bob.tasks where id='taskA'")).rows[0]
 const payload={kind:'task_work',record_id:'taskA',expected_updated_at:t.updated_at,expected_revision:null,request_quote:'Spara',data:{status:'doing',person_ids:['oneA']}}
 const saved=await expertWrite(c,payload);assert.deepEqual(saved.record.person_ids,['oneA']);assert.equal(saved.record.status,'doing');assert.deepEqual(await expertWrite(c,payload),saved)
 await fail(c)
 const next=await claim();await assert.rejects(expertWrite(next,{...payload,expected_updated_at:saved.record.updated_at,data:{status:'done',person_ids:['twoB']}}),/project_denied/)
 await assert.rejects(expertWrite(next,payload),/record_changed/);await fail(next)
})
test('CAD stores an exact Artifact revision; duplicate retries reuse it and cross-project sources fail',async()=>{
 const c=await claim()
 const sol=await expertWrite(c,{kind:'solution',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:'Spara',data:{title:'CAD design',description:'Generic assembly',assumptions:'Concept',tradeoffs:'Simple',measurements:[],area_id:null}})
 const targetBefore:any=(await pg.query("select current_revision from bob.project_targets where project_id='A'")).rows[0]
 const target=await expertWrite(c,{kind:'target',record_id:sol.recordId,expected_updated_at:null,expected_revision:targetBefore?.current_revision??0,request_quote:'Spara',data:{solution_revision:sol.revision,reason:'Delegated design'}})
 const recipe={contract_version:1,units:'mm',assembly_id:'shelf',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:800,y_mm:400,z_mm:18}],instances:[{id:'top',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
 const data={title:'Shelf',description:'Generic CAD',assumptions:'Concept only',target_revision:target.revision,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,packet:{recipe,manifest:{engine:{name:'build123d'},assembly_id:'shelf'},files:{front:'Zml4dHVyZQ=='}}}
 const payload={kind:'cad',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:'Spara',data}
 const drawing=await expertWrite(c,payload);assert.equal(drawing.dataset,'artifacts');assert.equal(drawing.revision,1);assert.deepEqual(await expertWrite(c,payload),drawing)
 const read:any=(await as(one,'select bob.read_cad_artifact($1,$2,null) value',['A',drawing.recordId])).rows[0].value
 assert.deepEqual(read.recipe,recipe)
 await assert.rejects(as(two,'select bob.read_cad_artifact($1,$2,null)',['A',drawing.recordId]),/project_denied/)
 await assert.rejects(expertWrite(c,{...payload,data:{...data,title:'Bad source',source_artifact_id:newId(),source_revision:1}}),/source_changed/)
 await assert.rejects(expertWrite(c,{...payload,data:{...data,title:'Bad step',step_id:newId()}}),/step_changed/)
 await fail(c)
})

test('generated image reserves an honest pending record, checks stored bytes, and recovers without duplication',async()=>{
 const c=await claim();const id=newId()
 const command=async(payload:any)=>(await as(one,'select bob.bob_project_write_v10($1,$2,$3,$4,$5) result',[c.project,c.thread,c.turn,c.generation,JSON.stringify(payload)])).rows[0].result
 const base={record_id:id,expected_updated_at:null,expected_revision:null,request_quote:'Spara'}
 const pending=await command({...base,kind:'image_reserve',data:{title:'Assembly guide',purpose:'instruction',byte_size:24,width:1,height:1,target_kind:'task',target_id:'taskA'}})
 assert.equal(pending.record.state,'pending');assert.equal(pending.record.source_kind,'ai_generated')
 await assert.rejects(command({...base,kind:'image_finalize',data:{}}),/Upload incomplete/)
 await pg.query("insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,$2)",['A/'+id,JSON.stringify({size:24,mimetype:'image/png'})])
 const ready=await command({...base,kind:'image_finalize',data:{}});assert.equal(ready.record.state,'ready');assert.deepEqual(await command({...base,kind:'image_finalize',data:{}}),ready)
 await assert.rejects(command({...base,kind:'image_link',data:{target_kind:'task',target_id:'taskB'}}),/project_denied/)
 assert.equal((await pg.query('select count(*)::int n from bob.media_assets where id=$1',[id])).rows[0].n,1)
 await fail(c)
})

test('shared guest has no writable claimed thread; revoked membership denies receipt access and mutations', async () => {
  const guestClaim=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',['A',guest,newId(),message],'service_role')).rows[0].result
  assert.equal(guestClaim.mode,'local_only')
  const c=await claim()
  await pg.exec("delete from bob.people where id='oneA'")
  await assert.rejects(write(c,task('Revoked write')),/project_denied/)
  await assert.rejects(receipts(c),/project_denied/)
  await fail(c)
})
