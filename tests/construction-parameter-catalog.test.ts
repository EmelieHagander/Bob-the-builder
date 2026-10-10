import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {projectSchema} from './support/project-schema.ts'
import {createAiCatalogSession,type AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
import {CONSTRUCTION_PARAMETER_TOOL,createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {DESIGN_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {seedToolPolicy} from '../supabase/functions/_shared/project-answer.ts'

test('parameter publication exposes bounded nodes and exact drawing version, preserves other definitions/models and old manifests',async t=>{
 let previous!:AiCatalogManifest
 const pg=await projectSchema(async(db,name)=>{
  if(name==='20261010222920_ai_construction_parameter_catalog.sql')previous=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 });t.after(()=>pg.close())
 const resolve=async(id:string|null=null)=>(await pg.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) result",[id])).rows[0].result
 const current=await resolve();assert.deepEqual(await resolve(previous.manifest_id),previous);assert.deepEqual(current.models,previous.models)
 for(const old of previous.definitions){
  const next=current.definitions.find(r=>r.prompt_key===old.prompt_key)!
  if(['tools.design_project_cad','bob.tools'].includes(old.prompt_key)){assert.equal(next.version,old.version+1);assert.equal(next.content,old.content)}
  else assert.deepEqual(next,old)
 }
 const catalog=createAiCatalogSession({rpc:async()=>{throw Error('Pinned only')}},{app:'bob',manifest:current})
 for(const session of [catalog,catalogFixture()]){
  assert.deepEqual(session.tool('change_construction_parameters').function.parameters,CONSTRUCTION_PARAMETER_TOOL.function.parameters)
  assert.deepEqual(session.tool('design_project_cad').function.parameters,DESIGN_CAD_TOOL.function.parameters)
 }
 const toolbox=catalog.definition('bob.tools','tool_contract').definition
 assert(toolbox.catalog.some((row:any)=>row.name==='change_construction_parameters'))
 assert(toolbox.contract_keys.includes('tools.change_construction_parameters'))
 assert(toolbox.shelves.find((row:any)=>row.label==='Drawings and CAD').tools.includes('change_construction_parameters'))
 const parameters:any=catalog.tool('change_construction_parameters',{server_quote:true}).function.parameters
 assert(!parameters.properties.request_quote);assert(!parameters.properties.recipe);assert(!parameters.properties.parameter_plan)
 assert(parameters.properties.changes.items.anyOf.every((node:any)=>!node.properties.operation&&!node.properties.normalized))
 const legacy=createAiCatalogSession({rpc:async()=>{throw Error('Pinned only')}},{app:'bob',manifest:previous})
 assert(!Object.hasOwn(legacy.tool('design_project_cad').function.parameters.properties,'construction_revision'))
 assert.throws(()=>legacy.tool('change_construction_parameters'),/ai_contract_missing/)
 const writer=createProjectWriter('fixture','Change frame width',async()=>{throw Error('No fixture save expected')},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
 const constructionTools=createConstructionTools({projectId:'fixture',message:'Change frame width',writer,hasAccess:async()=>true,read:async()=>null,
  readSources:async()=>({project:new Map(),physical:new Map()}),prepareParameterChange:async()=>{throw Error('Old manifest must not dispatch a new tool')}})
 const bench=(aiCatalog:typeof catalog)=>createBobToolSession({aiCatalog,writer,constructionTools,message:'Change frame width',
  lookup:createProjectLookup('fixture',async()=>({data:[],error:null}),async()=>({data:[],error:null})),readPolicy:seedToolPolicy})
 const oldBench=bench(legacy),oldTools=await oldBench.prepare()
 assert(oldTools.some(tool=>tool.function.name==='save_construction_draft'),'existing writes survive the new live policy row')
 assert(!oldTools.some(tool=>tool.function.name==='change_construction_parameters'))
 assert.equal((await oldBench.execute('change_construction_parameters',{})).status,'unavailable')
 assert((await bench(catalog).prepare()).some(tool=>tool.function.name==='change_construction_parameters'))
})
test('parameter publication is reproducible from the registered executable tools',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-ai-construction-parameter-catalog.ts','--check'],{encoding:'utf8'}),/Verified construction parameter/)
})
