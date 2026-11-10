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

function fixture({enabled=true,guide='ok' as 'ok'|'fail',chosen=false,readItemName=undefined as undefined|((id:string,revision:number)=>Promise<string|null>)}={}){
 const source=checkedCadFixture('A',recipe,{joints})
 const seen={guides:[] as any[],renders:0,models:0,fasteners:0,review:'' as string}
 const assistant=createCadAssistant({projectId:'A',userId:'owner',hasAccess:async()=>true,ownerRequest:'Draw the saved frame',deadline:Date.now()+200000,available:true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'44444444-4444-4444-8444-444444444444'}]:[],related:[],truncated:false},error:null}),1000,40),
  readArtifact:async()=>structuredClone(source.draft),checkConstruction:source.checkConstruction,
  render:async(r:any,_pin:any,_guard:any,g:any)=>{
   seen.renders++;seen.guides.push(g);const packet=source.packet(r)
   if(!g)return packet
   return guide==='ok'?{...packet,files:{...packet.files,'guide-0':'PHN2Zz4=','guide-1':'PHN2Zz4=','guide-2':'PHN2Zz4='},build_guide:{notes:{pages}}}:{...packet,build_guide:{failure:'guide_too_many_pages'}}
  },
  callModel:async(o:any)=>{seen.models++;seen.review+=JSON.stringify(o.messages);return reviewReply()},
  buildGuide:{enabled:async()=>enabled,readFasteners:async()=>{seen.fasteners++;const out=structuredClone(schedule) as any
   // A joint held by chosen catalog items carries the item on each row.
   if(chosen)out.joints=[{...out.joints[0],source:'chosen',counting:'along_contact',material_id:'00000000-0000-4000-8000-0000000000a1',material_revision:3},
    {...out.joints[0],source:'chosen',kind:'glue',diameter_mm:null,length_mm:null,count:null,counting:'per_construction',material_id:'00000000-0000-4000-8000-0000000000a2',material_revision:1}]
   return out},...(readItemName?{readItemName}:{})}} as any)
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

test('chosen hardware goes to the guide with its catalog name; an unreadable name is left out',async()=>{
 const asked:string[]=[]
 const f=fixture({chosen:true,readItemName:async(id,revision)=>{asked.push(id+'@'+revision);if(id.endsWith('a2'))throw new Error('offline');return ' Träskruv 5 × 120 '}})
 assert.equal((await f.assistant.consult({...request,assembly_dependencies:[{joint_id:'post_rail',depends_on:[]}]})).status,'ready')
 assert.deepEqual(asked,['00000000-0000-4000-8000-0000000000a1@3','00000000-0000-4000-8000-0000000000a2@1'],'each item once')
 assert.deepEqual(f.seen.guides[0].item_names,{'00000000-0000-4000-8000-0000000000a1@3':'Träskruv 5 × 120'})
 // Rule hardware has no catalog item: nothing is read and the request keeps its former shape.
 const plain=fixture({readItemName:async()=>{throw new Error('not asked')}})
 assert.equal((await plain.assistant.consult({...request,assembly_dependencies:[{joint_id:'post_rail',depends_on:[]}]})).status,'ready')
 assert.equal('item_names' in plain.seen.guides[0],false)
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
 assert.equal(f.assistant.candidate!.packet.manifest.build_guide.reason,'guide_too_many_pages','the worker\'s named refusal is kept')
 assert.equal(Object.keys(f.assistant.candidate!.packet.files).some(k=>k.startsWith('guide-')),false)
})

test('the sections parameter is offered only when the switch is on',()=>{
 assert.ok('build_sections' in DESIGN_CAD_TOOL.function.parameters.properties)
 assert.equal('assembly_dependencies' in DESIGN_CAD_TOOL.function.parameters.properties,false)
 assert.ok(DESIGN_CAD_TOOL.function.parameters.required.includes('build_sections'))
 const hidden=withoutAssemblyOrder(DESIGN_CAD_TOOL)
 assert.equal('build_sections' in hidden.function.parameters.properties,false)
 assert.equal(hidden.function.parameters.required.includes('build_sections'),false)
 const legacy:any=structuredClone(DESIGN_CAD_TOOL);legacy.function.parameters.properties.assembly_dependencies={};legacy.function.parameters.required.push('assembly_dependencies')
 assert.equal('assembly_dependencies' in withoutAssemblyOrder(legacy).function.parameters.properties,false,'a pinned older catalog is hidden too')
})

// 2026-11-09: Bob names the guide in titled sections; one page per step.
const section=(title:string,...steps:string[][])=>({title,steps:steps.map(joint_ids=>({joint_ids}))})
test('Bob\'s sections go to the worker as steps that carry their section title',async()=>{
 const f=fixture()
 assert.equal((await f.assistant.consult({...request,build_sections:[section(' Frame ',['post_rail'])]})).status,'ready')
 assert.deepEqual(f.seen.guides[0].steps,[{joint_ids:['post_rail'],section:'Frame'}])
 assert.equal(f.assistant.candidate!.packet.manifest.build_guide.status,'generated')
})
test('a guide in the page store is noted with its store and content id, and no page rides in the drawing files',async()=>{
 const source=checkedCadFixture('A',recipe,{joints}),seen:any[]=[]
 const assistant=createCadAssistant({projectId:'A',userId:'owner',hasAccess:async()=>true,ownerRequest:'Draw the saved frame',deadline:Date.now()+200000,available:true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'44444444-4444-4444-8444-444444444444'}]:[],related:[],truncated:false},error:null}),1000,40),
  readArtifact:async()=>structuredClone(source.draft),checkConstruction:source.checkConstruction,
  render:async(r:any,_pin:any,_guard:any,g:any)=>{seen.push(g);return {...source.packet(r),build_guide:{notes:{store:'pages',guide_id:'d'.repeat(64),pages}}}},
  callModel:async()=>reviewReply(),buildGuide:{enabled:async()=>true,readFasteners:async()=>structuredClone(schedule)}} as any)
 assert.equal((await assistant.consult({...request,build_sections:[section('Frame',['post_rail'])]})).status,'ready')
 const notes=assistant.candidate!.packet.manifest.build_guide
 assert.equal(notes.store,'pages');assert.equal(notes.guide_id,'d'.repeat(64));assert.deepEqual(notes.pages,pages)
 assert.equal(Object.keys(assistant.candidate!.packet.files).some(k=>k.startsWith('guide-')),false)
})
test('sections that miss, repeat or invent a joint, or exceed the piece sizes, are answered before any render',async()=>{
 const tooManySections=Array.from({length:BUILD_SECTION_LIMIT+1},()=>section('A',['post_rail']))
 const tooManySteps=[section('A',...Array.from({length:BUILD_SECTION_STEP_LIMIT+1},()=>['post_rail']))]
 for(const sections of [[],[{title:'A',steps:[]}],[section('',['post_rail'])],[section('A',[])],[section('A',['post_rail']),section('B',['post_rail'])],
  [section('A',['post_rail','missing'])],[{...section('A',['post_rail']),extra:1}],[{title:'A',steps:[{joint_ids:['post_rail'],title:'x'}]}],tooManySections,tooManySteps]){
  const f=fixture()
  const out:any=await f.assistant.consult({...request,build_sections:sections})
  assert.equal(out.status,'invalid',JSON.stringify(sections).slice(0,80));assert.equal(f.seen.renders,0);assert.equal(f.seen.models,0)
 }
 const both=fixture()
 assert.equal((await both.assistant.consult({...request,build_sections:[section('A',['post_rail'])],assembly_dependencies:[{joint_id:'post_rail',depends_on:[]}]})).status,'invalid')
 const none=fixture()
 assert.equal((await none.assistant.consult({...request,build_sections:null})).status,'ready')
 assert.equal(none.assistant.candidate!.packet.manifest.build_guide.reason,'no_assembly_order')
})

// 20261030171000 (cad-build-guide-v1) and 20261101020000 (cad-build-guide-v2, text):
// the catalog carries exactly the runtime's order schema.
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {GUIDE_RANGE_STEPS} from '../supabase/functions/_shared/cad-transport.ts'
import {ASSEMBLY_ORDER_SCHEMA,BUILD_SECTIONS_SCHEMA,BUILD_SECTION_LIMIT,BUILD_SECTION_STEP_LIMIT} from '../supabase/functions/_shared/cad-assistant.ts'
// 20261109080000 (cad-build-guide-v3) swaps the order field for build_sections in place.
test('the catalog publication carries the same nullable, required sections parameter as the runtime',()=>{
 const catalog=catalogFixture(),tool:any=catalog.tool('design_project_cad'),parameters=tool.function?.parameters??tool.parameters
 assert.deepEqual(parameters.properties.build_sections,BUILD_SECTIONS_SCHEMA)
 assert.equal('assembly_dependencies' in parameters.properties,false)
 assert.equal(parameters.required.at(-1),'build_sections')
 assert.equal(catalog.manifest().definitions.find(d=>d.prompt_key==='tools.design_project_cad')!.metadata.publication,'cad-build-guide-v3')
 assert.equal(BUILD_SECTION_STEP_LIMIT,GUIDE_RANGE_STEPS,'a section is one worker call');assert.ok(BUILD_SECTION_LIMIT*BUILD_SECTION_STEP_LIMIT+2<=999,'worker MAX_PAGES')
 // Other fields' texts are owned by later publications (bob-build-workers-v1); the order field and required list agree.
 assert.deepEqual(parameters.required,DESIGN_CAD_TOOL.function.parameters.required,'catalog and local required lists agree')
})
test('the sections field says what the guide is for; null only without joints',()=>{
 assert.match(BUILD_SECTIONS_SCHEMA.description,/a step is one page/)
 assert.match(BUILD_SECTIONS_SCHEMA.description,/exactly one step/)
 assert.match(BUILD_SECTIONS_SCHEMA.description,/Null only when the construction has no saved joints/)
})
test('the historical order field keeps its text for pinned catalogs',()=>{
 assert.match(ASSEMBLY_ORDER_SCHEMA.description,/builders follow it page by page/)
 assert.match(ASSEMBLY_ORDER_SCHEMA.description,/Null only when the construction has no saved joints/)
 assert.doesNotMatch(ASSEMBLY_ORDER_SCHEMA.description,/Build guide only/)
})
