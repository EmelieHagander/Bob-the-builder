import {test} from 'node:test'
import assert from 'node:assert/strict'
import {callWithCalculator} from '../supabase/functions/_shared/calculator-model-call.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const options={app:'bob',module:'living-plan',coworkerId:'bob',aiFunction:'plan-reviewer',functionName:'plan-reviewer',catalogRoleKey:'plan-reviewer',catalogSchemaKey:'bob_plan_review',prompt:'Review the requested work.'}

test('unlimited calculator continuation keeps tools available beyond two rounds and preserves protocol and access',async()=>{
 const catalog=catalogFixture(),tool=catalog.tool('calculate_project')
 let calls=0,executed=0,allowed=true
 const calculator={tools:[tool],remaining:Infinity,offered:async()=>[tool],execute:async()=>{executed++;return {status:'ok',saved:false}}}
 const result=await callWithCalculator(options,{unlimitedWork:true,catalog,calculator,hasAccess:async()=>allowed,deadline:Date.now()+10000,
  callModel:async o=>{
   calls++;assert.deepEqual(o.tools,[tool]);assert.equal(o.structuredToolOutput,true)
   if(calls>1){assert.equal(o.previousResponseId,'r'+(calls-1));assert.equal(o.messages?.[0].role,'tool');assert.equal(o.messages?.[0].tool_call_id,'c'+(calls-1))}
   return calls<=5?{success:true,data:null,responseId:'r'+calls,model:'fixture',usage,toolCalls:[{id:'c'+calls,type:'function',function:{name:'calculate_project',arguments:'{}'}}]}:
    {success:true,data:{ready_to_save:true},responseId:'done',model:'fixture',usage}
  }})
 assert.equal(result.success,true);assert.equal(calls,6);assert.equal(executed,5)
 const invalid=await callWithCalculator(options,{unlimitedWork:true,catalog,calculator,hasAccess:async()=>true,deadline:Date.now()+10000,
  callModel:async()=>({success:true,data:null,responseId:'bad',model:'fixture',usage,toolCalls:[{id:'other',type:'function',function:{name:'unoffered',arguments:'{}'}}]})})
 assert.equal(invalid.error,'calculator_protocol');assert.equal(executed,5)
 allowed=false
 await assert.rejects(callWithCalculator(options,{unlimitedWork:true,catalog,calculator,hasAccess:async()=>allowed,deadline:Date.now()+10000,callModel:async()=>{throw new Error('must not call')}}),/project_denied/)
})

test('unlimited calculator work executes a valid large tool group without serializing unlimited counters',async()=>{
 const catalog=catalogFixture(),tool=catalog.tool('calculate_project');let models=0,executed=0
 const calculator={tools:[tool],remaining:Infinity,offered:async()=>[tool],execute:async()=>{executed++;return {status:'ok',saved:false}}}
 const result=await callWithCalculator(options,{unlimitedWork:true,catalog,calculator,hasAccess:async()=>true,deadline:Infinity,
  callModel:async o=>{
   models++;assert(Number.isFinite(o.timeoutMs));assert.doesNotMatch(JSON.stringify(o),/remaining/)
   if(models===1)return {success:true,data:null,responseId:'group',model:'fixture',usage,
    toolCalls:Array.from({length:7},(_,i)=>({id:'c'+i,type:'function' as const,function:{name:'calculate_project',arguments:JSON.stringify({part:i})}}))}
   assert.equal(o.messages?.length,7);assert.equal(o.previousResponseId,'group')
   return {success:true,data:{ready_to_save:true},responseId:'done',model:'fixture',usage}
  }})
 assert.equal(result.success,true);assert.equal(models,2);assert.equal(executed,7)
})
