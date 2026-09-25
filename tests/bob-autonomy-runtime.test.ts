import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runProjectAnswer} from './support/bob-model-routing.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createPlanAssistant} from '../supabase/functions/_shared/plan-assistant.ts'

const message='Ta bort det steget och skriv instruktionerna för ritningen.'
const lookup=()=>createProjectLookup('A',async(_p,i)=>({data:{records:i.dataset==='project'?[{id:'A',name:'Fixture'}]:[],related:[],truncated:false},error:null}),1000,128)
const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const response=(data:string|null,toolCalls?:any[])=>({success:true,data,model:'fixture',responseId:'resp',usage,toolCalls})

test('a failed plan edit cannot prematurely end independent delegated work; review is bounded and writes retain their quote checks',async()=>{
 let calls=0,writes=0
 const assistant=createPlanAssistant({projectId:'A',userId:'u',hasAccess:async()=>true,makeLookup:lookup,callModel:async()=>{throw new Error('not needed')}})
 // Real failure: no approved plan to edit. The next delegated subtask is still possible.
 await assistant.consult('edit_project_plan',{summary:'Remove obsolete step',reason:'Owner request',changes:[{action:'remove_step',step_id:'30000000-0000-4000-8000-000000000001',requirement_id:null,after_step_id:null,task_id:null,values:{}}]})
 const writer=createProjectWriter('A',message,async()=>{writes++;return {data:{projectId:'A',dataset:'tasks',recordId:'task',label:'Drawing',operation:'created',savedAt:'2026-09-25T11:00:00Z',record:{id:'task',name:'Drawing'}},error:null}},async()=>({data:[],error:null}))
 const result=await runProjectAnswer({projectId:'A',userId:'u',message,lookup:lookup(),writer,planAssistant:assistant,hasAccess:async()=>true,
  callModel:async o=>{
   calls++
   if(calls===1)return response('Planändringen gick inte. Jag kan skriva instruktionerna nästa gång.')
   if(calls===2){
    assert.equal(o.messages?.[0].role,'system','the review must not fabricate a new user instruction')
    assert.match(String(o.messages?.[0].content),/current request/)
    return response(null,[{id:'save',type:'function',function:{name:'save_project_task',arguments:JSON.stringify({record_id:null,area_id:'fixture-area',name:'Drawing',instructions:'Draw a concept with assumptions',expected_updated_at:null,request_quote:message})}}])
   }
   assert.equal(JSON.parse(String(o.messages?.[0].content)).status,'saved')
   return response('Instruktionerna är sparade. Planen saknas fortfarande.')
  }})
 assert.equal(result.ok,true);assert.equal(writes,1);assert.equal(calls,3,'a still-blocked plan must not cause repeated review')
 assert.equal((await writer.write('save_project_task',{record_id:null,area_id:'fixture-area',name:'Extra',instructions:'Outside request',expected_updated_at:null,request_quote:'fabricated approval'})).status,'invalid')
 assert.equal(writes,1)
})

test('ordinary read-only answers incur no completion review',async()=>{
 let calls=0
 const result=await runProjectAnswer({projectId:'A',userId:'u',message:'Vad heter projektet?',lookup:lookup(),hasAccess:async()=>true,callModel:async()=>{calls++;return response('Fixture.')}})
 assert.equal(result.ok,true);assert.equal(calls,1)
})
