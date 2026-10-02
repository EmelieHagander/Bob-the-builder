import {test} from 'node:test'
import assert from 'node:assert/strict'
import {budgetFailure,readBudgetStop,budgetStopMessage} from '../supabase/functions/_shared/bob-budget-stop.ts'
import {createBobModelBudget} from '../supabase/functions/_shared/bob-model-budget.ts'
import {createDrawingBudget} from '../supabase/functions/_shared/drawing-budget.ts'

const reply=(cost:number|null)=>({success:true,data:'ok',model:'fixture',estimatedCostUsd:cost,usage:{input_tokens:1,output_tokens:1,total_tokens:2}})
test('turn stops preserve every exhausted constraint, without another model call',async()=>{
 for(const [cost,limit,expected] of [[1.1,24,['usd_limit']],[0,1,['call_limit']],[null,24,['unpriced_usage']],[1.1,1,['usd_limit','call_limit']]] as const){
  const budget=createBobModelBudget(1,limit);await budget.run(async()=>reply(cost))
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
 assert.match(budgetStopMessage({scope:'turn',reasons:['call_limit']}),/antal modellanrop/)
 assert.match(budgetStopMessage({scope:'drawing_request',reasons:['pending_outcome','usd_limit']}),/inte är klarlagt/)
 const stopped=budgetFailure({scope:'turn',reasons:['usd_limit']})
 assert.equal(stopped.usage.total_tokens,0);assert.equal(stopped.success,false)
})
