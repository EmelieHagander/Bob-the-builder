import test from 'node:test'
import assert from 'node:assert/strict'
import type { CurrentView } from '../src/domain/bobScreen.ts'
import type { WriteReadback } from '../supabase/functions/_shared/project-write.ts'
import { createCurrentViewGuard } from '../supabase/functions/_shared/current-view-guard.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { runProjectAnswer } from './support/main-catalog-fixture.ts'

const t1 = '2026-09-30T12:00:00Z', t2 = '2026-09-30T12:00:01Z', t3 = '2026-09-30T12:00:02Z'
const step = '10000000-0000-4000-8000-000000000001'
function fixture() {
  const source = (dataset: string, recordId: string, label: string, updatedAt: string | null = t1) => ({projectId:'A',dataset,recordId,label,updatedAt,truth:'unknown' as const,retrievedAt:t1})
  const initial: CurrentView = {status:'ok',projectId:'A',surface:'task',project:{id:'A',name:'Project'},viewer:{id:'p',name:'Caller'},
    focus:{area:{id:'a',name:'Area'},task:{id:'t',name:'Task',status:'todo',instructions:'Before'},
      planStep:{id:step,name:'Step',state:'ready',planRevision:1,goal:'Build',notes:''}},
    sources:[source('project','A','Project'),source('crew','p','Caller'),source('areas','a','Area'),source('tasks','t','Task'),source('plan',step,'Step',null)],warnings:[],retrievedAt:t1}
  let current = structuredClone(initial), allowed = true
  const receipts: WriteReadback[] = []
  const guard = createCurrentViewGuard({initial,read:async()=>structuredClone(current),hasAccess:async()=>allowed,receipts:()=>receipts})
  const update = (dataset: string, label: string, timestamp = t2) => {
    const source = current.sources.find(s=>s.dataset===dataset)!
    source.label=label;source.updatedAt=timestamp;source.retrievedAt=timestamp
  }
  const taskReceipt = (timestamp = t2): WriteReadback => ({projectId:'A',dataset:'tasks',recordId:'t',label:'Task saved',operation:'updated',savedAt:timestamp,
    record:{id:'t',project_id:'A',area_id:'a',primary_step_id:step,name:'Updated task',status:'doing',instructions:'After',updated_at:timestamp}})
  const saveTask = (timestamp = t2) => {
    current.focus.task={...current.focus.task!,id:'t',name:'Updated task',status:'doing',instructions:'After'};update('tasks','Updated task',timestamp)
    receipts.push(taskReceipt(timestamp))
  }
  return {initial,guard,receipts,update,saveTask,taskReceipt,get current(){return current},set current(v:CurrentView){current=v},revoke(){allowed=false}}
}

test('exact own task readbacks advance release evidence while entry and journal inputs stay frozen',async()=>{
  const f=fixture();assert(await f.guard.validate());f.saveTask();assert(await f.guard.validate())
  assert.equal(f.guard.evidence().focus.task?.instructions,'After');assert.equal(f.initial.focus.task?.instructions,'Before')
  const copy=f.guard.evidence();copy.focus.task!.instructions='Caller cannot mutate guard';assert.equal(f.guard.evidence().focus.task?.instructions,'After')
  f.current.retrievedAt=t3;f.current.sources.forEach(s=>{s.retrievedAt=t3})
  f.current=JSON.parse(JSON.stringify(f.current,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort()):value))
  assert(await f.guard.validate(),'JSONB key order and retrieval times do not become changes')
  f.saveTask(t3);assert(await f.guard.validate(),'latest receipt per record is authoritative')
  const replay=createCurrentViewGuard({initial:f.initial,read:async()=>f.current,hasAccess:async()=>true,receipts:()=>f.receipts})
  assert(await replay.validate(),'recovered own receipts explain the same frozen entry after a worker restart')
})

test('external concurrent edits, unmatched values, incomplete/foreign receipts and scope changes remain blocked',async()=>{
  for(const mutation of [
    (f:ReturnType<typeof fixture>)=>{f.current.sources.find(s=>s.dataset==='tasks')!.updatedAt=t3},
    (f:ReturnType<typeof fixture>)=>{f.current.focus.task!.instructions='External edit'},
    (f:ReturnType<typeof fixture>)=>{delete f.receipts[0].record.updated_at},
    (f:ReturnType<typeof fixture>)=>{f.receipts[0].projectId='B'},
    (f:ReturnType<typeof fixture>)=>{f.receipts[0].record.project_id='B'},
    (f:ReturnType<typeof fixture>)=>{f.receipts[0].record.area_id='other'},
    (f:ReturnType<typeof fixture>)=>{f.receipts[0].record.primary_step_id='other'},
    (f:ReturnType<typeof fixture>)=>{f.current.focus.area!.id='other'},
    (f:ReturnType<typeof fixture>)=>{f.current.viewer!.name='Different caller record'},
    (f:ReturnType<typeof fixture>)=>{f.current.project!.name='External project edit'},
    (f:ReturnType<typeof fixture>)=>{f.current.sources.find(s=>s.dataset==='areas')!.updatedAt=t3},
    (f:ReturnType<typeof fixture>)=>{f.current.warnings.push('area_archived')},
    (f:ReturnType<typeof fixture>)=>{f.current.status='not_found';f.current.focus={};f.current.sources=[]},
  ]){
    const f=fixture();f.saveTask();mutation(f);assert.equal(await f.guard.validate(),false)
    assert.equal(f.guard.evidence().focus.task?.instructions,'Before','unvalidated facts cannot advance evidence')
  }
})

test('project, Area and event advances require exact matching readback timestamps and field projections',async()=>{
  const f=fixture();f.current.project!.name='Own project';f.update('project','Own project')
  f.current.focus.area!.name='Own area';f.update('areas','Own area')
  f.receipts.push({projectId:'A',dataset:'project',recordId:'A',label:'Project',operation:'updated',savedAt:t2,record:{id:'A',name:'Own project',updated_at:t2}},
    {projectId:'A',dataset:'areas',recordId:'a',label:'Area',operation:'updated',savedAt:t2,record:{id:'a',project_id:'A',name:'Own area',updated_at:t2}})
  assert(await f.guard.validate());f.current.sources[0].updatedAt=t3;assert.equal(await f.guard.validate(),false)
  const initial:CurrentView={status:'ok',projectId:'A',surface:'event',project:{id:'A',name:'Project'},focus:{event:{id:'e',name:'Build day',status:'planned',day:'Monday',time:'10',place:'Site'}},
    sources:[{projectId:'A',dataset:'events',recordId:'e',label:'Build day',updatedAt:t1,truth:'unknown',retrievedAt:t1}],warnings:[],retrievedAt:t1}
  const fresh=structuredClone(initial);fresh.focus.event!.time='11';fresh.sources[0].updatedAt=t2
  const receipt:WriteReadback={projectId:'A',dataset:'events',recordId:'e',label:'Event',operation:'updated',savedAt:t2,record:{id:'e',project_id:'A',title:'Build day',status:'planned',day:'Monday',time:'11',place:'Site',updated_at:t2}}
  const guard=createCurrentViewGuard({initial,read:async()=>fresh,hasAccess:async()=>true,receipts:()=>[receipt]})
  assert(await guard.validate());fresh.focus.event!.place='External location';assert.equal(await guard.validate(),false)
})

test('Plan receipt proves the exact current focused Step revision and never a changed parent or external newer plan',async()=>{
  const f=fixture();f.current.focus.planStep={...f.current.focus.planStep!,name:'Own step',state:'doing',planRevision:2,notes:'Own note'}
  f.current.sources.find(s=>s.dataset==='plan')!.label='Own step'
  const receipt:WriteReadback={projectId:'A',dataset:'plan',recordId:'A',label:'Plan',operation:'updated',revision:2,savedAt:t2,
    record:{id:'A',project_id:'A',revision:2,steps:[{id:step,title:'Own step',state:'doing',goal:'Build',notes:'Own note',area_id:'a'}]}}
  f.receipts.push(receipt);assert(await f.guard.validate())
  f.current.focus.planStep!.planRevision=3;assert.equal(await f.guard.validate(),false)
  f.current.focus.planStep!.planRevision=2;(receipt.record.steps as any[])[0].area_id='other';assert.equal(await f.guard.validate(),false)
})

test('related assignees and Step responsibility remain exact while own core fields advance',async()=>{
  const f=fixture()
  Object.assign(f.initial.focus.task!,{assignees:[{id:'worker',name:'Worker'}]})
  Object.assign(f.initial.focus.planStep!,{responsible:{kind:'bob'}})
  f.current=structuredClone(f.initial);f.saveTask()
  const guard=createCurrentViewGuard({initial:f.initial,read:async()=>f.current,hasAccess:async()=>true,receipts:()=>f.receipts})
  assert(await guard.validate())
  Object.assign(f.current.focus.task!,{assignees:[{id:'other',name:'Other person'}]});assert.equal(await guard.validate(),false)
  Object.assign(f.current.focus.task!,{assignees:[{id:'worker',name:'Worker'}]})
  f.current.focus.planStep!.planRevision=2
  f.receipts.push({projectId:'A',dataset:'plan',recordId:'A',label:'Plan',operation:'updated',revision:2,savedAt:t2,
    record:{id:'A',project_id:'A',revision:2,steps:[{id:step,title:'Step',state:'ready',goal:'Build',notes:'',area_id:'a',responsible_kind:'bob',responsible_person_id:null}]}})
  assert(await guard.validate());Object.assign(f.current.focus.planStep!,{responsible:{kind:'unassigned'}});assert.equal(await guard.validate(),false)
})

test('failed entry focus carries no object facts; access loss or failed fresh reads cannot authorize continued work',async()=>{
  const initial:CurrentView={status:'not_found',projectId:'A',surface:'task',focus:{},sources:[],warnings:[],retrievedAt:t1}
  let allowed=true,reads=0
  const guard=createCurrentViewGuard({initial,read:async()=>{reads++;throw new Error('No factual focus')},hasAccess:async()=>allowed,receipts:()=>[]})
  assert(await guard.validate());assert.equal(reads,0);allowed=false;assert.equal(await guard.validate(),false)
  const f=fixture();f.revoke();assert.equal(await f.guard.validate(),false)
  const failed=createCurrentViewGuard({initial:fixture().initial,read:async()=>{throw new Error('Unavailable')},hasAccess:async()=>true,receipts:()=>[]})
  assert.equal(await failed.validate(),false)
})

test('real Bob loop can update focused Task then complete a second requested write through the guarded readbacks',async()=>{
  const f=fixture(),message='Update this task and create follow-up'
  let writes=0,calls=0
  const writer=createProjectWriter('A',message,async payload=>{
    writes++
    if(writes===1){
      f.current.focus.task={id:'t',name:String(payload.data.name),status:'todo',instructions:String(payload.data.instructions)};f.update('tasks',String(payload.data.name))
      return {data:{...f.taskReceipt(),record:{...f.taskReceipt().record,name:payload.data.name,status:'todo',instructions:payload.data.instructions}},error:null}
    }
    return {data:{projectId:'A',dataset:'tasks',recordId:'follow-up',label:'Follow-up',operation:'created',savedAt:t3,record:{id:'follow-up'}},error:null}
  },async()=>({data:[],error:null}))
  const guard=createCurrentViewGuard({initial:f.initial,read:async()=>f.current,hasAccess:async()=>true,receipts:()=>writer.receipts})
  const lookup=createProjectLookup('A',async()=>({data:{records:[{id:'A',name:'Project'}],related:[],truncated:false},error:null}),1000,12)
  const answer=await runProjectAnswer({projectId:'A',userId:'caller',message,currentView:f.initial,validateCurrentView:guard.validate,lookup,writer,hasAccess:async()=>true,
    callModel:async()=>{
      calls++
      const base={success:true,model:'fixture',responseId:'r'+calls,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
      if(calls<=2)return {...base,data:null,toolCalls:[{id:'c'+calls,type:'function',function:{name:'save_project_task',arguments:JSON.stringify({record_id:calls===1?'t':null,
        area_id:'a',step_id:step,name:calls===1?'Updated task':'Follow-up',instructions:calls===1?'After':'Second action',expected_updated_at:calls===1?t1:null,request_quote:message})}}]}
      return {...base,data:'Both requested changes were saved.'}
    }})
  assert(answer.ok);assert.equal(writes,2);assert.equal(calls,3);assert.equal(guard.evidence().focus.task?.instructions,'After')
})

test('external focus mutation during a real model call blocks its subsequent write batch',async()=>{
  const f=fixture(),message='Update this task';let writes=0
  const writer=createProjectWriter('A',message,async()=>{writes++;throw new Error('Stale focus must never reach transport')},async()=>({data:[],error:null}))
  const lookup=createProjectLookup('A',async()=>({data:{records:[{id:'A',name:'Project'}],related:[],truncated:false},error:null}),1000,12)
  const answer=await runProjectAnswer({projectId:'A',userId:'caller',message,currentView:f.initial,validateCurrentView:f.guard.validate,lookup,writer,hasAccess:async()=>true,
    callModel:async()=>{
      f.current.focus.task!.instructions='External edit while model thinks';f.update('tasks','Task',t3)
      return {success:true,data:null,model:'fixture',responseId:'stale-response',usage:{input_tokens:1,output_tokens:1,total_tokens:2},toolCalls:[{id:'stale-write',type:'function',function:{name:'save_project_task',
        arguments:JSON.stringify({record_id:'t',area_id:'a',step_id:step,name:'Updated task',instructions:'After',expected_updated_at:t3,request_quote:message})}}]}
    }})
  assert(!answer.ok);assert.equal(answer.error,'context_unavailable');assert.equal(writes,0)
})
