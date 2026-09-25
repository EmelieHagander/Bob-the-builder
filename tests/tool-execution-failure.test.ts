import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolSession } from '../supabase/functions/_shared/project-tools/session.ts'
import { runProjectAnswer } from './support/bob-model-routing.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'

test('unexpected handler errors stop the turn, are redacted and remain distinct from catalog failures',async()=>{
  const session=createToolSession({definitions:[{version:1,spec:{type:'function',function:{name:'read_test',description:'Read',parameters:{}}},gate:()=> 'available',execute:async()=>{throw new Error('PRIVATE_DIAGNOSTIC')}}],
    readPolicy:async()=>({phase:null,tools:[{name:'read_test',description:'Read',how_to:'',schema_version:1,always_load:true,preload_phases:[],active:true}]})})
  await session.prepare()
  await assert.rejects(session.execute('read_test',{}),/^Error: tool_execution_unavailable$/)
  assert(session.partial);assert.doesNotMatch(JSON.stringify(session.events),/PRIVATE_DIAGNOSTIC/)

  const lookup=createProjectLookup('A',async()=>({data:{records:[{id:'A'}],related:[],truncated:false},error:null}))
  const original=lookup.search;let reads=0,calls=0
  lookup.search=async v=>{if(++reads===1)return original(v);throw new Error('PRIVATE_DIAGNOSTIC')}
  const result=await runProjectAnswer({projectId:'A',userId:'user',message:'Read the task',lookup,hasAccess:async()=>true,callModel:async()=>{
    calls++;return{success:true,data:null,model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2},responseId:'resp_one',toolCalls:[{id:'call_one',type:'function',function:{name:'search_project_data',arguments:JSON.stringify({dataset:'tasks',query:null,status:null,area_id:null,record_id:null})}}]}
  }})
  assert.deepEqual(result,{ok:false,error:'tool_execution_unavailable'});assert.equal(calls,1)
})
