// Deep audit 2026-11-08 (owner decision: a save names its target): the lean
// construction tools composed with the real worker-operations binding
// (published bindings, stable refs), as bob-tools.ts wires them. Before, a
// second new construction in one Konrad job was committed over the first.
import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from './support/pglite.ts'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createConstructionSketchStore} from '../supabase/functions/_shared/construction-sketch.ts'
import {createWorkerOperations} from '../supabase/functions/_shared/worker-operations.ts'

let pg:PGlite,owner:string
const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
 (await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;
   create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 })
 owner=randomUUID();await pg.query('insert into auth.users values($1,$2,now())',[owner,'lean-path@test.invalid'])
})
after(()=>pg.close())
const bindings=(catalogFixture().definition('bob.tools') as any).definition.worker_operation_bindings
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
 const newSketches=store('construction_new_sketch')
 const tools=createConstructionTools({projectId:project,message,hasAccess:async()=>true,formRefinement:true,serverTarget:true,defaultZero:true,chosenJointFasteners:true,leanConstruction:true,
  sketches:store('construction_sketch'),newSketches,
  writer:createProjectWriter(project,message,async p=>{try{return {data:await write(p),error:null}}catch(e:any){return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null})),
  read:(id,revision)=>call(owner,'bob.read_construction_draft',[project,id,revision,null]),readSources:async()=>({project:new Map(),physical:new Map()}),
  readCurrentTarget:async area=>(await call(owner,'bob.read_design_readiness',[project,area,null,'construction'])).target_revision??null,
  readConstructionReadiness:(t,area,r)=>call(owner,'bob.read_construction_readiness',[project,area,t,r]),
  readCatalog:(id,revision)=>call(owner,'bob.catalog_read',[project,{action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}]),
  prepareEdit:async p=>{try{return await call(owner,'bob.prepare_construction_edit',[...binding,JSON.stringify(p)])}catch(e:any){return {status:e.code==='PT409'?'conflict':e.code==='42501'?'denied':'invalid',reason:e.message}}}})
 // The job's operation scope, as ask-openai.ts builds it (operation paths v2, stable refs).
 const ops=createWorkerOperations({version:2,bindings,stableRefs:true,explicitSaveTarget:true,projectId:project,hasAccess:async()=>true,
  load:async()=>({status:'ready',source:null,entries:[]}),validateMany:async()=>true,prepareDrawing:async()=>({}),drawingArguments:()=>null,drawingWork:()=>undefined})
 await ops.prepare('structure',[])
 // bob-tools.ts:281-284: before() binds identity, the handler runs, observe() records the receipt.
 const run=async(name:string,raw:Record<string,unknown>)=>{
  const p=await ops.before('structure',name,raw);if(p.status!=='ready')return p
  return ops.observe('structure',name,p.args!,await tools.execute(name,p.args!))
 }
 const constructions=async()=>(await pg.query(`select id,title,revision from bob.current_artifacts where project_id=$1 and not archived order by title`,[project])).rows
 return {project,run,material:material.recordId as string,constructions,newSketches}
}
const decision=(id:string,value:number,reason:string)=>({id,role:'decision',value,unit:'mm',reason})
const at=(x:unknown,y:unknown=0)=>({x,y,z:0,rx:0,ry:0,rz:0})
const rule={id:'horn',between:['rail','cross'],reason:'Tvärslån limmas och skruvas mot sidoslån.',fasteners:[],except:[]}
const bare=(id:string)=>({instance_id:id,role:'build_part',reason:'Syntetisk del'})
// What the model sends: no record_id/expected_revision (hidden), source_ref null.
function frame(message:string,material:string,key:string,title:string,mode='sketch'){
 return {key,source_ref:null,title,description:'Syntetisk ram',area_id:null,change_note:'Ramen',open_questions:[],request_quote:message,mode,
  recipe:{contract_version:1,units:'mm',assembly_id:'frame',views:['front','top'],
   definitions:[{id:'rail',primitive:'box',material_ref:null,x_mm:'w',y_mm:'depth',z_mm:'w'},{id:'cross',primitive:'box',material_ref:null,x_mm:'span - w - w',y_mm:'w',z_mm:'w'}],
   instances:[{id:'left',definition_id:'rail',placement:at(0)},{id:'right',definition_id:'rail',placement:at('span - w')},{id:'front',definition_id:'cross',placement:at('w')}]},
  parameter_plan:{version:1,frames:[],nodes:[decision('w',18,'Virkets tjocklek.'),decision('depth',400,'Ramens djup enligt konceptet.'),decision('span',600,'Ramens bredd enligt konceptet.')],bindings:[]},
  materials:['rail','cross'].map(d=>({definition_id:d,material_id:material,material_revision:1,part_id:null,part_revision:null})),joints:[],
  instance_policy:{version:1,instances:['left','right','front'].map(bare)},
  form_refinement:{version:1,mappings:[{component_id:'frame',instance_ids:['left']}]},joint_rules:[rule]}
}

test('a second new construction in one job is saved as new, not over the first',async()=>{
 const message='Bygg ram A och sedan ram B.',{run,material,constructions}=await setup(message)
 assert.equal((await run('save_construction_draft',frame(message,material,'a','Ram A'))).status,'sketched')
 const a=await run('commit_construction_sketch',{source_ref:null,new_key:'a',action:'commit',key:'a_c',change_note:'Ram A',request_quote:message})
 assert.equal(a.status,'saved',JSON.stringify(a))
 // B with source_ref null: a new construction, and the sketch says so.
 const b=await run('save_construction_draft',frame(message,material,'b','Ram B'))
 assert.equal(b.status,'sketched',JSON.stringify(b));assert.equal(b.revises,null)
 const bc=await run('commit_construction_sketch',{source_ref:null,new_key:'b',action:'commit',key:'b_c',change_note:'Ram B',request_quote:message})
 assert.equal(bc.status,'saved',JSON.stringify(bc));assert.equal(bc.receipt.operation,'created')
 assert.deepEqual((await constructions()).map((r:any)=>[r.title,r.revision]),[['Ram A',1],['Ram B',1]])
})
