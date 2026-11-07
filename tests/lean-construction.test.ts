import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from './support/pglite.ts'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createConstructionSketchStore} from '../supabase/functions/_shared/construction-sketch.ts'
import {ruleJointId} from '../supabase/functions/_shared/construction-joint-rules.ts'

// Owner decision 2026-11-07 (lean_construction_version 1), scenario "Entrén":
// Konrad writes a frame with formulas and one joint rule, adds a part with a
// part edit (the edit that was refused twice live with form_instance_unmapped),
// and a refused write stays in the sketch so only the correction is sent again.
let pg:PGlite,owner:string
const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
 (await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;
   create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 })
 owner=randomUUID();await pg.query('insert into auth.users values($1,$2,now())',[owner,'lean@test.invalid'])
})
after(()=>pg.close())

async function setup(message:string){
 const project=(await call(owner,'bob.create_project',[{name:'Lean'}])).id,solution=randomUUID(),turn=randomUUID()
 const {intent}=constructionFormFixture()
 await call(owner,'bob.solution_command',[project,'create',solution,0,{title:'Ram',description:'Syntetisk',assumptions:'Ej mätt',tradeoffs:'Ej godkänd',measurements:[],design_intent:intent}])
 await call(owner,'bob.solution_command',[project,'select',solution,0,{solution_revision:1,reason:'Fixture'}])
 const c=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role'),binding=[project,c.thread_id,turn,c.generation]
 const write=(p:unknown)=>call(owner,'bob.bob_project_write_v16',[...binding,p])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const store=(fn:string)=>createConstructionSketchStore(async(action,key,expected,sketch)=>{
  try{return {data:await call(owner,'bob.'+fn,[...binding,action,key,expected,sketch===null?null:JSON.stringify(sketch)]),error:null}}catch(e:any){return {data:null,error:{code:e.code}}}})
 const tools=createConstructionTools({projectId:project,message,hasAccess:async()=>true,formRefinement:true,serverTarget:true,defaultZero:true,chosenJointFasteners:true,leanConstruction:true,
  sketches:store('construction_sketch'),newSketches:store('construction_new_sketch'),
  writer:createProjectWriter(project,message,async p=>{try{return {data:await write(p),error:null}}catch(e:any){return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null})),
  read:(id,revision)=>call(owner,'bob.read_construction_draft',[project,id,revision,null]),readSources:async()=>({project:new Map(),physical:new Map()}),
  readCurrentTarget:async area=>(await call(owner,'bob.read_design_readiness',[project,area,null,'construction'])).target_revision??null,
  readConstructionReadiness:(t,area,r)=>call(owner,'bob.read_construction_readiness',[project,area,t,r]),
  readCatalog:(id,revision)=>call(owner,'bob.catalog_read',[project,{action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}]),
  prepareEdit:async p=>{try{return await call(owner,'bob.prepare_construction_edit',[...binding,JSON.stringify(p)])}catch(e:any){return {status:e.code==='PT409'?'conflict':e.code==='42501'?'denied':'invalid',reason:e.message}}}})
 return {project,tools,material:material.recordId as string,read:(id:string,revision:number|null=null)=>call(owner,'bob.read_construction_draft',[project,id,revision,null])}
}
const decision=(id:string,value:number,reason:string)=>({id,role:'decision',value,unit:'mm',reason})
const at=(x:unknown,y:unknown=0)=>({x,y,z:0,rx:0,ry:0,rz:0})
const rule={id:'horn',between:['rail','cross'],reason:'Tvärslån limmas och skruvas mot sidoslån.',fasteners:[]}
const role=(id:string)=>({instance_id:id,role:'build_part',quantity_policy:'manufacture',reason:'Syntetisk del'})
function frameSave(message:string,material:string){
 return {key:'ram',record_id:null,expected_revision:0,title:'Ram',description:'Syntetisk ram',area_id:null,change_note:'Ramen',open_questions:[],request_quote:message,mode:'save',
  recipe:{contract_version:1,units:'mm',assembly_id:'frame',views:['front','top'],
   definitions:[{id:'rail',primitive:'box',material_ref:null,x_mm:'w',y_mm:'depth',z_mm:'w'},{id:'cross',primitive:'box',material_ref:null,x_mm:'span - w - w',y_mm:'w',z_mm:'w'}],
   instances:[{id:'left',definition_id:'rail',placement:at(0)},{id:'right',definition_id:'rail',placement:at('span - w')},{id:'front',definition_id:'cross',placement:at('w')}]},
  parameter_plan:{version:1,frames:[],nodes:[decision('w',18,'Virkets tjocklek.'),decision('depth',400,'Ramens djup enligt konceptet.'),decision('span',600,'Ramens bredd enligt konceptet.')],bindings:[]},
  materials:['rail','cross'].map(d=>({definition_id:d,material_id:material,material_revision:1,part_id:null,part_revision:null})),joints:[],
  instance_policy:{version:1,instances:['left','right','front'].map(role)},
  // Only the first part is mapped; code maps the rest by the frame envelope.
  form_refinement:{version:1,mappings:[{component_id:'frame',instance_ids:['left']}]},joint_rules:[rule]}
}

test('a frame written with formulas and one joint rule saves the same graph, its joints and a completed mapping',async()=>{
 const message='Bygg ramen med formler.',{tools,material,read}=await setup(message)
 const saved=await tools.execute('save_construction_draft',frameSave(message,material))
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 const draft=await read(saved.receipt.recordId)
 assert.deepEqual(draft.recipe.instances.map((i:any)=>[i.id,i.placement.x]),[['left',0],['right',582],['front',18]])
 assert.deepEqual(draft.recipe.definitions.map((d:any)=>[d.id,d.x_mm]),[['rail',18],['cross',564]])
 assert.ok(draft.parameters.nodes.some((n:any)=>n.id.startsWith('fx.')),'formula nodes are saved like any derived node')
 assert.deepEqual(draft.joints.map((j:any)=>j.id).sort(),[ruleJointId('front','left'),ruleJointId('front','right')].sort())
 assert.deepEqual(draft.joints.find((j:any)=>j.id===ruleJointId('front','left')).first,{instance_id:'left',face:'x_max'})
 assert.deepEqual(draft.form_refinement.mappings,[{component_id:'frame',instance_ids:['left','right','front']}])
})

test('a part edit adds a part by formula: its joints come from the rule and the mapping follows, where it was refused live',async()=>{
 const message='Lägg till en bakre slå.',{tools,material,read}=await setup(message)
 const id=(await tools.execute('save_construction_draft',{...frameSave(message,material),request_quote:message})).receipt.recordId
 const edit=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'bak',change_note:'Bakre tvärslå',request_quote:message,mode:'save',
  changes:{instances:{upsert:[{id:'back',definition_id:'cross',placement:at('w','depth - w')}],remove:[]},roles:{upsert:[role('back')],remove:[]}},joint_rules:[rule],form_assign:[]})
 assert.equal(edit.status,'saved',JSON.stringify(edit))
 const draft=await read(id)
 assert.equal(draft.revision,2)
 assert.deepEqual(draft.recipe.instances.find((i:any)=>i.id==='back').placement.y,382)
 assert.equal(draft.joints.length,4,JSON.stringify(draft.joints.map((j:any)=>j.id)))
 assert.deepEqual(draft.form_refinement.mappings[0].instance_ids,['left','right','front','back'])
})

test('a refused part edit stays in the sketch: send only the correction, then commit; refused text is checked again at commit',async()=>{
 const message='Lägg till en slå utanför och rätta den.',{tools,material,read}=await setup(message)
 const id=(await tools.execute('save_construction_draft',{...frameSave(message,material),request_quote:message})).receipt.recordId
 // Outside every concept component: refused, and kept.
 const outside=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'ute',change_note:'Extra slå',request_quote:message,mode:'save',
  changes:{instances:{upsert:[{id:'extra',definition_id:'cross',placement:at('span')}],remove:[]},roles:{upsert:[role('extra')],remove:[]}},joint_rules:[],form_assign:[]})
 assert.equal(outside.status,'needs_data',JSON.stringify(outside))
 assert.equal(outside.sketch?.status,'kept_with_issues',JSON.stringify(outside))
 assert.equal((await read(id)).revision,1,'nothing saved')
 // Only the correction: move it inside.
 const moved=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'ute2',change_note:'Flytta in',request_quote:message,mode:'sketch',
  changes:{instances:{upsert:[{id:'extra',definition_id:'cross',placement:at('w','depth - w')}],remove:[]}},joint_rules:[{...rule,reason:'Se save_construction_draft'}],form_assign:[]})
 assert.equal(moved.status,'invalid',JSON.stringify(moved));assert.equal(moved.validation?.code,'human_text')
 assert.equal(moved.sketch?.status,'kept',JSON.stringify(moved))
 const early=await tools.execute('commit_construction_sketch',{record_id:id,new_key:null,action:'commit',key:'c1',change_note:'Spara',request_quote:message})
 assert.equal(early.status,'invalid');assert.equal(early.validation?.code,'human_text','the kept text is checked at commit')
 const text=await tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key:'ute3',change_note:'Rätt text',request_quote:message,mode:'sketch',
  changes:{},joint_rules:[rule],form_assign:[]})
 assert.equal(text.status,'sketched',JSON.stringify(text))
 const saved=await tools.execute('commit_construction_sketch',{record_id:id,new_key:null,action:'commit',key:'c2',change_note:'Spara',request_quote:message})
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 const draft=await read(id)
 assert.equal(draft.revision,2);assert.equal(draft.joints.length,4)
})

test('a refused new save is kept under its key, and a saved construction can be revised whole in a keyed sketch',async()=>{
 const message='Spara ramen, rätta formeln och revidera.',{tools,material,read}=await setup(message)
 const bad=frameSave(message,material) as any;bad.recipe.instances[1].placement.x='span - ghost'
 const refused=await tools.execute('save_construction_draft',bad)
 assert.equal(refused.status,'invalid');assert.equal(refused.issues[0].path,'instances/right/placement/x')
 assert.equal(refused.sketch?.status,'kept_with_issues',JSON.stringify(refused))
 // Only the corrected part, same key.
 const fixed=await tools.execute('save_construction_draft',{...frameSave(message,material),recipe:{...frameSave(message,material).recipe,definitions:[],instances:[{id:'right',definition_id:'rail',placement:at('span - w')}]},
  parameter_plan:{version:1,frames:[],nodes:[decision('w',18,'Virkets tjocklek.')],bindings:[]},materials:[],instance_policy:{version:1,instances:[]},joint_rules:[],mode:'sketch'})
 assert.equal(fixed.status,'sketched',JSON.stringify(fixed))
 const saved=await tools.execute('commit_construction_sketch',{record_id:null,new_key:'ram',action:'commit',key:'ram_c',change_note:'Ramen',request_quote:message})
 assert.equal(saved.status,'saved',JSON.stringify(saved))
 const id=saved.receipt.recordId
 assert.equal((await read(id)).joints.length,2,'the rule from the first call is kept in the sketch')
 // A whole revision of the saved frame, sketched by key (refused live as sketch_existing_construction).
 const revision={...frameSave(message,material),key:'ram2',record_id:id,expected_revision:1,mode:'sketch',description:'Ram med bredare tvärslå',joint_rules:[]}
 const sketched=await tools.execute('save_construction_draft',revision)
 assert.equal(sketched.status,'sketched',JSON.stringify(sketched))
 const committed=await tools.execute('commit_construction_sketch',{record_id:id,new_key:'ram2',action:'commit',key:'ram2_c',change_note:'Ny beskrivning',request_quote:message})
 assert.equal(committed.status,'saved',JSON.stringify(committed))
 const draft=await read(id)
 assert.equal(draft.revision,2);assert.equal(draft.description,'Ram med bredare tvärslå')
})
