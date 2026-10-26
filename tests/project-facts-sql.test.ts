// Project facts at turn start (owner decision 2026-10-26): one bounded,
// caller-scoped read of pure project facts for Bob. Every list says how much it
// left out, and no part of it runs the live drawing source assessment.
import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from './support/pglite.ts'

let pg:PGlite
const owner=randomUUID(),outsider=randomUUID(),member=randomUUID()
const P:Record<'A'|'B'|'D'|'E',string>={A:'',B:'',D:'',E:''}
const ids={house:randomUUID(),barn:randomUUID(),shed:randomUUID(),barnrum:randomUUID(),hall:randomUUID(),kitchen:randomUUID(),
 constructions:Array.from({length:10},()=>randomUUID()),archived:randomUUID(),otherConstruction:randomUUID(),
 pinned:randomUUID(),stale:randomUUID(),unstored:randomUUID(),unassessed:randomUUID(),plan:randomUUID(),otherDrawing:randomUUID(),
 requests:Array.from({length:8},()=>randomUUID()),otherRequest:randomUUID(),
 req:Array.from({length:8},()=>randomUUID()),otherReq:randomUUID()}
const newest=()=>ids.constructions[9],noPolicy=()=>ids.constructions[8]

const box=(id:string,x:number,y:number,z:number)=>({id,primitive:'box',material_ref:null,x_mm:x,y_mm:y,z_mm:z})
const at=(id:string,definition_id:string,x=0,y=0,z=0)=>({id,definition_id,placement:{x,y,z,rx:0,ry:0,rz:0}})
const joint=(id:string,method:string,first:[string,string],second:[string,string])=>
 ({id,method,first:{instance_id:first[0],face:first[1]},second:{instance_id:second[0],face:second[1]},reason:'Fixture joint'})
const shelf={definitions:[box('gable',18,300,800),box('shelf',564,300,18)],instances:[at('g','gable'),at('s','shelf',18,0,400)]}
const shelfJoints=[joint('screwed','screwed_butt',['g','x_max'],['s','x_min']),joint('glued','glued_butt',['g','x_max'],['s','x_min'])]

const facts=async(uid:string|null,project:string,role='authenticated')=>
 (await asProjectUser(pg,uid,'select bob.read_project_facts($1) f',[project],role)).rows[0].f as any
const call=async(uid:string,sql:string,args:unknown[])=>(await asProjectUser(pg,uid,sql,args)).rows[0] as any
const replica=async(work:()=>Promise<unknown>)=>{
 await pg.exec('set session_replication_role=replica')
 try{await work()}finally{await pg.exec('set session_replication_role=origin')}
}
const minutes=(n:number)=>new Date(Date.UTC(2026,9,26,8,n)).toISOString()

async function artifact(project:string,id:string,title:string,minute:number,archived=false){
 await pg.query('insert into bob.artifacts(id,project_id,area_id,current_revision) values($1,$2,null,1)',[id,project])
 await pg.query(`insert into bob.artifact_revisions(artifact_id,project_id,revision,kind,title,description,status,target_revision,solution_id,solution_revision,
  solution_title,archived,change_note,recorded_by,actor_label,recorded_at) values($1,$2,1,'detail',$3,'Fixture','concept',1,$4,1,'Fixture',$5,'Saved',$6,'Fixture',$7)`,
  [id,project,title,randomUUID(),archived,owner,minutes(minute)])
}
async function construction(project:string,id:string,title:string,minute:number,openQuestions:unknown[]=[],archived=false){
 await artifact(project,id,title,minute,archived)
 await pg.query(`insert into bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision,recipe,parameters,materials,joints,open_questions)
  values($1,$2,1,$3,'{}','[]',$4,$5)`,[project,id,JSON.stringify(shelf),JSON.stringify(shelfJoints),JSON.stringify(openQuestions)])
}
async function drawing(project:string,id:string,title:string,minute:number){
 await artifact(project,id,title,minute)
 await pg.query(`insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,1,'{"units":"mm","contract_version":"1"}','{}','{}')`,[project,id])
}
async function requirement(project:string,id:string,name:string,o:{purchase?:number;target?:number;artifact?:string|null;archived?:boolean;unit?:string}={}){
 await pg.query('insert into bob.material_requirements(id,project_id,current_revision) values($1,$2,1)',[id,project])
 await pg.query(`insert into bob.material_requirement_revisions(requirement_id,project_id,revision,name,category,unit,required_quantity,waste_percent,purchase_increment,
  required_with_waste,stock_quantity,component_quantity,purchase_quantity,source_kind,method_key,method_version,basis,assumptions,artifact_id,artifact_revision,artifact_title,
  target_revision,solution_id,solution_revision,solution_title,archived,change_note,recorded_by,actor_label)
  values($1,$2,1,$3,'Fixture',$4,10,0,1,10,0,0,$5,'manual','manual','1','Fixture basis','',$6,$7,$8,$9,$10,1,'Fixture',$11,'Saved',$12,'Fixture')`,
  [id,project,name,o.unit??'pcs',o.purchase??10,o.artifact??null,o.artifact?1:null,o.artifact?'Construction':'',o.target??1,randomUUID(),o.archived??false,owner])
}

before(async()=>{
 pg=await projectSchema()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'facts-owner@example.test',outsider,'facts-other@example.test',member,'facts-member@example.test'])
 for(const [key,uid] of [['A',owner],['B',outsider],['D',owner],['E',owner]] as const)
  P[key]=(await call(uid,'select bob.create_project($1) r',[JSON.stringify({name:'Facts '+key})])).r.id
 // A plain member of A: neither project creator nor Building editor.
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values('facts-member',$1,'Member','ME',$2)",[P.A,member])

 // Rooms. A links a house and marks Barnrum; D links an empty barn; E links nothing; B has its own shed.
 const building=(uid:string,id:string,name:string)=>call(uid,'select bob.physical_building_command($1,$2,$3,$4) r',['create',id,0,JSON.stringify({name,notes:''})])
 const space=(uid:string,b:string,action:string,id:string,expected:number,body:unknown)=>
  call(uid,'select bob.physical_node_command($1,$2,$3,$4,$5,$6) r',[b,'space',action,id,expected,JSON.stringify(body)])
 const link=(uid:string,project:string,body:unknown)=>call(uid,"select bob.physical_scope_command($1,'project','link',$2,$3) r",[project,randomUUID(),JSON.stringify(body)])
 await building(owner,ids.house,'House')
 await building(owner,ids.barn,'Empty barn')
 await building(outsider,ids.shed,'Shed')
 await space(owner,ids.house,'create',ids.barnrum,0,{name:'Barnrum',kind:'bedroom',truth:'unknown',measurements:[]})
 await space(owner,ids.house,'create',ids.hall,0,{name:'Hall',kind:'hall',truth:'unknown',measurements:[]})
 await space(outsider,ids.shed,'create',ids.kitchen,0,{name:'Kök',kind:'kitchen',truth:'unknown',measurements:[]})
 await link(owner,P.A,{target_kind:'building',building_id:ids.house})
 await link(owner,P.A,{target_kind:'space',building_id:ids.house,space_id:ids.barnrum})
 await link(owner,P.D,{target_kind:'building',building_id:ids.barn})
 await link(outsider,P.B,{target_kind:'building',building_id:ids.shed})
 const measured=[['room_length',3970],['room_width',2700],['ceiling_height',1920],['ceiling_height',1950],['wall_length',3970,'N']] as const
 const links=[]
 for(const [property,value,side] of measured){
  const id=randomUUID()
  await call(owner,"select bob.evidence_command($1,'measurement','create',$2,0,$3) r",[P.A,id,JSON.stringify({subject:'Barnrum '+property,value:String(value),unit:'mm',
   truth:'measured',source:'Laser',required:false,property,...(side?{side}:{})})])
  links.push({id,revision:1})
 }
 await space(owner,ids.house,'revise',ids.barnrum,1,{name:'Barnrum',kind:'bedroom',truth:'unknown',change_note:'Measured',measurements:links})

 await replica(async()=>{
  // Ten current constructions (newest has a role policy and open questions), one archived; one in B.
  for(let i=0;i<10;i++)await construction(P.A,ids.constructions[i],'Construction '+i,10+i,i===9?['Which screws?','Glue brand?']:[])
  await pg.query('insert into bob.artifact_construction_instance_policies values($1,$2,1,$3)',[P.A,newest(),JSON.stringify({version:1,instances:[
   {instance_id:'g',role:'build_part',quantity_policy:'manufacture',reason:'New'},{instance_id:'s',role:'unknown',quantity_policy:'unknown',reason:'Not recorded'}]})])
  await construction(P.A,ids.archived,'Archived construction',30,[],true)
  await construction(P.B,ids.otherConstruction,'Other project construction',40)
  // Drawings: pinned to the newest construction, stale, unstored, stored without a state; one plain artifact; one in B.
  await drawing(P.A,ids.pinned,'Pinned drawing',25)
  await pg.query('insert into bob.artifact_construction_drawings values($1,$2,1,$3,1)',[P.A,ids.pinned,newest()])
  await drawing(P.A,ids.stale,'Stale drawing',24)
  await drawing(P.A,ids.unstored,'Unstored drawing',23)
  await drawing(P.A,ids.unassessed,'Unassessed drawing',22)
  await artifact(P.A,ids.plan,'Hand plan',21)
  await drawing(P.B,ids.otherDrawing,'Other project drawing',41)
  // Drawing requests: six open, one saved, one cancelled; one open in B.
  const statuses=['needs_data','collecting','paused','ready_to_design','draft','reviewed','saved','cancelled']
  for(const [i,status] of statuses.entries())
   await pg.query(`insert into bob_private.project_drawing_requests(id,project_id,owner_user_id,status,scope,updated_at) values($1,$2,$3,$4,'{}',$5)`,
    [ids.requests[i],P.A,owner,status,minutes(50-i)])
  await pg.query(`insert into bob_private.project_drawing_requests(id,project_id,owner_user_id,status,scope) values($1,$2,$3,'needs_data','{}')`,[ids.otherRequest,P.B,outsider])
  await pg.query(`insert into bob_private.drawing_gaps(request_id,project_id,requirement_key,action,blocking,observed_revision)
   values($1,$2,'width','measurement',true,1),($1,$2,'finish','owner_decision',true,1),($1,$2,'old','none',false,1)`,[ids.requests[0],P.A])
  // Material needs: Shopping link, fastener, glue, changed target, archived, pack purchase, cut plan; one need in B.
  await pg.query('insert into bob.project_targets(project_id,current_revision) values($1,1),($2,1)',[P.A,P.B])
  const [linked,screws,glue,changed,archived,packed,cut]=ids.req
  await requirement(P.A,linked,'Boards')
  await pg.query(`insert into bob.materials(id,project_id,name,status) values('m-boards',$1,'Boards','ordered'),('m-pack',$1,'Screw pack','delivered'),('m-other',$2,'Other','needed')`,[P.A,P.B])
  await pg.query(`insert into bob.material_requirement_shopping(requirement_id,project_id,material_id,synced_requirement_revision,synced_name,synced_qty,synced_area_label,
   synced_category,recorded_by,actor_label) values($1,$2,'m-boards',1,'Boards','10 pcs','','Fixture',$3,'Fixture')`,[linked,P.A,owner])
  await requirement(P.A,screws,'Screws',{artifact:noPolicy()})
  await requirement(P.A,glue,'Glue',{artifact:newest(),purchase:0})
  for(const [id,artifactId,kind] of [[screws,noPolicy(),'screw'],[glue,newest(),'glue']] as const)
   await pg.query(`insert into bob.material_requirement_fastener_sources values($1,$2,1,$3,1,'fastener-rules-v1',$4,$5,$6,$7,'[]',true)`,
    [P.A,id,artifactId,kind,kind==='glue'?null:4,kind==='glue'?null:45,kind==='glue'?1:3])
  await requirement(P.A,changed,'Paint',{target:2,unit:'l'})
  await requirement(P.A,archived,'Old paint',{archived:true})
  await requirement(P.A,packed,'Pack screws')
  const article=randomUUID()
  await pg.query(`insert into bob.pack_purchases(article_id,project_id,current_revision,material_id) values($1,$2,1,'m-pack')`,[article,P.A])
  await pg.query(`insert into bob.pack_purchase_revisions(article_id,project_id,revision,article_revision,published,total_quantity,content_unit,purchase_unit,change_note,recorded_by,actor_label)
   values($1,$2,1,1,true,10,'pcs','pack','Published',$3,'Fixture')`,[article,P.A,owner])
  await pg.query('insert into bob.pack_purchase_needs values($1,$2,1,$3,1,10)',[article,P.A,packed])
  await requirement(P.A,cut,'Plywood blank')
  const plan=randomUUID()
  await pg.query('insert into bob.material_cut_plan_requirements values($1,$2,3,$3,1)',[P.A,plan,cut])
  await pg.query('insert into bob.cut_plan_shopping values($1,$2,2)',[plan,P.A])
  await pg.query(`insert into bob.cut_plan_shopping_revisions values($1,$2,2,3,true,'Published',$3,'Fixture',now())`,[plan,P.A,owner])
  await pg.query('insert into bob.project_targets(project_id,current_revision) values($1,1) on conflict do nothing',[P.B])
  await requirement(P.B,ids.otherReq,'Other need')
  // Stored source status: fresh rows at the project's current counter, one stale row.
  await pg.query('insert into bob.artifact_source_epochs(project_id,seq) values($1,7) on conflict(project_id) do update set seq=7',[P.A])
  await pg.query(`insert into bob.artifact_source_states(project_id,artifact_id,revision,source_state,source_reasons,computed_seq)
   values($1,$2,1,'current','{}',7),($1,$3,1,'current','{}',6),($1,$4,1,null,null,7),($1,$5,1,'current','{}',7)`,[P.A,ids.pinned,ids.stale,ids.unassessed,newest()])
 })
})
after(()=>pg?.close())

test('a member reads the facts; an outsider, anon and other client roles are refused',async()=>{
 const f=await facts(owner,P.A)
 assert.equal(f.status,'ok');assert.equal(f.version,1);assert.equal(f.project_id,P.A);assert.ok(f.as_of)
 assert.deepEqual(Object.keys(f).sort(),['as_of','constructions','drawing_requests','drawings','materials','project_id','rooms','status','version'])
 assert.deepEqual({...await facts(member,P.A),as_of:null},{...f,as_of:null},'a plain member reads the same facts under row security')
 await assert.rejects(facts(member,P.B),/project_denied/)
 await assert.rejects(facts(outsider,P.A),/project_denied/)
 await assert.rejects(facts(null,P.A),/project_denied/)
 await assert.rejects(facts(null,P.A,'anon'),/permission denied/)
 await assert.rejects(facts(owner,P.A,'service_role'),/permission denied/)
 const acl=(await pg.query(`select p.proname,p.prosecdef,p.provolatile,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,
  has_function_privilege('service_role',p.oid,'execute') service,has_function_privilege('authenticated',p.oid,'execute') member
  from pg_proc p where p.oid in ('bob.read_project_facts(text)'::regprocedure,'bob_private.project_facts_drawing_requests(text)'::regprocedure) order by 1`)).rows
 assert.deepEqual(acl,[
  {proname:'project_facts_drawing_requests',prosecdef:true,provolatile:'s',proconfig:['search_path=""'],anon:false,service:false,member:true},
  {proname:'read_project_facts',prosecdef:false,provolatile:'s',proconfig:['search_path=""'],anon:false,service:false,member:true}])
 await assert.rejects(asProjectUser(pg,outsider,'select bob_private.project_facts_drawing_requests($1)',[P.A]),/project_denied/)
})

test('rooms: not linked, linked without rooms, and rooms with their stored dimensions',async()=>{
 const empty={total:0,included:0,omitted:0,items:[]}
 assert.deepEqual((await facts(owner,P.E)).rooms,{status:'not_linked',linked_buildings:0,...empty})
 assert.deepEqual((await facts(owner,P.D)).rooms,{status:'ok',linked_buildings:1,...empty})
 // Room-level scope without a whole Building (the live Barnrum project): listed, never "not linked".
 const F=(await call(owner,'select bob.create_project($1) r',[JSON.stringify({name:'Facts F'})])).r.id
 // A legacy room-only row, as live Barnrum has; today's command requires the Building link first.
 await pg.query("set session_replication_role=replica")
 await pg.query("insert into bob.project_physical_scope(id,project_id,target_kind,building_id,space_id,created_by) values($1,$2,'space',$3,$4,$5)",[randomUUID(),F,ids.house,ids.barnrum,owner])
 await pg.query("set session_replication_role=origin")
 const roomsOnly=(await facts(owner,F)).rooms
 assert.equal(roomsOnly.status,'rooms_only');assert.equal(roomsOnly.linked_buildings,0)
 assert.deepEqual(roomsOnly.items.map((r:any)=>[r.name,r.marked]),[['Barnrum',true]])
 const rooms=(await facts(owner,P.A)).rooms
 assert.equal(rooms.status,'ok');assert.equal(rooms.linked_buildings,1)
 assert.deepEqual([rooms.total,rooms.included,rooms.omitted],[2,2,0])
 const [barnrum,hall]=rooms.items
 assert.deepEqual({...barnrum,dimensions:undefined},{room_id:ids.barnrum,name:'Barnrum',building_id:ids.house,building:'House',marked:true,
  length_mm:3970,width_mm:2700,height_mm:null,dimensions:undefined,other_dimensions:1})
 assert.deepEqual(barnrum.dimensions,{
  room_length:{status:'known',truth:'measured',millimetres:3970,conflict_millimetres:null},
  room_width:{status:'known',truth:'measured',millimetres:2700,conflict_millimetres:null},
  ceiling_height:{status:'conflict',truth:'measured',millimetres:null,conflict_millimetres:[1920,1950]}})
 // The view is the source: the same statuses and values per property.
 const view=(await asProjectUser(pg,owner,`select property,status,truth,millimetres from bob.project_room_dimensions
  where project_id=$1 and space_id=$2 and side is null and reference is null order by property`,[P.A,ids.barnrum])).rows as any[]
 for(const row of view)assert.deepEqual([barnrum.dimensions[row.property].status,barnrum.dimensions[row.property].truth,barnrum.dimensions[row.property].millimetres],
  [row.status,row.truth,row.millimetres===null?null:Number(row.millimetres)],row.property)
 assert.equal(hall.name,'Hall');assert.equal(hall.marked,false);assert.equal(hall.length_mm,null);assert.equal(hall.other_dimensions,0)
 assert.deepEqual(Object.values(hall.dimensions).map((d:any)=>d.status),['unknown','unknown','unknown'])
})

test('constructions: newest eight of ten, roles, open questions and the fastener schedule',async()=>{
 const c=(await facts(owner,P.A)).constructions
 assert.deepEqual([c.total,c.included,c.omitted],[10,8,2],'the archived construction is not counted; two are left out')
 assert.deepEqual(c.items.map((i:any)=>i.artifact_id),ids.constructions.slice(2).reverse(),'newest first')
 const [first,second]=c.items
 assert.deepEqual({...first,fasteners:undefined},{artifact_id:newest(),title:'Construction 9',revision:1,definitions:2,parts:2,joints:2,
  roles:{recorded:true,known:1,unknown:1},open_questions:2,fasteners:undefined})
 assert.deepEqual(second.roles,{recorded:false,known:0,unknown:2},'without a policy every part is unknown')
 assert.equal(second.open_questions,0)
 for(const item of c.items){
  const schedule=(await asProjectUser(pg,owner,`select bob_private.construction_fastener_schedule_for(c) s from bob.artifact_construction_revisions c
   where c.project_id=$1 and c.artifact_id=$2 and c.artifact_revision=$3`,[P.A,item.artifact_id,item.revision])).rows[0] as any
  assert.deepEqual(item.fasteners,{complete:schedule.s.complete,glue_packages:schedule.s.glue_packages,
   totals:schedule.s.totals.map(({kind,diameter_mm,length_mm,count}:any)=>({kind,diameter_mm,length_mm,count}))})
 }
 assert.deepEqual(first.fasteners,{complete:true,glue_packages:1,totals:[{kind:'screw',diameter_mm:4.0,length_mm:45,count:3}]})
})

test('drawings, drawing requests and material needs report stored facts with honest counts',async()=>{
 const f=await facts(owner,P.A)
 assert.deepEqual([f.drawings.total,f.drawings.included,f.drawings.omitted,f.drawings.other_artifacts],[4,4,0,1])
 assert.deepEqual(f.drawings.items.map((d:any)=>[d.artifact_id,d.construction,d.source_status]),[
  [ids.pinned,{artifact_id:newest(),revision:1},'current'],
  [ids.stale,null,'not_stored'],
  [ids.unstored,null,'not_stored'],
  [ids.unassessed,null,'not_assessed']])
 const r=f.drawing_requests
 assert.deepEqual([r.total,r.included,r.omitted],[6,5,1],'saved and cancelled requests are not open')
 assert.deepEqual(r.items.map((i:any)=>[i.request_id,i.status,i.gaps]),[
  [ids.requests[0],'needs_data',2],[ids.requests[1],'collecting',0],[ids.requests[2],'paused',0],[ids.requests[3],'ready_to_design',0],[ids.requests[4],'draft',0]])
 assert.deepEqual(f.materials,{total:6,
  by_state:{not_in_shopping:2,covered:1,needed:0,ordered:1,delivered:1,backorder:0,cut_plan_shopping:1,shopping_row_missing:0},
  changed:1,changed_unknown:1,fastener_needs:1,glue_needs:1,shopping_published:3})
})

test('no rows from another project reach the facts',async()=>{
 const text=JSON.stringify(await facts(owner,P.A))
 for(const id of [ids.shed,ids.kitchen,ids.otherConstruction,ids.otherDrawing,ids.otherRequest,ids.otherReq,'m-other',P.B])
  assert(!text.includes(id),id)
 const b=await facts(outsider,P.B)
 assert.deepEqual([b.rooms.total,b.constructions.total,b.drawings.total,b.drawing_requests.total,b.materials.total],[1,1,1,1,1])
 assert.equal(b.rooms.items[0].room_id,ids.kitchen)
 assert(!JSON.stringify(b).includes(P.A))
})

test('the reader never runs the live source assessment',async()=>{
 // Source: neither function names the assessment or a view that falls back to it.
 for(const fn of ['bob.read_project_facts(text)','bob_private.project_facts_drawing_requests(text)']){
  const body=(await pg.query<{d:string}>('select pg_get_functiondef($1::regprocedure) d',[fn])).rows[0].d
  assert.doesNotMatch(body.replace(/^ *--.*$/gm,''),/artifact_source_assessment|artifact_source_status|current_drawing_overview|material_requirement_shopping_state|drawing_request_work|artifact_changed/,fn)
 }
 // Runtime: with the assessment replaced by a tripwire, the views that fall
 // back to it fail on this fixture, and the reader still answers the same.
 const expected=await facts(owner,P.A)
 const original=(await pg.query<{d:string}>("select pg_get_functiondef('bob_private.artifact_source_assessment(text,uuid,integer)'::regprocedure) d")).rows[0].d
 await pg.exec(`create or replace function bob_private.artifact_source_assessment(p_project text,p_artifact uuid,p_revision integer)
  returns table(source_state text,source_reasons text[]) language plpgsql stable set search_path='' as $$ begin raise exception 'live_source_assessment'; end $$`)
 try{
  await assert.rejects(asProjectUser(pg,owner,'select count(*) from bob.current_drawing_overview where project_id=$1',[P.A]),/live_source_assessment/)
  await assert.rejects(asProjectUser(pg,owner,'select count(*) filter (where artifact_changed) from bob.current_material_requirements where project_id=$1',[P.A]),/live_source_assessment/)
  const actual=await facts(owner,P.A)
  assert.deepEqual({...actual,as_of:null},{...expected,as_of:null})
 }finally{await pg.exec(original)}
 assert.doesNotMatch((await pg.query<{d:string}>("select pg_get_functiondef('bob_private.artifact_source_assessment(text,uuid,integer)'::regprocedure) d")).rows[0].d,/live_source_assessment/)
})
