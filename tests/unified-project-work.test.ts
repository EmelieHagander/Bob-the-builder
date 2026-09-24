import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { VOCABULARY_VERSION } from '../src/domain/vocabulary.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'

let pg: PGlite
const owner='99000000-0000-4000-8000-000000000001', stranger='99000000-0000-4000-8000-000000000002'
const call=async(uid:string|null,name:string,args:unknown[],root=false):Promise<any> =>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,root?'postgres':uid?'authenticated':'anon')).rows[0].result
const step=(title:string,area:string|null=null)=>({step_id:null,title,goal:title+' finished and checked',state:'active',phase:'build',area_id:area,
  responsible_kind:'bob',responsible_person_id:null,notes:'Use current project evidence.',requirements:[]})
async function project(title:string,who=owner){return (await call(who,'bob.create_project',[JSON.stringify({name:title})])).id as string}
async function plan(project:string,steps:any[],links:any[]=[],expected=0,who=owner){
  const proposed=await call(who,'bob_private.project_plan_propose',[project,expected,JSON.stringify({summary:'Project work',reason:'Requested organisation',steps,task_links:links})],true)
  return await call(who,'bob_private.project_plan_decide',[project,expected,proposed.record.revision,'approve','Use this plan'],true)
}
before(async()=>{
  pg=await projectSchema()
  await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'work-owner@example.test',stranger,'work-stranger@example.test'])
})
after(()=>pg.close())

test('four project shapes preserve the same hierarchy, with optional Area and simultaneous Steps',async()=>{
  for(const [title,areaName,stepNames] of [
    ['Våningssäng',null,['Sängen','Lådorna']],['Veranda',null,['Grund','Tak']],
    ['Husrenovering','Köket',['Golvet','Köksinredningen']],['Höns- och kaninhus','Gemensam konstruktion',['Stomme','Tak']],
  ] as const){
    const pid=await project(title),area=areaName?'a_'+pid:null
    if(area)await asProjectUser(pg,owner,'insert into bob.areas(id,project_id,slug,name) values($1,$2,$1,$3)',[area,pid,areaName])
    const saved=await plan(pid,stepNames.map(name=>step(name,area)))
    const sid=saved.record.steps[0].id
    await asProjectUser(pg,owner,'insert into bob.tasks(id,project_id,primary_step_id,name) values($1,$2,$3,$4)',['t_'+pid,pid,sid,'Measure and cut'])
    const work=await call(owner,'bob.project_work_read',[pid])
    assert.equal(work.vocabulary_version,VOCABULARY_VERSION)
    assert.equal(work.steps.filter((s:any)=>s.state==='active').length,2)
    assert.equal(work.steps[0].tasks[0].id,'t_'+pid)
    assert.equal(work.steps[0].tasks[0].area_id,area)
    assert.deepEqual(work.unorganised_tasks,[])
    const briefing=await call(owner,'bob.project_plan_briefing',[pid])
    assert(briefing.current_step.tasks.some((t:any)=>t.id==='t_'+pid),'atomic primary ownership is visible without separate links')
    await call(owner,'bob_private.project_plan_set_focus',[pid,1,work.steps[1].id],true)
    assert.equal((await call(owner,'bob.project_plan_briefing',[pid])).current_step.id,work.steps[1].id)
    assert.equal((await call(owner,'bob.project_work_read',[pid])).steps.filter((s:any)=>s.state==='active').length,2)
  }
})

test('Area-free work stays project isolated across task, assignment, research, readiness and instructions',async()=>{
  const a=await project('A'),b=await project('B',stranger)
  const sa=(await plan(a,[step('A step')])).record.steps[0].id
  const sb=(await plan(b,[step('B step')],[],0,stranger)).record.steps[0].id
  await asProjectUser(pg,owner,'insert into bob.tasks(id,project_id,primary_step_id,name) values($1,$2,$3,$4)',['ta',a,sa,'A work'])
  await assert.rejects(asProjectUser(pg,owner,'insert into bob.tasks(id,project_id,primary_step_id,name) values($1,$2,$3,$4)',['leak',a,sb,'Wrong Step']),/plan_step_not_found|project_denied/)
  assert.equal((await asProjectUser(pg,stranger,"select * from bob.tasks where id='ta'")).rows.length,0)
  await assert.rejects(call(stranger,'bob.project_work_read',[a]),/project_denied/)
  const privatePerson=(await asProjectUser(pg,stranger,'select id from bob.people where project_id=$1',[b])).rows[0].id
  await assert.rejects(asProjectUser(pg,owner,"insert into bob.task_assignees values('ta',$1)",[privatePerson]),/row-level security/)
  const found=await call(owner,'bob.search_bob_project_data_v2',[a,'tasks',null,null,null,'ta',null])
  assert.equal(found.records[0].primary_step_id,sa)
  assert.equal((await asProjectUser(pg,owner,"select * from bob.current_task_readiness where task_id='ta'")).rows.length,1)
  assert.equal((await asProjectUser(pg,owner,"select * from bob.today_tasks where id='ta'")).rows.length,1)
  await call(owner,'bob.task_steps_command',[a,'ta','create',null,JSON.stringify({title:'Measure twice',instructions:'Use the current drawing',is_checkpoint:false,required:false})])
  assert.equal((await asProjectUser(pg,owner,"select title from bob.task_steps where task_id='ta'")).rows[0].title,'Measure twice')
})

test('approval applies staged ownership atomically and preserves task identity/status',async()=>{
  const pid=await project('Organise existing work'),area='legacy_'+pid
  await asProjectUser(pg,owner,'insert into bob.areas(id,project_id,slug,name) values($1,$2,$1,$3)',[area,pid,'Existing scope'])
  await asProjectUser(pg,owner,"insert into bob.tasks(id,area_id,name,status) values('existing',$1,'Already done','done')",[area])
  const proposed=await call(owner,'bob_private.project_plan_propose',[pid,0,JSON.stringify({summary:'Organise',reason:'Same work',steps:[step('Assembly')],task_links:[{step_position:1,task_id:'existing'}]})],true)
  assert.equal((await call(owner,'bob.project_work_read',[pid])).unorganised_tasks.length,1)
  await call(owner,'bob_private.project_plan_decide',[pid,0,proposed.record.revision,'approve','Use it'],true)
  const work=await call(owner,'bob.project_work_read',[pid])
  assert.equal(work.steps[0].tasks[0].id,'existing');assert.equal(work.steps[0].tasks[0].status,'done')
  assert.equal(work.steps[0].tasks[0].area_id,null)
  const revised=await call(owner,'bob_private.project_plan_propose',[pid,1,JSON.stringify({summary:'Same work',reason:'Refine',steps:[{...step('Assembly'),step_id:work.steps[0].id}],task_links:[{step_position:1,task_id:'existing'}]})],true)
  await asProjectUser(pg,owner,"update bob.tasks set name='Changed since proposal' where id='existing'")
  await assert.rejects(call(owner,'bob_private.project_plan_decide',[pid,1,revised.record.revision,'approve','Use it'],true),/plan_task_changed/)
  assert.equal((await call(owner,'bob.project_work_read',[pid])).revision,1)
})

test('name-only volunteers can find and open authorised Area-free Tasks',async()=>{
  const pid=await project('Volunteer work'),sid=(await plan(pid,[step('Frame')])).record.steps[0].id
  await asProjectUser(pg,owner,"insert into bob.tasks(id,project_id,primary_step_id,name) values('vol-task',$1,$2,'Help assemble')",[pid,sid])
  const invite=randomBytes(32).toString('hex'),session=randomBytes(32).toString('hex')
  await call(owner,'bob.create_volunteer_link',[pid,'Helpers',invite,30])
  await call(null,'bob.volunteer_join',[invite,session,'Helper',null])
  const task=await call(null,'bob.volunteer_task',[session,'vol-task'])
  assert.match(JSON.stringify(task),/Help assemble/)
})

test('Bob tools save Area, primary Task and focus through the claimed ledger, with retry readback',async()=>{
  const pid=await project('Bob organises work'),message='Organise this work and continue.'
  const turn='99000000-0000-4000-8000-000000000099'
  const claim=(await asProjectUser(pg,null,'select bob.bob_claim_turn($1,$2,$3,$4) result',[pid,owner,turn,message],'service_role')).rows[0].result as any
  const binding=[pid,claim.thread_id,turn,claim.generation]
  const query=async(sql:string,args:unknown[])=>({data:(await asProjectUser(pg,owner,sql,args)).rows[0].result,error:null})
  const writer=createProjectWriter(pid,message,payload=>query('select bob.bob_project_write_v10($1,$2,$3,$4,$5) result',[...binding,JSON.stringify(payload)]))
  const area=await writer.write('save_project_area',{record_id:null,name:'Kitchen',description:'Related renovation work',expected_updated_at:null,request_quote:message})
  assert.equal(area.status,'saved');assert.equal(area.receipt?.dataset,'areas')
  const saved=await plan(pid,[step('Floor',area.receipt!.recordId),step('Shared preparations')])
  const sid=saved.record.steps[0].id
  const payload={record_id:null,area_id:null,step_id:sid,name:'Cut stock',instructions:'Follow the drawing',expected_updated_at:null,request_quote:message}
  const task=await writer.write('save_project_task',payload),retry=await writer.write('save_project_task',payload)
  assert.equal(task.status,'saved');assert.equal(retry.receipt?.recordId,task.receipt?.recordId)
  assert.equal(task.receipt?.record.primary_step_id,sid)
  assert.equal(task.receipt?.record.area_id,area.receipt!.recordId)
  const focus=await writer.write('set_project_plan_focus',{plan_revision:1,step_id:saved.record.steps[1].id,request_quote:message})
  assert.equal(focus.status,'saved');assert.equal(focus.receipt?.record.focus_step_id,saved.record.steps[1].id)
  const manual=await call(owner,'bob.create_work_task',[pid,saved.record.steps[1].id,null,'Prepare','novice','1h'])
  assert.equal(manual.area_id,null);assert.equal(manual.primary_step_id,saved.record.steps[1].id)
})

test('migration backfills only unambiguous ownership and preserves legacy Tasks and checks',async()=>{
  let projectId='',areaId='',first='',second=''
  const upgraded=await projectSchema(async(fixture,name)=>{
    if(!name.endsWith('_unified_project_work.sql'))return
    await fixture.query('insert into auth.users values($1,$2,now())',[owner,'upgrade@example.test'])
    const rpc=async(name:string,args:unknown[],root=false):Promise<any>=>(await asProjectUser(fixture,owner,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,root?'postgres':'authenticated')).rows[0].result
    projectId=(await rpc('bob.create_project',[JSON.stringify({name:'Legacy work'})])).id
    areaId='upgrade-area'
    await asProjectUser(fixture,owner,"insert into bob.areas(id,project_id,slug,name) values($1,$2,$1,'Legacy area')",[areaId,projectId])
    await asProjectUser(fixture,owner,"insert into bob.tasks(id,area_id,name,status) values('one',$1,'One link','done'),('many',$1,'Two links','todo'),('cross',$1,'Other scope','todo')",[areaId])
    const steps=[step('Existing work',areaId),{...step('Project work'),state:'planned'}].map(({phase,...s})=>s)
    const draft=await rpc('bob_private.project_plan_propose',[projectId,0,JSON.stringify({summary:'Legacy',reason:'Fixture',steps})],true)
    const current=await rpc('bob_private.project_plan_decide',[projectId,0,draft.record.revision,'approve','Use'],true)
    ;[first,second]=current.record.steps.map((s:any)=>s.id)
    for(const [task,sid] of [['one',first],['many',first],['many',second],['cross',second]])
      await rpc('bob_private.project_plan_link_task',[projectId,1,sid,task,'link'],true)
    await rpc('bob.task_steps_command',[projectId,'one','create',null,JSON.stringify({title:'Preserved check',instructions:'Same evidence',is_checkpoint:false,required:false})])
  })
  try{
    const rows=(await asProjectUser(upgraded,owner,'select id,project_id,primary_step_id,status from bob.tasks order by id')).rows as any[]
    assert.equal(rows.length,3)
    assert(rows.every(r=>r.project_id===projectId))
    assert.equal(rows.find(r=>r.id==='one').primary_step_id,first)
    assert.equal(rows.find(r=>r.id==='one').status,'done')
    assert.equal(rows.find(r=>r.id==='many').primary_step_id,null)
    assert.equal(rows.find(r=>r.id==='cross').primary_step_id,null)
    assert.equal((await asProjectUser(upgraded,owner,"select title from bob.task_steps where task_id='one'")).rows[0].title,'Preserved check')
  }finally{await upgraded.close()}
})
