import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { seedToolPolicy } from '../supabase/functions/_shared/project-answer.ts'
import { createRecordDetailReader } from '../supabase/functions/_shared/project-record-detail.ts'

let pg:PGlite, project:string, otherProject:string, steps:string[], otherStep:string, drawing:string
const owner=randomUUID(),stranger=randomUUID(),message='Koppla ritningen till arbetet.'
const query=(uid:string|null,sql:string,args:unknown[]=[],role='authenticated')=>asProjectUser(pg,uid,sql,args,role)
const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
 (await query(uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
async function plan(pid:string,uid:string) {
 const draft=await call(uid,'bob_private.project_plan_propose',[pid,0,JSON.stringify({summary:'Build together',reason:'Requested',steps:['Frame','Drawers'].map(title=>({step_id:null,title,goal:title+' complete',state:'active',phase:'planning',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[]})),task_links:[]})],'postgres')
 return (await call(uid,'bob_private.project_plan_decide',[pid,0,draft.record.revision,'approve','Proceed'],'postgres')).record.steps.map((s:any)=>s.id)
}
before(async()=>{
 pg=await projectSchema()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'drawing-owner@example.test',stranger,'drawing-stranger@example.test'])
 project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Drawing work'})])).id
 otherProject=(await call(stranger,'bob.create_project',[JSON.stringify({name:'Other project'})])).id
 steps=await plan(project,owner);otherStep=(await plan(otherProject,stranger))[0]
 const solution=randomUUID()
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Shelf',description:'A design',assumptions:'Proposed',tradeoffs:'Simple',measurements:[]})])
 await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Use this design'})])
 drawing=randomUUID()
 await call(owner,'bob.artifact_command',[project,'create',drawing,0,JSON.stringify({area_id:null,title:'Shelf drawing',description:'Work drawing',kind:'detail',status:'concept',assumptions:'Fit remains unverified',measurements:[],target_revision:1,source_media_id:null})])
})
after(()=>pg.close())

async function claimed() {
 const turn=randomUUID()
 const claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 assert.equal(claim.status,'claimed')
 const rpc=(payload:any)=>call(owner,'bob.bob_project_write_v11',[project,claim.thread_id,turn,claim.generation,JSON.stringify(payload)])
 let transportError=''
 const writer=createProjectWriter(project,message,async payload=>{
  try{return{data:await rpc(payload),error:null}}catch(e:any){transportError=e.message+' '+e.where;return{data:null,error:{code:e.code,message:e.message}}}
 },async()=>({data:[],error:null}),async()=>({data:{generation:claim.generation,receipts:[]},error:null}))
 return {rpc,writer,get transportError(){return transportError},finish:()=>call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')}
}

test('Bob discovers, loads and writes reusable links; overview and Step reads agree without a geometry revision',async()=>{
 const c=await claimed()
 const tools=createBobToolSession({writer:c.writer,lookup:createProjectLookup(project,async()=>({data:{records:[],related:[],truncated:false},error:null})),readPolicy:seedToolPolicy})
 await tools.prepare()
 const args={record_id:drawing,expected_revision:1,step_id:steps[0],action:'link',request_quote:message}
 assert.equal((await tools.execute('load_tool',{name:'link_project_drawing'})).status,'loaded')
 assert((await tools.prepare()).some(t=>t.function.name==='link_project_drawing'))
 const saved=await tools.execute('link_project_drawing',args)
 assert.equal(saved.status,'saved',c.transportError);assert.deepEqual(saved.receipt.record.step_ids,[steps[0]])
 assert.deepEqual(await tools.execute('link_project_drawing',args),saved,'Retry returns the same receipt')
 assert.equal((await tools.execute('link_project_drawing',{...args,step_id:steps[1]})).status,'saved')
 const rows=(await query(owner,'select * from bob.current_drawing_steps where project_id=$1',[project])).rows as any[]
 assert.equal(rows.length,2);assert(rows.every(r=>r.artifact_id===drawing&&r.artifact_revision===1&&r.title==='Shelf drawing'))
 const overview:any=(await query(owner,'select id,revision,steps from bob.current_drawing_overview where project_id=$1',[project])).rows[0]
 assert.equal(overview.revision,1);assert.deepEqual(overview.steps.map((s:any)=>s.id).sort(),[...steps].sort())
 const reader=createRecordDetailReader(async(dataset,id,revision)=>{
  assert.equal(dataset,'drawing');assert.equal(id,drawing);assert.equal(revision,1);return overview
 },async()=>true)
 assert.deepEqual((await reader.execute({dataset:'drawing',record_id:drawing,revision:1,path:['steps']})).data,overview.steps)
 await c.finish()
})

test('cross-project, stale and direct client writes are rejected at the database boundary',async()=>{
 const c=await claimed()
 const payload={kind:'drawing_link',record_id:drawing,expected_updated_at:null,expected_revision:1,request_quote:message,data:{step_id:otherStep,action:'link'}}
 await assert.rejects(c.rpc(payload),/project_denied/)
 await assert.rejects(c.rpc({...payload,expected_revision:2,data:{step_id:steps[0],action:'link'}}),/record_changed/)
 await assert.rejects(c.rpc({...payload,request_quote:'Invented permission'}),/request_quote_required/)
 for(const view of ['artifact_step_links','current_drawing_steps','current_drawing_overview']) {
  assert.deepEqual((await query(stranger,`select * from bob.${view} where project_id=$1`,[project])).rows,[])
  await assert.rejects(query(null,`select * from bob.${view}`,[],'anon'),/permission denied/)
 }
 await assert.rejects(query(owner,'delete from bob.artifact_step_links where project_id=$1',[project]),/permission denied/)
 await c.finish()
})

test('current links follow revisions, hide archived drawings, and unlinking leaves geometry/history intact',async()=>{
 await call(owner,'bob.artifact_command',[project,'archive',drawing,1,'{}'])
 assert.equal((await query(owner,'select * from bob.current_drawing_steps where project_id=$1',[project])).rows.length,0)
 assert.equal((await query(owner,'select * from bob.current_drawing_overview where project_id=$1',[project])).rows.length,0)
 await call(owner,'bob.artifact_command',[project,'restore',drawing,2,'{}'])
 const restored=(await query(owner,'select * from bob.current_drawing_steps where project_id=$1',[project])).rows as any[]
 assert.equal(restored.length,2);assert(restored.every(r=>r.artifact_revision===3))
 const c=await claimed()
 const saved=await c.writer.write('link_project_drawing',{record_id:drawing,expected_revision:3,step_id:steps[0],action:'unlink',request_quote:message})
 assert.equal(saved.status,'saved')
 assert.equal((await query(owner,'select * from bob.current_drawing_steps where project_id=$1',[project])).rows.length,1)
 assert.equal((await query(owner,'select * from bob.artifact_revisions where artifact_id=$1',[drawing])).rows.length,3)
 await c.finish()
})

test('CAD save scope enters the same work links; archive copies do not resurrect an unlinked Step',async()=>{
 const recipe={contract_version:1,units:'mm',assembly_id:'shelf',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:800,y_mm:400,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
 const c=await claimed()
 const saved=await c.rpc({kind:'cad',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:message,data:{
  title:'CAD shelf',description:'Generic construction',assumptions:'Concept only',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:steps[0],artifact_id:null,expected_revision:0,
  packet:{recipe,manifest:{engine:{name:'build123d'},assembly_id:'shelf'},files:{front:'PHN2Zz48L3N2Zz4=',step:'PRIVATE_LARGE_STEP_EXPORT'}}}})
 const preview:any=(await query(owner,'select * from bob.current_drawing_overview where id=$1',[saved.recordId])).rows[0]
 assert.equal(preview.steps[0].id,steps[0]);assert.equal(preview.preview_svg,'PHN2Zz48L3N2Zz4=')
 assert(!JSON.stringify(preview).includes('PRIVATE_LARGE_STEP_EXPORT'))
 await c.writer.write('link_project_drawing',{record_id:saved.recordId,expected_revision:1,step_id:steps[0],action:'unlink',request_quote:message})
 await call(owner,'bob.artifact_command',[project,'archive',saved.recordId,1,'{}'])
 await call(owner,'bob.artifact_command',[project,'restore',saved.recordId,2,'{}'])
 assert.equal((await query(owner,'select * from bob.current_drawing_steps where artifact_id=$1',[saved.recordId])).rows.length,0)
 assert.equal((await query(owner,'select * from bob.artifact_cad_revisions where artifact_id=$1',[saved.recordId])).rows.length,3)
 await c.finish()
})
