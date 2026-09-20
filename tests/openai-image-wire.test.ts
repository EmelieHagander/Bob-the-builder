import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Execute the production shared service, replacing ONLY external DB/provider I/O.
// This catches the real messages[] path dropping pixels, not just a helper regression.
test('actual shared service serializes image input with tool pairing, checks catalogue capability and redacts provider errors', async () => {
  const g=globalThis as any, oldFetch=g.fetch, oldDeno=g.Deno
  const oldLog=console.log, oldError=console.error, captured:string[]=[]
  const requests:any[]=[], ledger:any[]=[]
  const model={model_name:'fixture-model',supports_images:true,supports_reasoning:false,supports_image_output:false,is_default:true,max_output_tokens:8000,input_cost_per_1m_tokens:1,output_cost_per_1m_tokens:1,cached_input_cost_per_1m_tokens:null}
  g.__bobImageWireClient=()=>({from:(table:string)=>{
    const query:any={ select:()=>query,eq:()=>query,in:()=>query,insert:async(row:any)=>{ledger.push(row);return {error:null}},
      then:(yes:any,no:any)=>Promise.resolve({data:table==='ai_models'?[model]:[],error:null}).then(yes,no) }
    return query
  }})
  g.Deno={env:{get:(name:string)=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',OPENAI_API_KEY:'fixture-provider'} as any)[name]}}
  console.log=(...a)=>captured.push(a.join(' '));console.error=(...a)=>captured.push(a.join(' '))
  let failProvider=false
  g.fetch=async (url:string,init:RequestInit)=>{
    assert.equal(url,'https://api.openai.com/v1/responses')
    requests.push(JSON.parse(String(init.body)))
    return failProvider?new Response('secret data:image/png;base64,SHOULD_NOT_LEAK',{status:400}):Response.json({id:'resp_visual',output_text:'Seen.',usage:{input_tokens:100,output_tokens:5,total_tokens:105}})
  }
  try{
    let source=await readFile(new URL('../supabase/functions/_shared/openai-service.ts',import.meta.url),'utf8')
    source=source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/, 'const createClient = (globalThis as any).__bobImageWireClient;')
    source=source.replace("'./openai-content.ts'",JSON.stringify(new URL('../supabase/functions/_shared/openai-content.ts',import.meta.url).href))
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
    const service=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
    const data='data:image/png;base64,iVBORw0KGgo='
    const options={app:'bob',coworkerId:'bob',functionName:'ask-bob',aiFunction:'ask-bob',module:'global',previousResponseId:'resp_tools',messages:[
      {role:'tool',tool_call_id:'open_1',content:'{"mode":"image_open"}'},
      {role:'user',content:[{type:'text',text:'image:fixture'},{type:'image_url',image_url:data}]},
    ]}
    assert((await service.callOpenAIResponses(options)).success)
    assert.deepEqual(requests[0].input[0],{type:'function_call_output',call_id:'open_1',output:'{"mode":"image_open"}'})
    assert.deepEqual(requests[0].input[1].content[1],{type:'input_image',image_url:data,detail:'auto'})
    assert.equal(requests[0].previous_response_id,'resp_tools')
    assert.equal(ledger.length,1);assert.doesNotMatch(JSON.stringify(ledger),/base64|image:fixture/)
    model.supports_images=false
    assert(!(await service.callOpenAIResponses(options)).success);assert.equal(requests.length,1,'Unsupported image model never called')
    model.supports_images=true;failProvider=true
    const failed=await service.callOpenAIResponses(options)
    assert(!failed.success);assert.doesNotMatch(failed.error,/SHOULD_NOT_LEAK/)
    assert.doesNotMatch(captured.join('\n'),/SHOULD_NOT_LEAK|iVBORw0KGgo=/)
  }finally{g.fetch=oldFetch;g.Deno=oldDeno;delete g.__bobImageWireClient;console.log=oldLog;console.error=oldError}
})
