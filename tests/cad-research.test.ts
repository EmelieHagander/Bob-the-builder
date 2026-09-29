import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { collectCadResearch } from '../supabase/functions/_shared/cad-research.ts'
import { createCadAssistant } from '../supabase/functions/_shared/cad-assistant.ts'
import { createProjectLookup, SEARCH_TOOL } from '../supabase/functions/_shared/project-lookup.ts'
import { handoff, reviewReply } from './support/cad-review-fixture.ts'
const reply=(name?:string,args:unknown={})=>({success:true,data:null,model:'fixture',responseId:'cursor',usage:{input_tokens:1,output_tokens:1,total_tokens:2},...(name?{toolCalls:[{id:'call',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]}:{})})
const assessment={checks:handoff.requirements.map(r=>({id:r.id,status:'known',blocking:false,source_refs:['requirement:'+r.id],action:'none',detail:'Explicit requested concept'})),additional_needs:[]}
const read={dataset:'measurements',query:null,status:null,area_id:null,record_id:null,after_id:null}
const facts={status:'ok',records:[{id:'west.total',revision:2,value:2700,unit:'mm'},{id:'west.parts',revision:1,value:2720,unit:'mm'}],truncated:true,next_cursor:'next-page'}
test('cheap collection is bounded and returns exact conflicting values and pagination, not model prose',async()=>{
 let calls=0
 const result=await collectCadResearch({handoff,userId:'u',messages:[],tools:()=>[SEARCH_TOOL],execute:async()=>facts,hasAccess:async()=>true,deadline:Date.now()+200000,
  callModel:async o=>{calls++;assert.equal(o.functionName,'cad-research');assert.equal(o.outputTokenLimit,3000);assert(!JSON.stringify(o).includes('render_cad_candidate'));return reply('search_project_data',read)}})
 assert.equal(calls,3);assert.deepEqual(result.evidence[0].result,facts);assert.equal(result.truncated,true)
})
test('invented write calls are never executed by the researcher',async()=>{
 let executed=0
 const result=await collectCadResearch({handoff,userId:'u',messages:[],tools:()=>[SEARCH_TOOL],execute:async()=>{executed++;return facts},hasAccess:async()=>true,deadline:Date.now()+200000,callModel:async()=>reply('save_project_measurement',{})})
 assert.equal(executed,0);assert.equal(result.evidence.length,3)
})
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'bed',definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:800,y_mm:600,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const candidate={purpose:'project',recipe,source_artifact_id:null,source_revision:null,part_ids:[],title:'Bed',description:'Concept',assumptions:'Site fit unresolved',target_revision:1,measurements:[]}
const request={brief:'Draw the bed.',handoff,area_id:null,component_id:null,step_id:null,artifact_id:null}
function fixture(){let renders=0
 return {get renders(){return renders},opts:{projectId:'A',userId:'u',hasAccess:async()=>true,deadline:Date.now()+300000,available:true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'s'}]:facts.records,related:[],truncated:false},error:null}),1000,40),
  render:async(r:typeof recipe)=>{renders++;return {recipe:r,manifest:{instances:r.instances},files:{},previews:{front:'pixels',top:'pixels'}}},readArtifact:async()=>null}}
}
test('constructor starts a fresh conversation with original source values after cheap research',async()=>{
 const f=fixture();let research=0,design=0
 const a=createCadAssistant({...f.opts,callModel:async o=>{
  if(o.functionName==='cad-research')return ++research===1?reply('search_project_data',read):reply('finish_cad_research',assessment)
  if(o.functionName==='cad-reviewer')return reviewReply()
  if(++design===1){assert.equal(o.previousResponseId,undefined);assert(JSON.stringify(o.messages).includes('2720'));assert(JSON.stringify(o.messages).includes('2700'));return reply('render_cad_candidate',candidate)}
  return reply()
 }})
 assert.equal((await a.consult(request)).status,'ready');assert.equal(research,2);assert.equal(design,2);assert.equal(f.renders,1)
})
for(const reason of ['preview_unreadable','render_failed','diagnostic'])test(`renderer blocker ${reason} cannot replace the project, invoke review or restart the consultation`,async()=>{
 const f=fixture();let calls=0,reviews=0
 const a=createCadAssistant({...f.opts,research:false,callModel:async o=>{
  if(o.functionName==='cad-reviewer'){reviews++;return reviewReply()}
  if(++calls===1)return reply('render_cad_candidate',candidate)
  assert(o.tools?.some(t=>t.function.name==='report_cad_blocker'))
  return reason==='diagnostic'?reply('render_cad_candidate',{...candidate,purpose:'diagnostic'}):reply('report_cad_blocker',{reason,explanation:'Preview cannot be inspected.'})
 }})
 const result=await a.consult(request);assert.equal(result.stage,'cad_engine');assert.equal(a.candidate,null);assert.equal(reviews,0);assert.equal(f.renders,1)
 assert.deepEqual(await a.consult(request),result);assert.equal(calls,2)
})
test('actual renderer failure stops before another model call',async()=>{
 const f=fixture();let calls=0
 const a=createCadAssistant({...f.opts,research:false,render:async()=>{throw new Error('cad_unavailable')},callModel:async()=>{calls++;return reply('render_cad_candidate',candidate)}})
 assert.equal((await a.consult(request)).stage,'cad_engine');assert.equal(calls,1);assert.equal(a.candidate,null)
})

for(const error of ['model_output_limit','model_reasoning_only','model_unavailable','turn_budget_exhausted'])test(`terminal ${error} prevents repeated research, design and rendering`,async()=>{
 const f=fixture();let calls=0
 const a=createCadAssistant({...f.opts,callModel:async o=>{calls++;return o.functionName==='cad-research'?reply('finish_cad_research',assessment):{...reply(),success:false,error}}})
 const result=await a.consult(request)
 assert.equal(result.stage,'design');assert.equal(result.reason,error);assert.equal(a.remaining,0);assert.equal(a.candidate,null)
 assert.equal(f.renders,0);assert.equal(calls,2);assert.match(String(result.user_message),/CAD-motorn anropades aldrig/)
 assert.deepEqual(await a.consult(request),result);assert.equal(calls,2)
})
test('first layout allows one targeted read batch then requires geometry or a blocker; repair restores research',async()=>{
 const f=fixture();let design=0
 const a=createCadAssistant({...f.opts,callModel:async o=>{
  if(o.functionName==='cad-research')return reply('finish_cad_research',assessment)
  if(o.functionName==='cad-reviewer')return reviewReply()
  design++
  const names=o.tools!.map(t=>t.function.name)
  if(design===1){assert(names.includes('search_project_data'));return reply('search_project_data',read)}
  if(design===2){assert(!names.includes('search_project_data'));assert(names.includes('report_cad_blocker'));return reply('render_cad_candidate',candidate)}
  assert(names.includes('search_project_data'));return reply()
 }})
 assert.equal((await a.consult(request)).status,'ready');assert.equal(f.renders,1);assert.equal(design,3)
})

test('Bob delivers the true design failure without paying for an explanation or another consultation',async()=>{
 const f=fixture();let bobCalls=0,designCalls=0
 const a=createCadAssistant({...f.opts,research:false,callModel:async()=>{designCalls++;return {...reply(),success:false,error:'model_output_limit'}}})
 const result=await runProjectAnswer({projectId:'A',userId:'u',message:'Draw the bed',lookup:f.opts.makeLookup(),hasAccess:async()=>true,cadAssistant:a,
  callModel:async()=>{bobCalls++;assert.equal(bobCalls,1,'no paid explanation or restart');return reply('design_project_cad',request)}})
 assert(result.ok);assert.match(result.answer,/Designern förbrukade sin svarsbudget/);assert.match(result.answer,/CAD-motorn anropades aldrig/)
 assert.equal(result.providerResponseId,undefined,'do not reuse a cursor with unresolved tool outputs')
 assert.equal(result.evidence.partial,true);assert.equal(designCalls,1);assert.equal(f.renders,0)
})
test('review token exhaustion preserves its own stage and cannot restart design',async()=>{
 const f=fixture();let calls=0
 const a=createCadAssistant({...f.opts,research:false,callModel:async o=>{
  calls++;if(o.functionName==='cad-reviewer')return {...reply(),success:false,error:'model_output_limit'}
  return calls===1?reply('render_cad_candidate',candidate):reply()
 }})
 const result=await a.consult(request)
 assert.equal(result.stage,'review');assert.match(String(result.user_message),/Granskaren/);assert.equal(a.candidate,null)
 assert.deepEqual(await a.consult(request),result);assert.equal(calls,3);assert.equal(f.renders,1)
})
