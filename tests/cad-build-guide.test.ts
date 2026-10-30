// Build guides with the final drawing (owner decisions 2026-10-30): behind the
// owner's switch, from Bob's order, never blocking the drawing, never reviewed.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import {fixtureConstructionId,checkedCadFixture} from './support/checked-cad-fixture.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {DESIGN_CAD_TOOL,cadRenderInput,withoutAssemblyOrder} from '../supabase/functions/_shared/cad-assistant.ts'

const place=(x=0,y=0,z=0)=>({x,y,z,rx:0,ry:0,rz:0})
const recipe:any={contract_version:1,units:'mm',assembly_id:'frame',views:['front','top'],
 definitions:[{id:'post',primitive:'box',material_ref:null,x_mm:45,y_mm:45,z_mm:900},{id:'rail',primitive:'box',material_ref:null,x_mm:600,y_mm:45,z_mm:95}],
 instances:[{id:'post',definition_id:'post',placement:place()},{id:'rail',definition_id:'rail',placement:place(45,0,400)}]}
const joints=[{id:'post_rail',method:'screwed_butt',first:{instance_id:'post',face:'x_max'},second:{instance_id:'rail',face:'x_min'},reason:'Rail on post'}]
const request={request_id:null,brief:'Draw the saved frame',handoff,area_id:null,component_id:null,step_id:null,artifact_id:fixtureConstructionId,construction_revision:1}
const schedule={status:'ok',artifact_id:fixtureConstructionId,revision:1,rule_version:'fastener-rules-v1',complete:true,glue_packages:0,
 joints:[{joint_id:'post_rail',method:'screwed_butt',source:'rule',kind:'screw',diameter_mm:5,length_mm:120,count:2,spacing_mm:45,through_instance_id:'post',through_mm:45,embed_mm:555,contact_length_mm:95,contact_width_mm:45,proposal:null,gaps:[]}],
 totals:[{kind:'screw',diameter_mm:5,length_mm:120,count:2,joint_ids:['post_rail']}]}
const pages=[{key:'guide-0',kind:'parts',sha256:'a'.repeat(64)},{key:'guide-1',kind:'step',sha256:'b'.repeat(64)},{key:'guide-2',kind:'done',sha256:'c'.repeat(64)}]

function fixture({enabled=true,guide='ok' as 'ok'|'fail'}={}){
 const source=checkedCadFixture('A',recipe,{joints})
 const seen={guides:[] as any[],renders:0,models:0,fasteners:0,review:'' as string}
 const assistant=createCadAssistant({projectId:'A',userId:'owner',hasAccess:async()=>true,ownerRequest:'Draw the saved frame',deadline:Date.now()+200000,available:true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'44444444-4444-4444-8444-444444444444'}]:[],related:[],truncated:false},error:null}),1000,40),
  readArtifact:async()=>structuredClone(source.draft),checkConstruction:source.checkConstruction,
  render:async(r:any,_pin:any,_guard:any,g:any)=>{
   seen.renders++;seen.guides.push(g);const packet=source.packet(r)
   if(!g)return packet
   return guide==='ok'?{...packet,files:{...packet.files,'guide-0':'PHN2Zz4=','guide-1':'PHN2Zz4=','guide-2':'PHN2Zz4='},build_guide:{notes:{pages}}}:{...packet,build_guide:{failure:'guide_unavailable'}}
  },
  callModel:async(o:any)=>{seen.models++;seen.review+=JSON.stringify(o.messages);return reviewReply()},
  buildGuide:{enabled:async()=>enabled,readFasteners:async()=>{seen.fasteners++;return structuredClone(schedule)}}} as any)
 return {assistant,seen}
}

test('with the switch off a drawing is made exactly as before',async()=>{
 const f=fixture({enabled:false})
 assert.equal((await f.assistant.consult({...request,assembly_dependencies:[{joint_id:'post_rail',depends_on:[]}]})).status,'ready')
 assert.deepEqual(f.seen.guides,[undefined]);assert.equal(f.seen.fasteners,0)
 assert.equal('build_guide' in f.assistant.candidate!.packet.manifest,false)
 assert.deepEqual(cadRenderInput(recipe,{artifact_id:fixtureConstructionId,revision:1}),{recipe,drawing_source:{artifact_id:fixtureConstructionId,revision:1}},'unchanged render step input')
})

test('with the switch on, Bob\'s order and the rule fasteners go with the render and the notes ride on the drawing',async()=>{
 const f=fixture()
 assert.equal((await f.assistant.consult({...request,assembly_dependencies:[{joint_id:'post_rail',depends_on:[]}]})).status,'ready')
 const g=f.seen.guides[0]
 assert.deepEqual(g.steps,[{joint_ids:['post_rail']}]);assert.deepEqual(g.joints,joints);assert.deepEqual(g.context_ids,[])
 assert.deepEqual(g.drawing_source,{artifact_id:fixtureConstructionId,revision:1})
 assert.deepEqual(Object.keys(g.fasteners).sort(),['complete','glue_packages','joints','rule_version','totals'],'exactly the worker schedule keys')
 const manifest=f.assistant.candidate!.packet.manifest
 assert.deepEqual(manifest.build_guide,{version:1,construction:{artifact_id:fixtureConstructionId,revision:1},reviewed:false,status:'generated',basis:'proposed_order',
  fasteners:{rule_version:'fastener-rules-v1',complete:true},pages})
 assert.equal(manifest.bob_construction.revision,manifest.build_guide.construction.revision)
 assert.equal(f.seen.models,1);assert.doesNotMatch(f.seen.review,/build_guide|guide-0/,'the reviewer never sees the guide')
})

test('no order means no guide, never an invented one',async()=>{
 const f=fixture()
 assert.equal((await f.assistant.consult({...request,assembly_dependencies:null})).status,'ready')
 assert.deepEqual(f.seen.guides,[undefined]);assert.equal(f.seen.fasteners,0)
 assert.equal(f.assistant.candidate!.packet.manifest.build_guide.status,'not_generated')
 assert.equal(f.assistant.candidate!.packet.manifest.build_guide.reason,'no_assembly_order')
})

test('an invalid order is answered before any render or review is spent',async()=>{
 for(const order of [[],[{joint_id:'post_rail',depends_on:['post_rail']}],[{joint_id:'missing',depends_on:[]}],[{joint_id:'post_rail',depends_on:[],extra:1}]]){
  const f=fixture()
  const out=await f.assistant.consult({...request,assembly_dependencies:order})
  assert.equal(out.status,'invalid',JSON.stringify(order));assert.equal(f.seen.renders,0);assert.equal(f.seen.models,0)
 }
})

test('a failed guide is recorded and the drawing is still reviewed and ready',async()=>{
 const f=fixture({guide:'fail'})
 assert.equal((await f.assistant.consult({...request,assembly_dependencies:[{joint_id:'post_rail',depends_on:[]}]})).status,'ready')
 assert.equal(f.assistant.candidate!.packet.manifest.build_guide.status,'failed')
 assert.equal(f.assistant.candidate!.packet.manifest.build_guide.reason,'guide_unavailable')
 assert.equal(Object.keys(f.assistant.candidate!.packet.files).some(k=>k.startsWith('guide-')),false)
})

test('the order parameter is offered only when the switch is on',()=>{
 assert.ok('assembly_dependencies' in DESIGN_CAD_TOOL.function.parameters.properties)
 assert.ok(DESIGN_CAD_TOOL.function.parameters.required.includes('assembly_dependencies'))
 const hidden=withoutAssemblyOrder(DESIGN_CAD_TOOL)
 assert.equal('assembly_dependencies' in hidden.function.parameters.properties,false)
 assert.equal(hidden.function.parameters.required.includes('assembly_dependencies'),false)
})

// 20261030171000 (cad-build-guide-v1): the catalog carries exactly the runtime's order schema.
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {ASSEMBLY_ORDER_SCHEMA} from '../supabase/functions/_shared/cad-assistant.ts'
test('the catalog publication adds the same nullable, required order parameter as the runtime',()=>{
 const catalog=catalogFixture(),tool:any=catalog.tool('design_project_cad'),parameters=tool.function?.parameters??tool.parameters
 assert.deepEqual(parameters.properties.assembly_dependencies,ASSEMBLY_ORDER_SCHEMA)
 assert.equal(parameters.required.at(-1),'assembly_dependencies')
 assert.equal(catalog.manifest().definitions.find(d=>d.prompt_key==='tools.design_project_cad')!.metadata.publication,'cad-build-guide-v1')
 assert.deepEqual(parameters,DESIGN_CAD_TOOL.function.parameters,'catalog and local definition agree')
})
