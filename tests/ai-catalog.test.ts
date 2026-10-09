import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createAiCatalogSession, validateAiCall, applyCatalogModelOptions, type AiCatalogManifest, type AiCatalogDefinition, type AiCatalogModel } from '../supabase/functions/_shared/ai-catalog.ts'

const definition = (key: string, kind: AiCatalogDefinition['definition_kind'], body: Record<string, unknown> = {}, content = ''): AiCatalogDefinition => ({ id: key + ':v1', prompt_id: key, prompt_key: key, version: 1, definition_kind: kind, definition_format_version: 1, content, definition: body, metadata: {}, payload_hash: 'fixture-sha' })
const model = (name: string): AiCatalogModel => ({ model_name: name, provider: 'openai', is_active: true, is_default: false, max_output_tokens: 8000, supports_images: true, supports_reasoning: true, supports_image_output: false, input_cost_per_1m_tokens: 1, output_cost_per_1m_tokens: 2, cached_input_cost_per_1m_tokens: .2, capabilities: { provider_adapter: 'openai-responses-v1', reasoning_efforts: ['low','medium','high'], supports_functions: true, supports_json_schema: true } })
function manifest(): AiCatalogManifest {
  return { format_version: 1, app: 'bob', manifest_id: 'manifest-v1', created_at: '2026-10-09T14:00:00Z', models: [model('first-mini')], definitions: [
    definition('role.ask-bob','role',{ prompt_keys: ['bob.persona'], profile_key: 'profile.ask-bob', contract_key: 'contract.ask-bob' }),
    definition('bob.persona','prompt',{},'Du är Bob.'), definition('contract.ask-bob','agent_contract',{}),
    definition('profile.ask-bob','execution_profile',{ tier: 'mini',reasoning_effort: 'low',max_output_tokens: 4000,requirements:{ images: true,functions: true,json_schema: true } }),
    definition('tier.mini','tier_binding',{ tier: 'mini', model_name: 'first-mini' }),
  ] }
}
const session = (snapshot = manifest()) => createAiCatalogSession({rpc: async () => { throw new Error('must not query') }},{app:'bob',manifest:snapshot})

test('one request pins tier model, prompt, reasoning and prices while later requests pick the central upgrade',async()=>{
  const first = manifest(), requests: Record<string,unknown>[] = []
  const catalog = createAiCatalogSession({rpc:async(name,args)=>{ assert.equal(name,'resolve_ai_catalog'); requests.push(args); return {data:first,error:null} }},{app:'bob'})
  await Promise.all([catalog.load(),catalog.load(),catalog.load()])
  assert.equal(requests.length,1)
  const pinned = catalog.role('ask-bob')
  first.models[0].model_name='later-mini'; first.models[0].input_cost_per_1m_tokens=9
  first.definitions.find(d=>d.prompt_key==='tier.mini')!.definition.model_name='later-mini'
  first.definitions.find(d=>d.prompt_key==='bob.persona')!.content='Du är ändrad.'
  assert.equal(catalog.role('ask-bob').model.model_name,'first-mini')
  assert.equal(pinned.model.input_cost_per_1m_tokens,1)
  assert.equal(pinned.systemMessage,'Du är Bob.')
  assert.equal(pinned.reasoningEffort,'low')
  assert.equal(session(first).role('ask-bob').model.model_name,'later-mini')
  assert.throws(()=>{pinned.model.model_name='mutated'},TypeError)
})

test('a resumed request loads its manifest ID and refuses another app snapshot',async()=>{
  const args:Record<string,unknown>[]=[]
  const catalog=createAiCatalogSession({rpc:async(_name,value)=>{args.push(value);return {data:manifest(),error:null}}},{app:'bob',manifestId:'saved-job-manifest'})
  await catalog.load();assert.equal(args[0].p_manifest_id,'saved-job-manifest')
  assert.throws(()=>createAiCatalogSession({rpc:async()=>({data:null,error:null})},{app:'other',manifest:manifest()}),/ai_catalog_invalid/)
})

test('missing definitions and unavailable or incompatible tiers fail before a provider call',()=>{
  for (const [mutate,error] of [
    [(m:AiCatalogManifest)=>{m.definitions=m.definitions.filter(d=>d.prompt_key!=='bob.persona')},'ai_contract_missing'],
    [(m:AiCatalogManifest)=>{m.definitions=m.definitions.filter(d=>d.definition_kind!=='execution_profile')},'ai_profile_missing'],
    [(m:AiCatalogManifest)=>{m.models=[]},'ai_tier_unavailable'],
    [(m:AiCatalogManifest)=>{m.models[0].capabilities.reasoning_efforts=['high']},'ai_profile_incompatible'],
    [(m:AiCatalogManifest)=>{m.models[0].supports_images=false},'ai_profile_incompatible'],
    [(m:AiCatalogManifest)=>{m.models[0].max_output_tokens=1000},'ai_profile_incompatible'],
    [(m:AiCatalogManifest)=>{m.models[0].provider='unknown'},'ai_profile_incompatible'],
  ] as const) { const snapshot=manifest();mutate(snapshot);assert.throws(()=>session(snapshot).role('ask-bob'),new RegExp(error)) }
})

test('a proposed or explicitly disabled role cannot dispatch a provider call',()=>{
  const snapshot=manifest();snapshot.definitions.find(d=>d.definition_kind==='role')!.definition.enabled=false
  assert.throws(()=>session(snapshot).role('ask-bob'),/ai_function_disabled/)
})

test('capability validation covers actual selected tools and images even with a lax profile',()=>{
  const snapshot=manifest();snapshot.models[0].supports_images=false;snapshot.models[0].capabilities.supports_functions=false
  snapshot.definitions.find(d=>d.definition_kind==='execution_profile')!.definition.requirements={}
  const role=session(snapshot).role('ask-bob')
  assert.throws(()=>validateAiCall(role,{app:'bob',images:true}),/ai_profile_incompatible/)
  assert.throws(()=>validateAiCall(role,{app:'bob',tools:true}),/ai_profile_incompatible/)
  assert.throws(()=>validateAiCall(role,{app:'other'}),/ai_profile_incompatible/)
  assert.throws(()=>validateAiCall(role,{app:'bob',imageOutput:true}),/ai_profile_incompatible/)
})

test('prompt interpolation only substitutes declared input and leaves JSON braces literal',()=>{
  const snapshot=manifest(),prompt=snapshot.definitions.find(d=>d.prompt_key==='bob.persona')!
  prompt.content='Du är {{name}}. JSON: {"x":1}. {{undeclared}}';prompt.available_variables=['name']
  const catalog=session(snapshot)
  assert.throws(()=>catalog.role('ask-bob'),/ai_prompt_missing/)
  assert.equal(catalog.role('ask-bob',{name:'Bob'}).systemMessage,'Du är Bob. JSON: {"x":1}. {{undeclared}}')
})

test('response contracts bind exact requirement IDs from a stored schema, retaining its status contract',()=>{
  const snapshot=manifest()
  const schema=definition('schema.review','response_schema',{ name:'review',dynamic_requirements:true,schema:{type:'object',properties:{requirements:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},status:{type:'string',enum:['met','failed']},evidence:{type:'string'}},required:['id','status','evidence']}}}} })
  snapshot.definitions.push(schema)
  const catalog=session(snapshot),bound=catalog.schema('review',{requirement_ids:['r1','r2']}).schema as any
  assert.deepEqual(bound.properties.requirements.required,['r1','r2'])
  assert.deepEqual(bound.properties.requirements.properties.r1.properties.status.enum,['met','failed'])
  assert.equal((catalog.schema('review').schema as any).properties.requirements.type,'array','stored contract remains immutable')
  assert.throws(()=>catalog.schema('review',{requirement_ids:['r1','r1']}),/invalid requirement_ids/)
})

test('the common caller seam replaces stale local tool and output definitions',()=>{
  const snapshot=manifest();snapshot.definitions.push(
    definition('tools.read_project','tool_contract',{name:'read_project',description:'Read scoped facts',parameters:{type:'object',properties:{project_id:{type:'string'}},required:['project_id']},strict:true}),
    definition('schema.reply','response_schema',{schema:{type:'object',properties:{answer:{type:'string'}},required:['answer']}}),
  )
  const result=applyCatalogModelOptions(session(snapshot),{app:'bob',functionName:'ask-bob',catalogSchemaKey:'reply',tools:[{type:'function' as const,function:{name:'read_project',description:'stale',parameters:{type:'string'}}}]}) as any
  assert.equal(result.tools[0].function.description,'Read scoped facts')
  assert.equal(result.tools[0].function.parameters.type,'object')
  assert.equal(result.schema.properties.answer.type,'string')
  assert.equal(result.aiDefinition.tier,'mini')
})

test('profile timeout governs dispatch while a shorter operational segment remains a ceiling',()=>{
  const snapshot=manifest();snapshot.definitions.find(d=>d.definition_kind==='execution_profile')!.definition.timeout_ms=650
  const catalog=session(snapshot)
  assert.equal(applyCatalogModelOptions(catalog,{app:'bob',functionName:'ask-bob',timeoutMs:900}).timeoutMs,650)
  assert.equal(applyCatalogModelOptions(catalog,{app:'bob',functionName:'ask-bob',timeoutMs:250}).timeoutMs,250)
  assert.equal(applyCatalogModelOptions(catalog,{app:'bob',functionName:'ask-bob'}).timeoutMs,650)
})

test('server-only quote fields and category enums survive catalog canonicalization and manual expansion',()=>{
  const snapshot=manifest(),tool=definition('tools.write','tool_contract',{name:'write',description:'Write project fact',additional_description:'Exact write contract',parameters:{type:'object',properties:{category:{type:'string',enum:['all']},request_quote:{type:'string'}},required:['category','request_quote']}})
  tool.metadata={server_fields:['request_quote'],schema_bindings:{'parameters.properties.category.enum':'server.categories'}};snapshot.definitions.push(tool)
  const result=applyCatalogModelOptions(session(snapshot),{app:'bob',functionName:'ask-bob',catalogSchemaParameters:{server_quote:true,categories:['measurements']},catalogToolParameters:{write:{include_manual:true}},tools:[{type:'function' as const,function:{name:'write',description:'stale',parameters:{}}}]})
  const actual=result.tools![0].function
  assert.equal(actual.description,'Write project fact\n\nExact write contract')
  assert.deepEqual(actual.parameters.required,['category'])
  assert.equal((actual.parameters.properties as any).request_quote,undefined)
  assert.deepEqual((actual.parameters.properties as any).category.enum,['measurements'])
})

test('actual shared provider adapter uses pinned tier/prices, rejects override, rechecks disablement and preserves other apps',async()=>{
  const g=globalThis as any,oldFetch=g.fetch,oldDeno=g.Deno,oldLog=console.log,oldTimeout=g.setTimeout
  const requests:any[]=[],ledger:any[]=[],dbReads:string[]=[],timeouts:number[]=[]
  let enabled=true,modelActive=true
  const legacy={...model('legacy-default'),is_default:true}
  g.__catalogWireClient=()=>({from:(table:string)=>{
    let fields=''
    const query:any={select:(value:string)=>{fields=value;return query},eq:()=>query,in:()=>query,insert:async(row:any)=>{ledger.push(row);return {error:null}},then:(yes:any,no:any)=>{
      dbReads.push(table+':'+fields)
      return Promise.resolve({data:table==='ai_models'?(fields==='model_name,is_active'?[{model_name:'first-mini',is_active:modelActive}]:[legacy]):[{module_id:'global',is_enabled:enabled,model:'legacy-default',max_output_tokens:7000,reasoning_effort:'high',prompt_template:'Legacy override'}],error:null}).then(yes,no)
    }}
    return query
  }})
  g.Deno={env:{get:(key:string)=>({OPENAI_API_KEY:'fixture',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'} as any)[key]}}
  g.fetch=async(_url:string,init:RequestInit)=>{requests.push(JSON.parse(String(init.body)));return Response.json({id:'response',output_text:'{"answer":"ok"}',usage:{input_tokens:100,output_tokens:10,total_tokens:110}})}
  g.setTimeout=(callback:any,delay:number,...args:any[])=>{timeouts.push(delay);return oldTimeout(callback,delay,...args)}
  console.log=()=>{}
  try {
    let source=await readFile(new URL('../supabase/functions/_shared/openai-service.ts',import.meta.url),'utf8')
    source=source.replace(/import \{ createClient, SupabaseClient \} from "https:[^\n]+/,'const createClient = (globalThis as any).__catalogWireClient;')
    for(const module of ['openai-content','ai-background','ai-catalog']) source=source.replace("'./"+module+".ts'",JSON.stringify(new URL('../supabase/functions/_shared/'+module+'.ts',import.meta.url).href))
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
    const service=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
    const snapshot=manifest();snapshot.definitions.find(d=>d.definition_kind==='execution_profile')!.definition.timeout_ms=650
    const options={app:'bob',module:'global',aiFunction:'ask-bob',functionName:'ask-bob',coworkerId:'bob',prompt:'Help',aiDefinition:session(snapshot).role('ask-bob'),maxOutputTokens:7000,reasoningEffort:'high',timeoutMs:900,schemaName:'catalog_reply',schema:{type:'object',additionalProperties:false,properties:{answer:{type:'string'}},required:['answer']}}
    const reply=await service.callOpenAIResponses(options)
    assert(reply.success);assert.equal(reply.model,'first-mini');assert.equal(reply.estimatedCostUsd,.00012)
    assert.equal(requests[0].model,'first-mini');assert.equal(requests[0].max_output_tokens,4000);assert.equal(requests[0].reasoning.effort,'low');assert.equal(requests[0].instructions,'Du är Bob.')
    assert.equal(requests[0].text.format.name,'catalog_reply');assert.deepEqual(requests[0].text.format.schema.required,['answer']);assert(timeouts.includes(650),'pinned profile timeout reached actual provider timer')
    assert.deepEqual(dbReads.filter(read=>read.startsWith('ai_models')),['ai_models:model_name,is_active'],'pinned configuration never consults mutable model prices or capabilities')
    const override=await service.callOpenAIResponses({...options,model:'legacy-default'})
    assert.match(override.error,/direct model override/);assert.equal(requests.length,1)
    enabled=false
    const disabled=await service.callOpenAIResponses(options)
    assert.equal(disabled.error,'AI function is disabled');assert.equal(requests.length,1)
    enabled=true
    modelActive=false
    const retired=await service.callOpenAIResponses(options)
    assert.equal(retired.success,false);assert.equal(requests.length,1)
    modelActive=true
    assert((await service.callOpenAIResponses({...options,app:'hearth',aiDefinition:undefined})).success)
    assert.equal(requests[1].model,'legacy-default');assert.equal(requests[1].instructions,'Legacy override');assert.equal(ledger.length,2)
  } finally { g.fetch=oldFetch;g.Deno=oldDeno;g.setTimeout=oldTimeout;delete g.__catalogWireClient;console.log=oldLog }
})
