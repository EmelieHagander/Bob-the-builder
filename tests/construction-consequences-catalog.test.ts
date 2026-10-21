import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {projectSchema} from './support/project-schema.ts'
import {withLegacyCadViews} from '../supabase/functions/_shared/cad-adapter.ts'
import {createAiCatalogSession,type AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
import {CONSTRUCTION_SAVE_TOOL,CONSTRUCTION_REPEAT_SAVE_TOOL,createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {CONSTRUCTION_ROLE_TOOL,CONSTRUCTION_CHANGES_TOOL,CONSTRUCTION_CONTINUE_TOOL} from '../supabase/functions/_shared/construction-consequences.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {seedToolPolicy} from '../supabase/functions/_shared/project-answer.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

test('D publishes only role/work and affected manuals; old catalogs and all model settings/prices remain immutable',async t=>{
 let previous!:AiCatalogManifest,current:AiCatalogManifest|undefined
 const pg=await projectSchema(async(db,name)=>{
  if(previous&&!current)current=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  if(name==='20261011093016_ai_construction_consequences_catalog.sql')previous=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 });t.after(()=>pg.close())
 current??=(await pg.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 assert.deepEqual((await pg.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) result",[previous.manifest_id])).rows[0].result,previous)
 assert.deepEqual(current.models,previous.models);assert.deepEqual(current.settings,previous.settings);assert.equal(current.definitions.length,previous.definitions.length+3)
 const changed=['bob.tools','tools.save_construction_draft',...['read_construction_draft','check_construction_draft','derive_construction_lists','derive_cad_material_requirement','check_construction_cut_fit','save_construction_cut_plan','change_construction_parameters','transition_legacy_drawing','read_cad_artifact','design_project_cad'].map(n=>'tools.'+n)]
 for(const old of previous.definitions){const next=current.definitions.find(d=>d.prompt_key===old.prompt_key)!
  if(changed.includes(old.prompt_key)){assert.equal(next.version,old.version+1);assert.equal(next.content,old.content)}else assert.deepEqual(next,old)
 }
 const session=(manifest:AiCatalogManifest)=>createAiCatalogSession({rpc:async()=>{throw Error('Pinned only')}},{app:'bob',manifest})
 const now=session(current),before=session(previous),tools=[CONSTRUCTION_ROLE_TOOL,CONSTRUCTION_CHANGES_TOOL,CONSTRUCTION_CONTINUE_TOOL]
 // D is a historical publication boundary. Later selective-tool releases add
 // compact recipe arrays to the save schema without changing the pinned D one.
 for(const catalog of [now,catalogFixture()])for(const tool of tools)assert.deepEqual(catalog.tool(tool.function.name).function.parameters,tool.function.parameters)
 const saveAtD:any=now.tool(CONSTRUCTION_SAVE_TOOL.function.name).function.parameters
 assert(Object.hasOwn(saveAtD.properties,'instance_policy'),'D introduces instance roles')
 // The pinned D release predates the 2026-10-21 view contract.
 assert.deepEqual(saveAtD,withLegacyCadViews(CONSTRUCTION_SAVE_TOOL.function.parameters),'the pinned D release matches its pre-arrays save contract')
 assert(!Object.hasOwn(saveAtD.properties.recipe.properties,'arrays'),'D predates compact arrays')
 const saveLatest:any=catalogFixture().tool(CONSTRUCTION_SAVE_TOOL.function.name).function.parameters
 assert.deepEqual(saveLatest,CONSTRUCTION_REPEAT_SAVE_TOOL.function.parameters,'the final catalog matches the current canonical compiler')
 assert(Object.hasOwn(saveLatest.properties.recipe.properties,'arrays'),'the later release adds compact arrays')
 for(const tool of tools){assert.throws(()=>before.tool(tool.function.name),/ai_contract_missing/);const parameters:any=now.tool(tool.function.name,{server_quote:true}).function.parameters;assert(!parameters.properties.request_quote);for(const field of ['recipe','dimensions','quantity','computed','layout'])assert(!parameters.properties[field])}
 assert(!Object.hasOwn(before.tool('save_construction_draft').function.parameters.properties,'instance_policy'))
 assert.match(now.definition('tools.derive_cad_material_requirement','tool_contract').definition.additional_description,/only manufacture/)
 const writer=createProjectWriter('fixture','Continue',async()=>{throw Error('No writes expected')},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
 const construction=createConstructionTools({projectId:'fixture',message:'Continue',writer,hasAccess:async()=>true,read:async()=>null,readSources:async()=>({project:new Map(),physical:new Map()})})
 const bench=(aiCatalog:typeof now)=>createBobToolSession({aiCatalog,writer,constructionTools:construction,message:'Continue',lookup:createProjectLookup('fixture',async()=>({data:[],error:null})),readPolicy:seedToolPolicy})
 const oldBench=bench(before),oldTools=await oldBench.prepare();assert(oldTools.some(t=>t.function.name==='save_construction_draft'))
 for(const tool of tools){assert(!oldTools.some(t=>t.function.name===tool.function.name));assert.equal((await oldBench.execute(tool.function.name,{})).status,'unavailable')}
 const offered=await bench(now).prepare();for(const tool of tools)assert(offered.some(t=>t.function.name===tool.function.name))
})
test('D catalog publication is reproducible from registered role/work schemas',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-ai-construction-consequences-catalog.ts','--check'],{encoding:'utf8'}),/Verified construction role/)
})
