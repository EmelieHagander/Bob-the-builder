import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
test('P3 labels: shared current work labels never publish private drawing assessment',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),id=randomUUID(),turn=randomUUID(),member=randomUUID(),outsider=randomUUID()
 const call=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now())',[owner,'gap-task@example.test'])
 const project=(await call(owner,'bob.create_project',[{name:'Gap Task fixture'}])).id
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[member,'shared-member@example.test',outsider,'label-other@example.test'])
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,'Member','M',$3)",[randomUUID(),project,member])
 const requirement={requirement_id:null,type:'measurement',title:'Measure shelf width',description:'Canonical shared instruction',resolution:'open',responsible_kind:'bob',responsible_person_id:null,evidence_selector:{kind:'none',id:null,subject:null,area_id:null}}
 const proposal=await call(owner,'bob_private.project_plan_propose',[project,0,{summary:'Drawing input',reason:'Fixture',steps:[{step_id:null,title:'Drawing',goal:'Shelf concept',state:'active',phase:'planning',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[requirement]}],task_links:[]}],'postgres')
 const plan=(await call(owner,'bob_private.project_plan_decide',[project,0,proposal.record.revision,'approve','Use requirements'],'postgres')).record
 const step=plan.steps[0],rid=step.requirements[0].id
 const c=await call(null,'bob.bob_claim_turn',[project,owner,turn,'Draw shelf'],'service_role')
 await call(owner,'bob.create_drawing_request',[project,c.thread_id,turn,c.generation,id,{...scope,step_id:step.id}])
 const payload={brief:{...scope,step_id:step.id,handoff:{requirements:[{id:'width',basis:'project_record',source_ref:rid}]}},owner_request:'PRIVATE words',reference_refs:[],assessment:{checks:[{id:'width',action:'measurement',blocking:true,detail:'PRIVATE needs'}],additional_needs:[{id:'other',action:'measurement',blocking:true,detail:'PRIVATE other'}]}}
 const save=(rev:number)=>call(null,'bob.bob_drawing_request',[project,owner,c.thread_id,turn,c.generation,'save',id,rev,'needs_data',payload,randomUUID()],'service_role')
 await save(0)
 const rows=(await pg.query<any>('select id,requirement_key from bob_private.drawing_gaps where request_id=$1',[id])).rows
 const gid=rows.find(g=>g.requirement_key==='width')!.id,privateId=rows.find(g=>g.requirement_key==='other')!.id
 await assert.rejects(call(owner,'bob.ensure_drawing_gap_task',[project,id,1,privateId,rid,plan.revision]),/canonical_requirement_required/)
 const unlinked=await call(member,'bob.drawing_request_work',[project,id]);assert(unlinked.gaps.every((g:any)=>g.label===null&&g.owner_label===null&&g.step_title===null));assert(!JSON.stringify(unlinked).includes('PRIVATE'));assert.equal(unlinked.artifact_source_state,null)
 await assert.rejects(call(outsider,'bob.drawing_request_work',[project,id]),/project_denied/)
 const task=await call(owner,'bob.ensure_drawing_gap_task',[project,id,1,gid,rid,plan.revision])
 assert.equal((await call(owner,'bob.ensure_drawing_gap_task',[project,id,1,gid,rid,plan.revision])).task_id,task.task_id)
 const shared=(await pg.query<any>('select name,instructions from bob.tasks where id=$1',[task.task_id])).rows[0]
 assert.deepEqual(shared,{name:requirement.title,instructions:requirement.description});assert(!JSON.stringify(shared).includes('PRIVATE'))
 const projection=await call(member,'bob.drawing_work_list',[project,null,null]);const visible=projection.items[0].gaps.find((g:any)=>g.id===gid);assert.equal(visible.label,requirement.title);assert.equal(visible.owner_label,'Bob');assert.equal(visible.step_title,'Drawing');assert.equal(visible.area_id,null);assert(!JSON.stringify(projection).includes('PRIVATE'));assert.equal(projection.items[0].gaps.find((g:any)=>g.id===privateId).label,null)
 await asProjectUser(pg,owner,'update bob.tasks set name=$1 where id=$2',['Current shared task name',task.task_id]);assert.equal((await call(member,'bob.drawing_request_work',[project,id])).gaps.find((g:any)=>g.id===gid).label,'Current shared task name')
 payload.assessment.additional_needs=[];await save(1)
 assert.equal((await pg.query<any>('select blocking from bob_private.drawing_gaps where id=$1',[privateId])).rows[0].blocking,false,'retired needs keep identity without blocking forever')
 assert.equal((await pg.query<any>('select count(*)::int n from bob.tasks where project_id=$1',[project])).rows[0].n,1)
})