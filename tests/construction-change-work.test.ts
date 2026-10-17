import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {cutPlanFixture} from './support/cut-plan-fixture.ts'
import {listFixture} from './construction-lists.test.ts'
import {constructionLists} from '../supabase/functions/_shared/construction-lists.ts'
import {constructionInstancePolicy} from '../supabase/functions/_shared/construction-instance-policy.ts'
import {createConstructionTools,constructionChangeReaders} from '../supabase/functions/_shared/construction-draft.ts'
import {createBobJournal,type BobJournal,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {seedToolPolicy} from '../supabase/functions/_shared/project-answer.ts'
import {asProjectUser} from './support/project-schema.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'

test('explicit canonical archive settles a linked model gap without inventing quantities or changing other work',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f),id=randomUUID()
 await f.rpc('bob.material_requirement_command',[f.project,'create',id,0,JSON.stringify({name:'Legacy allowance',category:'Timber',area_id:null,task_id:null,unit:'pcs',required_quantity:'99',waste_percent:'0',purchase_increment:'1',basis:'Explicit manual allowance, model absent',assumptions:'Fixture',artifact_id:f.construction.recordId,artifact_revision:1,target_revision:1,stock_allocations:[],component_allocations:[],change_note:'Initial'})])
 const before=(await f.pg.query('select * from bob.material_requirement_revisions where requirement_id=$1',[id])).rows
 assert.equal((await r.tools().construction.execute('change_construction_roles',{key:'archive-gap-roles',record_id:f.construction.recordId,expected_revision:1,changes:[{instance_id:'back',role:'existing_part',quantity_policy:'retain',reason:'Explicit retained fixture member'}],change_note:'Retain member',request_quote:f.message})).status,'saved')
 const work=await r.changes(2),item=work.items.find((i:any)=>i.output_id===id)
 assert.equal((await r.advance(item,2)).status,'needs_requirement_model')
 const payload={...f.base,kind:'operational',record_id:id,expected_revision:1,request_quote:f.message,data:{resource:'requirement',action:'archive',fields:{}}}
 const saved=await r.write(payload);assert.equal(saved.recordId,id);assert.equal(saved.revision,2)
 assert.deepEqual(await r.write(payload),saved)
 const after=await r.changes(2),resolved=after.items.find((i:any)=>i.id===item.id)
 assert.equal(resolved.state,'retired');assert.equal(resolved.completed_revision,2);assert.equal(resolved.completion_receipt.recordId,id);assert.equal(resolved.completion_receipt.dataset,'requirements')
 assert.equal(after.pending,work.pending-1)
 assert.deepEqual(after.items.filter((i:any)=>i.id!==item.id),work.items.filter((i:any)=>i.id!==item.id))
 assert.deepEqual((await f.pg.query('select * from bob.material_requirement_revisions where requirement_id=$1 and revision=1',[id])).rows,before)
 const current=(await f.pg.query('select * from bob.material_requirement_revisions where requirement_id=$1 and revision=2',[id])).rows[0]
 assert.equal(Number(current.required_quantity),99);assert.equal(current.archived,true);assert.equal(current.method_key,'manual')
})

function runtime(f:any,journal?:BobJournal){
 const binding=[f.project,f.claim.thread_id,f.turn,f.claim.generation]
 const write=(p:any)=>f.rpc('bob.bob_project_write_v16',[...binding,JSON.stringify(p)])
 const read=(revision:number|null=null)=>f.rpc('bob.read_construction_draft',[f.project,f.construction.recordId,revision,null])
 const changes=(revision:number,after:string|null=null)=>f.rpc('bob.read_construction_changes',[f.project,f.construction.recordId,revision,after])
 const sqlErrors:string[]=[];let catalogReads=0
 const prepare=(name:string)=>async(p:any)=>{
  try{return await f.rpc(name,[...binding,JSON.stringify(p)])}
  catch(e:any){sqlErrors.push([e.message,e.detail,e.where].filter(Boolean).join(' / '));return {status:e.code==='42501'?'denied':e.code==='PT409'?'conflict':'invalid',reason:e.message}}
 }
 const tools=()=>{
  const writer=createProjectWriter(f.project,f.message,async p=>{
   try{return {data:await write(p),error:null}}
   catch(e:any){sqlErrors.push([e.message,e.detail,e.where].filter(Boolean).join(' / '));return {data:null,error:{code:e.code,message:e.message}}}
  },async()=>({data:[],error:null}),async()=>({data:[],error:null}))
  const construction=createConstructionTools({projectId:f.project,message:f.message,writer,hasAccess:async()=>true,
   read:(_id,revision)=>read(revision),readCurrent:()=>read(),
   readCatalog:async(id,revision)=>{catalogReads++;return f.rpc('bob.catalog_read',[f.project,JSON.stringify({action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})])},
   readSources:async()=>({project:new Map(),physical:new Map()}),
   ...constructionChangeReaders({readChanges:(_id:string,revision:number,after:string|null)=>changes(revision,after),prepareRoleChange:prepare('bob.prepare_construction_role_change'),prepareConsequence:prepare('bob.prepare_construction_consequence')},journal,2),
   prepareParameterChange:prepare('bob.prepare_construction_parameter_change')})
  const session=createBobToolSession({projectId:f.project,message:f.message,writer,constructionTools:construction,
   lookup:createProjectLookup(f.project,async()=>({data:{records:[],related:[],truncated:false},error:null})),readPolicy:seedToolPolicy})
  return {construction,session}
 }
 const continueInput=(item:any,revision:number,key='continue-'+item.id)=>({key,record_id:f.construction.recordId,expected_revision:revision,item_id:item.id,
  action:'recalculate',review_note:null,output_revision:null,change_note:'Recompute only this saved consequence from canonical inputs'})
 const advance=async(item:any,revision:number,key?:string)=>{
  const {session}=tools();await session.prepare()
  return session.execute('continue_construction_change',continueInput(item,revision,key))
 }
 return{binding,write,read,changes,tools,continueInput,advance,sqlErrors,catalogReads:()=>catalogReads}
}

test('a saved role revision resumes earlier canonical change work without replay drift or another construction write',async t=>{
 const f=await cutPlanFixture(t),entries:JournalEntry[]=[];let paid=0
 const input={key:'retain-replay',record_id:f.construction.recordId,expected_revision:2,changes:[{instance_id:'back',role:'prefabricated_part',quantity_policy:'complete_item',reason:'Explicit synthetic complete item'}],change_note:'Use the complete upright',request_quote:f.message}
 assert.equal((await runtime(f).tools().construction.execute('change_construction_roles',{...input,key:'seed-replay',expected_revision:1,changes:[{instance_id:'back',role:'existing_part',quantity_policy:'retain',reason:'Explicit synthetic retained member'}]})).status,'saved')
 const run=async()=>{
  const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},Infinity),r=runtime(f,journal),tools=r.tools().construction
  const before=await tools.execute('read_construction_changes',{artifact_id:f.construction.recordId,revision:2,after:null})
  await journal.run('model:ask-bob',{before},async()=>{paid++;return 'Retain the existing upright'})
  const saved=await tools.execute('change_construction_roles',input)
  assert.equal(saved.status,'saved',JSON.stringify(r.sqlErrors))
  return {before,saved,after:await tools.execute('read_construction_changes',{artifact_id:f.construction.recordId,revision:2,after:null})}
 }
 const first=await run();assert.equal(first.after.status,'superseded')
 assert.deepEqual(await run(),first);assert.equal(paid,1)
 assert.equal((await f.rpc('bob.read_construction_draft',[f.project,f.construction.recordId,null,null])).revision,3)
 assert.equal((await f.pg.query('select count(*)::integer n from bob.artifact_construction_revisions where artifact_id=$1',[f.construction.recordId])).rows[0].n,3)
})

test('per-instance roles filter a shared definition without guessing labels or turning ownership into a quantity',()=>{
 const {draft,catalog}=listFixture()
 const before=structuredClone(draft.recipe)
 const role=(id:string,role:string,quantity_policy:string)=>Object.assign(draft.instance_policy.instances.find((i:any)=>i.instance_id===id),{role,quantity_policy,reason:'Explicit synthetic role choice'})
 role('left','reference','exclude');role('right','existing_part','retain');role('panel1','prefabricated_part','complete_item')
 const lists:any=constructionLists(draft,catalog,[])
 assert.equal(lists.status,'derived');assert.deepEqual(lists.bom.map((r:any)=>[r.definition_id,r.quantity]),[['panel',2]])
 assert.deepEqual(lists.cuts.map((r:any)=>r.instance_id),['panel0','panel2']);assert.deepEqual(lists.cuts.map((r:any)=>r.label),['P3','P5'])
 assert.deepEqual(lists.reference_instances.map((r:any)=>r.instance_id),['left']);assert.equal(lists.retained_instances[0].instance_id,'right')
 assert.equal(lists.complete_items[0].instance_id,'panel1');assert.deepEqual(draft.recipe,before)
 const legacy={...draft,instance_policy:null};assert.equal(constructionLists(legacy,catalog,[]).status,'needs_data')
 const invalid=structuredClone(draft.instance_policy);invalid.instances[0].quantity_policy='manufacture'
 assert.throws(()=>constructionInstancePolicy(draft.recipe,invalid),/invalid_instance_policy/)
})

test('saved consequences survive interruption and retry; code reuses need/cut identities and recompiles changed dimensions',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f)
 const saved=await r.write(f.payload)
 const oldPlan=await f.read(saved.recordId),oldNeeds=(await f.pg.query('select * from bob.material_requirement_revisions where project_id=$1 order by requirement_id',[f.project])).rows
 const node=f.draft.parameters.bindings.find((b:any)=>b.path==='definitions/base/x_mm').node
 const {session}=r.tools();assert((await session.prepare()).some((s:any)=>s.function.name==='read_construction_changes'))
 const changed:any=await session.execute('change_construction_parameters',{key:'width',record_id:f.construction.recordId,expected_revision:1,
  changes:[{id:node,role:'decision',value:240,unit:'mm',reason:'Explicit synthetic wider base'}],change_note:'Widen the saved base'})
 assert.equal(changed.status,'saved',JSON.stringify(r.sqlErrors))
 let work=await r.changes(2);assert.equal(work.total,3);assert.equal(work.pending,3);assert.equal(work.cause.geometry_changed,true)
 const needs=work.items.filter((i:any)=>i.kind==='requirement'),cut=work.items.find((i:any)=>i.kind==='cut_plan')
 assert.equal((await r.advance(cut,2)).status,'needs_requirements',JSON.stringify(r.sqlErrors))
 const first:any=await r.advance(needs[0],2);assert.equal(first.status,'saved',JSON.stringify(r.sqlErrors));assert.equal(first.receipt.recordId,needs[0].output_id);assert.equal(first.receipt.revision,2)
 work=await r.changes(2);assert.equal(work.pending,2);assert.equal(work.items.find((i:any)=>i.id===needs[0].id).completed_revision,2)
 const retry:any=await r.advance(needs[0],2);assert.deepEqual(retry,first)
 const second:any=await r.advance(needs[1],2);assert.equal(second.status,'saved',JSON.stringify(r.sqlErrors));assert.equal(second.receipt.recordId,needs[1].output_id)
 const rebuilt:any=await r.advance(cut,2);assert.equal(rebuilt.status,'saved',JSON.stringify(r.sqlErrors));assert.equal(rebuilt.receipt.recordId,saved.recordId);assert.equal(rebuilt.receipt.revision,2)
 const calls=r.catalogReads();assert.deepEqual(await r.advance(cut,2),rebuilt);assert.equal(r.catalogReads(),calls,'lost-response retry must not compile or re-read catalog again')
 const plan=await f.read(saved.recordId);assert.equal(plan.artifact_revision,2);assert.equal(plan.source_state,'current');assert.equal(plan.layout.placements.find((p:any)=>p.instance_id==='foot').length_mm,240)
 assert.deepEqual(await f.read(saved.recordId,1),{...oldPlan,current_revision:2,source_state:'changed'})
 const readback=await r.changes(2);assert.equal(readback.status,'complete');assert.equal(readback.pending,0)
 for(const item of readback.items){assert.equal(item.state,'updated');assert.equal(item.completion_receipt.recordId,item.output_id);assert.equal(item.completed_revision,2);assert.equal(item.completion_receipt.dataset,item.kind==='requirement'?'requirements':'cut_plans')}
 assert.deepEqual((await f.pg.query('select * from bob.material_requirement_revisions where project_id=$1 and revision=1 order by requirement_id',[f.project])).rows,oldNeeds)
 assert.equal((await f.pg.query('select count(*)::int n from bob.materials where project_id=$1',[f.project])).rows[0].n,0)
 assert.equal((await f.pg.query('select count(*)::int n from bob.material_cut_plan_reservations where project_id=$1',[f.project])).rows[0].n,0)
 const bad={...r.continueInput(cut,2),change_note:'Same key, another intended operation',request_quote:f.message}
 assert.equal((await r.tools().construction.execute('continue_construction_change',bad)).status,'conflict')
 await assert.rejects(f.rpc('bob.prepare_construction_consequence',[...r.binding,JSON.stringify({...f.base,kind:'construction_consequence',record_id:f.construction.recordId,expected_revision:2,data:{...r.continueInput(cut,2),computed:{},extra:true}})]))
})

test('role deltas preserve geometry and history, retire an unneeded manufacturing need, and filter its old cutting grain',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f),saved=await r.write(f.payload),before=await r.read()
 const input={key:'retain-back',record_id:f.construction.recordId,expected_revision:1,changes:[{instance_id:'back',role:'existing_part',quantity_policy:'retain',reason:'The synthetic fixture explicitly retains this existing upright'}],change_note:'Retain the existing upright',request_quote:f.message}
 const role:any=await r.tools().construction.execute('change_construction_roles',input);assert.equal(role.status,'saved',JSON.stringify(r.sqlErrors))
 const after=await r.read();assert.deepEqual(after.recipe,before.recipe);assert.deepEqual(after.parameters,before.parameters);assert.deepEqual(after.joints,before.joints)
 assert.equal(after.instance_policy.instances.find((i:any)=>i.instance_id==='back').role,'existing_part');assert.deepEqual((await r.read(1)).instance_policy,before.instance_policy)
 assert.deepEqual(await r.tools().construction.execute('change_construction_roles',input),role)
 const work=await r.changes(2)
 for(const item of work.items.filter((i:any)=>i.kind==='requirement'))assert.equal((await r.advance(item,2)).status,'saved',JSON.stringify(r.sqlErrors))
 const retired=(await asProjectUser(f.pg,f.user,'select * from bob.current_material_requirements where id=$1',[f.needs[1].recordId])).rows[0];assert.equal(retired.archived,true);assert.equal(retired.revision,2)
 const updated:any=await r.advance(work.items.find((i:any)=>i.kind==='cut_plan'),2);assert.equal(updated.status,'saved',JSON.stringify(r.sqlErrors))
 const plan=await f.read(saved.recordId);assert.deepEqual(plan.layout.placements.map((p:any)=>p.instance_id),['foot']);assert.deepEqual(plan.blank_grain,[{definition_id:'base',axis:'x'}])
 assert.equal((await r.changes(2)).items.find((i:any)=>i.output_id===f.needs[1].recordId).state,'retired')
 const invalid={...input,key:'bad-role',expected_revision:2,changes:[{...input.changes[0],quantity_policy:'manufacture'}]}
 assert.equal((await r.tools().construction.execute('change_construction_roles',invalid)).status,'invalid')
 assert.equal((await r.read()).revision,2)
 assert.equal((await asProjectUser(f.pg,f.other,'select * from bob.construction_change_items where project_id=$1',[f.project])).rows.length,0)
 await assert.rejects(asProjectUser(f.pg,f.user,'update bob.construction_change_items set state=\'updated\' where project_id=$1',[f.project]),/permission denied/)
 await assert.rejects(asProjectUser(f.pg,f.user,'update bob.artifact_construction_instance_policies set policy=\'{}\' where project_id=$1',[f.project]),/permission denied/)
 await assert.rejects(f.rpc('bob.prepare_construction_role_change',[...r.binding,JSON.stringify({...f.base,kind:'construction_roles',record_id:f.construction.recordId,expected_revision:2,data:{key:'outside',changes:input.changes,change_note:'No access',computed:null}})],f.other),/project_denied|turn_not_claimed/)
})

test('unclassified history stays unknown; bounded classification and numeric writes inherit only the recorded policy',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f),legacyData=structuredClone(f.constructionData)
 delete legacyData.instance_policy;legacyData.key='legacy-fixture'
 const legacy=await r.write({...f.base,kind:'construction',data:legacyData})
 const read=()=>f.rpc('bob.read_construction_draft',[f.project,legacy.recordId,null,null])
 assert.equal((await read()).instance_policy,null)
 const fields={name:'Unknown blank',category:'Timber',area_id:null,task_id:null,waste_percent:'0',purchase_increment:'1',assumptions:'No inferred role',artifact_id:legacy.recordId,artifact_revision:1,target_revision:1,definition_id:'base',quantity_mode:'pieces',stock_allocations:[],component_allocations:[],change_note:'Explicit roles required'}
 await assert.rejects(r.write({...f.base,kind:'operational',data:{resource:'cad_requirement',action:'create',fields}}),/construction_instance_roles_required/)
 const node=legacyData.parameters.bindings.find((b:any)=>b.path==='definitions/base/x_mm').node
 const {construction}=r.tools()
 const numeric=await construction.execute('change_construction_parameters',{key:'legacy-width',record_id:legacy.recordId,expected_revision:1,changes:[{id:node,role:'decision',value:240,unit:'mm',reason:'Explicit fixture change'}],change_note:'Unknown roles remain unknown',request_quote:f.message})
 assert.equal(numeric.status,'saved');assert.equal((await read()).instance_policy,null)
 for(const [index,id] of ['foot','back'].entries()){
  const result=await r.tools().construction.execute('change_construction_roles',{key:'classify-'+id,record_id:legacy.recordId,expected_revision:index+2,changes:[{instance_id:id,role:'build_part',quantity_policy:'manufacture',reason:'Explicit synthetic classification'}],change_note:'Classify only the stated existing instance',request_quote:f.message})
  assert.equal(result.status,'saved',JSON.stringify(r.sqlErrors))
  const exact=await read()
  assert.equal(constructionLists(exact,f.catalog,[]).status,index===0?'needs_data':'derived')
 }
 for(const revision of [1,2])assert.equal((await f.rpc('bob.read_construction_draft',[f.project,legacy.recordId,revision,null])).instance_policy,null)
 assert.deepEqual((await r.read()).instance_policy,f.draft.instance_policy,'unrelated construction is unchanged')
 assert.equal((await r.changes(1)).status,'no_change_work')
})

test('reserved sheets block every linked consequence and retain capacity until their normal explicit release',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f),stockId=randomUUID()
 await f.rpc('bob.stock_command',[f.project,'create',stockId,0,JSON.stringify({name:'Retained test sheets',specification:'Specified',quantity:'3',unit:'pcs',status:'available',area_id:null,notes:'Not physically inspected',change_note:'Initial',sheet_format:{material_id:f.material.recordId,material_revision:1,length_mm:2440,width_mm:1220,thickness_mm:18,grain:'length',basis:'provided_spec',note:'Explicit fixture stock'}})])
 const p=structuredClone(f.payload);p.data.candidate_sources[0]={candidate_id:'sheet',kind:'stock',record_id:stockId,revision:1}
 const saved=await r.write(p)
 await f.rpc('bob.material_cut_plan_stock_command',[f.project,'reserve',saved.recordId,1,0,'Explicit fixture reservation'])
 const reserved=await f.read(saved.recordId),history=(await f.pg.query('select * from bob.material_cut_plan_reservation_revisions where project_id=$1',[f.project])).rows
 const input={key:'retain-back',record_id:f.construction.recordId,expected_revision:1,changes:[{instance_id:'back',role:'existing_part',quantity_policy:'retain',reason:'Explicitly retained'}],change_note:'Retain the existing upright',request_quote:f.message}
 assert.equal((await r.tools().construction.execute('change_construction_roles',input)).status,'saved')
 const work=await r.changes(2)
 for(const item of work.items){const result=await r.advance(item,2);assert.equal(result.status,'needs_commitment_review',JSON.stringify(r.sqlErrors));assert(result.blockers.some((b:any)=>b.kind==='stock_reservation'))}
 assert.deepEqual((await f.pg.query('select * from bob.material_cut_plan_reservation_revisions where project_id=$1',[f.project])).rows,history)
 assert.equal((await f.read(saved.recordId)).reservation.reserved,true);assert.deepEqual((await f.read(saved.recordId)).layout,reserved.layout)
 await f.rpc('bob.material_cut_plan_stock_command',[f.project,'release',saved.recordId,1,1,'Explicit fixture release after review'])
 for(const item of work.items.filter((i:any)=>i.kind==='requirement'))assert.equal((await r.advance(item,2)).status,'saved',JSON.stringify(r.sqlErrors))
 assert.equal((await r.advance(work.items.find((i:any)=>i.kind==='cut_plan'),2)).status,'saved',JSON.stringify(r.sqlErrors))
 assert.equal((await f.read(saved.recordId)).reservation.reserved,false);assert.equal((await r.changes(2)).pending,0)
})

test('committed Shopping survives a role change; continuation cannot withdraw it or create a replacement purchase',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f)
 const part=await r.write({...f.base,kind:'catalog',data:{action:'ensure',key:'panel',kind:'part',name:'Specified fixture panel',aliases:[],profile_code:'panel',profile_revision:1,categories:['wood.plywood','sheet'],properties:{length:{value:'2440',unit:'mm',truth:'provided_spec',parameter:null,note:''},width:{value:'1220',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:f.material.recordId,material_revision:1,notes:'No product verification',source_kind:'design_choice',source_quote:'existing blanks',source_seq:null}})
 const p=structuredClone(f.payload);p.data.candidate_sources[0]={candidate_id:'sheet',kind:'catalog_part',record_id:part.recordId,revision:1}
 const saved=await r.write(p),published=await f.rpc('bob.material_cut_plan_shopping_command',[f.project,'publish',saved.recordId,1,0,'Explicit fixture publication'])
 const mid=published.shopping.contributions[0].material_id
 await f.pg.query("update bob.materials set status='ordered' where id=$1",[mid])
 const shopping=(await f.pg.query('select * from bob.materials where project_id=$1',[f.project])).rows
 assert.equal((await r.tools().construction.execute('change_construction_roles',{key:'retain',record_id:f.construction.recordId,expected_revision:1,changes:[{instance_id:'back',role:'existing_part',quantity_policy:'retain',reason:'Explicit retained member'}],change_note:'Retain upright',request_quote:f.message})).status,'saved')
 const work=await r.changes(2)
 for(const item of work.items)assert.equal((await r.advance(item,2)).status,'needs_commitment_review',JSON.stringify(r.sqlErrors))
 await assert.rejects(f.rpc('bob.material_cut_plan_shopping_command',[f.project,'withdraw',saved.recordId,1,1,'Must not alter a purchased contribution']),/committed|purchase|shopping/)
 assert.deepEqual((await f.pg.query('select * from bob.materials where project_id=$1',[f.project])).rows,shopping)
 assert.equal((await r.changes(2)).pending,3);assert.equal((await f.read(saved.recordId)).shopping.published,true)
})

test('a changed head fences prepared work; an exact completed retry remains its original receipt even when superseded',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f),policy=(role:string,quantity_policy:string)=>[{instance_id:'back',role,quantity_policy,reason:'Explicit synthetic role decision'}]
 const input={key:'retain',record_id:f.construction.recordId,expected_revision:1,changes:policy('existing_part','retain'),change_note:'Keep the upright',request_quote:f.message}
 const payload={...f.base,kind:'construction_roles',record_id:input.record_id,expected_revision:1,data:{key:'prepared',changes:policy('prefabricated_part','complete_item'),change_note:'Explicit prepared request',computed:null}}
 assert.equal((await f.rpc('bob.prepare_construction_role_change',[...r.binding,JSON.stringify(payload)])).status,'ready')
 const first=await r.tools().construction.execute('change_construction_roles',input);assert.equal(first.status,'saved')
 await assert.rejects(r.write(payload),/construction_changed/)
 const pending=(await r.changes(2)).items.find((i:any)=>i.kind==='requirement')
 const continuation={...f.base,kind:'construction_consequence',record_id:f.construction.recordId,expected_revision:2,data:{key:'prepared-need',item_id:pending.id,action:'recalculate',review_note:null,output_revision:null,change_note:'Recalculate saved need',computed:null}}
 assert.equal((await f.rpc('bob.prepare_construction_consequence',[...r.binding,JSON.stringify(continuation)])).status,'ready')
 assert.equal((await r.tools().construction.execute('change_construction_roles',{...input,key:'prefabricated',expected_revision:2,changes:policy('prefabricated_part','complete_item')})).status,'saved')
 await assert.rejects(r.write(continuation),/construction_changed/)
 assert.equal((await r.changes(2)).status,'superseded')
 assert.deepEqual(await r.tools().construction.execute('change_construction_roles',input),first)
 assert.equal((await asProjectUser(f.pg,f.user,'select revision from bob.current_material_requirements where project_id=$1',[f.project])).rows.every((row:any)=>row.revision===1),true)
 const newWork=await r.changes(3);assert.equal(newWork.pending,2)
 await f.pg.query("update bob_private.bob_thread_provider_state set lock_started_at=now()-interval '6 minutes' where in_flight_turn_id=$1",[f.turn])
 await assert.rejects(f.rpc('bob.prepare_construction_consequence',[...r.binding,JSON.stringify({...continuation,expected_revision:3,data:{...continuation.data,item_id:newWork.items[0].id}})]),/turn_not_claimed/)
})

test('when every member is retained, the former cutting consequence is retired without altering its historical plan',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f),saved=await r.write(f.payload),original=await f.read(saved.recordId)
 assert.equal((await r.tools().construction.execute('change_construction_roles',{key:'retain-all',record_id:f.construction.recordId,expected_revision:1,changes:f.draft.recipe.instances.map((i:any)=>({instance_id:i.id,role:'existing_part',quantity_policy:'retain',reason:'Explicit synthetic retained member'})),change_note:'No new manufactured members',request_quote:f.message})).status,'saved')
 const work=await r.changes(2)
 for(const item of work.items.filter((i:any)=>i.kind==='requirement'))assert.equal((await r.advance(item,2)).status,'saved',JSON.stringify(r.sqlErrors))
 const retired=await r.advance(work.items.find((i:any)=>i.kind==='cut_plan'),2)
 assert.equal(retired.status,'saved',JSON.stringify(r.sqlErrors));assert.equal(retired.receipt.operation,'reused');assert.equal(retired.receipt.record.plan_changed,false)
 assert.deepEqual((await f.read(saved.recordId)).layout,original.layout);assert.equal((await f.read(saved.recordId)).artifact_revision,1);assert.equal((await f.read(saved.recordId)).source_state,'changed')
 assert.equal((await r.changes(2)).status,'complete');assert((await r.changes(2)).items.every((i:any)=>i.state==='retired'))
})

test('linked completed work requires an exact plan review and never changes performed or unrelated work',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f)
 const step=(title:string)=>({step_id:null,title,goal:title,state:'active',phase:'build',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'Synthetic work record',requirements:[]})
 const approve=async(expected:number,steps:any[])=>{
  const p=await f.rpc('bob_private.project_plan_propose',[f.project,expected,JSON.stringify({summary:'Synthetic plan',reason:'Explicit fixture',steps,task_links:[]})],f.user,'postgres')
  return (await f.rpc('bob_private.project_plan_decide',[f.project,expected,p.record.revision,'approve','Explicit fixture approval'],f.user,'postgres')).record
 }
 const initial=await approve(0,[step('Completed assembly'),step('Unrelated work')])
 const planned=await approve(1,initial.steps.map((s:any,index:number)=>({...step(s.title),step_id:s.id,state:index===0?'completed':s.state})))
 const sid=planned.steps[0].id
 await r.write({...f.base,kind:'drawing_link',record_id:f.construction.recordId,expected_revision:1,data:{step_id:sid,action:'link'}})
 const before=(await f.pg.query('select * from bob.project_plan_steps where project_id=$1 order by plan_revision,position',[f.project])).rows
 assert.equal((await r.tools().construction.execute('change_construction_roles',{key:'retain-back',record_id:f.construction.recordId,expected_revision:1,changes:[{instance_id:'back',role:'existing_part',quantity_policy:'retain',reason:'Explicit retained member'}],change_note:'Retain upright',request_quote:f.message})).status,'saved')
 const work=await r.changes(2),item=work.items.find((i:any)=>i.kind==='step')
 assert.equal(work.items.filter((i:any)=>i.kind==='step').length,1);assert.equal(item.output_id,sid)
 const gap=await r.advance(item,2);assert.equal(gap.status,'needs_work_review');assert.equal(gap.completed_work_preserved,true)
 const review={...r.continueInput(item,2,'work-review'),action:'record_work_review',review_note:'Reviewed the recorded change and updated needs; actual built work remains recorded and physical reinspection is unresolved.',output_revision:2,request_quote:f.message}
 assert.equal((await r.tools().construction.execute('continue_construction_change',review)).status,'needs_outputs')
 for(const need of work.items.filter((i:any)=>i.kind==='requirement'))assert.equal((await r.advance(need,2)).status,'saved',JSON.stringify(r.sqlErrors))
 assert.equal((await r.tools().construction.execute('continue_construction_change',{...review,output_revision:1})).status,'conflict')
 const saved=await r.tools().construction.execute('continue_construction_change',review);assert.equal(saved.status,'saved',JSON.stringify(r.sqlErrors));assert.equal(saved.receipt.record.performed_work_changed,false);assert.equal(saved.receipt.record.physical_verification,false)
 assert.deepEqual(await r.tools().construction.execute('continue_construction_change',review),saved)
 assert.deepEqual((await f.pg.query('select * from bob.project_plan_steps where project_id=$1 order by plan_revision,position',[f.project])).rows,before)
 const complete=await r.changes(2);assert.equal(complete.status,'complete');assert.equal(complete.items.find((i:any)=>i.id===item.id).state,'reviewed')
})

test('saved work is paged without omission and shares only compact public completion receipt headers',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f)
 const steps=Array.from({length:26},(_,i)=>({step_id:null,title:'Affected step '+i,goal:'Synthetic goal',state:'active',phase:'build',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'Synthetic pagination fixture',requirements:[]}))
 const p=await f.rpc('bob_private.project_plan_propose',[f.project,0,JSON.stringify({summary:'Synthetic larger plan',reason:'Pagination fixture',steps,task_links:[]})],f.user,'postgres')
 const plan=(await f.rpc('bob_private.project_plan_decide',[f.project,0,p.record.revision,'approve','Explicit fixture'],f.user,'postgres')).record
 // Fixture setup establishes existing public links without consuming a model
 // turn's eight-write budget. The caller still has SELECT-only on these rows.
 for(const s of plan.steps)await f.pg.query('insert into bob.artifact_step_links values($1,$2,$3)',[f.project,f.construction.recordId,s.id])
 assert.equal((await r.tools().construction.execute('change_construction_roles',{key:'retain',record_id:f.construction.recordId,expected_revision:1,changes:[{instance_id:'back',role:'existing_part',quantity_policy:'retain',reason:'Explicit retained fixture member'}],change_note:'Retain member',request_quote:f.message})).status,'saved')
 const first=await r.changes(2),second=await r.changes(2,first.next_cursor)
 assert.equal(first.total,28);assert.equal(first.items.length,24);assert.equal(first.truncated,true);assert.equal(second.items.length,4);assert.equal(second.truncated,false)
 const all=[...first.items,...second.items];assert.equal(new Set(all.map(i=>i.id)).size,28)
 for(const item of all.filter(i=>i.kind==='requirement'))assert.equal((await r.advance(item,2)).status,'saved')
 const a=await r.changes(2),b=await r.changes(2,a.next_cursor)
 for(const i of [...a.items,...b.items].filter(i=>i.kind==='requirement')){assert.equal(i.completed_revision,2);assert.equal(i.completion_receipt.recordId,i.output_id);assert(!Object.hasOwn(i.completion_receipt,'record'))}
 assert.doesNotMatch(JSON.stringify([a,b]),/request_quote|actor_id|thread_id|turn_id/)
})

test('legacy unclassified plans cannot create new commitments but existing held capacity can be released without rewriting history',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f),stock=randomUUID()
 await f.rpc('bob.stock_command',[f.project,'create',stock,0,JSON.stringify({name:'Legacy stock fixture',specification:'Explicit fixture',quantity:'2',unit:'pcs',status:'available',area_id:null,notes:'Fixture',change_note:'Initial',sheet_format:{material_id:f.material.recordId,material_revision:1,length_mm:2440,width_mm:1220,thickness_mm:18,grain:'length',basis:'provided_spec',note:'Legacy fixture format'}})])
 const p=structuredClone(f.payload);p.data.candidate_sources[0]={candidate_id:'sheet',kind:'stock',record_id:stock,revision:1}
 const saved=await r.write(p);await f.rpc('bob.material_cut_plan_stock_command',[f.project,'reserve',saved.recordId,1,0,'Prior fixture reservation'])
 const history=(await f.pg.query('select * from bob.material_cut_plan_revisions where project_id=$1',[f.project])).rows
 // Emulate the precise pre-D storage shape in this disposable fixture only.
 await f.pg.query('delete from bob.artifact_construction_instance_policies where artifact_id=$1',[f.construction.recordId])
 const unknown=await f.read(saved.recordId);assert.equal(unknown.instance_role_state,'unknown');assert.equal(unknown.source_state,'changed');assert.equal(unknown.stock_reserved,false);assert.equal(unknown.reservation.reserved,true)
 assert.equal(unknown.supply.commitments_current,false)
 await assert.rejects(f.rpc('bob.material_cut_plan_stock_command',[f.project,'reserve',saved.recordId,1,1,'No inferred roles']),/construction_instance_roles_required/)
 await assert.rejects(f.rpc('bob.material_cut_plan_shopping_command',[f.project,'publish',saved.recordId,1,0,'No inferred roles']),/construction_instance_roles_required/)
 await f.rpc('bob.material_cut_plan_stock_command',[f.project,'release',saved.recordId,1,1,'Explicit legacy release'])
 assert.equal((await f.read(saved.recordId)).reservation.reserved,false)
 assert.deepEqual((await f.pg.query('select * from bob.material_cut_plan_revisions where project_id=$1',[f.project])).rows,history)
 assert.equal((await r.read()).instance_policy,null)
})

test('a linked need without a recorded model returns a review gap; an explicit code-derived model closes that same item',async t=>{
 const f=await cutPlanFixture(t),r=runtime(f),id=randomUUID()
 await f.rpc('bob.material_requirement_command',[f.project,'create',id,0,JSON.stringify({name:'Explicit legacy allowance',category:'Timber',area_id:null,task_id:null,unit:'pcs',required_quantity:'99',waste_percent:'0',purchase_increment:'1',basis:'Provided fixture allowance; formula inputs absent',assumptions:'No implicit reconstruction',artifact_id:f.construction.recordId,artifact_revision:1,target_revision:1,stock_allocations:[],component_allocations:[],change_note:'Initial'})])
 const original=(await f.pg.query('select * from bob.material_requirement_revisions where requirement_id=$1',[id])).rows
 assert.equal((await r.tools().construction.execute('change_construction_roles',{key:'retain-back',record_id:f.construction.recordId,expected_revision:1,changes:[{instance_id:'back',role:'existing_part',quantity_policy:'retain',reason:'Explicit retained member'}],change_note:'Retain member',request_quote:f.message})).status,'saved')
 const item=(await r.changes(2)).items.find((i:any)=>i.output_id===id);assert(item)
 assert.equal((await r.advance(item,2)).status,'needs_requirement_model')
 assert.deepEqual((await f.pg.query('select * from bob.material_requirement_revisions where requirement_id=$1',[id])).rows,original)
 const fields={name:'Explicit legacy allowance',category:'Timber',area_id:null,task_id:null,waste_percent:'0',purchase_increment:'1',assumptions:'Explicitly selected new area model',artifact_id:f.construction.recordId,artifact_revision:2,target_revision:1,definition_id:'base',quantity_mode:'area_xy',stock_allocations:[],component_allocations:[],change_note:'Select the code-executed area model, not a parsed historical formula'}
 const calculated=await r.write({...f.base,kind:'operational',record_id:id,expected_revision:1,data:{resource:'cad_requirement',action:'revise',fields}})
 assert.equal(calculated.recordId,id);assert.equal(calculated.record.required_quantity,0.02);assert.equal(calculated.record.method_version,'2')
 const back=(await r.changes(2)).items.find((i:any)=>i.id===item.id);assert.equal(back.state,'updated');assert.equal(back.completed_revision,2)
 assert.deepEqual((await f.pg.query('select * from bob.material_requirement_revisions where requirement_id=$1 and revision=1',[id])).rows,original)
})
