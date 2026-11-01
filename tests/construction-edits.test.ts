import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {designIntent} from './support/design-intent-fixture.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {CONSTRUCTION_EDIT_TOOL} from '../supabase/functions/_shared/construction-edits.ts'
import {createAiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'
import {catalogFixture,preConstructionEditsCatalogFixture,preKonradLeanCatalogFixture} from './support/ai-catalog-fixture.ts'
import {CAD_PARAMETERS_SCHEMA,withDefaultZeroText} from '../supabase/functions/_shared/cad-parameters.ts'
import {CAD_ARRAYS_SCHEMA} from '../supabase/functions/_shared/cad-arrays.ts'
import {withChosenJointFasteners} from '../supabase/functions/_shared/construction-fasteners.ts'
import {withConstructionWorkWrite} from '../supabase/functions/_shared/construction-work.ts'
import {withConstructionText} from '../supabase/functions/_shared/construction-text.ts'
import {createConstructionTools} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {seedToolPolicy} from '../supabase/functions/_shared/project-answer.ts'
import {BobContinuation} from '../supabase/functions/_shared/bob-job-journal.ts'

function assembly(){
 const at=(x:number)=>({x,y:0,z:0,rx:0,ry:0,rz:0})
 const recipe:any={contract_version:1,units:'mm',assembly_id:'frame',definitions:[
  {id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200},
  {id:'board',primitive:'box',material_ref:null,x_mm:564,y_mm:80,z_mm:18}],
  instances:[{id:'left',definition_id:'side',placement:at(0)},{id:'right',definition_id:'side',placement:at(582)},{id:'bottom',definition_id:'board',placement:at(18)}],views:['front','top']}
 const plan=parameterPlan(recipe)
 const board=plan.bindings.find(b=>b.path==='definitions/board/x_mm')!,right=plan.bindings.find(b=>b.path==='instances/right/placement/x')!
 plan.nodes=plan.nodes.filter(n=>n.id!==board.node&&n.id!==right.node)
 plan.nodes.unshift({id:'width',role:'decision',value:600,unit:'mm',reason:'Synthetic delegated design choice'},
  {id:'sideThickness',role:'decision',value:18,unit:'mm',reason:'Synthetic panel choice'},
  {id:'two',role:'decision',value:2,unit:'scalar',reason:'Two existing side instances'},
  {id:'bothSides',role:'derived',operation:'multiply_v1',operands:['sideThickness','two'],rounding:'exact'},
  {id:board.node,role:'derived',operation:'subtract_v1',operands:['width','bothSides'],rounding:'exact'},
  {id:right.node,role:'derived',operation:'subtract_v1',operands:['width','sideThickness'],rounding:'exact'})
 return {recipe,plan}
}

test('bounded construction edits preserve canonical data, receipts and authority',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID(),turn=randomUUID(),message='Create this synthetic frame and change its width within my design choices.'
 const rpc=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'parameter-owner@example.test',outsider,'parameter-outsider@example.test'])
 const project=(await rpc(owner,'bob.create_project',[JSON.stringify({name:'Parameter change fixture'})])).id,solution=randomUUID()
 await rpc(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Frame',description:'Synthetic only',assumptions:'Strength unknown',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
 await rpc(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic design'})])
 const claim=await rpc(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role'),binding=[project,claim.thread_id,turn,claim.generation]
 const write=(p:any)=>rpc(owner,'bob.bob_project_write_v16',[...binding,JSON.stringify(p)])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Synthetic plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:'my design choices',source_seq:null}})
 const {recipe,plan}=assembly()
 const data:any={key:'initial',title:'Frame checkpoint',description:'Synthetic concept; no fabrication approval',area_id:null,target_revision:1,change_note:'Initial',recipe,
  parameters:compileCadParameters(project,recipe,plan,new Map(),new Map()),materials:recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null})),
  joints:[{id:'leftJoint',method:'screwed_butt',first:{instance_id:'left',face:'x_max'},second:{instance_id:'bottom',face:'x_min'},reason:'Synthetic concept'},
   {id:'rightJoint',method:'screwed_butt',first:{instance_id:'bottom',face:'x_max'},second:{instance_id:'right',face:'x_min'},reason:'Synthetic concept'}],open_questions:['Hardware and strength unchecked']}
 data.instance_policy={version:1,instances:recipe.instances.map((i:any)=>({instance_id:i.id,role:'build_part',quantity_policy:'manufacture',reason:'Explicit synthetic manufactured frame part'}))}
 const initial=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data})
 const id=initial.recordId,read=(revision:number|null=null)=>rpc(owner,'bob.read_construction_draft',[project,id,revision,null])
 const before=await read();let sourceReads=0,allowed=true
 const readSources=async(pins:any)=>{
  sourceReads++;const rows=(await asProjectUser(pg,owner,'select * from bob.current_measurements where project_id=$1',[project])).rows
  return {project:new Map(rows.map((r:any)=>[r.id,r])),physical:new Map()}
 }
 const sqlErrors:string[]=[]
 const writer=()=>createProjectWriter(project,message,async p=>{try{return {data:await write(p),error:null}}catch(e:any){sqlErrors.push([e.message,e.detail,e.where].filter(Boolean).join(' / '));return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
 const tools=()=>createConstructionTools({projectId:project,message,writer:writer(),hasAccess:async()=>allowed,read:(_id,revision)=>read(revision),readSources,
  prepareEdit:async p=>{try{return await rpc(owner,'bob.prepare_construction_edit',[...binding,JSON.stringify(p)])}catch(e:any){return {status:e.code==='PT409'?'conflict':e.code==='42501'?'denied':'invalid',reason:e.message}}}})
 const delta=(upsert:any[]=[],remove:string[]=[])=>({upsert,remove})
 const extra:any={contract_version:1,units:'mm',assembly_id:'frame',definitions:[{id:'drawer',primitive:'box',material_ref:null,x_mm:100,y_mm:80,z_mm:18}],
  instances:[1,2,3].map(n=>({id:'drawer'+n,definition_id:'drawer',placement:{x:1000+n*120,y:0,z:0,rx:0,ry:0,rz:0}})),views:['front','top']}
 const extraPlan=parameterPlan(extra)
 const changes:any={definitions:delta(extra.definitions),instances:delta(extra.instances),nodes:delta(extraPlan.nodes),bindings:delta(extraPlan.bindings),
  materials:delta([{definition_id:'drawer',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}]),
  roles:delta(extra.instances.map((i:any)=>({instance_id:i.id,role:'unknown',quantity_policy:'unknown',reason:'Synthetic drawer volumes; manufacturing role is not established'})))}
 const input:any={key:'threeDrawers',record_id:id,expected_revision:1,change_note:'Add three drawer volumes only',changes,request_quote:message}
 const payload=(v:any)=>({kind:'construction_edit',record_id:v.record_id,expected_revision:v.expected_revision,expected_updated_at:null,request_quote:v.request_quote,
  data:{key:v.key,change_note:v.change_note,changes:v.changes,computed:null}})
 const prepare=(p:any)=>rpc(owner,'bob.prepare_construction_edit',[...binding,JSON.stringify(p)])
 const computedPayload=async(v:any)=>{
  const p:any=payload(v),r=await prepare(p);assert.equal(r.status,'ready',JSON.stringify(r))
  const recipe=structuredClone(r.next.recipe)
  p.data.computed={recipe,parameters:compileCadParameters(project,recipe,r.next.parameter_plan,new Map(),new Map())}
  return p
 }
 let added:any
 await t.test('catalog publication and fixture agree; old pinned catalogs cannot load the new handler',async()=>{
  const manifest=await rpc(null,'shared.resolve_ai_catalog',['bob'],'service_role')
  const current=createAiCatalogSession({rpc:async()=>{throw new Error('Pinned')}},{app:'bob',manifest})
  for(const key of ['tools.edit_construction_parts','bob.workflows']){
   assert.deepEqual(current.definition(key).definition,catalogFixture().definition(key).definition,key)
   assert.deepEqual(current.definition(key).metadata,catalogFixture().definition(key).metadata,key)
  }
  // 2026-10-29: new manifests also carry corrected title/description text with a change.
  // 2026-11-01 (bob-konrad-lean-v1): chosen joint fasteners and auto-zero wording on top.
  const former={path:(CAD_PARAMETERS_SCHEMA.properties.bindings as any).items.properties.path.description,arrays:CAD_ARRAYS_SCHEMA.description}
  const textEdit=withConstructionText(withConstructionWorkWrite(CONSTRUCTION_EDIT_TOOL)).function.parameters
  assert.deepEqual(preKonradLeanCatalogFixture().tool('edit_construction_parts').function.parameters,textEdit)
  assert.deepEqual(current.tool('edit_construction_parts').function.parameters,withDefaultZeroText(withChosenJointFasteners(textEdit),former))
  const options={message,writer:writer(),constructionTools:tools(),lookup:createProjectLookup(project,async()=>({data:[],error:null}),async()=>({data:[],error:null})),readPolicy:seedToolPolicy}
  const old=createBobToolSession({...options,aiCatalog:preConstructionEditsCatalogFixture()})
  assert(!(await old.prepare()).some(t=>t.function.name==='edit_construction_parts'))
 })
 await t.test('new command adds three volumes and preserves every old post and metadata',async()=>{
  const instance=tools(),session=createBobToolSession({message,writer:writer(),constructionTools:instance,lookup:createProjectLookup(project,async()=>({data:[],error:null}),async()=>({data:[],error:null})),readPolicy:seedToolPolicy})
  assert((await session.prepare()).some(t=>t.function.name==='edit_construction_parts'))
  const {request_quote,...args}=input
  added=await session.execute('edit_construction_parts',args)
  assert.equal(added.status,'saved',JSON.stringify({added,sqlErrors}));assert.equal(added.receipt.revision,2)
  const after=await read()
  for(const field of ['title','description','area_id','target_revision','joints','open_questions'])assert.deepEqual(after[field],before[field],field)
  for(const [a,b,key] of [[before.recipe.definitions,after.recipe.definitions,'id'],[before.recipe.instances,after.recipe.instances,'id'],
   [before.parameters.nodes,after.parameters.nodes,'id'],[before.parameters.bindings,after.parameters.bindings,'path'],[before.materials,after.materials,'definition_id'],
   [before.instance_policy.instances,after.instance_policy.instances,'instance_id']] as any[])for(const row of a)assert.deepEqual(b.find((v:any)=>v[key]===row[key]),row)
  assert.equal(after.recipe.instances.length,before.recipe.instances.length+3)
  assert.deepEqual(after.instance_policy.instances.slice(-3).map((r:any)=>r.role),['unknown','unknown','unknown'])
  assert.deepEqual((await read(1)).recipe,before.recipe)
  const changes=(await rpc(owner,'bob.read_construction_changes',[project,id,2,null]))
  assert.equal(changes.revision,2,'ordinary downstream change work remains attached')
 })
 await t.test('lost acknowledgement and restored tool state reuse the exact receipt without compiling or writing again',async()=>{
  const used=tools();const state=used.exportState();const resumed=tools();resumed.restoreState(state)
  const calls=sourceReads
  assert.deepEqual(await resumed.execute('edit_construction_parts',input),added)
  assert.equal(sourceReads,calls)
  assert.equal((await read()).revision,2)
  const receipts=(await pg.query("select count(*) n from bob_private.bob_write_receipts where turn_id=$1 and operation_key like 'construction_edit:%'",[turn])).rows
  assert.equal(Number(receipts[0].n),1)
  assert.equal((await tools().execute('edit_construction_parts',{...input,change_note:'Different intention with reused key'})).status,'conflict')
 })
 await t.test('stale heads, missing notes, empty edits and ambiguous IDs make no changes',async()=>{
  assert.equal((await tools().execute('edit_construction_parts',{...input,key:'stale'})).status,'conflict')
  const {change_note,...missing}=input
  const invalid=await tools().execute('edit_construction_parts',{...missing,key:'noNote',expected_revision:2})
  assert.deepEqual(invalid.issues,[{path:'$.change_note',expected:'required field'}])
  for(const changes of [{},{instances:delta()},{instances:delta([extra.instances[0]])},{instances:delta([],['notThere'])},{instances:delta([extra.instances[0],extra.instances[0]])},
   {instances:delta([extra.instances[0]],['drawer1'])}])assert.equal((await tools().execute('edit_construction_parts',{...input,key:'invalid',expected_revision:2,changes})).status,'invalid')
  assert.equal((await read()).revision,2)
 })
 await t.test('self joints and dangling dependencies identify posts before writes',async()=>{
  const j={...before.joints[0],second:before.joints[0].first}
  const out=await tools().execute('edit_construction_parts',{...input,key:'self',expected_revision:2,changes:{joints:delta([j])}})
  assert(out.issues.some((i:any)=>i.code==='joint_self_connection'&&i.path==='joints/'+j.id))
  const missing=await tools().execute('edit_construction_parts',{...input,key:'dangling',expected_revision:2,changes:{instances:delta([],['left'])}})
  assert(missing.issues.some((i:any)=>i.code==='joint_endpoint_missing'))
  const role=await tools().execute('edit_construction_parts',{...input,key:'noRole',expected_revision:2,changes:{instances:delta([{...extra.instances[0],id:'unclassified'}])}})
  assert(role.issues.some((i:any)=>i.code==='instance_role_missing'))
  assert.equal((await read()).revision,2)
 })
 await t.test('new catalog diagnostics also pinpoint self joints on the full creation path before source reads or writes',async()=>{
  const guarded=createConstructionTools({projectId:project,message,writer:writer(),hasAccess:async()=>true,read:(_id,r)=>read(r),readSources,preciseEditDiagnostics:true,
   readDesignReadiness:(targetRevision,purpose,areaId)=>rpc(owner,'bob.read_design_readiness',[project,areaId??null,targetRevision,purpose])})
  const {parameters,...raw}=data
  const calls=sourceReads
  const out=await guarded.execute('save_construction_draft',{...raw,key:'newSelf',record_id:null,expected_revision:0,parameter_plan:plan,request_quote:message,
   joints:[{...before.joints[0],second:before.joints[0].first}]})
  assert.equal(out.status,'invalid');assert(out.issues.some((i:any)=>i.code==='joint_self_connection'&&i.path==='joints/leftJoint'))
  assert.equal(sourceReads,calls);assert.equal((await read()).revision,2)
 })
 await t.test('unknown controlling input returns a gap rather than inventing a value',async()=>{
  const n=extraPlan.nodes[0]
  const out=await tools().execute('edit_construction_parts',{...input,key:'unknown',expected_revision:2,changes:{nodes:delta([{id:n.id,role:'unknown',unit:'mm',reason:'Missing controlling dimension'}])}})
  assert.equal(out.status,'needs_data');assert.equal(out.reason,'unknown_required_parameters');assert.equal((await read()).revision,2)
 })
 await t.test('direct RPC rejects self joints, identity repurposing and forged compiled fields',async()=>{
  const valid={...input,key:'forged',expected_revision:2,changes:{nodes:delta([{...extraPlan.nodes[0],value:110}])}}
  const p=await computedPayload(valid)
  for(const mutate of [(x:any)=>x.data.computed.recipe.instances.pop(),(x:any)=>x.data.computed.parameters.bindings[0].node='width',
   (x:any)=>x.data.computed.parameters.nodes[0].normalized.value=999,(x:any)=>x.data.computed.parameters.nodes[0].reason='Not in command']){
   const forged=structuredClone(p);mutate(forged);await assert.rejects(write(forged),/parameter_change_topology|parameter_result_mismatch|construction_edit_compilation_mismatch/)
  }
  const self=await computedPayload({...valid,changes:{joints:delta([{...before.joints[0],second:before.joints[0].first}])}})
  await assert.rejects(write(self),/invalid_joint/)
  const retarget=await computedPayload({...valid,changes:{joints:delta([{...before.joints[0],second:before.joints[1].second}])}})
  await assert.rejects(write(retarget),/construction_identity_reused/)
  assert.equal((await read()).revision,2)
 })
 await t.test('small numeric correction keeps other data and invalidates a simultaneously prepared old head',async()=>{
  const edit={...input,key:'correct',expected_revision:2,changes:{nodes:delta([{...extraPlan.nodes[0],value:110}])}}
  const stale=await computedPayload({...edit,key:'concurrent'})
  const result=await tools().execute('edit_construction_parts',edit)
  assert.equal(result.status,'saved',JSON.stringify({result,sqlErrors}));assert.equal(result.receipt.revision,3)
  await assert.rejects(write(stale),/construction_changed/)
  const after=await read();assert.equal(after.recipe.definitions.find((d:any)=>d.id==='drawer').x_mm,110)
  assert.deepEqual(after.joints,before.joints)
  assert.deepEqual(await tools().execute('edit_construction_parts',input),added,'old accepted receipt survives later head')
 })
 await t.test('explicit dependency removals restore original geometry; no silent cascade',async()=>{
  const changes={definitions:delta([],['drawer']),instances:delta([],extra.instances.map((i:any)=>i.id)),nodes:delta([],extraPlan.nodes.map(n=>n.id)),
   bindings:delta([],extraPlan.bindings.map(b=>b.path)),materials:delta([],['drawer']),roles:delta([],extra.instances.map((i:any)=>i.id))}
  const out=await tools().execute('edit_construction_parts',{...input,key:'removeDrawers',expected_revision:3,changes})
  assert.equal(out.status,'saved',JSON.stringify({out,sqlErrors}));assert.equal(out.receipt.revision,4)
  const after=await read();assert.deepEqual(after.recipe,before.recipe);assert.deepEqual(after.materials,before.materials);assert.deepEqual(after.joints,before.joints)
 })
 await t.test('interruption after actual SQL commit but before acknowledgement creates exactly one revision on recovery',async()=>{
  const edit={...input,key:'lostAck',expected_revision:4,changes:{nodes:delta([{id:'width',role:'decision',value:650,unit:'mm',reason:'Synthetic correction'}])}}
  let committed=0
  const interruptedWriter=createProjectWriter(project,message,async p=>{await write(p);committed++;throw new BobContinuation('yield')},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
  const beforeWriter=interruptedWriter.exportState()
  const interrupted=createConstructionTools({projectId:project,message,writer:interruptedWriter,hasAccess:async()=>true,read:(_id,r)=>read(r),readSources,prepareEdit:prepare})
  const beforeTools=interrupted.exportState()
  await assert.rejects(interrupted.execute('edit_construction_parts',edit),BobContinuation)
  assert.equal(committed,1);assert.equal((await read()).revision,5)
  const recoveryWriter=writer();recoveryWriter.restoreState(beforeWriter)
  const recovered=createConstructionTools({projectId:project,message,writer:recoveryWriter,hasAccess:async()=>true,read:(_id,r)=>read(r),readSources,prepareEdit:prepare})
  recovered.restoreState(beforeTools);const calls=sourceReads
  const receipt=await recovered.execute('edit_construction_parts',edit)
  assert.equal(receipt.status,'saved');assert.equal(receipt.receipt.revision,5);assert.equal(sourceReads,calls)
  assert.equal((await read()).revision,5)
  assert.equal(Number((await pg.query("select count(*) n from bob_private.bob_write_receipts where turn_id=$1 and operation_key='construction_edit:lostAck'",[turn])).rows[0].n),1)
 })
 await t.test('revoked access or claim cannot prepare, commit or replay a receipt',async()=>{
  await assert.rejects(rpc(outsider,'bob.prepare_construction_edit',[...binding,JSON.stringify(payload(input))]),/project_denied|turn_not_claimed/)
  const edit={...input,key:'denied',expected_revision:5,changes:{nodes:delta([{id:'width',role:'decision',value:660,unit:'mm',reason:'Synthetic correction'}])}}
  const p=await computedPayload(edit)
  allowed=false;assert.equal((await tools().execute('edit_construction_parts',edit)).status,'denied');allowed=true
  const guarded=createConstructionTools({projectId:project,message,writer:writer(),hasAccess:async()=>allowed,read:(_id,r)=>read(r),readSources,
   prepareEdit:async p=>{const result=await prepare(p);allowed=false;return result}})
  assert.equal((await guarded.execute('edit_construction_parts',edit)).status,'denied');allowed=true
  await assert.rejects(rpc(owner,'bob.bob_project_write_v16',[project,claim.thread_id,turn,claim.generation+1,JSON.stringify(p)]),/turn_not_claimed/)
  await assert.rejects(rpc(outsider,'bob.bob_project_write_v16',[...binding,JSON.stringify(p)]),/project_denied|turn_not_claimed/)
  assert.equal((await read()).revision,5)
 })
 await t.test('canonical sources reject forged snapshots and drift between prepare and commit; accepted receipts still replay',async()=>{
  const measurement=randomUUID(),fact={subject:'Synthetic outer width',value:'600',unit:'mm',truth:'provided_spec',source:'Synthetic fixture specification',notes:'',required:true}
  await rpc(owner,'bob.evidence_command',[project,'measurement','create',measurement,0,JSON.stringify({...fact,area_id:null,component_id:null})])
  const snapshot:any=(await asProjectUser(pg,owner,'select * from bob.current_measurements where id=$1',[measurement])).rows[0]
  const second=assembly();second.plan.nodes=second.plan.nodes.map(n=>n.id==='width'?{id:'width',role:'source',source:{kind:'project_measurement',id:measurement,revision:1}}:n)
  const d={...data,key:'source',recipe:second.recipe,parameters:compileCadParameters(project,second.recipe,second.plan,new Map([[measurement,snapshot]]),new Map())}
  const checkpoint=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:d})
  const edit={...input,key:'sourceEdit',record_id:checkpoint.recordId,expected_revision:1,changes:{nodes:delta([{id:'sideThickness',role:'decision',value:19,unit:'mm',reason:'Synthetic correction'}])}}
  const p:any=payload(edit),prepared=await prepare(p),compiledRecipe=structuredClone(prepared.next.recipe)
  p.data.computed={recipe:compiledRecipe,parameters:compileCadParameters(project,compiledRecipe,prepared.next.parameter_plan,new Map([[measurement,snapshot]]),new Map())}
  const forged=structuredClone(p);forged.data.computed.parameters.nodes.find((n:any)=>n.id==='width').sources[0].value='900'
  await assert.rejects(write(forged),/parameter_source_mismatch/)
  const saved=await tools().execute('edit_construction_parts',edit);assert.equal(saved.status,'saved',JSON.stringify({saved,sqlErrors}));assert.equal(saved.receipt.revision,2)
  const stale:any=payload({...edit,key:'staleSource',expected_revision:2,changes:{nodes:delta([{id:'sideThickness',role:'decision',value:20,unit:'mm',reason:'Synthetic correction'}])}})
  const next=await prepare(stale),recipe=structuredClone(next.next.recipe)
  stale.data.computed={recipe,parameters:compileCadParameters(project,recipe,next.next.parameter_plan,new Map([[measurement,snapshot]]),new Map())}
  await rpc(owner,'bob.evidence_command',[project,'measurement','revise',measurement,1,JSON.stringify({...fact,value:'620',change_note:'Canonical source changed during edit'})])
  await assert.rejects(write(stale),/construction_changed|source_changed/)
  assert.equal((await rpc(owner,'bob.read_construction_draft',[project,checkpoint.recordId,null,null])).revision,2)
  const calls=sourceReads;assert.deepEqual(await tools().execute('edit_construction_parts',edit),saved);assert.equal(sourceReads,calls)
 })
 await t.test('default zero (2026-11-01): a new part binds only its non-zero values; removing it drops the unused code zero',async()=>{
  // A fresh claimed turn: earlier cases spend this turn's write allowance.
  await rpc(null,'bob.bob_fail_turn_v2',[project,owner,claim.thread_id,turn,claim.generation],'service_role')
  const fresh=randomUUID(),next=await rpc(null,'bob.bob_claim_turn',[project,owner,fresh,message],'service_role'),bound=[project,next.thread_id,fresh,next.generation]
  const zeroWriter=()=>createProjectWriter(project,message,async p=>{try{return {data:await rpc(owner,'bob.bob_project_write_v16',[...bound,JSON.stringify(p)]),error:null}}catch(e:any){sqlErrors.push(e.message);return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
  const zeroTools=(defaultZero:boolean)=>createConstructionTools({projectId:project,message,writer:zeroWriter(),hasAccess:async()=>true,read:(_id,revision)=>read(revision),readSources,defaultZero,
   prepareEdit:async p=>{try{return await rpc(owner,'bob.prepare_construction_edit',[...bound,JSON.stringify(p)])}catch(e:any){return {status:'invalid',reason:e.message}}}})
  const head=(await read()).revision
  const shelf={id:'shelf',definition_id:'board',placement:{x:18,y:0,z:100,rx:0,ry:0,rz:0}}
  const changes:any={instances:delta([shelf]),nodes:delta([{id:'shelfHeight',role:'decision',value:100,unit:'mm',reason:'Synthetic shelf height'}]),
   bindings:delta([{path:'instances/shelf/placement/x',node:'sideThickness'},{path:'instances/shelf/placement/z',node:'shelfHeight'}]),
   roles:delta([{instance_id:'shelf',role:'build_part',quantity_policy:'manufacture',reason:'Synthetic shelf'}])}
  const add={...input,key:'zeroShelf',expected_revision:head,change_note:'Add one shelf',changes}
  const old=await zeroTools(false).execute('edit_construction_parts',add)
  assert.equal(old.status,'invalid','pinned turns keep the old rule');assert.equal((await read()).revision,head)
  const saved=await zeroTools(true).execute('edit_construction_parts',{...add,key:'zeroShelf2'})
  assert.equal(saved.status,'saved',JSON.stringify({saved,sqlErrors}));assert.equal(saved.receipt.revision,head+1)
  const after=await read(),node=(path:string)=>after.parameters.bindings.find((b:any)=>b.path===path)?.node
  assert.equal(node('instances/shelf/placement/y'),'origin.zero_mm');assert.equal(node('instances/shelf/placement/ry'),'origin.zero_deg')
  assert.equal(node('instances/shelf/placement/z'),'shelfHeight')
  // Konrad removes only the bindings he made; code removes its zero bindings of the gone part.
  const remove={...input,key:'zeroShelfGone',expected_revision:head+1,change_note:'Remove the shelf',changes:{instances:delta([],['shelf']),nodes:delta([],['shelfHeight']),
   bindings:delta([],['x','z'].map(k=>'instances/shelf/placement/'+k)),roles:delta([],['shelf'])}}
  const gone=await zeroTools(true).execute('edit_construction_parts',remove)
  assert.equal(gone.status,'saved',JSON.stringify({gone,sqlErrors}))
  const last=await read()
  assert.equal(last.parameters.nodes.some((n:any)=>n.id.startsWith('origin.')),last.parameters.bindings.some((b:any)=>b.node.startsWith('origin.')))
  assert(!last.parameters.bindings.some((b:any)=>b.path.startsWith('instances/shelf/')))
 })
})
