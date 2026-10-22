import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createBobModelBudget } from '../supabase/functions/_shared/bob-model-budget.ts'
import { AIBackgroundPending } from '../supabase/functions/_shared/ai-background.ts'
test('actual shared AI service opts into background, resumes tools and preserves synchronous callers', async () => {
 const g=globalThis as any, oldFetch=g.fetch,oldDeno=g.Deno
 const ledger:any[]=[],requests:any[]=[];let stored:any=null,reserved=false,downloads=0
 const model={model_name:'fixture-model',supports_images:true,supports_reasoning:true,is_default:true,max_output_tokens:8000,input_cost_per_1m_tokens:2,output_cost_per_1m_tokens:10,cached_input_cost_per_1m_tokens:.5}
 const id='22222222-2222-4222-8222-222222222222'
 const client={from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,insert:async(row:any)=>{ledger.push(row);return {error:null}},then:(yes:any,no:any)=>Promise.resolve({data:table==='ai_models'?[model]:[],error:null}).then(yes,no)};return q},rpc:(name:string,args:any)=>({abortSignal:async()=>{
  if(name==='ai_job_start_submission')return {data:{submit:true,status:'submitting'},error:null}
  if(name==='ai_job_prepare'){const submit=!reserved;reserved=true;return {data:{id,submit,status:stored?(stored.status==='completed'?'completed':'failed'):'pending',response_id:submit?null:'resp_background',response:stored,accounting:stored?{model:'fixture-model',input_price_per_1m:2,output_price_per_1m:10,cached_price_per_1m:.5}:undefined},error:null}}
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
    source=source.replace("'./schema-issues.ts'",JSON.stringify(new URL("../supabase/functions/_shared/schema-issues.ts",import.meta.url).href))
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  const service=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
  const base={app:'bob',coworkerId:'bob',functionName:'cad-reviewer',aiFunction:'cad-reviewer',module:'cad',prompt:'Draw',previousResponseId:'resp_prior',reasoningEffort:'high',tools:[{type:'function',function:{name:'calculate_project',description:'Render',parameters:{type:'object',properties:{},required:[]}}}]}
  const intake={type:'object',additionalProperties:false,properties:{checks:{type:'array',items:{type:'object',additionalProperties:false,properties:{source_refs:{type:'array',items:{type:'string'}}},required:['source_refs']}}},required:['checks']}
  Object.assign(intake.properties.checks.items.properties.source_refs.items,{enum:['requirement:width','measurement-1']})
  ;(base.tools as any[]).push({type:'function',function:{name:'describe_tool',description:'Assess',parameters:intake,strict:true}})
  const background={key:'job/cad/0',fingerprint:'a'.repeat(64),receiver:'bob',context:{jobId:id},expiresAt:'2030-01-01T00:00:00Z'}
  const vision={...base,messages:[{role:'user',content:[{type:'image_url',image_url:'private-image:fixture/revision'}]}],
    resolveImage:async(ref:string)=>{assert.equal(ref,'private-image:fixture/revision');downloads++;return 'data:image/png;base64,iVBORw0KGgo='}}
  await assert.rejects(()=>service.callOpenAIResponses({...vision,background}),AIBackgroundPending)
  assert.equal(downloads,1);assert.equal(requests[0].input[0].content[0].image_url,'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(ledger.length,0,'pending acceptance is not a zero-cost completion')
  assert.equal(requests[0].previous_response_id,'resp_prior');assert.equal(requests[0].reasoning.effort,'high');assert.equal(requests[0].tools[0].name,'calculate_project')
  assert.equal(requests[0].tools[0].strict,false,'existing callers keep their wire contract')
  assert.equal(requests[0].tools[1].strict,true,'strict opt-in reaches the actual provider request')
  assert.deepEqual(requests[0].tools[1].parameters.properties.checks.items.properties.source_refs.items.enum,['requirement:width','measurement-1'])
  assert.equal(requests[0].tools[1].parameters.properties.checks.items.additionalProperties,false)
  await assert.rejects(()=>service.callOpenAIResponses({...vision,background}),AIBackgroundPending)
  assert.equal(requests.length,1)
  assert.equal(downloads,1,'waiting must not hydrate images')
  stored={id:'resp_background',status:'completed',output:[{type:'function_call',call_id:'render_1',name:'calculate_project',arguments:'{}'}],usage:{input_tokens:100,output_tokens:10,total_tokens:110}}
  const result=await service.callOpenAIResponses({...vision,background})
  assert(result.success);assert.equal(result.toolCalls[0].function.name,'calculate_project');assert.equal(result.responseId,'resp_background')
  assert.equal(requests.length,1);assert.equal(ledger.length,0,'shared durable result was already accounted for by SQL')
  assert.equal(downloads,1,'completed replay must not hydrate images')
  assert((await service.callOpenAIResponses(vision)).success)
  assert.equal(downloads,2,'fresh synchronous request hydrates images too')
  assert.equal(requests.length,2);assert.equal(requests[1].background,undefined);assert.equal(ledger.length,1)
  // An incomplete response can contain a partial function call. It must be
  // billed with its reservation prices but must never reach an app tool.
  for(const status of ['incomplete','failed','cancelled']){
   stored={id:'resp_failed',status,incomplete_details:{reason:'max_output_tokens'},
    output:[{type:'function_call',call_id:'partial',name:'calculate_project',arguments:'{"recipe":'}],
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

  const nativeItems=[
   {type:'reasoning',id:'rs_exact',summary:[],encrypted_content:'opaque-fixture'},
   {type:'message',id:'msg_exact',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'I will read the original.',annotations:[]}]},
   {type:'function_call',id:'fc_exact',call_id:'read_exact',name:'read_record',arguments:'{}',status:'completed'},
  ]
  const finalItems=[{type:'reasoning',id:'rs_final',summary:[],encrypted_content:'opaque-final'},
   {type:'message',id:'msg_final',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'The source remains unmeasured.',annotations:[]}]}]
  const {previousResponseId:_old,...completeBase}=base
  const complete={...completeBase,responseItemsMode:'preserve',responsePhaseMode:'aware',messages:[
   {role:'user',content:'Read the original.'},{role:'assistant',content:'',nativeOutput:nativeItems},
   {role:'tool',tool_call_id:'read_exact',content:'Exact original revision 3'},
   {role:'user',content:[{type:'image_url',image_url:'private-image:fixture/revision'}]},
  ],resolveImage:vision.resolveImage}
  g.fetch=async (_url:string,init:RequestInit)=>{requests.push(JSON.parse(String(init.body)));return Response.json({id:'resp_complete',status:'completed',output:finalItems,usage:{input_tokens:100,output_tokens:20,total_tokens:120}})}
  const completed=await service.callOpenAIResponses(complete)
  assert.equal(completed.success,true);assert.equal(completed.data,'The source remains unmeasured.')
  assert.deepEqual(completed.outputItems,finalItems);assert.equal(completed.outputPhase,'final_answer')
  const wire=requests.at(-1)
  assert.equal(wire.previous_response_id,undefined)
  assert.deepEqual(wire.include,['reasoning.encrypted_content'])
  assert.deepEqual(wire.input.slice(1,4),nativeItems,'native IDs, order and commentary phase survive the real adapter')
  assert.equal(wire.input[4].type,'function_call_output');assert.equal(wire.input[4].call_id,'read_exact')
  assert.equal(wire.input[5].content[0].image_url,'data:image/png;base64,iVBORw0KGgo=')
  stored={id:'resp_native_stored',status:'completed',output:nativeItems,usage:{input_tokens:100,output_tokens:20,total_tokens:120}}
  const replayed=await service.callOpenAIResponses({...complete,background})
  assert.deepEqual(replayed.outputItems,nativeItems);assert.equal(replayed.toolCalls[0].id,'read_exact')
  stored.output=[{type:'reasoning',summary:[]}]
  const missing=await service.callOpenAIResponses({...complete,background})
  assert.equal(missing.success,false);assert.equal(missing.error,'native_reasoning_content_missing');assert.equal(missing.toolCalls,undefined)
  // Provider cache routing hint (2026-10-22): sent only when a caller asks, on both wires.
  const routingKey='bob-ask-'+'b'.repeat(32)
  for(const request of requests)assert.equal(request.prompt_cache_key,undefined,'callers without a routing key keep their exact body')
  await service.callOpenAIResponses({...complete,promptCacheKey:routingKey})
  assert.equal(requests.at(-1).prompt_cache_key,routingKey,'the synchronous wire carries the routing hint')
  reserved=false;stored=null
  g.fetch=async (_url:string,init:RequestInit)=>{const request=JSON.parse(String(init.body));requests.push(request);return Response.json({id:'resp_background',status:'queued',metadata:{ai_job_id:id},output:[]})}
  await assert.rejects(()=>service.callOpenAIResponses({...vision,background,promptCacheKey:routingKey}),AIBackgroundPending)
  assert.equal(requests.at(-1).background,true);assert.equal(requests.at(-1).prompt_cache_key,routingKey,'the durable background submission carries it too')

 } finally {g.fetch=oldFetch;g.Deno=oldDeno;delete g.__backgroundClient}
})
