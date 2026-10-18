import {after,before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {projectSchema} from './support/project-schema.ts'
import {createAiCatalogSession,type AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
import {countContextTokens} from '../supabase/functions/_shared/bob-token-budget.ts'
const publication=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_ai_context_strategy_catalog.sql'))!
assert(publication,'CLI-created catalog publication exists')
const source=readFileSync(new URL('../supabase/migrations/'+publication,import.meta.url),'utf8')
const records=(tag:string)=>JSON.parse(source.match(new RegExp('\\$'+tag+'\\$([\\s\\S]+?)\\$'+tag+'\\$'))![1])
const additions=records('context_strategy_additions'),edits=records('context_strategy_edits'),cards=records('context_strategy_cards')
const changed=new Set<string>([...edits,...cards].map(p=>p.key).concat('bob.tools'))
const row=(manifest:AiCatalogManifest,key:string)=>{const found=manifest.definitions.find(d=>d.prompt_key===key);assert(found,key);return found}
let pg:Awaited<ReturnType<typeof projectSchema>>,prior:AiCatalogManifest,current:AiCatalogManifest,settings:any[],models:any[],policies:any[]
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name!==publication)return
  prior=(await db.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
  settings=(await db.query('select * from shared.ai_settings order by app,function_name')).rows
  models=(await db.query('select * from shared.ai_models order by model_name')).rows
  policies=(await db.query('select * from bob.tool_catalog order by name')).rows
 },publication)
 current=(await pg.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
})
after(()=>pg?.close())
test('context catalog changes only named definitions and preserves the previous immutable manifest',async()=>{
 assert.notEqual(current.manifest_id,prior.manifest_id)
 assert.equal(current.definitions.length,prior.definitions.length+additions.length)
 assert.deepEqual((await pg.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) m",[prior.manifest_id])).rows[0].m,prior)
 for(const old of prior.definitions){
  const next=row(current,old.prompt_key)
  if(!changed.has(old.prompt_key)){assert.deepEqual(next,old,old.prompt_key);continue}
  assert.equal(next.version,old.version+1,old.prompt_key);assert.equal(next.flow,old.flow)
  assert.deepEqual(next.available_variables,old.available_variables)
 }
 assert.equal(row(current,'agent-contract.ask-bob').metadata.work_allowance_version,1)
 assert.equal(row(current,'agent-contract.ask-bob').metadata.work_completion_version,2)
 assert.equal(row(current,'agent-contract.ask-bob').metadata.context_strategy_version,1)
})
test('embedding activation preserves all prices, text model choices, prior settings and domain policies',async()=>{
 const nextSettings=(await pg.query('select * from shared.ai_settings order by app,function_name')).rows as any[]
 for(const setting of settings)assert.deepEqual(nextSettings.find(s=>s.id===setting.id),setting)
 assert.equal(nextSettings.length,settings.length+1)
 const nextModels=(await pg.query('select * from shared.ai_models order by model_name')).rows as any[]
 assert.equal(nextModels.length,models.length)
 for(const model of models){
  const next=nextModels.find(m=>m.model_name===model.model_name)
  assert.deepEqual({...next,capabilities:model.capabilities},model)
  if(model.model_name!=='text-embedding-3-small')assert.deepEqual(next,model)
 }
 const nextPolicies=(await pg.query('select * from bob.tool_catalog order by name')).rows as any[]
 assert.equal(nextPolicies.length,policies.length+1)
 for(const policy of policies)assert.deepEqual(nextPolicies.find(p=>p.name===policy.name),policy)
})
test('catalog-backed lazy descriptions preserve exact schemas and instruction manuals',()=>{
 const session=createAiCatalogSession({rpc:async()=>{throw new Error('pinned')}},{app:'bob',manifest:current})
 assert(countContextTokens(session.role('ask-bob').systemMessage)<=700)
 assert.equal(session.role('ask-bob').model.model_name,'gpt-5.4');assert.equal(session.role('ask-bob').reasoningEffort,'high')
 for(const card of cards){
  const old=row(prior,card.key),next=row(current,card.key)
  assert(countContextTokens(session.tool(card.key,{card:true}).function.description)<=80,card.key)
  assert.deepEqual(next.definition.parameters,card.definition?.parameters??old.definition.parameters,card.key)
  assert.equal(next.definition.additional_description,old.definition.additional_description,card.key)
 }
 assert.deepEqual(session.schema('bob_conversation_brief_v2').schema.required,['gist','index'])
 assert.equal(session.role('context-compactor').model.model_name,session.role('context-summary').model.model_name)
 assert.equal(session.role('context-presentation').reasoningEffort,session.role('context-summary').reasoningEffort)
 assert.equal(session.role('memory-embedding').model.model_name,'text-embedding-3-small')
})
test('context catalog reproduces exactly from its builder',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-ai-context-strategy-catalog.ts','supabase/migrations/'+publication,'--check'],{encoding:'utf8'}),/Verified context strategy publication/)
})
