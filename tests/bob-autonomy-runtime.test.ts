import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runProjectAnswer} from './support/bob-model-routing.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createPlanAssistant} from './support/colleague-catalog-fixture.ts'

const message='Ta bort det steget och skriv instruktionerna för ritningen.'
const lookup=()=>createProjectLookup('A',async(_p,i)=>({data:{records:i.dataset==='project'?[{id:'A',name:'Fixture'}]:[],related:[],truncated:false},error:null}),1000,128)
const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const response=(data:string|null,toolCalls?:any[])=>({success:true,data,model:'fixture',responseId:'resp',usage,toolCalls})

test('a failed plan edit leaves Bob free to finish other work, and fabricated quotes still fail', async()=>{
 let calls=0,writes=0
 const assistant=createPlanAssistant({projectId:'A',userId:'u',hasAccess:async()=>true,makeLookup:lookup,callModel:async()=>{throw new Error('not needed')}})
 const writer=createProjectWriter('A',message,async()=>{writes++;return {data:{projectId:'A',dataset:'tasks',recordId:'task',label:'Drawing',operation:'created',savedAt:'2026-09-25T11:00:00Z',record:{id:'task',name:'Drawing'}},error:null}},async()=>({data:[],error:null}))
 const result=await runProjectAnswer({projectId:'A',userId:'u',message,lookup:lookup(),writer,planAssistant:assistant,hasAccess:async()=>true,
  callModel:async o=>{
   calls++; assert.equal(o.tool_choice,undefined,'nothing is forced')
   if(calls===1)return response(null,[{id:'edit',type:'function',function:{name:'edit_project_plan',arguments:JSON.stringify({summary:'Remove obsolete step',reason:'Owner request',changes:[{action:'remove_step',step_id:'30000000-0000-4000-8000-000000000001',requirement_id:null,after_step_id:null,task_id:null,values:{}}]})}}])
   if(calls===2){
    assert.notEqual(JSON.parse(String(o.messages?.[0].content)).status,'ok','there is no plan to edit')
    return response(null,[{id:'save',type:'function',function:{name:'save_project_task',arguments:JSON.stringify({record_id:null,area_id:'fixture-area',name:'Drawing',instructions:'Draw a concept with assumptions',expected_updated_at:null,request_quote:message})}}])
   }
   assert.equal(JSON.parse(String(o.messages?.[0].content)).status,'saved')
   return response('Instruktionerna är sparade. Planen har inget steg att ta bort ännu.')
  }})
 assert.equal(result.ok,true);assert.equal(writes,1);assert.equal(calls,3,'no hidden review when the server knows of nothing unfinished')
 if(result.ok)assert.equal(result.answer,'Instruktionerna är sparade. Planen har inget steg att ta bort ännu.')
 assert.equal((await writer.write('save_project_task',{record_id:null,area_id:'fixture-area',name:'Extra',instructions:'Outside request',expected_updated_at:null,request_quote:'fabricated approval'})).status,'invalid')
 assert.equal(writes,1)
})

test('ordinary read-only answers incur no completion review',async()=>{
 let calls=0
 const result=await runProjectAnswer({projectId:'A',userId:'u',message:'Vad heter projektet?',lookup:lookup(),hasAccess:async()=>true,callModel:async()=>{calls++;return response('Fixture.')}})
 assert.equal(result.ok,true);assert.equal(calls,1)
})

const tool=(id:string,name:string,args:unknown)=>({id,type:'function' as const,function:{name,arguments:JSON.stringify(args)}})
const taskArgs=(name:string)=>({record_id:null,area_id:'fixture-area',name,instructions:'Do it',expected_updated_at:null,request_quote:message})

test('a refused record ID becomes a correctable result while access holds; real loss of access still ends the turn',async()=>{
 for(const accessAfter of [true,false]){
  let calls=0,checks=0
  const writer=createProjectWriter('A',message,async()=>({data:null,error:{code:'42501',message:'project_denied'}}),async()=>({data:[],error:null}))
  const result=await runProjectAnswer({projectId:'A',userId:'u',message,lookup:lookup(),writer,hasAccess:async()=>++checks<3||accessAfter,
   callModel:async o=>{
    if(++calls===1)return response(null,[tool('t','save_project_task',{...taskArgs('Wrong id'),record_id:'task-from-another-project',expected_updated_at:'2026-09-25T11:00:00Z'})])
    assert.equal(JSON.parse(String(o.messages![0].content)).status,'not_found')
    return response('Den uppgiften finns inte i projektet; jag skapar en ny i stället.')
   }})
  if(accessAfter){assert(result.ok);assert.equal(calls,2)}
  else assert.deepEqual(result,{ok:false,error:'project_denied'})
 }
})

test('calls beyond the per-step limit are deferred to the next step instead of failing the turn',async()=>{
 let calls=0,writes=0
 const writer=createProjectWriter('A',message,async p=>{writes++;return {data:{projectId:'A',dataset:'tasks',recordId:'t'+writes,label:String(p.data.name),operation:'created',savedAt:'2026-09-25T11:00:00Z',record:{id:'t'+writes}},error:null}},async()=>({data:[],error:null}))
 const result=await runProjectAnswer({projectId:'A',userId:'u',message,lookup:lookup(),writer,hasAccess:async()=>true,callModel:async o=>{
  calls++
  if(calls===1)return response(null,Array.from({length:10},(_,i)=>tool('c'+i,'save_project_task',taskArgs('Task '+i))))
  if(calls===2){const statuses=o.messages!.map(m=>JSON.parse(String(m.content)).status);assert.deepEqual(statuses.slice(0,8),Array(8).fill('saved'));assert.deepEqual(statuses.slice(8),['deferred','deferred'])
   return response(null,[tool('d8','save_project_task',taskArgs('Task 8')),tool('d9','save_project_task',taskArgs('Task 9'))])}
  return response('Tio uppgifter sparade.')
 }})
 assert(result.ok);assert.equal(writes,10);assert.equal(result.evidence.writes?.length,10)
})

test('the closing step shuts the bench with a labelled note and the end reason is observed',async()=>{
 let calls=0;const seen:any[]=[],progress:any[]=[]
 const result=await runProjectAnswer({projectId:'A',userId:'u',message:'Vad heter projektet?',lookup:lookup(),hasAccess:async()=>true,observe:v=>seen.push(v),onProgress:v=>progress.push(v),
  callModel:async o=>{calls++
   if(calls<24)return response(null,[tool('s'+calls,'search_project_data',{dataset:'tasks',query:null,status:null,area_id:null,record_id:null,after_id:null})])
   assert.equal(o.tools,undefined);assert.match(String(o.messages!.at(-1)!.content),/^\[Server note — not from the owner\] The tool bench is closed/)
   return response('Projektet heter Fixture; resten fortsätter jag med nästa gång.')}})
 assert(result.ok);assert.equal(calls,24);assert.equal(seen.at(-1).end,'step_budget');assert.equal(seen.at(-1).tool_calls,23)
 assert(progress.some(p=>p.stage==='tool'&&p.tool==='search_project_data'));assert.equal(progress.at(-1).stage,'finishing')
})

test('records consulted in the previous reply reach the next turn as pointers only',async()=>{
 let frame=''
 const result=await runProjectAnswer({projectId:'A',userId:'u',message:'Fortsätt',lookup:lookup(),hasAccess:async()=>true,
  context:{summary:'',throughSeq:0,recent:[{seq:1,role:'user',text:'Fortsätt',state:'pending'}],recentWrites:[],recentSources:[{dataset:'tasks',recordId:'task-7',label:'Frame the wall'}],history:{remaining:4,search:async()=>({status:'empty'})}},
  callModel:async o=>{frame=String(o.messages![0].content);return response('Okej.')}})
 assert(result.ok);assert.match(frame,/Records you consulted in your previous reply/);assert.match(frame,/task-7/)
})
