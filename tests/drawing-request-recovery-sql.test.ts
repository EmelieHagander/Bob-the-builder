import {designIntent,designManifest} from './support/design-intent-fixture.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {drawingCandidateCommitment} from '../supabase/functions/_shared/drawing-request-recovery.ts'
import {handoff} from './support/cad-review-fixture.ts'

for(const lifetime of ['legacy','project','restored'])test(`P2: ${lifetime} request completion and canonical CAD receipt are atomic, isolated and recoverable across turns`,async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID(),message='Save the reviewed construction.'
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'p2-owner@example.test',outsider,'p2-other@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'P2 recovery fixture'})])).id
 const other=(await call(outsider,'bob.create_project',[JSON.stringify({name:'Unrelated fixture'})])).id
 const solution=randomUUID()
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Shelf',description:'Concept',assumptions:'Site fit unknown',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
 await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Use design'})])
 const plan=await call(owner,'bob_private.project_plan_propose',[project,0,JSON.stringify({summary:'Build shelf',reason:'Requested',steps:[{step_id:null,title:'Draw shelf',goal:'Concept available',state:'active',phase:'planning',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[{requirement_id:null,type:'drawing',title:'Shelf concept',description:'Provide a checked concept drawing',resolution:'open',responsible_kind:'bob',responsible_person_id:null,evidence_selector:{kind:'none',id:null,subject:null,area_id:null}}]}],task_links:[]})],'postgres')
 const approved=await call(owner,'bob_private.project_plan_decide',[project,0,plan.record.revision,'approve','Proceed'],'postgres')
 const step=approved.record.steps[0].id
 let turn=randomUUID(),claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 assert.equal(claim.status,'claimed')
 const scope={area_id:null,component_id:null,step_id:step,artifact_id:null}
 const store=async(op:string,id:string|null=null,expected=0,status:string|null=null,payload:any=null,key=randomUUID())=>{
  if(lifetime!=='legacy'&&op==='save'&&id===null){
   id=randomUUID();await call(owner,'bob.create_drawing_request',[project,claim.thread_id,turn,claim.generation,id,JSON.stringify(scope)])
  }
  return call(null,'bob.bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,op,id,expected,status,payload,key],'service_role')
 }
 const save=(p:any)=>call(owner,'bob.bob_project_write_v12',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
 const recipe:any={contract_version:1,units:'mm',assembly_id:'p2-shelf',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:600,y_mm:300,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front']}
 const lineage=buildCadLineage(project,recipe,[],new Map(),handoff.coordinates)
 const candidate:any={title:'P2 shelf',description:'Concept',assumptions:'Site fit unverified',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:step,artifact_id:null,expected_revision:0,
  packet:{recipe,manifest:{...designManifest(project,solution),bob_parameters:parameterPacket(project,recipe),bob_lineage:lineage,engine:{name:'build123d'},assembly_id:'p2-shelf',preview_metadata:{front:{file:'front.png',sha256:'a'.repeat(64),source_sha256:'b'.repeat(64)}}},files:{front:'PHN2Zz48L3N2Zz4=',step:'PRIVATE_EXPORT'},previews:{front:'PRIVATE_PIXELS'}}}
 const working={brief:{...scope,brief:message,handoff},owner_request:message,reference_refs:[],reviewed_candidate:drawingCandidateCommitment(candidate)}
 let request=await store('save',null,0,'reviewed',working)
 if(lifetime==='restored'){
  await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
  const thread=(await pg.query('select next_seq from bob.bob_threads where id=$1',[claim.thread_id])).rows[0]
  await call(owner,'bob.bob_reset_conversation',[project,claim.thread_id,thread.next_seq])
  turn=randomUUID();claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
  request=await call(owner,'bob.restore_drawing_request',[project,claim.thread_id,turn,claim.generation,request.id,2,1,step,message])
  request=await store('save',request.id,request.revision,'reviewed',{...request.payload,reviewed_candidate:working.reviewed_candidate})
 }
 const payload:any={kind:'cad',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:message,data:{...candidate,drawing_request:{id:request.id,revision:request.revision}}}

 await t.test('status alone, changed candidate, wrong thread, stale generation and direct access cannot complete',async()=>{
  await assert.rejects(store('save',request.id,request.revision,'saved',working),/completion_requires_receipt/)
  const bad=structuredClone(payload);bad.data.title='Different unchecked candidate'
  await assert.rejects(save(bad),/drawing_candidate_changed/)
  const alteredMetadata=structuredClone(payload);alteredMetadata.data.packet.manifest.preview_metadata.front.sha256='c'.repeat(64)
  await assert.rejects(save(alteredMetadata),/drawing_candidate_changed/)
  for(const forbidden of [{previews:{front:'PRIVATE_PIXELS'}},{preview_metadata:{front:{pixels:'data:image/png;base64,abc'}}}]){
   const poisoned=structuredClone(working);Object.assign(poisoned.reviewed_candidate.packet.manifest,forbidden)
   await assert.rejects(store('save',request.id,request.revision,'reviewed',poisoned),/drawing_request_pixels_forbidden/)
  }
  const stale=structuredClone(payload);stale.data.drawing_request.revision++
  await assert.rejects(save(stale),/drawing_request_changed/)
  await assert.rejects(call(owner,'bob.bob_project_write_v12',[project,claim.thread_id,turn,claim.generation+1,JSON.stringify(payload)]),/turn_not_claimed/)
  await assert.rejects(call(outsider,'bob.bob_project_write_v12',[project,claim.thread_id,turn,claim.generation,JSON.stringify(payload)]),/project_denied/)
  await assert.rejects(call(null,'bob.bob_drawing_request',[other,outsider,claim.thread_id,turn,claim.generation,'load',request.id,0,null,null,null],'service_role'),/project_denied/)
  await assert.rejects(asProjectUser(pg,owner,'select * from bob_private.drawing_requests'),/permission denied/)
  await assert.rejects(call(owner,'bob.bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'load',request.id,0,null,null,null]),/permission denied/)
  await assert.rejects(call(owner,'bob_private.bob_project_write_before_request_recovery',[project,claim.thread_id,turn,claim.generation,JSON.stringify(payload)]),/permission denied/)
  assert.equal((await store('load',request.id)).status,'reviewed')
 })

 await t.test('source rejection rolls back request completion and leaves no Artifact',async()=>{
  const invalid=structuredClone(candidate);invalid.target_revision=99;invalid.title='Stale target'
  const r=await store('save',null,0,'reviewed',{...working,reviewed_candidate:drawingCandidateCommitment(invalid)})
  await assert.rejects(save({...payload,data:{...invalid,drawing_request:{id:r.id,revision:r.revision}}}),/changed|target|revision/)
  assert.equal((await store('load',r.id)).status,'reviewed')
  assert.equal((await store('load',r.id)).receipt,null)
  assert.equal((await pg.query('select count(*)::int n from bob.artifacts where project_id=$1',[project])).rows[0].n,0)
 })

 assert.deepEqual((await store('load',request.id)).payload.reviewed_candidate.packet.manifest.preview_metadata,candidate.packet.manifest.preview_metadata)
 const saved=await save(payload)
 assert.equal(saved.dataset,'artifacts');assert.equal(saved.revision,1)
 assert.deepEqual(saved.record.step_ids,[step])
 assert.deepEqual((await asProjectUser(pg,owner,'select step_id from bob.current_drawing_steps where artifact_id=$1',[saved.recordId])).rows.map(r=>r.step_id),[step])
 const completed=await store('load',request.id)
 assert.equal(completed.status,'saved');assert.deepEqual(completed.receipt,saved)
 assert(!(await store('list')).some((r:any)=>r.id===request.id))
 assert.deepEqual(await save(payload),saved,'a lost response retries without another Artifact or revision')
 await assert.rejects(store('save',request.id,completed.revision,'collecting',working),/drawing_request_complete/)
 assert.equal((await pg.query('select count(*)::int n from bob.artifacts where project_id=$1',[project])).rows[0].n,1)
 assert(!JSON.stringify(completed).includes('PRIVATE_PIXELS'),'private request does not copy preview pixels')
 assert(!JSON.stringify(completed).includes('PRIVATE_EXPORT'),'private request does not copy export bytes')

 await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
 const priorThread=claim.thread_id;turn=randomUUID()
 claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 assert.equal(claim.thread_id,priorThread)
 assert.deepEqual((await store('load',request.id)).receipt,saved)
 assert.deepEqual(await save(payload),saved,'cross-turn identical write only reads the durable completed receipt')
 const changed=structuredClone(payload);changed.data.packet.files.step='CHANGED_EXPORT'
 await assert.rejects(save(changed),/drawing_request_complete/)
 assert.equal((await pg.query('select count(*)::int n from bob.artifact_cad_revisions where project_id=$1',[project])).rows[0].n,1)
 await call(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
 if(lifetime!=='legacy'){
  const thread=(await asProjectUser(pg,owner,'select id,next_seq from bob.bob_threads where id=$1',[claim.thread_id])).rows[0]
  await call(owner,'bob.bob_reset_conversation',[project,thread.id,thread.next_seq])
  assert.equal((await pg.query('select count(*)::int n from bob_private.drawing_requests where id=$1',[request.id])).rows[0].n,0)
  const projection=(await call(owner,'bob.project_drawing_requests',[project,request.id,null])).requests[0]
  assert.equal(projection.status,'saved');assert.equal(projection.artifact_id,saved.recordId)
  turn=randomUUID();claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
  assert.notEqual(claim.thread_id,priorThread)
  assert.deepEqual((await store('load',request.id)).receipt,saved)
  assert.deepEqual(await save(payload),saved,'exact completed receipt survives removal of all private working packets')
  await assert.rejects(save(changed),/drawing_request_complete/)
  await assert.rejects(call(owner,'bob.cancel_drawing_request',[project,request.id,projection.revision]),/drawing_request_complete/)
  assert.equal((await pg.query('select count(*)::int n from bob.artifact_cad_revisions where project_id=$1',[project])).rows[0].n,1)
 }

})
