import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {editPlanSnapshot} from '../supabase/functions/_shared/plan-edit.ts'
import {createPlanAssistant} from '../supabase/functions/_shared/plan-assistant.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from '@electric-sql/pglite'

const id=(n:number)=>'98100000-0000-4000-8000-'+String(n).padStart(12,'0')
const criterion=(title='Width')=>({requirement_id:null,type:'measurement',title,description:'Independent width criterion',resolution:'open',responsible_kind:'bob',responsible_person_id:null,evidence_selector:{kind:'none',id:null,subject:null,area_id:null}})
const step=(title:string)=>({step_id:null,title,goal:title,state:'active',area_id:null,phase:'design',responsible_kind:'bob',responsible_person_id:null,notes:'Preserve exact intent',requirements:[criterion()]})
const asRead=(s:any,n:number)=>({...s,id:id(n),step_id:undefined,requirements:s.requirements.map((q:any,i:number)=>({...q,id:id(n*10+i),requirement_id:undefined}))})
const snapshot={plan:[{revision:2,steps:[asRead(step('Survey'),1),asRead(step('Drawing'),2),asRead(step('Build'),3)]}],tasks:[{id:'task',name:'Existing task',primary_step_id:id(1)}]}
const change=(action:string,step_id:string|null,extra:any={})=>({action,step_id,requirement_id:null,after_step_id:null,task_id:null,values:{},...extra})
const edit=(changes:any[])=>({summary:'Focused edit',reason:'Owner requested the exact change',changes})

test('a small edit preserves every unrelated identity/criterion and stages task moves exactly once',()=>{
 const before=structuredClone(snapshot)
 const result=editPlanSnapshot(snapshot,edit([change('remove_requirement',id(1),{requirement_id:id(10)}),change('move_task',id(2),{task_id:'task'}),change('remove_step',id(1))]))
 assert.equal(result.steps.length,2);assert.equal(result.expected_revision,2)
 assert.deepEqual(result.steps[1],{...step('Build'),step_id:id(3),requirements:[{...criterion(),requirement_id:id(30)}]})
 assert.deepEqual(result.task_candidates.map(c=>[c.task_id,c.step_position]),[['task',1]])
 assert.deepEqual(snapshot,before,'the authorised snapshot is never mutated')
})

test('focused edits reject foreign identities, completed-history edits and duplicate ownership',()=>{
 assert.throws(()=>editPlanSnapshot(snapshot,edit([change('remove_step',id(99))])),/Step not found/)
 assert.throws(()=>editPlanSnapshot(snapshot,edit([change('remove_requirement',id(1),{requirement_id:id(20)})])),/Requirement not found/)
 assert.throws(()=>editPlanSnapshot(snapshot,edit([change('update_step',id(1),{values:{state:'completed'}})])),/cannot certify completion/)
 assert.throws(()=>editPlanSnapshot(snapshot,edit([change('move_task',id(2),{task_id:'task'}),change('move_task',id(3),{task_id:'task'})])),/appear once/)
 assert.throws(()=>editPlanSnapshot({...snapshot,plan:[{revision:2,steps:[{...snapshot.plan[0].steps[0],state:'completed'}]}]},edit([change('remove_step',id(1))])),/Completed history/)
 assert.throws(()=>editPlanSnapshot(snapshot,edit([change('update_step',id(1),{values:{project_id:'foreign'}})])),/Unknown edit field/)
})

test('focused edit prepares a valid exact save without compiler calls, and revocation prevents it',async()=>{
 let allowed=true,calls=0
 const assistant=createPlanAssistant({projectId:'A',userId:'u',hasAccess:async()=>allowed,
  makeLookup:()=>createProjectLookup('A',async(_p,i)=>({data:{records:(snapshot as any)[i.dataset]??[],related:[],truncated:false},error:null}),1000,128),
  callModel:async()=>{calls++;throw new Error('No model needed for a focused edit')}})
 const result:any=await assistant.consult('edit_project_plan',edit([change('remove_step',id(1))]))
 assert.equal(result.proposal_ready,true);assert.equal(result.saved,false);assert.equal(calls,0)
 assert.deepEqual(assistant.compiledProposal?.task_links,[],'unchanged Tasks need no regenerated owner guesses')
 allowed=false
 assert.equal((await assistant.consult('edit_project_plan',edit([change('remove_step',id(1))])) as any).status,'denied')
 assert.equal(assistant.canSave,false)
})

let pg:PGlite
const owner=id(901),outsider=id(902)
const call=async(uid:string,fn:string,args:any[],root=false):Promise<any>=>(await asProjectUser(pg,uid,`select ${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,root?'postgres':'authenticated')).rows[0].result
before(async()=>{pg=await projectSchema();await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'owner@example.test',outsider,'outsider@example.test'])})
after(()=>pg.close())

test('removal/reorder preserves evidence through proposal and approval; altered criteria do not inherit proof',async()=>{
 const pid=(await call(owner,'bob.create_project',[JSON.stringify({name:'Plan edit fixture'})])).id
 const initial={summary:'Original',reason:'Fixture',steps:[step('Survey'),step('Draw'),step('Build')]}
 const proposed=await call(owner,'bob_private.project_plan_propose',[pid,0,initial],true)
 const current=(await call(owner,'bob_private.project_plan_decide',[pid,0,proposed.record.revision,'approve','Use'],true)).record
 const measurement=await call(owner,'bob.evidence_command',[pid,'measurement','create',id(950),0,{subject:'Width',value:'910',unit:'mm',truth:'measured',source:'Fixture tape reading',notes:'',required:true,area_id:null,component_id:null,source_media_id:null,change_note:'Measured'}])
 const unchanged=current.steps[1].requirements[0].id,altered=current.steps[2].requirements[0].id
 await call(owner,'bob_private.project_plan_link_evidence',[pid,1,unchanged,'measurement',id(950),measurement.revision,'resolves'],true)
 await call(owner,'bob_private.project_plan_link_evidence',[pid,1,altered,'measurement',id(950),measurement.revision,'resolves'],true)
 const data=editPlanSnapshot({plan:[current],tasks:[]},edit([
  change('remove_step',current.steps[0].id),change('move_step',current.steps[2].id),
  change('update_requirement',current.steps[2].id,{requirement_id:altered,values:{description:'A different physical check'}})
 ]))
 const payload={summary:data.summary,reason:data.reason,steps:data.steps,task_links:[]}
 const edited=await call(owner,'bob_private.project_plan_propose',[pid,1,payload],true)
 assert.equal(edited.record.status,'proposed')
 let links=(await pg.query('select requirement_id,evidence_revision from bob.project_plan_evidence where project_id=$1 and plan_revision=$2',[pid,edited.record.revision])).rows
 assert.deepEqual(links,[{requirement_id:unchanged,evidence_revision:1}])
 // New evidence arrives while the focused proposal is waiting for approval.
 await call(owner,'bob.evidence_command',[pid,'measurement','revise',id(950),1,{subject:'Width',value:'915',unit:'mm',truth:'measured',source:'New fixture tape reading',notes:'',required:true,source_media_id:null,change_note:'Remeasured'}])
 await call(owner,'bob_private.project_plan_link_evidence',[pid,1,unchanged,'measurement',id(950),2,'resolves'],true)
 await assert.rejects(call(outsider,'bob_private.project_plan_decide',[pid,1,edited.record.revision,'approve','No authority'],true),/project_denied/)
 const approved=await call(owner,'bob_private.project_plan_decide',[pid,1,edited.record.revision,'approve','Apply the exact edit'],true)
 assert.deepEqual(approved.record.steps.map((s:any)=>s.id),[current.steps[2].id,current.steps[1].id])
 links=(await pg.query('select requirement_id,evidence_revision from bob.project_plan_evidence where project_id=$1 and plan_revision=$2',[pid,edited.record.revision])).rows
 assert.deepEqual(links,[{requirement_id:unchanged,evidence_revision:2}])
 const history=await call(owner,'bob.project_plan_read',[pid,1]);assert.equal(history.record.steps.length,3)
 await assert.rejects(call(owner,'bob_private.project_plan_propose',[pid,1,payload],true),/record_changed/)
})
