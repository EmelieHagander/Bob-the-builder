import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runWorker} from '../supabase/functions/_shared/bob-workers.ts'
import {createBobContextContinuation,type ContextSurface} from '../supabase/functions/_shared/bob-context-continuation.ts'
import {applyCatalogModelOptions} from '../supabase/functions/_shared/ai-catalog.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {createGroundedModelCall} from '../supabase/functions/_shared/project-grounding.ts'

test('real worker calls opt into native stage handling, refresh their own gates and unregister on completion',async()=>{
 for(const key of ['structure','materials','drawing']){
  const catalog=catalogFixture(),role=key+'-worker';let refresh:(()=>Promise<ContextSurface>)|undefined,dispatches=0,checks=0,prepares=0
  const manager=createBobContextContinuation({version:1,mainResultReferences:1,imageInputDedupVersion:1,stageContextVersion:1,workerStageContextVersion:1,aiCatalog:catalog,
   refreshSurface:async({role:r})=>{assert.equal(r,role);return refresh?.()},
   callModel:async(request,before)=>{
    await before?.();dispatches++
    assert.equal(request.responseItemsMode,'preserve')
    const resolved=applyCatalogModelOptions(catalog,request)
    assert(resolved.tools!.some(t=>t.function.name==='advance_work_stage'))
    const name=dispatches===1?'read_project_work':'advance_work_stage'
    const args=dispatches===1?{}:{completed_question:'Source inspected',findings:[{source_ref:'call:first',observation:'Requested part found'}],unresolved:['Measurements deferred'],next_step:'Report the result',keep_image_refs:[]}
    const call={id:dispatches===1?'first':'stage',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}
    if(dispatches===3){
     assert(prepares>=3,'a stage refreshed the real worker session')
     assert(JSON.stringify(request.messages).includes('Measurements deferred'))
     assert(!JSON.stringify(request.messages).includes('OLD_TOOL_BODY'))
     return {success:true,responseId:'final',model:'fixture',data:'Source reviewed.',usage:{input_tokens:100,output_tokens:10,total_tokens:110},outputItems:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Source reviewed.'}]}]}
    }
    return {success:true,responseId:'worker'+dispatches,model:'fixture',data:'',usage:{input_tokens:100,output_tokens:10,total_tokens:110},toolCalls:[call],outputItems:[{type:'function_call',call_id:call.id,name,arguments:call.function.arguments}]}
   }})
  const grounded=createGroundedModelCall({groundingInstruction:'Fixtures',projectId:'p',message:'Inspect',lookup:{search:async()=>assert.fail('no pixels')},hasAccess:async()=>true,validateImages:async()=>true,deadline:Infinity,callModel:manager.call})
  const result=await runWorker({aiCatalog:catalog,worker:{role:'role.'+role,tool:'work',tools:[],reads:['read_project_work'],max_steps:4},userId:'u',job:{job:'Inspect the saved part',findings:null},history:[],
   variables:{project_name:'Fixture'},session:{prepare:async()=>{prepares++;return [catalog.tool('read_project_work')]},execute:async()=>({status:'ok',body:'OLD_TOOL_BODY'})},
   readCurrent:async()=>null,readKnowledge:async()=>({current:'source'}),hasAccess:async()=>{checks++;return true},deadline:Infinity,callModel:grounded,stageContext:true,
   registerContextSurface:(r,f)=>{assert.equal(r,role);refresh=f;return()=>{refresh=undefined}}})
  assert.equal(result.status,'ok');assert.equal(dispatches,3);assert(checks>=5);assert.equal(refresh,undefined)
 }
})
