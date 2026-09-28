import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobModelBudget } from '../supabase/functions/_shared/bob-model-budget.ts'
import { createBobJournal, BobContinuation, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
const reply=(cost:number|null)=>({success:true,data:'ok',model:'fixture',estimatedCostUsd:cost,usage:{input_tokens:1,output_tokens:1,total_tokens:2}})
test('all roles share a spending threshold and the crossing call is the final dispatch',async()=>{
 const budget=createBobModelBudget(1);let calls=0
 for(const cost of [.2,.3,.6])assert((await budget.run(async()=>{calls++;return reply(cost)})).success)
 const stopped=await budget.run(async()=>{calls++;return reply(.1)})
 assert.equal(stopped.error,'turn_budget_exhausted');assert.equal(calls,3)
 assert.equal(budget.usage.spent,1.1)
})
test('unknown prices and maximum call count fail closed rather than inventing zero spend',async()=>{
 const unknown=createBobModelBudget();await unknown.run(async()=>reply(null))
 assert.equal((await unknown.run(async()=>{throw new Error('must not dispatch')})).error,'turn_budget_exhausted')
 const count=createBobModelBudget(1,2)
 await count.run(async()=>reply(0));await count.run(async()=>reply(0))
 assert.equal((await count.run(async()=>{throw new Error('must not dispatch')})).error,'turn_budget_exhausted')
})
test('resuming the durable turn rebuilds prior spend without rebilling or resetting the threshold',async()=>{
 const entries:JournalEntry[]=[];let dispatches=0,now=0
 const segment=()=>{
  const budget=createBobModelBudget(.5),journal=createBobJournal({entries,save:async e=>{entries.push(e)}},20000,()=>now)
  return (index:number)=>budget.run(()=>journal.run('model:test',{index},async()=>{dispatches++;if(index===0)now=15000;return reply(.3)},10000))
 }
 let run=segment();await run(0)
 await assert.rejects(run(1),e=>e instanceof BobContinuation)
 now=0;run=segment();await run(0);await run(1)
 assert.equal((await run(2)).error,'turn_budget_exhausted');assert.equal(dispatches,2)
})

test('failed charged results rebuild the spending threshold across durable replay',async()=>{
 const entries:JournalEntry[]=[];let calls=0
 const run=async()=>{
  const budget=createBobModelBudget(1),journal=createBobJournal({entries,save:async e=>{entries.push(e)}},Date.now()+10000)
  const first=await budget.run(()=>journal.run('model:design',{},async()=>{calls++;return {...reply(1.01),success:false,data:null,error:'model_output_limit'}}))
  assert.equal(first.error,'model_output_limit')
  assert.equal((await budget.run(async()=>{throw new Error('must not retry')})).error,'turn_budget_exhausted')
 }
 await run();await run();assert.equal(calls,1)
})
