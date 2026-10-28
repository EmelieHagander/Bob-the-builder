import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createResumeProbe} from '../scripts/benchmark-bob-resume.ts'
import {estimateBobRequestInput} from '../supabase/functions/_shared/bob-context-continuation.ts'
import {bobCompleteRequestVersions} from '../supabase/functions/_shared/bob-complete-request.ts'
import {catalogFixture,preCompleteContextCatalogFixture} from './support/ai-catalog-fixture.ts'
import {countContextTokens} from '../supabase/functions/_shared/bob-token-budget.ts'
import {projectSchema} from './support/project-schema.ts'
import {createAiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'

test('complete requests activate only when both immutable catalog contracts opt in',()=>{
 const enabled=catalogFixture().definition('agent-contract.ask-bob').metadata
 const {complete_request_version:_c,result_reference_version:_r,...metadata}=enabled
 assert.deepEqual(bobCompleteRequestVersions(true,metadata),{})
 assert.deepEqual(bobCompleteRequestVersions(true,enabled),{completeRequestVersion:1,resultReferenceVersion:1})
 assert.deepEqual(bobCompleteRequestVersions(false,enabled),{})
 for(const invalid of [{...enabled,result_reference_version:undefined},{...enabled,complete_request_version:2},{...enabled,context_strategy_version:undefined}])assert.throws(()=>bobCompleteRequestVersions(true,invalid),/contract_invalid/)
})

test('40-step capacity keeps only recent private reasoning, so a reasoning-heavy turn stays within the context limit',async t=>{
 const reports:any[]=[]
 for(const reasoningTokens of [500,2500]){
  let final:any,peak=0
  const probe=createResumeProbe({checkpoint:true,completeRequest:true,resultReferences:true,stress:true,yieldMode:'step',reasoningTokens,encryptedReasoningChars:reasoningTokens*6,
   onRequest:r=>{if(r.functionName==='ask-bob'){final=r;peak=Math.max(peak,estimateBobRequestInput(r).total)}}})
  const result=await probe.runToEnd()
  assert(result.ok,reasoningTokens+': '+JSON.stringify(result))
  assert.equal(probe.totals().summaryPosts,0);assert.equal(probe.totals().writes,2)
  const state=probe.state()!,groups=state.continuation!.chains[0][1].groups
  // Calls and text stay in every exchange; encrypted reasoning only in the two
  // exchanges the last request kept, plus the final response recorded after it.
  const reasoned=groups.map(g=>g.some(m=>m.nativeOutput?.some(i=>i.type==='reasoning')))
  assert(reasoned.slice(0,-3).every(r=>!r));assert(reasoned.slice(-3).every(Boolean))
  assert(groups.slice(0,-3).flat().filter(m=>m.nativeOutput).every(m=>m.nativeReasoningTokens===0&&m.nativeOutput!.every(i=>i.id===undefined)))
  assert(peak<64000);assert(probe.totals().providerPosts>=40)
  reports.push({reasoningTokensPerStep:reasoningTokens,result:'completed',modelCalls:probe.totals().providerPosts,maxInputEstimate:peak,maxCheckpointBytes:probe.totals().maxCheckpointBytes,
   finalNativeItems:final.messages.filter((m:any)=>m.nativeOutput).length})
 }
 t.diagnostic(JSON.stringify({note:'Scripted Node fixture, same estimator as dispatch; real reasoning usage supplied, opaque transport placeholders. Not model/cache/hosted CPU evidence. The 2500 profile approximates the prior 100k reasoning-token turn, which previously failed with context_input_too_large.',reports}))
})

test('prompt publication is slimmer, keeps exact routes and authority; only the activation publication opts in native main turns',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const manifest=(await pg.query<any>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
 const current=createAiCatalogSession({rpc:async()=>{throw Error('pinned')}},{app:'bob',manifest}),fixture=catalogFixture(),old=preCompleteContextCatalogFixture()
 for(const key of ['bob.workflows','bob.toolbox.intro-lazy','tools.describe_tool','tools.get_work_history']){
  assert.deepEqual(current.definition(key).definition,fixture.definition(key).definition,key)
  assert.equal(current.definition(key).content,fixture.definition(key).content,key)
  assert.deepEqual(current.definition(key).metadata,fixture.definition(key).metadata,key)
 }
 const method=(c:any)=>c.definition('bob.workflows').definition.workflows.find((w:any)=>w.name==='workflow_construction_drawing').method
 assert(countContextTokens(method(current))<countContextTokens(method(old)))
 for(const name of ['change_construction_parameters','change_construction_roles','edit_construction_parts','save_construction_draft','plan_cad_pieces','read_construction_draft','check_construction_draft','design_project_cad'])assert(method(current).includes(name),name)
 // Later building-scope, model-feedback and construction-delivery publications only append these tools.
 const scoped=['read_building_scope','change_building_scope','read_model_feedback','record_model_feedback','read_construction_delivery'],withoutScope=(d:any)=>({...d,catalog:d.catalog.filter((p:any)=>!scoped.includes(p.name)),
  contract_keys:d.contract_keys.filter((k:string)=>!scoped.some(n=>k==='tools.'+n)),shelves:d.shelves.map((s:any)=>({...s,tools:s.tools.filter((n:string)=>!scoped.includes(n))}))})
 assert.deepEqual(withoutScope(current.definition('bob.tools').definition),old.definition('bob.tools').definition)
 const {publication:_p,complete_request_version,result_reference_version,turn_usd_stop:_stop,...contract}=current.definition('agent-contract.ask-bob').metadata
 const {publication:_o,...oldContract}=old.definition('agent-contract.ask-bob').metadata
 assert.deepEqual(contract,oldContract);assert.deepEqual([complete_request_version,result_reference_version],[1,1])
 t.diagnostic(`Construction method tokens ${countContextTokens(method(old))} -> ${countContextTokens(method(current))}; runtime fences unchanged.`)
})
