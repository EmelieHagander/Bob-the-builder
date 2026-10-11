import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {projectSchema} from './support/project-schema.ts'
import {createAiCatalogSession,type AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
import {CONSTRUCTION_LEGACY_TOOL,createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {seedToolPolicy} from '../supabase/functions/_shared/project-answer.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

test('legacy publication preserves pinned catalogs/models; old benches survive new live policy',async t=>{
 let previous!:AiCatalogManifest
 const pg=await projectSchema(async(db,name)=>{if(name==='20261011071316_ai_legacy_transition_catalog.sql')previous=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result});t.after(()=>pg.close())
 const current=(await pg.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 assert.deepEqual((await pg.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) result",[previous.manifest_id])).rows[0].result,previous)
 assert.deepEqual(current.models,previous.models);assert.deepEqual(current.settings,previous.settings);assert.equal(current.definitions.length,previous.definitions.length+1)
 for(const old of previous.definitions){const next=current.definitions.find(d=>d.prompt_key===old.prompt_key)!
  if(['bob.tools','tools.read_cad_artifact','tools.design_project_cad'].includes(old.prompt_key)){assert.equal(next.version,old.version+1);assert.equal(next.content,old.content)}else assert.deepEqual(next,old)
 }
 const session=(manifest:AiCatalogManifest)=>createAiCatalogSession({rpc:async()=>{throw Error('Pinned only')}},{app:'bob',manifest})
 const now=session(current),before=session(previous)
 for(const catalog of [now,catalogFixture()])assert.deepEqual(catalog.tool('transition_legacy_drawing').function.parameters,CONSTRUCTION_LEGACY_TOOL.function.parameters)
 const parameters:any=now.tool('transition_legacy_drawing',{server_quote:true}).function.parameters
 for(const field of ['recipe','parameters','parameter_plan','dimensions','request_quote'])assert(!parameters.properties[field])
 assert.throws(()=>before.tool('transition_legacy_drawing'),/ai_contract_missing/)
 const writer=createProjectWriter('fixture','Continue',async()=>{throw Error('No writes expected')},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
 const tools=createConstructionTools({projectId:'fixture',message:'Continue',writer,hasAccess:async()=>true,read:async()=>null,readSources:async()=>({project:new Map(),physical:new Map()}),prepareLegacyTransition:async()=>{throw Error('An older bench must not call the new handler')}})
 const bench=(aiCatalog:typeof now)=>createBobToolSession({aiCatalog,writer,constructionTools:tools,message:'Continue',lookup:createProjectLookup('fixture',async()=>({data:[],error:null}),async()=>({data:[],error:null})),readPolicy:seedToolPolicy})
 const oldBench=bench(before),oldTools=await oldBench.prepare();assert(oldTools.some(t=>t.function.name==='change_construction_parameters'));assert(!oldTools.some(t=>t.function.name==='transition_legacy_drawing'))
 assert.equal((await oldBench.execute('transition_legacy_drawing',{})).status,'unavailable')
 assert((await bench(now).prepare()).some(t=>t.function.name==='transition_legacy_drawing'))
 assert.match(now.definition('tools.design_project_cad','tool_contract').definition.additional_description,/original drawing Artifact ID/)
})
test('legacy publication is reproducible from the actual registered tool',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-ai-legacy-transition-catalog.ts','--check'],{encoding:'utf8'}),/Verified legacy transition/)
})
