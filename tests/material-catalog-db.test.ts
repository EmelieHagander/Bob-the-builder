import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createMaterialCatalogReader } from '../supabase/functions/_shared/material-catalog.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { checkedToolSnapshot } from '../supabase/functions/_shared/project-tools/session.ts'
import { isBobAnswerEvidence } from '../src/data/bobEvidence.ts'

const pg=new PGlite(), one='00000000-0000-4000-8000-000000000001', two='00000000-0000-4000-8000-000000000002', both='00000000-0000-4000-8000-000000000003', guest='00000000-0000-4000-8000-000000000004'
const request='Spara material och del enligt mitt designval, och rätta samma definition när det behövs.'
let sequence=0
const id=()=>`30000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`
async function as(uid:string|null,sql:string,params:unknown[]=[],role='authenticated'):Promise<any>{
 return pg.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid})]);await tx.exec('set local role '+role);return tx.query(sql,params)})
}
type Claim={user:string,project:string,turn:string,thread:string,generation:number}
async function claim(user=one,project='A'):Promise<Claim>{
 const turn=id(),r=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',[project,user,turn,request],'service_role')).rows[0].result
 assert.equal(r.status,'claimed');return {user,project,turn,thread:r.thread_id,generation:r.generation}
}
async function fail(c:Claim){await as(null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',[c.project,c.user,c.thread,c.turn,c.generation],'service_role')}
const val=(value:string|null,unit:string|null='mm',truth='provided_spec',parameter:string|null=null,note='')=>({value,unit,truth,parameter,note})
const definition=(key:string,changes:Record<string,unknown>={})=>({action:'ensure',key,kind:'material',name:'Plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:val('18')},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:'mitt designval',source_seq:null,...changes})
const payload=(d:Record<string,unknown>,record_id:string|null=null,expected_revision=0)=>({kind:'catalog',record_id,expected_revision,expected_updated_at:null,request_quote:'Spara',data:d})
async function write(c:Claim,p:unknown){return (await as(c.user,'select bob.bob_project_write_v7($1,$2,$3,$4,$5) result',[c.project,c.thread,c.turn,c.generation,JSON.stringify(p)])).rows[0].result}
const input=(changes:Record<string,unknown>={})=>({action:'search',kind:null,query:null,after:null,id:null,revision:null,profile_code:null,categories:[],properties:{},...changes})
async function read(changes:Record<string,unknown>={},project='A',user=one){return (await as(user,'select bob.catalog_read($1,$2) result',[project,JSON.stringify(input(changes))])).rows[0].result}

before(async()=>{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role authenticator;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.email() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email'$$;
 grant usage on schema auth to anon,authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.buckets enable row level security;alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant all on storage.objects,storage.buckets to anon,authenticated;`)
 for(const uid of [one,two,both,guest])await pg.query('insert into auth.users values($1,$2,now())',[uid,uid===guest?'guest@bob.local':uid+'@example.test'])
 const legacy=new URL('../db/migrations/',import.meta.url)
 for(const f of (await readdir(legacy)).filter(f=>f.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(f,legacy),'utf8'))
 await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Catalog A'),('B','b','Catalog B')")
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','O',$1),('twoB','B','Two','T',$2)",[one,two])
 await setupSharedSocial(pg)
 // The catalog is now a normal CLI-authored migration in the complete chain.
 const dir=new URL('../supabase/migrations/',import.meta.url)
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(f,dir),'utf8'))
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','B',$1),('bothB','B','Both','B',$1),('guestA','A','Guest','G',$2)",[both,guest])
})
after(()=>pg.close())

test('actual migrated profiles, categories and units can be discovered/read without a selected target',async()=>{
 const profiles=await read({action:'profiles'});assert.equal(profiles.status,'ok');assert(profiles.items.some((r:any)=>r.code==='panel'))
 const profile=await read({action:'profile',id:'tube',revision:1});assert.equal(profile.record.form,'tube')
 assert(profile.record.fields.some((r:any)=>r.property_key==='outside_diameter'));assert.equal(profile.record.rules[0].operator,'lt')
 const pvc=await read({action:'categories',query:'polyvinylklorid'});assert.equal(pvc.items[0].code,'plastic.pvc')
 assert.equal((await read({action:'profile',id:'missing',revision:1})).status,'not_found')
})

test('ensure normalizes 18 mm and 1.8 cm to one identity despite different titles; exact retries preserve one receipt',async()=>{
 const c=await claim();try{
  const p=payload(definition('first'))
  const a=await write(c,p);assert.equal(a.operation,'created');assert.equal(a.record.properties.thickness.value,'18')
  assert.deepEqual(await write(c,p),a)
  const b=await write(c,payload(definition('equivalent',{name:'Annat namn',properties:{thickness:val('1.800','cm')}})))
  assert.equal(b.operation,'reused');assert.equal(b.recordId,a.recordId);assert.equal(b.record.name,'Plywood')
  assert.equal((await pg.query('select count(*) n from bob.catalog_item_revisions where item_id=$1',[a.recordId])).rows[0].n,1)
 }finally{await fail(c)}
})

test('unknown specifications are neither zero nor automatically equivalent; source claims stay private',async()=>{
 const c=await claim();try{
  const d=definition('unknown1',{properties:{thickness:val(null,'mm','unknown',null,'Not measured')}})
  const a=await write(c,payload(d)),b=await write(c,payload({...d,key:'unknown2'}))
  assert.notEqual(a.recordId,b.recordId);assert(a.record.has_unknown);assert.equal(a.record.properties.thickness.value,null)
  assert.doesNotMatch(JSON.stringify(await read({action:'read',id:a.recordId})),/source_thread|source_quote|recorded_by/)
  await assert.rejects(as(one,'select * from bob_private.catalog_item_provenance'),/permission denied/)
  await assert.rejects(write(c,payload(definition('invented',{source_quote:'Not in any user message'}))),/source_quote_required/)
 }finally{await fail(c)}
})

test('revision uses CAS and preserves earlier dimensions',async()=>{
 const c=await claim();let first:any
 try{first=await write(c,payload(definition('history',{notes:'history fixture'})))}finally{await fail(c)}
 const d=await claim();try{
  const p=payload(definition('revise',{action:'revise',notes:'history fixture',properties:{thickness:val('21')}}),first.recordId,1)
  const changed=await write(d,p);assert.equal(changed.revision,2)
  assert.equal((await read({action:'read',id:first.recordId,revision:1})).record.properties.thickness.value,'18')
  assert.equal((await read({action:'read',id:first.recordId})).record.properties.thickness.value,'21')
  await assert.rejects(write(d,{...p,data:{...p.data,key:'stale'}}),/record_changed/)
 }finally{await fail(d)}
})

test('part definition pins its material revision, inherits known specifications and exposes independent parameters',async()=>{
 const c=await claim();try{
  const material=await write(c,payload(definition('part-material',{notes:'part fixture'})))
  const d=definition('panel',{kind:'part',name:'Paneldel',profile_code:'panel',material_id:material.recordId,material_revision:1,
    properties:{thickness:val('18'),length:val(null,'mm','provided_spec','length'),width:val(null,'mm','provided_spec','width')}})
  const part=await write(c,payload(d));assert.deepEqual(part.record.parameter_keys,['length','width']);assert.equal(part.record.geometry_status,'definition_only')
  const again=await write(c,payload({...d,key:'panel-again',name:'Hyllplan'}));assert.equal(again.recordId,part.recordId);assert.equal(again.operation,'reused')
  await assert.rejects(write(c,payload({...d,key:'wrong-thickness',properties:{...(d.properties as any),thickness:val('21')}})),/material_property_mismatch/)
  await write(c,payload(definition('new-thickness',{action:'revise',notes:'part fixture',properties:{thickness:val('24')}}),material.recordId,1))
  const oldPart=(await read({action:'read',id:part.recordId})).record
  assert.equal(oldPart.material_revision,1);assert(oldPart.material_changed)
 }finally{await fail(c)}
})

test('PVC sheet and tube share a material category but use different dynamic properties',async()=>{
 const c=await claim();try{
  const sheet=await write(c,payload(definition('pvc-sheet',{name:'PVC-skiva',categories:['plastic.pvc','sheet'],properties:{thickness:val('5')}})))
  const tube=await write(c,payload(definition('pvc-tube',{name:'PVC-rör',categories:['plastic.pvc','tube'],profile_code:'tube_stock',properties:{outside_diameter:val('32'),wall_thickness:val('2')}})))
  const result=await read({categories:['plastic']});assert(result.items.some((i:any)=>i.id===sheet.recordId));assert(result.items.some((i:any)=>i.id===tube.recordId))
  const filtered=await read({categories:['plastic.pvc'],profile_code:'tube_stock',revision:1,properties:{outside_diameter:val('3.2','cm')}})
  assert.deepEqual(filtered.items.map((i:any)=>i.id),[tube.recordId])
  await assert.rejects(write(c,payload(definition('bad-tube',{categories:['plastic.pvc','tube'],profile_code:'tube_stock',properties:{outside_diameter:val('32'),wall_thickness:val('16')}}))),/catalog_rule_failed:hollow/)
 }finally{await fail(c)}
})

test('new operator-published profiles work without new API code and all length storage remains mm',async()=>{
 await pg.exec(`insert into bob.catalog_property_definitions values('test_span','Test span','quantity','mm','Fixture');
 insert into bob.catalog_profiles values('custom_fixture','Custom fixture');
 insert into bob.catalog_profile_revisions(profile_code,revision,form_code) values('custom_fixture',1,'rectangular_profile');
 insert into bob.catalog_profile_fields values('custom_fixture',1,'test_span',true,0.000001,10000,0);
 update bob.catalog_profile_revisions set published=true where profile_code='custom_fixture';`)
 const c=await claim();try{
  const saved=await write(c,payload(definition('custom',{profile_code:'custom_fixture',categories:['wood.softwood','rectangular_profile'],properties:{test_span:val('12','cm')}})))
  assert.equal(saved.record.properties.test_span.value,'120');assert.equal(saved.record.properties.test_span.unit,'mm')
 }finally{await fail(c)}
 await assert.rejects(pg.exec("update bob.catalog_profile_fields set required=false where profile_code='custom_fixture'"),/requires_new_revision/)
 await assert.rejects(pg.exec("update bob.catalog_property_definitions set canonical_unit='mm' where key='test_span'"),/requires_new_identity/)
})

test('server independently rejects unsupported keys, wrong units, hidden authority and false measurements',async()=>{
 const c=await claim();try{
  for(const props of [{thickness:val('18','kg')},{thickness:val('NaN')},{thickness:val('-1')},{thickness:val('0.0000001')},{thickness:val('18','mm','measured')},{not_a_field:val('18')},{thickness:{value:'18'}},{}])
   await assert.rejects(write(c,payload(definition('invalid',{properties:props}))),/catalog_/)
  await assert.rejects(write(c,payload(definition('bad-source',{source_kind:'seed'}))),/source_required/)
  await assert.rejects(write(c,{...payload(definition('scope')),project_id:'B'}),/invalid_write/)
  await assert.rejects(write(c,{...payload(definition('unrequested')),request_quote:'unrequested action'}),/request_quote_required/)
 }finally{await fail(c)}
})

test('normal clients cannot write raw definitions, change dictionaries or publish globally',async()=>{
 await assert.rejects(as(one,"insert into bob.catalog_items(kind,current_revision) values('material',1)"),/permission denied/)
 await assert.rejects(as(one,"insert into bob.catalog_profiles values('bad','bad')"),/permission denied/)
 await assert.rejects(as(one,"select bob_private.catalog_save('A',null,0,'{}','{}')"),/permission denied/)
 await assert.rejects(as(null,"select * from bob.catalog_items",[],'anon'),/permission denied/)
 await assert.rejects(as(null,"select bob.catalog_read('A','{}')",[],'anon'),/permission denied/)
})

test('explicit project scope prevents foreign read/part links even for a dual-project member; revocation works',async()=>{
 const b=await claim(two,'B');let foreign:any
 try{foreign=await write(b,payload(definition('foreign',{notes:'private B'})))}finally{await fail(b)}
 assert.equal((await read({action:'read',id:foreign.recordId},'A',both)).status,'not_found')
 assert.equal((await read({query:'Plywood'},'A',both)).items.some((i:any)=>i.id===foreign.recordId),false)
 await assert.rejects(read({},'A',two),/project_denied/)
 const c=await claim(both);try{
  await assert.rejects(write(c,payload(definition('foreign-part',{kind:'part',material_id:foreign.recordId,material_revision:1}))),/project_denied/)
 }finally{await fail(c)}
 await pg.exec("delete from bob.people where id='bothA'")
 await assert.rejects(read({},'A',both),/project_denied/)
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','B',$1)",[both])
})

test('two actors converge on one complete scoped definition; PGlite queues transactions, hosted parallel proof is separate',async()=>{
 const a=await claim(one),b=await claim(both)
 try{
  const p=payload(definition('converge',{notes:'Concurrent fixture',properties:{thickness:val('17')}}))
  const [ra,rb]=await Promise.all([write(a,p),write(b,p)])
  assert.equal(ra.recordId,rb.recordId);assert.deepEqual([ra.operation,rb.operation].sort(),['created','reused'])
  assert.equal((await pg.query("select count(*) n from bob.catalog_items where id=$1",[ra.recordId])).rows[0].n,1)
 }finally{await fail(a);await fail(b)}
})

test('paged manifests and literal filters preserve exact read access; errors are not absence',async()=>{
 for(let batch=0;batch<2;batch++){
  const c=await claim();try{for(let n=0;n<7;n++)await write(c,payload(definition('page'+n,{name:'Paged fixture '+(batch*7+n),notes:'page'+(batch*7+n)})))}finally{await fail(c)}
 }
 const first=await read({query:'Paged fixture'});assert.equal(first.items.length,12);assert(first.truncated)
 const next=await read({query:'Paged fixture',after:first.next_cursor});assert.equal(next.items.length,2);assert.equal(next.next_cursor,null)
 assert.equal((await read({query:'%does-not-expand%'})).status,'empty')
 await assert.rejects(read({profile_code:'absent',revision:1,properties:{thickness:val('18')}}),/catalog_invalid_profile/)
})

test('receipt failure rolls definition back and settlement fences delayed writes',async()=>{
 const c=await claim();try{
  await pg.exec(`create function bob_private.catalog_fixture_failure() returns trigger language plpgsql as $$begin if new.receipt->>'label'='Rollback fixture' then raise exception 'fixture_rollback';end if;return new;end$$;
   create trigger catalog_fixture_failure before insert on bob_private.bob_write_receipts for each row execute function bob_private.catalog_fixture_failure();`)
  try {
   await assert.rejects(write(c,payload(definition('rollback',{name:'Rollback fixture',notes:'rollback unique'}))),/fixture_rollback/)
   assert.equal((await read({query:'Rollback fixture'})).status,'empty')
  } finally { await pg.exec('drop trigger catalog_fixture_failure on bob_private.bob_write_receipts;drop function bob_private.catalog_fixture_failure()') }
  const settled=(await as(c.user,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',[c.project,c.thread,c.turn,c.generation])).rows[0].result
  await assert.rejects(write(c,payload(definition('late'))),/turn_not_claimed/)
  c.generation=settled.generation
 }finally{await fail(c)}
})

test('actual chat discovers catalog tools, reads profiles, saves material/part and persists exact receipts through settlement',async()=>{
 const c=await claim();let rounds=0,materialId='',partId='',committed=false
 const sqlResult=async(sql:string,args:unknown[])=>{try{return {data:(await as(one,sql,args)).rows[0].result,error:null}}catch(e:any){return {data:null,error:{code:e.code,message:e.message}}}}
 const binding=[c.project,c.thread,c.turn,c.generation]
 const writer=createProjectWriter('A',request,p=>sqlResult('select bob.bob_project_write_v7($1,$2,$3,$4,$5) result',[...binding,JSON.stringify(p)]),
   ()=>sqlResult('select bob.bob_read_write_receipts($1,$2,$3,$4) result',binding),()=>sqlResult('select bob.bob_settle_project_writes($1,$2,$3,$4) result',binding))
 const hasAccess=async()=> (await as(one,"select id from bob.projects where id='A'")).rows.length===1
 const lookup=createProjectLookup('A',async()=>({data:{records:[{id:'A',name:'Catalog A'}],related:[],truncated:false},error:null}),1000,12)
 const catalogReader=createMaterialCatalogReader('A',i=>sqlResult('select bob.catalog_read($1,$2) result',['A',JSON.stringify(i)]),hasAccess,lookup.sources)
 const readToolPolicy=async()=>checkedToolSnapshot({phase:'build',tools:(await as(one,'select * from bob.tool_catalog order by name')).rows})
 const call=(name:string,args:unknown)=>({id:'call_'+id(),type:'function' as const,function:{name,arguments:JSON.stringify(args)}})
 const usage={input_tokens:1,output_tokens:1,total_tokens:2}
 const result=await runClaimedProjectTurn({projectId:'A',userId:one,message:request,generation:c.generation,writer,lookup,catalogReader,hasAccess,readToolPolicy,
   fail:async g=>{await fail({...c,generation:g})},
   commit:async(answer,g)=>{await as(null,'select bob.bob_commit_turn_v2($1,$2,$3,$4,$5,$6,$7,$8) result',[c.project,c.user,c.thread,c.turn,g,answer.answer,JSON.stringify(answer.evidence),answer.providerResponseId],'service_role');committed=true},
   callModel:async options=>{
    rounds++;let calls:any[]=[]
    const previous=options.messages?.filter(m=>m.role==='tool').map(m=>JSON.parse(String(m.content)))??[]
    if(rounds===1){
      for(const name of ['search_material_catalog','read_material_catalog','save_catalog_definition']) assert(options.tools?.some(t=>t.function.name===name),name+' should preload in build')
      calls=[call('read_material_catalog',{entity:'profile',id:'sheet_stock',revision:1}),call('read_material_catalog',{entity:'profile',id:'panel',revision:1}),call('search_material_catalog',{entity:'materials',query:null,categories:['wood.plywood','sheet'],profile_code:'sheet_stock',profile_revision:1,properties:{thickness:val('23')},after:null})]
    }
    else if(rounds===2){assert.equal(previous[2].status,'empty');calls=[call('save_catalog_definition',{...definition('runtime-material',{name:'Runtime material',notes:'Runtime fixture',properties:{thickness:val('23')}}),record_id:null,expected_revision:0,request_quote:'Spara'})]}
    else if(rounds===3){assert.equal(previous[0].status,'saved');materialId=previous[0].receipt.recordId;calls=[call('save_catalog_definition',{...definition('runtime-part',{kind:'part',name:'Runtime panel',profile_code:'panel',material_id:materialId,material_revision:1,properties:{thickness:val('23'),length:val(null,'mm','provided_spec','length'),width:val(null,'mm','provided_spec','width')}}),record_id:null,expected_revision:0,request_quote:'Spara'})]}
    else if(rounds===4){assert.equal(previous[0].status,'saved');partId=previous[0].receipt.recordId;calls=[call('read_material_catalog',{entity:'definition',id:partId,revision:1})]}
    else {assert.equal(previous[0].record.material_id,materialId);return {success:true,data:'Material och deldefinition sparade. Ingen ritning eller inköpslista skapad.',model:'injected-fixture',responseId:'resp_final',usage}}
    return {success:true,data:null,model:'injected-fixture',responseId:'resp_'+rounds,usage,toolCalls:calls}
   },
 })
 assert(result.ok,JSON.stringify(result));assert(committed);assert.equal(rounds,5)
 assert.equal(result.evidence.writes?.length,2);assert(isBobAnswerEvidence(result.evidence,'A'))
 assert(result.evidence.sources.some(s=>s.dataset==='catalog'&&s.recordId===partId+'@1'))
 assert.equal((await read({action:'read',id:partId,revision:1})).record.material_id,materialId)
 const transcript=(await pg.query("select evidence from bob.bob_messages where thread_id=$1 and turn_id=$2 and role='assistant'",[c.thread,c.turn])).rows[0] as any
 assert.deepEqual(transcript.evidence,result.evidence)
 assert.doesNotMatch(JSON.stringify(result),/source_quote|source_thread|identity_hash/)
})

test('the read-only tool session can load catalog reads but cannot load definition writes without a claimed writer',async()=>{
 const lookup=createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null}),1000,12)
 const catalogReader=createMaterialCatalogReader('A',async()=>({data:{status:'empty',projectId:'A',items:[],truncated:false,next_cursor:null},error:null}),async()=>true,lookup.sources)
 const session=createBobToolSession({lookup,catalogReader,readPolicy:async()=>checkedToolSnapshot({phase:'build',tools:(await as(one,'select * from bob.tool_catalog order by name')).rows})})
 await session.prepare()
 assert.equal((await session.execute('load_tool',{name:'save_catalog_definition'})).status,'not_allowed')
 assert.equal((await session.execute('load_tool',{name:'search_material_catalog'})).status,'loaded')
 await session.prepare()
 const result=await session.execute('search_material_catalog',{entity:'materials',query:null,categories:[],profile_code:null,profile_revision:null,properties:{},after:null})
 assert.equal(result.status,'empty')
})


test('material catalog search, read and save preload together in active planning phases',async()=>{
 const rows=(await as(one,`select name,preload_phases from bob.tool_catalog
   where name in ('search_material_catalog','read_material_catalog','save_catalog_definition')
   order by name`)).rows as Array<{name:string,preload_phases:string[]}>
 assert.equal(rows.length,3)
 for(const row of rows) assert.deepEqual(row.preload_phases,['concept','design','planning','build'],row.name)
})
