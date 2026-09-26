import {domainVocabulary} from '../src/domain/vocabulary.ts'
import { BobContinuation, createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant, handoff} from './support/cad-review-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import type {CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'
import {createProjectContext} from '../supabase/functions/_shared/project-context/dispatcher.ts'
import {createMediaAdapter,type MediaRow} from '../supabase/functions/_shared/project-context/media.ts'
import {hasImageContent} from '../supabase/functions/_shared/openai-content.ts'
const id='30000000-0000-4000-8000-000000000001'
const recipe:CadAssemblyRequest={contract_version:1,units:'mm',assembly_id:'bed',definitions:[{id:'post',primitive:'box',material_ref:null,x_mm:45,y_mm:70,z_mm:1800},{id:'panel',primitive:'box',material_ref:null,x_mm:800,y_mm:600,z_mm:18}],instances:[{id:'bed.post',definition_id:'post',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}},{id:'drawer.base',definition_id:'panel',placement:{x:100,y:0,z:30,rx:0,ry:0,rz:0}}],views:['front','top']}
const request={handoff,brief:'Rita lådorna och behåll deras mått.',area_id:null,component_id:null,step_id:null,artifact_id:null}
const candidate={recipe,source_artifact_id:null,source_revision:null,part_ids:[],title:'Lådor',description:'Under sängen',assumptions:'Design specifications; fit to be checked',target_revision:1,measurements:[]}
const response=(name?:string,args?:unknown)=>({success:true,data:name?null:'Ritningen är klar.',model:'fixture',responseId:'resp',usage:{input_tokens:1,output_tokens:1,total_tokens:2},...(name?{toolCalls:[{id:'call',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]}:{})})
function fixture(){let calls=0;const seen:any[]=[];let allowed=true
 const opts={projectId:'A',userId:'u',hasAccess:async()=>allowed,deadline:Date.now()+200000,available:true,
  makeLookup:()=>createProjectLookup('A',async(_p,input)=>({data:{records:input.dataset==='target'?[{id:'project',revision:1,solution_id:id}]:[],related:[],truncated:false},error:null}),1000,40),
  callModel:async(o:any)=>{seen.push(o);return calls++===0?response('render_cad_candidate',candidate):response()},
  render:async(r:CadAssemblyRequest)=>({recipe:r,manifest:{bounding_box_mm:{size:[800,600,1800]},instances:r.instances},files:{front:'Zml4dHVyZQ=='}}),
  readArtifact:async()=>({revision:2,recipe:structuredClone(recipe)})}
 return {opts,seen,deny:()=>{allowed=false}}
}
test('CAD assistant has an independent model config, own tools and multi-call loop',async()=>{const f=fixture();const a=createCadAssistant(f.opts);const result=await a.consult(request);assert.equal(result.status,'ready');assert(a.candidate);assert.equal(f.seen.length,2);for(const call of f.seen)assert(call.systemMessage.includes(domainVocabulary('cad')));assert.equal(f.seen[0].functionName,'cad-designer');assert(f.seen[0].tools.some((t:any)=>t.function.name==='render_cad_candidate'));assert.equal(f.seen[1].messages[0].role,'tool');assert.equal(f.seen[1].previousResponseId,'resp');assert.equal(result.saved,false)})
test('detail selection reuses exact source dimensions and placements instead of rebuilding them',async()=>{const f=fixture();let n=0;f.opts.callModel=async()=>n++===0?response('render_cad_candidate',{...candidate,recipe:null,source_artifact_id:id,source_revision:2,part_ids:['drawer.base']}):response();const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).status,'ready');assert.deepEqual(a.candidate!.packet.recipe.instances,[recipe.instances[1]]);assert.deepEqual(a.candidate!.packet.recipe.definitions,[recipe.definitions[1]]);assert.equal(a.candidate!.source_revision,2)})
test('a failed repair invalidates the old candidate; failure cannot save stale success',async()=>{const f=fixture();let n=0;f.opts.callModel=async()=>++n===1?response('render_cad_candidate',candidate):n===2?response('render_cad_candidate',{...candidate,recipe:{...recipe,python:'not allowed'}}):response();const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).status,'incomplete');assert.equal(a.candidate,null)})
test('missing infrastructure is explicit and makes no provider call',async()=>{const f=fixture();f.opts.available=false;const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).stage,'cad_engine');assert.equal(f.seen.length,0);assert.equal(a.candidate,null)})
test('access revocation prevents generation and has no candidate',async()=>{const f=fixture();f.deny();const a=createCadAssistant(f.opts);await assert.rejects(a.consult(request),/project_denied/);assert.equal(f.seen.length,0);assert.equal(a.candidate,null)})
test('stale measurement references block rendering and can be corrected in another call',async()=>{const f=fixture();let n=0,renders=0;f.opts.callModel=async()=>n++===0?response('render_cad_candidate',{...candidate,measurements:[{id,revision:1}]}):response();f.opts.render=async r=>{renders++;return {recipe:r,manifest:{},files:{}}};const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).status,'incomplete');assert.equal(renders,0)})


test('CAD revisions inherit current work links instead of a removed historical Step',async()=>{
 for(const links of [[],['current-step'],['current-step','other-step']]){
  const f=fixture(),a=createCadAssistant({...f.opts,readArtifact:async()=>({revision:2,recipe:structuredClone(recipe),step_id:'retired-step',current_step_ids:links})})
  assert.equal((await a.consult({...request,artifact_id:id})).status,'ready')
  assert.equal(a.candidate!.step_id,links.length===1?links[0]:null)
  assert.equal(a.candidate!.expected_revision,2)
 }
})

test('CAD restart restores the rendered candidate without rendering or asking the model twice',async()=>{
 const f=fixture(),entries:JournalEntry[]=[];let now=0,renders=0
 const run=()=>{
  const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},20000,()=>now)
  return createCadAssistant({...f.opts,
   callModel:o=>journal.run('model:cad',o,()=>f.opts.callModel(o),10000),
   render:r=>journal.run('cad:render',r,async()=>{renders++;const packet=await f.opts.render(r);now=15000;return packet}),
  })
 }
 await assert.rejects(run().consult(structuredClone(request)),e=>e instanceof BobContinuation&&e.kind==='yield')
 assert.equal(renders,1);assert.equal(f.seen.length,1)
 now=0
 const resumed=run()
 assert.equal((await resumed.consult(structuredClone(request))).status,'ready')
 assert.deepEqual(resumed.candidate!.packet.recipe,recipe)
 assert.equal(renders,1);assert.equal(f.seen.length,2)
})

test('missing or explicitly cleared targets return actionable prerequisites before spending CAD attempts',async()=>{
 for(const cleared of [false,true]){
  const f=fixture();let reads=0
  f.opts.makeLookup=()=>createProjectLookup('A',async()=>{reads++;return {data:{records:cleared?[{id:'area',revision:2,solution_id:null}]:[],related:[],truncated:false},error:null}},1000,40)
  const a=createCadAssistant(f.opts)
  assert.equal((await a.consult({...request,area_id:cleared?'area':null})).status,'prerequisite_required')
  assert.equal(reads,1,'a cleared area target must not silently fall back to the project target')
  assert.equal(a.remaining,2);assert.equal(f.seen.length,0)
  assert.deepEqual(a.requiredTools,['save_project_solution','select_project_target'])
 }
})

test('CAD research has a bounded stage and exact measurement verification remains available after it',async()=>{
 const f=fixture();let calls=0,renders=0
 f.opts.makeLookup=()=>createProjectLookup('A',async(_p,i)=>({data:{records:i.dataset==='target'?[{id:'project',revision:1,solution_id:id}]:i.dataset==='measurements'?[{id,revision:1}]:[],related:[],truncated:false},error:null}),1000,4)
 f.opts.callModel=async(o:any)=>{
  calls++
  if(calls<=3)return response('search_project_data',{dataset:'tasks',query:null,status:null,area_id:null,record_id:null,after_id:null})
  assert(!o.tools.some((t:any)=>t.function.name==='search_project_data'))
  return calls===4?response('render_cad_candidate',{...candidate,measurements:[{id,revision:1}]}):response()
 }
 f.opts.render=async r=>{renders++;return {recipe:r,manifest:{},files:{}}}
 const a=createCadAssistant(f.opts)
 assert.equal((await a.consult(request)).status,'ready');assert.equal(renders,1);assert.equal(calls,5)
 assert(a.sources.some(s=>s.dataset==='measurements'&&s.recordId===id))
})

test('CAD cannot render against an invented target revision',async()=>{
 const f=fixture();let calls=0,renders=0
 f.opts.callModel=async()=>calls++===0?response('render_cad_candidate',{...candidate,target_revision:9}):response()
 f.opts.render=async r=>{renders++;return {recipe:r,manifest:{},files:{}}}
 const a=createCadAssistant(f.opts)
 assert.equal((await a.consult(request)).status,'incomplete');assert.equal(renders,0)
})

function imageFixture(){
 const f=fixture(),reads:string[]=[],sources:any[]=[];let downloads=0
 const row:MediaRow={id,project_id:'A',title:'Earlier cabinet concept',purpose:'reference',state:'ready',content_type:'image/png',
  byte_size:8,width:2,height:2,bucket_id:'bob-project-media',object_path:`A/${id}`,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'}
 const context=()=>createProjectContext({hasAccess:f.opts.hasAccess,sources,adapters:[createMediaAdapter('A',{
  count:async()=>1,list:async()=>[row],read:async key=>key===id?{...row}:null,
  download:async()=>{downloads++;return Uint8Array.from([137,80,78,71,13,10,26,10])},
 })]})
 f.opts.makeLookup=()=>createProjectLookup('A',async(_p,input)=>{
  reads.push(input.dataset)
  return {data:{records:input.dataset==='target'?[{id:'project',revision:1,solution_id:id}]
   :input.dataset==='project'?[{id:'A',description:'Current design: 1320 mm wide; access opening on the room-facing edge.'}]
   :input.dataset==='measurements'?[{id,revision:2,subject:'Current width',value:'1320',unit:'mm',truth:'provided_spec'}]:[],related:[],truncated:false},error:null}
 },1000,40)
 return {...f,row,reads,sources,context,get downloads(){return downloads}}
}

test('CAD receives Bob-selected original pixels beside fresh project facts after Bob has consumed the carrier',async()=>{
 const f=imageFixture(),parent=f.context(),child=f.context()
 await parent.execute('open_project_item',{refs:[`image:${id}`]})
 parent.confirmDelivery()
 assert.deepEqual(parent.carrier(),[])
 const a=createCadAssistant({...f.opts,context:child,referenceImageRefs:()=>parent.openedImageRefs()})
 assert.equal((await a.consult(request)).status,'ready')
 assert.equal(f.downloads,2,'the specialist reopens through its own authorised adapter')
 assert(hasImageContent(f.seen[0].messages),'a parent caption/brief is not a substitute for actual pixels')
 const reminder=String(f.seen[0].messages.at(-1).content)
 assert.match(reminder,/1320/);assert.match(reminder,/room-facing edge/);assert.match(reminder,/provided_spec/)
 assert.equal(f.reads[0],'target');assert(f.reads.filter(x=>x==='project').length>=2);assert.equal(f.reads.filter(x=>x==='project').length,f.reads.filter(x=>x==='measurements').length)
 assert(hasImageContent(f.seen[1].messages));assert.equal(f.seen[1].previousResponseId,'resp')
 assert(a.sources.some(s=>s.dataset==='measurements'&&s.recordId===id))
})

test('an unavailable selected reference stops CAD instead of silently inventing the missing layout',async()=>{
 const f=imageFixture(),parent=f.context()
 await parent.execute('open_project_item',{refs:[`image:${id}`]});parent.confirmDelivery()
 f.row.state='deleting'
 const a=createCadAssistant({...f.opts,context:f.context(),referenceImageRefs:()=>parent.openedImageRefs()})
 const result=await a.consult(request)
 assert.equal(result.status,'unavailable');assert.equal(result.stage,'reference_images')
 assert.equal(f.seen.length,0);assert.equal(f.downloads,1);assert.equal(a.candidate,null)
})

test('images independently opened by CAD also get current measurements on their delivery call',async()=>{
 const f=imageFixture();let calls=0
 f.opts.callModel=async o=>{
  f.seen.push(o);calls++
  if(calls===1)return response('open_project_item',{refs:[`image:${id}`]})
  if(calls===2){assert(hasImageContent(o.messages));assert.match(String(o.messages!.at(-1)!.content),/1320/);return response('render_cad_candidate',candidate)}
  return response()
 }
 const a=createCadAssistant({...f.opts,context:f.context()})
 assert.equal((await a.consult(request)).status,'ready');assert.equal(f.downloads,1)
 assert.equal(f.reads[0],'target');assert(f.reads.filter(x=>x==='project').length>=2);assert.equal(f.reads.filter(x=>x==='project').length,f.reads.filter(x=>x==='measurements').length)
})

test('revoked reference evidence blocks the next CAD model call and invalidates the candidate',async()=>{
 const f=imageFixture()
 f.opts.render=async recipe=>{f.row.state='deleting';return {recipe,manifest:{},files:{}}}
 const a=createCadAssistant({...f.opts,context:f.context(),referenceImageRefs:()=>[`image:${id}`]})
 await assert.rejects(a.consult(request),/project_denied/)
 assert.equal(f.seen.length,1,'do not send another provider call against revoked evidence')
 assert.equal(a.candidate,null)
})

test('invalid geometry reports the exact missing field without spending a render; designer sees the corrected render pixels',async()=>{
 const f=fixture();let calls=0,renders=0
 const broken=structuredClone(candidate);delete (broken.recipe.definitions[0] as any).y_mm
 f.opts.render=async r=>{renders++;return {recipe:r,manifest:{bounding_box_mm:{size:[800,600,1800]},instances:r.instances},files:{front:'fixture'},previews:{front:'cGl4ZWxz'}}}
 f.opts.callModel=async(o:any)=>{
  if(++calls===1)return response('render_cad_candidate',broken)
  if(calls===2){const result=JSON.parse(o.messages[0].content);assert.equal(result.status,'invalid');assert(result.issues.some((i:any)=>i.path==='recipe.definitions[0].y_mm'));assert.equal(result.renders_remaining,4);return response('render_cad_candidate',candidate)}
  assert(hasImageContent(o.messages));assert(o.messages.some((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url'&&p.image_url.url==='data:image/png;base64,cGl4ZWxz')))
  return response()
 }
 const result=await createCadAssistant(f.opts).consult(request)
 assert.equal(result.status,'ready');assert.equal(renders,1);assert.equal(calls,3)
})
test('designer retains research tools beyond three calls and can investigate a problem after rendering',async()=>{
 const f=fixture();let calls=0
 f.opts.callModel=async(o:any)=>{
  calls++
  if(calls<=4||calls===6){assert(o.tools.some((t:any)=>t.function.name==='search_project_data'));return response('search_project_data',{dataset:'tasks',query:null,status:null,area_id:null,record_id:null,after_id:null})}
  if(calls===5)return response('render_cad_candidate',candidate)
  return response()
 }
 assert.equal((await createCadAssistant(f.opts).consult(request)).status,'ready');assert.equal(calls,7)
})
