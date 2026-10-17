import { schemaIssues } from '../supabase/functions/_shared/schema-issues.ts'
import { createAiCatalogSession } from '../supabase/functions/_shared/ai-catalog.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { catalogFixture, preTaskWorkflowCatalogFixture } from './support/ai-catalog-fixture.ts'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { createWorkRecords, applyWorkDeltaV2, WORK_RECORD_TOOLS, WORK_RECORD_TOOLS_V2, WORK_VALUE_TOOL_NAMES, type WorkResource } from '../supabase/functions/_shared/project-work-records.ts'
import { createProjectWriter, type WritePayload } from '../supabase/functions/_shared/project-write.ts'
import { createBobJournal, type JournalEntry } from '../supabase/functions/_shared/bob-job-journal.ts'
const uid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',measurement=randomUUID(),image=randomUUID()
const quote='Update the existing work and its links. Create the requested new work only.'
const set=(path:string,value:unknown)=>({op:'set',path,value_json:JSON.stringify(value)})
const nativeSet=(path:string,value:unknown)=>({op:'set',path,value})
const currentWorkPolicy=async()=>{const policy=await seedToolPolicy();return{...policy,tools:policy.tools.map(row=>(WORK_VALUE_TOOL_NAMES as readonly string[]).includes(row.name)?{...row,schema_version:2}:row)}}
let pg:Awaited<ReturnType<typeof projectSchema>>,thread:string,turn:string,generation:number,beforeCatalog:any
before(async()=>{
 pg=await projectSchema(async(db,name)=>{if(name.endsWith('_ai_work_records_catalog.sql'))beforeCatalog=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m})
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[uid,'owner@example.test',other,'other@example.test'])
 await pg.exec("insert into bob.projects(id,slug,name) values('A','a','Project A'),('B','b','Project B');insert into bob.areas(id,project_id,slug,name,description) values('areaA','A','area-a','Assembly','Existing Area description'),('areaB','B','area-b','Private Area','Do not read');insert into bob.tasks(id,project_id,area_id,name,instructions) values('taskA','A','areaA','Assemble panel','Existing instructions'),('taskA2','A','areaA','Finish panel','Keep these'),('taskB','B','areaB','Private task','Private')")
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('oneA','A','Owner','OA',$1),('twoA','A','Helper','HA',null),('otherB','B','Other','OB',$2)",[uid,other])
 await pg.exec("insert into bob.task_assignees values('taskA','oneA');insert into bob.events(id,project_id,slug,title,day,time,place,food) values('eventA','A','event-a','Panel day','Saturday','09:00','Workshop','Soup');insert into bob.event_tasks values('A','eventA','taskA');insert into bob.event_attendees values('eventA','oneA');insert into bob.materials(id,project_id,name) values('shopA','A','Screws')")
 await pg.query("insert into bob.media_assets(id,project_id,original_name,title,purpose,content_type,byte_size,width,height,state,created_by) values($1,'A','width.png','Width photo','reference','image/png',8,1,1,'ready',$2)",[image,uid])
 await asProjectUser(pg,uid,"select bob.evidence_command('A','measurement','create',$1,0,$2::jsonb)",[measurement,JSON.stringify({subject:'Width',value:'90',unit:'cm',truth:'provided_spec',source:'Owner specification',notes:'Not measured',required:true,source_media_id:image})])
})
after(async()=>{await pg?.close()})
async function claim(){
 if(turn)await asProjectUser(pg,null,'select bob.bob_fail_turn_v2($1,$2,$3,$4,$5)',['A',uid,thread,turn,generation],'service_role')
 turn=randomUUID();const r:any=(await asProjectUser(pg,null,"select bob.bob_claim_turn('A',$1,$2,$3) result",[uid,turn,quote],'service_role')).rows[0].result
 assert.equal(r.status,'claimed');thread=r.thread_id;generation=r.generation
}
const read=async(input:{resource:WorkResource;query:string|null;after:string|null},user=uid)=>({data:(await asProjectUser(pg,user,'select bob.read_bob_work_context($1,$2,$3,$4) result',['A',input.resource,input.query,input.after])).rows[0].result,error:null})
async function rpc(payload:WritePayload,user=uid){try{return{data:(await asProjectUser(pg,user,'select bob.bob_project_write_v19($1,$2,$3,$4,$5::jsonb) result',['A',thread,turn,generation,JSON.stringify(payload)])).rows[0].result,error:null}}catch(e:any){return{data:null,error:{code:e.code,message:e.message}}}}
const readSnapshot=async(input:{resource:WorkResource;key:string})=>({data:(await asProjectUser(pg,uid,'select bob.read_bob_work_snapshot($1,$2,$3) result',['A',input.resource,input.key])).rows[0].result,error:null})
function setup(){const payloads:WritePayload[]=[];const writer=createProjectWriter('A',quote,p=>{payloads.push(structuredClone(p));return rpc(p)},async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}));return{payloads,writer,tools:createWorkRecords({projectId:'A',writer,hasAccess:async()=>true,read,readSnapshot})}}
const choose=async(tools:ReturnType<typeof createWorkRecords>,resource:WorkResource,query:string|null=null)=>{const r=await tools.execute('read_work_context',{resource,query,next_ref:null});assert.equal(r.status,'ok',JSON.stringify(r));return r.entries[0]}
const edit=(ref:string,changes:unknown[])=>({ref,changes,reason:'Requested correction',request_quote:quote})
const state=(ref:string,action:string,value:string|null=null)=>({ref,action,value,reason:'Requested state',request_quote:quote})
test('content edits retain identity, untouched fields, measurement provenance and exact retry history',async()=>{
 await claim();const{tools,payloads}=setup();let s=await choose(tools,'areas','Assembly')
 assert.equal((await tools.execute('edit_work_record',edit(s.ref,[set('/name','Assembly group')]))).status,'saved')
 let row:any=(await pg.query("select * from bob.areas where id='areaA'")).rows[0];assert.equal(row.description,'Existing Area description')
 s=await choose(tools,'measurements','Width');assert.equal(s.content.has_source_image,true);assert.ok(!JSON.stringify(s).includes(measurement));assert.ok(!JSON.stringify(s).includes(image))
 const args=edit(s.ref,[set('/value','91')]);assert.equal((await tools.execute('edit_work_record',args)).status,'saved')
 const saved=payloads.at(-1)!;assert.equal((await tools.execute('edit_work_record',args)).status,'saved')
 row=(await pg.query('select * from bob.current_measurements where id=$1',[measurement])).rows[0]
 assert.equal(row.source_media_id,image);assert.equal(row.truth,'provided_spec');assert.equal(row.source,'Owner specification');assert.equal(row.notes,'Not measured');assert.equal(row.required,true);assert.equal(row.revision,2)
 s=await choose(tools,'measurements','Width');assert.equal((await tools.execute('edit_work_record',edit(s.ref,[set('/notes','Revised note')]))).status,'saved')
 assert.equal((await rpc(saved)).error,null,'earlier exact retry still works after another intentional edit')
 const before=(await pg.query('select count(*) n from bob.measurement_revisions')).rows[0].n
 assert.equal((await tools.execute('edit_work_record',edit(s.ref,[set('/value','92')]))).status,'conflict')
 assert.equal((await pg.query('select count(*) n from bob.measurement_revisions')).rows[0].n,before)
})
test('task status and assignments are deltas; external relation-only changes conflict without losing members',async()=>{
 await claim();const{tools}=setup();let t=await choose(tools,'tasks','Assemble panel'),p=await choose(tools,'people','Helper')
 const add={target_ref:t.ref,source_ref:p.ref,action:'add',reason:'Assign helper',request_quote:quote}
 assert.equal((await tools.execute('change_work_relation',add)).status,'saved')
 assert.deepEqual((await pg.query("select person_id from bob.task_assignees where task_id='taskA' order by person_id")).rows.map((r:any)=>r.person_id),['oneA','twoA'])
 t=await choose(tools,'tasks','Assemble panel');await asProjectUser(pg,uid,"delete from bob.task_assignees where task_id='taskA' and person_id='twoA'")
 assert.equal((await tools.execute('change_work_state',state(t.ref,'status','doing'))).status,'conflict')
 t=await choose(tools,'tasks','Assemble panel');assert.equal((await tools.execute('change_work_state',state(t.ref,'status','doing'))).status,'saved')
 const row:any=(await pg.query("select * from bob.tasks where id='taskA'")).rows[0];assert.equal(row.instructions,'Existing instructions');assert.equal(row.area_id,'areaA')
 assert.deepEqual((await pg.query("select person_id from bob.task_assignees where task_id='taskA'")).rows.map((r:any)=>r.person_id),['oneA'])
 assert.equal((await tools.execute('change_work_relation',{...add,target_ref:(await choose(tools,'tasks','Assemble panel')).ref})).status,'saved')
})
test('build day edits preserve tasks and RSVP; adding one task preserves the others',async()=>{
 await claim();const{tools}=setup();let e=await choose(tools,'build_days','Panel day')
 assert.equal((await tools.execute('edit_work_record',edit(e.ref,[set('/time','10:00')]))).status,'saved')
 assert.deepEqual((await pg.query("select task_id from bob.event_tasks where event_id='eventA'")).rows.map((r:any)=>r.task_id),['taskA'])
 assert.equal((await pg.query("select count(*) n from bob.event_attendees where event_id='eventA'")).rows[0].n,1)
 e=await choose(tools,'build_days','Panel day');const t=await choose(tools,'tasks','Finish panel')
 assert.equal((await tools.execute('change_work_relation',{target_ref:e.ref,source_ref:t.ref,action:'add',reason:'Schedule task',request_quote:quote})).status,'saved')
 assert.deepEqual((await pg.query("select task_id from bob.event_tasks where event_id='eventA' order by task_id")).rows.map((r:any)=>r.task_id),['taskA','taskA2'])
 e=await choose(tools,'build_days','Panel day');await pg.exec("delete from bob.event_tasks where event_id='eventA' and task_id='taskA2'")
 assert.equal((await tools.execute('edit_work_record',edit(e.ref,[set('/food','Salad')]))).status,'conflict')
 assert.equal((await pg.query("select food from bob.events where id='eventA'")).rows[0].food,'Soup')
})
test('explicit creates bind destination and server identity; a failed edit cannot become a duplicate',async()=>{
 await claim();const{tools,writer}=setup();const scope=await choose(tools,'areas','Assembly group')
 const args={resource:'tasks',scope_ref:scope.ref,base_ref:null,changes:[set('/name','New cut task')],reason:'New work requested',request_quote:quote}
 assert.equal((await tools.execute('create_work_record',args)).status,'saved')
 const id=writer.receipts[0].recordId;assert.ok(id.startsWith('t_'));assert.equal(writer.receipts[0].record.area_id,'areaA');assert.equal(writer.receipts[0].record.status,'todo')
 assert.equal((await tools.execute('create_work_record',args)).status,'saved');assert.equal((await pg.query("select count(*) n from bob.tasks where name='New cut task'")).rows[0].n,1)
 const m=await choose(tools,'measurements','Width')
 assert.equal((await tools.execute('edit_work_record',edit(m.ref,[set('/id','fabricated')]))).status,'invalid')
 assert.equal((await tools.execute('create_work_record',{...args,changes:[set('/name','Fallback duplicate')]})).status,'invalid')
 assert.equal((await pg.query("select count(*) n from bob.tasks where name='Fallback duplicate'")).rows[0].n,0)
})
test('scope and copied base stay current; blank measurement keeps uncertainty and server-calculated millimetres',async()=>{
 await claim();const{tools,writer}=setup();let scope=await choose(tools,'project');const base=await choose(tools,'areas','Assembly group')
 await pg.exec("update bob.areas set description='Concurrent description' where id='areaA'")
 assert.equal((await tools.execute('create_work_record',{resource:'areas',scope_ref:scope.ref,base_ref:base.ref,changes:[set('/name','Stale copy')],reason:'New Area',request_quote:quote})).status,'conflict')
 const args={resource:'measurements',scope_ref:scope.ref,base_ref:null,changes:[set('/subject','Missing depth')],reason:'Record unknown',request_quote:quote}
 assert.equal((await tools.execute('create_work_record',args)).status,'saved')
 const id=writer.receipts.at(-1)!.recordId;const row:any=(await pg.query('select * from bob.current_measurements where id=$1',[id])).rows[0]
 assert.equal(row.truth,'unknown');assert.equal(row.value,null);assert.equal(row.millimetres,null)
})
test('schedule merges one changed date; state actions preserve histories and enforce domain rules',async()=>{
 await claim();await pg.exec("update bob.projects set start_date='2026-10-20',end_date='2026-10-25' where id='A'")
 const{tools}=setup();let p=await choose(tools,'project');assert.equal((await tools.execute('edit_work_record',edit(p.ref,[set('/end_date','2026-10-26')]))).status,'saved')
 assert.equal((await pg.query("select start_date::text s,end_date::text e from bob.projects where id='A'")).rows[0].s,'2026-10-20')
 p=await choose(tools,'project');await pg.exec("update bob.projects set description='Concurrent description' where id='A'")
 assert.equal((await tools.execute('change_work_state',state(p.ref,'phase','design'))).status,'conflict')
 p=await choose(tools,'project');assert.equal((await tools.execute('change_work_state',state(p.ref,'phase','design'))).status,'saved')
 let m=await choose(tools,'measurements','Width');assert.equal((await tools.execute('change_work_state',state(m.ref,'archive'))).status,'saved')
 m=await choose(tools,'measurements','Width');assert.equal(m.content.archived,true);assert.equal((await tools.execute('change_work_state',state(m.ref,'restore'))).status,'saved')
 const t=await choose(tools,'tasks','Assemble panel');assert.equal((await tools.execute('change_work_state',state(t.ref,'status','done'))).status,'saved')
 assert.equal((await tools.execute('change_work_state',state((await choose(tools,'tasks','Assemble panel')).ref,'delete'))).status,'invalid')
 assert.equal((await pg.query("select count(*) n from bob.tasks where id='taskA'")).rows[0].n,1)
})
test('Shopping delete compares full read; revoked access and fabricated refs cannot mutate',async()=>{
 await claim();const{tools,payloads}=setup();let s=await choose(tools,'shopping','Screws');await pg.exec("update bob.materials set name='Different screws' where id='shopA'")
 assert.equal((await tools.execute('change_work_state',state(s.ref,'delete'))).status,'conflict')
 s=await choose(tools,'shopping','Different screws');assert.equal((await tools.execute('change_work_state',state(s.ref,'delete'))).status,'saved');assert.equal((await tools.execute('change_work_state',state(s.ref,'delete'))).status,'saved','retry after deletion')
 assert.equal((await tools.execute('edit_work_record',edit('taskA',[set('/name','No')]))).status,'invalid')
 for(const resource of ['project','tasks','people','measurements','shopping'] as WorkResource[])await assert.rejects(read({resource,query:null,after:null},other),/project_denied/)
 assert.ok((await rpc(payloads[0],other)).error)
 const denied=createWorkRecords({projectId:'A',hasAccess:async()=>false,read});assert.equal((await denied.execute('read_work_context',{resource:'project',query:null,next_ref:null})).status,'denied')
})
test('read pagination is bound; malformed field edits cannot escape allowed content paths',async()=>{
 await claim();const{tools}=setup();const p=await tools.execute('read_work_context',{resource:'tasks',query:null,next_ref:null});assert.ok(p.next_ref)
 assert.equal((await tools.execute('read_work_context',{resource:'people',query:null,next_ref:p.next_ref})).status,'invalid')
 assert.equal((await tools.execute('read_work_context',{resource:'tasks',query:'panel',next_ref:p.next_ref})).status,'invalid')
 assert.equal((await tools.execute('read_work_context',{resource:'tasks',query:null,next_ref:p.next_ref})).status,'ok')
 const t=await choose(tools,'tasks','Assemble panel')
 for(const path of ['/area_id','/primary_step_id','/person_ids','/__proto__','/status'])assert.equal((await tools.execute('edit_work_record',edit(t.ref,[set(path,'wrong')]))).status,'invalid')
 for(const t of WORK_RECORD_TOOLS)for(const forbidden of ['record_id','expected_revision','expected_updated_at','area_id','task_ids','person_ids'])assert.ok(!JSON.stringify(t.function.parameters).includes('"'+forbidden+'"'))
})
test('current Plan Step owns new Task automatically; content edit keeps that ownership',async()=>{
 await claim();const step=randomUUID()
 await pg.exec("insert into bob.project_plans(project_id,current_revision,next_revision) values('A',null,2)")
 await pg.query("insert into bob.project_plan_revisions(project_id,revision,status,summary,reason,proposed_by,approved_by,decided_at) values('A',1,'approved','Fixture','Fixture',$1,$1,now())",[uid])
 await pg.query("insert into bob.project_plan_steps(project_id,plan_revision,step_id,position,title,goal,state,area_id,responsible_kind) values('A',1,$1,1,'Cut panel','Prepare panel','planned','areaA','unassigned')",[step]);await pg.exec("update bob.project_plans set current_revision=1 where project_id='A'")
 const{tools,writer}=setup(),scope=await choose(tools,'plan_steps','Cut panel')
 const result=await tools.execute('create_work_record',{resource:'tasks',scope_ref:scope.ref,base_ref:null,changes:[set('/name','Step-owned cut')],reason:'Create ordinary work',request_quote:quote});assert.equal(result.status,'saved',JSON.stringify(result))
 const id=writer.receipts[0].recordId;const task=await choose(tools,'tasks','Step-owned cut')
 assert.equal((await tools.execute('edit_work_record',edit(task.ref,[set('/instructions','Use the supported cutting plan')]))).status,'saved')
 const row:any=(await pg.query('select primary_step_id,area_id from bob.tasks where id=$1',[id])).rows[0];assert.equal(row.primary_step_id,step);assert.equal(row.area_id,'areaA')
})
test('Area archive/restore and build day deletion use bound records and preserve completed/project history',async()=>{
 await claim();await pg.exec("insert into bob.areas(id,project_id,slug,name) values('emptyA','A','empty','Unused group');insert into bob.events(id,project_id,slug,title) values('deleteEvent','A','delete-event','Cancelled day');insert into bob.event_tasks values('A','deleteEvent','taskA')")
 const{tools}=setup();let a=await choose(tools,'areas','Unused group')
 assert.equal((await tools.execute('change_work_state',state(a.ref,'archive'))).status,'saved');a=await choose(tools,'areas','Unused group');assert.equal(a.content.archived,true)
 assert.equal((await tools.execute('change_work_state',state(a.ref,'restore'))).status,'saved')
 const e=await choose(tools,'build_days','Cancelled day');assert.equal((await tools.execute('change_work_state',state(e.ref,'delete'))).status,'saved');assert.equal((await tools.execute('change_work_state',state(e.ref,'delete'))).status,'saved')
 assert.equal((await pg.query("select count(*) n from bob.tasks where id='taskA'")).rows[0].n,1)
 const count=(await pg.query('select count(*) n from bob.areas')).rows[0].n
 assert.equal((await tools.execute('change_work_state',state((await choose(tools,'areas','Assembly group')).ref,'archive'))).status,'invalid','unfinished work prevents archival')
 assert.equal((await pg.query('select count(*) n from bob.areas')).rows[0].n,count)
})
test('new contracts activate together without rewriting older manifests or model settings',async()=>{
 const live:any=(await pg.query("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
 assert.deepEqual((await pg.query("select shared.resolve_ai_catalog('bob',$1) m",[beforeCatalog.manifest_id])).rows[0].m,beforeCatalog)
 assert.deepEqual(live.models,beforeCatalog.models)
 for(const spec of WORK_RECORD_TOOLS){const row=live.definitions.find((r:any)=>r.prompt_key==='tools.'+spec.function.name),expected=row.definition.envelope.schema_version===2?WORK_RECORD_TOOLS_V2.find(t=>t.function.name===spec.function.name)!:spec;assert.deepEqual(row.definition.parameters,expected.function.parameters);assert.ok(!catalogFixture().tool(spec.function.name,{server_quote:true}).function.parameters.required.includes('request_quote'))}
 const{tools,writer}=setup(),lookup=createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null}))
 const fresh=createBobToolSession({aiCatalog:catalogFixture(),message:quote,lookup,writer,workRecords:tools,readPolicy:currentWorkPolicy})
 const names=(await fresh.prepare()).map(t=>t.function.name);assert.ok(names.includes('edit_work_record'));assert.ok(!names.includes('save_project_task'));assert.ok(!names.includes('save_project_build_day'))
 const old=createBobToolSession({aiCatalog:createAiCatalogSession({rpc:async()=>{throw Error('Pinned only')}},{app:'bob',manifest:beforeCatalog}),message:quote,lookup,writer,workRecords:tools,readPolicy:currentWorkPolicy})
 const oldNames=(await old.prepare()).map(t=>t.function.name);assert.ok(oldNames.includes('save_project_task'));assert.ok(!oldNames.includes('edit_work_record'))
})
test('durable restart rebuilds exact refs and transport inputs while access is checked live',async()=>{
 const entries:JournalEntry[]=[],data:any=(await read({resource:'areas',query:'Assembly group',after:null})).data
 let allowed=true,reads=0,writes=0,refreshes=0
 const run=async()=>{
  const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},Infinity)
  const writer=createProjectWriter('A',quote,p=>journal.run('write',p,async()=>{writes++;return{data:{projectId:'A',dataset:'areas',recordId:'areaA',label:'Assembly group',operation:'updated',savedAt:'2026-10-14T12:00:00Z',record:{id:'areaA',name:'Assembly group',description:'Journal content'}},error:null}}),async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}))
  const tools=createWorkRecords({projectId:'A',writer,hasAccess:async()=>allowed,read:input=>journal.run('read',input,async()=>{reads++;return{data,error:null}}),readSnapshot:input=>journal.run('snapshot',input,async()=>{refreshes++;const snapshot=structuredClone(data[0]);snapshot.record.description='Journal content';return{data:snapshot,error:null}})})
  const rows=await tools.execute('read_work_context',{resource:'areas',query:'Assembly group',next_ref:null});if(rows.status!=='ok')return rows
  return tools.execute('edit_work_record',edit(rows.entries[0].ref,[set('/description','Journal content')]))
 }
 const saved=await run();assert.equal(saved.status,'saved');assert.equal(saved.current.content.description,'Journal content');data[0].record.description='Later data'
 assert.deepEqual(await run(),saved);assert.equal(reads,1);assert.equal(writes,1);assert.equal(refreshes,1)
 allowed=false;assert.equal((await run()).status,'denied');assert.equal(writes,1)
})
test('readiness needs use saved indices and preserve other values; new needs start unresolved',async()=>{
 await claim();const{tools,payloads}=setup()
 const args=(task_ref:string,action:string,overrides:Record<string,unknown>={})=>({task_ref,action,item_index:null,source_ref:null,checkpoint_index:null,changes:[],ready:null,note:null,reason:'Requested readiness change',request_quote:quote,...overrides})
 let t=await choose(tools,'tasks','Finish panel')
 const add=args(t.ref,'add_need',{changes:[set('/label','Saw available'),set('/notes','Check actual availability')]})
 let result=await tools.execute('change_task_readiness',add);assert.equal(result.status,'saved',JSON.stringify(result));assert.equal((await tools.execute('change_task_readiness',add)).status,'saved')
 t=await choose(tools,'tasks','Finish panel');assert.equal(t.content.needs[0].ready,false)
 assert.ok(!JSON.stringify(t.content).includes('taskA2'));assert.equal((await tools.execute('change_task_readiness',args(t.ref,'edit_need',{item_index:0,changes:[set('/notes','Owner will bring the saw')]}))).status,'saved')
 const id=(await pg.query("select id from bob.task_needs where task_id='taskA2'")).rows[0].id
 let row:any=(await pg.query('select * from bob.task_needs where id=$1',[id])).rows[0];assert.equal(row.label,'Saw available');assert.equal(row.ready,false);assert.equal(row.notes,'Owner will bring the saw')
 t=await choose(tools,'tasks','Finish panel');await asProjectUser(pg,uid,"select bob.work_plan_command('A','taskA2','revise_need',$1,$2,'{\"label\":\"Saw availability changed\",\"notes\":\"Other caller\",\"ready\":false}')",[id,row.revision])
 assert.equal((await tools.execute('change_task_readiness',args(t.ref,'set_need_ready',{item_index:0,ready:true}))).status,'conflict')
 t=await choose(tools,'tasks','Finish panel');assert.equal((await tools.execute('change_task_readiness',args(t.ref,'set_need_ready',{item_index:0,ready:true}))).status,'saved')
 row=(await pg.query('select * from bob.task_needs where id=$1',[id])).rows[0];assert.equal(row.label,'Saw availability changed');assert.equal(row.notes,'Other caller');assert.equal(row.ready,true)
 assert.equal((await rpc(payloads[0])).error,null,'original creation retry survives need revisions')
 t=await choose(tools,'tasks','Finish panel');assert.equal((await tools.execute('change_task_readiness',args(t.ref,'remove_need',{item_index:0}))).status,'saved')
 assert.equal((await pg.query('select count(*) n from bob.task_needs where id=$1',[id])).rows[0].n,0)
})
test('dependencies bind Task and checkpoint from reads; readiness confirmation cannot bypass blockers',async()=>{
 await claim();const checkpoint=randomUUID()
 await pg.query("insert into bob.task_steps(id,project_id,task_id,title,position,is_checkpoint,required,created_by) values($1,'A','taskA','Inspect cut',1,true,true,$2)",[checkpoint,uid])
 const{tools}=setup(),args=(task_ref:string,action:string,overrides:Record<string,unknown>={})=>({task_ref,action,item_index:null,source_ref:null,checkpoint_index:null,changes:[],ready:null,note:null,reason:'Requested dependency',request_quote:quote,...overrides})
 let t=await choose(tools,'tasks','Finish panel'),source=await choose(tools,'tasks','Assemble panel')
 assert.equal(source.content.instruction_steps[0].title,'Inspect cut')
 let result=await tools.execute('change_task_readiness',args(t.ref,'add_dependency',{source_ref:source.ref,checkpoint_index:0,note:'Inspect before finishing'}));assert.equal(result.status,'saved',JSON.stringify(result))
 const row:any=(await pg.query("select * from bob.task_dependencies where task_id='taskA2'")).rows[0];assert.equal(row.prerequisite_task_id,'taskA');assert.equal(row.prerequisite_step_id,checkpoint)
 t=await choose(tools,'tasks','Finish panel');assert.equal(t.content.dependencies[0].satisfied,false)
 assert.equal((await tools.execute('change_task_readiness',args(t.ref,'confirm_readiness',{note:'Review'}))).status,'invalid')
 assert.equal((await tools.execute('change_task_readiness',args(t.ref,'remove_dependency',{item_index:0}))).status,'saved')
 assert.equal((await pg.query("select count(*) n from bob.task_dependencies where task_id='taskA2'")).rows[0].n,0)
 // Changing the prerequisite after a read cannot silently bind its new checkpoint state.
 t=await choose(tools,'tasks','Finish panel');source=await choose(tools,'tasks','Assemble panel')
 await pg.query('update bob.task_steps set completed_at=clock_timestamp(),completed_by=$2,revision=revision+1 where id=$1',[checkpoint,uid])
 assert.equal((await tools.execute('change_task_readiness',args(t.ref,'add_dependency',{source_ref:source.ref,checkpoint_index:0,note:'Current checkpoint'}))).status,'conflict')
 source=await choose(tools,'tasks','Assemble panel');t=await choose(tools,'tasks','Finish panel')
 assert.equal((await tools.execute('change_task_readiness',args(t.ref,'add_dependency',{source_ref:source.ref,checkpoint_index:0,note:'Re-add intentionally after removal'}))).status,'saved')
 t=await choose(tools,'tasks','Finish panel');assert.equal(t.content.dependencies[0].satisfied,true)
 assert.equal((await tools.execute('change_task_readiness',args(t.ref,'remove_dependency',{item_index:0}))).status,'saved')
 await pg.exec("update bob.areas set phase='build' where id='areaA'")
 t=await choose(tools,'tasks','Finish panel');const confirmed=await tools.execute('change_task_readiness',args(t.ref,'confirm_readiness',{note:'Owner reported prerequisites checked'}));assert.equal(confirmed.status,'saved',JSON.stringify(confirmed))
 assert.equal((await choose(tools,'tasks','Finish panel')).content.readiness.readiness_state,'ready')

})

test('published readiness schema permits actions without content changes',()=>{
 const schema=WORK_RECORD_TOOLS.find(t=>t.function.name==='change_task_readiness')!.function.parameters
 assert.deepEqual(schemaIssues(schema,{task_ref:'work_example',action:'set_need_ready',item_index:0,source_ref:null,checkpoint_index:null,changes:[],ready:true,note:null,reason:'Actual availability reported',request_quote:quote}),[])
})

test('fresh immutable refs support sequential edits, conflict repair and another task in one turn',async()=>{
 await claim()
 await pg.exec("insert into bob.tasks(id,project_id,area_id,name,instructions) values('smoothA','A','areaA','Smooth sequence','Original'),('smoothB','A','areaA','Smooth second','Keep me')")
 const {tools,writer,payloads}=setup()
 const first=await choose(tools,'tasks','Smooth sequence'),second=await choose(tools,'tasks','Smooth second'),person=await choose(tools,'people','Helper')
 const append=edit(first.ref,[{op:'append_text',path:'/instructions',value_json:JSON.stringify(' + requested')}])
 const saved=await tools.execute('edit_work_record',append)
 assert.equal(saved.status,'saved');assert.notEqual(saved.current.ref,first.ref);assert.equal(saved.current.content.instructions,'Original + requested')
 // An exact retry still uses the original immutable snapshot and cannot append twice.
 const retry=await tools.execute('edit_work_record',append);assert.equal(retry.status,'saved');assert.deepEqual(payloads[0],payloads[1])
 const stale=await tools.execute('change_work_state',state(first.ref,'status','doing'))
 assert.equal(stale.status,'conflict');assert.equal(stale.current.ref,saved.current.ref)
 assert.equal(writer.uncertain,false);assert.ok(writer.remaining>0)
 const doing=await tools.execute('change_work_state',state(stale.current.ref,'status','doing'))
 assert.equal(doing.status,'saved');assert.equal(doing.current.content.status,'doing')
 const assigned=await tools.execute('change_work_relation',{target_ref:doing.current.ref,source_ref:person.ref,action:'add',reason:'Requested assignment',request_quote:quote})
 assert.equal(assigned.status,'saved');assert.deepEqual(assigned.current.content.people,[{name:'Helper'}])
 const need=await tools.execute('change_task_readiness',{task_ref:assigned.current.ref,action:'add_need',item_index:null,source_ref:null,checkpoint_index:null,changes:[set('/label','Check drill')],ready:null,note:null,reason:'Requested need',request_quote:quote})
 assert.equal(need.status,'saved');assert.equal(need.current.content.needs[0].ready,false)
 assert.equal((await tools.execute('edit_work_record',edit(second.ref,[set('/instructions','Next task instructions')]))).status,'saved')
 assert.equal(writer.uncertain,false);assert.equal(writer.hasUnresolvedWrites,false)
 const rows:any[]=(await pg.query("select id,instructions,status from bob.tasks where id in ('smoothA','smoothB') order by id")).rows
 assert.deepEqual(rows,[{id:'smoothA',instructions:'Original + requested',status:'doing'},{id:'smoothB',instructions:'Next task instructions',status:'todo'}])
 // A concurrent human edit is never silently rebased onto an older ref.
 await pg.exec("update bob.tasks set instructions='Human changed instructions' where id='smoothA'")
 const conflict=await tools.execute('edit_work_record',edit(need.current.ref,[set('/name','Smooth renamed')]))
 assert.equal(conflict.status,'conflict');assert.equal(conflict.current.content.instructions,'Human changed instructions')
 assert.equal((await tools.execute('edit_work_record',edit(conflict.current.ref,[set('/name','Smooth renamed')]))).status,'saved')
 assert.equal((await pg.query("select instructions from bob.tasks where id='smoothA'")).rows[0].instructions,'Human changed instructions')
})
test('created records return usable fresh refs; deletes do not attempt a missing-record refresh',async()=>{
 await claim();const {tools,writer}=setup(),scope=await choose(tools,'areas','Assembly group')
 const created=await tools.execute('create_work_record',{resource:'tasks',scope_ref:scope.ref,base_ref:null,changes:[set('/name','Fresh created')],reason:'Requested new work',request_quote:quote})
 assert.equal(created.status,'saved');assert.equal(created.current.content.name,'Fresh created')
 assert.equal((await tools.execute('change_work_state',state(created.current.ref,'status','doing'))).status,'saved')
 const current=await choose(tools,'tasks','Fresh created')
 const deleted=await tools.execute('change_work_state',state(current.ref,'delete'))
 assert.equal(deleted.status,'saved');assert.equal(deleted.current,undefined);assert.equal(deleted.refresh_status,undefined);assert.equal(writer.uncertain,false)
 assert.ok(!tools.currentRecords.some(row=>row.content.name==='Fresh created'))
})
test('failed, foreign and revoked refreshes never change a verified save into an unknown write or leak refs',async()=>{
 await claim()
 for(const mode of ['failed','foreign','revoked']){
  let allowed=true
  const {writer}=setup()
  const tools=createWorkRecords({projectId:'A',writer,hasAccess:async()=>allowed,read,readSnapshot:async input=>{
   if(mode==='failed')throw Error('Read unavailable')
   const value=await readSnapshot(input)
   if(mode==='foreign')(value.data as any).project_id='B'
   if(mode==='revoked')allowed=false
   return value
  }})
  const target=await choose(tools,'tasks','Smooth second')
  const result=await tools.execute('edit_work_record',edit(target.ref,[set('/instructions','Verified '+mode)]))
  assert.equal(result.status,'saved');assert.equal(result.current,undefined);assert.equal(result.refresh_status,'unavailable');assert.equal(writer.uncertain,false)
  assert.ok(!tools.currentRecords.some(row=>row.content.name==='Smooth second'),'failed readback cannot retain a stale target for completion review')
 }
})
test('uncertain writes pause subsequent tool calls honestly without disabling reads',async()=>{
 const writer=createProjectWriter('A',quote,async()=>{throw Error('Lost response')},async()=>({data:[],error:null}),async()=>({data:{generation:1,receipts:[]},error:null}))
 const tools=createWorkRecords({projectId:'A',writer,hasAccess:async()=>true,read,readSnapshot})
 const session=createBobToolSession({aiCatalog:catalogFixture(),message:quote,lookup:createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null})),writer,workRecords:tools,readPolicy:currentWorkPolicy})
 await session.prepare()
 const target=(await session.execute('read_work_context',{resource:'tasks',query:'Smooth second',next_ref:null})).entries[0]
 const native=(catalogFixture().definition('tools.edit_work_record','tool_contract').definition.envelope as any).schema_version===2
 assert.equal((await session.execute('edit_work_record',edit(target.ref,[(native?nativeSet:set)('/instructions','Unverified')]))).status,'unknown')
 const paused=await session.execute('change_work_state',state(target.ref,'status','doing'))
 assert.equal(paused.status,'write_uncertain');assert.match(paused.message,/unverified outcome/)
 const offered=await session.prepare()
 assert.ok(offered.some(t=>t.function.name==='read_work_context'));assert.ok(!offered.some(t=>t.function.name==='edit_work_record'))
 const shelf=session.toolbox.find(t=>t.name==='edit_work_record')!
 assert.equal(shelf.state,'waiting');assert.match(shelf.waitingFor!,/not an exhausted write budget/)
})
test('every active writer returns one transport conflict, preserves authorization and rolls back delegated work',async()=>{
 await pg.exec('create table public.write_transport_probe(n integer); insert into public.write_transport_probe values(0)')
 for(let version=16;version<=20;version++){
  const signature=`bob.bob_project_write_v${version}(text,uuid,uuid,bigint,jsonb)`
  const privileges:any=(await pg.query("select p.prosecdef,p.proconfig,has_function_privilege('authenticated',p.oid,'execute') member,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.oid=$1::regprocedure",[signature])).rows[0]
  assert.equal(privileges.prosecdef,false);assert.ok(privileges.proconfig.includes('search_path=""'));assert.equal(privileges.member,true);assert.equal(privileges.anon,false);assert.equal(privileges.service,false)
  for(const code of ['40001','40P01','42501','22023']){
   // The replacement exists only in a rolled-back test transaction. It simulates
   // a domain failure after mutation, including real transaction conflicts.
   const stop=new Error('rollback fixture')
   await assert.rejects(pg.transaction(async tx=>{
    await tx.exec(`create or replace function bob_private.bob_project_write_v${version}(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin update public.write_transport_probe set n=n+1;raise exception 'fixture_conflict' using errcode='${code}';end$$`)
    await tx.exec(`do $$begin perform bob.bob_project_write_v${version}('A',null,null,1,'{}');raise exception 'expected_failure';exception when sqlstate '${['40001','40P01'].includes(code)?'PT409':code}' then if sqlerrm<>'fixture_conflict' then raise;end if;end$$`)
    assert.equal((await tx.query('select n from public.write_transport_probe')).rows[0].n,0)
    throw stop
   }),e=>e===stop)
  }
  await assert.rejects(asProjectUser(pg,other,`select bob.bob_project_write_v${version}('A',null,null,1,'{}')`),(e:any)=>e.code==='42501')
 }
})

test('native work values reject wrong types and paths while preserving text exactly',()=>{
 const content='First line\n"Quoted" and C:\\plans\\part\nLiteral \\n is not a newline.'
 assert.equal(applyWorkDeltaV2('tasks',{name:'Task',instructions:'Previous'},[nativeSet('/instructions',content)]).instructions,content)
 assert.deepEqual(applyWorkDeltaV2('project',{start_date:'2026-10-17',end_date:'2026-10-20'},[nativeSet('/start_date',null),nativeSet('/end_date',null)]),{start_date:null,end_date:null})
 assert.deepEqual(applyWorkDeltaV2('measurements',{value:'4',required:false},[nativeSet('/value',null),nativeSet('/required',true)]),{value:null,required:true})
 for(const delta of [nativeSet('/instructions',null),nativeSet('/instructions',true),nativeSet('/instructions',{}),nativeSet('/required','true'),nativeSet('/value',42),nativeSet('/area_id','other'),{op:'append_text',path:'/name',value:' extra'},{...nativeSet('/instructions','text'),extra:true},set('/instructions','legacy encoding')]){
  assert.throws(()=>applyWorkDeltaV2('tasks',{instructions:'Original'},[delta]))
 }
 for(const name of WORK_VALUE_TOOL_NAMES){
  const schema=WORK_RECORD_TOOLS_V2.find(t=>t.function.name===name)!.function.parameters
  assert.doesNotMatch(JSON.stringify(schema),/value_json/)
  assert.match(JSON.stringify(schema),/anyOf/)
 }
 for(const spec of WORK_RECORD_TOOLS.filter(t=>!(WORK_VALUE_TOOL_NAMES as readonly string[]).includes(t.function.name)))assert.deepEqual(WORK_RECORD_TOOLS_V2.find(t=>t.function.name===spec.function.name),spec)
})

test('native create, edit and readiness values save once and retain immutable retry and conflict protection',async()=>{
 await claim();const{tools,writer,payloads}=setup(),scope=await choose(tools,'areas','Assembly group')
 const content='Keep the existing decision.\nUse "left" and C:\\plans; literal \\n stays literal.'
 const created=await tools.execute('create_work_record',{resource:'tasks',scope_ref:scope.ref,base_ref:null,changes:[nativeSet('/name','Native work test'),nativeSet('/instructions',content)],reason:'Requested new work',request_quote:quote},2)
 assert.equal(created.status,'saved',JSON.stringify(created));assert.equal(created.current.content.instructions,content)
 const id=writer.receipts.at(-1)!.recordId
 const addition='\nA genuinely new detail.',args=edit(created.current.ref,[{op:'append_text',path:'/instructions',value:addition}])
 const edited=await tools.execute('edit_work_record',args,2)
 assert.equal(edited.status,'saved');assert.equal(edited.current.content.instructions,content+addition)
 const repeat=await tools.execute('edit_work_record',args,2)
 assert.equal(repeat.status,'saved');assert.deepEqual(payloads.at(-1),payloads.at(-2))
 assert.equal((await pg.query('select instructions from bob.tasks where id=$1',[id])).rows[0].instructions,content+addition)
 const need={task_ref:edited.current.ref,action:'add_need',item_index:null,source_ref:null,checkpoint_index:null,changes:[nativeSet('/kind','information'),nativeSet('/label','Owner observation'),nativeSet('/notes','Confirm "width"\nPreserve uncertainty.')],ready:null,note:null,reason:'Requested need',request_quote:quote}
 const readiness=await tools.execute('change_task_readiness',need,2)
 assert.equal(readiness.status,'saved',JSON.stringify(readiness));assert.equal(readiness.current.content.needs[0].notes,'Confirm "width"\nPreserve uncertainty.')
 const latest=tools.currentRecords.find(r=>r.content.name==='Native work test')!
 assert.equal(latest.ref,readiness.current.ref);assert.doesNotMatch(JSON.stringify(latest),new RegExp(id))
 latest.content.instructions='Cannot mutate registered snapshot'
 assert.equal(tools.currentRecords.find(r=>r.content.name==='Native work test')!.content.instructions,content+addition)
 await pg.query('update bob.tasks set instructions=$2 where id=$1',[id,content+'\nConcurrent human correction.'])
 const conflict=await tools.execute('edit_work_record',edit(readiness.current.ref,[nativeSet('/name','Native renamed')]),2)
 assert.equal(conflict.status,'conflict');assert.equal(conflict.current.content.instructions,content+'\nConcurrent human correction.')
 const repaired=await tools.execute('edit_work_record',edit(conflict.current.ref,[nativeSet('/name','Native renamed')]),2)
 assert.equal(repaired.status,'saved');assert.equal(repaired.current.content.instructions,content+'\nConcurrent human correction.')
 const before=payloads.length
 for(const delta of [set('/instructions','Old format'),nativeSet('/instructions',null),nativeSet('/instructions',{text:'nested'}),{...nativeSet('/instructions','new'),unexpected:true}]){
  assert.equal((await tools.execute('edit_work_record',edit(repaired.current.ref,[delta]),2)).status,'invalid')
 }
 assert.equal(payloads.length,before,'invalid values never reach the database')
})

test('Bob selects all three work-value handlers from the pinned manifest under live v2 policy',async()=>{
 for(const version of [1,2] as const){
  await claim();const{tools,writer,payloads}=setup()
  const aiCatalog=catalogFixture(manifest=>{
   for(const name of WORK_VALUE_TOOL_NAMES){
    const row=manifest.definitions.find(r=>r.prompt_key==='tools.'+name)!,spec=(version===2?WORK_RECORD_TOOLS_V2:WORK_RECORD_TOOLS).find(t=>t.function.name===name)!
    row.definition={...row.definition,parameters:spec.function.parameters,required_parameters:spec.function.parameters.required,envelope:{...(row.definition.envelope as object),schema_version:version}}
   }
  })
  const session=createBobToolSession({aiCatalog,message:quote,lookup:createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null})),writer,workRecords:tools,readPolicy:currentWorkPolicy})
  const offered=await session.prepare()
  for(const name of WORK_VALUE_TOOL_NAMES){
   const spec=offered.find(t=>t.function.name===name)!
   assert.ok(spec);assert.equal(JSON.stringify(spec.function.parameters).includes('value_json'),version===1)
  }
  const scope=(await session.execute('read_work_context',{resource:'areas',query:'Assembly group',next_ref:null})).entries[0]
  const change=version===2?nativeSet:set
  const created=await session.execute('create_work_record',{resource:'tasks',scope_ref:scope.ref,base_ref:null,changes:[change('/name',`Pinned v${version}`),change('/instructions','First\n"Second"')],reason:'Requested new work'})
  assert.equal(created.status,'saved',JSON.stringify(created));assert.equal(created.current.content.instructions,'First\n"Second"')
  const edited=await session.execute('edit_work_record',{ref:created.current.ref,changes:[change('/instructions','Integrated\n"Update"')],reason:'Requested update'})
  assert.equal(edited.status,'saved');assert.equal(edited.current.content.instructions,'Integrated\n"Update"')
  const need=await session.execute('change_task_readiness',{task_ref:edited.current.ref,action:'add_need',item_index:null,source_ref:null,checkpoint_index:null,changes:[change('/label','Pinned need'),change('/notes','Line one\nLine two')],ready:null,note:null,reason:'Requested need'})
  assert.equal(need.status,'saved');assert.equal(need.current.content.needs[0].notes,'Line one\nLine two')
  const before=payloads.length,wrong=version===1?nativeSet:set
  assert.equal((await session.execute('edit_work_record',{ref:need.current.ref,changes:[wrong('/instructions','Wrong contract')],reason:'Cannot cross contracts'})).status,'invalid')
  assert.equal(payloads.length,before)
 }
})

test('pre-publication v1 manifest replays byte-identical tools and rejections after live policy v2 activation',async()=>{
 const entries:JournalEntry[]=[],calls={reads:0,writes:0,snapshots:0,models:0}
 const run=async(upgraded:boolean)=>{
  const aiCatalog=preTaskWorkflowCatalogFixture()
  assert.equal(aiCatalog.definition('agent-contract.ask-bob','agent_contract').metadata.work_completion_version,undefined)
  const journal=createBobJournal({entries,save:async entry=>{entries.push(structuredClone(entry))}},Infinity)
  const writer=createProjectWriter('A',quote,payload=>journal.run('write',payload,async()=>{
   calls.writes++
   const domain=payload.data.domain as WritePayload
   return{data:null,error:domain.kind==='task_work'?{code:'P0001',message:'Complete required checks before marking this task done.'}:domain.kind==='operational'?{code:'P0001',message:'Resolve named blockers before confirming readiness.'}:{code:'22023',message:'private fixture detail'}}
  }),async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:[]},error:null}),
  {taskWorkDiagnostics:aiCatalog.definition('agent-contract.ask-bob','agent_contract').metadata.work_completion_version===1})
  const tools=createWorkRecords({projectId:'A',writer,hasAccess:async()=>true,
   read:input=>journal.run('read',input,async()=>{calls.reads++;return read(input)}),
   readSnapshot:async()=>{calls.snapshots++;throw Error('Legacy invalid results never request a new snapshot')},
  })
  const session=createBobToolSession({aiCatalog,message:quote,lookup:createProjectLookup('A',async()=>({data:{records:[],related:[],truncated:false},error:null})),writer,workRecords:tools,readPolicy:upgraded?currentWorkPolicy:seedToolPolicy})
  const offered=await session.prepare()
  for(const name of WORK_VALUE_TOOL_NAMES){
   const contract=offered.find(tool=>tool.function.name===name)!
   assert.ok(contract);assert.match(JSON.stringify(contract.function.parameters),/value_json/)
  }
  const area=(await session.execute('read_work_context',{resource:'areas',query:'Assembly',next_ref:null})).entries[0]
  const task=(await session.execute('read_work_context',{resource:'tasks',query:'Assemble panel',next_ref:null})).entries[0]
  const results=[
   await session.execute('create_work_record',{resource:'tasks',scope_ref:area.ref,base_ref:null,changes:[set('/name','Legacy rejected create')],reason:'Requested new work'}),
   await session.execute('edit_work_record',{ref:task.ref,changes:[set('/instructions','Legacy text\n"Quoted" and \\path')],reason:'Requested edit'}),
   await session.execute('change_task_readiness',{task_ref:task.ref,action:'confirm_readiness',item_index:null,source_ref:null,checkpoint_index:null,changes:[],ready:null,note:'Requested check',reason:'Requested readiness'}),
   await session.execute('change_work_state',{ref:task.ref,action:'status',value:'done',reason:'Requested completion'}),
  ]
  for(const result of results)assert.deepEqual(result,{status:'invalid',message:'The database rejected this command. No change made; check fields, source, current revision and record state.'})
  // The next provider input includes every offered schema/manual and tool result.
  // Replaying it must reuse the journal entry rather than change its fingerprint.
  const packet={offered,results}
  await journal.run('model:legacy-parity',packet,async()=>{calls.models++;return{answer:'Blocked'}})
  return JSON.stringify(packet)
 }
 const original=await run(false),recorded=structuredClone(entries)
 assert.equal(await run(true),original)
 assert.deepEqual(entries,recorded)
 assert.deepEqual(calls,{reads:2,writes:4,snapshots:0,models:1})
})
