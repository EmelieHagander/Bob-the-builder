import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { buildingPlanGeometry } from '../src/lib/buildingPlan.ts'
import { makePlan } from './support/multifloor-fixture.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
const pg = new PGlite()
const one = '00000000-0000-4000-8000-000000000001'
const two = '00000000-0000-4000-8000-000000000002'
const both = '00000000-0000-4000-8000-000000000003'
const guest = '00000000-0000-4000-8000-000000000004'
const id = (n: number) => '70000000-0000-4000-8000-' + String(n).padStart(12, '0')
const recipe = { generator: 'storage_box_v1', version: 1, width_mm: 800, height_mm: 350, depth_mm: 600, thickness_mm: 18 }
const drawing = (extra: Record<string, unknown> = {}) => ({ title: 'Storage box', description: 'Five-panel open-top storage box', assumptions: 'Design specification, not measured site fit.',
  target_revision: 1, area_id: 'areaA', recipe, measurements: [], ...extra })
async function as(uid: string | null, sql: string, params: unknown[] = [], role = 'authenticated'): Promise<any> {
  return pg.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })])
    await tx.exec('set local role ' + role)
    return tx.query(sql, params)
  })
}
async function box(n: number, data = drawing(), action = 'create', expected = 0, uid = one, project = 'A'): Promise<any> {
  return (await as(uid, 'select bob.artifact_box_command($1,$2,$3,$4,$5) result', [project, action, id(n), expected, JSON.stringify(data)])).rows[0].result
}
async function saved(n: number, rev: number, uid = one): Promise<any> {
  return (await as(uid, 'select * from bob.artifact_parametric_recipes where artifact_id=$1 and artifact_revision=$2', [id(n), rev])).rows[0]
}
const json = (v: unknown) => JSON.stringify(v)
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
  for (const [n, area_id] of [[2, 'areaA']] as const) {
    await as(one, 'select bob.solution_command($1,$2,$3,$4,$5)', ['A','create',id(n),0,json({ title:'Storage proposal',description:'Open-top box',assumptions:'Material and fit to verify',tradeoffs:'Simple joinery',area_id })])
    await as(one, 'select bob.solution_command($1,$2,$3,$4,$5)', ['A','select',id(n),0,json({ solution_revision:1,reason:'Use this scope',area_id })])
  }

  await as(both, 'select bob.physical_building_command($1,$2,0,$3)', ['create',id(200),json({name:'House',notes:'Persistent room fixture'})])
  await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200),'level','create',id(201),json({name:'Ground floor',position:0})])
  for (const [n,name] of [[202,'Children room'],[203,'Office']] as const) {
    await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200),'space','create',id(n),json({name,kind:'room',level_id:id(201),truth:'unknown',measurements:[]})])
  }
  await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200),'element','create',id(204),json({name:'Shared wall',kind:'wall',space_id:id(202),truth:'unknown',description:'Existing identity, proposed placement'})])
  await as(both, 'select bob.physical_scope_command($1,$2,$3,$4,$5)', ['A','project','link',id(205),json({target_kind:'building',building_id:id(200)})])
  await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200),'level','create',id(206),json({name:'Upper floor',position:1})])
  for (const [n,name] of [[207,'Bedroom'],[208,'Landing']] as const) await as(both, 'select bob.physical_node_command($1,$2,$3,$4,0,$5)', [id(200),'space','create',id(n),json({name,kind:'room',level_id:id(206),truth:'unknown',measurements:[]})])
})
after(() => pg.close())


const data=(extra={})=>({title:'Shared floor coordinates',description:'Two aligned floors',assumptions:'Synthetic coordinate study, not observed site facts.',
 area_id:'areaA',target_revision:1,recipe:makePlan(),measurements:[],change_note:'Requested study',...extra})
async function save(n:number,body=data(),action='create',expected=0,who=one,project='A'){
 return (await as(who,'select bob.artifact_multifloor_command($1,$2,$3,$4,$5) result',[project,action,id(n),expected,json(body)])).rows[0].result
}
async function detail(n:number,revision:number,who=one){return (await as(who,'select * from bob.artifact_multifloor_details where artifact_id=$1 and artifact_revision=$2',[id(n),revision])).rows[0]}
test('actual migrated database accepts one coordinate study tied to canonical levels and rooms',async()=>{
 await save(400)
 const d=await detail(400,1)
 assert.equal(d.building_id,id(200));assert.equal(d.names[id(207)],'Bedroom');assert.equal(d.sources_changed,false)
 assert.equal(buildingPlanGeometry(d.recipe).probes[0].floor_delta_mm,2800)
 assert.equal((await as(one,'select has_multifloor_plan,status from bob.current_artifacts where id=$1',[id(400)])).rows[0].status,'concept')
})

test('SQL independently rejects impossible geometry, extra authority fields and foreign physical identities',async()=>{
 for(const mutate of [(p:any)=>p.levels[0].bounds.width_mm=0,(p:any)=>p.levels[0].wall_mm=2500,
  (p:any)=>p.levels[1].floor_z_mm=0,(p:any)=>p.levels[0].floor_z_mm='0',(p:any)=>p.spaces[0].basis='measured',
  (p:any)=>p.levels.push({...p.levels[0],level_id:p.levels[0].level_id.toUpperCase()}),(p:any)=>p.levels[0].bounds.x_mm=0.0001]){
  const p=makePlan();mutate(p);await assert.rejects(save(401,data({recipe:p})))
 }
 await assert.rejects(save(401,data({status:'build_ready'})),/fields/)
 const p=makePlan();p.spaces[0].level_id=id(206)
 await assert.rejects(save(401,data({recipe:p})),/another level/)
 p.spaces[0].level_id=id(201);p.spaces[0].space_id=id(999)
 await assert.rejects(save(401,data({recipe:p})),/unavailable/)
 assert.equal(await detail(401,1),undefined)
})

test('raw writes, outsider reads and other project writes are denied by the actual database',async()=>{
 await assert.rejects(as(one,'update bob.artifact_multifloor_plans set names=$1',[json({})]),/permission denied/)
 await assert.rejects(as(one,'delete from bob.artifact_multifloor_plans'),/permission denied/)
 await assert.rejects(as(null,'select * from bob.artifact_multifloor_plans',[],'anon'),/permission denied/)
 assert.equal(await detail(400,1,two),undefined)
 await assert.rejects(save(401,data(),'create',0,two),/project_denied/)
 await assert.rejects(save(401,data(),'create',0,both,'B'),/project_denied/)
})

test('changing one floor height updates only derived vertical results and preserves historical coordinates',async()=>{
 const before=await detail(400,1),p=makePlan();p.levels[1].floor_z_mm=2900
 await save(400,data({area_id:undefined,recipe:p}),'revise',1)
 const after=await detail(400,2),g=buildingPlanGeometry(after.recipe)
 assert.equal(g.probes[0].floor_delta_mm,2900);assert.equal(g.probes[0].lower_floor_to_upper_slab_mm,2650)
 assert.deepEqual(after.recipe.spaces,before.recipe.spaces);assert.deepEqual((await detail(400,1)).recipe,before.recipe)
 await assert.rejects(save(400,data({area_id:undefined,recipe:p}),'revise',1),/Drawing changed/)
 assert.equal(await detail(400,3),undefined)
 assert.equal((await as(one,'select count(*)::int n from bob.current_measurements')).rows[0].n,0)
})

test('archive and restore carry the plan recipe and marker without changing source geometry',async()=>{
 const old=await detail(400,2)
 for(const [action,expected]of [['archive',2],['restore',3]]as const){
  await as(one,'select bob.artifact_command($1,$2,$3,$4,$5)',['A',action,id(400),expected,'{}'])
  assert.deepEqual((await detail(400,expected+1)).recipe,old.recipe)
 }
 assert.equal((await as(one,'select has_multifloor_plan from bob.artifact_revision_details where artifact_id=$1 and revision=1',[id(400)])).rows[0].has_multifloor_plan,true)
})

test('physical source revisions must be explicitly adopted; refresh cannot resize or drop rooms',async()=>{
 await as(both,'select bob.physical_node_command($1,$2,$3,$4,$5,$6)',[id(200),'space','revise',id(207),1,json({name:'Renamed bedroom',kind:'room',level_id:id(206),truth:'unknown',measurements:[],change_note:'Correct name'})])
 const old=await detail(400,4);assert.equal(old.sources_changed,true);assert.equal(old.names[id(207)],'Bedroom')
 await assert.rejects(save(400,data({area_id:undefined,recipe:old.recipe}),'revise',4),/Space source changed/)
 const changed=structuredClone(old.recipe);changed.spaces[2].space_revision=2
 await assert.rejects(save(400,data({area_id:undefined,recipe:changed}),'revise',4),/Preserve existing space/)
 const resized=structuredClone(changed);resized.levels[1].floor_z_mm=3000
 await assert.rejects(save(400,data({area_id:undefined,recipe:resized}),'refresh_sources',4),/without changing geometry/)
 await save(400,data({area_id:undefined,recipe:changed}),'refresh_sources',4)
 const now=await detail(400,5);assert.equal(now.sources_changed,false);assert.equal(now.names[id(207)],'Renamed bedroom')
 assert.equal(now.recipe.levels[1].floor_z_mm,2900);assert.equal((await detail(400,4)).recipe.spaces[2].space_revision,1)
 const removed=structuredClone(now.recipe);removed.spaces.pop()
 await assert.rejects(save(400,data({area_id:undefined,recipe:removed}),'revise',5),/Preserve existing space/)
})

test('fresh research supplies exact-coordinate detail only on explicit open, with bounded derived data',async()=>{
 const lookup=createProjectLookup('A',async(project,input)=>({data:(await as(one,'select bob.search_bob_project_data_v6($1,$2,$3,$4,$5,$6,$7) result',
  [project,input.dataset,input.query,input.status,input.area_id,input.record_id,input.after_id??null])).rows[0].result,error:null}),1000,10)
 const list=await lookup.search({dataset:'artifacts',query:null,status:null,area_id:null,record_id:null,after_id:null})
 const row:any=list.records.find(r=>r.id===id(400))
 assert.equal(row.has_multifloor_plan,true);assert.equal(row.multifloor_plan,null);assert.equal(row.coordinate_detail,'read_exact_record_id')
 const result:any=await lookup.inspectProjection({record_id:id(400),expected_revision:5,from_level_id:id(201),to_level_id:id(206),bounds:{x_mm:5000,y_mm:1000,width_mm:1000,depth_mm:2000}})
 assert.equal(result.status,'ok');assert.equal(result.projection.floor_delta_mm,2900);assert.equal(result.saved,false)
 assert.equal(result.sources_changed,false)
})

let turn=100
async function claim(message:string){
 const turnId=id(turn++),c=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',['A',one,turnId,message],'service_role')).rows[0].result
 assert.equal(c.status,'claimed');return {p:['A',c.thread_id,turnId,c.generation]}
}
async function end(c:any){await as(null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',['A',one,c.p[1],c.p[2],c.p[3]],'service_role')}

test('real chat orchestration saves one plan then executes a read-only projection using actual SQL and exact receipts',async t=>{
 const message='Rita husets två våningar.',c=await claim(message);t.after(()=>end(c))
 const p=makePlan();p.spaces[2].space_revision=2
 const {area_id,...rest}=data({recipe:p})
 const args={...rest,record_id:null,expected_revision:0,action:'create',create_area_id:area_id,request_quote:message}
 let calls=0,writes=0,artifactId=''
 const writer=createProjectWriter('A',message,async payload=>{writes++;return {data:(await as(one,'select bob.bob_project_write_v5($1,$2,$3,$4,$5) result',[...c.p,json(payload)])).rows[0].result,error:null}},
  async()=>({data:(await as(one,'select bob.bob_read_write_receipts($1,$2,$3,$4) result',c.p)).rows[0].result,error:null}),
  async()=>{const q=(await as(one,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',c.p)).rows[0].result;c.p[3]=q.generation;return {data:q,error:null}})
 const result=await runClaimedProjectTurn({projectId:'A',userId:one,message,generation:Number(c.p[3]),writer,hasAccess:async()=>true,fail:async()=>{},
  lookup:createProjectLookup('A',async(project,input)=>({data:(await as(one,'select bob.search_bob_project_data_v6($1,$2,$3,$4,$5,$6,$7) result',
   [project,input.dataset,input.query,input.status,input.area_id,input.record_id,input.after_id??null])).rows[0].result,error:null})),
  callModel:async options=>{
   calls++;assert(options.tools?.some(t=>t.function.name==='inspect_building_projection'))
   const response={success:true,data:null,model:'deterministic fixture',responseId:'floor_tool_'+calls,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
   if(calls===1)return {...response,toolCalls:[{id:'save',type:'function',function:{name:'save_project_building_plan',arguments:json(args)}}]}
   const output=JSON.parse(options.messages![0].content!)
   if(calls===2){
    assert.equal(output.status,'saved');artifactId=output.receipt.recordId
    assert.equal(output.receipt.record.derived_multifloor.probes[0].floor_delta_mm,2800)
    return {...response,toolCalls:[{id:'inspect',type:'function',function:{name:'inspect_building_projection',arguments:json({record_id:artifactId,expected_revision:1,from_level_id:id(201),to_level_id:id(206),bounds:{x_mm:3500,y_mm:1000,width_mm:2000,depth_mm:2000}})}}]}
   }
   assert.equal(output.status,'ok');assert.equal(output.saved,false);assert.equal(output.projection.to_spaces.length,2)
   return {...response,data:'Koordinatstudien är sparad. Den undersökta ytan överlappar två rumsytor, men någon trappa är inte beräknad.'}
  }})
 assert(result.ok);assert.equal(calls,3);assert.equal(writes,1)
 if(result.ok){assert.equal(result.evidence.writes?.[0].recordId,artifactId);assert.equal(result.evidence.writes?.[0].revision,1)}
})

test('claimed-turn retries return the original drawing and settlement prevents late writes',async t=>{
 const message='Spara koordinatstudien.',c=await claim(message);t.after(()=>end(c))
 const p=makePlan();p.spaces[2].space_revision=2
 const payload={kind:'multifloor',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:message,data:{...data({recipe:p}),action:'create'}}
 const call=async(v:any,who=one)=>(await as(who,'select bob.bob_project_write_v5($1,$2,$3,$4,$5) result',[...c.p,json(v)])).rows[0].result
 await assert.rejects(call(payload,both),/project_denied|turn_not_claimed/)
 await assert.rejects(call({...payload,request_quote:'Not in current request'}),/request_quote/)
 const receipt=await call(payload);assert.equal(receipt.dataset,'artifacts');assert.deepEqual(await call(payload),receipt)
 await assert.rejects(call({...payload,data:{...payload.data,assumptions:'Different attempt'}}),/operation_reused/)
 const q=(await as(one,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',c.p)).rows[0].result
 await assert.rejects(call(payload),/turn_not_claimed/);c.p[3]=q.generation
})

test('measurement changes mark old plans stale and do not resize the geometry',async()=>{
 const p=makePlan();p.spaces[2].space_revision=2
 await as(one,"select bob.evidence_command('A','measurement','create',$1,0,$2)",[id(450),json({subject:'Floor height',value:'2800',unit:'mm',truth:'measured',source:'Synthetic tape test',required:true})])
 await save(402,data({recipe:p,measurements:[{id:id(450),revision:1}]}))
 await as(one,"select bob.evidence_command('A','measurement','revise',$1,1,$2)",[id(450),json({subject:'Floor height',value:'2850',unit:'mm',truth:'measured',source:'Synthetic remeasure',required:true,change_note:'Correction'})])
 const d=await detail(402,1);assert.equal(d.sources_changed,true);assert.equal(d.recipe.levels[1].floor_z_mm,2800)
 await assert.rejects(save(402,data({area_id:undefined,recipe:p,measurements:[]}),'revise',1),/Preserve linked evidence/)
})

test('target changes invalidate the saved study without rewriting it',async()=>{
 await as(one,"select bob.solution_command('A','select',$1,1,$2)",[id(2),json({solution_revision:1,reason:'Choose again',area_id:'areaA'})])
 assert.equal((await detail(400,5)).sources_changed,true)
 await assert.rejects(save(400,data({area_id:undefined,recipe:(await detail(400,5)).recipe}),'revise',5),/target changed|Target changed/)
})

test('physical scope revocation hides raw geometry as well as view data, but keeps the Artifact marker',async()=>{
 await as(both,'select bob.physical_scope_command($1,$2,$3,$4,$5)',['A','project','unlink',id(205),'{}'])
 assert.equal(await detail(400,1,both),undefined)
 assert.equal((await as(both,'select * from bob.artifact_multifloor_plans where artifact_id=$1',[id(400)])).rows.length,0)
 const r=(await as(both,"select bob.search_bob_project_data_v6('A','artifacts',null,null,null,$1,null) result",[id(400)])).rows[0].result
 assert.equal(r.records[0].has_multifloor_plan,true);assert.equal(r.records[0].multifloor_plan,null)
 // A narrow room scope must not recreate whole-building coordinate authority.
 await as(both,'select bob.physical_scope_command($1,$2,$3,$4,$5)',['A','project','link',id(451),json({target_kind:'space',building_id:id(200),space_id:id(202)})])
 assert.equal(await detail(400,1,both),undefined)
 await assert.rejects(save(405,data(),'create',0,both),/project_denied/)
})
