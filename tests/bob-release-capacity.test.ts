import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createResumeProbe} from '../scripts/benchmark-bob-resume.ts'
import {estimateBobRequestInput} from '../supabase/functions/_shared/bob-context-continuation.ts'
import {bobCompleteRequestVersions} from '../supabase/functions/_shared/bob-complete-request.ts'
import {catalogFixture,preCompleteContextCatalogFixture} from './support/ai-catalog-fixture.ts'
import {countContextTokens} from '../supabase/functions/_shared/bob-token-budget.ts'
import {projectSchema} from './support/project-schema.ts'
import {createAiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'

test('complete-request code stays inactive until both immutable catalog contracts opt in',()=>{
 const metadata=catalogFixture().definition('agent-contract.ask-bob').metadata
 assert.deepEqual(bobCompleteRequestVersions(true,metadata),{})
 const enabled={...metadata,complete_request_version:1,result_reference_version:1}
 assert.deepEqual(bobCompleteRequestVersions(true,enabled),{completeRequestVersion:1,resultReferenceVersion:1})
 assert.deepEqual(bobCompleteRequestVersions(false,enabled),{})
 for(const invalid of [{...enabled,result_reference_version:undefined},{...enabled,complete_request_version:2},{...enabled,context_strategy_version:undefined}])assert.throws(()=>bobCompleteRequestVersions(true,invalid),/contract_invalid/)
})

test('40-step capacity preserves large native items and reports the historical reasoning-sized failure honestly',async t=>{
 const reports:any[]=[]
 for(const reasoningTokens of [500,2500]){
  let final:any,peak=0
  const probe=createResumeProbe({checkpoint:true,completeRequest:true,resultReferences:true,stress:true,yieldMode:'step',reasoningTokens,encryptedReasoningChars:reasoningTokens*6,
   onRequest:r=>{if(r.functionName==='ask-bob'){final=r;peak=Math.max(peak,estimateBobRequestInput(r).total)}}})
  let result
  if(reasoningTokens===500)result=await probe.runToEnd()
  else {await assert.rejects(probe.runToEnd(),/^Error: context_input_too_large$/);result={ok:false,error:'context_input_too_large'}}
  assert.equal(probe.totals().summaryPosts,0);assert.equal(probe.totals().writes,2)
  const state=probe.state()!,groups=state.continuation!.chains[0][1].groups
  assert(groups.every(g=>g.filter(m=>m.nativeOutput).every(m=>m.nativeReasoningTokens===reasoningTokens)))
  if(reasoningTokens===500){assert(result.ok);assert(peak<64000);assert(probe.totals().providerPosts>=40)}
  else {assert.deepEqual(result,{ok:false,error:'context_input_too_large'});assert(peak>64000);assert(groups.flat().some(m=>m.nativeOutput?.some(i=>String(i.encrypted_content??'').length>15000)))}
  reports.push({reasoningTokensPerStep:reasoningTokens,result:result.ok?'completed':result.error,modelCalls:probe.totals().providerPosts,maxInputEstimate:peak,maxCheckpointBytes:probe.totals().maxCheckpointBytes,
   finalNativeItems:final.messages.filter((m:any)=>m.nativeOutput).length,early:probe.claims.filter(c=>c.step===2).map(c=>({policy:c.policy,lookup:c.lookupDispatch,cpuMs:c.cpuMs})),late:probe.claims.filter(c=>c.step===40).map(c=>({policy:c.policy,lookup:c.lookupDispatch,cpuMs:c.cpuMs}))})
 }
 t.diagnostic(JSON.stringify({note:'Scripted Node fixture, same estimator as dispatch; real reasoning usage supplied, opaque transport placeholders. Not model/cache/hosted CPU evidence. Higher profile approximates the prior 100k reasoning-token turn; activation remains blocked.',reports}))
})

test('prompt publication is slimmer, keeps exact routes and authority, and does not activate native main turns',async t=>{
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
 assert.deepEqual(current.definition('bob.tools').definition,old.definition('bob.tools').definition)
 assert.deepEqual(current.definition('agent-contract.ask-bob').metadata,old.definition('agent-contract.ask-bob').metadata)
 t.diagnostic(`Construction method tokens ${countContextTokens(method(old))} -> ${countContextTokens(method(current))}; runtime fences unchanged.`)
})
