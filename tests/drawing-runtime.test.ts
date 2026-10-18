import {test} from 'node:test'
import assert from 'node:assert/strict'
import {drawingRuntimeVersion,drawingCatalogConfiguration} from '../supabase/functions/_shared/drawing-runtime.ts'
import {createAiCatalogSession,type AiCatalogManifest} from '../supabase/functions/_shared/ai-catalog.ts'
import {catalogFixture,legacyCatalogFixture} from './support/ai-catalog-fixture.ts'
import {fingerprint} from '../supabase/functions/_shared/bob-job-journal.ts'
import {CAD_REVIEW_CONTRACT} from '../supabase/functions/_shared/cad-review.ts'
import {CAD_TRANSPORT_CONTRACT} from '../supabase/functions/_shared/cad-transport.ts'
import {BOB_MODEL_BUDGET_POLICY_REVISION} from '../supabase/functions/_shared/bob-model-budget.ts'

const configured={model:true,cad:true}
const snapshot=()=>structuredClone(catalogFixture().manifest())
function runtime(snapshot:AiCatalogManifest,unlimitedWork=false){
 const calls:{table:string;fields:string}[]=[],live={
  settings:['cad-reviewer'].map(function_name=>({function_name,module_id:'cad',is_enabled:true,model:'ignored-legacy',max_output_tokens:1,updated_at:'first'})),
  models:snapshot.models.map(model=>({model_name:model.model_name,is_active:true,updated_at:'first'})),
 }
 let resolves=0
 const client={schema:(name:string)=>{
  assert.equal(name,'shared')
  return {rpc:async(name:string,args:Record<string,unknown>)=>{assert.equal(name,'resolve_ai_catalog');assert.equal(args.p_app,'bob');resolves++;return {data:snapshot,error:null}},from:(table:string)=>{
   let fields=''
   const query:any={select:(value:string)=>{fields=value;return query},eq:()=>query,in:()=>query,order:()=>query,abortSignal:async()=>{
    calls.push({table,fields});return {data:table==='ai_settings'?live.settings:live.models,error:null}
   }}
   return query
  }}
 }}
 const catalog=createAiCatalogSession({rpc:async()=>{throw new Error('must use pinned manifest')}},{app:'bob',manifest:snapshot,unlimitedWork})
 return {client,catalog,calls,live,get resolves(){return resolves}}
}
test('retry runtime follows only CAD catalog dependencies and ignores unrelated revisions, defaults and timestamps',async()=>{
 const first=snapshot(),before=runtime(first),expected=await drawingRuntimeVersion(before.client,configured,before.catalog)
 const changed=structuredClone(first);changed.manifest_id='unrelated-new-manifest';changed.created_at='2099-01-01T00:00:00Z'
 for(const key of ['bob.persona','plan-compiler.persona']){const row=changed.definitions.find(row=>row.prompt_key===key)!;row.id+=':new';row.payload_hash+=':new';row.content+=' unrelated'}
 for(const model of changed.models){model.updated_at='later';model.is_default=!model.is_default}
 const after=runtime(changed);after.live.settings.forEach(row=>{row.model='another-retired-legacy-model';row.max_output_tokens=99999;row.updated_at='later'})
 assert.equal(await drawingRuntimeVersion(after.client,configured,after.catalog),expected)
 assert.equal(after.resolves,0)
 assert.deepEqual(after.calls,[{table:'ai_settings',fields:'function_name,module_id,is_enabled'},{table:'ai_models',fields:'model_name,is_active'}])
})
test('a changed CAD prompt version, profile, tool contract or selected model price releases the old technical retry',async()=>{
 const first=snapshot(),before=runtime(first),expected=await drawingRuntimeVersion(before.client,configured,before.catalog)
 for(const key of ['cad-reviewer.persona','profile.cad-reviewer','tools.search_project_data','bob.grounding']){
  const changed=structuredClone(first),row=changed.definitions.find(row=>row.prompt_key===key)!;row.id+=':new';row.payload_hash+=':new'
  const after=runtime(changed);assert.notEqual(await drawingRuntimeVersion(after.client,configured,after.catalog),expected,key)
 }
 const changed=structuredClone(first),names=drawingCatalogConfiguration(first).models.map(row=>row.model_name)
 changed.models.find(model=>names.includes(model.model_name))!.output_cost_per_1m_tokens+=1
 const after=runtime(changed);assert.notEqual(await drawingRuntimeVersion(after.client,configured,after.catalog),expected)
})
test('effective live enable and bound-model retirement flags release retry suppression without changing catalog versions',async()=>{
 const value=snapshot(),normal=runtime(value),expected=await drawingRuntimeVersion(normal.client,configured,normal.catalog)
 const disabled=runtime(value);disabled.live.settings[0].is_enabled=false
 assert.notEqual(await drawingRuntimeVersion(disabled.client,configured,disabled.catalog),expected)
 disabled.live.settings[0].is_enabled=true
 assert.equal(await drawingRuntimeVersion(disabled.client,configured,disabled.catalog),expected)
 const retired=runtime(value),name=drawingCatalogConfiguration(value).models[0].model_name
 retired.live.models.find(model=>model.model_name===name)!.is_active=false
 assert.notEqual(await drawingRuntimeVersion(retired.client,configured,retired.catalog),expected)
})
test('queue eligibility resolves the current catalog instead of retired direct-model settings',async()=>{
 const value=snapshot(),current=runtime(value),pinned=await drawingRuntimeVersion(current.client,configured,current.catalog)
 assert.equal(await drawingRuntimeVersion(current.client,configured),pinned)
 assert.equal(current.resolves,1)
})

test('only an effective unlimited policy changes the retry fingerprint; legacy bytes and pins remain exact',async()=>{
 const value=snapshot(),contract=value.definitions.find(row=>row.prompt_key==='agent-contract.ask-bob')!
 delete contract.metadata.work_allowance_version
 const old=runtime(value),configuration=drawingCatalogConfiguration(value)
 // The pre-policy fingerprint envelope, without an absent/false extra field.
 const legacy=await fingerprint({engine_contract:2,transport_contract:CAD_TRANSPORT_CONTRACT,review_contract:CAD_REVIEW_CONTRACT,
  budget_policy_revision:BOB_MODEL_BUDGET_POLICY_REVISION,configured,catalog:configuration,
  settings:old.live.settings.map(({function_name,module_id,is_enabled})=>({function_name,module_id,is_enabled})),
  live_models:configuration.models.map(model=>({model_name:model.model_name,is_active:true}))})
 assert.equal(await drawingRuntimeVersion(old.client,configured,old.catalog),legacy)
 for(const version of [undefined,0,2,'1']){
  const unrecognized=structuredClone(value)
  unrecognized.definitions.find(row=>row.prompt_key==='agent-contract.ask-bob')!.metadata.work_allowance_version=version
  const candidate=runtime(unrecognized,true)
  assert.equal(await drawingRuntimeVersion(candidate.client,configured,candidate.catalog),legacy)
  assert.equal(await drawingRuntimeVersion(candidate.client,configured),legacy)
 }
 contract.metadata.work_allowance_version=1
 contract.id+=':policy1';contract.payload_hash+=':policy1'
 const existing=runtime(value),enabled=runtime(value,true)
 assert.equal(await drawingRuntimeVersion(existing.client,configured,existing.catalog),legacy,'publishing a policy cannot rewrite an existing legacy job pin')
 const next=await drawingRuntimeVersion(enabled.client,configured,enabled.catalog)
 assert.notEqual(next,legacy,'new authorized work must not reuse a failure fingerprint from the old quotas')
 assert.equal(await drawingRuntimeVersion(enabled.client,configured),legacy,'publishing policy 1 alone must not emit a project runtime-change event and wake legacy drawings')
 assert.equal(await drawingRuntimeVersion(existing.client,configured,existing.catalog),legacy,'a fresh eligibility read cannot mutate an older supplied pin')
})

test('removed CAD roles and tools never influence drawing retry eligibility',async()=>{
 const first=structuredClone(legacyCatalogFixture().manifest()),before=runtime(first),expected=await drawingRuntimeVersion(before.client,configured,before.catalog)
 const retired=(key:string)=>/^(?:(?:role|profile|agent-contract|routing|feedback)\.)?cad-(?:research|designer)(?:\.|$)/.test(key)
  ||['tools.render_cad_candidate','tools.render_saved_cad_candidate','tools.revise_cad_candidate','tools.report_cad_blocker','tools.finish_cad_research','schema.intake','schema.dimension_bindings'].includes(key)
 const changed=structuredClone(first)
 assert(changed.definitions.some(row=>retired(row.prompt_key)))
 for(const row of changed.definitions.filter(row=>retired(row.prompt_key))){row.id+=':retired-change';row.payload_hash+=':retired-change'}
 const after=runtime(changed)
 assert.equal(await drawingRuntimeVersion(after.client,configured,after.catalog),expected)
 changed.definitions=changed.definitions.filter(row=>!retired(row.prompt_key))
 const removed=runtime(changed)
 assert.equal(await drawingRuntimeVersion(removed.client,configured,removed.catalog),expected)
 assert(drawingCatalogConfiguration(changed).definitions.every(row=>!retired(row.key)))
})
