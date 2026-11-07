import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from './support/pglite.ts'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createConstructionSketchStore} from '../supabase/functions/_shared/construction-sketch.ts'

// Owner review 2026-11-07 (scenario "Entrén"): Konrad builds from a concept
// model with several components one part at a time, and is not stopped
// because the rest of the concept is not built yet. Entry turn, 09:04-09:30:
// a partial wall was refused as changed geometry, and a save without its
// concept mapping as missing every component; then the whole wall did not
// fit one 120 s answer.
let pg:PGlite,owner:string
const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
 (await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;
   create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 })
 owner=randomUUID();await pg.query('insert into auth.users values($1,$2,now())',[owner,'stepwise@test.invalid'])
})
after(()=>pg.close())

test('a component is sketched part by part: unfinished is pending, an early save is refused, the finished construction saves once',async()=>{
 const project=(await call(owner,'bob.create_project',[{name:'Stepwise'}])).id,solution=randomUUID(),turn=randomUUID(),message='Bygg ramen stegvis, en skena i taget.'
 const {intent,recipe,refinement}=constructionFormFixture()
 await call(owner,'bob.solution_command',[project,'create',solution,0,{title:'Ram',description:'Syntetisk',assumptions:'Ej mätt',tradeoffs:'Ej godkänd',measurements:[],design_intent:intent}])
 const target=await call(owner,'bob.solution_command',[project,'select',solution,0,{solution_revision:1,reason:'Fixture'}])
 const c=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role'),binding=[project,c.thread_id,turn,c.generation]
 const write=(p:unknown)=>call(owner,'bob.bob_project_write_v17',[...binding,p])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const store=(fn:string)=>createConstructionSketchStore(async(action,key,expected,sketch)=>{
  try{return {data:await call(owner,'bob.'+fn,[...binding,action,key,expected,sketch===null?null:JSON.stringify(sketch)]),error:null}}catch(e:any){return {data:null,error:{code:e.code}}}})
 const k=createConstructionTools({projectId:project,message,hasAccess:async()=>true,formRefinement:true,serverTarget:true,sketches:store('construction_sketch'),newSketches:store('construction_new_sketch'),
  writer:createProjectWriter(project,message,async p=>{try{return {data:await write(p),error:null}}catch(e:any){return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null})),
  read:(id,revision)=>call(owner,'bob.read_construction_draft',[project,id,revision,null]),readSources:async()=>({project:new Map(),physical:new Map()}),
  readCurrentTarget:async area=>(await call(owner,'bob.read_design_readiness',[project,area,null,'construction'])).target_revision??null,
  readConstructionReadiness:(t,area,r)=>call(owner,'bob.read_construction_readiness',[project,area,t,r]),
  readCatalog:(id,revision)=>call(owner,'bob.catalog_read',[project,{action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}])})
 const artifacts=async()=>Number((await pg.query('select count(*) n from bob.artifacts where project_id=$1',[project])).rows[0].n)
 const piece=(ids:string[])=>{const r={...recipe,instances:recipe.instances.filter((i:any)=>ids.includes(i.id))}
  return {key:'ram',record_id:null,expected_revision:0,title:'Ram',description:'Syntetisk ram',area_id:null,change_note:'Nästa skena',open_questions:[],request_quote:message,mode:'sketch',
   recipe:r,parameter_plan:parameterPlan(r),materials:[{definition_id:'rail',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],
   instance_policy:{version:1,instances:ids.map(id=>({instance_id:id,role:'build_part',quantity_policy:'manufacture',reason:'Syntetisk skena'}))},
   form_refinement:{...refinement,mappings:[{component_id:'frame',instance_ids:ids}]}}}
 const before=await artifacts()

 const first=await k.execute('save_construction_draft',piece(['left']))
 assert.equal(first.status,'sketched',JSON.stringify(first))
 assert.deepEqual(first.pending.map((p:any)=>[p.code,p.ids]),[['form_envelope_incomplete',['frame']]],'the half-built frame is pending, not refused')
 // A part outside the frame's envelope is still refused while sketching.
 const outside=piece(['left']);outside.recipe.instances=[{id:'left',definition_id:'rail',placement:{x:900,y:0,z:0,rx:0,ry:0,rz:0}}];outside.parameter_plan=parameterPlan(outside.recipe)
 const wrong=await k.execute("save_construction_draft",outside)
 assert.equal(wrong.status,'needs_data');assert.equal(wrong.issues[0].code,'concept_geometry_changed')
 // Saving the half-built frame applies the full rule.
 const early=await k.execute("commit_construction_sketch",{record_id:null,new_key:'ram',action:'commit',key:'ram_early',change_note:'För tidigt',request_quote:message})
 assert.equal(early.status,'needs_data');assert.equal(early.sketch.status,'kept');assert.equal(await artifacts(),before)

 const second=await k.execute('save_construction_draft',piece(['left','right']))
 assert.equal(second.status,'sketched',JSON.stringify(second));assert.equal(second.pending,undefined,'the frame is complete')
 const saved=await k.execute('commit_construction_sketch',{record_id:null,new_key:'ram',action:'commit',key:'ram_c',change_note:'Ramen i två skenor',request_quote:message})
 assert.equal(saved.status,'saved',JSON.stringify(saved));assert.equal(saved.receipt.revision,1);assert.equal(await artifacts(),before+1)
 const made=await call(owner,'bob.read_construction_draft',[project,saved.receipt.recordId,null,null])
 assert.deepEqual(made.recipe.instances.map((i:any)=>i.id),['left','right']);assert.equal(made.target_revision,target.revision)
})
