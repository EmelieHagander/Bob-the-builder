import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
import {callWithCalculator} from '../supabase/functions/_shared/calculator-model-call.ts'
import {createProjectCalculator} from '../supabase/functions/_shared/project-calculator.ts'
import {catalogFixture,catalogCall} from './support/ai-catalog-fixture.ts'

const verdict={ready_to_save:false,summary:'Concept only',issues:[]}
const graph={calculation:{method:'parameter_graph_v1',nodes:[
 {id:'span',role:'decision',value:10,unit:'mm',reason:'Synthetic explicit span'},
 {id:'clearance',role:'decision',value:3,unit:'mm',reason:'Synthetic explicit clearance'},
 {id:'inside',role:'derived',operation:'subtract_v1',operands:['span','clearance'],rounding:'exact'},
],outputs:['inside']}}
const base={app:'bob',module:'living-plan',coworkerId:'bob',aiFunction:'plan-reviewer',functionName:'plan-reviewer',catalogRoleKey:'plan-reviewer',catalogSchemaKey:'bob_plan_review',prompt:'Review this synthetic plan.'}
const usage={input_tokens:20,output_tokens:10,total_tokens:30}
const toolResponse={id:'r1',status:'completed',output:[{type:'function_call',call_id:'calc1',name:'calculate_project',arguments:JSON.stringify(graph)}],usage}
const textResponse=(content=JSON.stringify(verdict))=>({id:'r2',status:'completed',output_text:content,usage})
let wireSequence=0

async function wire(work:(service:any,requests:any[],ledger:any[])=>Promise<void>,responses:any[],durable=false){
 const g=globalThis as any,oldFetch=g.fetch,oldDeno=g.Deno
 const requests:any[]=[],ledger:any[]=[];let replay=0
 g.__calculatorWireClient=()=>({from:(table:string)=>{
  let modelName=''
  const q:any={select:()=>q,eq:(key:string,value:string)=>{if(key==='model_name')modelName=value;return q},in:()=>q,
   insert:async(row:any)=>{ledger.push(row);return {error:null}},then:(yes:any,no:any)=>Promise.resolve({data:table==='ai_models'?[{model_name:modelName,is_active:true}]:[{module_id:'living-plan',is_enabled:true}],error:null}).then(yes,no)}
  return q
 },rpc:(name:string)=>({abortSignal:async()=>{
  assert.equal(name,'ai_job_reserve');const response=responses[replay++]
  return {data:{id:'22222222-2222-4222-8222-222222222222',submit:false,status:'completed',response_id:response.id,response,
   accounting:{model:'fixture-mini-model',input_price_per_1m:1,output_price_per_1m:2,cached_price_per_1m:null}},error:null}
 }})})
 g.Deno={env:{get:(key:string)=>({OPENAI_API_KEY:'fixture',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'} as any)[key]}}
 g.fetch=async(url:string,init:RequestInit)=>{
  assert(!durable,'completed durable results must not resubmit')
  assert.equal(url,'https://api.openai.com/v1/responses');requests.push(JSON.parse(String(init.body)))
  assert(responses[requests.length-1],'unexpected extra provider call')
  return Response.json(responses[requests.length-1])
 }
 try{
  let source=await readFile(new URL('../supabase/functions/_shared/openai-service.ts',import.meta.url),'utf8')
  source=source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/,'const createClient = (globalThis as any).__calculatorWireClient;')
  for(const file of ['openai-content','ai-background','ai-catalog','schema-issues'])source=source.replace(`'./${file}.ts'`,JSON.stringify(new URL(`../supabase/functions/_shared/${file}.ts`,import.meta.url).href))
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  const service=await import('data:text/javascript;base64,'+Buffer.from(compiled+'\n// wire '+(++wireSequence)).toString('base64'))
  await work(service,requests,ledger)
 }finally{g.fetch=oldFetch;g.Deno=oldDeno;delete g.__calculatorWireClient}
}

function calculator(){
 const unavailable=async()=>{throw new Error('unexpected source read')}
 return createProjectCalculator({projectId:'A',hasAccess:async()=>true,readSources:async()=>({project:new Map(),physical:new Map()}),readSource:unavailable,readConstruction:unavailable,quotePacks:unavailable})
}

for(const calculate of [false,true])test('actual provider wire preserves strict JSON with optional calculator: '+(calculate?'one tool continuation':'one direct verdict'),async()=>{
 await wire(async(service,requests,ledger)=>{
  const catalog=catalogFixture(),calc=calculator()
  const result=await callWithCalculator(base,{catalog,calculator:calc,hasAccess:async()=>true,deadline:Date.now()+10000,callModel:catalogCall(service.callOpenAIResponses,catalog)})
  assert.deepEqual(result.data,verdict);assert.equal(result.success,true)
  assert.equal(requests.length,calculate?2:1);assert.equal(ledger.length,requests.length)
  assert.equal(calc.remaining,calculate?11:12)
  for(const request of requests){
   assert.equal(request.text.format.name,'bob_plan_review');assert.equal(request.text.format.strict,true)
   assert.equal(request.text.format.type,'json_schema');assert.equal(request.text.format.schema.additionalProperties,false)
   assert.equal(request.tools[0].name,'calculate_project');assert.equal(request.reasoning.effort,catalog.role('plan-reviewer').reasoningEffort)
   assert.equal(request.max_output_tokens,catalog.role('plan-reviewer').maxOutputTokens)
  }
  assert.equal(requests[0].previous_response_id,undefined)
  assert.equal(requests[0].input.length,1);assert.equal(requests[0].input[0].content[0].text,base.prompt)
  if(calculate){
   assert.equal(requests[1].previous_response_id,'r1');assert.equal(requests[1].input.length,1)
   const output=requests[1].input[0];assert.equal(output.type,'function_call_output');assert.equal(output.call_id,'calc1')
   const result=JSON.parse(output.output);assert.equal(result.outputs[0].value,7);assert.equal(result.outputs[0].unit,'mm')
   assert.equal(result.saved,false);assert.equal(result.method.version,1)
  }
 },calculate?[toolResponse,textResponse()]:[textResponse()])
})

test('completed durable calculator and structured verdict replay without provider dispatch or duplicate charges',async()=>{
 await wire(async(service,requests,ledger)=>{
  const catalog=catalogFixture(),calc=calculator();let calls=0
  const result=await callWithCalculator(base,{catalog,calculator:calc,hasAccess:async()=>true,deadline:Date.now()+10000,
   callModel:catalogCall(o=>service.callOpenAIResponses({...o,background:{key:'fixture/'+calls++,fingerprint:'a'.repeat(64),receiver:'bob',context:{jobId:'22222222-2222-4222-8222-222222222222'},expiresAt:'2030-01-01T00:00:00Z'}}),catalog)})
  assert.deepEqual(result.data,verdict);assert.equal(calls,2);assert.equal(calc.remaining,11)
  assert.equal(requests.length,0);assert.equal(ledger.length,0)
 },[toolResponse,textResponse()],true)
})

for(const content of ['```json\n'+JSON.stringify(verdict)+'\n```','{"ready_to_save":false','{"ready_to_save":"false","summary":"Invalid","issues":[]}','{"summary":"Missing field","issues":[]}'])test('structured tools reject unusable verdict without a repair call: '+content.slice(0,24),async()=>{
 await wire(async(service,requests,ledger)=>{
  const catalog=catalogFixture()
  const result=await callWithCalculator(base,{catalog,calculator:calculator(),hasAccess:async()=>true,deadline:Date.now()+10000,callModel:catalogCall(service.callOpenAIResponses,catalog)})
  assert.equal(result.success,false);assert.equal(result.error,'invalid_structured_output');assert.equal(result.data,null)
  assert.equal(requests.length,1);assert.equal(ledger.length,1);assert.equal(ledger[0].success,false)
 },[textResponse(content)])
})

test('shared legacy tool callers retain their text contract unless the server opts into structured tools',async()=>{
 await wire(async(service,requests)=>{
  const catalog=catalogFixture(),o={...base,tools:calculator().tools}
  const legacy=await catalogCall(service.callOpenAIResponses,catalog)(o)
  assert.equal(legacy.data,JSON.stringify(verdict));assert.equal(requests[0].text,undefined)
  const strict=await catalogCall(service.callOpenAIResponses,catalog)({...o,structuredToolOutput:true})
  assert.deepEqual(strict.data,verdict);assert.equal(requests[1].text.format.strict,true)
 },[textResponse(),textResponse()])
})
