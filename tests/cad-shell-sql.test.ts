import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

test('shell drawing pins saved CAD pieces, moves them through one command and flags newer pieces',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID()
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'shell-owner@example.test',outsider,'shell-other@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Shell fixture'})])).id
 const other=(await call(outsider,'bob.create_project',[JSON.stringify({name:'Other shell fixture'})])).id
 for(const [uid,p] of [[owner,project],[outsider,other]]){
  const solution=randomUUID()
  await call(uid,'bob.solution_command',[p,'create',solution,0,JSON.stringify({area_id:null,title:'Cabin',description:'Concept',assumptions:'Unverified',tradeoffs:'Simple',measurements:[]})])
  await call(uid,'bob.solution_command',[p,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Use design'})])
 }
 const target=async(p:string)=>(await pg.query('select current_revision from bob.project_targets where project_id=$1',[p])).rows[0]?.current_revision??null
 // Saved CAD pieces: an artifact revision plus its CAD row (as the CAD writer would leave them).
 const piece=async(uid:string,p:string,title:string,size:number)=>{
  const id=randomUUID()
  await call(uid,'bob.artifact_command',[p,'create',id,0,JSON.stringify({title,description:'Piece',kind:'plan',status:'concept',assumptions:'Concept',source_media_id:null,measurements:[],target_revision:await target(p)})])
  await cadRow(p,id,1,size)
  return id
 }
 // Validation triggers belong to the CAD writer and are covered by its own tests; the fixture skips them.
 const raw=async(sql:string,args:unknown[])=>{await pg.exec('set session_replication_role=replica');try{await pg.query(sql,args)}finally{await pg.exec('set session_replication_role=origin')}}
 const cadRow=(p:string,id:string,rev:number,size:number)=>raw(`insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,$3,$4,$5,'{}')`,
  [p,id,rev,JSON.stringify({contract_version:1,units:'mm'}),JSON.stringify({bounding_box_mm:{min:[0,0,0],max:[size,size/2,size/4],size:[size,size/2,size/4]}})])
 const room=await piece(owner,project,'Bedroom',4000),bed=await piece(owner,project,'Bunk bed',2000),foreign=await piece(outsider,other,'Other bed',1000)
 const shell=randomUUID(),cmd=(uid:string,action:string,expected:number,data:unknown,id=shell,p=project)=>call(uid,'bob.cad_shell_command',[p,action,id,expected,JSON.stringify(data)])
 const comp=(key:string,id:string,extra:Record<string,unknown>={})=>({component_key:key,child_artifact_id:id,child_revision:null,x_mm:0,y_mm:0,z_mm:0,rz:0,placement_basis:'shared_origin',reason:'Planned together',...extra})
 const created=await cmd(owner,'create',0,{title:'Cabin',description:'Whole cabin',assumptions:'Concept',area_id:null,components:[comp('room',room),comp('bed',bed)]})
 assert.equal(created.revision,1)
 assert.deepEqual(created.components.map((c:any)=>[c.component_key,c.child_revision,c.status,c.bounding_box_mm.size[0]]),[['bed',1,'current',2000],['room',1,'current',4000]])

 const moved=await cmd(owner,'place',1,{component_key:'bed',x_mm:1200,y_mm:-300,z_mm:0,rz:90,placement_basis:'owner_placed',reason:'Against the north wall'})
 assert.equal(moved.revision,2)
 assert.deepEqual(moved.components.find((c:any)=>c.component_key==='bed'),{...moved.components.find((c:any)=>c.component_key==='bed'),x_mm:1200,y_mm:-300,rz:90,placement_basis:'owner_placed'})
 assert.equal((await call(owner,'bob.read_cad_shell',[project,shell,1])).components.find((c:any)=>c.component_key==='bed').x_mm,0,'old revision keeps old placement')

 await assert.rejects(cmd(owner,'place',1,{component_key:'bed',x_mm:0,y_mm:0,z_mm:0,rz:0,placement_basis:'owner_placed',reason:'Stale'}),/cad_shell_changed/)
 await assert.rejects(cmd(owner,'place',2,{component_key:'bed',x_mm:0,y_mm:0,z_mm:0,rz:45,placement_basis:'owner_placed',reason:'Tilted'}),/cad_shell_invalid_placement/)
 await assert.rejects(cmd(owner,'place',2,{component_key:'bed',x_mm:0,y_mm:0,z_mm:0,rz:0,placement_basis:'measured',reason:'Fake'}),/cad_shell_invalid_placement/)
 await assert.rejects(cmd(owner,'place',2,{component_key:'sofa',x_mm:0,y_mm:0,z_mm:0,rz:0,placement_basis:'owner_placed',reason:'Missing'}),/cad_shell_unknown_component/)
 await assert.rejects(cmd(owner,'add',2,{component:comp('stranger',foreign)}),/cad_shell_piece_unavailable/,'another project\'s piece cannot be placed')
 await assert.rejects(cmd(owner,'add',2,{component:comp('room',bed)}),/cad_shell_duplicate_key/)
 await assert.rejects(cmd(outsider,'place',2,{component_key:'bed',x_mm:0,y_mm:0,z_mm:0,rz:0,placement_basis:'owner_placed',reason:'Intruder'}),/project_denied/)
 await assert.rejects(call(outsider,'bob.read_cad_shell',[project,shell,null]),/project_denied/)
 await assert.rejects(cmd(owner,'place',2,{component_key:'bed',x_mm:0,y_mm:0,z_mm:0,rz:0,placement_basis:'owner_placed',reason:'Wrong project'},shell,other),/project_denied/)
 await assert.rejects(call(owner,'bob.artifact_command',[project,'revise',shell,2,'{}']),/use_cad_shell_command/)
 await assert.rejects(pg.query("update bob.artifact_cad_shell_components set x_mm=1 where shell_artifact_id=$1",[shell]),/cad_shell_revision_immutable/)
 await assert.rejects(asProjectUser(pg,owner,'insert into bob.artifact_cad_shell_components select * from bob.artifact_cad_shell_components limit 1'),/permission denied/)

 // A piece gets a newer saved revision: the shell flags it and adopt re-pins it.
 const bedRow=(await asProjectUser(pg,owner,'select title from bob.artifact_revisions where artifact_id=$1 and revision=1',[bed])).rows[0]
 await reviseRaw(pg,bed)
 await cadRow(project,bed,2,2100)
 const flagged=await call(owner,'bob.read_cad_shell',[project,shell,null])
 assert.equal(flagged.components.find((c:any)=>c.component_key==='bed').status,'newer_revision')
 assert.equal(bedRow.title,'Bunk bed')
 const adopted=await cmd(owner,'adopt',2,{component_key:'bed'})
 const bedNow=adopted.components.find((c:any)=>c.component_key==='bed')
 assert.deepEqual([adopted.revision,bedNow.child_revision,bedNow.status,bedNow.x_mm,bedNow.bounding_box_mm.size[0]],[3,2,'current',1200,2100])

 const removed=await cmd(owner,'remove',3,{component_key:'room'})
 assert.deepEqual(removed.components.map((c:any)=>c.component_key),['bed'])
 await assert.rejects(cmd(owner,'remove',4,{component_key:'bed'}),/cad_shell_invalid/,'a shell keeps at least one piece')

 await call(owner,'bob.artifact_command',[project,'archive',shell,4,'{}'])
 const archived=await call(owner,'bob.read_cad_shell',[project,shell,null])
 assert.deepEqual([archived.revision,archived.archived,archived.components.length],[5,true,1])
 await assert.rejects(cmd(owner,'place',5,{component_key:'bed',x_mm:0,y_mm:0,z_mm:0,rz:0,placement_basis:'owner_placed',reason:'Archived'}),/cad_shell_archived/)
 await call(owner,'bob.artifact_command',[project,'restore',shell,5,'{}'])
 assert.deepEqual((await call(owner,'bob.read_cad_shell',[project,shell,null])).components.map((c:any)=>[c.component_key,c.child_revision]),[['bed',2]])

 await t.test('Bob composes a shell through the claimed-turn writer with idempotent receipts',async()=>{
  const message='Put the bedroom and the bunk bed together in one cabin drawing.',turn=randomUUID()
  const claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
  const write=(p:unknown)=>call(owner,'bob.bob_project_write_v16',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
  const payload={kind:'cad_shell',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:'one cabin drawing',
   data:{action:'create',fields:{title:'Cabin by Bob',description:'Whole cabin',assumptions:'Pieces share one origin',area_id:null,components:[comp('room',room),comp('bed',bed)]}}}
  const receipt=await write(payload)
  assert.deepEqual([receipt.dataset,receipt.operation,receipt.revision,receipt.record.components.length],['artifacts','created',1,2])
  assert.deepEqual(await write(payload),receipt,'replay returns the same receipt')
  const moved=await write({...payload,record_id:receipt.recordId,expected_revision:1,data:{action:'place',fields:{component_key:'bed',x_mm:500,y_mm:0,z_mm:0,rz:180,placement_basis:'bob_decision',reason:'Door swing stays clear'}}})
  assert.deepEqual([moved.operation,moved.revision],['updated',2])
  await assert.rejects(write({...payload,request_quote:'never said'}),/request_quote_required/)
  await assert.rejects(write({...payload,data:{action:'create',fields:{...payload.data.fields,title:'Foreign',components:[comp('x',foreign)]}}}),/cad_shell_piece_unavailable/)
 })
})

// Stand-in for the CAD writer saving a newer revision of a piece.
async function reviseRaw(pg:any,id:string){
 await pg.exec('set session_replication_role=replica')
 await pg.query(`insert into bob.artifact_revisions select (jsonb_populate_record(r,jsonb_build_object('revision',2,'change_note','Wider bed'))).* from bob.artifact_revisions r where artifact_id=$1 and revision=1`,[id])
 await pg.query('update bob.artifacts set current_revision=2 where id=$1',[id])
 await pg.exec('set session_replication_role=origin')
}
