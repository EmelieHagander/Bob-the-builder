import {after,before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {projectSchema} from './support/project-schema.ts'
import {catalogFixture,preContinuationCatalogFixture} from './support/ai-catalog-fixture.ts'
import {createAiCatalogSession,type AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
const publication='20261017102000_bob_continuation_catalog.sql'
const source=readFileSync(new URL('../supabase/migrations/'+publication,import.meta.url),'utf8')
const patches=JSON.parse(source.match(/\$bob_continuation_texts\$([\s\S]+?)\$bob_continuation_texts\$/)![1])
const changed=new Set<string>([...patches.map((p:any)=>p.key),'agent-contract.ask-bob'])
const row=(m:AiCatalogManifest,key:string)=>{const found=m.definitions.find(d=>d.prompt_key===key);assert(found,key+' exists');return found}
let pg:Awaited<ReturnType<typeof projectSchema>>,prior:AiCatalogManifest,current:AiCatalogManifest,settings:unknown,policies:unknown
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name!==publication)return
  const activation:Record<string,string>={}
  for(const key of changed){
   const original:any=(await db.query(`select v.* from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' and p.prompt_key=$1`,[key])).rows[0]
   assert(original)
   const variables=key==='bob.method'?[...original.available_variables,'fixture_context']:original.available_variables
   const inserted:any=(await db.query(`insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    select $1,coalesce(max(version),0)+1,$2,$3,$4,$5,$6,$7,$8 from shared.ai_prompt_versions where prompt_id=$1 returning id`,
    [original.prompt_id,original.definition_kind,original.definition_format_version,{...original.metadata,fixture_custom:{preserve:true,key}},original.content+'\nExisting custom content.',{...original.definition,fixture_custom:true},'Custom flow '+key,variables])).rows[0]
   activation[key]=inserted.id
  }
  await db.query("select shared.activate_ai_catalog('bob',$1::jsonb)",[JSON.stringify(activation)])
  prior=(await db.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  settings=(await db.query('select * from shared.ai_settings order by app,function_name')).rows
  policies=(await db.query('select * from bob.tool_catalog order by name')).rows
 },publication)
 current=(await pg.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
})
after(()=>pg?.close())
test('continuation publication preserves models, reasoning, profiles, tool schemas and prior manifest replay',async()=>{
 assert.notEqual(current.manifest_id,prior.manifest_id);assert.equal(current.definitions.length,prior.definitions.length)
 assert.deepEqual(current.models,prior.models)
 assert.deepEqual((await pg.query('select * from shared.ai_settings order by app,function_name')).rows,settings)
 assert.deepEqual((await pg.query('select * from bob.tool_catalog order by name')).rows,policies)
 assert.deepEqual((await pg.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) m",[prior.manifest_id])).rows[0].m,prior)
 for(const old of prior.definitions){
  const next=row(current,old.prompt_key)
  if(!changed.has(old.prompt_key)){assert.deepEqual(next,old,old.prompt_key);continue}
  assert.equal(next.version,old.version+1);assert.equal(next.definition_kind,old.definition_kind);assert.equal(next.definition_format_version,old.definition_format_version)
  assert.deepEqual(next.definition,old.definition);assert.equal(next.flow,old.flow)
  const{seed_version,source_revision,...metadata}=old.metadata
  assert.deepEqual(next.metadata,{...metadata,publication:'bob-continuation-unmetered-v1',...(old.prompt_key==='agent-contract.ask-bob'?{work_completion_version:2,work_allowance_version:1}:{})})
 }
})
test('continuation guidance preserves custom text except the explicit replacement fragments',()=>{
 for(const patch of patches){
  const old=row(prior,patch.key),next=row(current,patch.key)
  let content=patch.content??old.content
  if(patch.remove)content=content.replaceAll(patch.remove,'')
  if(patch.append)content+='\n\n'+patch.append
  assert.equal(next.content,content,patch.key)
  assert.deepEqual(next.available_variables,patch.variables??old.available_variables)
 }
 const old=row(prior,'agent-contract.ask-bob'),next=row(current,'agent-contract.ask-bob')
 assert.equal(next.content,old.content);assert.deepEqual(next.available_variables,old.available_variables)
 assert(!row(current,'bob.contract').content.includes('Results report the budget left; on large jobs save the essentials first.'))
})
test('new policy applies to every Bob role only with both a durable opt-in and exact version one',()=>{
 const create=(snapshot:AiCatalogManifest,unlimitedWork=true)=>createAiCatalogSession({rpc:async()=>{throw new Error('must use pin')}},{app:snapshot.app,manifest:snapshot,unlimitedWork})
 const active=create(current)
 const variables=Object.fromEntries(current.definitions.flatMap(d=>Array.isArray(d.available_variables)?d.available_variables.map(name=>[String(name),'fixture']):[]))
 for(const definition of current.definitions.filter(d=>d.definition_kind==='role'&&d.definition.enabled!==false)){
  const fresh=active.role(definition.prompt_key,variables),old=create(prior).role(definition.prompt_key,variables)
  assert.equal(fresh.unlimitedWork,true,definition.prompt_key);assert.equal(old.unlimitedWork,undefined)
  assert.equal(fresh.model.model_name,old.model.model_name);assert.equal(fresh.reasoningEffort,old.reasoningEffort)
 }
 assert.equal(create(current,false).role('ask-bob').unlimitedWork,undefined)
 for(const value of [undefined,null,false,true,0,2,'1']){
  const unknown=structuredClone(current);row(unknown,'agent-contract.ask-bob').metadata.work_allowance_version=value
  assert.equal(create(unknown).role('ask-bob').unlimitedWork,undefined)
 }
 const other=structuredClone(current);other.app='other-app'
 assert.equal(create(other).role('ask-bob').unlimitedWork,undefined)
})
test('fixture versions retain the pre-continuation contract and require explicit unlimited opt-in',()=>{
 const current=catalogFixture(),old=preContinuationCatalogFixture()
 assert.equal(current.definition('agent-contract.ask-bob').metadata.work_completion_version,2)
 assert.equal(current.definition('agent-contract.ask-bob').metadata.work_allowance_version,1)
 assert.equal(old.definition('agent-contract.ask-bob').metadata.work_completion_version,1)
 assert.equal(old.definition('agent-contract.ask-bob').metadata.work_allowance_version,undefined)
 assert.equal(current.role('ask-bob').unlimitedWork,undefined)
 assert.equal(catalogFixture(undefined,{unlimitedWork:true}).role('ask-bob').unlimitedWork,true)
 const before=old.manifest();catalogFixture(m=>{row(m,'bob.contract').content='Changed only in this fixture'})
 assert.deepEqual(preContinuationCatalogFixture().manifest(),before)
})
test('continuation catalog migration reproduces exactly from the checked-in generator',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-bob-continuation-catalog.ts','supabase/migrations/'+publication,'--check'],{encoding:'utf8'}),/Verified continuation publication/)
})
