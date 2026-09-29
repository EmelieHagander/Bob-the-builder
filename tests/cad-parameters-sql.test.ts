import {compileCadParameters,inheritCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {test} from 'node:test'
import {parameterPlan,parameterPacket} from './support/cad-parameter-fixture.ts'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {handoff} from './support/cad-review-fixture.ts'

test('P1 graph: authoritative SQL rejects omitted and tampered controlling parameters',async t=>{
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
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Shelf',description:'Concept',assumptions:'Fit unverified',tradeoffs:'Simple',measurements:[]})])
 await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Use design'})])
 const m:any=(await asProjectUser(pg,owner,'select * from bob.current_measurements where id=$1',[measurement])).rows[0]
 const recipe={contract_version:1,units:'mm',assembly_id:'shelf',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:1001,y_mm:300,z_mm:18}],instances:[{id:'panel-1',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
 const lineage=buildCadLineage(project,recipe,[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:1}],new Map([[measurement,m]]),handoff.coordinates)
 const turn=randomUUID(),claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 assert.equal(claim.status,'claimed')
 const payload={kind:'cad',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:message,data:{
  title:'Source-bound shelf',description:'Concept',assumptions:'No structural certification',target_revision:1,measurements:[{id:measurement,revision:1}],
  source_artifact_id:null as string|null,source_revision:null as number|null,part_ids:[] as string[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,
  packet:{recipe,manifest:{bob_parameters:parameterPacket(project,recipe as any,lineage),engine:{name:'build123d'},assembly_id:'shelf',bob_lineage:lineage},files:{front:'PHN2Zz48L3N2Zz4=',step:'SYNTHETIC_PRIVATE_EXPORT'}}}}
 const save=(p:any)=>call(owner,'bob.bob_project_write_v11',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
 const read=(id:string,rev:number|null=null)=>call(owner,'bob.read_cad_artifact',[project,id,rev])
 const saved=await save(payload),id=saved.recordId
 assert.deepEqual((await read(id)).lineage,lineage)
 assert.equal((await read(id)).lineage_state,'partial')
 assert(!JSON.stringify(await read(id)).includes('SYNTHETIC_PRIVATE_EXPORT'))
 assert.deepEqual(await save(payload),saved,'receipt replay does not alter provenance or create a revision')
 await assert.rejects(call(outsider,'bob.read_cad_artifact',[project,id,null]),/project_denied/)
 assert.equal(await call(owner,'bob.read_cad_artifact',[other,id,null]).catch(e=>e.message),'project_denied')
 await assert.rejects(asProjectUser(pg,owner,'update bob.artifact_cad_revisions set manifest=manifest where artifact_id=$1',[id]),/permission denied/)
 await t.test('P1 hardening: historical CAD rows cannot be rewritten in place',async()=>{
  await assert.rejects(pg.query("update bob.artifact_cad_revisions set manifest=manifest-'bob_lineage' where artifact_id=$1",[id]),/cad_revision_immutable/)
  assert.deepEqual((await read(id,1)).lineage,lineage)
 })

 const bad=structuredClone(payload);bad.data.title='Unbound placement';bad.data.packet.manifest.bob_parameters.bindings.pop();
 await assert.rejects(save(bad),/unbound_required_parameter/);
 const wrong=structuredClone(payload);wrong.data.title='Wrong decision';wrong.data.packet.manifest.bob_parameters.nodes.find((n:any)=>n.role==='decision').normalized.value=99;
 await assert.rejects(save(wrong),/parameter_result_mismatch/);
 const missing=structuredClone(payload);missing.data.title='Missing parameters';delete missing.data.packet.manifest.bob_parameters;
 await assert.rejects(save(missing),/cad_parameters_required/);

 await t.test('derived placements and detail dependency pruning survive authoritative readback',async()=>{
  const second=randomUUID(),secondFact={...fact,subject:'Other panel',value:'20',unit:'cm'}
  await call(owner,'bob.evidence_command',[project,'measurement','create',second,0,JSON.stringify(secondFact)])
  const secondRow:any=(await asProjectUser(pg,owner,'select * from bob.current_measurements where id=$1',[second])).rows[0]
  const p:any=structuredClone(payload);p.data.title='Two independent panels'
  const r=p.data.packet.recipe
  r.definitions.push({id:'other',primitive:'box',material_ref:null,x_mm:200,y_mm:20,z_mm:30})
  r.instances.push({id:'other',definition_id:'other',placement:{x:2000,y:0,z:0,rx:0,ry:0,rz:0}})
  const plan=parameterPlan(r,[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:1},{definition_id:'other',dimension:'x_mm',measurement_id:second,revision:1}])
  const bound=plan.bindings.find(b=>b.path==='instances/panel-1/placement/x')!,sourceNode=plan.bindings.find(b=>b.path==='definitions/panel/x_mm')!.node
  plan.nodes=plan.nodes.filter(n=>n.id!==bound.node)
  plan.nodes.push({id:'clearance',role:'decision',value:41,unit:'mm',reason:'Explicit design allowance'},{id:bound.node,role:'derived',operation:'subtract_v1',operands:[sourceNode,'clearance'],rounding:'exact'})
  p.data.packet.manifest.bob_parameters=compileCadParameters(project,r,plan,new Map([[measurement,m],[second,secondRow]]),new Map())
  p.data.measurements.push({id:second,revision:1})
  const parent=await save(p),stored=await read(parent.recordId)
  assert.equal(stored.recipe.instances[0].placement.x,960)
  assert.deepEqual(stored.parameters,p.data.packet.manifest.bob_parameters)
  const d=structuredClone(p);d.data.title='Only first panel';d.data.source_artifact_id=parent.recordId;d.data.source_revision=1;d.data.part_ids=['panel-1'];d.data.measurements=[{id:measurement,revision:1}]
  d.data.packet.recipe.definitions=d.data.packet.recipe.definitions.slice(0,1);d.data.packet.recipe.instances=d.data.packet.recipe.instances.slice(0,1)
  d.data.packet.manifest.bob_lineage.inherited_from={artifact_id:parent.recordId,revision:1}
  d.data.packet.manifest.bob_parameters=inheritCadParameters(project,r,stored.parameters,d.data.packet.recipe)
  const child=await save(d)
  await call(owner,'bob.evidence_command',[project,'measurement','revise',second,1,JSON.stringify({...secondFact,value:'21',change_note:'Only the other panel changed'})])
  const state=async(id:string)=>(await asProjectUser(pg,owner,'select source_state from bob.artifact_source_status where artifact_id=$1 and revision=1',[id])).rows[0].source_state
  assert.equal(await state(parent.recordId),'changed');assert.equal(await state(child.recordId),'current')
  assert.deepEqual((await read(parent.recordId,1)).parameters,stored.parameters)
  const bad:any=structuredClone(d);bad.data.title='Flattened formula';const formula=bad.data.packet.manifest.bob_parameters.nodes.find((n:any)=>n.role==='derived');formula.normalized.value=961
  await assert.rejects(save(bad),/parameter_result_mismatch/)
 })
 await t.test('image frame versions and handedness cannot be forged or saved stale',async()=>{
  const image=randomUUID()
  await call(owner,'bob.media_command',[project,'reserve',image,JSON.stringify({original_name:'reference.png',title:'Directional reference',purpose:'reference',content_type:'image/png',byte_size:8,width:2,height:2,target_kind:'project',target_id:project})])
  await asProjectUser(pg,owner,"insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',$1,$2)",[project+'/'+image,JSON.stringify({size:8,mimetype:'image/png'})])
  const media=await call(owner,'bob.media_command',[project,'finalize',image,'{}'])
  const version=JSON.stringify([media.updated_at,media.content_type,media.byte_size,media.width,media.height,media.title,media.purpose,media.source_kind,[]])
  const p:any=structuredClone(payload);p.data.title='Image-oriented panel'
  const plan=parameterPlan(p.data.packet.recipe,[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:1}])
  const ref=(axis:string)=>plan.bindings.find(b=>b.path==='instances/panel-1/placement/'+axis)!.node
  plan.nodes.push({id:'quarterTurn',role:'decision',value:90,unit:'deg',reason:'Owner established image direction'})
  plan.frames=[{id:'photo',kind:'image',source_ref:'image:'+image,required:true,reason:'Orientation from supplied reference',placement:{x:ref('x'),y:ref('y'),z:ref('z'),rx:ref('rx'),ry:ref('ry'),rz:'quarterTurn'}}]
  p.data.packet.manifest.bob_parameters=compileCadParameters(project,p.data.packet.recipe,plan,new Map([[measurement,m]]),new Map(),new Map([['image:'+image,version]]))
  const savedImage=await save(p)
  assert.deepEqual((await read(savedImage.recordId)).parameters.frames[0].axes,[[0,1,0],[-1,0,0],[0,0,1]])
  const forged=structuredClone(p);forged.data.title='Mirrored axes';forged.data.packet.manifest.bob_parameters.frames[0].axes[0][1]=-1
  await assert.rejects(save(forged),/coordinate_axes_mismatch/)
  await call(owner,'bob.media_command',[project,'begin_delete',image,'{}'])
  const stale=structuredClone(p);stale.data.title='Stale image';await assert.rejects(save(stale),/coordinate_image_changed/)
  assert.deepEqual((await asProjectUser(pg,owner,'select source_reasons from bob.artifact_source_status where artifact_id=$1',[savedImage.recordId])).rows[0].source_reasons,['image_source_changed'])
 })
 await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role');
})

import {readFile} from 'node:fs/promises'
test('P1 graph-only physical formula and room frame cross the authenticated SQL save/read/detail boundary',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 await pg.exec(await readFile(new URL('../scripts/check-cad-lineage-release.sql',import.meta.url),'utf8'))
 assert.equal((await pg.query('select count(*) count from bob.projects')).rows[0].count,0,'Release smoke must roll back its synthetic writes')
})

test('P1 upgrade keeps genuine historical geometry partial without a backfill or a new-write bypass',async t=>{
 const pg=await projectSchema(async(pg,name)=>{
  if(name!=='20260929184327_cad_parameter_graph.sql')return
  await pg.exec(await readFile(new URL('../scripts/cad-lineage-concurrency-fixture.sql',import.meta.url),'utf8'))
  const f:any=(await pg.query('select data from public.cad_race_fixture')).rows[0].data
  delete f.payload.data.packet.manifest.bob_parameters
  const saved:any=(await asProjectUser(pg,f.actor,'select bob.bob_project_write_v11($1,$2,$3,$4,$5) result',[f.project,f.claim.thread_id,f.turn_id,f.claim.generation,JSON.stringify(f.payload)])).rows[0].result
  f.saved=saved
  await pg.query('update public.cad_race_fixture set data=$1',[JSON.stringify(f)])
 });t.after(()=>pg.close())
 const f:any=(await pg.query('select data from public.cad_race_fixture')).rows[0].data
 const read=async(id:string)=>(await asProjectUser(pg,f.actor,'select bob.read_cad_artifact($1,$2,null) result',[f.project,id])).rows[0].result as any
 assert.equal((await read(f.saved.recordId)).parameter_state,'legacy_partial')
 assert.equal((await read(f.saved.recordId)).parameters,null)
 const detail=structuredClone(f.payload);detail.data.title='Legacy detail';detail.data.source_artifact_id=f.saved.recordId;detail.data.source_revision=1;detail.data.part_ids=['panel'];detail.data.packet.manifest.bob_lineage.inherited_from={artifact_id:f.saved.recordId,revision:1}
 const child:any=(await asProjectUser(pg,f.actor,'select bob.bob_project_write_v11($1,$2,$3,$4,$5) result',[f.project,f.claim.thread_id,f.turn_id,f.claim.generation,JSON.stringify(detail)])).rows[0].result
 assert.equal((await read(child.recordId)).parameter_state,'legacy_partial')
 const fresh=structuredClone(f.payload);fresh.data.title='New untracked design'
 await assert.rejects(asProjectUser(pg,f.actor,'select bob.bob_project_write_v11($1,$2,$3,$4,$5)',[f.project,f.claim.thread_id,f.turn_id,f.claim.generation,JSON.stringify(fresh)]),/cad_parameters_required/)
 await asProjectUser(pg,f.actor,"select bob.artifact_command($1,'archive',$2,1,'{}')",[f.project,f.saved.recordId])
 assert.equal((await read(f.saved.recordId)).parameter_state,'legacy_partial')
})
