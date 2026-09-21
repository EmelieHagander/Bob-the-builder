import { domainToolLoadout } from './support/tool-loadout.ts'
import { setupSharedSocial } from './support/shared-social.ts'
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { roomLayoutGeometry, roomLayoutStale } from '../src/lib/roomLayout.ts'
import { parseProjectWrite, createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
import { storageBoxGeometry } from '../src/lib/storageBox.ts'

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
  await box(300)
})
after(() => pg.close())

const params = { generator:'room_pair_v1',version:1,span_mm:6120,depth_mm:4000,wall_thickness_mm:120,left_width_mm:3400,
  furniture_room:'left',anchor:'shared_wall',gap_mm:50,offset_mm:200,rotation:0 }
const sources = { left_space_revision:1,right_space_revision:1,wall_element_revision:1,furniture_revision:1,measurements:[] }
const initial = (extra={}) => ({ title:'Two-room plan',description:'Linked proposal, not current physical geometry',assumptions:'Working dimensions; actual openings and heights not checked.',
  area_id:'areaA',target_revision:1,change_note:'Create requested plan',building_id:id(200),left_space_id:id(202),right_space_id:id(203),wall_element_id:id(204),
  furniture_artifact_id:id(300),...sources,parameters:params,...extra })
async function plan(n:number, action='create', expected=0, data:Record<string,unknown>=initial(), uid=one, project='A') {
  return (await as(uid,'select bob.artifact_room_layout_command($1,$2,$3,$4,$5) result',[project,action,id(n),expected,json(data)])).rows[0].result
}
async function layout(n:number, revision:number, uid=one):Promise<any> {
  return (await as(uid,'select * from bob.artifact_room_layout_details where artifact_id=$1 and artifact_revision=$2',[id(n),revision])).rows[0]
}
const move = (width:number, target=1) => ({left_width_mm:width,target_revision:target,change_note:'Move shared wall'})
const place = (extra={}) => ({target_revision:1,change_note:'Move furniture only',furniture_room:'left',anchor:'outer_wall',gap_mm:50,offset_mm:200,rotation:0,...extra})
const refresh = (extra={}) => ({target_revision:1,change_note:'Explicitly adopt current sources',...sources,...extra})

test('one atomic proposed package pins canonical rooms, one wall, one furniture instance and exact drawing revision', async () => {
  await plan(310)
  const d=await layout(310,1)
  assert.equal(d.left_space_id,id(202));assert.equal(d.right_space_id,id(203));assert.equal(d.wall_element_id,id(204))
  assert.equal(d.furniture_artifact_id,id(300));assert.equal(d.furniture_revision,1)
  assert.equal(d.left_name,'Children room');assert.equal(d.right_name,'Office')
  assert.equal(d.context_available,true);assert(!roomLayoutStale(d))
  assert.deepEqual(roomLayoutGeometry(d.parameters,d.furniture_recipe).parts,storageBoxGeometry(recipe).parts)
  assert.equal((await as(one,'select has_room_layout,status from bob.current_artifacts where id=$1',[id(310)])).rows[0].status,'concept')
  assert.equal((await as(one,'select count(*)::int n from bob.space_revisions where building_id=$1',[id(200)])).rows[0].n,2)
  assert.equal((await as(one,'select count(*)::int n from bob.current_measurements')).rows[0].n,0,'plan dimensions never become measurements')
})

test('move wall conserves fixed span, updates both rooms and placement, keeps furniture parts and old package unchanged', async () => {
  const before=await layout(310,1), furnitureBefore=await saved(300,1)
  await plan(310,'move_wall',1,move(3200))
  const after=await layout(310,2),g=roomLayoutGeometry(after.parameters,after.furniture_recipe)
  assert.deepEqual([g.left.width,g.wall.width,g.right.width],[3200,120,2800])
  assert.equal(g.furniture.x,2350);assert.equal(after.instance_id,before.instance_id)
  assert.deepEqual(await saved(300,1),furnitureBefore);assert.deepEqual((await layout(310,1)).parameters,before.parameters)
  assert.equal((await as(one,'select current_revision from bob.artifacts where id=$1',[id(300)])).rows[0].current_revision,1)
})

test('an out-of-room placement is retained as a visible concept conflict, never silently resized or certified', async () => {
  await plan(310,'place_furniture',2,place({gap_mm:3000}))
  const d=await layout(310,3),g=roomLayoutGeometry(d.parameters,d.furniture_recipe)
  assert.equal(g.fit,'outside_room');assert.equal(g.clearance.acrossMm,-600)
  assert.equal(d.furniture_recipe.width_mm,800);assert.equal(d.furniture_revision,1)
  await plan(310,'place_furniture',3,place())
  assert.equal(roomLayoutGeometry((await layout(310,4)).parameters,recipe).furniture.x,50)
})

test('raw/anonymous writes, foreign physical scope, foreign furniture and spoofed identities are denied', async () => {
  for(const sql of ['delete from bob.artifact_room_layouts',"update bob.artifact_room_layouts set instance_id=gen_random_uuid()",'select bob.artifact_room_layout_command(\'A\',\'create\',gen_random_uuid(),0,\'{}\')']) {
    await assert.rejects(as(two,sql))
  }
  await assert.rejects(as(null,'select * from bob.artifact_room_layout_details',[],'anon'),/permission denied/)
  assert.equal((await as(two,'select * from bob.artifact_room_layouts')).rows.length,0)
  await assert.rejects(plan(311,'create',0,initial(),both,'B'),/project_denied/)
  await assert.rejects(plan(311,'create',0,initial({right_space_id:id(999)})),/project_denied/)
  await assert.rejects(plan(311,'create',0,initial({furniture_artifact_id:id(999)})),/unavailable/)
  for(const extra of [{status:'build_ready'},{actor:two},{instance_id:id(333)},{right_width_mm:5000}]) await assert.rejects(plan(311,'create',0,initial(extra)),/Unsupported/)
  assert.equal(await layout(311,1),undefined)
})

test('invalid geometry, stale package revisions and unsupported changes rollback the entire artifact revision', async () => {
  for(const parameters of [{...params,left_width_mm:6000},{...params,version:2},{...params,span_mm:6120.0001},{...params,rotation:45},{...params,depth_mm:'4000'}]) {
    await assert.rejects(plan(311,'create',0,initial({parameters})),/Invalid/)
  }
  await assert.rejects(plan(310,'move_wall',1,move(3300)),/Drawing changed/)
  await assert.rejects(plan(310,'move_wall',4,{...move(3300),furniture_revision:2}),/Unsupported/)
  assert.equal(await layout(310,5),undefined)
})

test('research returns scoped physical sources and the exact saved package, not invented or other-project context', async () => {
  const query=async(dataset:string,project='A',record:string|null=null)=> (await as(both,'select bob.search_bob_project_data_v4($1,$2,null,null,null,$3,null) result',[project,dataset,record])).rows[0].result
  assert.equal((await query('physical_spaces')).records.length,2)
  assert.equal((await query('physical_elements')).records[0].id,id(204))
  assert.equal((await query('physical_spaces','B')).records.length,0)
  assert.equal((await query('artifacts','B',id(310))).records.length,0)
  const result=await query('artifacts','A',id(310))
  assert.equal(result.records[0].has_room_layout,true)
  assert.equal(result.records[0].room_layout.artifact_revision,4)
  assert.equal(result.records[0].room_layout.furniture_revision,1)
  const lookup=createProjectLookup('A',async(project,input)=>{
    const q=await as(one,'select bob.search_bob_project_data_v4($1,$2,$3,$4,$5,$6,$7) result',[project,input.dataset,input.query,input.status,input.area_id,input.record_id,input.after_id??null])
    return {data:q.rows[0].result,error:null}
  })
  const derived=await lookup.search({dataset:'artifacts',query:null,status:null,area_id:null,record_id:id(310),after_id:null})
  assert.equal((derived.records[0].derived_layout as any).fit,'fits_outline_only')
  assert.equal((derived.records[0].derived_layout as any).right.width,2800)
})

test('changed furniture cannot be silently adopted; explicit refresh changes its pinned version but not the old package', async () => {
  await box(300,drawing({area_id:undefined,change_note:'Lower box',recipe:{...recipe,height_mm:300}}),'regenerate',1)
  const old=await layout(310,4)
  assert(roomLayoutStale(old));assert.equal(old.furniture_revision,1);assert.equal(old.furniture_recipe.height_mm,350)
  await assert.rejects(plan(310,'move_wall',4,move(3300)),/Furniture drawing changed/)
  assert.equal(await layout(310,5),undefined)
  await plan(310,'refresh_sources',4,refresh({furniture_revision:2}))
  const current=await layout(310,5)
  assert.equal(current.furniture_revision,2);assert.equal(current.furniture_recipe.height_mm,300);assert(!roomLayoutStale(current))
  assert.equal((await layout(310,4)).furniture_recipe.height_mm,350)
  assert.equal(current.instance_id,old.instance_id)
})

test('changed physical sources reject a dependent edit, while refresh preserves dimensions and canonical identities', async () => {
  await as(both,'select bob.physical_node_command($1,$2,$3,$4,1,$5)',[id(200),'space','revise',id(202),json({name:'Children room remeasured',kind:'room',level_id:id(201),truth:'unknown',measurements:[],change_note:'New physical record'})])
  assert(roomLayoutStale(await layout(310,5)))
  await assert.rejects(plan(310,'move_wall',5,move(3300)),/Physical sources changed/)
  await plan(310,'refresh_sources',5,refresh({left_space_revision:2,furniture_revision:2}))
  const d=await layout(310,6)
  assert.equal(d.left_name,'Children room remeasured');assert.equal((await layout(310,5)).left_name,'Children room')
  assert.equal(d.parameters.left_width_mm,3200);assert(!roomLayoutStale(d))
})

test('a changed target needs explicit adoption; latest does not silently mix two alternatives', async () => {
  await as(one,'select bob.solution_command($1,$2,$3,0,$4)',['A','create',id(3),json({title:'Alternative B',description:'Another chosen solution',assumptions:'Working plan',tradeoffs:'Different layout',area_id:'areaA'})])
  await as(one,'select bob.solution_command($1,$2,$3,1,$4)',['A','select',id(3),json({solution_revision:1,reason:'Choose alternative B',area_id:'areaA'})])
  await assert.rejects(plan(310,'move_wall',6,move(3300,2)),/Target changed/)
  await assert.rejects(plan(310,'move_wall',6,move(3300,1)),/target changed/)
  await plan(310,'refresh_sources',6,refresh({target_revision:2,left_space_revision:2,furniture_revision:2}))
  const old=(await as(one,'select target_revision,solution_id from bob.artifact_revision_details where artifact_id=$1 and revision=6',[id(310)])).rows[0]
  const now=(await as(one,'select target_revision,solution_id from bob.current_artifacts where id=$1',[id(310)])).rows[0]
  assert.equal(old.target_revision,1);assert.equal(old.solution_id,id(2));assert.equal(now.target_revision,2);assert.equal(now.solution_id,id(3))
})

test('archive and restore retain the complete coherent package, source identities and one instance', async () => {
  const old=await layout(310,7)
  for(const [action,expected] of [['archive',7],['restore',8]] as const) {
    await as(one,'select bob.artifact_command($1,$2,$3,$4,$5)',['A',action,id(310),expected,'{}'])
    const d=await layout(310,expected+1)
    assert.deepEqual(d.parameters,old.parameters);assert.equal(d.instance_id,old.instance_id);assert.equal(d.furniture_revision,old.furniture_revision)
  }
})

let turn=700
async function claim(message:string) {
  const tid=id(turn++)
  const c=(await as(null,'select bob.bob_claim_turn($1,$2,$3,$4) result',['A',one,tid,message],'service_role')).rows[0].result
  assert.equal(c.status,'claimed');return {p:['A',c.thread_id,tid,c.generation] as any[],message}
}
async function end(c:Awaited<ReturnType<typeof claim>>) {
  await as(null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',['A',one,c.p[1],c.p[2],c.p[3]],'service_role')
}

test('real Bob tool loop creates a linked drawing without a form and returns computed geometry plus an exact-revision receipt', async t => {
  const message='Rita de två rummen med lådan.';const c=await claim(message);t.after(()=>end(c))
  const data=initial({target_revision:2,left_space_revision:2,furniture_revision:2})
  const {area_id,...rest}=data
  const args={...rest,create_area_id:area_id,request_quote:message}
  let calls=0,writeCalls=0
  const writer=createProjectWriter('A',message,async payload=>{
    writeCalls++
    const q=await as(one,'select bob.bob_project_write_v3($1,$2,$3,$4,$5) result',[...c.p,json(payload)])
    return {data:q.rows[0].result,error:null}
  },async()=>({data:(await as(one,'select bob.bob_read_write_receipts($1,$2,$3,$4) result',c.p)).rows[0].result,error:null}),
  async()=>{
    const q=(await as(one,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',c.p)).rows[0].result
    c.p[3]=q.generation;return {data:q,error:null}
  })
  const result=await runClaimedProjectTurn({readToolPolicy:domainToolLoadout('create_project_room_layout'),projectId:'A',userId:one,message,generation:c.p[3],hasAccess:async()=>true,writer,
    fail:async()=>{},lookup:createProjectLookup('A',async(project,input)=>({data:(await as(one,'select bob.search_bob_project_data_v4($1,$2,$3,$4,$5,$6,$7) result',
      [project,input.dataset,input.query,input.status,input.area_id,input.record_id,input.after_id??null])).rows[0].result,error:null})),
    callModel:async options=>{
      calls++
      assert(options.tools?.some(t=>t.function.name==='create_project_room_layout'))
      if(calls===1)return {success:true,data:null,model:'deterministic fixture',responseId:'room_tool',usage:{input_tokens:1,output_tokens:1,total_tokens:2},
        toolCalls:[{id:'room_call',type:'function',function:{name:'create_project_room_layout',arguments:json(args)}}]}
      const output=JSON.parse(String(options.messages![0].content))
      assert.equal(output.status,'saved');assert.equal(output.receipt.record.derived_layout.right.width,2600)
      assert.equal(output.receipt.record.derived_layout.fit,'fits_outline_only')
      return {success:true,data:'Ritningen är sparad. Passning gäller enbart rumsomkretsen.',model:'fixture',responseId:'room_final',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
    }})
  assert.equal(result.ok,true);assert.equal(calls,2);assert.equal(writeCalls,1)
  if(result.ok){assert.equal(result.evidence.writes?.[0].dataset,'artifacts');assert.equal(result.evidence.writes?.[0].revision,1);assert.equal(result.evidence.writes?.[0].areaId,'areaA')}
})

test('Bob retries do not duplicate a layout and settlement fences later writes or forged approval', async t => {
  const message='Flytta väggen.';const c=await claim(message);t.after(()=>end(c))
  const args={record_id:id(310),expected_revision:9,target_revision:2,action:'move_wall',left_width_mm:3000,placement:null,source_revisions:null,change_note:'Narrow left room',request_quote:message}
  const payload=parseProjectWrite('edit_project_room_layout',args,'A',message)!
  const save=async(v:unknown,uid=one)=>(await as(uid,'select bob.bob_project_write_v3($1,$2,$3,$4,$5) result',[...c.p,json(v)])).rows[0].result
  await assert.rejects(save(payload,both),/denied|claimed/)
  await assert.rejects(save({...payload,request_quote:'Invented approval'}),/request_quote/)
  const receipt=await save(payload)
  assert.equal(receipt.revision,10);assert.deepEqual(await save(payload),receipt)
  await assert.rejects(save({...payload,data:{...payload.data,left_width_mm:2900}}),/operation_reused/)
  const q=(await as(one,'select bob.bob_settle_project_writes($1,$2,$3,$4) result',c.p)).rows[0].result
  await assert.rejects(save(payload),/turn_not_claimed/)
  c.p[3]=q.generation
})

test('removing project physical scope cannot expose layout source details through another membership', async () => {
  await as(both,'select bob.physical_scope_command($1,$2,$3,$4,$5)',['A','project','unlink',id(205),'{}'])
  assert.equal(await layout(310,1,both),undefined)
  const q=(await as(both,'select bob.search_bob_project_data_v4($1,$2,null,null,null,$3,null) result',['A','artifacts',id(310)])).rows[0].result
  assert.equal(q.records[0].has_room_layout,true);assert.equal(q.records[0].room_layout,null)
  await assert.rejects(plan(310,'move_wall',10,move(3100,2),both),/project_denied/)
})
