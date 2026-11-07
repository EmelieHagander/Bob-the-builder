import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createWorkerOperations,workerOperationSpec,OPERATION_REF_PATTERN,type OperationEntry} from '../supabase/functions/_shared/worker-operations.ts'
import {runWorker,type WorkerDefinition} from '../supabase/functions/_shared/bob-workers.ts'
import {anthropicRequestBody} from '../supabase/functions/_shared/anthropic-service.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import type {AiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'
import type {OpenAIServiceOptions,OpenAIServiceResponse} from '../supabase/functions/_shared/openai-service.ts'

// Owner decision 2026-11-07 (stable_tools_version 1). Bed, 09:04:37 and
// 09:06:27: two Konrad calls read nothing from cache (95k and 77k tokens),
// because the operation refs were an enum inside the tool schemas and changed
// when a read or save added one; the source_ref field also came and went with
// the job's binding. Each Konrad job start paid 46-60k tokens uncached.
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002'
const entries:Omit<OperationEntry,'ref'>[]=[{kind:'construction',id:A,revision:3,label:'Frame',target_revision:7,area_id:null}]
const bindings=catalogFixture().definition('bob.tools','tool_contract').definition.worker_operation_bindings as any
const ops=(stableRefs:boolean)=>createWorkerOperations({version:2,bindings,projectId:'p',hasAccess:async()=>true,...(stableRefs?{stableRefs:true}:{}),
 load:async()=>({status:'ready',source:null,entries}),validateMany:async()=>true,prepareDrawing:async()=>({status:'ready'}),drawingArguments:raw=>raw as any,drawingWork:()=>undefined})
const spec=(name:string)=>({type:'function' as const,function:{name,description:name,parameters:structuredClone(catalogFixture().definition('tools.'+name,'tool_contract').definition.parameters as any)}})

test('stable reference fields keep one schema when refs are added and when the job binds its construction',async()=>{
 const f=ops(true);await f.prepare('structure',[])
 const shape=()=>['edit_construction_parts','read_construction_draft','check_construction_draft','save_construction_draft'].map(n=>JSON.stringify(workerOperationSpec(spec(n),f.surface('structure'))))
 const before=shape()
 const edit=workerOperationSpec(spec('edit_construction_parts'),f.surface('structure')).function.parameters as any
 assert.deepEqual(edit.properties.source_ref,{type:['string','null'],pattern:OPERATION_REF_PATTERN,description:'Server-issued construction reference from operation_context or returned operation_refs.'})
 assert(!JSON.stringify(edit).includes('"enum":["op_'),'no list of refs in the schema')
 // A read lists another construction; a save binds the job and adds a revision.
 await f.observe('structure','read_construction_draft',{},{status:'ok',projectId:'p',items:[{id:B,revision:2,title:'Roof'}]})
 const bound=await f.before('structure','edit_construction_parts',{changes:{},source_ref:f.describe('structure').selections[0].ref})
 assert.equal(bound.status,'ready')
 await f.observe('structure','edit_construction_parts',bound.args!,{status:'saved',receipt:{projectId:'p',recordId:A,revision:4,label:'Frame'}})
 assert.deepEqual(shape(),before,'the same schemas after new refs and after binding')
 // Bound: null keeps the job's construction; another construction is refused.
 assert.equal((await f.before('structure','edit_construction_parts',{changes:{},source_ref:null})).args?.expected_revision,4)
 const roof=f.describe('structure').selections.find(s=>s.label==='Roof')!.ref
 assert.equal((await f.before('structure','edit_construction_parts',{changes:{},source_ref:roof})).reason,'operation_scope_changed')
 // Unpinned jobs keep their enums.
 const old=ops(false);await old.prepare('structure',[])
 assert.match(JSON.stringify(workerOperationSpec(spec('edit_construction_parts'),old.surface('structure'))),/"enum":\["op_/)
})

test('an unknown reference is refused with the current ones listed',async()=>{
 const f=ops(true);await f.prepare('structure',[])
 const r=await f.before('structure','read_construction_draft',{source_ref:'op_'+'0'.repeat(32),view:'parts'})
 assert.equal(r.status,'invalid');assert.equal(r.reason,'operation_reference_required')
 assert.deepEqual(r.available_refs,[{ref:f.describe('structure').selections[0].ref,kind:'construction',label:'Frame'}])
 const plain=ops(false);await plain.prepare('structure',[])
 assert.equal((await plain.before('structure','read_construction_draft',{source_ref:'op_'+'0'.repeat(32),view:'parts'})).available_refs,undefined)
})

const catalog={text:(key:string)=>key} as AiCatalogSession
const worker:WorkerDefinition={role:'role.structure-worker',tool:'ask_structure_worker',tools:['edit_construction_parts','save_construction_draft'],
 reads:['read_construction_draft','read_build_tree','calculate_project'],max_steps:4,
 focus:{version:1,core:['read_construction_draft','edit_construction_parts','save_construction_draft'],optional:['read_build_tree','calculate_project'],optional_limit:1}}
const tool=(name:string)=>({type:'function' as const,function:{name,description:name,parameters:{type:'object'}}})
const reply=(id:string):OpenAIServiceResponse<string>=>({success:true,model:'fixture',responseId:id,data:'Klart.',usage:{input_tokens:1,output_tokens:1,total_tokens:2}})

test('a focused job lists its core tools and workpad first, whatever the catalog order, and marks a cache point after them',async()=>{
 const run=async(stableTools:boolean,pick:string)=>{
  const requests:OpenAIServiceOptions[]=[]
  await runWorker({aiCatalog:catalog,worker,callModel:async r=>{requests.push(r);return reply('w')},userId:'u',job:{job:'Bygg',findings:null},history:[],
   readKnowledge:async()=>({}),readCurrent:async()=>null,hasAccess:async()=>true,deadline:Date.now()+60_000,workpadEnabled:true,
   focus:{pick:async()=>[pick]},...(stableTools?{stableTools:true}:{}),
   session:{prepare:async()=>['calculate_project','read_build_tree','save_construction_draft','update_workpad','read_construction_draft','edit_construction_parts'].map(tool),execute:async()=>({status:'ok'})}})
  return requests[0]
 }
 const one=await run(true,'read_build_tree'),two=await run(true,'calculate_project')
 assert.deepEqual(one.tools!.map(t=>t.function.name),['read_construction_draft','edit_construction_parts','save_construction_draft','update_workpad','read_build_tree'])
 assert.deepEqual(two.tools!.slice(0,4),one.tools!.slice(0,4),'two jobs with different picks share the prefix')
 assert.equal(one.cacheAfterTool,'update_workpad')
 const old=await run(false,'read_build_tree')
 assert.deepEqual(old.tools!.map(t=>t.function.name),['read_build_tree','save_construction_draft','update_workpad','read_construction_draft','edit_construction_parts'])
 assert.equal(old.cacheAfterTool,undefined)
 // The Claude request marks that tool, beside the system prompt and the tail: three of four points.
 const ctx={model:{model_name:'claude-opus-5-5',capabilities:{}},maxOutputTokens:100,systemMessage:'Du är Konrad.'} as any
 const body=await anthropicRequestBody({app:'bob',functionName:'structure-worker',messages:[{role:'user',content:'Bygg'}],tools:one.tools,promptCachePoints:1,cacheAfterTool:'update_workpad'} as any,ctx) as any
 assert.deepEqual(body.tools.map((t:any)=>!!t.cache_control),[false,false,false,true,false])
 const unpinned=await anthropicRequestBody({app:'bob',functionName:'structure-worker',messages:[{role:'user',content:'Bygg'}],tools:one.tools,cacheAfterTool:'update_workpad'} as any,ctx) as any
 assert(unpinned.tools.every((t:any)=>!t.cache_control),'only with the cache-point pin')
})

test('saving a sketch names its construction by the job, never by a typed id; with no construction yet it is a new one',async()=>{
 const withCommit={...bindings,commit_construction_sketch:{schema:[{path:[],hide:['record_id'],refs:[{field:'source_ref',kind:'construction',nullable:true,when:'unbound'}],role:'structure'}]}}
 const f=createWorkerOperations({version:2,bindings:withCommit,projectId:'p',hasAccess:async()=>true,stableRefs:true,
  load:async()=>({status:'ready',source:null,entries}),validateMany:async()=>true,prepareDrawing:async()=>({status:'ready'}),drawingArguments:raw=>raw as any,drawingWork:()=>undefined})
 await f.prepare('structure',[])
 const fresh=await f.before('structure','commit_construction_sketch',{new_key:'shelf',action:'commit',source_ref:null})
 assert.equal(fresh.status,'ready');assert.equal(fresh.args?.record_id,null)
 assert.equal((await f.before('structure','commit_construction_sketch',{record_id:A,action:'commit'})).reason,'operation_identity_is_server_owned')
 const frame=f.describe('structure').selections[0].ref
 const bound=await f.before('structure','commit_construction_sketch',{new_key:null,action:'commit',source_ref:frame})
 assert.equal(bound.args?.record_id,A)
 await f.observe('structure','commit_construction_sketch',bound.args!,{status:'saved',receipt:{projectId:'p',recordId:A,revision:4,label:'Frame'}})
 assert.equal((await f.before('structure','edit_construction_parts',{changes:{},source_ref:null})).args?.expected_revision,4,'the commit advances the job to the saved revision')
 const spec=workerOperationSpec({type:'function',function:{name:'commit_construction_sketch',description:'c',parameters:{type:'object',additionalProperties:false,required:['record_id','new_key'],
  properties:{record_id:{anyOf:[{type:'string'},{type:'null'}]},new_key:{anyOf:[{type:'string'},{type:'null'}]}}}}},f.surface('structure')).function.parameters as any
 assert.deepEqual(Object.keys(spec.properties).sort(),['new_key','source_ref']);assert.deepEqual(spec.required,['new_key','source_ref'])
})
