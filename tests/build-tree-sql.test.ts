import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

// Owner decisions 2026-11-01: the tree follows the house; a shell is the sub-build,
// holds constructions and drawings, nests two levels and belongs to a room.
// A build with no room is in Snickeriet (no row).
test('builds are placed in rooms and sub-builds through one command, and read back as one tree',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID()
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const json=JSON.stringify
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'tree-owner@example.test',outsider,'tree-other@example.test'])
 const project=(await call(owner,'bob.create_project',[json({name:'Tree fixture'})])).id
 const other=(await call(outsider,'bob.create_project',[json({name:'Other tree fixture'})])).id
 for(const [uid,p] of [[owner,project],[outsider,other]]){
  const solution=randomUUID()
  await call(uid,'bob.solution_command',[p,'create',solution,0,json({area_id:null,title:'House',description:'Concept',assumptions:'Unverified',tradeoffs:'Simple',measurements:[]})])
  await call(uid,'bob.solution_command',[p,'select',solution,0,json({solution_revision:1,reason:'Use design'})])
 }
 const target=async(p:string)=>(await pg.query('select current_revision from bob.project_targets where project_id=$1',[p])).rows[0]?.current_revision??null
 const raw=async(sql:string,args:unknown[])=>{await pg.exec('set session_replication_role=replica');try{await pg.query(sql,args)}finally{await pg.exec('set session_replication_role=origin')}}
 const artifact=async(uid:string,p:string,title:string)=>{
  const id=randomUUID()
  await call(uid,'bob.artifact_command',[p,'create',id,0,json({title,description:'Piece',kind:'plan',status:'concept',assumptions:'Concept',source_media_id:null,measurements:[],target_revision:await target(p)})])
  return id
 }
 const drawing=async(uid:string,p:string,title:string)=>{
  const id=await artifact(uid,p,title)
  await raw(`insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,1,$3,$4,'{}')`,
   [p,id,json({contract_version:1,units:'mm'}),json({bounding_box_mm:{min:[0,0,0],max:[100,100,100],size:[100,100,100]}})])
  return id
 }
 const construction=async(uid:string,p:string,title:string,parts:number)=>{
  const id=await artifact(uid,p,title)
  await raw(`insert into bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision,recipe,parameters,materials,joints,open_questions) values($1,$2,1,$3,'[]','[]','[]','[]')`,
   [p,id,json({instances:Array.from({length:parts},(_,i)=>({id:'p'+i}))})])
  return id
 }
 const shell=async(uid:string,p:string,title:string,piece:string)=>{
  const id=randomUUID()
  await call(uid,'bob.cad_shell_command',[p,'create',id,0,json({title,description:title,assumptions:'Concept',area_id:null,
   components:[{component_key:'piece',child_artifact_id:piece,child_revision:null,x_mm:0,y_mm:0,z_mm:0,rz:0,placement_basis:'shared_origin',reason:'Together'}]})])
  return id
 }
 // A house with two floors, linked to the project.
 const as=(sql:string,args:unknown[])=>asProjectUser(pg,owner,sql,args)
 const house=randomUUID(),ground=randomUUID(),upper=randomUUID(),kids=randomUUID(),office=randomUUID(),loft=randomUUID()
 await as('select bob.physical_building_command($1,$2,0,$3)',['create',house,json({name:'House',notes:'Tree fixture'})])
 await as('select bob.physical_node_command($1,$2,$3,$4,0,$5)',[house,'level','create',ground,json({name:'Ground floor',position:0})])
 await as('select bob.physical_node_command($1,$2,$3,$4,0,$5)',[house,'level','create',upper,json({name:'Upper floor',position:1})])
 for(const [id,name,level] of [[kids,'Children room',upper],[office,'Office',ground]] as const)
  await as('select bob.physical_node_command($1,$2,$3,$4,0,$5)',[house,'space','create',id,json({name,kind:'room',level_id:level,truth:'unknown',measurements:[]})])
 await as('select bob.physical_scope_command($1,$2,$3,$4,$5)',[project,'project','link',randomUUID(),json({target_kind:'building',building_id:house})])
 // A room of a building the project does not link.
 const shed=randomUUID()
 await as('select bob.physical_building_command($1,$2,0,$3)',['create',shed,json({name:'Shed',notes:'Not linked'})])
 await as('select bob.physical_node_command($1,$2,$3,$4,0,$5)',[shed,'space','create',loft,json({name:'Loft',kind:'room',level_id:null,truth:'unknown',measurements:[]})])

 const bunk=await construction(owner,project,'Bunk bed',70),ladder=await construction(owner,project,'Ladder',9)
 const sketch=await drawing(owner,project,'Bed sketch'),desk=await drawing(owner,project,'Desk')
 const bedroom=await shell(owner,project,'Bedroom furniture',sketch),beds=await shell(owner,project,'Beds',desk),deep=await shell(owner,project,'Too deep',desk)
 const foreign=await construction(outsider,other,'Foreign shelf',3)
 const place=(id:string,parent:string|null,space:string|null,uid=owner,p=project)=>call(uid,'bob.place_build',[p,id,parent,space])

 // Everything starts in Snickeriet.
 let tree=await call(owner,'bob.read_build_tree',[project])
 assert.deepEqual(tree.spaces.map((s:any)=>[s.name,s.level_name,s.building_name]),[['Office','Ground floor','House'],['Children room','Upper floor','House']])
 assert(tree.builds.every((b:any)=>b.parent_id===null&&b.space_id===null))
 assert.deepEqual(Object.fromEntries(tree.builds.map((b:any)=>[b.title,b.kind])),{'Bed sketch':'drawing','Bedroom furniture':'sub_build','Beds':'sub_build','Bunk bed':'construction','Desk':'drawing','Ladder':'construction','Too deep':'sub_build'})
 assert.equal(tree.builds.find((b:any)=>b.title==='Bunk bed').parts,70)
 assert.deepEqual(tree.builds.find((b:any)=>b.title==='Bed sketch').in_sub_builds,[bedroom],'pieces a sub-build pins are named')

 // A sub-build in a room; a sub-build inside it; constructions inside both.
 assert.deepEqual(await place(bedroom,null,kids),{status:'saved',id:bedroom,kind:'sub_build',parent_id:null,space_id:kids,place:'room'})
 await place(beds,bedroom,null)
 await place(bunk,beds,null)
 await place(ladder,bedroom,null)
 tree=await call(owner,'bob.read_build_tree',[project])
 const at=(title:string)=>tree.builds.find((b:any)=>b.title===title)
 assert.deepEqual([at('Bedroom furniture').space_id,at('Beds').parent_id,at('Bunk bed').parent_id,at('Ladder').parent_id],[kids,bedroom,beds,bedroom])

 // Two levels of sub-builds, never three; no cycles.
 await assert.rejects(place(deep,beds,null),/build_nesting_limit/)
 await assert.rejects(place(bedroom,beds,null),/build_nesting_limit/)
 await assert.rejects(place(bedroom,bedroom,null),/build_invalid/)
 await assert.rejects(place(bunk,ladder,null),/build_parent_not_sub_build/,'only a sub-build holds builds')
 await assert.rejects(place(bunk,beds,kids),/build_space_from_parent/)
 // Rooms of buildings the project does not link, and other projects, are refused.
 await assert.rejects(place(deep,null,loft),/build_space_unavailable/)
 await assert.rejects(place(foreign,beds,null),/build_unavailable/)
 await assert.rejects(place(bunk,null,kids,outsider),/project_denied/)
 await assert.rejects(call(outsider,'bob.read_build_tree',[project]),/project_denied/)
 await assert.rejects(place(bunk,null,office,owner,other),/project_denied/)
 await assert.rejects(asProjectUser(pg,owner,'insert into bob.build_placements values($1,$2,null,$3,$4,now())',[bunk,project,office,owner]),/permission denied/)

 // Moving a build moves it alone; back to Snickeriet removes its row.
 await place(ladder,null,office)
 assert.deepEqual(await place(ladder,null,null),{status:'saved',id:ladder,kind:'construction',parent_id:null,space_id:null,place:'workshop'})
 assert.equal((await pg.query('select count(*)::int n from bob.build_placements where artifact_id=$1',[ladder])).rows[0].n,0)

 // An archived build leaves the tree and cannot be placed.
 const deepRevision=(await pg.query('select current_revision from bob.artifacts where id=$1',[deep])).rows[0].current_revision
 await call(owner,'bob.artifact_command',[project,'archive',deep,deepRevision,'{}'])
 tree=await call(owner,'bob.read_build_tree',[project])
 assert(!tree.builds.some((b:any)=>b.id===deep))
 await assert.rejects(place(deep,null,office),/build_archived/)
})
