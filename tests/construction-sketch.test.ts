import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {designIntent} from './support/design-intent-fixture.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createAiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'
import {CONSTRUCTION_SKETCH_COMMIT_TOOL_V2,CONSTRUCTION_NEW_SKETCH_NOTE,CONSTRUCTION_SKETCH_NOTE,baseKeysOf,composeSketchChanges,createConstructionSketchStore,parseSketch,sketchChangeCount,sketchSummary,
 type BaseKeys,type SketchChanges} from '../supabase/functions/_shared/construction-sketch.ts'

// Owner decision 2026-11-07 (sketchbook, design B; "Ja kör på rek!"): Konrad
// builds a construction in a private job sketch, checked whole, and saves it
// once. Measured before: the bed construction went from revision 15 to 19 in
// nine minutes on 2026-11-06, one live revision (and change set) per piece.
const empty:BaseKeys={definitions:[],instances:[],nodes:[],bindings:[],materials:[],joints:[],roles:[]}
const base:BaseKeys={...empty,instances:['left','right'],joints:['j1']}
const part=(id:string,x=0)=>({id,definition_id:'side',placement:{x,y:0,z:0,rx:0,ry:0,rz:0}})

test('composition: a later change to an id replaces the earlier one, a removed sketch addition disappears, a removed saved id stays removed',()=>{
 let s:SketchChanges={}
 const step=(next:SketchChanges)=>{const r=composeSketchChanges(s,next,base);assert(!('issues' in r),JSON.stringify(r));s=r.changes}
 step({instances:{upsert:[part('a',1)],remove:[]}})
 step({instances:{upsert:[part('a',2),part('b')],remove:[]}})
 assert.deepEqual(s.instances!.upsert.map(u=>[u.id,u.placement.x]),[['a',2],['b',0]],'one entry per id, the latest wins, in first-seen order')
 step({instances:{upsert:[],remove:['b','left']},joints:{upsert:[],remove:['j1']}})
 assert.deepEqual(s.instances,{upsert:[part('a',2)],remove:['left']},'a removed sketch addition is gone; a removed saved id is kept for the server')
 step({instances:{upsert:[part('left',5)],remove:[]}})
 assert.deepEqual(s.instances!.remove,[],'upserting a removed saved id changes it instead')
 assert.deepEqual(s.instances!.upsert.map(u=>u.id),['a','left'])
 step({joints:{upsert:[],remove:['j1']}})
 assert.deepEqual(s.joints,{upsert:[],remove:['j1']},'removing twice is the same removal')
 assert.equal(sketchChangeCount(s),3)
 assert.deepEqual(sketchSummary(s).collections,{instances:{upserted:['a','left'],removed:[]},joints:{upserted:[],removed:['j1']}})
 assert.equal(sketchSummary(s,1).complete,false)
 // The server's merge rules hold for each call and for the result.
 const both=composeSketchChanges(s,{instances:{upsert:[part('c')],remove:['c']}},base)
 assert('issues' in both&&both.issues[0].code==='upsert_and_remove')
 const missing=composeSketchChanges(s,{joints:{upsert:[],remove:['nowhere']}},base)
 assert('issues' in missing&&missing.issues[0].code==='remove_missing'&&missing.issues[0].path==='joints/nowhere')
 // Emptied collections leave the sketch.
 const cleared=composeSketchChanges({instances:{upsert:[part('a')],remove:[]}},{instances:{upsert:[],remove:['a']}},base)
 assert('changes' in cleared&&sketchChangeCount(cleared.changes)===0&&!('instances' in cleared.changes))
})

test('a stored sketch is read back only when it is exactly the shape code wrote',()=>{
 const sketch={version:1 as const,base_revision:2,base_keys:base,changes:{instances:{upsert:[part('a')],remove:['left']}},change_count:2,text:null,target_revision:null,notes:['Add a']}
 assert.deepEqual(parseSketch(structuredClone(sketch)),sketch)
 for(const broken of [{...sketch,version:2},{...sketch,change_count:5},{...sketch,changes:{walls:{upsert:[],remove:[]}}},{...sketch,base_keys:{...base,roles:undefined}},
  {...sketch,changes:{instances:{upsert:['a'],remove:[]}}},{...sketch,base_revision:0},{...sketch,notes:[1]}])
  assert.equal(parseSketch(broken),null,JSON.stringify(broken).slice(0,80))
 // Roles fall back to the recipe instances when no policy was saved, as the server merge does.
 assert.deepEqual(baseKeysOf({recipe:{instances:[{id:'x'}],definitions:[]},instance_policy:null}).roles,['x'])
 assert.deepEqual(baseKeysOf({recipe:{instances:[{id:'x'}]},instance_policy:{version:1,instances:[{instance_id:'y'}]},parameters:{nodes:[{id:'n'}],bindings:[{path:'p',node:'n'}]}}),
  {...empty,instances:['x'],roles:['y'],nodes:['n'],bindings:['p']})
})

test('sketch, check and commit once against the database: one revision, one receipt, nothing saved before the commit',async t=>{
 const pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;
   create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 });t.after(()=>pg.close())
 const owner=randomUUID(),stranger=randomUUID(),turn=randomUUID(),message='Build the frame with drawers in a sketch and save it when done.'
 const rpc=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'sketch-owner@example.test',stranger,'sketch-stranger@example.test'])
 const project=(await rpc(owner,'bob.create_project',[JSON.stringify({name:'Sketch fixture'})])).id,solution=randomUUID()
 await rpc(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Frame',description:'Synthetic only',assumptions:'Strength unknown',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
 await rpc(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic design'})])
 const claim=await rpc(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role'),binding=[project,claim.thread_id,turn,claim.generation]
 const write=(p:any)=>rpc(owner,'bob.bob_project_write_v16',[...binding,JSON.stringify(p)])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Synthetic plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:'Build the frame',source_seq:null}})
 const at=(x:number)=>({x,y:0,z:0,rx:0,ry:0,rz:0})
 const recipe:any={contract_version:1,units:'mm',assembly_id:'frame',definitions:[{id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200},{id:'board',primitive:'box',material_ref:null,x_mm:564,y_mm:80,z_mm:18}],
  instances:[{id:'left',definition_id:'side',placement:at(0)},{id:'right',definition_id:'side',placement:at(582)},{id:'bottom',definition_id:'board',placement:at(18)}],views:['front','top']}
 const pin=(definition_id:string)=>({definition_id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null})
 const initial=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'initial',title:'Frame checkpoint',description:'Synthetic concept; no fabrication approval',area_id:null,target_revision:1,change_note:'Initial',recipe,
  parameters:compileCadParameters(project,recipe,parameterPlan(recipe),new Map(),new Map()),materials:recipe.definitions.map((d:any)=>pin(d.id)),
  joints:[{id:'leftJoint',method:'screwed_butt',first:{instance_id:'left',face:'x_max'},second:{instance_id:'bottom',face:'x_min'},reason:'Synthetic concept'}],open_questions:['Hardware unchecked'],
  instance_policy:{version:1,instances:recipe.instances.map((i:any)=>({instance_id:i.id,role:'build_part',quantity_policy:'manufacture',reason:'Synthetic manufactured part'}))}}})
 const id=initial.recordId,read=(revision:number|null=null)=>rpc(owner,'bob.read_construction_draft',[project,id,revision,null])
 const store=(uid=owner)=>createConstructionSketchStore(async(action,artifact,expected,sketch)=>{
  try{return {data:await rpc(uid,'bob.construction_sketch',[...binding,action,artifact,expected,sketch===null?null:JSON.stringify(sketch)]),error:null}}
  catch(e:any){return {data:null,error:{code:e.code}}}})
 const writer=()=>createProjectWriter(project,message,async p=>{try{return {data:await write(p),error:null}}catch(e:any){return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
 const tools=(sketches:ReturnType<typeof store>|undefined=store())=>createConstructionTools({projectId:project,message,writer:writer(),hasAccess:async()=>true,read:(_id,revision)=>read(revision),
  readSources:async()=>({project:new Map(),physical:new Map()}),...(sketches?{sketches}:{}),
  readCatalog:(cid:string,revision:number)=>rpc(owner,'bob.catalog_read',[project,JSON.stringify({action:'read',id:cid,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})]),
  prepareEdit:async p=>{try{return await rpc(owner,'bob.prepare_construction_edit',[...binding,JSON.stringify(p)])}catch(e:any){return {status:e.code==='PT409'?'conflict':e.code==='42501'?'denied':'invalid',reason:e.message}}}})
 const drawer=(n:number,x=1000+n*120)=>{
  const r:any={contract_version:1,units:'mm',assembly_id:'frame',definitions:[{id:'drawer',primitive:'box',material_ref:null,x_mm:100,y_mm:80,z_mm:18}],instances:[{id:'drawer'+n,definition_id:'drawer',placement:at(x)}],views:['front']}
  const plan=parameterPlan(r)
  return {definitions:{upsert:r.definitions,remove:[]},instances:{upsert:r.instances,remove:[]},nodes:{upsert:plan.nodes,remove:[]},bindings:{upsert:plan.bindings,remove:[]},
   materials:{upsert:[pin('drawer')],remove:[]},roles:{upsert:[{instance_id:'drawer'+n,role:'unknown',quantity_policy:'unknown',reason:'Synthetic drawer volume; role not established'}],remove:[]}}
 }
 const edit=(changes:any,extra:Record<string,unknown>={})=>({key:'k'+randomUUID().slice(0,8),record_id:id,expected_revision:1,change_note:'Add a drawer',request_quote:message,changes,mode:'sketch',...extra})
 const commit=(action:string,extra:Record<string,unknown>={})=>({record_id:id,action,key:action==='commit'||action==='rebase'?'c'+randomUUID().slice(0,8):null,change_note:action==='commit'||action==='rebase'?'Three drawers':null,request_quote:message,...extra})
 const counts=async()=>(await pg.query<any>(`select (select current_revision from bob.artifacts where id=$1) revision,
  (select count(*)::int from bob_private.bob_write_receipts where turn_id=$2 and operation_key like 'construction_edit:%') receipts,
  (select count(*)::int from bob_private.construction_sketches where turn_id=$2) sketches`,[id,turn])).rows[0]

 await t.test('three sketched changes save nothing, are checked whole, and one commit saves them as one revision',async()=>{
  const k=tools()
  assert.equal(k.tools.find(s=>s.function.name==='edit_construction_parts')!.function.parameters.properties.mode.enum.join(),'sketch,save')
  assert(k.tools.some(s=>s.function.name==='commit_construction_sketch'))
  const first=await k.execute('edit_construction_parts',edit(drawer(1)))
  assert.equal(first.status,'sketched',JSON.stringify(first));assert.equal(first.saved,false)
  assert.equal(first.check.status,'checked',JSON.stringify(first.check));assert.equal(first.check.scope,'sketch')
  assert.deepEqual(await counts(),{revision:1,receipts:0,sketches:1},'a sketched change saves no revision and no receipt')
  // Several sketched changes in a row; a later change to drawer1 replaces it.
  assert.equal((await k.execute('edit_construction_parts',edit(drawer(2)))).status,'sketched')
  const moved=await k.execute('edit_construction_parts',edit({instances:{upsert:[{id:'drawer1',definition_id:'drawer',placement:at(1500)}],remove:[]}}))
  assert.equal(moved.status,'sketched',JSON.stringify(moved))
  assert.deepEqual(moved.sketch.collections.instances.upserted,['drawer1','drawer2'])
  assert.deepEqual(await counts(),{revision:1,receipts:0,sketches:1})
  const shown=await k.execute('commit_construction_sketch',commit('read'))
  assert.equal(shown.status,'ok');assert.equal(shown.base_revision,1);assert.equal(shown.changes.instances.upsert.length,2);assert.equal(shown.notes.length,3)
  const saved=await k.execute('commit_construction_sketch',commit('commit'))
  assert.equal(saved.status,'saved',JSON.stringify(saved));assert.equal(saved.receipt.revision,2);assert.equal(saved.sketch.status,'committed')
  assert.deepEqual(await counts(),{revision:2,receipts:1,sketches:0},'one revision, one receipt, the sketch closed')
  const after=await read()
  // The bindings of a placement are saved, so the stored value comes from its node: the earlier x, which the sketched upsert did not rebind.
  assert.deepEqual(after.recipe.instances.map((i:any)=>i.id),['left','right','bottom','drawer1','drawer2'])
  assert.deepEqual((await read(1)).recipe.instances.length,3,'the earlier revision is unchanged')
  assert.equal((await k.execute('commit_construction_sketch',commit('read'))).status,'not_found')
 })

 await t.test('refusals keep the sketch: a different base, an impossible removal, a missing commit key; discard drops it',async()=>{
  const k=tools()
  assert.equal((await k.execute('edit_construction_parts',edit(drawer(3),{expected_revision:2}))).status,'sketched')
  const other=await k.execute('edit_construction_parts',edit(drawer(4),{expected_revision:1}))
  assert.equal(other.status,'conflict');assert.equal(other.reason,'sketch_base_differs');assert.equal(other.base_revision,2);assert.equal(other.sketched,false)
  const nowhere=await k.execute('edit_construction_parts',edit({joints:{upsert:[],remove:['noJoint']}},{expected_revision:2}))
  assert.equal(nowhere.status,'invalid');assert.equal(nowhere.issues[0].code,'remove_missing')
  // A change the server refuses (a joint to a part that does not exist) is not sketched.
  const dangling=await k.execute('edit_construction_parts',edit({joints:{upsert:[{id:'bad',method:'screwed_butt',first:{instance_id:'left',face:'x_max'},second:{instance_id:'ghost',face:'x_min'},reason:'Synthetic'}],remove:[]}},{expected_revision:2}))
  assert.equal(dangling.status,'invalid');assert.match(dangling.message,/your sketch is unchanged/)
  const shown=await k.execute('commit_construction_sketch',commit('read'))
  assert.deepEqual(shown.sketch.collections.instances.upserted,['drawer3'],'only the accepted change is in the sketch')
  const keyless=await k.execute('commit_construction_sketch',{...commit('commit'),key:null})
  assert.equal(keyless.status,'invalid');assert.deepEqual(keyless.validation.fields,['key']);assert.equal(keyless.sketch.status,'kept')
  assert.equal((await counts()).revision,2)
  assert.equal((await k.execute('commit_construction_sketch',commit('discard'))).status,'discarded')
  assert.deepEqual(await counts(),{revision:2,receipts:1,sketches:0})
 })

 await t.test('a construction saved after the sketch began is a conflict at commit; rebase moves the sketch and the commit then saves both',async()=>{
  const k=tools()
  assert.equal((await k.execute('edit_construction_parts',edit(drawer(5),{expected_revision:2}))).status,'sketched')
  const direct=await k.execute('edit_construction_parts',edit(drawer(6),{expected_revision:2,mode:'save'}))
  assert.equal(direct.status,'saved',JSON.stringify(direct));assert.equal(direct.receipt.revision,3)
  const stale=await k.execute('commit_construction_sketch',commit('commit'))
  assert.equal(stale.status,'conflict',JSON.stringify(stale));assert.equal(stale.saved,false);assert.equal(stale.sketch.status,'kept');assert.match(stale.message,/rebase/)
  const rebased=await k.execute('commit_construction_sketch',commit('rebase'))
  assert.equal(rebased.status,'rebased',JSON.stringify(rebased));assert.equal(rebased.base_revision,3);assert.equal(rebased.previous_base_revision,2);assert.equal(rebased.check.status,'checked')
  const saved=await k.execute('commit_construction_sketch',commit('commit'))
  assert.equal(saved.status,'saved',JSON.stringify(saved));assert.equal(saved.receipt.revision,4)
  assert.deepEqual((await read()).recipe.instances.map((i:any)=>i.id).slice(-3),['drawer2','drawer6','drawer5'])
 })

 await t.test('only the claimed caller reaches a sketch; another turn starts empty; a finished job leaves none',async()=>{
  const k=tools()
  const sketched=await k.execute('edit_construction_parts',edit(drawer(7),{expected_revision:4}))
  assert.equal(sketched.status,'sketched')
  assert.equal((await store(stranger).read(id)).status,'unavailable')
  await assert.rejects(rpc(null,'bob.construction_sketch',[...binding,'list',null,null,null],'anon'),/permission denied/)
  await assert.rejects(rpc(null,'bob.construction_sketch',[...binding,'list',null,null,null],'service_role'),/permission denied/)
  const listed=await store().list() as any
  assert.deepEqual(listed.sketches.map((x:any)=>[x.artifact_id,x.base_revision,x.change_count]),[[id,4,sketched.change_count]])
  // A stale CAS put is refused; the same sketch sent again is accepted unchanged.
  const current=await store().read(id) as any
  assert.equal((await store().put(id,current.revision-1,current.sketch)).status,'stored','a lost response retried with the same sketch')
  assert.equal((await store().put(id,current.revision-1,{...current.sketch,notes:['other']})).status,'conflict')
  // A finished job removes its sketches.
  await pg.query(`insert into bob_private.bob_jobs(project_id,actor_id,thread_id,turn_id,worker_url,generation,expires_at) values($1,$2,$3,$4,'http://worker.invalid',$5,now()+interval '1 hour')`,[project,owner,claim.thread_id,turn,claim.generation])
  await pg.query(`update bob_private.bob_jobs set status='completed' where turn_id=$1`,[turn])
  assert.equal((await counts()).sketches,0)
 })

 await t.test('without the pin the edit tool keeps its exact shape and there is no commit tool',async()=>{
  const plain=tools(null as any)
  assert.equal(plain.tools.find(s=>s.function.name==='edit_construction_parts')!.function.parameters.properties.mode,undefined)
  assert(!plain.tools.some(s=>s.function.name==='commit_construction_sketch'))
  assert.equal((await plain.execute('edit_construction_parts',edit(drawer(8),{expected_revision:4}))).status,'invalid','mode is not a field without the pin')
  assert.equal((await plain.execute('commit_construction_sketch',commit('read'))).status,'invalid')
 })

 // bob-lean-writes-v1: the server binds the current target; new constructions are sketched in parts.
 const newStore=()=>createConstructionSketchStore(async(action,key,expected,sketch)=>{
  try{return {data:await rpc(owner,'bob.construction_new_sketch',[...binding,action,key,expected,sketch===null?null:JSON.stringify(sketch)]),error:null}}
  catch(e:any){return {data:null,error:{code:e.code}}}})
 const lean=()=>createConstructionTools({projectId:project,message,writer:writer(),hasAccess:async()=>true,read:(_id,revision)=>read(revision),
  readSources:async()=>({project:new Map(),physical:new Map()}),sketches:store(),newSketches:newStore(),serverTarget:true,constructionViews:true,coherentWork:true,
  readCurrentTarget:async(area)=>(await rpc(owner,'bob.read_design_readiness',[project,area,null,'construction'])).target_revision??null,
  readDesignReadiness:(target:number,purpose:any,area:string|null=null)=>rpc(owner,'bob.read_design_readiness',[project,area,target,purpose]),
  readCatalog:(cid:string,revision:number)=>rpc(owner,'bob.catalog_read',[project,JSON.stringify({action:'read',id:cid,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})]),
  prepareEdit:async p=>{try{return await rpc(owner,'bob.prepare_construction_edit',[...binding,JSON.stringify(p)])}catch(e:any){return {status:e.code==='PT409'?'conflict':e.code==='42501'?'denied':'invalid',reason:e.message}}}})

 await t.test('the server keeps a construction on the current selected target; no target revision is sent or accepted',async()=>{
  const before=await read(),k=lean()
  assert.equal(k.tools.find(s=>s.function.name==='edit_construction_parts')!.function.parameters.properties.target_revision,undefined)
  // The owner reaffirms the selection: a newer target, and this construction is behind it.
  const target=await rpc(owner,'bob.solution_command',[project,'select',solution,before.target_revision,JSON.stringify({solution_revision:1,reason:'Reaffirm the frame'})])
  assert.equal((await read()).source_state,'changed')
  const typed=await k.execute('edit_construction_parts',{...edit(drawer(9),{expected_revision:before.revision,mode:'save'}),target_revision:before.target_revision})
  assert.equal(typed.status,'invalid','a model-supplied target is not a field')
  const saved=await k.execute('edit_construction_parts',edit(drawer(9),{expected_revision:before.revision,mode:'save'}))
  assert.equal(saved.status,'saved',JSON.stringify(saved)+JSON.stringify(await read()).slice(0,300))
  const after=await read()
  assert.equal(after.revision,before.revision+1);assert.equal(after.target_revision,target.revision);assert.equal(after.source_state,'current')
 })

 await t.test('a new construction is sketched in parts under one key, checked whole, and saved once as revision 1',async()=>{
  const k=lean(),artifacts=async()=>Number((await pg.query('select count(*) n from bob.artifacts where project_id=$1',[project])).rows[0].n)
  const before=await artifacts()
  const part=(defs:any[],instances:any[],joints:any[]=[])=>{const r:any={contract_version:1,units:'mm',assembly_id:'shelf',definitions:defs,instances,views:['front']}
   return {recipe:r,parameter_plan:parameterPlan(r),materials:defs.map((d:any)=>pin(d.id)),joints,
    instance_policy:{version:1,instances:instances.map((i:any)=>({instance_id:i.id,role:'build_part',quantity_policy:'manufacture',reason:'Synthetic shelf part'}))}}}
  const side={id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200},board={id:'board',primitive:'box',material_ref:null,x_mm:564,y_mm:80,z_mm:18}
  const call=(p:any,extra:Record<string,unknown>={})=>({key:'shelf',title:'Shelf',description:'Synthetic shelf; no fabrication approval',area_id:null,change_note:'Next parts',
   open_questions:['Hardware unchecked'],request_quote:message,mode:'sketch',...p,...extra})
  const first=await k.execute('save_construction_draft',{...call(part([side],[{id:'left',definition_id:'side',placement:at(0)},{id:'right',definition_id:'side',placement:at(582)}])),record_id:null,expected_revision:0})
  assert.equal(first.status,'sketched',JSON.stringify(first));assert.equal(first.part_count,2);assert.equal(first.check.status,'checked')
  const second=await k.execute('save_construction_draft',{...call(part([board],[{id:'bottom',definition_id:'board',placement:at(18)}],
   [{id:'leftJoint',method:'screwed_butt',first:{instance_id:'left',face:'x_max'},second:{instance_id:'bottom',face:'x_min'},reason:'Synthetic concept'}])),record_id:null,expected_revision:0})
  assert.equal(second.status,'sketched',JSON.stringify(second));assert.equal(second.part_count,3)
  assert.deepEqual(second.sketch.instances,['left','right','bottom'])
  assert.equal(await artifacts(),before,'nothing saved while sketching')
  const shown=await k.execute('commit_construction_sketch',{record_id:null,new_key:'shelf',action:'read',key:null,change_note:null,request_quote:message})
  assert.equal(shown.status,'ok');assert.equal(shown.part_count,3);assert.equal(shown.notes.length,2)
  const both=await k.execute('commit_construction_sketch',{record_id:id,new_key:'shelf',action:'commit',key:'c_both',change_note:'x',request_quote:message})
  assert.equal(both.status,'invalid','either a construction or a new key')
  const saved=await k.execute('commit_construction_sketch',{record_id:null,new_key:'shelf',action:'commit',key:'shelf_c',change_note:'A shelf in three parts',request_quote:message})
  assert.equal(saved.status,'saved',JSON.stringify(saved));assert.equal(saved.receipt.revision,1);assert.equal(saved.sketch.status,'committed')
  assert.equal(await artifacts(),before+1)
  const made=await rpc(owner,'bob.read_construction_draft',[project,saved.receipt.recordId,null,null])
  assert.deepEqual(made.recipe.instances.map((i:any)=>i.id),['left','right','bottom'])
  assert.equal(made.target_revision,(await rpc(owner,'bob.read_design_readiness',[project,null,null,'construction'])).target_revision,'bound to the current target')
  assert.equal(Number((await pg.query('select count(*) n from bob_private.construction_new_sketches where turn_id=$1',[turn])).rows[0].n),0)
  // A sketch of an existing construction cannot start this way.
  const existing=await k.execute('save_construction_draft',{...call(part([side],[{id:'x',definition_id:'side',placement:at(0)}])),record_id:id,expected_revision:(await read()).revision})
  assert.equal(existing.reason,'sketch_existing_construction')
 })

 await t.test('the database catalog and the fixture agree, and the published schemas are the ones code validates',async()=>{
  const manifest=await rpc(null,'shared.resolve_ai_catalog',['bob'],'service_role')
  const live=createAiCatalogSession({rpc:async()=>{throw new Error('Pinned')}},{app:'bob',manifest}),fixture=catalogFixture()
  for(const key of ['tools.edit_construction_parts','tools.commit_construction_sketch']){
   assert.deepEqual(live.definition(key).definition,fixture.definition(key).definition,key)
   assert.deepEqual(live.definition(key).metadata,fixture.definition(key).metadata,key)
  }
  // The toolbox as this publication changes it (other toolbox texts have older, separate histories).
  const added=(d:any)=>({entry:d.catalog.find((c:any)=>c.name==='commit_construction_sketch'),key:d.contract_keys.includes('tools.commit_construction_sketch'),
   shelf:d.shelves[5].tools.at(-1),tools:d.build_workers.structure.tools.at(-1),core:d.build_workers.structure.focus.core,flag:d.construction_sketch_version})
  assert.deepEqual(added(live.definition('bob.tools').definition),added(fixture.definition('bob.tools').definition))
  // bob-lean-writes-v1 (later the same day) moved the pins to version 2 and added server_target / stable_tools.
  assert.deepEqual(['construction_sketch_version','server_target_version','stable_tools_version'].map(k=>live.definition('agent-contract.ask-bob').metadata[k]),[2,1,1])
  const published=fixture.definition('tools.commit_construction_sketch','tool_contract').definition as any
  assert.deepEqual(published.parameters,CONSTRUCTION_SKETCH_COMMIT_TOOL_V2.function.parameters)
  assert.equal(published.description,CONSTRUCTION_SKETCH_COMMIT_TOOL_V2.function.description)
  const editTool=fixture.definition('tools.edit_construction_parts','tool_contract').definition as any
  assert(editTool.description.endsWith(CONSTRUCTION_SKETCH_NOTE));assert.deepEqual(editTool.parameters.properties.mode,{type:'string',enum:['sketch','save']})
  // The production pins together: code validates exactly the published edit, save and commit schemas.
  const production=createConstructionTools({projectId:project,message,writer:writer(),hasAccess:async()=>true,read:(_id,revision)=>read(revision),readSources:async()=>({project:new Map(),physical:new Map()}),
   constructionViews:true,coherentWork:true,constructionText:true,constructionNotes:true,chosenJointFasteners:true,defaultZero:true,constructionRepeats:true,repeatStart:true,formRefinement:true,
   placeIn:async()=>({status:'saved'}),serverTarget:true,sketches:store(),newSketches:store()})
  for(const name of ['edit_construction_parts','save_construction_draft','commit_construction_sketch'])
   assert.deepEqual(production.tools.find(s=>s.function.name===name)!.function.parameters,(fixture.definition('tools.'+name,'tool_contract').definition as any).parameters,name)
  const save=fixture.definition('tools.save_construction_draft','tool_contract').definition as any
  assert(save.description.endsWith(CONSTRUCTION_NEW_SKETCH_NOTE));assert.equal(save.parameters.properties.target_revision,undefined)
  assert.equal(editTool.parameters.properties.target_revision,undefined)
  const box=fixture.definition('bob.tools','tool_contract').definition as any
  assert(box.build_workers.structure.focus.core.includes('commit_construction_sketch'));assert(box.shelves[5].tools.includes('commit_construction_sketch'))
  const policy=(await pg.query<any>(`select schema_version,active from bob.tool_catalog where name='commit_construction_sketch'`)).rows
  assert.deepEqual(policy,[{schema_version:1,active:true}])
 })
})
