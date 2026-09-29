import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadAssistant } from '../supabase/functions/_shared/cad-assistant.ts'
import { bindMeasuredDimensions, type DrawingRequest, type DrawingRequestStore } from '../supabase/functions/_shared/cad-intake.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { handoff, reviewReply } from './support/cad-review-fixture.ts'

const measurementId='30000000-0000-4000-8000-000000000081'
const requestId='30000000-0000-4000-8000-000000000082'
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'lineage-fixture',
 definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:900,y_mm:300,z_mm:18}],
 instances:[{id:'panel-1',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const binding={definition_id:'panel',dimension:'x_mm',measurement_id:measurementId,revision:2}
const measurement={id:measurementId,project_id:'A',area_id:null,component_id:null,revision:2,subject:'Panel width',value:'1.001',unit:'m',millimetres:'1001',truth:'measured',source:'Measured between the marked endpoints',notes:'',archived:false}
const request={request_id:null,brief:'Draw the concept using the recorded width.',handoff,area_id:null,component_id:null,step_id:null,artifact_id:null}

function fixture(truth='measured'){
 let row:DrawingRequest|null=null,designerCalls=0,reviewInput:any=null
 const m={...measurement,truth}
 const store:DrawingRequestStore={list:async()=>[],load:async id=>row?.id===id?structuredClone(row):null,
  save:async(id,expected,status,payload)=>{assert.equal(expected,row?.revision??0);row={id:id??requestId,revision:expected+1,status,payload:structuredClone(payload)};return structuredClone(row)}}
 const assistant=createCadAssistant({requestStore:store,research:false,projectId:'A',userId:'u',ownerRequest:request.brief,available:true,hasAccess:async()=>true,deadline:Date.now()+300000,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'solution'}]:q.dataset==='measurements'?[m]:[],related:[],truncated:false},error:null}),1000,40),
  readArtifact:async()=>null,
  render:async r=>({recipe:r,manifest:{engine:{name:'build123d'},instances:r.instances},files:{front:'Zml4dHVyZQ=='},previews:{front:'Zml4dHVyZQ==',top:'Zml4dHVyZQ=='}}),
  callModel:async o=>{
   if(o.functionName==='cad-reviewer'){reviewInput=o.messages;return reviewReply()}
   return {success:true,data:null,responseId:'fixture',model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2},...(++designerCalls===1?{toolCalls:[{id:'render',type:'function' as const,function:{name:'render_cad_candidate',arguments:JSON.stringify({recipe,dimension_bindings:[binding],title:'Concept',description:'Source-bound test',assumptions:'Other dimensions are working choices; site fit unverified',target_revision:1,measurements:[{id:measurementId,revision:2}]})}}]}:{})}
  }})
 return {assistant,get row(){return row},get reviewInput(){return reviewInput}}
}

test('P1: the exact parameter-to-source relation survives candidate, independent review and draft',async()=>{
 const f=fixture();assert.equal((await f.assistant.consult(request)).status,'ready')
 const c=f.assistant.candidate!,lineage=c.packet.manifest.bob_lineage
 assert(lineage,'a measurement pin alone does not tell which geometry parameter used it')
 assert.equal(lineage.version,1);assert.equal(lineage.coverage,'partial')
 const entry=lineage.bindings[0]
 assert.equal(entry.definition_id,'panel');assert.equal(entry.dimension,'x_mm')
 assert.equal(entry.source.kind,'project_measurement');assert.equal(entry.source.id,measurementId);assert.equal(entry.source.revision,2)
 assert.equal(entry.source.value,'1.001');assert.equal(entry.source.unit,'m');assert.equal(entry.source.truth,'measured')
 assert.equal(entry.normalized.value,1001);assert.equal(entry.normalized.unit,'mm')
 assert.deepEqual((f.row?.payload.draft as any).lineage,lineage)
 assert(JSON.stringify(f.reviewInput).includes('bob_lineage'),'the reviewer receives the same lineage as the persisted packet')
})

test('P1: specification and estimate provenance must not be upgraded to measured',async()=>{
 for(const truth of ['provided_spec','estimated']){
  const f=fixture(truth);assert.equal((await f.assistant.consult(request)).status,'ready')
  assert.equal(f.assistant.candidate!.packet.manifest.bob_lineage?.bindings[0].source.truth,truth)
 }
})

test('P1: exact finite decimal conversion must not introduce a floating-point dimension error',()=>{
 const bound=bindMeasuredDimensions(recipe,[binding],new Map([[measurementId,measurement]]))
 assert.equal(bound.definitions[0].x_mm,1001)
 assert.equal(recipe.definitions[0].x_mm,900,'the supplied design is not mutated')
})

test('P1: unknown numeric records cannot become source-backed geometry',()=>{
 assert.throws(()=>bindMeasuredDimensions(recipe,[binding],new Map([[measurementId,{...measurement,truth:'unknown'}]])))
})
