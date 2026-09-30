import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBobHandler } from '../supabase/functions/_shared/bob-request.ts'
import { runProjectAnswer, runClaimedProjectTurn } from './support/bob-model-routing.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { isBobAnswerEvidence } from '../src/data/bobEvidence.ts'
import type { CurrentView } from '../src/domain/bobScreen.ts'
import { hydrateCurrentView, type CurrentViewReader } from '../supabase/functions/_shared/current-view.ts'

const view: CurrentView = { status:'ok',projectId:'A',surface:'task',project:{id:'A',name:'Build'},
  focus:{task:{id:'taskA',name:'Original task',status:'todo',instructions:'Inspect'}},sources:[],warnings:[],retrievedAt:'2026-09-30T12:00:00Z' }
const lookup = () => createProjectLookup('A',async()=>({data:{records:[{id:'A',name:'Build'}],related:[],truncated:false},error:null}))
const model = {success:true,model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
const request = (screen?:unknown) => new Request('https://fixture.test',{method:'POST',headers:{Authorization:'Bearer test'},
  body:JSON.stringify({action:'send',projectId:'A',message:'What is next here?',background:true,...(screen===undefined?{}:{screen})})})

test('HTTP freezes only strict navigation identifiers for synchronous and queued work; old callers remain compatible',async()=>{
  const captured:unknown[]=[]
  const handler=createBobHandler({authenticate:async()=> 'user',answer:async()=>({ok:false,error:'unused'}),enqueue:async input=>{
    captured.push(input.screen);return {ok:true,status:'accepted',projectId:'A',jobId:'job',expiresAt:'2026-09-30T12:10:00Z'}
  }})
  assert.equal((await handler(request({surface:'drawings',artifactId:'abc',artifactRevision:1}))).status,202)
  assert.deepEqual(captured[0],{surface:'drawings',artifactId:'abc',artifactRevision:1})
  assert.equal((await handler(request())).status,202);assert.equal(captured[1],null)
  for(const screen of [{surface:'task',taskId:'taskA',name:'Forged truth'},{surface:'task',taskId:'taskA',viewerName:'Other'},
    {surface:'drawings',artifactId:'abc'},{surface:'solutions',solutionRevision:2},{surface:'project',taskId:'taskA'},
    {surface:'task',taskId:'foreign\nlabel'}])assert.equal((await handler(request(screen))).status,400)
  assert.equal(captured.length,2,'malformed descriptors never enqueue')
})

test('the actual model receives caller-hydrated focus and honest unresolved states with no browser facts',async()=>{
  for(const currentView of [view,{...view,status:'not_found' as const,project:undefined,focus:{},sources:[]}]){
    let calls=0
    const result=await runProjectAnswer({projectId:'A',userId:'user',message:'What is next?',lookup:lookup(),hasAccess:async()=>true,currentView,
      validateCurrentView:async()=>true,callModel:async options=>{calls++;const text=JSON.stringify(options.messages)
        assert(text.includes('Current View'));assert(text.includes(currentView.status));assert.equal(text.includes('Original task'),currentView.status==='ok')
        return {...model,responseId:'resp',data:'Read the current work.'}
      }})
    assert(result.ok);assert.deepEqual(result.evidence.currentView,currentView);assert.equal(calls,1)
  }
})

test('focus changes before dispatch and during model thinking prevent model spending or tool writes respectively',async()=>{
  let calls=0,valid=false,writes=0
  const writer=createProjectWriter('A','Update task',async()=>{writes++;return {data:null,error:null}},async()=>({data:[],error:null}),async()=>({data:{generation:1,receipts:[]},error:null}))
  const run=()=>runProjectAnswer({projectId:'A',userId:'user',message:'Update task',lookup:lookup(),hasAccess:async()=>true,writer,currentView:view,
    validateCurrentView:async()=>valid,callModel:async()=>{calls++;valid=false;return {...model,responseId:'resp',data:'',toolCalls:[{
      id:'write',type:'function',function:{name:'save_project_task',arguments:JSON.stringify({record_id:'taskA',area_id:null,name:'Changed',instructions:'Build',expected_updated_at:null,request_quote:'Update task'})}
    }]}}})
  assert.deepEqual(await run(),{ok:false,error:'context_unavailable'});assert.equal(calls,0)
  valid=true;assert.deepEqual(await run(),{ok:false,error:'context_unavailable'});assert.equal(calls,1);assert.equal(writes,0)
})

test('focus mutation between calls in the same model batch blocks subsequent writes',async()=>{
  const message='Create two follow-up tasks'
  let valid=true,writes=0,calls=0
  const writer=createProjectWriter('A',message,async()=>{
    writes++
    // A concurrent edit lands while the first tool awaits its guarded write.
    // Its receipt proves only the newly created record, never the viewed Task.
    valid=false
    return {data:{projectId:'A',dataset:'tasks',recordId:'first-follow-up',label:'First follow-up',operation:'created',
      savedAt:'2026-09-30T12:00:01Z',record:{id:'first-follow-up',project_id:'A',name:'First follow-up'}},error:null}
  },async()=>({data:[],error:null}))
  const result=await runProjectAnswer({projectId:'A',userId:'user',message,lookup:lookup(),hasAccess:async()=>true,writer,currentView:view,
    validateCurrentView:async()=>valid,callModel:async()=>{
      calls++
      return {...model,responseId:'batch',data:'',toolCalls:[1,2].map(index=>({
        id:'follow-up-'+index,type:'function' as const,function:{name:'save_project_task',arguments:JSON.stringify({
          record_id:null,area_id:'areaA',name:'Follow-up '+index,instructions:'Inspect',expected_updated_at:null,request_quote:message,
        })},
      }))}
    }})
  assert.deepEqual(result,{ok:false,error:'context_unavailable'})
  assert.equal(calls,1)
  assert.equal(writes,1,'the second call must stop before reaching the write transport')
})

test('settlement focus invalidation retains committed receipts but clears private focus and stale provider cursor',async()=>{
  let valid=true,committed:any
  const receipt={projectId:'A',dataset:'tasks',recordId:'taskA',label:'Saved task',operation:'updated',savedAt:'2026-09-30T12:00:00Z',record:{id:'taskA',project_id:'A',name:'Saved task',instructions:'Inspect',status:'todo',updated_at:'2026-09-30T12:00:00Z'}}
  const writer=createProjectWriter('A','Update',async()=>({data:null,error:null}),async()=>({data:[receipt],error:null}),async()=>{
    valid=false;return {data:{generation:3,receipts:[receipt]},error:null}
  })
  const result=await runClaimedProjectTurn({projectId:'A',userId:'user',message:'Update',lookup:lookup(),hasAccess:async()=>true,writer,resume:true,generation:2,
    currentView:view,validateCurrentView:async()=>valid,callModel:async()=>({...model,responseId:'old-response',data:'Original task is current'}),
    commit:async r=>{committed=r},fail:async()=>assert.fail('committed changes are retained')})
  assert(result.ok);assert.equal(result.providerResponseId,undefined);assert.equal(committed.providerResponseId,undefined)
  assert.equal(result.evidence.currentView?.status,'unavailable');assert.deepEqual(result.evidence.currentView?.focus,{})
  assert.equal(result.evidence.writes?.length,1);assert.equal(result.evidence.partial,true)
})

test('client evidence validation rejects foreign/malformed focus and preserves legacy answers',()=>{
  const evidence={kind:'ai_assessment',sources:[],partial:false,currentView:view}
  assert(isBobAnswerEvidence(evidence,'A'));assert(isBobAnswerEvidence({...evidence,currentView:undefined},'A'))
  assert(!isBobAnswerEvidence({...evidence,currentView:{...view,projectId:'B'}},'A'))
  assert(!isBobAnswerEvidence({...evidence,currentView:{...view,status:'unavailable'}},'A'))
  assert(!isBobAnswerEvidence({...evidence,currentView:{...view,focus:{task:{...view.focus.task,secret:'hidden'}}}},'A'))
})

test('real caller-hydrated Task/Step assignments reach client evidence without admitting profiles or malformed responsibility',async()=>{
  const row=(id:string,extra:Record<string,unknown>={})=>({id,project_id:'A',name:id,...extra})
  const reader:CurrentViewReader={
    project:async()=>({id:'A',name:'Build'}),viewer:async()=>null,area:async()=>null,
    task:async()=>row('taskA',{area_id:null,primary_step_id:'stepA',status:'todo',instructions:'Inspect'}),
    assignees:async()=>({rows:[row('personA',{task_id:'taskA',email:'PRIVATE',diet:'PRIVATE'})],truncated:false}),
    person:async()=>row('personA',{email:'PRIVATE',diet:'PRIVATE'}),
    planStep:async()=>row('stepA',{area_id:null,plan_revision:1,state:'active',goal:'Inspect',notes:'',responsible_kind:'person',responsible_person_id:'personA'}),
    instruction:async()=>null,solution:async()=>null,drawing:async()=>null,event:async()=>null,
  }
  const currentView=await hydrateCurrentView({projectId:'A',screen:{surface:'task',taskId:'taskA'},reader})
  const evidence={kind:'ai_assessment',sources:[],partial:false,currentView}
  assert.equal(currentView.status,'ok')
  assert.deepEqual(currentView.focus.task?.assignees,[{id:'personA',name:'personA'}])
  assert.deepEqual(currentView.focus.planStep?.responsible,{kind:'person',person:{id:'personA',name:'personA'}})
  assert.doesNotMatch(JSON.stringify(currentView),/PRIVATE|email|diet/)
  assert(isBobAnswerEvidence(evidence,'A'),'the actual server projection must pass the client boundary')
  for(const responsible of [{kind:'bob'},{kind:'unassigned'}]){
    assert(isBobAnswerEvidence({...evidence,currentView:{...currentView,focus:{...currentView.focus,
      planStep:{...currentView.focus.planStep,responsible},task:{...currentView.focus.task,assignees:[]}}}},'A'))
  }
  const replace=(key:'task'|'planStep',patch:Record<string,unknown>)=>({...evidence,currentView:{...currentView,
    focus:{...currentView.focus,[key]:{...currentView.focus[key],...patch}}}})
  for(const assignees of [null,{},Array(9).fill({id:'personA',name:'A'}),[{id:'x y',name:'A'}],[{id:'personA',name:'A',email:'PRIVATE'}],
    [{id:'personA',name:'A',project_id:'B'}],[{id:'personA',name:'A'.repeat(241)}]]){
    assert(!isBobAnswerEvidence(replace('task',{assignees}),'A'))
  }
  for(const responsible of [null,[],{kind:'person'},{kind:'person',person:{id:'x y',name:'A'}},
    {kind:'person',person:{id:'personA',name:'A',diet:'PRIVATE'}},{kind:'bob',person:{id:'personA',name:'A'}},
    {kind:'unassigned',person:null},{kind:'admin'},{kind:'person',person:{id:'personA',name:'A'},email:'PRIVATE'}]){
    assert(!isBobAnswerEvidence(replace('planStep',{responsible}),'A'))
  }
  assert(!isBobAnswerEvidence(evidence,'B'),'canonical assignments do not relax the project boundary')
})
