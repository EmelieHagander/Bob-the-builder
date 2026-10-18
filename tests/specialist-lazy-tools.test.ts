import {test} from 'node:test'
import assert from 'node:assert/strict'
import {callWithCalculator,type SpecialistContextSurfaceRegistrar} from '../supabase/functions/_shared/calculator-model-call.ts'
import {createBobContextContinuation,type ContextSurface} from '../supabase/functions/_shared/bob-context-continuation.ts'
import {createBobJournal,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'
import {createProjectCalculator} from '../supabase/functions/_shared/project-calculator.ts'
import {catalogFixture,catalogCall} from './support/ai-catalog-fixture.ts'
import type {OpenAIServiceOptions} from '../supabase/functions/_shared/openai-service.ts'

const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const graph={calculation:{method:'parameter_graph_v1',nodes:[
 {id:'span',role:'decision',value:10,unit:'mm',reason:'Explicit proposed decision'},
 {id:'clearance',role:'decision',value:3,unit:'mm',reason:'Explicit proposed decision'},
 {id:'inside',role:'derived',operation:'subtract_v1',operands:['span','clearance'],rounding:'exact'},
],outputs:['inside']}}
const call=(id:string,name:string,args:unknown)=>({success:true,data:null,responseId:'r-'+id,model:'fixture',usage,
 toolCalls:[{id,type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
const done={success:true,data:{finished:true},responseId:'finished',model:'fixture',usage}
const roleOptions=(role:string):OpenAIServiceOptions=>({app:'bob',module:role==='cad-reviewer'?'cad':'living-plan',coworkerId:'bob',
 functionName:role,aiFunction:role,catalogRoleKey:role,catalogSchemaKey:role==='plan-compiler'?'bob_plan_compilation':role==='plan-reviewer'?'bob_plan_review':'bob_cad_review',
 prompt:'Review only this exact assignment. Unknown physical measurements stay unknown.'})
function lazyCatalog(edit?:(snapshot:any)=>void){return catalogFixture(snapshot=>{
 const contract=snapshot.definitions.find(row=>row.prompt_key==='agent-contract.ask-bob')!
 contract.metadata.specialist_tool_instructions_version=1
 for(const role of ['plan-compiler','plan-reviewer','cad-reviewer']){
  const row=snapshot.definitions.find(row=>row.prompt_key==='role.'+role)!
  row.definition.tool_keys=[...new Set([...(row.definition.tool_keys as string[]),'tools.describe_tool'])]
 }
 edit?.(snapshot)
})}
function calculator(enabled=()=>true,access=()=>true){
 let executions=0
 const unexpected=async()=>{throw new Error('Unexpected source read')}
 const calc=createProjectCalculator({projectId:'A',unlimitedWork:true,hasAccess:async()=>access(),isEnabled:async()=>enabled(),
  readSources:async()=>{executions++;return {project:new Map(),physical:new Map()}},readSource:unexpected,readConstruction:unexpected,quotePacks:unexpected})
 return {calc,executions:()=>executions}
}
const names=(o:Pick<OpenAIServiceOptions,'tools'>)=>o.tools?.map(tool=>tool.function.name)??[]
const directory=(o:Pick<OpenAIServiceOptions,'systemMessage'>)=>JSON.parse(o.systemMessage!.split('\n\n').at(-1)!).tool_directory

for(const role of ['plan-compiler','plan-reviewer','cad-reviewer'])test(role+' reads a scoped card, opens its manual and calculates with the pinned native schema',async()=>{
 const catalog=lazyCatalog(),{calc,executions}=calculator(),sent:OpenAIServiceOptions[]=[]
 const result=await callWithCalculator(roleOptions(role),{catalog,calculator:calc,unlimitedWork:true,hasAccess:async()=>true,deadline:Infinity,
  callModel:catalogCall(async options=>{
   sent.push(options)
   assert.equal(options.structuredToolOutput,true)
   assert.equal(options.catalogSchemaKey,roleOptions(role).catalogSchemaKey)
   if(sent.length===1){
    assert.deepEqual(names(options),['describe_tool'])
    assert.equal(options.messages?.[0].content,roleOptions(role).prompt)
    assert.deepEqual(directory(options).map((entry:any)=>entry.name),['calculate_project','describe_tool'])
    assert.equal(directory(options)[0].instructionLoaded,false)
    assert(!options.systemMessage?.includes('parameter_graph_v1'),'full schema is absent from initial context')
    return call('manual','describe_tool',{name:'calculate_project'})
   }
   assert.deepEqual(names(options),['calculate_project','describe_tool'])
   if(sent.length===2){
    const manual=JSON.parse(String(options.messages![0].content))
    assert.equal(manual.status,'ok');assert.equal(manual.callable_from_next_step,true)
    assert.equal(manual.manual,catalog.tool('calculate_project',{include_manual:true}).function.description)
    assert.deepEqual(manual.parameters,catalog.tool('calculate_project').function.parameters)
    assert.deepEqual(options.tools![0].function.parameters,manual.parameters)
    assert.equal(options.tools![0].function.description,catalog.tool('calculate_project',{card:true}).function.description)
    return call('calc','calculate_project',graph)
   }
   const calculation=JSON.parse(String(options.messages![0].content))
   assert.equal(calculation.outputs[0].value,7);assert.equal(calculation.saved,false)
   return done
  },catalog)})
 assert.deepEqual(result,done);assert.equal(executions(),1);assert.equal(sent.length,3)
})

test('specialists may finish structured work without opening a calculator manual',async()=>{
 const catalog=lazyCatalog(),{calc,executions}=calculator()
 const result=await callWithCalculator(roleOptions('plan-reviewer'),{catalog,calculator:calc,hasAccess:async()=>true,deadline:Infinity,
  callModel:async options=>{assert.deepEqual(names(options),['describe_tool']);return done}})
 assert.deepEqual(result,done);assert.equal(executions(),0)
})

test('discovery never exposes another role tool and cannot enable execution in its own model step',async()=>{
 const catalog=lazyCatalog(),{calc,executions}=calculator();let calls=0
 const result=await callWithCalculator(roleOptions('plan-reviewer'),{catalog,calculator:calc,hasAccess:async()=>true,deadline:Infinity,
  callModel:async options=>{
   if(++calls===1)return call('hidden','describe_tool',{name:'save_construction_draft'})
   assert.deepEqual(JSON.parse(String(options.messages![0].content)),{status:'unavailable'})
   assert.deepEqual(names(options),['describe_tool'])
   return {...call('manual','describe_tool',{name:'calculate_project'}),toolCalls:[
    ...call('manual','describe_tool',{name:'calculate_project'}).toolCalls,...call('calc','calculate_project',graph).toolCalls]}
  }})
 assert.equal(result.error,'calculator_protocol');assert.equal(executions(),0)
})

test('disabled policy and incompatible pinned schema reveal neither a card nor a manual',async()=>{
 for(const incompatible of [false,true]){
  const catalog=lazyCatalog(snapshot=>{if(incompatible)snapshot.definitions.find((r:any)=>r.prompt_key==='tools.calculate_project').definition.envelope.schema_version=2})
  const {calc,executions}=calculator(()=>incompatible)
  const result=await callWithCalculator(roleOptions('plan-reviewer'),{catalog,calculator:calc,hasAccess:async()=>true,deadline:Infinity,
   callModel:async options=>{assert.deepEqual(names(options),[]);assert.deepEqual(directory(options),[]);return done}})
  assert.equal(result.success,true);assert.equal(executions(),0)
 }
})

test('policy and membership are checked again after manual discovery and before calculation',async()=>{
 for(const revoked of ['policy','membership']){
  const catalog=lazyCatalog();let enabled=true,access=true,calls=0
  const {calc,executions}=calculator(()=>enabled,()=>access)
  const run=callWithCalculator(roleOptions('plan-reviewer'),{catalog,calculator:calc,hasAccess:async()=>access,deadline:Infinity,
   callModel:async options=>{
    if(++calls===1)return call('manual','describe_tool',{name:'calculate_project'})
    if(calls===2){if(revoked==='policy')enabled=false;else access=false;return call('calc','calculate_project',graph)}
    assert.deepEqual(JSON.parse(String(options.messages![0].content)),{status:'unavailable'})
    assert.deepEqual(names(options),[]);return done
   }})
  if(revoked==='membership')await assert.rejects(run,/project_denied/)
  else assert.equal((await run).success,true)
  assert.equal(executions(),0)
 }
})

test('missing assigned calculator/manual contract fails closed without widening the specialist toolbox',async()=>{
 const catalog=lazyCatalog(snapshot=>{snapshot.definitions.find((r:any)=>r.prompt_key==='role.plan-reviewer').definition.tool_keys=['tools.describe_tool']})
 const {calc}=calculator()
 const result=await callWithCalculator(roleOptions('plan-reviewer'),{catalog,calculator:calc,hasAccess:async()=>true,deadline:Infinity,
  callModel:async()=>{throw new Error('Unassigned calculator reached the model')}})
 assert.equal(result.error,'calculator_contract_missing')
})

test('unknown explicit instruction policy cannot select the historical eager path',async()=>{
 const catalog=lazyCatalog(snapshot=>{snapshot.definitions.find((r:any)=>r.prompt_key==='agent-contract.ask-bob').metadata.specialist_tool_instructions_version=2})
 const {calc}=calculator()
 await assert.rejects(callWithCalculator(roleOptions('plan-reviewer'),{catalog,calculator:calc,hasAccess:async()=>true,deadline:Infinity,
  callModel:async()=>{throw new Error('Unknown policy reached the model')}}),/calculator_instruction_policy_unavailable/)
})

test('actual context renewal forgets specialist manuals, preserves the assignment, reloads and replays paid responses',async()=>{
 const entries:JournalEntry[]=[]
 async function run(){
  const catalog=lazyCatalog(snapshot=>{Object.assign(snapshot.definitions.find((r:any)=>r.prompt_key==='agent-contract.ask-bob').metadata,
   {continuation_input_tokens:20000,retained_tool_exchanges:1,continuation_retention_version:2})})
  const {calc}=calculator();let dispatched=0,model=0,renewals=0
  const sent:OpenAIServiceOptions[]=[],surfaces=new Map<string,()=>Promise<ContextSurface>>()
  const register:SpecialistContextSurfaceRegistrar=(role,refresh)=>{surfaces.set(role,refresh);return()=>{surfaces.delete(role)}}
  const journal=createBobJournal({entries,save:async entry=>{entries.push(structuredClone(entry))}},Date.now()+100000)
  const continuation=createBobContextContinuation({version:1,aiCatalog:catalog,
   refreshSurface:async({role})=>{renewals++;return surfaces.get(role)?.()},
   callModel:async options=>{
    sent.push(structuredClone(options))
    return journal.run('model:'+options.functionName,options,async()=>{
     dispatched++
     if(options.catalogRoleKey==='context-compactor')return {success:true,data:{summary:'Continue the exact assigned review. Calculations remain previews.',open_questions:[],next_steps:['Continue the review.'],source_refs:[]},model:'fixture',usage}
     switch(++model){
      case 1:return call('manual','describe_tool',{name:'calculate_project'})
      case 2:return {...call('calc','calculate_project',graph),usage:{input_tokens:21000,output_tokens:10,total_tokens:21010}}
      case 3:
       assert.equal(options.previousResponseId,undefined)
       assert(!names(options).includes('calculate_project'));assert(names(options).includes('describe_tool'))
       assert.equal(directory(options)[0].instructionLoaded,false)
       assert.equal(options.messages?.[0].content,roleOptions('plan-reviewer').prompt)
       assert(options.messages?.some(message=>message.role==='tool'&&message.tool_call_id==='calc'))
       return call('reload','describe_tool',{name:'calculate_project'})
      case 4:assert(names(options).includes('calculate_project'));return done
      default:throw new Error('Unexpected model call')
     }
    })
   }})
  const result=await callWithCalculator(roleOptions('plan-reviewer'),{catalog,calculator:calc,unlimitedWork:true,hasAccess:async()=>true,deadline:Infinity,
   registerContextSurface:register,callModel:continuation.call})
  assert.equal(surfaces.size,0,'scoped registration is released after completion')
  return {result,sent,dispatched,renewals}
 }
 const first=await run();assert.equal(first.renewals,1);assert.equal(first.dispatched,5)
 const replay=await run();assert.equal(replay.dispatched,0);assert.deepEqual(replay.result,first.result);assert.deepEqual(replay.sent,first.sent)
})
