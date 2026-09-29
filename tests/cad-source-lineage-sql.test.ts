import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {handoff} from './support/cad-review-fixture.ts'

test('P1: exact lineage round-trips through SQL, rejects forged metadata and survives history',async t=>{
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
 const corruptions:[string,(p:any)=>void,RegExp][]=[
  ['numeric value',p=>p.data.packet.manifest.bob_lineage.bindings[0].source.value='2',/source_mismatch/],
  ['truth upgrade',p=>p.data.packet.manifest.bob_lineage.bindings[0].source.truth='provided_spec',/source_mismatch/],
  ['geometry mismatch',p=>p.data.packet.recipe.definitions[0].x_mm=1002,/geometry_mismatch/],
  ['missing pin',p=>p.data.measurements=[],/source_not_pinned/],
  ['wrong project',p=>p.data.packet.manifest.bob_lineage.project_id=other,/invalid_cad_lineage/],
  ['claimed complete',p=>p.data.packet.manifest.bob_lineage.coverage='complete',/invalid_cad_lineage/],
  ['duplicate parameter',p=>p.data.packet.manifest.bob_lineage.bindings.push(p.data.packet.manifest.bob_lineage.bindings[0]),/invalid_cad_lineage_binding/],
 ]
 for(const [label,mutate,expected] of corruptions){
  const bad=structuredClone(payload);bad.data.title=label;mutate(bad)
  await assert.rejects(save(bad),expected,label)
 }
 const detail=structuredClone(payload);detail.data.title='Exact detail';detail.data.source_artifact_id=id;detail.data.source_revision=1;detail.data.part_ids=['panel-1'];detail.data.packet.manifest.bob_lineage.inherited_from={artifact_id:id,revision:1}
 const child=await save(detail)
 assert.deepEqual((await read(child.recordId)).lineage.bindings,lineage.bindings)
 await t.test('P1 hardening: removing metadata cannot strip tracked parent provenance',async()=>{
  const stripped:any=structuredClone(detail);stripped.data.title='Stripped parent';delete stripped.data.packet.manifest.bob_lineage
  await assert.rejects(save(stripped),/cad_lineage_required/)
 })
 await t.test('P1 hardening: JSON revision has numeric type, not a coerced string',async()=>{
  const bad:any=structuredClone(payload);bad.data.title='String revision';bad.data.packet.manifest.bob_lineage.bindings[0].source.revision='1'
  await assert.rejects(save(bad),/invalid_cad_lineage_binding/)
 })
 await t.test('P1 hardening: tracked artifact cannot be revised through the legacy bypass',async()=>{
  const standalone=structuredClone(payload);standalone.data.title='Disposable tracked original';const original=await save(standalone)
  const stripped:any=structuredClone(payload);stripped.record_id=original.recordId;stripped.expected_revision=1;stripped.data.title='Stripped revision';delete stripped.data.packet.manifest.bob_lineage
  await assert.rejects(save(stripped),/cad_lineage_required/)
 })
 const dropped=structuredClone(detail);dropped.data.title='Dropped provenance';dropped.data.packet.manifest.bob_lineage.bindings=[]
 await assert.rejects(save(dropped),/must_reuse_source/)
 // Absent old metadata is represented honestly; it is not backfilled by guesses.
 const legacy:any=structuredClone(payload);legacy.data.title='Legacy';delete legacy.data.packet.manifest.bob_lineage
 const old=await save(legacy)
 assert.equal((await read(old.recordId)).lineage_state,'legacy_untracked');assert.equal((await read(old.recordId)).lineage,null)
 await call(owner,'bob.evidence_command',[project,'measurement','revise',measurement,1,JSON.stringify({...fact,value:'1.002',change_note:'Remeasured'})])
 await t.test('P1 hardening: missing metadata does not bypass current source checks',async()=>{
  const stale:any=structuredClone(payload);stale.data.title='Stale legacy writer';delete stale.data.packet.manifest.bob_lineage
  await assert.rejects(save(stale),/cad_lineage_source_changed/)
 })
 const stale=structuredClone(payload);stale.data.title='Stale source'
 await assert.rejects(save(stale),/changed|stale|current|revision/i)
 assert.equal((await asProjectUser(pg,owner,'select source_state from bob.artifact_source_status where artifact_id=$1',[id])).rows[0].source_state,'changed')
 assert.deepEqual((await read(id,1)).lineage,lineage,'old source snapshot is never rewritten')
 await call(owner,'bob.artifact_command',[project,'archive',id,1,'{}'])
 await call(owner,'bob.artifact_command',[project,'restore',id,2,'{}'])
 assert.deepEqual((await read(id,3)).lineage,lineage,'archive/restore preserves historical source identity')
 assert.equal((await asProjectUser(pg,owner,'select source_state from bob.artifact_source_status where artifact_id=$1 and revision=3',[id])).rows[0].source_state,'changed')
 // Old packets remain navigable and lifecycle-copyable, even after sources
 // change. This is history preservation, not acceptance of a new stale design.
 await call(owner,'bob.artifact_command',[project,'archive',old.recordId,1,'{}'])
 await call(owner,'bob.artifact_command',[project,'restore',old.recordId,2,'{}'])
 assert.equal((await read(old.recordId,3)).lineage_state,'legacy_untracked')
 await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
})
