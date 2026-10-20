import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createToolSession} from '../supabase/functions/_shared/project-tools/session.ts'
import {createBobToolSession,DRAWING_CONTINUATION_PRELOAD} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {bobWorkflows} from '../supabase/functions/_shared/bob-prompt.ts'
import {applyCatalogModelOptions,createAiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'
import {preCompleteContextCatalogFixture as catalogFixture,preSelectiveToolsCatalogFixture} from './support/ai-catalog-fixture.ts'
import {projectSchema} from './support/project-schema.ts'

test('selective methods and exact manuals survive restart without bulk loading or duplicate instructions',async()=>{
 const catalog=catalogFixture(),names=['read_construction_draft','save_construction_draft','check_construction_draft']
 let enabled=true,ready=false,executions=0
 const rows=names.map(name=>({name,description:'Short card',how_to:'manual',schema_version:1,always_load:false,preload_phases:[],active:true}))
 const make=(selective=true)=>createToolSession({toolInstructions:'lazy',selectiveTools:selective,
  catalogTool:(name,p)=>catalog.tool(name,p),catalogWorkflows:()=>bobWorkflows(catalog),
  readPolicy:async()=>({phase:'design',tools:rows.map(r=>({...r,active:enabled}))}),
  definitions:rows.map(r=>({version:1,spec:catalog.tool(r.name),gate:()=>r.name==='check_construction_draft'&&!ready?'missing_context':'available',execute:async()=>{executions++;return {status:'ok'}}}))})
 const s=make();await s.prepare()
 const method=await s.execute('describe_tool',{name:'workflow_construction_drawing'})
 assert.equal(method.method,undefined);assert.deepEqual(method.callable_from_next_step,[])
 assert.match(s.workflowInstructions,/one natural sub-construction at a time/)
 assert.deepEqual((await s.prepare()).map(t=>t.function.name),['describe_tool'])
 const load=await s.execute('describe_tool',{name:'read_construction_draft'})
 assert.equal(load.parameters,undefined);assert.equal(load.manual,undefined)
 assert.equal((await s.execute('read_construction_draft',{})).status,'not_offered')
 await s.execute('describe_tool',{name:'check_construction_draft'})
 const tools=await s.prepare(),snapshot=JSON.parse(JSON.stringify(s.exportState()))
 const next=make();next.restoreState(snapshot);next.resetInstructions()
 assert.equal(next.workflowInstructions,s.workflowInstructions)
 assert.deepEqual(await next.prepare(),tools)
 const request=applyCatalogModelOptions(catalog,{app:'bob',functionName:'ask-bob',catalogRoleKey:'ask-bob',tools,
  catalogSchemaParameters:{card:true,include_manual:false},catalogToolParameters:next.toolParameters()})
 assert.deepEqual(request.tools?.find(t=>t.function.name==='read_construction_draft'),catalog.tool('read_construction_draft',{card:false,include_manual:true}))
 assert.equal((await next.execute('read_construction_draft',{})).status,'ok')
 ready=true;assert.equal((await next.execute('check_construction_draft',{})).status,'not_offered')
 assert((await next.prepare()).some(t=>t.function.name==='check_construction_draft'))
 assert.equal((await next.execute('check_construction_draft',{})).status,'ok')
 enabled=false;assert.equal((await next.execute('read_construction_draft',{})).status,'unavailable');assert.equal(executions,2)
 assert.throws(()=>make(false).restoreState(snapshot),/checkpoint_invalid/)
 next.closeSurface();assert.equal((await next.execute('describe_tool',{name:'workflow_construction_drawing'})).status,'not_offered')
})

test('real Bob registration selects new semantics only for the pinned publication',async()=>{
 for(const [catalog,selective] of [[catalogFixture(),true],[preSelectiveToolsCatalogFixture(),false]] as const){
  const constructionTools=createConstructionTools({projectId:'p',message:'Read',read:async()=>({}),hasAccess:async()=>true,readSources:async()=>({project:new Map(),physical:new Map()})})
  const session=createBobToolSession({message:'Read',aiCatalog:catalog,toolInstructions:'lazy',constructionTools,
   lookup:createProjectLookup('p',async()=>({data:[],error:null}),async()=>({data:[],error:null})),
   readPolicy:async()=>({phase:'design',tools:catalog.definition('bob.tools').definition.catalog as any})})
  await session.prepare();await session.execute('describe_tool',{name:'workflow_construction_drawing'})
  const tools=await session.prepare()
  assert.equal(tools.some(t=>t.function.name==='read_construction_draft'),!selective)
  assert.equal(session.exportState().version,selective?2:1)
 }
})

test('immutable SQL publication matches executable fixture and preserves old manifests',async t=>{
 const pg=await projectSchema(undefined,'20261019180806_ai_selective_tools.sql');t.after(()=>pg.close())
 const m=(await pg.query<any>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
 const sql=createAiCatalogSession({rpc:async()=>{throw Error('pinned')}},{app:'bob',manifest:m}),fixture=catalogFixture(),old=preSelectiveToolsCatalogFixture()
 for(const key of ['bob.workflows','tools.describe_tool','tools.save_construction_draft','bob.toolbox.intro-lazy']){
  const a=sql.definition(key),b=fixture.definition(key);assert.deepEqual(a.definition,b.definition,key);assert.deepEqual(a.metadata,b.metadata,key);assert.equal(a.content,b.content,key)
  assert.equal(a.version,old.definition(key).version+1)
 }
 assert.equal(old.definition('bob.workflows').metadata.selective_tools_version,undefined)
 assert.deepEqual(sql.definition('bob.tools').definition,old.definition('bob.tools').definition,'no policy grants')
 assert(!old.tool('save_construction_draft').function.parameters.properties.recipe.properties.arrays)
 assert(sql.tool('save_construction_draft').function.parameters.properties.recipe.properties.arrays)
})

test('construction workflow no longer expands twenty schemas, while all cards remain discoverable',async t=>{
 const sizes:number[]=[]
 for(const [catalog,selective] of [[preSelectiveToolsCatalogFixture(),false],[catalogFixture(),true]] as const){
  const workflow=bobWorkflows(catalog).find(w=>w.name==='workflow_construction_drawing')!
  const rows=(catalog.definition('bob.tools').definition.catalog as any[]).filter(r=>workflow.tools.includes(r.name))
  const session=createToolSession({toolInstructions:'lazy',selectiveTools:selective,catalogTool:(name,p)=>catalog.tool(name,p),catalogWorkflows:()=>[workflow],readPolicy:async()=>({phase:'design',tools:rows}),
   definitions:rows.map(r=>({version:r.schema_version,spec:catalog.tool(r.name),gate:()=>'available',execute:async()=>assert.fail('only schema selection')}))})
  await session.prepare();await session.execute('describe_tool',{name:workflow.name})
  let offered=await session.prepare();assert.equal(offered.length,selective?1:21)
  assert.equal(session.toolbox.filter(r=>r.name!=='describe_tool').length,rows.length)
  if(selective){await session.execute('describe_tool',{name:'read_construction_draft'});offered=await session.prepare();assert.equal(offered.length,2)}
  sizes.push(new TextEncoder().encode(JSON.stringify(offered)).length)
 }
 assert(sizes[1]<sizes[0]);t.diagnostic(`Native tool bytes: workflow bulk ${sizes[0]}; selective workflow plus one reader ${sizes[1]}. Scripted surface comparison, not model cost evidence.`)
})

test('a pending drawing preloads the construction tools without a describe_tool round',async()=>{
 const catalog=catalogFixture(),names=['read_construction_draft','save_construction_draft','check_construction_draft']
 let ready=false,preload:string[]=[]
 const rows=names.map(name=>({name,description:'Short card',how_to:'manual',schema_version:1,always_load:false,preload_phases:[],active:true}))
 const make=()=>createToolSession({toolInstructions:'lazy',selectiveTools:true,preloadTools:()=>preload,
  catalogTool:(name,p)=>catalog.tool(name,p),catalogWorkflows:()=>bobWorkflows(catalog),
  readPolicy:async()=>({phase:'design',tools:rows}),
  definitions:rows.map(r=>({version:1,spec:catalog.tool(r.name),gate:()=>r.name==='check_construction_draft'&&!ready?'missing_context':'available',execute:async()=>({status:'ok'})}))})
 const idle=make()
 assert.deepEqual((await idle.prepare()).map(t=>t.function.name),['describe_tool'],'no pending drawing: nothing is loaded ahead')
 preload=['read_construction_draft','check_construction_draft','not_a_tool']
 const s=make()
 assert.deepEqual((await s.prepare()).map(t=>t.function.name).sort(),['describe_tool','read_construction_draft'],'available preloads are offered at once; waiting ones wait')
 assert.equal((await s.execute('read_construction_draft',{})).status,'ok')
 ready=true
 assert.deepEqual((await s.prepare()).map(t=>t.function.name).sort(),['check_construction_draft','describe_tool','read_construction_draft'])
 const next=make();next.restoreState(JSON.parse(JSON.stringify(s.exportState())))
 assert.deepEqual((await next.prepare()).map(t=>t.function.name).sort(),['check_construction_draft','describe_tool','read_construction_draft'],'checkpoint keeps the preloaded set')
 // save_cad_design is the CAD assistant's own save step (Drawings and CAD shelf, waiting until a reviewed candidate); the rest are workflow members.
 for(const name of DRAWING_CONTINUATION_PRELOAD)if(name!=='save_cad_design')assert(bobWorkflows(catalog).find(w=>w.name==='workflow_construction_drawing')!.tools.includes(name),name+' belongs to the construction drawing workflow')
 assert(DRAWING_CONTINUATION_PRELOAD.includes('save_cad_design'))
})
