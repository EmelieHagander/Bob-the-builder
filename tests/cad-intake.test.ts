import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant,RENDER_CAD_TOOL,RENDER_SAVED_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'
import {parseIntakeAssessment,bindMeasuredDimensions,type DrawingRequest,type DrawingRequestStore} from '../supabase/functions/_shared/cad-intake.ts'
import {createProjectContext} from '../supabase/functions/_shared/project-context/dispatcher.ts'
import {createMediaAdapter,type MediaRow} from '../supabase/functions/_shared/project-context/media.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
const id='30000000-0000-4000-8000-000000000001'
const measurement='30000000-0000-4000-8000-000000000002'
const request={request_id:null,handoff,brief:'Draw the construction using current measures',area_id:null,component_id:null,step_id:null,artifact_id:null}
const check=(id:string,status='known',blocking=false)=>({id,status,blocking,source_refs:status==='known'?['requirement:'+id]:[],action:blocking?'measurement':'none',detail:'Whole construction input check'})
const assessment={checks:[check('shape')],additional_needs:[]}
const reply=(name?:string,args:unknown={})=>({success:true,data:null,model:'fixture',responseId:'r',usage:{input_tokens:1,output_tokens:1,total_tokens:2},...(name?{toolCalls:[{id:'c',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]}:{})})
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'bed',definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:999,y_mm:600,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const candidate={purpose:'project',recipe,dimension_bindings:[],title:'Bed',description:'Concept',assumptions:'Unverified site fit',target_revision:1,measurements:[]}
function fixture(){
 let row:DrawingRequest|null=null,target=true,readError=false,design=0,renders=0;const reads:string[]=[]
 const store:DrawingRequestStore={list:async()=>row?[{id:row.id,status:row.status}]:[],load:async key=>key===row?.id?structuredClone(row):null,save:async(key,expected,status,payload)=>{assert.equal(expected,row?.revision??0);assert.equal(key,row?.id??null);row={id,revision:expected+1,status,payload:structuredClone(payload)};return structuredClone(row)}}
 const opts={requestStore:store,projectId:'A',userId:'u',ownerRequest:'Build the whole requested construction.',hasAccess:async()=>true,deadline:Date.now()+300000,available:true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>{reads.push(q.dataset);return {data:{records:q.dataset==='target'&&target?[{id:'project',revision:1,solution_id:'s'}]:q.dataset==='measurements'?[{id:measurement,revision:2,value:'132',unit:'cm',truth:'measured',source:'Measured fixture width'}]:[],related:[],truncated:false},error:readError&&q.dataset==='physical_elements'?{code:'oops'}:null}},1000,40),
  callModel:async(o:any)=>{if(o.functionName==='cad-research')return reply('finish_cad_research',assessment);if(o.functionName==='cad-reviewer')return reviewReply();return ++design===1?reply('render_cad_candidate',candidate):reply()},
  render:async(r:any)=>{renders++;return {recipe:r,manifest:{instances:r.instances},files:{front:'not persisted'},previews:{front:'pixels',top:'pixels'}}},readArtifact:async()=>null}
 return {opts,reads,get row(){return row},get renders(){return renders},get design(){return design},noTarget:()=>{target=false},failRead:()=>{readError=true}}
}
test('intake returns all blocking needs and target prerequisite without invoking designer',async()=>{
 const f=fixture();f.noTarget();const a=createCadAssistant({...f.opts,callModel:async o=>{assert.equal(o.functionName,'cad-research');return reply('finish_cad_research',{checks:[check('shape','missing',true)],additional_needs:[check('door','missing',true),check('window','conflict',true)]})}})
 const result=await a.consult(request)
 assert.equal(result.status,'needs_data');assert.equal(result.request_id,id);assert.deepEqual(result.gaps?.map(c=>c.id),['shape','door','window','selected_target']);assert.equal(f.renders,0)
 for(const dataset of ['measurements','physical_elements','physical_spaces','plan','tasks'])assert(f.reads.includes(dataset))
 assert.equal(f.row?.status,'needs_data')
})
test('missing sources remain retrieval failures, never invented measurement tasks',async()=>{
 const f=fixture();f.failRead();const result=await createCadAssistant(f.opts).consult(request)
 assert.equal(result.status,'unavailable');assert.equal(result.stage,'intake');assert(result.incomplete?.includes('physical_elements'));assert.deepEqual(result.gaps,[]);assert.equal(f.design,0);assert.equal(f.row?.status,'retrieval_failed')
})
test('complements resume the same request, refresh facts, retain earlier requirements, and save no pixels',async()=>{
 const f=fixture();let blocked=true;const model=f.opts.callModel
 f.opts.callModel=async o=>o.functionName==='cad-research'?reply('finish_cad_research',blocked?{checks:[check('shape','missing',true)],additional_needs:[]}:assessment):model(o)
 const first=await createCadAssistant(f.opts).consult(request);assert.equal(first.status,'needs_data');const reads=f.reads.length;blocked=false
 const a=createCadAssistant(f.opts),second=await a.consult({...request,request_id:id})
 assert.equal(second.status,'ready');assert(f.reads.length>reads);assert.equal(f.row?.id,id);assert.equal(f.row?.status,'reviewed');assert.equal(f.renders,1)
 assert(!JSON.stringify(f.row).includes('pixels'));assert(!JSON.stringify(f.row).includes('not persisted'));assert.deepEqual((f.row?.payload.draft as any).recipe,recipe)
 await a.markSaved();assert.equal(f.row?.status,'saved')
})
test('a partial or fabricated checklist cannot pass readiness',()=>{
 const refs=new Set(['requirement:shape'])
 assert(parseIntakeAssessment(assessment,handoff,refs))
 assert.equal(parseIntakeAssessment({...assessment,checks:[]},handoff,refs),null)
 assert.equal(parseIntakeAssessment({...assessment,checks:[{...check('shape'),source_refs:['imaginary']}]},handoff,refs),null)
 assert.equal(parseIntakeAssessment({...assessment,additional_needs:[check('shape')]},handoff,refs),null)
})
test('new geometry has no saved selection fields; saved selections have no recipe',()=>{
 const fresh=RENDER_CAD_TOOL.function.parameters.properties,saved=RENDER_SAVED_CAD_TOOL.function.parameters.properties
 assert('recipe' in fresh);assert(!('part_ids' in fresh));assert(!('source_artifact_id' in fresh));assert('part_ids' in saved);assert(!('recipe' in saved))
})
test('server binds exact measured values in mm and refuses stale, ambiguous or unpinned input',()=>{
 const records=new Map([[measurement,{id:measurement,revision:2,value:'132',unit:'cm',truth:'measured',source:'Measured fixture width'}]])
 const bindings=[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:2}]
 assert.equal(bindMeasuredDimensions(recipe,bindings,records).definitions[0].x_mm,1320);assert.equal(recipe.definitions[0].x_mm,999)
 assert.throws(()=>bindMeasuredDimensions(recipe,[{...bindings[0],revision:1}],records),/unusable/)
 assert.throws(()=>bindMeasuredDimensions(recipe,bindings,new Map()),/unusable/)
 assert.throws(()=>bindMeasuredDimensions(recipe,[...bindings,...bindings],records),/unusable/)
 assert.throws(()=>bindMeasuredDimensions(recipe,bindings,new Map([[measurement,{revision:2,value:'132-135',unit:'cm'}]])),/unusable/)
})
test('the rendered and independently reviewed candidate uses server-bound measurements',async()=>{
 const f=fixture();let calls=0
 const a=createCadAssistant({...f.opts,callModel:async o=>{
  if(o.functionName==='cad-research')return reply('finish_cad_research',assessment)
  if(o.functionName==='cad-reviewer'){assert(JSON.stringify(o.messages).includes('1320'));return reviewReply()}
  return ++calls===1?reply('render_cad_candidate',{...candidate,dimension_bindings:[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:2}],measurements:[{id:measurement,revision:2}]}):reply()
 }})
 assert.equal((await a.consult(request)).status,'ready');assert.equal((a.candidate!.packet.recipe.definitions[0] as any).x_mm,1320)
})
test('legacy new geometry with grouping part_ids reaches rendering without saved-source ambiguity',async()=>{
 const f=fixture();let calls=0
 const a=createCadAssistant({...f.opts,callModel:async o=>o.functionName==='cad-research'?reply('finish_cad_research',assessment):o.functionName==='cad-reviewer'?reviewReply():++calls===1?reply('render_cad_candidate',{...candidate,source_artifact_id:null,source_revision:null,part_ids:['invented-group']}):reply()})
 assert.equal((await a.consult(request)).status,'ready');assert.equal(f.renders,1);assert.deepEqual(a.candidate?.part_ids,[])
})

test('collector, designer and reviewer see the selected original image while persisted evidence contains refs only',async()=>{
 const f=fixture();let calls=0;const seen:string[]=[]
 const row:MediaRow={id:measurement,project_id:'A',title:'Relevant original reference',purpose:'reference',state:'ready',content_type:'image/png',byte_size:8,width:2,height:2,bucket_id:'bob-project-media',object_path:`A/${measurement}`,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'}
 const context=createProjectContext({hasAccess:f.opts.hasAccess,sources:[],adapters:[createMediaAdapter('A',{count:async()=>1,list:async()=>[row],read:async()=>row,download:async()=>Uint8Array.from([137,80,78,71,13,10,26,10])})]})
 const a=createCadAssistant({...f.opts,context,referenceImageRefs:()=>['image:'+measurement],callModel:async o=>{
  const content=JSON.stringify(o.messages)
  if(o.functionName==='cad-research'){assert(content.includes('image_catalog'));assert(content.includes('data:image/png;base64,iVBORw0KGgo='));seen.push('collector');return reply('finish_cad_research',assessment)}
  if(o.functionName==='cad-reviewer'){assert(content.includes('data:image/png;base64,iVBORw0KGgo='));seen.push('reviewer');return reviewReply()}
  if(++calls===1){assert(content.includes('data:image/png;base64,iVBORw0KGgo='));seen.push('designer');return reply('render_cad_candidate',candidate)}
  return reply()
 }})
 assert.equal((await a.consult(request)).status,'ready');assert.deepEqual(seen,['collector','designer','reviewer']);assert.deepEqual(f.row?.payload.reference_refs,['image:'+measurement]);assert(!JSON.stringify(f.row).includes('base64'))
})
