import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { AIBackgroundPending } from '../supabase/functions/_shared/ai-background.ts'

test('actual shared AI service opts into background, resumes tools and preserves synchronous callers', async () => {
 const g=globalThis as any, oldFetch=g.fetch,oldDeno=g.Deno
 const ledger:any[]=[],requests:any[]=[];let stored:any=null,reserved=false,downloads=0
 const model={model_name:'fixture-model',supports_images:true,supports_reasoning:true,is_default:true,max_output_tokens:8000,input_cost_per_1m_tokens:2,output_cost_per_1m_tokens:10,cached_input_cost_per_1m_tokens:.5}
 const id='22222222-2222-4222-8222-222222222222'
 const client={from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,insert:async(row:any)=>{ledger.push(row);return {error:null}},then:(yes:any,no:any)=>Promise.resolve({data:table==='ai_models'?[model]:[],error:null}).then(yes,no)};return q},rpc:(name:string,args:any)=>({abortSignal:async()=>{
  if(name==='ai_job_reserve'){const submit=!reserved;reserved=true;return {data:{id,submit,status:stored?'completed':'pending',response_id:submit?null:'resp_background',response:stored},error:null}}
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
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  const service=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
  const base={app:'bob',coworkerId:'bob',functionName:'cad-designer',aiFunction:'cad-designer',module:'cad',prompt:'Draw',previousResponseId:'resp_prior',reasoningEffort:'high',tools:[{type:'function',function:{name:'render_cad_candidate',description:'Render',parameters:{type:'object',properties:{},required:[]}}}]}
  const background={key:'job/cad/0',fingerprint:'a'.repeat(64),receiver:'bob',context:{jobId:id},expiresAt:'2030-01-01T00:00:00Z'}
  const vision={...base,messages:[{role:'user',content:[{type:'image_url',image_url:'private-image:fixture/revision'}]}],
    resolveImage:async(ref:string)=>{assert.equal(ref,'private-image:fixture/revision');downloads++;return 'data:image/png;base64,iVBORw0KGgo='}}
  await assert.rejects(()=>service.callOpenAIResponses({...vision,background}),AIBackgroundPending)
  assert.equal(downloads,1);assert.equal(requests[0].input[0].content[0].image_url,'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(ledger.length,0,'pending acceptance is not a zero-cost completion')
  assert.equal(requests[0].previous_response_id,'resp_prior');assert.equal(requests[0].reasoning.effort,'high');assert.equal(requests[0].tools[0].name,'render_cad_candidate')
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
 } finally {g.fetch=oldFetch;g.Deno=oldDeno;delete g.__backgroundClient}
})
