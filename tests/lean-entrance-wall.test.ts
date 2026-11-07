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
import wall from './fixtures/entrance-wall-construction.json' with {type:'json'}

// Audit 4 (owner, 2026-11-07): the real entry wall, saved live in the old
// format, written again in the lean format (formulas, seven joint rules, the
// mapping left to code). Both go through the same tools and database; the
// saved geometry, joints, roles and mapping must be the same, also after a
// measure changes. Then the part edit refused live (form_instance_unmapped).
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

async function setup(message:string,intent:unknown){
 const project=(await call(owner,'bob.create_project',[{name:'Entrén'}])).id,solution=randomUUID(),turn=randomUUID()
 await call(owner,'bob.solution_command',[project,'create',solution,0,{title:'Ram',description:'Entréns vänstra vägg',assumptions:'Ej mätt',tradeoffs:'Ej godkänd',measurements:[],design_intent:intent}])
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

/** The concept: one wall component, its envelope exactly the saved wall. */
function wallIntent(){
 const {intent}=constructionFormFixture() as any
 const at=[25,120,300],size=[95,2530,2176]
 const node=(id:string,value:number)=>({id,role:'decision',unit:'mm',reason:'Väggens plats i konceptet.',value})
 const wallLeft={id:'wall_left',label:'Vänster vägg',kind:'solid',active:true,features:['frame'],choices:['frame_design'],
  position:at.map((_,k)=>`wall_left_p${k}`),size:size.map((_,k)=>`wall_left_s${k}`)}
 intent.features=intent.features.filter((f:any)=>f.id==='frame')
 intent.choices=intent.choices.filter((c:any)=>c.id==='frame_design')
 intent.model={...intent.model,nodes:[...at.map((v,k)=>node(`wall_left_p${k}`,v)),...size.map((v,k)=>node(`wall_left_s${k}`,v))],components:[wallLeft]}
 return intent
}
const message='Bygg entréns vänstra vägg.'
const payload=(key:string,form:any,material:string)=>({key,record_id:null,expected_revision:0,area_id:null,change_note:'Vänster vägg',request_quote:message,mode:'save',
 ...structuredClone(form),materials:wall.definitions.map(d=>({definition_id:d,material_id:material,material_revision:1,part_id:null,part_revision:null}))})
const pairs=(joints:any[])=>joints.map(j=>[j.first.instance_id+'.'+j.first.face,j.second.instance_id+'.'+j.second.face].sort().join(' + ')).sort()
const roles=(draft:any)=>draft.instance_policy.instances.map((r:any)=>[r.instance_id,r.role,r.quantity_policy])
const mapping=(draft:any)=>draft.form_refinement.mappings.map((m:any)=>[m.component_id,[...m.instance_ids].sort()])

test('the entry wall saves the same in the old and the lean format, also after a measure changes; a part added by edit is joined and mapped',async()=>{
 const {tools,material,read}=await setup(message,wallIntent())
 const old=await tools.execute('save_construction_draft',payload('gammal',wall.old,material))
 assert.equal(old.status,'saved',JSON.stringify(old))
 const lean=await tools.execute('save_construction_draft',payload('lean',wall.lean,material))
 assert.equal(lean.status,'saved',JSON.stringify(lean))
 assert.equal(lean.rule_joints.length,21,'seven rules write the 21 joints')
 const a=await read(old.receipt.recordId),b=await read(lean.receipt.recordId)
 assert.deepEqual(b.recipe,a.recipe,'same geometry')
 assert.deepEqual(pairs(b.joints),pairs(a.joints),'same joints, same faces')
 assert.deepEqual(roles(b),roles(a),'same roles; quantity_policy follows from the role')
 assert.deepEqual(mapping(b),mapping(a),'code completed the same mapping')
 // A measure changes inside the concept's envelope: the window's width.
 const lower=(id:string,key:string)=>tools.execute('edit_construction_parts',{record_id:id,expected_revision:1,key,change_note:'Smalare fönster',request_quote:message,mode:'save',
  changes:{nodes:{upsert:[{id:'win_w',role:'decision',unit:'mm',value:1000,reason:'Fönstret blir 100 cm brett.'}],remove:[]}},joint_rules:[],form_assign:[]})
 const oldLow=await lower(old.receipt.recordId,'gammal_h'),leanLow=await lower(lean.receipt.recordId,'lean_h')
 assert.equal(oldLow.status,'saved',JSON.stringify(oldLow));assert.equal(leanLow.status,'saved',JSON.stringify(leanLow))
 const a2=await read(old.receipt.recordId),b2=await read(lean.receipt.recordId)
 assert.deepEqual(b2.recipe,a2.recipe,'same geometry after the change')
 assert.notDeepEqual(b2.recipe,b.recipe,'the change moved the wall')
 assert.deepEqual(pairs(b2.joints),pairs(a2.joints),'joints followed the parts')
 // The edit refused twice live: a part added without naming its component.
 const stud=wall.lean.recipe.instances.find((i:any)=>i.id==='lw_s1')!
 const added=await tools.execute('edit_construction_parts',{record_id:lean.receipt.recordId,expected_revision:2,key:'lean_s3',change_note:'Mittregel',request_quote:message,mode:'save',
  changes:{nodes:{upsert:[{id:'s3_y',role:'decision',unit:'mm',value:2315,reason:'Mittregel i fältet mellan kortlingen och hörnet.'}],remove:[]},
   instances:{upsert:[{...structuredClone(stud),id:'lw_s3',placement:{...stud.placement,y:'s3_y'}}],remove:[]},
   roles:{upsert:[{instance_id:'lw_s3',role:'build_part',reason:'Ny mittregel, kapas av 45×95.'}],remove:[]}},
  joint_rules:wall.lean.joint_rules.filter((r:any)=>r.id==='sw_plate_sw_stud'),form_assign:[]})
 assert.equal(added.status,'saved',JSON.stringify(added))
 assert.deepEqual(added.rule_joints.map((j:any)=>j.id).sort(),[ruleJointId('lw_s3','lw_syll'),ruleJointId('lw_s3','lw_top')].sort())
 const b3=await read(lean.receipt.recordId)
 assert.ok(mapping(b3)[0][1].includes('lw_s3'),'code mapped the new part to the wall')
 assert.equal(b3.joints.length,23)
})
