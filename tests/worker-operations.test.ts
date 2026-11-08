import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createWorkerOperations,workerOperationSpec,type OperationEntry,type OperationRole} from '../supabase/functions/_shared/worker-operations.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {applyCatalogModelOptions} from '../supabase/functions/_shared/ai-catalog.ts'
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002'
const entries:Omit<OperationEntry,'ref'>[]=[
 {kind:'construction',id:A,revision:3,label:'Frame',target_revision:7,area_id:null},
 {kind:'construction',id:B,revision:2,label:'Roof',target_revision:7,area_id:null},
 {kind:'drawing',id:'drawing',revision:4,label:'Saved frame',parent:A},
 {kind:'shell',id:'shell',revision:2,label:'Whole build'},
 {kind:'step',id:'step',revision:8,label:'Frame step'},
 {kind:'plan_requirement',id:'plan-need',revision:8,label:'Need'},
 {kind:'task',id:'task',revision:0,label:'Task'},
 {kind:'requirement',id:'need',revision:6,label:'Rails',parent:A,definition_id:'rail',quantity_mode:'pieces'},
 {kind:'cut_plan',id:'cut',revision:5,label:'Frame cutting',parent:A},
 {kind:'stock',id:'stock',revision:2,label:'Measured sheet'},
 {kind:'request',id:'request',revision:3,label:'Frame drawing'},
 {kind:'gap',id:'gap',revision:0,label:'Gap',parent:'request'},
]
function fixture(bound=false,version:1|2=2,extra:Record<string,unknown>={}){let valid=true,access=true;const seen:any[]=[],f=createWorkerOperations({...extra,version,bindings:catalogFixture().definition('bob.tools','tool_contract').definition.worker_operation_bindings as any,projectId:'p',hasAccess:async()=>access,
 load:async()=>({status:'ready',source:bound?{artifact_id:A,revision:3}:null,entries}),
 validateMany:async refs=>{seen.push({validate:refs});return valid},
 prepareDrawing:async(source,focus)=>{seen.push({source,focus});return {status:'ready'}},drawingArguments:raw=>({...raw as any,artifact_id:A,construction_revision:3}),drawingWork:()=>({construction:{artifact_id:A,revision:3},request_id:'request'})})
 return {f,seen,setValid:(v:boolean)=>valid=v,setAccess:(v:boolean)=>access=v}
}
const ref=(f:ReturnType<typeof fixture>['f'],role:OperationRole,id:string)=>f.exportState().scopes.find(s=>s.role===role)!.entries.find(e=>e.id===id)!.ref

test('Konrad and Mattias cannot supply identities or switch a pinned job to another valid construction; own receipt advances pin',async()=>{
 for(const role of ['structure','materials'] as const){const {f}=fixture(true);await f.prepare(role,[])
 const b=ref(f,role,B),a=ref(f,role,A)
 assert.equal((await f.before(role,'check_construction_draft',{artifact_id:B,revision:2})).reason,'operation_identity_is_server_owned')
 assert.equal((await f.before(role,'check_construction_draft',{source_ref:b})).args?.artifact_id,B)
 assert.equal((await f.before(role,'save_construction_cut_plan',{source_ref:b})).reason,'operation_scope_changed')
 assert.deepEqual((await f.before(role,'check_construction_draft',{})).args,{artifact_id:A,revision:3})
 assert.equal(f.describe(role).source?.ref,a)
 assert.equal(f.serverArgs(role,'check_construction_draft',{artifact_id:A,revision:3}).artifact_id,undefined)
 assert.throws(()=>f.serverArgs(role,'check_construction_draft',{artifact_id:B,revision:2}),/operation_scope_changed/)
 if(role==='structure'){
  const saved=await f.before(role,'edit_construction_parts',{changes:{}});assert.equal(saved.args?.expected_revision,3)
  await f.observe(role,'edit_construction_parts',saved.args!,{status:'saved',receipt:{projectId:'p',recordId:A,revision:4,label:'Frame'}})
  assert.equal((await f.before(role,'check_construction_draft',{})).args?.revision,4)
 }
 }
})
test('unbound semantic selection is code-resolved and stale validation cannot accidentally pin the job',async()=>{
 const {f,setValid}=fixture();await f.prepare('structure',[]);const b=ref(f,'structure',B)
 setValid(false);assert.equal((await f.before('structure','edit_construction_parts',{source_ref:b})).reason,'operation_reference_changed')
 assert.equal(f.exportState().scopes[0].source,null)
 setValid(true);assert.equal((await f.before('structure','edit_construction_parts',{source_ref:b})).args?.record_id,B)
 assert.equal((await f.before('structure','read_construction_draft',{source_ref:ref(f,'structure',A)})).args?.artifact_id,A)
 assert.equal(f.exportState().scopes[0].source?.artifact_id,B)
})
test('Rita resolves batch, shell, step and gap selections without accepting raw tuple overrides',async()=>{
 const {f}=fixture();await f.prepare('drawing',[]);const r=(id:string)=>ref(f,'drawing',id)
 const batch=await f.before('drawing','plan_cad_pieces',{pieces:[{source_ref:r(A),piece_key:'frame'},{source_ref:r(B),piece_key:'roof'}]})
 assert.equal(batch.status,'ready');assert.deepEqual(batch.args?.pieces.map((p:any)=>[p.artifact_id,p.construction_revision,p.component_id]),[[A,3,null],[B,2,null]])
 const shell=await f.before('drawing','compose_cad_shell',{shell_ref:r('shell'),components:[{drawing_ref:r('drawing')}]})
 assert.equal(shell.args?.record_id,'shell');assert.equal(shell.args?.components[0].child_revision,4)
 assert.equal((await f.before('drawing','link_cad_shell_steps',{shell_ref:r('shell'),links:[{step_ref:r('step')}]})).args?.links[0].step_id,'step')
 assert.equal((await f.before('drawing','link_project_drawing',{drawing_ref:r('drawing'),step_ref:r('step')})).args?.expected_revision,4)
 const gap=await f.before('drawing','link_drawing_gap',{request_ref:r('request'),gap_ref:r('gap'),task_ref:r('task'),step_ref:r('step')})
 assert.equal(gap.args?.request_id,'request');assert.equal(gap.args?.gap_id,'gap');assert.equal(gap.args?.expected_revision,3)
 const ensure=await f.before('drawing','ensure_drawing_gap_task',{request_ref:r('request'),gap_ref:r('gap'),requirement_ref:r('plan-need')})
 assert.equal(ensure.args?.requirement_id,'plan-need');assert.equal(ensure.args?.plan_revision,8)
 assert.equal((await f.before('drawing','plan_cad_pieces',{area_id:'foreign',pieces:[]})).reason,'operation_identity_is_server_owned')
})
test('material outputs reuse canonical existing identities and exact requirement revisions; cross-source writes are rejected',async()=>{
 const {f}=fixture(true);await f.prepare('materials',[])
 const derived=await f.before('materials','derive_cad_material_requirement',{record_ref:null,expected_updated_at:null,data:{definition_id:'rail',quantity_mode:'pieces'}})
 assert.equal(derived.args?.record_id,'need');assert.equal(derived.args?.expected_revision,6)
 assert.deepEqual(derived.args?.data,{definition_id:'rail',quantity_mode:'pieces',artifact_id:A,artifact_revision:3,target_revision:7})
 const cut=await f.before('materials','save_construction_cut_plan',{record_ref:null,requirements:[{requirement_ref:ref(f,'materials','need')}]})
 assert.equal(cut.args?.record_id,'cut');assert.deepEqual(cut.args?.requirements,[{id:'need',revision:6}])
 assert.equal((await f.before('materials','derive_cad_material_requirement',{record_ref:null,data:{artifact_id:B}})).reason,'operation_identity_is_server_owned')
 const stock=await f.before('materials','manage_project_material',{resource:'stock',action:'revise',record_ref:ref(f,'materials','stock'),data:{}})
 assert.equal(stock.args?.record_id,'stock');assert.equal(stock.args?.expected_revision,2);assert.equal(stock.args?.expected_updated_at,null)
 await f.observe('materials','derive_cad_material_requirement',derived.args!,{status:'saved',receipt:{projectId:'p',recordId:'need',revision:7,label:'Rails'}})
 assert.equal((await f.before('materials','derive_cad_material_requirement',{record_ref:null,data:{definition_id:'rail',quantity_mode:'pieces'}})).args?.expected_revision,7)
 assert.equal((await f.before('materials','manage_project_material',{resource:'requirement',action:'revise',record_ref:ref(f,'materials','stock'),data:{}})).reason,'operation_reference_required')
})
test('single drawing selection verifies destination source; completed saved receipt survives restart and revoked access',async()=>{
 const {f,seen}=fixture();await f.prepare('drawing',[])
 const args={source_ref:ref(f,'drawing',A),drawing_ref:ref(f,'drawing','drawing'),brief:'Draw the frame'}
 assert.equal((await f.before('drawing','design_project_cad',args)).status,'ready')
 assert.deepEqual(seen.find(s=>s.source),{source:{artifact_id:A,revision:3},focus:{artifact_id:'drawing',revision:4}})
 assert.equal((await f.before('drawing','design_project_cad',{...args,source_ref:ref(f,'drawing',B)})).reason,'operation_scope_changed')
 await f.observe('drawing','save_cad_design',{}, {status:'saved',receipt:{projectId:'p',recordId:'drawing',revision:5,label:'Frame',record:{huge:'not checkpointed'}}})
 const saved=JSON.parse(JSON.stringify(f.exportState())),next=fixture();next.f.restoreState(saved)
 const reused=await next.f.before('drawing','design_project_cad',{...args,drawing_ref:null})
 assert.equal(reused.status,'complete');assert.equal(reused.result.receipt.revision,5);assert.equal(next.seen.filter(s=>s.source).length,0)
 assert(!JSON.stringify(saved).includes('not checkpointed'))
 next.setAccess(false);await assert.rejects(next.f.before('drawing','design_project_cad',args),/project_denied/)
 saved.scopes[0].completed[0].result.receipt.projectId='foreign';assert.throws(()=>next.f.restoreState(saved),/checkpoint_invalid/)
})
test('the final catalog model surface preserves source ownership and guide on/off across JSON checkpoint transport',async()=>{
 const {f}=fixture(true);await f.prepare('materials',[]);await f.prepare('drawing',[])
 const catalog=catalogFixture()
 for(const guides of [true,false]){
  const runtime=JSON.parse(JSON.stringify({version:1,buildGuides:guides,operation:f.surface('drawing')}))
  const result=applyCatalogModelOptions(catalog,{app:'bob',functionName:'drawing-worker',catalogVariables:{project_name:'Fixture'},catalogRuntimeSurface:runtime,
   tools:['design_project_cad','plan_cad_pieces','compose_cad_shell','link_project_drawing'].map(name=>catalog.tool(name))})
  const p:any=result.tools![0].function.parameters
  assert.equal('assembly_dependencies' in p.properties,guides);assert(!('artifact_id' in p.properties));assert(!('request_id' in p.properties));assert('source_ref'in p.properties)
  assert(!('artifact_id'in (result.tools![1].function.parameters as any).properties.pieces.items.properties))
 }
 // Only Konrad owns this writer, so role restrictions still come from the catalog.
 assert(catalog.definition('role.materials-worker','role').definition.tool_keys.includes('tools.read_project_work'))
 const cut:any=workerOperationSpec(catalog.tool('save_construction_cut_plan'),f.surface('materials')).function.parameters
 assert(!('artifact_id'in cut.properties));assert(!('record_id'in cut.properties));assert('record_ref'in cut.properties)
})


test('an overview is not an assignment, even with one existing construction; a new construction remains possible',async()=>{
 const f=createWorkerOperations({projectId:'p',hasAccess:async()=>true,load:async()=>({status:'ready',source:null,entries:[entries[0]]}),prepareDrawing:async()=>({status:'ready'}),drawingArguments:()=>null,drawingWork:()=>undefined})
 await f.prepare('structure',[])
 const overview=await f.before('structure','read_construction_draft',f.knowledgeArgs('structure','read_construction_draft',{artifact_id:null,revision:null,view:'overview'}))
 assert.equal(overview.args?.artifact_id,null);assert.equal(f.describe('structure').source,null)
 assert.equal((await f.before('structure','read_construction_draft',f.serverArgs('structure','read_construction_draft',{artifact_id:null,revision:null,view:'work',work_kind:'parts'}))).args?.artifact_id,null)
 const created=await f.before('structure','save_construction_draft',{source_ref:null,title:'A new independent build'})
 assert.equal(created.args?.record_id,null);assert.equal(created.args?.expected_revision,0)
})


test('returned request records carry their own reference so identical labels cannot be guessed',async()=>{
 const {f}=fixture();await f.prepare('drawing',[])
 const output=await f.observe('drawing','read_drawing_requests',{}, {requests:[{project_id:'p',id:'request',revision:3,status:'collecting'},{project_id:'p',id:'second-request',revision:1,status:'collecting'}]})
 assert.notEqual(output.requests[0].operation_ref,output.requests[1].operation_ref)
 assert.equal((await f.before('drawing','read_drawing_request_work',{request_ref:output.requests[1].operation_ref})).args?.request_id,'second-request')
})


test('changed views or brief on the same revision produce a new intent; identical retries reuse only saved receipts',async()=>{
 const {f}=fixture();await f.prepare('drawing',[])
 const args={source_ref:ref(f,'drawing',A),drawing_ref:null,brief:'Frame',views:['front']}
 assert.equal((await f.before('drawing','design_project_cad',args)).status,'ready')
 await f.observe('drawing','save_cad_design',{}, {status:'saved',receipt:{projectId:'p',recordId:'drawing',revision:5,label:'Frame'}})
 assert.equal((await f.before('drawing','design_project_cad',args)).status,'complete')
 assert.equal((await f.before('drawing','design_project_cad',{...args,views:['top']})).status,'ready')
 await f.observe('drawing','save_cad_design',{}, {status:'saved',receipt:{projectId:'p',recordId:'drawing',revision:6,label:'Top'}})
 assert.equal((await f.before('drawing','design_project_cad',args)).status,'ready','an overwritten saved revision must not block a new drawing intent')
 assert.equal((await f.before('drawing','design_project_cad',{...args,brief:'Show dimensions'})).status,'ready')
})
test('legacy execution retains its pinned read surface and source-only receipt replay',async()=>{
 const {f}=fixture(true,1);await f.prepare('structure',[])
 assert.equal((await f.before('structure','check_construction_draft',{source_ref:ref(f,'structure',B)})).reason,'operation_scope_changed')
 const p:any=workerOperationSpec(catalogFixture().tool('read_construction_draft'),f.surface('structure')).function.parameters
 assert(!('source_ref' in p.properties))
})
test('a catalog-defined reader alias projects and resolves its fields without a tool-name branch',async()=>{
 const catalog=catalogFixture(),bindings=structuredClone(catalog.definition('bob.tools','tool_contract').definition.worker_operation_bindings) as any
 bindings.inspect_frame={source:{id:'frame_id',revision:'frame_revision',ref:'frame_ref',readOnly:true},schema:[{path:[],hide:['frame_id','frame_revision'],refs:[{field:'frame_ref',kind:'construction',nullable:true}]}]}
 const f=createWorkerOperations({projectId:'p',bindings,hasAccess:async()=>true,load:async()=>({status:'ready',source:{artifact_id:A,revision:3},entries}),validateMany:async refs=>refs.every(e=>e.id===B&&e.revision===2),prepareDrawing:async()=>({status:'ready'}),drawingArguments:()=>null,drawingWork:()=>undefined})
 await f.prepare('structure',[])
 const spec:any={type:'function',function:{name:'inspect_frame',description:'Read',parameters:{type:'object',properties:{frame_id:{type:'string'},frame_revision:{type:'integer'}},required:['frame_id','frame_revision']}}}
 const p:any=workerOperationSpec(spec,f.surface('structure')).function.parameters
 assert.deepEqual(p.required,['frame_ref']);assert(!('frame_id' in p.properties))
 assert.deepEqual((await f.before('structure','inspect_frame',{frame_ref:f.exportState().scopes[0].entries.find(e=>e.id===B)!.ref})).args,{frame_id:B,frame_revision:2})
 assert.equal(f.exportState().scopes[0].source?.artifact_id,A)
 assert.equal((await f.before('structure','inspect_frame',{frame_id:B,frame_revision:2})).reason,'operation_identity_is_server_owned')
})

test('material manuals and the final provider schema describe the executable server-bound arguments',async()=>{
 for(const bound of [false,true]){
  const {f}=fixture(bound);await f.prepare('materials',[])
  const catalog=catalogFixture(),surface=JSON.parse(JSON.stringify({version:1,buildGuides:false,operation:f.surface('materials')}))
  const manual=workerOperationSpec(catalog.tool('derive_cad_material_requirement',{include_manual:true}),surface.operation)
  const final=applyCatalogModelOptions(catalog,{app:'bob',functionName:'materials-worker',catalogVariables:{project_name:'Fixture'},catalogRuntimeSurface:surface,tools:[manual]})
  const p:any=final.tools![0].function.parameters
  assert.equal(p.properties.data.description,(manual.function.parameters as any).properties.data.description)
  assert.match(p.properties.data.description,/server-bound; do not supply artifact_id, artifact_revision or target_revision/)
  assert.doesNotMatch(p.properties.data.description,/artifact_id \(drawing or construction\)|revise exact requirement UUID|New record_id/)
  assert.equal('source_ref' in p.properties,!bound)
  const args={record_ref:null,expected_updated_at:null,data:{definition_id:'rail',quantity_mode:'pieces'},...(!bound?{source_ref:ref(f,'materials',A)}:{})}
  const ready=await f.before('materials','derive_cad_material_requirement',args)
  assert.equal(ready.status,'ready');assert.equal(ready.args?.data.artifact_id,A);assert.equal(ready.args?.data.artifact_revision,3)
  for(const field of ['artifact_id','artifact_revision','target_revision'])assert.equal((await f.before('materials','derive_cad_material_requirement',{...args,data:{...args.data,[field]:1}})).reason,'operation_identity_is_server_owned')
 }
})

test('owner decision 2026-11-08: with lean writing a save names its target; null is a new construction even in a bound job',async()=>{
 const {f}=fixture(true,2,{explicitSaveTarget:true,stableRefs:true});await f.prepare('structure',[])
 const a=ref(f,'structure',A),b=ref(f,'structure',B)
 // The job's construction by its reference: a whole revision of it.
 assert.deepEqual((await f.before('structure','save_construction_draft',{source_ref:a,title:'Ram'})).args,{title:'Ram',record_id:A,expected_revision:3})
 // null: a new construction, not a revision of the job's construction.
 const fresh=await f.before('structure','save_construction_draft',{source_ref:null,title:'Ny ram'})
 assert.deepEqual(fresh.args,{title:'Ny ram',record_id:null,expected_revision:0})
 // Another construction is still refused in a bound job.
 assert.equal((await f.before('structure','save_construction_draft',{source_ref:b})).reason,'operation_scope_changed')
 // The schema says so, the same text bound or not.
 const spec=(bound:boolean)=>workerOperationSpec({type:'function',function:{name:'save_construction_draft',description:'x',parameters:{type:'object',properties:{record_id:{},expected_revision:{},title:{type:'string'}},required:['record_id','expected_revision','title']}}} as any,
  {...f.surface('structure'),source:bound}) as any
 for(const bound of [true,false]){
  const p=spec(bound).function.parameters
  assert.match(p.properties.source_ref.description,/null saves a new construction/);assert.ok(p.required.includes('source_ref'));assert.ok(!('record_id' in p.properties))
 }
 // Without the pin a bound job keeps the server's choice.
 const old=fixture(true,2,{stableRefs:true});await old.f.prepare('structure',[])
 assert.equal((await old.f.before('structure','save_construction_draft',{source_ref:null,title:'Ram'})).args?.record_id,A)
})
