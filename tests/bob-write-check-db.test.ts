import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import type {PGlite} from './support/pglite.ts'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {manufacturePolicy} from './support/construction-instance-policy-fixture.ts'

// Owner decision 2026-11-07 (sketchbook, design A): a write is checked by the
// database first. The same write function runs in a subtransaction that is
// rolled back on purpose; every rule and trigger answers, nothing remains.
let pg:PGlite,owner:string,stranger:string
const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
 (await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
const service=(name:string,args:unknown[])=>call(null,'bob.'+name,args,'service_role')
before(async()=>{
 pg=await projectSchema(async(db,name)=>{
  if(name==='20260924120448_bob_background_jobs.sql')await db.exec(`create schema cron;create schema net;
   create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';`)
 })
 owner=randomUUID();stranger=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'owner@test.invalid',stranger,'stranger@test.invalid'])
})
after(()=>pg.close())

const counts=async(project:string)=>(await pg.query<any>(`select
 (select count(*)::int from bob.artifacts where project_id=$1) artifacts,
 (select count(*)::int from bob.artifact_revisions where project_id=$1) revisions,
 (select count(*)::int from bob_private.bob_write_receipts where project_id=$1) receipts,
 (select count(*)::int from bob.construction_change_sets where project_id=$1) change_sets`,[project])).rows[0]

test('a checked construction save answers checked and leaves no artifact, revision, receipt or change set; the real save then works',async()=>{
 const project=(await call(owner,'bob.create_project',[{name:'Check fixture'}])).id,solution=randomUUID(),turn=randomUUID(),message='Develop the frame; check it before saving.'
 const {intent,recipe,refinement}=constructionFormFixture()
 await call(owner,'bob.solution_command',[project,'create',solution,0,{title:'Frame',description:'Synthetic',assumptions:'Not measured',tradeoffs:'Not approved',measurements:[],design_intent:intent}])
 const target=await call(owner,'bob.solution_command',[project,'select',solution,0,{solution_revision:1,reason:'Fixture'}])
 const c=await service('bob_claim_turn',[project,owner,turn,message])
 const args=(payload:unknown)=>[project,c.thread_id,turn,c.generation,payload]
 const material=await call(owner,'bob.bob_project_write_v17',args({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}}))
 const save=(targetRevision:number)=>({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'frame-'+targetRevision,title:'Frame',description:'Checkpoint',area_id:null,target_revision:targetRevision,change_note:'Initial',recipe,parameters:parameterPacket(project,recipe),materials:[{definition_id:'rail',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],instance_policy:manufacturePolicy(recipe),open_questions:[],form_refinement:refinement}})
 const before=await counts(project)

 const checked=await call(owner,'bob.bob_project_write_check',['bob_project_write_v17',...args(save(target.revision))])
 assert.deepEqual(checked,{status:'checked'})
 assert.deepEqual(await counts(project),before,'a check saves nothing: no artifact, revision, receipt or change set')

 const refused=await call(owner,'bob.bob_project_write_check',['bob_project_write_v17',...args(save(target.revision+5))])
 assert.equal(refused.status,'refused'); assert.match(refused.code,/^[0-9A-Z]{5}$/); assert.equal(typeof refused.message,'string')
 assert.deepEqual(await counts(project),before,'a refused check saves nothing either')

 // The same payload then saves for real, once.
 const saved=await call(owner,'bob.bob_project_write_v17',args(save(target.revision)))
 assert.equal(saved.dataset,'artifacts'); assert.equal(saved.revision,1)
 const after=await counts(project)
 assert.equal(after.artifacts,before.artifacts+1); assert.equal(after.receipts,before.receipts+1)
})

test('only the Bob write functions can be checked, only by an authorized caller of a claimed turn',async()=>{
 const project=(await call(owner,'bob.create_project',[{name:'Check guard'}])).id,turn=randomUUID(),message='Guard the check.'
 const c=await service('bob_claim_turn',[project,owner,turn,message])
 const payload={kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{}}
 await assert.rejects(call(owner,'bob.bob_project_write_check',['create_project',project,c.thread_id,turn,c.generation,payload]),/write_check_function_invalid/)
 await assert.rejects(call(null,'bob.bob_project_write_check',['bob_project_write_v17',project,c.thread_id,turn,c.generation,payload],'anon'),/permission denied/)
 // A stranger is refused by the write function itself, inside the check.
 const strangerCheck=await call(stranger,'bob.bob_project_write_check',['bob_project_write_v17',project,c.thread_id,turn,c.generation,payload])
 assert.equal(strangerCheck.status,'refused')
})
