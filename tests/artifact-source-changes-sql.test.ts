import {designIntent,designManifest} from './support/design-intent-fixture.ts'
import {compileCadParameters,inheritCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {test} from 'node:test'
import {parameterPlan,parameterPacket} from './support/cad-parameter-fixture.ts'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {handoff} from './support/cad-review-fixture.ts'

test('P3 deltas: exact project source revisions and affected parameters respect caller authority',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID(),message='Save this source-bound construction.'
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'lineage-owner@example.test',outsider,'lineage-other@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Lineage fixture'})])).id
 const other=(await call(outsider,'bob.create_project',[JSON.stringify({name:'Other lineage fixture'})])).id
 const measurement=randomUUID(),solution=randomUUID()
 const fact={subject:'Panel width',value:'1.001',unit:'m',truth:'measured',source:'Tape at marked endpoints',required:true}
 await call(owner,'bob.evidence_command',[project,'measurement','create',measurement,0,JSON.stringify(fact)])
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Shelf',description:'Concept',assumptions:'Fit unverified',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
 await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Use design'})])
 const m:any=(await asProjectUser(pg,owner,'select * from bob.current_measurements where id=$1',[measurement])).rows[0]
 const recipe={contract_version:1,units:'mm',assembly_id:'shelf',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:1001,y_mm:300,z_mm:18}],instances:[{id:'panel-1',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
 const lineage=buildCadLineage(project,recipe,[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:1}],new Map([[measurement,m]]),handoff.coordinates)
 const turn=randomUUID(),claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 assert.equal(claim.status,'claimed')
 const payload={kind:'cad',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:message,data:{
  title:'Source-bound shelf',description:'Concept',assumptions:'No structural certification',target_revision:1,measurements:[{id:measurement,revision:1}],
  source_artifact_id:null as string|null,source_revision:null as number|null,part_ids:[] as string[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,
  packet:{recipe,manifest:{...designManifest(project,solution),bob_parameters:parameterPacket(project,recipe as any,lineage),engine:{name:'build123d'},assembly_id:'shelf',bob_lineage:lineage},files:{front:'PHN2Zz48L3N2Zz4=',step:'SYNTHETIC_PRIVATE_EXPORT'}}}}
 const save=(p:any)=>call(owner,'bob.bob_project_write_v11',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
 const read=(id:string,rev:number|null=null)=>call(owner,'bob.read_cad_artifact',[project,id,rev])
 const plan=parameterPlan(recipe as any,[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:1}])
 const sourceNode=plan.nodes.find((n:any)=>n.role==='source')!.id
 const placement=plan.bindings.find(b=>b.path==='instances/panel-1/placement/x')!.node
 plan.nodes=plan.nodes.filter(n=>n.id!==placement)
 plan.nodes.push({id:'margin',role:'decision',value:1,unit:'mm',reason:'Chosen margin'}, {id:placement,role:'derived',operation:'subtract_v1',operands:[sourceNode,'margin'],rounding:'exact'})
 payload.data.packet.manifest.bob_parameters=compileCadParameters(project,recipe as any,plan,new Map([[measurement,m]]),new Map())
 const saved=await save(payload),id=saved.recordId
 const changes=(user=owner,artifact=id)=>call(user,'bob.artifact_source_changes',[project,artifact,1])
 assert.deepEqual(await changes(),{changes:[],truncated:false})
 await assert.rejects(changes(outsider),/project_denied/)
 assert.equal(await changes(owner,randomUUID()),null)
 await t.test('image-frame deltas identify changed metadata and suppress revoked media details',async()=>{
  const image=randomUUID()
  await call(owner,'bob.media_command',[project,'reserve',image,JSON.stringify({original_name:'reference.png',title:'Canonical reference',purpose:'reference',content_type:'image/png',byte_size:8,width:2,height:2,target_kind:'project',target_id:project})])
  await asProjectUser(pg,owner,"insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,$2)",[project+'/'+image,JSON.stringify({size:8,mimetype:'image/png'})])
  const media=await call(owner,'bob.media_command',[project,'finalize',image,'{}'])
  const version=JSON.stringify([media.updated_at,media.content_type,media.byte_size,media.width,media.height,media.title,media.purpose,media.source_kind,[]])
  const imagePayload:any=structuredClone(payload);imagePayload.data.title='Image-bound source delta'
  const imagePlan=parameterPlan(imagePayload.data.packet.recipe,[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:1}])
  const ref=(axis:string)=>imagePlan.bindings.find(b=>b.path==='instances/panel-1/placement/'+axis)!.node
  imagePlan.frames=[{id:'photo',kind:'image',source_ref:'image:'+image,required:true,reason:'Canonical image orientation',placement:{x:ref('x'),y:ref('y'),z:ref('z'),rx:ref('rx'),ry:ref('ry'),rz:ref('rz')}}]
  imagePayload.data.packet.manifest.bob_parameters=compileCadParameters(project,imagePayload.data.packet.recipe,imagePlan,new Map([[measurement,m]]),new Map(),new Map([['image:'+image,version]]))
  const imageSaved=await save(imagePayload)
  assert.deepEqual(await changes(owner,imageSaved.recordId),{changes:[],truncated:false})
  // This is already-shared media metadata, not Storage paths/bytes.
  const linkedTask=randomUUID();await pg.query("insert into bob.tasks(id,project_id,name,hours) values($1,$2,'Shared reference task','1h')",[linkedTask,project])
  await call(owner,'bob.media_command',[project,'link',image,JSON.stringify({target_kind:'task',target_id:linkedTask})])
  const imageDelta=(await changes(owner,imageSaved.recordId)).changes[0]
  assert.equal(imageDelta.kind,'image');assert.equal(imageDelta.id,image);assert.equal(imageDelta.state,'changed');assert.equal(imageDelta.saved_version,createHash('sha256').update(version).digest('hex'));assert.match(imageDelta.current_version,/^[a-f0-9]{64}$/);assert.notEqual(imageDelta.current_version,imageDelta.saved_version);assert(!JSON.stringify(imageDelta).includes('Canonical reference'));assert(!JSON.stringify(imageDelta).includes(linkedTask))
  await call(owner,'bob.media_command',[project,'begin_delete',image,'{}'])
  const revoked=(await changes(owner,imageSaved.recordId)).changes[0]
  assert.deepEqual(revoked,{kind:'image',id:null,parameter_ids:[],state:'unavailable'})
 })
 await call(owner,'bob.evidence_command',[project,'measurement','revise',measurement,1,JSON.stringify({...fact,value:'1.002',change_note:'New survey'})])
 const delta=await changes()
 assert.equal(delta.truncated,false);assert.equal(delta.changes.length,1)
 assert.deepEqual(delta.changes[0],{kind:'project_measurement',id:measurement,saved_revision:1,current_revision:2,parameter_ids:[sourceNode,placement].sort(),state:'changed'})
 assert(!JSON.stringify(delta).includes('Tape at marked endpoints'))
 assert(!JSON.stringify(delta).includes('SYNTHETIC_PRIVATE_EXPORT'))
 await call(owner,'bob.solution_command',[project,'select',solution,1,JSON.stringify({solution_revision:1,reason:'Reaffirm decision'})])
 const targetDelta=(await changes()).changes.find((d:any)=>d.kind==='target')
 assert.equal(targetDelta.saved_revision,1);assert.equal(targetDelta.current_revision,2)
 await pg.query("insert into bob.people(id,project_id,name,initials,auth_user_id) values($1,$2,'Other','O',$3)",[randomUUID(),project,outsider])
 await pg.query('delete from bob.people where project_id=$1 and auth_user_id=$2',[project,owner])
 await assert.rejects(changes(),/project_denied/)
})
