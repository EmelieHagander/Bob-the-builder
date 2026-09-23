import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlanAssistant, AUDIT_PLAN_TOOL, COMPILE_PLAN_TOOL, SAVE_COMPILED_PLAN_TOOL } from '../supabase/functions/_shared/plan-assistant.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { PLAN_PROPOSAL_TOOL } from '../supabase/functions/_shared/project-plan.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
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
const makeLookupFor=(data:Record<string,any[]>)=>()=>createProjectLookup('A',async(_project,input)=>({
  data:{records:data[input.dataset]??[],related:[],truncated:false,next_cursor:null},error:null,
}),1000,12)
const makeLookup=makeLookupFor(projectData)

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
  return {success:true,data:structuredClone(data),model,usage,responseId:'resp_'+model}
}

test('compile tool needs only Bob intent; server supplies revision and mini+nano remain read-only',async()=>{
  const calls:OpenAIServiceOptions[]=[]
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async (o:OpenAIServiceOptions)=>{calls.push(o);return o.functionName==='plan-compiler'
      ? response(compiled,'gpt-5.4-mini')
      : response(cleanReview,'gpt-5.4-nano')},
  })
  const result:any=await assistant.consult(COMPILE_PLAN_TOOL.function.name,{
    plan_intent:'First verify the opening, then frame it.'
  })
  assert.equal(result.status,'ok');assert.equal(result.saved,false);assert.equal(result.current_revision,0)
  assert.equal(result.proposal_ready,true);assert.equal(assistant.canSave,true)
  assert.deepEqual(calls.map(c=>c.functionName),['plan-compiler','plan-reviewer'])
  assert.equal(calls[0].module,'living-plan');assert.equal(calls[1].module,'living-plan')
  assert.equal(calls[0].reasoningEffort,'low');assert.equal(calls[1].reasoningEffort,'low')
  const prompt=JSON.parse(String(calls[0].prompt))
  assert.equal(prompt.expected_revision,0);assert.equal(prompt.plan_intent,'First verify the opening, then frame it.')
  assert.equal(calls[0].model,undefined);assert.equal(calls[1].model,undefined,'model choice stays in shared.ai_settings')
  assert.match(calls[0].systemMessage!,/Bob is the project manager/)
  assert.match(calls[1].systemMessage!,/Bob remains the project manager/)
  assert.equal(result.compiled_plan.steps[0].state,'active')
  assert.equal(result.review.ready_to_save,true)
  assert.equal(result.task_candidates[0].task_id,taskId)
  assert.equal(result.task_links_saved,false)
  assert.match(result.note,/NOT saved Step↔Task links/)
  assert(assistant.sources.some(s=>s.recordId===measurementId))
  assert(assistant.sources.some(s=>s.recordId===taskId))
})

test('server derives current approved revision for compile and audit; Bob cannot supply revision plumbing',async()=>{
  const current={...projectData,plan:[{id:'A',name:'Living project plan v7',revision:7,steps:[]}]}
  const makeCurrentLookup=makeLookupFor(current)
  const calls:OpenAIServiceOptions[]=[]
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup:makeCurrentLookup,
    callModel:async (o:OpenAIServiceOptions)=>{
      calls.push(o)
      return o.functionName==='plan-compiler'
        ? response({...compiled,expected_revision:7},'gpt-5.4-mini')
        : response(cleanReview,'gpt-5.4-nano')
    },
  })
  assert.equal((await assistant.consult(COMPILE_PLAN_TOOL.function.name,{
    plan_intent:'Keep the same sequence but make geometry the active desk.',expected_revision:999
  }) as any).status,'invalid','legacy revision plumbing is rejected rather than trusted')
  const audit:any=await assistant.consult(AUDIT_PLAN_TOOL.function.name,{})
  assert.equal(audit.status,'ok');assert.equal(audit.current_revision,7);assert.equal(audit.mode,'audit_plan')
  const compilerPrompt=JSON.parse(String(calls[0].prompt))
  assert.equal(compilerPrompt.expected_revision,7)
  assert.equal(compilerPrompt.plan_intent,null)
  assert.equal(compilerPrompt.mode,'audit_plan')
})

test('local validation cannot be overruled by a cheerful nano review',async()=>{
  const bad={...compiled,task_candidates:[{...compiled.task_candidates[0],task_id:'invented-task'}]}
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async (o:OpenAIServiceOptions)=>o.functionName==='plan-compiler'
      ? response(bad,'gpt-5.4-mini')
      : response(cleanReview,'gpt-5.4-nano'),
  })
  const result:any=await assistant.consult(COMPILE_PLAN_TOOL.function.name,{plan_intent:'Verify opening.'})
  assert.equal(result.review.ready_to_save,false)
  assert.equal(result.proposal_ready,false);assert.equal(assistant.canSave,false)
  assert(result.review.issues.some((i:any)=>i.code==='unknown_task_id'&&i.severity==='error'))
})

test('audit without a current plan stops before model calls',async()=>{
  let modelCalls=0
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async()=>{modelCalls++;return response(cleanReview,'fixture')},
  })
  const result:any=await assistant.consult(AUDIT_PLAN_TOOL.function.name,{})
  assert.equal(result.status,'not_initialized');assert.equal(result.saved,false);assert.equal(modelCalls,0)
})

test('assistant is bounded and simple tool shapes fail closed',async()=>{
  let modelCalls=0
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async (o:OpenAIServiceOptions)=>{modelCalls++;return o.functionName==='plan-compiler'
      ? response(compiled,'gpt-5.4-mini')
      : response(cleanReview,'gpt-5.4-nano')},
  })
  assert.equal((await assistant.consult('consult_plan_assistant',{mode:'compile_plan',expected_revision:0,plan_intent:'A'}) as any).status,'invalid')
  assert.equal((await assistant.consult(COMPILE_PLAN_TOOL.function.name,{plan_intent:'A',mode:'compile_plan'}) as any).status,'invalid')
  assert.equal(modelCalls,0)
  await assistant.consult(COMPILE_PLAN_TOOL.function.name,{plan_intent:'A'})
  assert.equal((await assistant.consult(COMPILE_PLAN_TOOL.function.name,{plan_intent:'B'}) as any).status,'budget_exhausted')
  assert.equal(modelCalls,2)
})

test('tool registry exposes two simple core read-only capabilities and not the legacy multiplexer',async()=>{
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async()=>{throw new Error('model should not run during prepare')},
  })
  const rows=[COMPILE_PLAN_TOOL,AUDIT_PLAN_TOOL].map(spec=>({
    name:spec.function.name,description:spec.function.description,how_to:'Read-only assistant',
    schema_version:1,always_load:true,preload_phases:[],active:true,
  }))
  const session=createBobToolSession({
    lookup:makeLookup(),planAssistant:assistant,readPolicy:async()=>({phase:null,tools:rows}),
  })
  const tools=await session.prepare()
  assert(tools.some(t=>t.function.name===COMPILE_PLAN_TOOL.function.name))
  assert(tools.some(t=>t.function.name===AUDIT_PLAN_TOOL.function.name))
  assert(!tools.some(t=>t.function.name==='consult_plan_assistant'))
  assert.deepEqual(COMPILE_PLAN_TOOL.function.parameters.required,['plan_intent'])
  assert.deepEqual(AUDIT_PLAN_TOOL.function.parameters.properties,{})
  assert.equal(assistant.remaining,2)
})


test('reviewed compilation is saved verbatim through one-field bridge instead of model reserialization',async()=>{
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async (o:OpenAIServiceOptions)=>o.functionName==='plan-compiler'
      ? response(compiled,'gpt-5.4-mini')
      : response(cleanReview,'gpt-5.4-nano'),
  })
  let saved:any=null
  const writer:any={
    get remaining(){return 8},
    write:async(name:string,value:unknown)=>{saved={name,value};return{status:'saved',receipt:{projectId:'A',dataset:'plan',recordId:'A',label:'Plan proposal v1',operation:'created',savedAt:'2026-09-23T00:00:00Z',record:{}}}},
  }
  const rows=[COMPILE_PLAN_TOOL,AUDIT_PLAN_TOOL,SAVE_COMPILED_PLAN_TOOL].map(spec=>({
    name:spec.function.name,description:spec.function.description,how_to:'Fixture',
    schema_version:1,always_load:true,preload_phases:[],active:true,
  }))
  const session=createBobToolSession({
    lookup:makeLookup(),writer,planAssistant:assistant,readPolicy:async()=>({phase:null,tools:rows}),
  })
  let tools=await session.prepare()
  assert(!tools.some(t=>t.function.name===SAVE_COMPILED_PLAN_TOOL.function.name),'save stays hidden until a clean current-turn compilation exists')
  const result:any=await assistant.consult(COMPILE_PLAN_TOOL.function.name,{plan_intent:'Verify opening, then frame.'})
  assert.equal(result.proposal_ready,true)
  const expected=assistant.compiledProposal
  tools=await session.prepare()
  assert(tools.some(t=>t.function.name===SAVE_COMPILED_PLAN_TOOL.function.name))
  const savedResult:any=await session.execute(SAVE_COMPILED_PLAN_TOOL.function.name,{request_quote:'rätta till planen'})
  assert.equal(savedResult.status,'saved')
  assert.equal(saved.name,'propose_project_plan')
  assert.deepEqual(saved.value,{...expected,request_quote:'rätta till planen'})
  assert.equal(Object.keys(saved.value).length,5,'bridge supplies the exact write schema without model-copying nested JSON')
})

test('compiled save bridge remains unavailable after reviewer blocks the proposal',async()=>{
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async (o:OpenAIServiceOptions)=>o.functionName==='plan-compiler'
      ? response(compiled,'gpt-5.4-mini')
      : response({ready_to_save:false,summary:'Fix evidence first',issues:[{
        severity:'error',code:'evidence_mismatch',step_position:1,requirement_position:1,evidence_id:measurementId,
        message:'Wrong evidence',suggestion:'Use the matching measurement',
      }]},'gpt-5.4-nano'),
  })
  await assistant.consult(COMPILE_PLAN_TOOL.function.name,{plan_intent:'Verify opening.'})
  assert.equal(assistant.canSave,false);assert.equal(assistant.compiledProposal,null)
  const rows=[COMPILE_PLAN_TOOL,AUDIT_PLAN_TOOL,SAVE_COMPILED_PLAN_TOOL].map(spec=>({
    name:spec.function.name,description:spec.function.description,how_to:'Fixture',
    schema_version:1,always_load:true,preload_phases:[],active:true,
  }))
  const session=createBobToolSession({
    lookup:makeLookup(),writer:{remaining:8,write:async()=>{throw new Error('must not save')}} as any,
    planAssistant:assistant,readPolicy:async()=>({phase:null,tools:rows}),
  })
  const tools=await session.prepare()
  assert(!tools.some(t=>t.function.name===SAVE_COMPILED_PLAN_TOOL.function.name))
})

const blockedReview={ready_to_save:false,summary:'Width cannot prove height.',issues:[{
  severity:'error',code:'evidence_mismatch',step_position:1,requirement_position:1,evidence_id:measurementId,
  message:'Width cannot prove height.',suggestion:'Keep the height criterion open without unrelated evidence.',
}]}

test('a blocked compilation is repaired with exact review feedback and saved using the current continuation quote',async()=>{
  const bad=structuredClone(compiled)
  bad.steps[0].requirements[0].title='Opening height known'
  bad.steps[0].requirements[0].description='The opening height is measured.'
  const repaired=structuredClone(bad)
  repaired.steps[0].requirements[0].evidence_selector={kind:'none',id:null,subject:null,area_id:null} as any
  const calls:OpenAIServiceOptions[]=[]
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,deadline:Date.now()+215000,
    callModel:async o=>{
      calls.push(o)
      if(calls.length===1) return response(bad,'mini')
      if(calls.length===2) return response(blockedReview,'nano')
      if(calls.length===3){
        const input=JSON.parse(String(o.prompt))
        assert.deepEqual(input.repair_feedback,{compiled_plan:bad,review:blockedReview})
        assert.equal(input.plan_intent,'Verify the opening before framing.')
        assert.deepEqual(input.project_snapshot.measurements,projectData.measurements)
        return response(repaired,'mini')
      }
      assert.deepEqual(JSON.parse(String(o.prompt)).compiled_plan,repaired)
      return response(cleanReview,'nano')
    },
  })
  const followup='Okej, kör vidare :)'
  let stored:any=null
  const writer=createProjectWriter('A',followup,async payload=>{
    stored=payload
    return {data:{projectId:'A',dataset:'plan',recordId:'A',revision:1,label:'Plan proposal v1',operation:'created',
      savedAt:'2026-09-23T00:00:00Z',record:{id:'A',revision:1}},error:null}
  },async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}))
  const rows=[COMPILE_PLAN_TOOL,SAVE_COMPILED_PLAN_TOOL,PLAN_PROPOSAL_TOOL].map(spec=>({
    name:spec.function.name,description:spec.function.description,how_to:'Fixture',schema_version:1,always_load:true,preload_phases:[],active:true,
  }))
  const session=createBobToolSession({lookup:makeLookup(),writer,planAssistant:assistant,readPolicy:async()=>({phase:null,tools:rows})})
  await session.prepare()
  const result:any=await session.execute('compile_project_plan',{plan_intent:'Verify the opening before framing.'})
  assert.equal(result.attempts,2);assert.equal(result.proposal_ready,true)
  assert.equal(assistant.remaining,0)
  assert.deepEqual(calls.map(o=>o.functionName),['plan-compiler','plan-reviewer','plan-compiler','plan-reviewer'])
  assert.equal(stored,null,'compilation and repair remain read-only')
  const tools=await session.prepare()
  assert(tools.some(t=>t.function.name==='save_compiled_project_plan'))
  assert(!tools.some(t=>t.function.name==='propose_project_plan'),'compiled proposals cannot switch to manual reconstruction')
  assert.equal((await session.execute('save_compiled_project_plan',{request_quote:'Jag godkänner att du sparar förslaget'})).status,'invalid',
    'an older approval is still not a current-turn audit quote')
  assert.equal(stored,null)
  assert.equal((await session.execute('save_compiled_project_plan',{request_quote:followup})).status,'saved')
  assert.equal(stored.kind,'plan_proposal','continuation does not approve the proposal')
  assert.equal(stored.request_quote,followup)
  assert.deepEqual(stored.data.steps,repaired.steps,'save exactly the repaired and reviewed plan')
})

test('a second failed review stops repair and cannot be bypassed with the manual proposal tool',async()=>{
  let calls=0
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,deadline:Date.now()+215000,
    callModel:async o=>{calls++;return o.functionName==='plan-compiler'?response(compiled,'mini'):response(blockedReview,'nano')},
  })
  const rows=[COMPILE_PLAN_TOOL,SAVE_COMPILED_PLAN_TOOL,PLAN_PROPOSAL_TOOL].map(spec=>({
    name:spec.function.name,description:spec.function.description,how_to:'Fixture',schema_version:1,always_load:true,preload_phases:[],active:true,
  }))
  const session=createBobToolSession({lookup:makeLookup(),planAssistant:assistant,
    writer:{remaining:8,write:async()=>{throw new Error('must not write')}} as any,readPolicy:async()=>({phase:null,tools:rows})})
  await session.prepare()
  const result:any=await session.execute('compile_project_plan',{plan_intent:'Verify opening.'})
  assert.equal(calls,4);assert.equal(result.attempts,2);assert.equal(result.proposal_ready,false)
  assert.equal(assistant.canSave,false);assert.equal(assistant.remaining,0)
  assert.match(result.note,/NOT a missing user permission/)
  // Recheck even an old offered packet, before prepare removes the manual tool.
  assert.equal((await session.execute('propose_project_plan',compiled)).status,'missing_context')
  assert.equal((await session.execute('load_tool',{name:'propose_project_plan'})).status,'missing_context')
  await session.prepare()
  assert.equal((await session.execute('save_compiled_project_plan',{request_quote:'continue'})).status,'missing_context')
})

test('repair reserves the remaining turn budget and does not retry a failed reviewer service',async()=>{
  for(const scenario of ['short_deadline','reviewer_unavailable'] as const){
    let calls=0
    const assistant=createPlanAssistant({
      projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
      deadline:Date.now()+(scenario==='short_deadline'?90000:215000),
      callModel:async o=>{calls++;return o.functionName==='plan-compiler'?response(compiled,'mini')
        :scenario==='short_deadline'?response(blockedReview,'nano'):{success:false,data:null,model:'nano',usage}},
    })
    const result:any=await assistant.consult('compile_project_plan',{plan_intent:'Verify opening.'})
    assert.equal(calls,2);assert.equal(result.attempts,1);assert.equal(assistant.canSave,false)
  }
})

test('access revocation between review and repair stops before a second compilation',async()=>{
  let access=true,calls=0
  const assistant=createPlanAssistant({
    projectId:'A',userId:'user-a',hasAccess:async()=>access,makeLookup,deadline:Date.now()+215000,
    callModel:async o=>{calls++;if(o.functionName==='plan-compiler')return response(compiled,'mini')
      access=false;return response(blockedReview,'nano')},
  })
  const result:any=await assistant.consult('compile_project_plan',{plan_intent:'Verify opening.'})
  assert.equal(result.status,'denied');assert.equal(calls,2);assert.equal(assistant.canSave,false)
})

test('reviewer receives the canonical identity contract and new null identities pass server validation',async()=>{
  const proposal=structuredClone(compiled)
  proposal.steps[0].requirements.push(structuredClone(proposal.steps[0].requirements[0]))
  proposal.steps[0].requirements[1].title='Opening height known'
  proposal.steps[0].requirements[1].description='Height still needs measurement.'
  proposal.steps[0].requirements[1].evidence_selector={kind:'none',id:null,subject:null,area_id:null} as any
  const assistant=createPlanAssistant({projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
    callModel:async o=>{
      if(o.functionName==='plan-compiler') return response(proposal,'mini')
      const input=JSON.parse(String(o.prompt))
      assert.deepEqual(input.proposal_steps_schema,PLAN_PROPOSAL_TOOL.function.parameters.properties.steps)
      assert.equal(input.server_validation.proposal_shape_valid,true)
      assert.equal(input.server_validation.new_identity_value,null)
      assert.deepEqual(input.local_validation_issues,[],'two new null ids are not missing or duplicated ids')
      assert.match(o.systemMessage!,/Null is valid and is not a missing\/invalid id/)
      assert.equal(input.compiled_plan.steps[0].requirements[1].evidence_selector.kind,'none')
      return response(cleanReview,'nano')
    },
  })
  const result:any=await assistant.consult('compile_project_plan',{plan_intent:'Verify opening.'})
  assert.equal(result.proposal_ready,true);assert.equal(result.attempts,1)
})

test('malformed requirement identities identify the exact row and cannot pass a positive model review',async()=>{
  for(const id of ['',undefined,'not-a-uuid']){
    const proposal=structuredClone(compiled)
    ;(proposal.steps[0].requirements[0] as any).requirement_id=id
    const assistant=createPlanAssistant({projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,
      callModel:async o=>o.functionName==='plan-compiler'?response(proposal,'mini'):response(cleanReview,'nano')})
    const result:any=await assistant.consult('compile_project_plan',{plan_intent:'Verify opening.'})
    const issue=result.review.issues.find((i:any)=>i.code==='invalid_requirement_id')
    assert.equal(issue.step_position,1);assert.equal(issue.requirement_position,1)
    assert.equal(result.proposal_ready,false)
  }
})

test('existing requirement identities preserve their parent and occur only once, including during repair',async()=>{
  const stepId='40000000-0000-4000-8000-000000000001'
  const requirementId='50000000-0000-4000-8000-000000000001'
  const data={...projectData,plan:[{id:'A',revision:1,steps:[{id:stepId,state:'active',requirements:[{id:requirementId}]}]}]}
  for(const scenario of ['valid','wrong_parent','duplicate'] as const){
    const proposal=structuredClone(compiled) as any
    proposal.expected_revision=1
    proposal.steps[0].step_id=scenario==='wrong_parent'?null:stepId
    proposal.steps[0].requirements[0].requirement_id=requirementId
    if(scenario==='duplicate')proposal.steps[0].requirements.push(structuredClone(proposal.steps[0].requirements[0]))
    const assistant=createPlanAssistant({projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup:makeLookupFor(data),
      callModel:async o=>o.functionName==='plan-compiler'?response(proposal,'mini'):response(cleanReview,'nano')})
    const result:any=await assistant.consult('compile_project_plan',{plan_intent:'Refine current step.'})
    assert.equal(result.proposal_ready,scenario==='valid')
    if(scenario!=='valid')assert(result.review.issues.some((i:any)=>i.code===(scenario==='wrong_parent'?'requirement_parent_mismatch':'duplicate_requirement_id')))
  }
})

test('exhausted repair reports its limit and logs only structural diagnostics',async t=>{
  const logs:unknown[][]=[]
  t.mock.method(console,'log',(...args:unknown[])=>logs.push(args))
  const privateText='PRIVATE_PROJECT_AND_REVIEW_TEXT'
  const proposal={...compiled,summary:privateText}
  const review={...blockedReview,summary:privateText,issues:[{...blockedReview.issues[0],code:privateText,message:privateText}]}
  const assistant=createPlanAssistant({projectId:'A',userId:'user-a',hasAccess:async()=>true,makeLookup,deadline:Date.now()+215000,
    callModel:async o=>o.functionName==='plan-compiler'?response(proposal,'mini'):response(review,'nano')})
  const result:any=await assistant.consult('compile_project_plan',{plan_intent:privateText})
  assert.equal(result.remaining_attempts,0);assert.equal(result.attempts,2)
  assert.match(result.note,/automatic repair budget is exhausted/)
  const diagnostics=logs.filter(args=>args[0]==='[Bob plan review]').map(args=>JSON.parse(String(args[1])))
  assert.equal(diagnostics.length,2)
  assert.deepEqual(diagnostics.map(d=>d.attempt),[1,2])
  assert(diagnostics.every(d=>d.shape_valid===true&&d.review_error_count===1))
  assert(diagnostics.every(d=>d.review_issues[0].code==='unclassified'))
  assert(diagnostics.every(d=>d.review_issues[0].step_position===1&&d.review_issues[0].requirement_position===1))
  assert(!JSON.stringify(logs).includes(privateText));assert(!JSON.stringify(logs).includes(measurementId))
})
