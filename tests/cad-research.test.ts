import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectCadResearch } from './support/colleague-catalog-fixture.ts'
import { createProjectLookup, SEARCH_TOOL } from '../supabase/functions/_shared/project-lookup.ts'
import { shapeId, handoff, reviewReply } from './support/cad-review-fixture.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
const reply=(name?:string,args:unknown={})=>({success:true,data:null,model:'fixture',responseId:'cursor',usage:{input_tokens:1,output_tokens:1,total_tokens:2},...(name?{toolCalls:[{id:'call',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]}:{})})
const assessment={checks:handoff.requirements.map(r=>({id:r.id,status:'known',blocking:false,source_refs:['requirement:'+r.id],action:'none',detail:'Explicit requested concept'})),additional_needs:[]}
const read={dataset:'measurements',query:null,status:null,area_id:null,record_id:null,after_id:null}
const facts={status:'ok',records:[{id:'west.total',revision:2,value:2700,unit:'mm'},{id:'west.parts',revision:1,value:2720,unit:'mm'}],truncated:true,next_cursor:'next-page'}
test('live intake rejects invented citations and repairs with exact refs without relaxing physical gaps',async()=>{
 let calls=0
 const result=await collectCadResearch({handoff,userId:'u',messages:[],tools:()=>[],execute:async()=>{throw Error('unexpected read')},hasAccess:async()=>true,deadline:Date.now()+200000,
  initialEvidence:[{tool:'search_project_data',result:facts}],callModel:async o=>{
   calls++
   const schema=o.tools!.find(t=>t.function.name==='finish_cad_research')!.function.parameters as any
   assert.equal(o.tools!.find(t=>t.function.name==='finish_cad_research')!.function.strict,true)
   assert.deepEqual(schema.properties.checks.items.properties.source_refs.items.enum,['requirement:'+shapeId,'west.parts','west.total'])
   assert(JSON.stringify(o.messages).includes('not an input prerequisite'))
   if(calls===1)return reply('finish_cad_research',{...assessment,checks:assessment.checks.map(c=>({...c,source_refs:['user:current_request','measurements']}))})
   const feedback=JSON.parse(String(o.messages!.find(m=>m.role==='tool')!.content))
   assert.equal(feedback.status,'invalid');assert(feedback.allowed_source_refs.includes('requirement:'+shapeId))
   assert.deepEqual(feedback.invalid_source_refs,['user:current_request','measurements'])
   return reply('finish_cad_research',{...assessment,additional_needs:[{id:'width',status:'missing',blocking:true,source_refs:['west.total'],action:'measurement',detail:'Exact width remains unknown'}]})
  }})
 assert.equal(calls,2);assert.equal(result.truncated,false);assert.equal(result.assessment?.additional_needs[0].blocking,true)
})
test('cheap collection is bounded and returns exact conflicting values and pagination, not model prose',async()=>{
 let calls=0
 const result=await collectCadResearch({handoff,userId:'u',messages:[],tools:()=>[SEARCH_TOOL],execute:async()=>facts,hasAccess:async()=>true,deadline:Date.now()+200000,
  callModel:async o=>{calls++;assert.equal(o.functionName,'cad-research');assert.equal(o.outputTokenLimit,6000);assert(!JSON.stringify(o).includes('render_cad_candidate'));return reply('search_project_data',read)}})
 assert.equal(calls,3);assert.deepEqual(result.evidence[0].result,facts);assert.equal(result.truncated,true)
})
test('large citation sets keep server validation without exceeding strict schema enum limits',async()=>{
 const records=Array.from({length:401},(_,i)=>({id:'source-'+i}))
 const result=await collectCadResearch({handoff,userId:'u',messages:[],tools:()=>[],execute:async()=>null,hasAccess:async()=>true,deadline:Date.now()+200000,
  initialEvidence:[{tool:'read',result:records}],callModel:async o=>{
   const finish=o.tools!.find(t=>t.function.name==='finish_cad_research')!.function
   assert.equal(finish.strict,true)
   assert.equal((finish.parameters as any).properties.checks.items.properties.source_refs.items.enum,undefined)
   return reply('finish_cad_research',{...assessment,checks:assessment.checks.map(c=>({...c,source_refs:['source-400']}))})
  }})
 assert.equal(result.truncated,false);assert.deepEqual(result.assessment?.checks[0].source_refs,['source-400'])
})
test('a full 22-check resume fits its catalog-backed answer ceiling without another retry loop',async()=>{
 const completeHandoff={...handoff,requirements:Array.from({length:22},(_,i)=>({id:'requirement_'+i,requirement:'Preserve requested feature '+i,basis:'user_request' as const,source_ref:null}))}
 const full={checks:completeHandoff.requirements.map(r=>({id:r.id,status:'known',blocking:false,source_refs:['requirement:'+r.id],action:'none',detail:'The saved feature is specified.'})),additional_needs:[],execution_issues:[]}
 let calls=0
 const result=await collectCadResearch({handoff:completeHandoff,userId:'u',messages:[],tools:()=>[],execute:async()=>{throw Error('unexpected read')},hasAccess:async()=>true,deadline:Date.now()+200000,callModel:async o=>{
  calls++;assert.equal(o.outputTokenLimit,12800)
  assert(catalogFixture().role('cad-research').maxOutputTokens>=o.outputTokenLimit!)
  assert(o.outputTokenLimit!<=16000)
  return reply('finish_cad_research',full)
 }})
 assert.equal(calls,1);assert.equal(result.truncated,false);assert.equal(result.assessment?.checks.length,22)
})
test('invented write calls are never executed by the researcher',async()=>{
 let executed=0
 const result=await collectCadResearch({handoff,userId:'u',messages:[],tools:()=>[SEARCH_TOOL],execute:async()=>{executed++;return facts},hasAccess:async()=>true,deadline:Date.now()+200000,callModel:async()=>reply('save_project_measurement',{})})
 assert.equal(executed,0);assert.equal(result.evidence.length,3)
})
