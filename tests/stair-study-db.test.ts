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
import {makeStair} from './support/stair-fixture.ts'
import {stairGeometry} from '../src/lib/stairStudy.ts'
const stairData=(extra={})=>({plan_id:id(400),plan_revision:1,recipe:makeStair(),title:'Calculated stair',description:'Synthetic quarter turn',assumptions:'Test dimensions, not observed facts',change_note:'Requested stair',...extra})
async function stair(n:number,d=stairData(),action='create',expected=0,who=one,project='A'){
 return (await as(who,'select bob.artifact_stair_command($1,$2,$3,$4,$5) result',[project,action,id(n),expected,json(d)])).rows[0].result
}
async function stairDetail(n:number,r:number,who=one){return (await as(who,'select * from bob.artifact_stair_details where artifact_id=$1 and artifact_revision=$2',[id(n),r])).rows[0]}
test('stair stores only parameters and exact source revision; canonical readback uses the same target and physical geometry',async()=>{
 await save(400);await stair(500)
 const d=await stairDetail(500,1);assert.equal(d.plan_id,id(400));assert.equal(d.plan_revision,1);assert.equal(d.sources_changed,false)
 assert.equal(stairGeometry(d.plan.recipe,d.recipe).exit.x_mm,4910)
 const a=(await as(one,'select * from bob.current_artifacts where id=$1',[id(500)])).rows[0]
 assert.equal(a.area_id,'areaA');assert.equal(a.solution_id,id(2));assert.equal(a.status,'concept');assert.equal(a.has_stair_study,true)
 assert.equal((await as(one,'select count(*)::int n from bob.current_measurements')).rows[0].n,0)
})
test('SQL rejects invalid shapes and source heights independently of the model/browser',async()=>{
 for(const change of [{turn:'rounded'},{width_mm:900.1},{risers:61},{opening:[]},{first_flight_risers:16},{source:''},{extra:1}])await assert.rejects(stair(501,stairData({recipe:{...makeStair(),...change}})))
 for(const change of [{status:'build_ready'},{project_id:'B'},{area_id:'areaB'},{target_revision:999}])await assert.rejects(stair(501,stairData(change)))
 const p=makePlan();p.levels[1].floor_z_mm=null;await save(401,data({recipe:p}))
 await assert.rejects(stair(501,stairData({plan_id:id(401)})),/elevations required/)
 assert.equal(await stairDetail(501,1),undefined)
})
test('project/canonical Building scope, anonymous reads and raw writes fail closed',async()=>{
 await assert.rejects(as(one,'update bob.artifact_stair_studies set plan_revision=2'),/permission denied/)
 await assert.rejects(as(one,'delete from bob.artifact_stair_studies'),/permission denied/)
 await assert.rejects(as(null,'select * from bob.artifact_stair_studies',[],'anon'),/permission denied/)
 assert.equal(await stairDetail(500,1,two),undefined)
 await assert.rejects(stair(501,stairData(),'create',0,two),/project_denied/)
 await assert.rejects(stair(501,stairData(),'create',0,both,'B'),/unavailable|denied/)
})
test('moving/turning the stair changes its revision but not parent plan or earlier stair; stale edits fail atomically',async()=>{
 const before=await detail(400,1),old=await stairDetail(500,1)
 await stair(500,stairData({recipe:{...makeStair(),start_x_mm:3000}}),'revise',1)
 assert.equal(stairGeometry((await stairDetail(500,2)).plan.recipe,(await stairDetail(500,2)).recipe).exit.x_mm,5410)
 assert.deepEqual(await detail(400,1),before);assert.deepEqual((await stairDetail(500,1)).recipe,old.recipe)
 await assert.rejects(stair(500,stairData(),'revise',1),/Drawing changed/)
 assert.equal(await stairDetail(500,3),undefined)
})
test('source revision changes block ordinary edits; explicit refresh preserves parameters and recalculates rise',async()=>{
 const p=makePlan();p.levels[1].floor_z_mm=3000
 await save(400,data({recipe:p,area_id:undefined}),'revise',1)
 assert.equal((await stairDetail(500,2)).sources_changed,true)
 await assert.rejects(stair(500,stairData(),'revise',2),/Source plan changed/)
 await assert.rejects(stair(500,stairData({plan_revision:2}),'revise',2),/refresh source first/)
 await assert.rejects(stair(500,stairData({plan_revision:2}),'refresh_source',2),/without changing stair/)
 const old=await stairDetail(500,2)
 await stair(500,stairData({plan_revision:2,recipe:old.recipe}),'refresh_source',2)
 const d=await stairDetail(500,3);assert.equal(d.sources_changed,false);assert.equal(stairGeometry(d.plan.recipe,d.recipe).rise_mm,187.5)
 assert.equal((await stairDetail(500,2)).plan.recipe.levels[1].floor_z_mm,2800)
})
test('archive/restore retains source and recipe; another generator cannot overwrite a stair artifact',async()=>{
 const before=await stairDetail(500,3)
 for(const [action,r]of [['archive',3],['restore',4]]as const){await as(one,'select bob.artifact_command($1,$2,$3,$4,$5)',['A',action,id(500),r,'{}']);assert.deepEqual((await stairDetail(500,r+1)).recipe,before.recipe)}
 await assert.rejects(as(one,"select bob.artifact_box_command('A','regenerate',$1,5,$2)",[id(500),json(drawing({area_id:undefined,change_note:'Bad conversion'}))]),/unavailable|two geometry/)
})
let seq=1000
async function claim(message='Rita trappan'){
 const turn=id(seq++),r=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',['A',one,turn,message],'service_role')).rows[0].result
 return {p:['A',r.thread_id,turn,r.generation],message}
}
async function finish(c:Awaited<ReturnType<typeof claim>>){await as(null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',['A',one,c.p[1],c.p[2],c.p[3]],'service_role')}
test('claimed Bob save and retry return one exact stair revision receipt; mismatched retry and forged authority are denied',async t=>{
 const c=await claim();t.after(()=>finish(c))
 const payload={kind:'stair',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:c.message,data:{...stairData({plan_revision:2}),action:'create'}}
 const call=async(p=payload,who=one)=>(await as(who,'select bob.bob_project_write_v6($1,$2,$3,$4,$5) result',[...c.p,json(p)])).rows[0].result
 const receipt=await call();assert.equal(receipt.dataset,'artifacts');assert.equal(receipt.revision,1);assert.equal(receipt.areaId,'areaA')
 assert.deepEqual(await call(),receipt);assert.equal(receipt.record.stair_study.plan_revision,2)
 await assert.rejects(call({...payload,request_quote:'Old request'}),/quote/)
 await assert.rejects(call(payload,both),/claimed|denied/)
 await assert.rejects(call({...payload,data:{...payload.data,recipe:{...makeStair(),start_x_mm:3000}}}),/operation_reused/)
 const settled=(await as(one,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',c.p)).rows[0].result
 await assert.rejects(call(),/turn_not_claimed/);c.p[3]=settled.generation
})
test('real read-inspect-save tool loop runs against migrated SQL with fixture model; question-only path creates nothing',async t=>{
 const c=await claim();t.after(()=>finish(c));let calls=0,writes=0
 const lookup=createProjectLookup('A',async(project,i)=>({data:(await as(one,'select bob.search_bob_project_data_v7($1,$2,$3,$4,$5,$6,$7) result',[project,i.dataset,i.query,i.status,i.area_id,i.record_id,i.after_id??null])).rows[0].result,error:null}),10000,12)
 const writer=createProjectWriter('A',c.message,async p=>{writes++;return {data:(await as(one,'select bob.bob_project_write_v6($1,$2,$3,$4,$5) result',[...c.p,json(p)])).rows[0].result,error:null}},async()=>({data:[],error:null}),async()=>{const r=(await as(one,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',c.p)).rows[0].result;c.p[3]=r.generation;return {data:r,error:null}})
 const tool=(name:string,args:unknown)=>({success:true,data:null,model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2},responseId:'step'+calls,toolCalls:[{id:'call'+calls,type:'function' as const,function:{name,arguments:json(args)}}]})
 const answer=await runClaimedProjectTurn({projectId:'A',userId:one,message:c.message,generation:Number(c.p[3]),lookup,writer,hasAccess:async()=>true,fail:async()=>{},callModel:async options=>{
  calls++
  if(calls===1)return tool('inspect_stair_options',{plan_id:id(400),plan_revision:2,candidates:[{label:'Right',recipe:makeStair()}]})
  if(calls===2){const r=JSON.parse(options.messages![0].content!);assert.equal(r.saved,false);assert.equal(r.candidates[0].result.rise_mm,187.5);assert.equal(writes,0)
   return tool('save_project_stair',{record_id:null,expected_revision:0,action:'create',...stairData({plan_revision:2,title:'Tool-loop stair'}),request_quote:c.message})}
  const r=JSON.parse(options.messages![0].content!);assert.equal(r.status,'saved');assert.equal(r.receipt.record.derived_stair.exit.x_mm,4910)
  return {success:true,data:'Sparat. Utloppet ligger vid x 4910, y 3610 mm. Begränsad geometrikontroll, inte bygggodkännande.',model:'fixture',responseId:'done',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
 }})
 assert.equal(answer.ok,true);assert.equal(writes,1);assert.equal(calls,3)
 if(answer.ok)assert.equal(answer.evidence.writes![0].revision,1)
})
test('read research exposes exact source and derived result only with current scoped access; revocation retains marker not geometry',async()=>{
 const r=(await as(one,"select bob.search_bob_project_data_v7('A','artifacts',null,null,null,$1,null) result",[id(500)])).rows[0].result
 assert.equal(r.records[0].stair_study.plan_revision,2);assert.equal(r.records[0].revision,5)
 await as(both,'select bob.physical_scope_command($1,$2,$3,$4,$5)',['A','project','unlink',id(205),'{}'])
 assert.equal(await stairDetail(500,5),undefined)
 const denied=(await as(both,"select bob.search_bob_project_data_v7('A','artifacts',null,null,null,$1,null) result",[id(500)])).rows[0].result
 assert.equal(denied.records[0].has_stair_study,true);assert.equal(denied.records[0].stair_study,null)
 await assert.rejects(stair(502,stairData({plan_revision:2})),/unavailable/)
})
