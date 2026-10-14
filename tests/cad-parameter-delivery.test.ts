import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {checkedCadFixture,fixtureConstructionId} from './support/checked-cad-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
const id='90000000-0000-4000-8000-000000000001'
const source={id,project_id:'A',revision:1,value:'2',unit:'m',truth:'measured',source:'Marked endpoints',archived:false}
const request={handoff,brief:'Draw the saved panel from its measured datum.',area_id:null,component_id:null,step_id:null,artifact_id:fixtureConstructionId,construction_revision:1}
function fixture(mode='current'){
 const recipe:any={contract_version:1,units:'mm',assembly_id:'panel',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:600,y_mm:300,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']}
 const plan=parameterPlan(recipe),binding=plan.bindings.find(b=>b.path==='instances/panel/placement/x')!
 plan.nodes=plan.nodes.filter(n=>n.id!==binding.node)
 plan.nodes.push({id:'datum',role:'source',source:{kind:'project_measurement',id,revision:1}},{id:'clearance',role:'decision',value:20,unit:'mm',reason:'Chosen clearance'},{id:binding.node,role:'derived',operation:'subtract_v1',operands:['datum','clearance'],rounding:'exact'})
 const parameters=compileCadParameters('A',recipe,plan,new Map([[id,source]]),new Map())
 const saved=checkedCadFixture('A',recipe,{parameters})
 let renders=0,reviews=0
 const a=createCadAssistant({projectId:'A',userId:'u',available:true,deadline:Date.now()+200000,hasAccess:async()=>true,...saved,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:id}]:q.dataset==='measurements'?[{...source,revision:mode==='changed'&&renders?2:1}]:[],related:[],truncated:mode==='truncated'&&q.dataset==='measurements'},error:null}),1000,40),
  render:async r=>{renders++;assert.equal(r.instances[0].placement.x,1980);return saved.packet(r,{manifest:{bob_parameters:{forged:true}}})},
  callModel:async o=>{reviews++;assert.equal(o.functionName,'cad-reviewer');assert.deepEqual(JSON.parse(o.messages![0].content as string).candidate.manifest.bob_parameters,parameters);return reviewReply()},
 })
 return {a,parameters,get renders(){return renders},get reviews(){return reviews}}
}
test('a checked drawing preserves the saved derived placement, numeric sources and graph in reviewer/readback metadata',async()=>{
 const f=fixture();assert.equal((await f.a.consult(request)).status,'ready');assert.equal(f.renders,1);assert.equal(f.reviews,1)
 assert.deepEqual(f.a.candidate?.packet.manifest.bob_parameters,f.parameters)
 assert.deepEqual(f.a.candidate?.measurements,[{id,revision:1}])
})
for(const mode of ['changed','truncated'])test(`a ${mode} measured source blocks paid review and cannot approve the saved graph`,async()=>{
 const f=fixture(mode),out=await f.a.consult(request);assert.equal(out.stage,'review');assert.equal(f.renders,1);assert.equal(f.reviews,0);assert.equal(f.a.candidate,null)
 assert.equal(out.reason,mode==='changed'?'review_sources_changed':'review_sources_incomplete')
})
