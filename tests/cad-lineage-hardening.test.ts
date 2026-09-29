import { test } from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant} from './support/cad-parameter-fixture.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { buildCadLineage, inheritCadLineage } from '../supabase/functions/_shared/cad-lineage.ts'
import { handoff, reviewReply } from './support/cad-review-fixture.ts'

const id='30000000-0000-4000-8000-000000000071'
const parentId='30000000-0000-4000-8000-000000000072'
const record={id,project_id:'A',revision:2,value:'600',unit:'mm',truth:'measured',source:'Measured fixture width',archived:false}
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'hardening',
 definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:600,y_mm:300,z_mm:18}],
 instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const binding={definition_id:'panel',dimension:'x_mm',measurement_id:id,revision:2}
const design={recipe,dimension_bindings:[binding],title:'Concept',description:'Test',assumptions:'Site fit not verified',target_revision:1,measurements:[{id,revision:2}]}
const request={request_id:null,brief:'Draw the recorded panel.',handoff,area_id:null,component_id:null,step_id:null,artifact_id:null}
const reply=(name?:string,args:unknown={})=>({success:true,data:null,responseId:'fixture',model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2},
 ...(name?{toolCalls:[{id:'call',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]}:{})})

for(const failure of ['measurement_denied','artifact_denied','lookup_denied'] as const){
 test(`P1 hardening: ${failure} cannot be swallowed as a design correction`,async()=>{
  let calls=0,renders=0,reviews=0
  const a=createCadAssistant({research:false,projectId:'A',userId:'u',available:true,deadline:Date.now()+300000,hasAccess:async()=>true,
   makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'s'}]:q.dataset==='measurements'?[record]:[],related:[],truncated:false},
    error:failure==='measurement_denied'&&q.dataset==='measurements'||failure==='lookup_denied'&&q.dataset==='tasks'?{code:'42501'}:null}),1000,40),
   readArtifact:async()=>{throw new Error('project_denied')},
   render:async r=>{renders++;return {recipe:r,manifest:{},files:{},previews:{front:'Zml4dHVyZQ==',top:'Zml4dHVyZQ=='}}},
   callModel:async o=>{
    if(o.functionName==='cad-reviewer'){reviews++;return reviewReply()}
    if(++calls===1){
     if(failure==='artifact_denied')return reply('render_saved_cad_candidate',{...design,recipe:undefined,source_artifact_id:parentId,source_revision:1,part_ids:['panel']})
     if(failure==='lookup_denied')return reply('search_project_data',{dataset:'tasks',query:null,status:null,record_id:null,after_id:null,area_id:null})
     return reply('render_cad_candidate',design)
    }
    // A permissive designer might drop the denied source. It must never receive
    // a second call to turn an authority error into a new unbound construction.
    return calls===2?reply('render_cad_candidate',{...design,dimension_bindings:[],measurements:[]}):reply()
   }})
  await assert.rejects(a.consult(request),/project_denied/)
  assert.equal(calls,1);assert.equal(renders,0);assert.equal(reviews,0);assert.equal(a.candidate,null)
 })
}

for(const [label,mutate] of [
 ['truth',(l:any)=>{l.bindings[0].source.truth='unknown'}],
 ['value',(l:any)=>{l.bindings[0].source.value='601'}],
 ['identity',(l:any)=>{l.bindings[0].source.id='not-an-id'}],
 ['coordinates',(l:any)=>{l.coordinates.positive_x={untrusted:'object'}}],
 ['duplicate',(l:any)=>{l.bindings.push(structuredClone(l.bindings[0]))}],
 ['state',(l:any)=>{delete l.bindings}],
] as const){
 test(`P1 hardening: saved-source ${label} is validated before paid rendering`,()=>{
  const lineage=buildCadLineage('A',recipe,[binding],new Map([[id,record]]),handoff.coordinates)
  mutate(lineage)
  assert.throws(()=>inheritCadLineage('A',{lineage},recipe,parentId,1),/invalid_source_lineage/)
 })
}

test('P1 hardening: explicit missing tracked metadata is not a legacy source',()=>{
 assert.throws(()=>inheritCadLineage('A',{lineage:null,lineage_state:'partial'},recipe,parentId,1),/invalid_source_lineage/)
})

for(const change of ['revised','archived','removed'] as const){
 test(`P1 hardening: source ${change} after rendering blocks model approval`,async()=>{
  let renders=0,reviews=0,calls=0
  const a=createCadAssistant({research:false,projectId:'A',userId:'u',available:true,deadline:Date.now()+300000,hasAccess:async()=>true,
   makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'s'}]:q.dataset==='measurements'?
    (renders&&change==='removed'?[]:[{...record,...(renders?change==='revised'?{revision:3}:{archived:true}:{})}]):[],related:[],truncated:false},error:null}),1000,40),
   readArtifact:async()=>null,
   render:async r=>{renders++;return {recipe:r,manifest:{},files:{},previews:{front:'Zml4dHVyZQ==',top:'Zml4dHVyZQ=='}}},
   callModel:async o=>{if(o.functionName==='cad-reviewer'){reviews++;return reviewReply()};return ++calls===1?reply('render_cad_candidate',design):reply()}})
  const result=await a.consult(request)
  assert.equal(result.status,'needs_data');assert.equal(result.stage,'review');assert.equal(result.reason,'review_sources_changed')
  assert.equal(reviews,0);assert.equal(a.candidate,null);assert.equal(a.quality,null)
  assert.equal(renders,1);assert.equal(a.remaining,0)
 })
}
