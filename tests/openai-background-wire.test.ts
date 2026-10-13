import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createBobModelBudget } from '../supabase/functions/_shared/bob-model-budget.ts'
import { AIBackgroundPending } from '../supabase/functions/_shared/ai-background.ts'
import {INTAKE_SCHEMA} from '../supabase/functions/_shared/cad-intake.ts'

test('actual shared AI service opts into background, resumes tools and preserves synchronous callers', async () => {
 const g=globalThis as any, oldFetch=g.fetch,oldDeno=g.Deno
 const ledger:any[]=[],requests:any[]=[];let stored:any=null,reserved=false,downloads=0
 const model={model_name:'fixture-model',supports_images:true,supports_reasoning:true,is_default:true,max_output_tokens:8000,input_cost_per_1m_tokens:2,output_cost_per_1m_tokens:10,cached_input_cost_per_1m_tokens:.5}
 const id='22222222-2222-4222-8222-222222222222'
 const client={from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,insert:async(row:any)=>{ledger.push(row);return {error:null}},then:(yes:any,no:any)=>Promise.resolve({data:table==='ai_models'?[model]:[],error:null}).then(yes,no)};return q},rpc:(name:string,args:any)=>({abortSignal:async()=>{
  if(name==='ai_job_reserve'){const submit=!reserved;reserved=true;return {data:{id,submit,status:stored?(stored.status==='completed'?'completed':'failed'):'pending',response_id:submit?null:'resp_background',response:stored,accounting:stored?{model:'fixture-model',input_price_per_1m:2,output_price_per_1m:10,cached_price_per_1m:.5}:undefined},error:null}}
  if(name==='ai_job_accept'){assert.equal(args.p_job,id);return {data:true,error:null}}
  throw new Error(name)
 }})}
 g.__backgroundClient=()=>client
 g.Deno={env:{get:(name:string)=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',OPENAI_API_KEY:'fixture-provider'} as any)[name]}}
 g.fetch=async (_url:string,init:RequestInit)=>{
  const request=JSON.parse(String(init.body));requests.push(request)
  return Response.json(request.background?{id:'resp_background',status:'queued',metadata:{ai_job_id:id},output:[]}:{id:'resp_sync',output_text:'Quick answer',usage:{input_tokens:1,output_tokens:1,total_tokens:2}})
 }
 try {
  let source=await readFile(new URL('../supabase/functions/_shared/openai-service.ts',import.meta.url),'utf8')
  source=source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/,'const createClient = (globalThis as any).__backgroundClient;')
  for(const file of ['openai-content','ai-background'])source=source.replace(`'./${file}.ts'`,JSON.stringify(new URL(`../supabase/functions/_shared/${file}.ts`,import.meta.url).href))
  source = source.replace("'./ai-catalog.ts'", JSON.stringify(new URL('../supabase/functions/_shared/ai-catalog.ts', import.meta.url).href))
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  const service=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
  const base={app:'bob',coworkerId:'bob',functionName:'cad-designer',aiFunction:'cad-designer',module:'cad',prompt:'Draw',previousResponseId:'resp_prior',reasoningEffort:'high',tools:[{type:'function',function:{name:'render_cad_candidate',description:'Render',parameters:{type:'object',properties:{},required:[]}}}]}
  const intake=structuredClone(INTAKE_SCHEMA)
  Object.assign(intake.properties.checks.items.properties.source_refs.items,{enum:['requirement:width','measurement-1']})
  ;(base.tools as any[]).push({type:'function',function:{name:'finish_cad_research',description:'Assess',parameters:intake,strict:true}})
  const background={key:'job/cad/0',fingerprint:'a'.repeat(64),receiver:'bob',context:{jobId:id},expiresAt:'2030-01-01T00:00:00Z'}
  const vision={...base,messages:[{role:'user',content:[{type:'image_url',image_url:'private-image:fixture/revision'}]}],
    resolveImage:async(ref:string)=>{assert.equal(ref,'private-image:fixture/revision');downloads++;return 'data:image/png;base64,iVBORw0KGgo='}}
  await assert.rejects(()=>service.callOpenAIResponses({...vision,background}),AIBackgroundPending)
  assert.equal(downloads,1);assert.equal(requests[0].input[0].content[0].image_url,'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(ledger.length,0,'pending acceptance is not a zero-cost completion')
  assert.equal(requests[0].previous_response_id,'resp_prior');assert.equal(requests[0].reasoning.effort,'high');assert.equal(requests[0].tools[0].name,'render_cad_candidate')
  assert.equal(requests[0].tools[0].strict,false,'existing callers keep their wire contract')
  assert.equal(requests[0].tools[1].strict,true,'collector strict opt-in reaches the actual provider request')
  assert.deepEqual(requests[0].tools[1].parameters.properties.checks.items.properties.source_refs.items.enum,['requirement:width','measurement-1'])
  assert.equal(requests[0].tools[1].parameters.properties.checks.items.additionalProperties,false)
  await assert.rejects(()=>service.callOpenAIResponses({...vision,background}),AIBackgroundPending)
  assert.equal(requests.length,1)
  assert.equal(downloads,1,'waiting must not hydrate images')
  stored={id:'resp_background',status:'completed',output:[{type:'function_call',call_id:'render_1',name:'render_cad_candidate',arguments:'{}'}],usage:{input_tokens:100,output_tokens:10,total_tokens:110}}
  const result=await service.callOpenAIResponses({...vision,background})
  assert(result.success);assert.equal(result.toolCalls[0].function.name,'render_cad_candidate');assert.equal(result.responseId,'resp_background')
  assert.equal(requests.length,1);assert.equal(ledger.length,0,'shared durable result was already accounted for by SQL')
  assert.equal(downloads,1,'completed replay must not hydrate images')
  assert((await service.callOpenAIResponses(vision)).success)
  assert.equal(downloads,2,'fresh synchronous request hydrates images too')
  assert.equal(requests.length,2);assert.equal(requests[1].background,undefined);assert.equal(ledger.length,1)
  // An incomplete response can contain a partial function call. It must be
  // billed with its reservation prices but must never reach an app tool.
  for(const status of ['incomplete','failed','cancelled']){
   stored={id:'resp_failed',status,incomplete_details:{reason:'max_output_tokens'},
    output:[{type:'function_call',call_id:'partial',name:'render_cad_candidate',arguments:'{"recipe":'}],
    usage:{input_tokens:35258,input_tokens_details:{cached_tokens:10000},output_tokens:16000,total_tokens:51258,output_tokens_details:{reasoning_tokens:16000}}}
   model.output_cost_per_1m_tokens=99 // catalogue changed after reservation
   const budget=createBobModelBudget(.2)
   const failed=await budget.run(()=>service.callOpenAIResponses({...vision,background}))
   assert.equal(failed.success,false);assert.equal(failed.toolCalls,undefined)
   assert.equal(failed.error,status==='incomplete'?'model_output_limit':'model_response_'+status)
   assert.equal(failed.usage.output_tokens,16000);assert.equal(failed.estimatedCostUsd,.215516)
   assert.equal((await budget.run(async()=>{throw new Error('must not submit another model call')})).error,'turn_budget_exhausted')
   assert.equal(requests.length,2);assert.equal(downloads,2);assert.equal(ledger.length,1,'replayed failures cannot duplicate SQL billing')
  }
  stored={id:'resp_empty',status:'completed',output:[{type:'reasoning'}],usage:{input_tokens:100,output_tokens:200,total_tokens:300,output_tokens_details:{reasoning_tokens:200}}}
  const empty=await service.callOpenAIResponses({...base,background})
  assert.equal(empty.error,'model_reasoning_only');assert.equal(empty.estimatedCostUsd,.0022);assert.equal(empty.usage.reasoning_tokens,200)

 } finally {g.fetch=oldFetch;g.Deno=oldDeno;delete g.__backgroundClient}
})
