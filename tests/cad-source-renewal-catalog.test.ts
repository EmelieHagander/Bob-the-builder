import {after,before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {projectSchema} from './support/project-schema.ts'
import {preContextStrategyCatalogFixture as catalogFixture} from './support/ai-catalog-fixture.ts'
import type {AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
import {DESIGN_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'
import {withLegacyCadViews} from '../supabase/functions/_shared/cad-adapter.ts'
const publication='20261017180143_cad_source_renewal_catalog.sql'
const source=readFileSync(new URL('../supabase/migrations/'+publication,import.meta.url),'utf8')
const patch=JSON.parse(source.match(/\$cad_source_renewal\$([\s\S]+?)\$cad_source_renewal\$/)![1])
const changed=new Set(['bob.tools','tools.design_project_cad'])
let pg:Awaited<ReturnType<typeof projectSchema>>,prior:AiCatalogManifest,current:AiCatalogManifest,policies:any[],settings:any[]
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name!==publication)return
  prior=(await db.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  policies=(await db.query('select * from bob.tool_catalog order by name')).rows
  settings=(await db.query('select * from shared.ai_settings order by app,function_name,module_id')).rows
 },publication)
 current=(await pg.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
})
after(()=>pg?.close())
test('explicit source renewal publishes exactly two definitions and preserves historical policy, models and unrelated text',async()=>{
 assert.equal(current.definitions.length,prior.definitions.length);assert.deepEqual(current.models,prior.models)
 assert.deepEqual((await pg.query('select * from shared.ai_settings order by app,function_name,module_id')).rows,settings)
 assert.deepEqual((await pg.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) m",[prior.manifest_id])).rows[0].m,prior)
 for(const old of prior.definitions){
  const next=current.definitions.find(d=>d.prompt_key===old.prompt_key)!
  if(!changed.has(old.prompt_key)){assert.deepEqual(next,old,old.prompt_key);continue}
  assert.equal(next.version,old.version+1);assert.equal(next.metadata.publication,'cad-source-renewal-v1')
  assert.equal(next.content,old.content);assert.deepEqual(next.available_variables,old.available_variables)
  const expected=structuredClone(old.definition)
  if(old.prompt_key==='tools.design_project_cad'){
   expected.parameters.properties.construction_revision.description=patch.revision_description
   expected.additional_description+='\n\n'+patch.manual
  }else expected.catalog.find((p:any)=>p.name==='design_project_cad').how_to+='\n\n'+patch.manual
  assert.deepEqual(next.definition,expected)
 }
 assert.equal(patch.revision_description,DESIGN_CAD_TOOL.function.parameters.properties.construction_revision.description)
 // This publication predates the 2026-10-21 view contract.
 assert.deepEqual(current.definitions.find(d=>d.prompt_key==='tools.design_project_cad')!.definition.parameters,withLegacyCadViews(DESIGN_CAD_TOOL.function.parameters))
 assert.match(patch.manual,/same drawing request_id/);assert.match(patch.manual,/Omitted revisions never select a new head/)
})
test('current runtime/toolbox and offline contracts carry the same explicit recovery instruction',async()=>{
 const fixture=catalogFixture(),next=(await pg.query('select * from bob.tool_catalog order by name')).rows
 const box=current.definitions.find(d=>d.prompt_key==='bob.tools')!.definition.catalog as any[]
 for(let i=0;i<policies.length;i++){
  if(policies[i].name!=='design_project_cad'){assert.deepEqual(next[i],policies[i]);continue}
  assert.deepEqual({...next[i],how_to:policies[i].how_to},policies[i])
  assert.equal(next[i].how_to,policies[i].how_to+'\n\n'+patch.manual)
  assert.equal(next[i].how_to,box.find(p=>p.name==='design_project_cad').how_to)
 }
 for(const key of changed){
  const row=current.definitions.find(d=>d.prompt_key===key)!,offline=fixture.definition(key,row.definition_kind)
  // Preserve existing/custom manual prefixes; compare this publication and
  // every executable schema field independently of historical prefix drift.
  const normalized=(definition:any)=>{
   const v=structuredClone(definition)
   if(key==='tools.design_project_cad')v.additional_description=v.additional_description.slice(-patch.manual.length)
   else v.catalog.find((p:any)=>p.name==='design_project_cad').how_to=patch.manual
   return v
  }
  assert.deepEqual(normalized(offline.definition),normalized(row.definition))
 }
 await assert.rejects(pg.exec(source),/cad_source_renewal_already_published/);await pg.exec('rollback')
})
test('source renewal publication is reproducible',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-cad-source-renewal-catalog.ts','supabase/migrations/'+publication,'--check'],{encoding:'utf8'}),/Verified CAD source renewal/)
})
