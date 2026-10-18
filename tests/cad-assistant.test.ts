import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import {fixtureConstructionId,checkedCadFixture} from './support/checked-cad-fixture.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
const recipe:any={contract_version:1,units:'mm',assembly_id:'panel',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']}
const request={request_id:null,brief:'Draw the saved panel',handoff,area_id:null,component_id:null,step_id:null,artifact_id:fixtureConstructionId,construction_revision:1}
function fixture(extra:any={}){
 const source=checkedCadFixture('A',recipe);let reads=0,models=0,renders=0
 const opts={projectId:'A',userId:'owner',hasAccess:async()=>true,ownerRequest:'Draw the saved panel',deadline:Date.now()+200000,available:true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'44444444-4444-4444-8444-444444444444'}]:[],related:[],truncated:false},error:null}),1000,40),
  readArtifact:async()=>{reads++;return structuredClone(source.draft)},checkConstruction:source.checkConstruction,
  render:async(r:any,pin:any)=>{renders++;assert.deepEqual(pin,{artifact_id:fixtureConstructionId,revision:1});return source.packet(r)},
  callModel:async(o:any)=>{models++;assert.equal(o.aiFunction,'cad-reviewer');return reviewReply()},...extra}
 return {assistant:createCadAssistant(opts),source,counts:()=>({reads,models,renders})}
}
test('every unbound project request stops before model work or CAD, even when legacy geometry is available',async()=>{
 for(const mode of ['new','legacy','retained_draft'] as const){
  let saves=0
  const legacy={id:'33333333-3333-4333-8333-333333333333',revision:1,status:'draft',payload:{brief:{...request,artifact_id:null,construction_revision:null},draft:{recipe},reference_refs:[]}}
  const f=fixture({readArtifact:async()=>({revision:3,recipe}),...(mode==='retained_draft'?{requestStore:{load:async()=>legacy,save:async()=>{saves++;throw Error('must not save')}}}:{})})
  const out=await f.assistant.consult({...request,artifact_id:mode==='legacy'?fixtureConstructionId:null,construction_revision:null,request_id:mode==='retained_draft'?legacy.id:null,handoff:mode==='retained_draft'?null:handoff})
  assert.equal(out.reason,'construction_required');assert.equal(out.saved,false);assert.equal(out.stage,'construction')
  assert.equal(f.counts().models,0);assert.equal(f.counts().renders,0);assert.equal(saves,0);assert.equal(f.assistant.candidate,null)
  assert.equal(f.assistant.metrics.consultations,0);assert.equal(f.assistant.remaining,2)
  assert(out.required_tools.includes('save_construction_draft'))
 }
})
test('an already saved historical request is a receipt, never a new CAD attempt',async()=>{
 const receipt={recordId:fixtureConstructionId,revision:3}
 const f=fixture({requestStore:{load:async()=>({id:'33333333-3333-4333-8333-333333333333',status:'saved',receipt,payload:{}})}})
 const out=await f.assistant.consult({...request,request_id:'33333333-3333-4333-8333-333333333333',artifact_id:null,construction_revision:null})
 assert.equal(out.status,'already_saved');assert.deepEqual(out.receipt,receipt);assert.deepEqual(f.counts(),{reads:0,models:0,renders:0})
})
test('a valid exact source renders once and uses only independent review, regardless of the old research setting',async()=>{
 for(const research of [undefined,true,false]){
  const f=fixture({research});assert.equal((await f.assistant.consult(request)).status,'ready')
  assert.equal(f.counts().renders,1);assert.equal(f.counts().models,1)
  assert.equal(f.assistant.metrics.research_calls,0);assert.equal(f.assistant.metrics.reviews,1)
  assert.deepEqual(f.assistant.candidate?.packet.recipe,recipe)
  assert.equal(f.assistant.candidate?.packet.manifest.bob_construction.artifact_id,fixtureConstructionId)
 }
})
test('missing source material/joint checks cannot fall back to free design or consume CAD consultations',async()=>{
 for(const status of ['needs_data','unavailable','conflict']){
  const f=fixture({checkConstruction:async()=>({status,checked:{concept_ready:false,issues:[{code:'material_or_joint_missing'}]}})})
  const out=await f.assistant.consult(request);assert.equal(out.stage,'construction');assert.equal(out.reason,'construction_not_ready')
  assert.equal(f.counts().models,0);assert.equal(f.counts().renders,0);assert.equal(f.assistant.remaining,2)
 }
})
test('unavailable infrastructure and revoked authority spend no model/render operation',async()=>{
 const unavailable=fixture({available:false});assert.equal((await unavailable.assistant.consult(request)).stage,'cad_engine');assert.equal(unavailable.counts().models,0);assert.equal(unavailable.counts().renders,0)
 const denied=fixture({hasAccess:async()=>false});await assert.rejects(denied.assistant.consult(request),/project_denied/);assert.deepEqual(denied.counts(),{reads:0,models:0,renders:0})
})
test('an older unbound request cannot silently acquire a construction source',async()=>{
 const id='33333333-3333-4333-8333-333333333333'
 let row:any={id,revision:1,status:'draft',payload:{brief:{...request,artifact_id:null,construction_revision:null},owner_request:request.brief,reference_refs:[]}}
 const f=fixture({requestStore:{load:async()=>structuredClone(row),save:async(key:any,expected:number,status:string,payload:any)=>{assert.equal(key,id);assert.equal(expected,row.revision);row={id,revision:expected+1,status,payload:structuredClone(payload)};return structuredClone(row)}}})
 const before=structuredClone(row)
 const out=await f.assistant.consult({...request,request_id:id,handoff:null})
 assert.equal(out.status,'recovery_required');assert.equal(out.reason,'drawing_scope_changed');assert.equal(out.request_id,id)
 assert.deepEqual(row,before);assert.equal(f.counts().models,0)
 const changed=await f.assistant.consult({...request,request_id:id,handoff:null,artifact_id:'22222222-2222-4222-8222-222222222222'})
 assert.equal(changed.reason,'drawing_scope_changed');assert.equal(f.counts().renders,0)
})

test('unlimited CAD work permits more consultations and lifecycle reads while retaining access and terminal stops',async()=>{
 const f=fixture({unlimitedWork:true})
 for(let i=0;i<4;i++)assert.equal((await f.assistant.consult({...request,brief:'Draw exact checked panel '+i})).status,'ready')
 assert.equal(f.counts().renders,4);assert.equal(f.counts().models,4);assert.equal(f.assistant.remaining,Infinity)
 let allowed=true,reads=0
 const lifecycle=fixture({unlimitedWork:true,hasAccess:async()=>allowed,requestStore:{read:async()=>{reads++;return {status:'ok',requests:[]}},cancel:async()=>({status:'cancelled'})}}).assistant
 for(let i=0;i<15;i++)assert.equal((await lifecycle.lifecycle('read_drawing_requests',{request_id:null,after_id:null})).status,'ok')
 assert.equal(reads,15);assert.equal(lifecycle.lifecycleRemaining,Infinity)
 allowed=false
 await assert.rejects(lifecycle.lifecycle('read_drawing_requests',{request_id:null,after_id:null}),/project_denied/)
 assert.equal(reads,15)
 const terminal=fixture({unlimitedWork:true,callModel:async()=>({success:false,data:null,error:'model_output_limit',model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2}})})
 assert.equal((await terminal.assistant.consult(request)).reason,'model_output_limit')
 assert.equal(terminal.assistant.remaining,0)
 assert.equal((await terminal.assistant.consult(request)).reason,'model_output_limit')
 assert.equal(terminal.counts().renders,1,'a terminal failure still prevents repeated CAD dispatch')
})

test('unlimited CAD inherits the root deadline without five-minute or reserved-time cutoffs',async t=>{
 const start=Date.now();let clock=start;t.mock.method(Date,'now',()=>clock)
 for(const [unlimitedWork,deadline,expected] of [[false,Infinity,'incomplete'],[true,Infinity,'ready'],[true,start+302000,'ready'],[true,start+300000,'incomplete']] as const){
  clock=start
  const source=checkedCadFixture('A',recipe)
  const f=fixture({unlimitedWork,deadline,render:async(r:any)=>{clock+=301000;return source.packet(r)}})
  const result=await f.assistant.consult(request)
  assert.equal(result.status,expected)
  assert.equal(f.counts().models,expected==='ready'?1:0)
 }
})
