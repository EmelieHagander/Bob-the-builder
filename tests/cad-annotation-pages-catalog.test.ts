import {after,before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {projectSchema} from './support/project-schema.ts'
import {preSourceRenewalCatalogFixture} from './support/ai-catalog-fixture.ts'
import type {AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
const publication='20261017152959_cad_annotation_pages_catalog.sql'
const source=readFileSync(new URL('../supabase/migrations/'+publication,import.meta.url),'utf8')
const manuals=JSON.parse(source.match(/\$cad_page_manuals\$([\s\S]+?)\$cad_page_manuals\$/)![1])
const changed=new Set(['bob.tools','tools.design_project_cad','tools.plan_cad_pieces','feedback.cad-assistant.next-action.c0e108a49e51'])
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
test('page publication changes exactly four instructions and keeps models, work policy and historical replay intact',async()=>{
 assert.equal(current.definitions.length,prior.definitions.length)
 assert.deepEqual(current.models,prior.models)
 assert.deepEqual((await pg.query('select * from shared.ai_settings order by app,function_name,module_id')).rows,settings)
 assert.deepEqual((await pg.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) m",[prior.manifest_id])).rows[0].m,prior)
 for(const old of prior.definitions){
  const next=current.definitions.find(d=>d.prompt_key===old.prompt_key)!
  if(!changed.has(old.prompt_key))assert.deepEqual(next,old,old.prompt_key)
  else {assert.equal(next.version,old.version+1);assert.equal(next.metadata.publication,'cad-annotation-pages-v1');assert.deepEqual(next.available_variables,old.available_variables)}
 }
 const fixture=preSourceRenewalCatalogFixture()
 for(const key of changed){
  const next=current.definitions.find(d=>d.prompt_key===key)!,offline=fixture.definition(key,next.definition_kind)
  // The live prefix may carry preserved prior/custom wording. Verify the new
  // publication independently of historical fixture manual-prefix drift.
  const normalized=(definition:any)=>{
   const v=structuredClone(definition)
   if(key==='tools.design_project_cad')v.additional_description=v.additional_description.slice(-manuals[0].text.length)
   if(key==='bob.tools')for(const p of v.catalog)if(p.name==='design_project_cad')p.how_to=p.how_to.slice(-manuals[0].text.length)
   return v
  }
  assert.deepEqual(normalized(offline.definition),normalized(next.definition));assert.equal(offline.content,next.content)
 }
 for(const name of ['design_project_cad','plan_cad_pieces']){
  const old=prior.definitions.find(d=>d.prompt_key==='tools.'+name)!,next=current.definitions.find(d=>d.prompt_key==='tools.'+name)!
  const{additional_description:_old,...oldContract}=old.definition,{additional_description:_next,...newContract}=next.definition
  assert.deepEqual(newContract,oldContract,'executable schema and source pins stay unchanged')
  assert.match(String(next.definition.additional_description),/512/)
  if(name==='design_project_cad')assert.equal(next.definition.additional_description,old.definition.additional_description+'\n\n'+manuals[0].text)
 }
})
test('only the two CAD manuals change and current database and pinned toolbox instructions agree',async()=>{
 const next=(await pg.query('select * from bob.tool_catalog order by name')).rows
 const box=current.definitions.find(d=>d.prompt_key==='bob.tools')!.definition.catalog as any[]
 for(let i=0;i<policies.length;i++){
  if(['design_project_cad','plan_cad_pieces'].includes(policies[i].name)){
   assert.deepEqual({...next[i],how_to:policies[i].how_to},policies[i]);assert.notEqual(next[i].how_to,policies[i].how_to)
   assert.equal(next[i].how_to,box.find(p=>p.name===policies[i].name).how_to)
  }else assert.deepEqual(next[i],policies[i])
 }
 assert.doesNotMatch(next.find(p=>p.name==='plan_cad_pieces')!.how_to,/about 24|after your reply/)
 await assert.rejects(pg.exec(source),/cad_annotation_pages_already_published/)
 await pg.exec('rollback')
})
test('page publication is reproducible',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-cad-annotation-pages-catalog.ts','supabase/migrations/'+publication,'--check'],{encoding:'utf8'}),/Verified CAD page/)
})
