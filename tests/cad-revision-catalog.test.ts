import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {createAiCatalogSession,type AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
import {REVISE_CAD_TOOL} from '../supabase/functions/_shared/cad-revise.ts'
import {projectSchema} from './support/project-schema.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

const migrationName='20261010173130_cad_revision_dimension_bindings.sql'
test('CAD revision publication changes only the repair contract and preserves pinned manifests and active edits',async t=>{
 let previous!:AiCatalogManifest,published:AiCatalogManifest|undefined
 const pg=await projectSchema(async(db,name)=>{
  if(name===migrationName)previous=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  if(previous&&name>migrationName&&!published)published=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 })
 t.after(()=>pg.close())
 const resolve=async(id:string|null=null)=>(await pg.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) result",[id])).rows[0].result
 const latest=await resolve(),current=published??latest
 assert.deepEqual(current.models,previous.models)
 assert.deepEqual(await resolve(previous.manifest_id),previous)
 for(const old of previous.definitions){
  const next=current.definitions.find(row=>row.prompt_key===old.prompt_key)!
  if(old.prompt_key==='tools.revise_cad_candidate'){
   assert.equal(next.version,old.version+1);assert.equal(next.content,old.content);assert.deepEqual(next.metadata,old.metadata)
   assert.deepEqual(next.definition.envelope,old.definition.envelope)
   assert.deepEqual(next.definition.parameters,REVISE_CAD_TOOL.function.parameters)
  }else assert.deepEqual(next,old)
 }
 const session=createAiCatalogSession({rpc:async()=>{throw Error('pinned only')}},{app:'bob',manifest:current})
 for(const catalog of [session,catalogFixture()]){
  assert.deepEqual(catalog.tool('revise_cad_candidate').function.parameters,REVISE_CAD_TOOL.function.parameters)
  assert.equal(catalog.tool('revise_cad_candidate').function.description.split('\n')[0],REVISE_CAD_TOOL.function.description)
 }
 const schema:any=REVISE_CAD_TOOL.function.parameters
 assert(schema.required.includes('dimension_bindings'));assert.deepEqual(schema.properties.dimension_bindings.anyOf[0],{type:'null'})
 const legacy=createAiCatalogSession({rpc:async()=>{throw Error('pinned only')}},{app:'bob',manifest:previous})
 assert(!Object.hasOwn(legacy.tool('revise_cad_candidate').function.parameters.properties,'dimension_bindings'))
 const sql=await readFile(new URL('../supabase/migrations/'+migrationName,import.meta.url),'utf8')
 await assert.rejects(pg.transaction(tx=>tx.exec(sql.replace('"tools.revise_cad_candidate"','"tools.missing_revision_contract"').replace(/^begin;$/m,'').replace(/^commit;$/m,''))),/cad_revision_contract_missing/)
 assert.deepEqual(await resolve(),latest)
 assert.deepEqual(await resolve(current.manifest_id),current)
})
test('CAD repair publication is reproducible from the executable declaration',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-ai-cad-revision-catalog.ts','--check'],{encoding:'utf8'}),/Verified CAD revision publication: 1 contract/)
})
