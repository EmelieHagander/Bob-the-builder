import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { projectSchema } from './support/project-schema.ts'
import { preContinuationCatalogFixture as catalogFixture, preTaskWorkflowCatalogFixture } from './support/ai-catalog-fixture.ts'
import { WORK_RECORD_TOOLS, WORK_RECORD_TOOLS_V2, WORK_VALUE_TOOL_NAMES } from '../supabase/functions/_shared/project-work-records.ts'
import type { AiCatalogManifest } from '../supabase/functions/_shared/ai-catalog.ts'

const publication='20261017050720_ai_task_workflow_catalog.sql'
const source=readFileSync(new URL('../supabase/migrations/'+publication,import.meta.url),'utf8')
const tagged=(tag:string)=>JSON.parse(source.match(new RegExp('\\$'+tag+'\\$([\\s\\S]+?)\\$'+tag+'\\$'))![1])
const contracts=tagged('task_workflow_contracts'),manuals=tagged('task_workflow_manuals'),texts=tagged('task_workflow_texts')
const changed=new Set<string>([...contracts.map((p:any)=>'tools.'+p.name),...texts.map((p:any)=>p.key),'bob.tools','agent-contract.ask-bob'])
const newKeys=['bob.note.commentary','bob.note.commentary-limit','bob.note.review-work']
const row=(m:AiCatalogManifest,key:string)=>{const found=m.definitions.find(d=>d.prompt_key===key);assert(found,key+' exists');return found}
const expectedMetadata=(metadata:Record<string,unknown>)=>{const{seed_version,source_revision,...rest}=metadata;return{...rest,publication:'bob-task-workflow-v1'}}
let pg:Awaited<ReturnType<typeof projectSchema>>,prior:AiCatalogManifest,current:AiCatalogManifest,settings:unknown,policies:any[],flows:any[]

before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name!==publication)return
  // Real installations can customize active versions and live policy independently.
  // Publish fixture customizations, never mutate immutable historical versions.
  const activation:Record<string,string>={}
  for(const key of [...changed].filter(key=>!newKeys.includes(key))){
   const original:any=(await db.query(`select v.* from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' and p.prompt_key=$1`,[key])).rows[0]
   assert(original,key+' must predate this publication')
   const definition=structuredClone(original.definition)
   if(key.startsWith('tools.'))definition.additional_description+=' Existing custom tool guidance.'
   if(key==='bob.tools')for(const policy of definition.catalog)if((WORK_VALUE_TOOL_NAMES as readonly string[]).includes(policy.name)){
    policy.how_to+=' Pinned customized policy.';policy.always_load=false;policy.preload_phases=['planning'];policy.active=policy.name!=='create_work_record'
   }
   const content=original.content+'\nExisting custom content.'
   const metadata={...original.metadata,fixture_custom:{preserve:true,key}}
   const variables=key==='bob.method'?[...original.available_variables,'fixture_context']:original.available_variables
   const inserted:any=(await db.query(`insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    select $1,coalesce(max(version),0)+1,$2,$3,$4,$5,$6,$7,$8 from shared.ai_prompt_versions where prompt_id=$1 returning id`,
    [original.prompt_id,original.definition_kind,original.definition_format_version,metadata,content,definition,'Preserve custom flow: '+key,variables])).rows[0]
   activation[key]=inserted.id
  }
  await db.query("select shared.activate_ai_catalog('bob',$1::jsonb)",[JSON.stringify(activation)])
  await db.query("update bob.tool_catalog set how_to=how_to||' Live customized policy.',always_load=false,preload_phases=array['design'],active=name<>'change_task_readiness' where name=any($1::text[])",[WORK_VALUE_TOOL_NAMES])
  prior=(await db.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
  settings=(await db.query('select * from shared.ai_settings order by app,function_name')).rows
  policies=(await db.query('select * from bob.tool_catalog order by name')).rows
  flows=(await db.query("select p.prompt_key,v.flow from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' order by p.prompt_key")).rows
 },publication)
 current=(await pg.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
})
after(async()=>pg?.close())

test('task workflow publishes atomically without changing models, profiles, tiers or pinned history',async()=>{
 assert.notEqual(current.manifest_id,prior.manifest_id)
 assert.equal(current.definitions.length,prior.definitions.length+newKeys.length)
 assert.deepEqual(current.models,prior.models)
 assert.deepEqual((await pg.query('select * from shared.ai_settings order by app,function_name')).rows,settings)
 assert.deepEqual((await pg.query<{m:AiCatalogManifest}>("select shared.resolve_ai_catalog('bob',$1) m",[prior.manifest_id])).rows[0].m,prior)
 for(const old of prior.definitions){
  const next=row(current,old.prompt_key)
  if(!changed.has(old.prompt_key)){assert.deepEqual(next,old,old.prompt_key);continue}
  assert.equal(next.version,old.version+1,old.prompt_key)
  assert.equal(next.definition_kind,old.definition_kind)
  assert.equal(next.definition_format_version,old.definition_format_version)
  assert.deepEqual(next.metadata,{...expectedMetadata(old.metadata),...(old.prompt_key==='agent-contract.ask-bob'?{work_completion_version:1}:{})})
 }
 for(const key of newKeys){const next=row(current,key);assert.equal(next.version,1);assert.equal(next.definition_kind,'instruction_fragment');assert.deepEqual(next.metadata,{publication:'bob-task-workflow-v1'})}
 const nowFlows=(await pg.query("select p.prompt_key,v.flow from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' order by p.prompt_key")).rows as any[]
 for(const old of flows)assert.equal(nowFlows.find(f=>f.prompt_key===old.prompt_key).flow,old.flow)
})

test('only the three value-writing contracts advance schema and keep customized content and manuals',()=>{
 assert.deepEqual(contracts.map((c:any)=>c.name).sort(),[...WORK_VALUE_TOOL_NAMES].sort())
 for(const patch of contracts){
  const key='tools.'+patch.name,old=row(prior,key),next=row(current,key),native=WORK_RECORD_TOOLS_V2.find(t=>t.function.name===patch.name)!
  assert.deepEqual(patch,native.function)
  assert.equal(old.definition.envelope.schema_version,1);assert.equal(next.definition.envelope.schema_version,2)
  assert.deepEqual(next.definition,{...old.definition,...patch,handler:patch.name,required_parameters:patch.parameters.required,optional_parameters:[],
   additional_description:old.definition.additional_description+manuals.find((m:any)=>m.name===patch.name).text,envelope:{...old.definition.envelope,schema_version:2}})
  assert.equal(next.content,old.content);assert.deepEqual(next.available_variables,old.available_variables)
  assert(!JSON.stringify(next.definition.parameters).includes('value_json'))
 }
 for(const old of prior.definitions.filter(d=>d.definition_kind==='tool_contract'&&d.prompt_key!=='bob.tools')){
  if((WORK_VALUE_TOOL_NAMES as readonly string[]).some(name=>old.prompt_key==='tools.'+name))continue
  assert.deepEqual(row(current,old.prompt_key),old,old.prompt_key+' stays unchanged')
 }
})

test('toolbox publication preserves independent live policy, shelf placement and unrelated entries',async()=>{
 const old=row(prior,'bob.tools'),next=row(current,'bob.tools'),expected=structuredClone(old.definition)
 for(const policy of expected.catalog){const manual=manuals.find((m:any)=>m.name===policy.name);if(manual){policy.schema_version=2;policy.how_to+=manual.text}}
 assert.deepEqual(next.definition,expected);assert.equal(next.content,old.content);assert.deepEqual(next.available_variables,old.available_variables)
 const now=(await pg.query('select * from bob.tool_catalog order by name')).rows as any[]
 assert.equal(now.length,policies.length)
 for(const policy of policies){const manual=manuals.find((m:any)=>m.name===policy.name);assert.deepEqual(now.find(p=>p.name===policy.name),manual?{...policy,schema_version:2,how_to:policy.how_to+manual.text}:policy)}
})

test('workflow text appends to customized guidance and changes only the explicit closed-bench fragment',()=>{
 for(const patch of texts){
  const next=row(current,patch.key),old=prior.definitions.find(d=>d.prompt_key===patch.key)
  assert.equal(next.content,patch.mode==='append'?old!.content+'\n\n'+patch.content:patch.content)
  assert.deepEqual(next.definition,old?.definition??{})
  assert.deepEqual(next.available_variables,patch.mode==='append'?old!.available_variables:patch.variables)
 }
 assert.equal(row(current,'bob.method').definition_kind,'project_method')
 assert.deepEqual(row(current,'agent-contract.ask-bob').definition,row(prior,'agent-contract.ask-bob').definition)
 assert.equal(row(current,'agent-contract.ask-bob').content,row(prior,'agent-contract.ask-bob').content)
})

test('fixtures expose new native values while the pre-publication replay fixture keeps the old contract',()=>{
 const fresh=catalogFixture(),old=preTaskWorkflowCatalogFixture()
 assert.equal(fresh.definition('agent-contract.ask-bob').metadata.work_completion_version,1)
 assert.equal(old.definition('agent-contract.ask-bob').metadata.work_completion_version,undefined)
 for(const name of WORK_VALUE_TOOL_NAMES){
  assert.deepEqual(fresh.tool(name).function.parameters,WORK_RECORD_TOOLS_V2.find(t=>t.function.name===name)!.function.parameters)
  assert.deepEqual(old.tool(name).function.parameters,WORK_RECORD_TOOLS.find(t=>t.function.name===name)!.function.parameters)
  assert.equal(fresh.definition('tools.'+name).definition.envelope.schema_version,2)
  assert.equal(old.definition('tools.'+name).definition.envelope.schema_version,1)
 }
 for(const key of newKeys){assert.equal(fresh.definition(key).content,texts.find((t:any)=>t.key===key).content);assert.throws(()=>old.definition(key),/ai_contract_missing/)}
 const before=old.manifest();catalogFixture(m=>{row(m,'bob.method').content='Mutated fixture copy'})
 assert.deepEqual(preTaskWorkflowCatalogFixture().manifest(),before,'fixture callers cannot mutate pinned replay content')
})

test('task workflow publication is reproducible from the native executable schemas',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/build-bob-task-workflow-catalog.ts','supabase/migrations/'+publication,'--check'],{encoding:'utf8'}),/Verified task workflow publication/)
})
