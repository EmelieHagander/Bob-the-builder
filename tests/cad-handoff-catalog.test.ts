import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createAiCatalogSession, type AiCatalogManifest } from '../supabase/functions/_shared/ai-catalog.ts'
import { DESIGN_CAD_TOOL } from '../supabase/functions/_shared/cad-assistant.ts'
import { PLAN_CAD_PIECES_TOOL } from '../supabase/functions/_shared/cad-pieces.ts'
import { projectSchema } from './support/project-schema.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'

const migrationName='20261010063726_cad_handoff_server_ids.sql'
test('handoff contracts publish together, preserve active edits and pinned history, and match the executable tools',async t=>{
 let previous!:AiCatalogManifest
 let published:AiCatalogManifest|undefined
 const pg=await projectSchema(async(db,name)=>{
  if(name===migrationName)previous=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  if(previous&&name>migrationName&&!published)published=(await db.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 })
 t.after(()=>pg.close())
 const resolve=async(id:string|null=null)=>(await pg.query<{result:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) result",[id])).rows[0].result
 const latest=await resolve(),current=published??latest
 assert.deepEqual(current.models,previous.models)
 assert.deepEqual(await resolve(previous.manifest_id),previous)
 const changed=new Set(['tools.design_project_cad','tools.plan_cad_pieces'])
 for(const old of previous.definitions){
  const next=current.definitions.find(row=>row.prompt_key===old.prompt_key)!
  if(changed.has(old.prompt_key)){
   assert.equal(next.version,old.version+1);assert.equal(next.content,old.content)
   assert.equal(next.metadata.server_owned_values,true);assert.equal(next.metadata.saved_handoff_resume,true)
   assert.deepEqual(next.definition.envelope,old.definition.envelope,'compatible legacy inputs keep the policy envelope')
  }else assert.deepEqual(next,old,'unrelated current definitions stay unchanged')
 }
 const session=createAiCatalogSession({rpc:async()=>{throw Error('pinned only')}},{app:'bob',manifest:current})
 const fixture=catalogFixture()
 for(const tool of [DESIGN_CAD_TOOL,PLAN_CAD_PIECES_TOOL]){
  const key='tools.'+tool.function.name
  const historical=structuredClone(tool.function.parameters)
  if(tool.function.name==='design_project_cad'){
   delete (historical.properties as any).construction_revision
   historical.required=historical.required.filter(k=>k!=='construction_revision')
   assert(!Object.hasOwn(session.tool(key).function.parameters.properties,'construction_revision'))
  }
  assert.deepEqual(session.tool(key).function.parameters,historical)
  assert.deepEqual(fixture.tool(key).function.parameters,tool.function.parameters)
  assert.equal(session.tool(key).function.description.split('\n')[0],tool.function.description)
 }
 const schema=DESIGN_CAD_TOOL.function.parameters.properties.handoff.anyOf[0]
 assert.equal(Object.hasOwn(schema.properties.requirements.items.properties,'id'),false)
 assert.deepEqual(DESIGN_CAD_TOOL.function.parameters.properties.handoff.anyOf[1],{type:'null'})
 const prior=previous.definitions.find(row=>row.prompt_key==='tools.design_project_cad')!.definition as any
 assert.equal(Object.hasOwn(prior.parameters.properties.handoff.properties.requirements.items.properties,'id'),true)
 const snapshot=async()=>(await pg.query("select prompt_key,active_version_id from shared.ai_prompts where app='bob' order by prompt_key")).rows
 const before=await snapshot()
 const sql=await readFile(new URL('../supabase/migrations/'+migrationName,import.meta.url),'utf8')
 await assert.rejects(pg.transaction(tx=>tx.exec(sql.replace('"tools.plan_cad_pieces"','"tools.missing_handoff_contract"').replace(/^begin;$/m,'').replace(/^commit;$/m,''))),/cad_handoff_contract_missing/)
 assert.deepEqual(await snapshot(),before);assert.deepEqual(await resolve(),latest)
})
test('the handoff publication is reproducible from executable declarations',()=>{
 const output=execFileSync(process.execPath,['--import','tsx','scripts/build-ai-handoff-catalog.ts','--check'],{encoding:'utf8'})
 assert.match(output,/Verified server handoff publication: 2 contracts/)
})
