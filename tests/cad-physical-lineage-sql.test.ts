import {designIntent,designManifest} from './support/design-intent-fixture.ts'
import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {bindPhysicalDimensions} from '../supabase/functions/_shared/cad-physical-lineage.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {handoff} from './support/cad-review-fixture.ts'

test('P1b: physical source persists across projects with exact scope, revision and history',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),reader=randomUUID(),stranger=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'physical-owner@example.test',reader,'physical-reader@example.test',stranger,'physical-stranger@example.test'])
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const donor=(await call(owner,'bob.create_project',[JSON.stringify({name:'Source survey'})])).id
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'New renovation'})])).id
 await pg.query("insert into bob.people(id,project_id,auth_user_id,name,initials) values($1,$2,$3,'Participant','P')",[randomUUID(),project,reader])
 const building=randomUUID(),site=randomUUID(),space=randomUUID(),otherSpace=randomUUID(),measurement=randomUUID(),scope=randomUUID()
 await call(owner,'bob.physical_site_command',['create',site,0,JSON.stringify({name:'Site'})])
 await call(owner,'bob.physical_building_command',['create',building,0,JSON.stringify({site_id:site,name:'House'})])
 const fact={subject:'Room width',value:'1.001',unit:'m',truth:'measured',source:'Tape between marked endpoints',required:true}
 await call(owner,'bob.evidence_command',[donor,'measurement','create',measurement,0,JSON.stringify(fact)])
 const room={name:'Room',kind:'room',truth:'measured',source:'Accepted survey',measurements:[{id:measurement,revision:1}]}
 for(const id of [space,otherSpace])await call(owner,'bob.physical_node_command',[building,'space','create',id,0,JSON.stringify(room)])
 await call(owner,'bob.physical_scope_command',[project,'project','link',scope,JSON.stringify({target_kind:'space',building_id:building,space_id:space})])
 const lookup=await call(reader,'bob.search_bob_project_data_v8',[project,'physical_space_measurements',null,null,null,null,null])
 const snapshot=lookup.records[0]
 assert.equal(lookup.records.length,1,'a project scoped to one room must not read its neighbour')
 assert.equal((await asProjectUser(pg,reader,'select * from bob.current_measurements where project_id=$1',[donor])).rows.length,0,'donor project is private')
 const solution=randomUUID()
 await call(reader,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Panel concept',description:'Design',assumptions:'Not structural approval',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
 await call(reader,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Use concept'})])
 const recipe={contract_version:1,units:'mm',assembly_id:'physical-panel',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:800,y_mm:300,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
 const lineage=buildCadLineage(project,recipe,[],new Map(),handoff.coordinates)
 bindPhysicalDimensions(recipe,[{definition_id:'panel',dimension:'x_mm',space_measurement_id:snapshot.id,space_revision:1}],new Map([[snapshot.id,snapshot]]),lineage)
 const message='Save the room-bound drawing.',turn=randomUUID(),claim=await call(null,'bob.bob_claim_turn',[project,reader,turn,message],'service_role')
 const payload={kind:'cad',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:message,data:{title:'Room-bound panel',description:'Design',assumptions:'No structural certification',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,
  packet:{recipe,manifest:{...designManifest(project,solution),bob_parameters:parameterPacket(project,recipe as any,lineage),engine:{name:'build123d'},assembly_id:'physical-panel',bob_lineage:lineage},files:{front:'PHN2Zz48L3N2Zz4=',step:'PRIVATE_EXPORT'}}}}
 const save=(p:any)=>call(reader,'bob.bob_project_write_v11',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
 const read=(id:string,rev:number|null=null)=>call(reader,'bob.read_cad_artifact',[project,id,rev])
 const status=async(id:string)=>(await asProjectUser(pg,reader,'select source_state,source_reasons from bob.artifact_source_status where artifact_id=$1 and revision=1',[id])).rows[0]
 const saved=await save(payload),id=saved.recordId
 assert.deepEqual((await read(id)).lineage,lineage)
 assert.equal((await status(id)).source_state,'current')
 assert.equal((await asProjectUser(pg,reader,'select * from bob.artifact_measurements where artifact_id=$1',[id])).rows.length,0)
 assert.deepEqual(await save(payload),saved)
 await assert.rejects(call(stranger,'bob.read_cad_artifact',[project,id,null]),/project_denied/)
 for(const [name,alter] of [
  ['value',(s:any)=>s.value='1.002'],['unit',(s:any)=>s.unit='cm'],['truth',(s:any)=>s.truth='estimated'],
  ['measurement',(s:any)=>s.measurement_id=randomUUID()],['revision',(s:any)=>s.space_revision=2],
  ['room',(s:any)=>s.space_id=otherSpace],['building',(s:any)=>s.building_id=randomUUID()],
 ] as const)await t.test(`reject forged physical ${name}`,async()=>{
  const p=structuredClone(payload);p.data.title=name;alter(p.data.packet.manifest.bob_lineage.bindings[0].source)
  await assert.rejects(save(p),/physical|lineage/)
 })
 const detail:any=structuredClone(payload);detail.data.title='Exact room detail';detail.data.source_artifact_id=id;detail.data.source_revision=1;detail.data.part_ids=['panel'];detail.data.packet.manifest.bob_lineage.inherited_from={artifact_id:id,revision:1}
 const child=await save(detail)
 assert.deepEqual((await read(child.recordId)).lineage.bindings,lineage.bindings)
 await t.test('a caller with building access still cannot import an unscoped neighbour',async()=>{
  const neighbour:any=(await asProjectUser(pg,owner,'select * from bob.space_measurements where space_id=$1',[otherSpace])).rows[0]
  const p=structuredClone(payload);p.data.title='Unscoped neighbour';p.data.packet.manifest.bob_lineage.bindings[0].source={...lineage.bindings[0].source,id:neighbour.id,space_id:otherSpace} as any
  await assert.rejects(save(p),/physical_source/)
 })
 await call(owner,'bob.evidence_command',[donor,'measurement','revise',measurement,1,JSON.stringify({...fact,value:'1.002',change_note:'Later survey reading'})])
 assert.equal((await status(id)).source_state,'current','accepted room snapshot is immutable; donor edits do not replace it')
 await call(owner,'bob.physical_node_command',[building,'space','revise',space,1,JSON.stringify({...room,measurements:[{id:measurement,revision:2}],change_note:'Accept new survey'})])
 assert.equal((await status(id)).source_state,'changed');assert.equal((await status(child.recordId)).source_state,'changed')
 const stale=structuredClone(payload);stale.data.title='Stale room';await assert.rejects(save(stale),/physical_source_changed/)
 assert.deepEqual((await read(id,1)).lineage,lineage)
 await call(reader,'bob.artifact_command',[project,'archive',id,1,'{}']);await call(reader,'bob.artifact_command',[project,'restore',id,2,'{}'])
 assert.deepEqual((await read(id,3)).lineage,lineage)
 await call(owner,'bob.physical_scope_command',[project,'project','unlink',scope,'{}'])
 assert.equal((await status(id)).source_state,'unavailable');assert.equal((await status(child.recordId)).source_state,'unavailable')
 const revoked=structuredClone(payload);revoked.data.title='Removed scope';await assert.rejects(save(revoked),/physical_source/)
 assert.deepEqual((await read(id,1)).lineage,lineage,'previously authorized project history is preserved, not asserted current')
 await call(null,'bob.bob_fail_turn_v2',[project,reader,claim.thread_id,turn,claim.generation],'service_role')
})
