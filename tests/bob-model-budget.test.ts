import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobModelBudget, type DrawingBudgetAuthority } from '../supabase/functions/_shared/bob-model-budget.ts'
import { createBobJournal, BobContinuation, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
import { createDrawingBudget } from '../supabase/functions/_shared/drawing-budget.ts'
const reply=(cost:number|null)=>({success:true,data:'ok',model:'fixture',estimatedCostUsd:cost,usage:{input_tokens:1,output_tokens:1,total_tokens:2}})
const drawingAuthority=(role='cad-designer'):DrawingBudgetAuthority=>({requestId:'11111111-1111-4111-8111-111111111111',
 options:{app:'bob',coworkerId:'bob',module:'cad',functionName:role,aiFunction:role,aiDefinition:{app:'bob',roleKey:'role.'+role} as any}})
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

test('design work stops at the limit minus the review reserve; review and delivery can still run from it',async()=>{
 const budget=createBobModelBudget(1,24)
 assert((await budget.run(async()=>reply(.86),'cad-designer')).success)
 const held=await budget.run(async()=>{throw new Error('must not dispatch design')},'cad-designer')
 assert.equal(held.error,'turn_budget_exhausted')
 const stop=(held as any).budget_stop
 assert.deepEqual(stop.reasons,['usd_limit','review_reserve']);assert.equal(stop.usd_limit,.85)
 assert((await budget.run(async()=>reply(.1),'cad-reviewer')).success)
 assert((await budget.run(async()=>reply(.05),'bob-delivery-language')).success)
 const spent=await budget.run(async()=>{throw new Error('must not dispatch')},'bob-delivery-language')
 assert.deepEqual((spent as any).budget_stop.reasons,['usd_limit'],'the whole turn limit still holds for reserved roles')
 const calls=createBobModelBudget(1,5)
 for(let i=0;i<2;i++)assert((await calls.run(async()=>reply(0),'ask-bob')).success)
 assert.deepEqual(((await calls.run(async()=>reply(0),'ask-bob')) as any).budget_stop.reasons,['call_limit','review_reserve'])
 for(let i=0;i<3;i++)assert((await calls.run(async()=>reply(0),'cad-reviewer')).success)
 assert.deepEqual(((await calls.run(async()=>reply(0),'cad-reviewer')) as any).budget_stop.reasons,['call_limit'])
})

test('a governed CAD attempt can finish review after $1 without consuming ordinary Bob save/delivery budget',async()=>{
 const budget=createBobModelBudget(1,24)
 for(const role of ['cad-research','cad-designer','cad-designer','cad-reviewer']){
  const result=await budget.run(async()=>reply(.4),role,drawingAuthority(role))
  assert(result.success)
 }
 assert.deepEqual(budget.usage,{spent:0,calls:0,unpriced:false,limitUsd:1})
 assert((await budget.run(async()=>reply(.3),'ask-bob')).success)
 assert((await budget.run(async()=>reply(.1),'bob-delivery-language')).success)
 assert.equal(budget.usage.spent,.4);assert.equal(budget.usage.calls,2)
})

test('durable CAD technical limits are not counted twice and its ledger stop remains authoritative',async()=>{
 const budget=createBobModelBudget(1,2,{usd:0,calls:0,roles:[]}),authority=drawingAuthority();let requestCalls=0
 const dispatch=async()=>++requestCalls<=3?reply(.4):{...reply(0),success:false,data:null,error:'turn_budget_exhausted'}
 for(let index=0;index<3;index++)assert((await budget.run(dispatch,'cad-designer',authority)).success)
 assert.equal((await budget.run(dispatch,'cad-designer',authority)).error,'turn_budget_exhausted')
 assert.equal(requestCalls,4);assert.equal(budget.usage.calls,0)
 assert((await budget.run(async()=>reply(0),'ask-bob')).success)
 assert((await budget.run(async()=>reply(0),'ask-bob')).success)
 assert.equal((await budget.run(async()=>{throw new Error('ordinary limit must stop dispatch')},'ask-bob')).error,'turn_budget_exhausted')
})

test('a request binding cannot exempt ordinary roles, another app or an unpinned CAD call',async()=>{
 const invalid=[
  {...drawingAuthority(),requestId:'unbound'},
  {...drawingAuthority(),options:{...drawingAuthority().options,aiDefinition:undefined}},
  {...drawingAuthority(),options:{...drawingAuthority().options,module:'global'}},
  {...drawingAuthority(),options:{...drawingAuthority().options,app:'other'}},
  drawingAuthority('ask-bob'),
 ]
 for(const authority of invalid){
  const budget=createBobModelBudget(1)
  await budget.run(async()=>reply(1.1),authority.options.aiFunction,authority)
  assert.equal((await budget.run(async()=>{throw new Error('must remain ordinary')},authority.options.aiFunction,authority)).error,'turn_budget_exhausted')
  assert.equal(budget.usage.spent,1.1)
 }
 const ordinary=createBobModelBudget(1)
 await ordinary.run(async()=>reply(null),'ask-bob',drawingAuthority('ask-bob'))
 assert.equal((await ordinary.run(async()=>{throw new Error('unknown cost cannot become free')},'ask-bob',drawingAuthority('ask-bob'))).error,'turn_budget_exhausted')
})

test('worker replay reuses governed CAD results and charges the persisted request once',async()=>{
 const entries:JournalEntry[]=[],reservations=new Map<string,{response?:unknown}>();let charged=0,dispatches=0,commands=0
 const request=createDrawingBudget({executionId:'job',command:async input=>{
  commands++;const key=String(input.p_key)
  if(input.p_operation==='reserve'){
   const saved=reservations.get(key)
   if(saved?.response)return {status:'completed',response:saved.response}
   reservations.set(key,{});return {status:'reserved'}
  }
  const row=reservations.get(key)!
  if(!row.response){row.response=input.p_response;charged+=(input.p_response as any).estimatedCostUsd}
  return {status:'completed'}
 }})
 for(let segment=0;segment<2;segment++){
  const budget=createBobModelBudget(),journal=createBobJournal({entries,save:async entry=>{entries.push(entry)}},Date.now()+10000)
  for(let step=0;step<2;step++){
   const authority=drawingAuthority(),options={...authority.options,prompt:'geometry-'+step} as any
   const result=await budget.run(()=>journal.run('model:cad-designer',options,()=>request(authority.requestId,options,async()=>{dispatches++;return reply(.7)})),'cad-designer',authority)
   assert(result.success)
  }
  assert.equal(budget.usage.calls,0);assert.equal(budget.usage.spent,0)
 }
 assert.equal(dispatches,2);assert.equal(charged,1.4);assert.equal(commands,4)
})
