import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlanAssistant, PLAN_ASSISTANT_TOOL } from '../supabase/functions/_shared/plan-assistant.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from '../supabase/functions/_shared/openai-service.ts'

const usage={input_tokens:10,output_tokens:5,total_tokens:15}
const measurementId='30000000-0000-4000-8000-000000000001'
const taskId='task-a'
const projectData:Record<string,any[]>={
  project:[{id:'A',name:'Porch',description:'Enclose porch',phase:null}],
  areas:[{id:'areaA',name:'Front',phase:'planning'}],
  tasks:[{id:taskId,name:'Control measure opening',status:'todo',area_id:'areaA',instructions:'Measure before cutting'}],
  measurements:[{id:measurementId,subject:'Opening width',value:'910',unit:'mm',truth:'measured',area_id:'areaA',revision:2}],
  components:[],solutions:[],target:[],artifacts:[],requirements:[],plan:[],
}
const makeLookup=()=>createProjectLookup('A',async(_project,input)=>({
  data:{records:projectData[input.dataset]??[],related:[],truncated:false,next_cursor:null},error:null,
}),1000,12)

const compiled={
  expected_revision:0,
  summary:'Verify opening, then frame',
  reason:'Initial plan grounded in known measurements',
  steps:[{
    step_id:null,title:'Verify opening',goal:'Know the opening before cutting',state:'active',area_id:'areaA',
    responsible_kind:'bob',responsible_person_id:null,
    notes:'Confirm the controlling opening dimensions and do not cut from conflicted values.',
    requirements:[{
      requirement_id:null,type:'measurement',title:'Opening width known',description:'The current opening width is measured.',
      resolution:'open',responsible_kind:'bob',responsible_person_id:null,
      evidence_selector:{kind:'measurement',id:measurementId,subject:null,area_id:null},
    }],
  }],
  task_candidates:[{step_position:1,task_id:taskId,task_name:'Control measure opening',reason:'Operational action for the active measurement Step.'}],
  observations:['Existing measured width can satisfy the atomic width criterion.'],
}
const cleanReview={ready_to_save:true,summary:'Compilation is semantically grounded.',issues:[]}

function response<T>(data:T,model:string):OpenAIServiceResponse<T>{
  return {success:true,data,model,usage,responseId:'resp_'+model}
}

test('mini compiles and nano reviews while Bob retains the write decision',async()=>{
  const calls:OpenAIServiceOptions[]=[]
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async (o:OpenAIServiceOptions)=>{calls.push(o);return o.functionName==='plan-compiler'
      ? response(compiled,'gpt-5.4-mini')
      : response(cleanReview,'gpt-5.4-nano')},
  })
  const result:any=await assistant.consult(PLAN_ASSISTANT_TOOL.function.name,{
    mode:'compile_plan',expected_revision:0,plan_intent:'First verify the opening, then frame it.'
  })
  assert.equal(result.status,'ok');assert.equal(result.saved,false)
  assert.deepEqual(calls.map(c=>c.functionName),['plan-compiler','plan-reviewer'])
  assert.equal(calls[0].module,'living-plan');assert.equal(calls[1].module,'living-plan')
  assert.equal(calls[0].reasoningEffort,'low');assert.equal(calls[1].reasoningEffort,'low','nano fallback uses a supported GPT-5.4 reasoning effort')
  assert.equal(calls[0].model,undefined);assert.equal(calls[1].model,undefined,'model choice stays in shared.ai_settings')
  assert.match(calls[0].systemMessage!,/Bob is the project manager/)
  assert.match(calls[1].systemMessage!,/Bob remains the project manager/)
  assert.equal(result.compiled_plan.steps[0].state,'active')
  assert.equal(result.review.ready_to_save,true)
  assert.equal(result.task_candidates[0].task_id,taskId)
  assert(result.note.includes('Bob owns the plan decision'))
  assert(assistant.sources.some(s=>s.recordId===measurementId))
  assert(assistant.sources.some(s=>s.recordId===taskId))
})

test('local validation cannot be overruled by a cheerful nano review',async()=>{
  const bad={...compiled,task_candidates:[{...compiled.task_candidates[0],task_id:'invented-task'}]}
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async (o:OpenAIServiceOptions)=>o.functionName==='plan-compiler'
      ? response(bad,'gpt-5.4-mini')
      : response(cleanReview,'gpt-5.4-nano'),
  })
  const result:any=await assistant.consult(PLAN_ASSISTANT_TOOL.function.name,{
    mode:'compile_plan',expected_revision:0,plan_intent:'Verify opening.'
  })
  assert.equal(result.review.ready_to_save,false)
  assert(result.review.issues.some((i:any)=>i.code==='unknown_task_id'&&i.severity==='error'))
})

test('assistant is bounded, read-only and mode inputs fail closed',async()=>{
  let modelCalls=0
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async (o:OpenAIServiceOptions)=>{modelCalls++;return o.functionName==='plan-compiler'
      ? response(compiled,'gpt-5.4-mini')
      : response(cleanReview,'gpt-5.4-nano')},
  })
  assert.equal((await assistant.consult('invented_tool',{} as any) as any).status,'invalid')
  assert.equal((await assistant.consult(PLAN_ASSISTANT_TOOL.function.name,{mode:'compile_plan',expected_revision:0,plan_intent:null}) as any).status,'invalid')
  assert.equal(modelCalls,0)
  await assistant.consult(PLAN_ASSISTANT_TOOL.function.name,{mode:'compile_plan',expected_revision:0,plan_intent:'A'})
  assert.equal((await assistant.consult(PLAN_ASSISTANT_TOOL.function.name,{mode:'compile_plan',expected_revision:0,plan_intent:'B'}) as any).status,'budget_exhausted',
    'Malformed attempts consume the bounded assistant budget just like other Bob tools')
  assert.equal((await assistant.consult(PLAN_ASSISTANT_TOOL.function.name,{mode:'compile_plan',expected_revision:0,plan_intent:'C'}) as any).status,'budget_exhausted')
  assert.equal(modelCalls,2)
})


test('tool registry can expose the assistant as a core read-only capability',async()=>{
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async()=>{throw new Error('model should not run during prepare')},
  })
  const session=createBobToolSession({
    lookup:makeLookup(),planAssistant:assistant,
    readPolicy:async()=>({phase:null,tools:[{
      name:PLAN_ASSISTANT_TOOL.function.name,description:'Plan assistant',how_to:'Read-only assistant',
      schema_version:1,always_load:true,preload_phases:[],active:true,
    }]}),
  })
  const tools=await session.prepare()
  assert(tools.some(t=>t.function.name===PLAN_ASSISTANT_TOOL.function.name))
  assert.equal(assistant.remaining,2)
})
