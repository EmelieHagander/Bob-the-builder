import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

test('a shell shows each piece\'s plan Steps, sums piece materials once and lets Bob link pieces in one write',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID()
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'plan-shell@example.test',outsider,'plan-shell-other@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Shell plan fixture'})])).id
 const other=(await call(outsider,'bob.create_project',[JSON.stringify({name:'Other plan fixture'})])).id
 const plan=async(uid:string,p:string,titles:string[])=>{
  const draft=await call(uid,'bob_private.project_plan_propose',[p,0,JSON.stringify({summary:'Build the cabin',reason:'Requested',steps:titles.map((title,i)=>({step_id:null,title,goal:title+' done',state:i===0?'active':'planned',phase:'planning',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[]})),task_links:[]})],'postgres')
  return (await call(uid,'bob_private.project_plan_decide',[p,0,draft.record.revision,'approve','Proceed'],'postgres')).record.steps.map((s:any)=>s.id) as string[]
 }
 const [wallsStep,bedStep,finishStep]=await plan(owner,project,['Frame the walls','Build the bunk bed','Finish'])
 const [foreignStep]=await plan(outsider,other,['Other work'])
 const solution=randomUUID()
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Cabin',description:'Concept',assumptions:'Unverified',tradeoffs:'Simple',measurements:[]})])
 await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Use design'})])
 const target=(await pg.query('select current_revision from bob.project_targets where project_id=$1',[project])).rows[0].current_revision
 const raw=async(sql:string,args:unknown[])=>{await pg.exec('set session_replication_role=replica');try{await pg.query(sql,args)}finally{await pg.exec('set session_replication_role=origin')}}
 const piece=async(title:string,size:number)=>{
  const id=randomUUID()
  await call(owner,'bob.artifact_command',[project,'create',id,0,JSON.stringify({title,description:'Piece',kind:'plan',status:'concept',assumptions:'Concept',source_media_id:null,measurements:[],target_revision:target})])
  await raw(`insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,1,$3,$4,'{}')`,
   [project,id,JSON.stringify({contract_version:1,units:'mm'}),JSON.stringify({bounding_box_mm:{min:[0,0,0],max:[size,size/2,size/4],size:[size,size/2,size/4]}})])
  return id
 }
 const room=await piece('Bedroom walls',4000),bed=await piece('Bunk bed',2000),shelf=await piece('Shelf',800)
 const need=(artifact:string,name:string,unit:string,qty:string)=>call(owner,'bob.material_requirement_command',[project,'create',randomUUID(),0,JSON.stringify({
  name,category:'Timber',area_id:null,task_id:null,unit,required_quantity:qty,waste_percent:'0',purchase_increment:'1',basis:'Counted from the saved piece.',assumptions:'',
  artifact_id:artifact,artifact_revision:1,target_revision:target,stock_allocations:[],component_allocations:[]})])
 await need(room,'Studs 45x95','pcs','10');await need(room,'Plasterboard','m2','12.5');await need(bed,'studs 45x95','pcs','4')

 const shell=randomUUID(),comp=(key:string,id:string)=>({component_key:key,child_artifact_id:id,child_revision:null,x_mm:0,y_mm:0,z_mm:0,rz:0,placement_basis:'shared_origin',reason:'Planned together'})
 await call(owner,'bob.cad_shell_command',[project,'create',shell,0,JSON.stringify({title:'Cabin',description:'Whole cabin',assumptions:'Concept',area_id:null,
  components:[comp('room',room),comp('bed',bed),comp('bed_2',bed),comp('shelf',shelf)]})])
 const read=()=>call(owner,'bob.read_cad_shell',[project,shell,null])
 const before=await read()
 assert.deepEqual(before.components.map((c:any)=>[c.component_key,c.steps.length]),[['bed',0],['bed_2',0],['room',0],['shelf',0]],'pieces keep their key order and have no Steps yet')
 assert.deepEqual(before.plan_summary.not_in_plan,['bed','bed_2','room','shelf'])
 assert.deepEqual(before.plan_summary.not_counted,['shelf'],'a piece with no requirement is not counted, never zero')
 assert.deepEqual(before.plan_summary.counted_once,[{component_key:'bed_2',counted_with:'bed'}],'a piece placed twice is counted once and named')
 assert.equal(before.plan_summary.counted_pieces,2)
 assert.deepEqual(before.plan_summary.totals.map((x:any)=>[x.name.toLowerCase(),x.unit,Number(x.required_quantity),x.lines,x.pieces,x.needs_review]),
  [['plasterboard','m2',12.5,1,['room'],0],['studs 45x95','pcs',14,2,['bed','room'],0]])
 assert.equal(before.components.find((c:any)=>c.component_key==='shelf').materials.length,0)

 await t.test('Bob links several pieces to plan Steps in one claimed-turn write',async()=>{
  const message='Put each piece of the cabin into the build plan.',turn=randomUUID()
  const claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
  const write=(p:unknown,uid=owner)=>call(uid,'bob.bob_project_write_v16',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
  const payload={kind:'cad_shell_steps',record_id:shell,expected_updated_at:null,expected_revision:1,request_quote:'into the build plan',
   data:{links:[{component_key:'room',step_id:wallsStep,action:'link'},{component_key:'bed',step_id:bedStep,action:'link'},{component_key:'room',step_id:finishStep,action:'link'}]}}
  const receipt=await write(payload)
  assert.deepEqual([receipt.dataset,receipt.operation,receipt.revision,receipt.recordId],['artifacts','updated',1,shell],'the shell revision does not change')
  assert.deepEqual(await write(payload),receipt,'replay returns the same receipt')
  const byKey=Object.fromEntries(receipt.record.components.map((c:any)=>[c.component_key,c.steps.map((s:any)=>[s.position,s.title])]))
  assert.deepEqual(byKey,{bed:[[2,'Build the bunk bed']],bed_2:[[2,'Build the bunk bed']],room:[[1,'Frame the walls'],[3,'Finish']],shelf:[]})
  assert.deepEqual(receipt.record.plan_summary.not_in_plan,['shelf'])
  // Same seam as link_project_drawing: the links are the pieces' own drawing links.
  const links=(await asProjectUser(pg,owner,'select artifact_id,step_title from bob.current_drawing_steps where project_id=$1 order by step_title',[project])).rows
  assert.deepEqual(links.map((l:any)=>[l.artifact_id,l.step_title]),[[bed,'Build the bunk bed'],[room,'Finish'],[room,'Frame the walls']])

  await assert.rejects(write({...payload,data:{links:[{component_key:'sofa',step_id:wallsStep,action:'link'}]}}),/cad_shell_unknown_component/)
  await assert.rejects(write({...payload,data:{links:[{component_key:'shelf',step_id:foreignStep,action:'link'}]}}),/cad_shell_step_unavailable/,'another project\'s Step cannot be linked')
  await assert.rejects(write({...payload,expected_revision:2,data:{links:[{component_key:'shelf',step_id:finishStep,action:'link'}]}}),/cad_shell_changed/)
  await assert.rejects(write({...payload,request_quote:'never said',data:{links:[{component_key:'shelf',step_id:finishStep,action:'link'}]}}),/request_quote_required/)
  await assert.rejects(write({...payload,data:{links:[{component_key:'shelf',step_id:finishStep,action:'link'},{component_key:'shelf',step_id:finishStep,action:'unlink'}]}}),/cad_shell_invalid/)
  await assert.rejects(write({...payload,data:{links:[{component_key:'shelf',step_id:finishStep,action:'link'}]}},outsider),/project_denied/,'an outsider cannot write through the owner\'s turn')

  const unlinked=await write({...payload,data:{links:[{component_key:'room',step_id:finishStep,action:'unlink'},{component_key:'shelf',step_id:finishStep,action:'link'}]}})
  assert.deepEqual(unlinked.record.components.find((c:any)=>c.component_key==='room').steps.map((s:any)=>s.title),['Frame the walls'])
  assert.deepEqual(unlinked.record.plan_summary.not_in_plan,[])
 })

 await t.test('a requirement from another version of the piece is flagged, not hidden',async()=>{
  await raw(`insert into bob.artifact_revisions select (jsonb_populate_record(r,jsonb_build_object('revision',2,'change_note','Wider bed'))).* from bob.artifact_revisions r where artifact_id=$1 and revision=1`,[bed])
  await raw('update bob.artifacts set current_revision=2 where id=$1',[bed])
  const now=await read()
  const studs=now.plan_summary.totals.find((x:any)=>x.unit==='pcs')
  assert.deepEqual([Number(studs.required_quantity),studs.needs_review],[14,1])
  assert.equal(now.components.find((c:any)=>c.component_key==='bed').materials[0].needs_review,true)
  await assert.rejects(call(outsider,'bob.read_cad_shell',[project,shell,null]),/project_denied/)
 })
})
