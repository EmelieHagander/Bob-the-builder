import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { setupSharedSocial } from './support/shared-social.ts'

const pg=new PGlite()
const one='00000000-0000-4000-8000-000000000001'
const two='00000000-0000-4000-8000-000000000002'
const both='00000000-0000-4000-8000-000000000003'
const id=(n:number)=>'91000000-0000-4000-8000-'+String(n).padStart(12,'0')
const json=(v:unknown)=>JSON.stringify(v)
async function as(uid:string|null,sql:string,params:unknown[]=[],role='authenticated'):Promise<any>{
 return pg.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid})]);await tx.exec('set local role '+role);return tx.query(sql,params)})
}
type Claim={p:[string,string,string,number]}
let turn=100
async function claim(message='Spara materialet och delarna och bygg ramen.'):Promise<Claim>{
 const tid=id(turn++)
 const r=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',['A',one,tid,message],'service_role')).rows[0].result
 assert.equal(r.status,'claimed');return {p:['A',r.thread_id,tid,r.generation]}
}
async function finish(c:Claim){await as(null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',['A',one,c.p[1],c.p[2],c.p[3]],'service_role')}
const value=(v:string|null,truth='provided_spec',parameter:string|null=null,note='')=>({value:v,unit:'mm',truth,parameter,note})
const catalog=(key:string,kind:'material'|'part',profile:string,categories:string[],properties:Record<string,unknown>,material_id:string|null=null,material_revision:number|null=null)=>({
 action:'ensure',key,kind,name:key,aliases:[],profile_code:profile,profile_revision:1,categories,properties,material_id,material_revision,
 notes:'assembly fixture',source_kind:'design_choice',source_quote:'bygg ramen',source_seq:null,
})
async function write(c:Claim,payload:unknown,uid=one){return (await as(uid,'select bob.bob_project_write_v8($1,$2,$3,$4,$5) result',[...c.p,json(payload)])).rows[0].result}
const catalogPayload=(data:Record<string,unknown>)=>({kind:'catalog',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:'Spara',data})
const assemblyPayload=(data:Record<string,unknown>,record_id:string|null=null,expected_revision=0)=>({kind:'assembly',record_id,expected_updated_at:null,expected_revision,request_quote:'bygg ramen',data})
const assemblyData=(post:string,postRev:number,rail:string,railRev:number,extra:Record<string,unknown>={})=>({
 title:'Generic frame',description:'Two posts and two rails',assumptions:'Concept dimensions; fixing and load checks unresolved.',target_revision:1,measurements:[],
 recipe:{version:1,definitions:[
   {key:'P-POST',part_id:post,part_revision:postRev,shape:{kind:'box',length_mm:1600,width_mm:70,thickness_mm:45}},
   {key:'P-RAIL',part_id:rail,part_revision:railRev,shape:{kind:'box',length_mm:910,width_mm:70,thickness_mm:45}},
 ],instances:[
   {key:'I-L',definition_key:'P-POST',position_mm:[0,0,800],rotation_deg:[0,0,0]},
   {key:'I-R',definition_key:'P-POST',position_mm:[1000,0,800],rotation_deg:[0,0,0]},
   {key:'I-B',definition_key:'P-RAIL',position_mm:[500,0,100],rotation_deg:[0,90,0]},
   {key:'I-T',definition_key:'P-RAIL',position_mm:[500,0,1500],rotation_deg:[0,90,0]},
 ],views:['front','right','top']},area_id:'areaA',...extra,
})
async function seedParts(c:Claim){
 const material=await write(c,catalogPayload(catalog('softwood_45x70','material','rectangular_profile',['wood.softwood','rectangular_profile'],{width:value('70'),thickness:value('45')})))
 const post=await write(c,catalogPayload(catalog('post_1600','part','rectangular_part',['wood.softwood','rectangular_profile'],{length:value('1600'),width:value('70'),thickness:value('45')},material.recordId,1)))
 const rail=await write(c,catalogPayload(catalog('rail_910','part','rectangular_part',['wood.softwood','rectangular_profile'],{length:value('910'),width:value('70'),thickness:value('45')},material.recordId,1)))
 return {material,post,rail}
}

before(async()=>{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role authenticator;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.email() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email'$$;
 grant usage on schema auth to anon,authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.buckets enable row level security;alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant all on storage.objects,storage.buckets to anon,authenticated;`)
 for(const [n,u] of [one,two,both].entries())await pg.query('insert into auth.users values($1,$2,now())',[u,`assembly${n}@example.test`])
 const legacy=new URL('../db/migrations/',import.meta.url);for(const f of (await readdir(legacy)).filter(f=>f.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(f,legacy),'utf8'))
 await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Assembly A'),('B','b','Assembly B')")
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','One','OA',$1),('twoB','B','Two','TB',$2)",[one,two])
 await setupSharedSocial(pg)
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(f,dir),'utf8'))
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('bothA','A','Both','BA',$1),('bothB','B','Both','BB',$1)",[both])
 await pg.exec("insert into bob.areas(id,project_id,slug,name) values('areaA','A','frame','Frame'),('areaB','B','private','Private')")
 await as(one,'select bob.solution_command($1,$2,$3,$4,$5)',['A','create',id(2),0,json({title:'Frame solution',description:'Generic frame',assumptions:'Concept',tradeoffs:'None',area_id:'areaA'})])
 await as(one,'select bob.solution_command($1,$2,$3,$4,$5)',['A','select',id(2),0,json({solution_revision:1,reason:'Use frame solution',area_id:'areaA'})])
})
after(()=>pg.close())

test('v8 creates catalog-backed generic assembly with exact part list and no object generator',async t=>{
 const c=await claim();t.after(()=>finish(c));const {post,rail}=await seedParts(c)
 const receipt=await write(c,assemblyPayload(assemblyData(post.recordId,1,rail.recordId,1)))
 assert.equal(receipt.dataset,'artifacts');assert.equal(receipt.revision,1);assert.equal(receipt.record.status,'concept')
 const a=receipt.record.assembly
 assert.equal(a.contract_version,1);assert.equal(a.definitions.length,2);assert.equal(a.instances.length,4)
 const postLine=a.part_list.find((x:any)=>x.definition_key==='P-POST')
 assert.equal(Number(postLine.quantity),2);assert.deepEqual(postLine.instance_keys,['I-L','I-R'])
 assert.deepEqual(postLine.shape,{kind:'box',length_mm:1600,width_mm:70,thickness_mm:45})
 assert.equal(a.part_sources_changed,false)
 assert.equal((await as(one,'select count(*)::int n from bob.artifact_assemblies')).rows[0].n,1)
})

test('placement revision preserves exact parts and historical geometry',async t=>{
 const c=await claim();t.after(()=>finish(c));const current=(await as(one,"select id,revision,assembly from (select a.id,a.revision,to_jsonb(d) assembly from bob.current_artifacts a join bob.artifact_assembly_details d on d.artifact_id=a.id and d.artifact_revision=a.revision) q limit 1")).rows[0]
 const defs=current.assembly.definitions
 const data={title:'Generic frame',description:'Move top rail only',assumptions:'Concept',target_revision:1,measurements:[],
  recipe:{version:1,definitions:defs,instances:current.assembly.instances.map((i:any)=>i.key==='I-T'?{...i,position_mm:[500,100,1500]}:i),views:['front','right','top']},
  change_note:'Move top rail'}
 const r=await write(c,assemblyPayload(data,current.id,current.revision))
 assert.equal(r.revision,current.revision+1)
 assert.deepEqual(r.record.assembly.definitions,defs)
 const old=(await as(one,'select * from bob.artifact_assembly_details where artifact_id=$1 and artifact_revision=$2',[current.id,current.revision])).rows[0]
 assert.equal(old.instances.find((i:any)=>i.key==='I-T').position_mm[1],0)
 assert.equal(r.record.assembly.instances.find((i:any)=>i.key==='I-T').position_mm[1],100)
})

test('known catalog dimensions cannot be contradicted and unknown critical geometry is rejected',async t=>{
 const c=await claim();t.after(()=>finish(c));const seeded=await seedParts(c)
 const bad=assemblyData(seeded.post.recordId,1,seeded.rail.recordId,1) as any;bad.recipe.definitions[0].shape.width_mm=71
 await assert.rejects(write(c,assemblyPayload(bad)),/assembly_part_geometry_mismatch/)
 const unknown=await write(c,catalogPayload(catalog('unknown_length_part','part','rectangular_part',['wood.softwood','rectangular_profile'],
  {length:value(null,'unknown',null,'Length unresolved'),width:value('70'),thickness:value('45')},seeded.material.recordId,1)))
 const unresolved=assemblyData(unknown.recordId,1,seeded.rail.recordId,1)
 await assert.rejects(write(c,assemblyPayload(unresolved)),/assembly_part_geometry_mismatch/)
})

test('parameterised part may bind length in assembly while stored part stays unchanged',async t=>{
 const c=await claim();t.after(()=>finish(c));const seeded=await seedParts(c)
 const param=await write(c,catalogPayload(catalog('parameter_length_part','part','rectangular_part',['wood.softwood','rectangular_profile'],
  {length:value(null,'provided_spec','span'),width:value('70'),thickness:value('45')},seeded.material.recordId,1)))
 const data=assemblyData(param.recordId,1,seeded.rail.recordId,1) as any;data.recipe.definitions[0].shape.length_mm=1750
 const r=await write(c,assemblyPayload(data));assert.equal(r.record.assembly.definitions[0].shape.length_mm,1750)
 const part=(await as(one,'select properties from bob.catalog_item_revisions where item_id=$1 and revision=1',[param.recordId])).rows[0]
 assert.equal(part.properties.length.value,null);assert.equal(part.properties.length.parameter,'span')
})

test('raw mutation, anonymous reads and cross-project IDs fail closed',async t=>{
 const c=await claim();t.after(()=>finish(c));const seeded=await seedParts(c)
 await assert.rejects(as(one,'update bob.artifact_assemblies set contract_version=1'),/permission denied/)
 await assert.rejects(as(null,'select * from bob.artifact_assembly_definitions',[],'anon'),/permission denied/)
 assert.equal((await as(two,'select * from bob.artifact_assemblies')).rows.length,0)
 const payload=assemblyPayload(assemblyData(seeded.post.recordId,1,seeded.rail.recordId,1))
 await assert.rejects(write(c,payload,both),/turn_not_claimed|project_denied/)
})

test('archive/restore carries assembly and source revisions; changed part is reported not adopted',async t=>{
 const c=await claim();t.after(()=>finish(c));const seeded=await seedParts(c)
 const created=await write(c,assemblyPayload(assemblyData(seeded.post.recordId,1,seeded.rail.recordId,1)))
 const aid=created.recordId
 await as(one,'select bob.artifact_command($1,$2,$3,$4,$5)',['A','archive',aid,1,'{}'])
 await as(one,'select bob.artifact_command($1,$2,$3,$4,$5)',['A','restore',aid,2,'{}'])
 assert.equal((await as(one,'select count(*)::int n from bob.artifact_assemblies where artifact_id=$1',[aid])).rows[0].n,3)
 const revise={...catalog('post_1600_rev','part','rectangular_part',['wood.softwood','rectangular_profile'],{length:value('1700'),width:value('70'),thickness:value('45')},seeded.material.recordId,1),action:'revise'}
 const next=await claim('Spara ändringen och bygg ramen.');t.after(()=>finish(next))
 await write(next,{kind:'catalog',record_id:seeded.post.recordId,expected_updated_at:null,expected_revision:1,request_quote:'Spara',data:{...revise,key:'post_revise',source_quote:'bygg ramen'}})
 const detail=(await as(one,'select * from bob.artifact_assembly_details where artifact_id=$1 and artifact_revision=3',[aid])).rows[0]
 assert.equal(detail.part_sources_changed,true);assert.equal(detail.definitions.find((d:any)=>d.key==='P-POST').part_revision,1)
})

test('research v8 gives list marker and exact assembly only on exact read',async t=>{
 const c=await claim();t.after(()=>finish(c));const seeded=await seedParts(c)
 const created=await write(c,assemblyPayload(assemblyData(seeded.post.recordId,1,seeded.rail.recordId,1)))
 const list=(await as(one,"select bob.search_bob_project_data_v8('A','artifacts',null,null,null,null,null) result")).rows[0].result
 const row=list.records.find((x:any)=>x.id===created.recordId);assert.equal(row.has_generic_assembly,true);assert.equal(row.assembly,null)
 const exact=(await as(one,"select bob.search_bob_project_data_v8('A','artifacts',null,null,null,$1,null) result",[created.recordId])).rows[0].result
 assert.equal(exact.records[0].assembly.instances.length,4)
 const foreign=(await as(both,"select bob.search_bob_project_data_v8('B','artifacts',null,null,null,$1,null) result",[created.recordId])).rows[0].result
 assert.equal(foreign.records.length,0)
})

test('v8 delegates catalog writes and assembly retry is idempotent',async t=>{
 const c=await claim();t.after(()=>finish(c))
 const material=await write(c,catalogPayload(catalog('delegated_material','material','rectangular_profile',['wood.softwood','rectangular_profile'],{width:value('70'),thickness:value('45')})))
 assert.equal(material.dataset,'catalog')
 const post=await write(c,catalogPayload(catalog('delegated_post','part','rectangular_part',['wood.softwood','rectangular_profile'],{length:value('1600'),width:value('70'),thickness:value('45')},material.recordId,1)))
 const rail=await write(c,catalogPayload(catalog('delegated_rail','part','rectangular_part',['wood.softwood','rectangular_profile'],{length:value('910'),width:value('70'),thickness:value('45')},material.recordId,1)))
 const payload=assemblyPayload(assemblyData(post.recordId,1,rail.recordId,1))
 const first=await write(c,payload);assert.deepEqual(await write(c,payload),first)
 const receipts=(await as(one,'select bob.bob_read_write_receipts($1,$2,$3,$4) result',c.p)).rows[0].result
 assert.equal(receipts.filter((x:any)=>x.dataset==='artifacts').length,1)
})
