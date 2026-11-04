import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {manufacturePolicy} from './support/construction-instance-policy-fixture.ts'
let pg:any,owner:string,outsider:string,project:string,other:string,source:string,drawing:string,area:string,task:string
const call=async(user:string|null,name:string,args:any[],role='authenticated')=>(await asProjectUser(pg,user,`select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
before(async()=>{
 pg=await projectSchema();owner=randomUUID();outsider=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'operation-owner@test.invalid',outsider,'operation-outsider@test.invalid'])
 project=(await call(owner,'create_project',[{name:'Operation project'}])).id;other=(await call(owner,'create_project',[{name:'Other project'}])).id
 const solution=randomUUID(),turn=randomUUID(),message='Create the current construction',f=constructionFormFixture()
 await call(owner,'solution_command',[project,'create',solution,0,{title:'Frame',description:'Synthetic',assumptions:'Not measured',tradeoffs:'Not approved',measurements:[],design_intent:f.intent}])
 const target=await call(owner,'solution_command',[project,'select',solution,0,{solution_revision:1,reason:'Fixture'}])
 const c=await call(null,'bob_claim_turn',[project,owner,turn,message],'service_role')
 const write=(p:any)=>call(owner,'bob_project_write_v17',[project,c.thread_id,turn,c.generation,p])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const saved=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'frame',title:'Frame',description:'Checkpoint',area_id:null,target_revision:target.revision,change_note:'Initial',recipe:f.recipe,parameters:parameterPacket(project,f.recipe),materials:[{definition_id:'rail',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],instance_policy:manufacturePolicy(f.recipe),open_questions:[],form_refinement:f.refinement}})
 source=saved.recordId;drawing=randomUUID()
 await call(owner,'artifact_command',[project,'create',drawing,0,{title:'Saved drawing',description:'Read fixture',kind:'detail',status:'concept',assumptions:'Synthetic only',source_media_id:null,measurements:[],target_revision:target.revision}])
 // Read fixture only: oversized annotations/files intentionally bypass CAD write
 // validation. Domain writers have their own tests; never do this in production.
 await pg.exec('alter table bob.artifact_cad_revisions disable trigger user')
 await pg.query('insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files) values($1,$2,1,$3,$4,$5)',[project,drawing,f.recipe,{annotations:'x'.repeat(280000)},{step:'x'.repeat(1000000)}])
 await pg.exec('alter table bob.artifact_cad_revisions enable trigger user')
 area='area-operation';task='task-operation'
 await pg.query('insert into bob.areas(id,project_id,slug,name) values($1,$2,$3,$4)',[area,project,'operation','Operation'])
 await pg.query('insert into bob.tasks(id,area_id,name) values($1,$2,$3)',[task,area,'Image target'])
})
after(()=>pg?.close())

test('identity projection is exact, small, access-controlled and contains no geometry, annotations or files',async()=>{
 const value=await call(owner,'read_drawing_identity',[project,drawing,1])
 assert.equal(value.artifact_id,drawing);assert.equal(value.revision,1);assert.equal(value.title,'Saved drawing');assert.equal(value.source_kind,'cad')
 for(const field of ['recipe','manifest','files','parameters'])assert(!(field in value))
 assert(JSON.stringify(value).length<1800)
 assert.equal(await call(owner,'read_drawing_identity',[other,drawing,1]),null)
 assert.equal(await call(owner,'read_drawing_identity',[project,drawing,99]),null)
 assert.equal(await call(owner,'read_drawing_identity',[project,source,1]),null,'a Construction is not mislabelled CAD')
 await assert.rejects(call(outsider,'read_drawing_identity',[project,drawing,1]),/project_denied/)
})
test('sections are bounded in SQL, preserve exact paths and cannot expose another project or files',async()=>{
 const units=await call(owner,'read_cad_section',[project,drawing,1,['recipe','units']])
 assert.equal(units.status,'ok');assert.equal(units.data,'mm');assert.equal(units.projectId,project);assert.equal(units.record_id,drawing)
 const whole=await call(owner,'read_cad_section',[project,drawing,1,[]]);assert.equal(whole.status,'too_large');assert(whole.keys.includes('manifest'));assert(JSON.stringify(whole).length<2000)
 assert.equal((await call(owner,'read_cad_section',[project,drawing,1,['files']])).status,'not_found')
 assert.equal((await call(owner,'read_cad_section',[project,drawing,1,['recipe','instances','-1']])).status,'not_found')
 assert.equal((await call(owner,'read_cad_section',[other,drawing,1,[]])).status,'not_found')
 await assert.rejects(call(owner,'read_cad_section',[project,drawing,1,['__proto__']]),/invalid_section/)
 await assert.rejects(call(outsider,'read_cad_section',[project,drawing,1,[]]),/project_denied/)
})
test('image target preflight rejects missing and foreign targets before generation and follows current Plan identity',async()=>{
 assert.equal((await call(owner,'read_image_target',[project,'project',project])).status,'ready')
 assert.equal((await call(owner,'read_image_target',[project,'task',task])).status,'ready')
 for(const [kind,id] of [['project',other],['task','missing'],['task',randomUUID()],['plan_step','not-a-uuid'],['area','missing']])
  assert.equal((await call(owner,'read_image_target',[project,kind,id])).status,'not_found')
 assert.equal((await call(owner,'read_image_target',[other,'task',task])).status,'not_found')
 await assert.rejects(call(outsider,'read_image_target',[project,'task',task]),/project_denied/)
})
test('operation inventory and reference validation retain project, kind and exact revision fences',async()=>{
 const scope=await call(owner,'read_worker_operation_scope',[project,source,1])
 assert.equal(scope.status,'ready');assert.deepEqual(scope.source,{artifact_id:source,revision:1})
 assert(scope.entries.some((e:any)=>e.kind==='construction'&&e.id===source));assert(scope.entries.some((e:any)=>e.kind==='drawing'&&e.id===drawing))
 assert(!JSON.stringify(scope).includes('xxxx'))
 assert.equal((await call(owner,'read_worker_operation_scope',[project,source,2])).status,'conflict')
 assert.equal((await call(owner,'read_worker_operation_scope',[other,source,1])).status,'conflict')
 const refs=[{kind:'construction',id:source,revision:1},{kind:'drawing',id:drawing,revision:1},{kind:'task',id:task,revision:0}]
 assert.equal(await call(owner,'check_worker_operation_refs',[project,refs]),true)
 assert.equal(await call(owner,'check_worker_operation_refs',[other,refs]),false)
 assert.equal(await call(owner,'check_worker_operation_refs',[project,[{kind:'construction',id:drawing,revision:1}]]),false)
 assert.equal(await call(owner,'check_worker_operation_refs',[project,[{kind:'drawing',id:drawing,revision:2}]]),false)
 await assert.rejects(call(outsider,'check_worker_operation_refs',[project,refs]),/project_denied/)
})
test('read helpers do not grant anonymous/service-role execution',async()=>{
 for(const [name,args]of [['read_drawing_identity',[project,drawing,1]],['read_cad_section',[project,drawing,1,[]]],['read_image_target',[project,'project',project]],['read_worker_operation_scope',[project,null,null]],['check_worker_operation_refs',[project,[]]]] as const){
  await assert.rejects(call(null,name,[...args],'anon'),/permission denied/)
  await assert.rejects(call(null,name,[...args],'service_role'),/permission denied/)
 }
})
