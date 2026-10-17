import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {cutPlanFixture} from './support/cut-plan-fixture.ts'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import {createDrawingRequestStore} from '../supabase/functions/_shared/drawing-request-store.ts'
import {checkedConstructionForDrawing} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'

test('stalled request renews the same source identity through caller reads, checked CAD, atomic save and exact readback',async t=>{
 const f=await cutPlanFixture(t),id=randomUUID(),binding={p_project:f.project,p_thread:f.claim.thread_id,p_turn:f.turn,p_generation:f.claim.generation}
 const scope={area_id:null,component_id:null,step_id:null,artifact_id:f.construction.recordId},aiCatalog=catalogFixture()
 const privateCall=(args:any)=>f.rpc('bob.bob_drawing_request',[f.project,f.user,f.claim.thread_id,f.turn,f.claim.generation,args.p_operation,args.p_id??null,args.p_expected??0,args.p_status??null,args.p_payload?JSON.stringify(args.p_payload):null,args.p_write_key??randomUUID()],null,'service_role')
 await f.rpc('bob.create_drawing_request',[f.project,f.claim.thread_id,f.turn,f.claim.generation,id,JSON.stringify(scope)])
 const old=await privateCall({p_operation:'save',p_id:id,p_expected:0,p_status:'needs_data',p_payload:{brief:{...scope,brief:'Draw the exact saved concept',handoff,construction_revision:1},owner_request:f.message,reference_refs:[]}})
 const before=await f.rpc('bob.read_construction_draft',[f.project,f.construction.recordId,1,null])
 // An ordinary role write changes only the same saved construction's policy.
 const role={...f.base,kind:'construction_roles',record_id:f.construction.recordId,expected_revision:1,request_quote:f.message,data:{key:'renew-role',changes:[{instance_id:'back',role:'existing_part',quantity_policy:'retain',reason:'Explicit synthetic retained member'}],change_note:'Keep the existing upright',computed:null}}
 assert.equal((await f.rpc('bob.bob_project_write_v16',[f.project,f.claim.thread_id,f.turn,f.claim.generation,JSON.stringify(role)])).revision,2)
 const read=(artifact:string,revision:number|null)=>f.rpc('bob.read_construction_draft',[f.project,artifact,revision,null])
 const sourceOptions={projectId:f.project,message:f.message,hasAccess:async()=>true,read:(artifact:string|null,revision:number|null)=>read(artifact!,revision),
  readCatalog:(id:string,revision:number)=>f.rpc('bob.catalog_read',[f.project,JSON.stringify({action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})]),
  readSources:async()=>({project:new Map(),physical:new Map()})}
 assert.equal((await checkedConstructionForDrawing(sourceOptions,f.construction.recordId,2)).status,'ready')
 const store=createDrawingRequestStore({aiCatalog,projectId:f.project,binding,privateCall,newId:async()=>{throw Error('must reuse the existing request')},
  caller:(name,args)=>f.rpc('bob.'+name,Object.values(args))})
 let renders=0,reviews=0
 const assistant=createCadAssistant({aiCatalog,allowSourceRenewal:true,research:false,projectId:f.project,userId:f.user,ownerRequest:f.message,requestStore:store,available:true,deadline:Date.now()+120000,hasAccess:async()=>true,
  readArtifact:async(id,revision)=>({...await read(id,revision),source_kind:'construction'}),checkConstruction:(id,revision)=>checkedConstructionForDrawing(sourceOptions,id,revision),
  readDesignReadiness:(target,purpose,area)=>f.rpc('bob.read_design_readiness',[f.project,area??null,target,purpose]),
  makeLookup:()=>createProjectLookup(f.project,async(_p,i)=>({data:await f.rpc('bob.search_bob_project_data_v8',[f.project,i.dataset,i.query,i.status,i.area_id,i.record_id,i.after_id??null]),error:null}),1000,100),
  render:async(recipe,source,guard)=>{
   await guard?.();renders++;assert.deepEqual(source,{artifact_id:f.construction.recordId,revision:2})
   const checked=await checkedConstructionForDrawing(sourceOptions,f.construction.recordId,2)
   return {recipe,manifest:{assembly_id:recipe.assembly_id,engine:{name:'build123d'},drawing_source:source!,bounding_box_mm:checked.checked.bounds_mm,checks:{collisions:{status:'complete',overlaps:[]}},annotations:{version:1,coverage:'complete'}},files:{front:'PHN2Zy8+'},previews:Object.fromEntries(recipe.views.map(v=>[v,'Zml4dHVyZQ==']))}
  },
  callModel:async(o,guard)=>{
   await guard?.();reviews++;assert.equal(o.aiFunction,'cad-reviewer')
   const ids=o.catalogSchemaParameters!.requirement_ids as string[]
   return {...reviewReply(),data:JSON.stringify({verdict:'pass',summary:'Synthetic independent review',requirements:ids.map(id=>({id,status:'met',evidence:'Synthetic checked fixture'})),issues:[]})}
  },
 })
 const result=await assistant.consult({...scope,request_id:id,brief:'Render the corrected same construction',handoff:null,requirement_changes:[],construction_revision:2})
 assert.equal(result.status,'ready',JSON.stringify(result));assert.equal(result.request_id,id);assert.equal(renders,1);assert.equal(reviews,1)
 const candidate=assistant.candidate!
 assert.equal(candidate.drawing_request!.id,id)
 const receipt=await f.rpc('bob.bob_project_write_v16',[f.project,f.claim.thread_id,f.turn,f.claim.generation,JSON.stringify({...f.base,kind:'cad',request_quote:f.message,data:candidate})])
 const back=await f.rpc('bob.read_cad_artifact',[f.project,receipt.recordId,receipt.revision])
 assert.deepEqual(back.construction_source,{project_id:f.project,artifact_id:f.construction.recordId,revision:2})
 const publicRequest=(await f.rpc('bob.project_drawing_requests',[f.project,id,null])).requests[0]
 assert.equal(publicRequest.id,id);assert.equal(publicRequest.status,'saved');assert.equal(publicRequest.artifact_id,receipt.recordId)
 const packet=(await f.pg.query('select payload from bob_private.drawing_requests where id=$1',[id])).rows[0].payload as any
 assert.deepEqual(packet.brief.handoff,old.payload.brief.handoff);assert.equal(packet.brief.construction_revision,2)
 const historical=await f.rpc('bob.read_construction_draft',[f.project,f.construction.recordId,1,null])
 for(const key of ['recipe','parameters','materials','joints','instance_policy','open_questions'])assert.deepEqual(historical[key],before[key])
 assert.equal(historical.current_revision,2)
 assert.equal((await f.pg.query('select count(*)::integer n from bob_private.project_drawing_requests where project_id=$1',[f.project])).rows[0].n,1)
 await assert.rejects(f.rpc('bob.check_drawing_request',[f.project,id],f.other),/drawing_request_denied|project_denied/)
})
