import {test} from 'node:test'
import assert from 'node:assert/strict'
import {budgetFailure,readBudgetStop,budgetStopMessage,withoutBudgetDetails} from '../supabase/functions/_shared/bob-budget-stop.ts'
import {createBobModelBudget} from '../supabase/functions/_shared/bob-model-budget.ts'
import {createDrawingBudget} from '../supabase/functions/_shared/drawing-budget.ts'

const reply=(cost:number|null)=>({success:true,data:'ok',model:'fixture',estimatedCostUsd:cost,usage:{input_tokens:1,output_tokens:1,total_tokens:2}})
test('task stops remain private while Bob receives only the actionable pause',()=>{
 const original={status:'unavailable',reason:'turn_budget_exhausted',saved:false,budget_stop:{scope:'task',calls:24,spent_usd:3},budget_grant:{usd:1,calls:24}}
 const visible=withoutBudgetDetails(original)
 assert.deepEqual(visible,{status:'unavailable',reason:'paused_at_limit',saved:false})
 assert.equal(original.budget_stop.calls,24)
})
test('attempt identity reaches provider recovery and completion; uncertainty survives journal replay without exposing the ledger',async()=>{
 const commands:any[]=[]
 const key='b'.repeat(64),fingerprint='c'.repeat(64)
 const response={...reply(.1),responseId:'resp_fixture'}
 const b=createDrawingBudget({executionId:'fresh-job',command:async input=>{commands.push(input);return {status:input.p_operation==='reserve'?'recover':'completed',key,prior_outcome_unknown:true,execution_id:'original-job',recovery:{key:'provider-key',context:{jobId:'original-job'},expiresAt:'2030-01-01',fingerprint}}}})
 const result=await b('request',{functionName:'cad-reviewer'} as any,async recovery=>{assert.equal(recovery?.fingerprint,fingerprint);return response})
 assert.equal(result.priorAttemptUncertain,true)
 assert.equal(commands[1].p_key,key);assert.equal(commands[1].p_execution,'original-job')
 assert.equal(commands[1].p_response.priorAttemptUncertain,undefined,'paid output remains a reusable provider result')
})
test('turn stops preserve every exhausted constraint, without another model call',async()=>{
 for(const [cost,limit,expected] of [[1.1,24,['usd_limit']],[0,1,['call_limit']],[null,24,['unpriced_usage']],[1.1,1,['usd_limit','call_limit']]] as const){
  const budget=createBobModelBudget(1,limit,{usd:0,calls:0,roles:[]});await budget.run(async()=>reply(cost))
  const stopped=await budget.run(async()=>{throw new Error('must not dispatch')})
  assert.deepEqual(readBudgetStop(stopped)?.reasons,expected)
  assert.equal(readBudgetStop(stopped)?.scope,'turn');assert.equal(readBudgetStop(stopped)?.calls,1)
  assert.equal(stopped.error,'turn_budget_exhausted')
 }
})
test('request diagnostics survive the wrapper; old-server ambiguity stays unknown',async()=>{
 for(const response of [
  {status:'budget_exhausted',budget_stop:{scope:'drawing_request',reasons:['usd_limit'],calls:12,call_limit:24,spent_usd:1.119091,usd_limit:1}},
  {status:'budget_exhausted'}, {status:'outcome_unknown'}, {status:'context_cleared'},
 ]){
  const b=createDrawingBudget({executionId:'execution',command:async()=>response})
  const result=await b('request',{functionName:'cad-designer'} as any,async()=>{throw new Error('must not dispatch')})
  const stop=readBudgetStop(result)!
  assert.equal(stop.scope,'drawing_request')
  assert.deepEqual(stop.reasons,response.budget_stop?.reasons??[response.status==='outcome_unknown'?'pending_outcome':response.status==='context_cleared'?'context_cleared':'unknown'])
  if(response.budget_stop)assert.equal(stop.spent_usd,1.119091)
 }
})
test('diagnostics expose only bounded known fields and never invent cost on ambiguous stops',()=>{
 assert.equal(readBudgetStop({budget_stop:{scope:'turn',reasons:['forged']}}),undefined)
 assert.deepEqual(readBudgetStop({budget_stop:{scope:'turn',reasons:['call_limit'],spent_usd:NaN,calls:-1,credential:'secret'}}),{scope:'turn',reasons:['call_limit']})
 assert.match(budgetStopMessage(undefined),/exakta orsaken/)
 assert.match(budgetStopMessage({scope:'turn',reasons:['call_limit']}),/pausades vid en gräns/)
 assert.match(budgetStopMessage({scope:'drawing_request',reasons:['pending_outcome','usd_limit']}),/tidigare steg är avslutat/)
 for(const stop of [undefined,{scope:'turn' as const,reasons:['usd_limit' as const]},{scope:'drawing_request' as const,reasons:['call_limit' as const,'usd_limit' as const]}])
  assert.doesNotMatch(budgetStopMessage(stop),/budget|kostnad|anrop|\$/,'the owner hears about the pause, not the ledger')
 const stopped=budgetFailure({scope:'turn',reasons:['usd_limit']})
 assert.equal(stopped.usage.total_tokens,0);assert.equal(stopped.success,false)
})
