import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {compileConstructionParameterChange} from '../supabase/functions/_shared/construction-parameters.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {createConstructionTools,checkedConstructionForDrawing} from '../supabase/functions/_shared/construction-draft.ts'
import {createProjectWriter} from '../supabase/functions/_shared/project-write.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {seedToolPolicy} from '../supabase/functions/_shared/project-answer.ts'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
import {designIntent,designManifest} from './support/design-intent-fixture.ts'
import {drawingCandidateCommitment} from '../supabase/functions/_shared/drawing-request-recovery.ts'

test('legacy transition uses canonical geometry, exact receipts and guarded same-identity drawing publication',async t=>{
 const pg=await projectSchema(undefined,'20261013175429_ai_drawing_intent_catalog.sql');t.after(()=>pg.close());const owner=randomUUID(),outsider=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'legacy-owner@example.test',outsider,'legacy-outsider@example.test'])
 const rpc=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const historicalGuard=readFileSync('supabase/migrations/20261011090115_construction_instance_roles.sql','utf8').match(/create or replace function bob_private\.validate_cad_construction_source\(\) returns trigger[\s\S]+?end \$\$;/)![0]
 const fixture=async()=>{
  // Seed genuine legacy geometry under its historical publication policy, then
  // apply the mandatory source before every transition/render/publication case.
  await pg.exec(historicalGuard)
  const message='Connect my existing drawing to a construction and correct its dimensions.',project=(await rpc(owner,'bob.create_project',[JSON.stringify({name:'Legacy fixture'})])).id,solution=randomUUID(),turn=randomUUID()
  await rpc(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Bracket',description:'Synthetic',assumptions:'Unknown strength',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
  await rpc(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic target'})])
  const claim=await rpc(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role'),binding=[project,claim.thread_id,turn,claim.generation]
  const write=(p:any)=>rpc(owner,'bob.bob_project_write_v16',[...binding,JSON.stringify(p)])
  const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'mat',kind:'material',name:'Plywood concept',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
  const at=(x:number)=>({x,y:0,z:0,rx:0,ry:0,rz:0}),recipe:any={contract_version:1,units:'mm',assembly_id:'bracket',definitions:[
   {id:'uprightDef',primitive:'box',material_ref:'legacyLabel',x_mm:18,y_mm:18,z_mm:100},{id:'armDef',primitive:'box',material_ref:'legacyLabel',x_mm:100,y_mm:18,z_mm:18}],
   instances:[{id:'upright',definition_id:'uprightDef',placement:at(0)},{id:'arm',definition_id:'armDef',placement:at(18)}],views:['front','top']}
  const parameters=compileCadParameters(project,recipe,parameterPlan(recipe),new Map(),new Map())
  const baseManifest={...designManifest(project,solution),assembly_id:recipe.assembly_id,engine:{name:'build123d'},bob_parameters:parameters,bob_lineage:buildCadLineage(project,recipe,[],new Map(),handoff.coordinates)}
  const saveDrawing=async(input:any)=>{
   const requestId=randomUUID(),scope={area_id:null,component_id:null,step_id:null,artifact_id:input.record_id}
   await rpc(owner,'bob.create_drawing_request',[...binding,requestId,JSON.stringify(scope)])
   const payload={brief:{...scope,brief:message,handoff},owner_request:message,reference_refs:[],reviewed_candidate:drawingCandidateCommitment(input.data)}
   const reviewed=await rpc(null,'bob.bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'save',requestId,0,'reviewed',JSON.stringify(payload),'reviewed:'+requestId],'service_role')
   const data={...input.data,drawing_request:{id:requestId,revision:reviewed.revision}}
   return write({...input,data})
  }
  const legacyInput:any={kind:'cad',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{title:'Legacy bracket',description:'Synthetic saved concept',assumptions:'No fabrication approval',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,packet:{recipe,manifest:baseManifest,files:{front:'PHN2Zy8+'}}}}
  const legacy=await saveDrawing(legacyInput)
  await pg.exec(readFileSync('supabase/migrations/20261014062043_checked_construction_required.sql','utf8'))
  const readDrawing=(id=legacy.recordId,revision:number|null=null)=>rpc(owner,'bob.read_cad_artifact',[project,id,revision])
  const readConstruction=(id:string,revision:number|null=null)=>rpc(owner,'bob.read_construction_draft',[project,id,revision,null])
  const materials=recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}))
  const joints=[{id:'corner',method:'screwed_butt',first:{instance_id:'upright',face:'x_max'},second:{instance_id:'arm',face:'x_min'},reason:'Explicit synthetic design choice; hardware remains open'}]
  const input:any={key:'transition',record_id:legacy.recordId,expected_revision:1,target_revision:1,construction_id:null,construction_revision:null,materials,joints,open_questions:['Hardware and strength unchecked'],change_note:'Retain existing geometry',request_quote:message}
  const payload=(v:any)=>{const {record_id,expected_revision,request_quote,...data}=v;return {kind:'legacy_construction',record_id,expected_revision,expected_updated_at:null,request_quote,data}}
  const prepare=(p:any)=>rpc(owner,'bob.prepare_legacy_construction_transition',[...binding,JSON.stringify(p)])
  const writer=createProjectWriter(project,message,async p=>{try{return {data:await write(p),error:null}}catch(e:any){return {data:null,error:{code:e.code,message:e.message}}}},async()=>({data:[],error:null}),async()=>({data:[],error:null}))
  const options={projectId:project,message,writer,hasAccess:async()=>true,prepareLegacyTransition:prepare,read:(id:string|null,revision:number|null)=>rpc(owner,'bob.read_construction_draft',[project,id,revision,null]),
   readCatalog:(id:string,revision:number)=>rpc(owner,'bob.catalog_read',[project,JSON.stringify({action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})]),
   readSources:async()=>{throw Error('Legacy preparation must not manufacture or recompile geometry in the model handler')}}
  const tools=createConstructionTools(options)
  return {project,solution,message,binding,write,recipe,parameters,materials,joints,legacy,legacyInput,input,payload,prepare,writer,tools,options,readDrawing,readConstruction,saveDrawing}
 }

 await t.test('all missing metadata is returned together; model geometry and guessed identities cannot be supplied',async()=>{
  const f=await fixture(),missing={...f.input,materials:null,joints:null,open_questions:null}
  const result=await f.tools.execute('transition_legacy_drawing',missing);assert.equal(result.status,'needs_data')
  assert.deepEqual(result.issues.map((i:any)=>i.code),['material_pins_required','joint_evidence_required','open_questions_required'])
  assert.equal((await pg.query('select count(*) n from bob.artifact_construction_revisions where project_id=$1',[f.project])).rows[0].n,0)
  assert.equal((await f.tools.execute('transition_legacy_drawing',{...f.input,recipe:f.recipe})).status,'invalid')
  await assert.rejects(f.write({...f.payload(f.input),data:{...f.payload(f.input).data,recipe:f.recipe}}),/invalid_legacy_transition/)
  await assert.rejects(f.write(f.payload({...f.input,materials:f.materials.map((m:any)=>({...m,material_id:randomUUID()}))})),/construction_material|material/)
 })

 await t.test('canonical transition, lost-response retry, render failure/retry and exact drawing history',async()=>{
  const f=await fixture(),original=await f.readDrawing()
  const bench=createBobToolSession({message:f.message,writer:f.writer,constructionTools:f.tools,readPolicy:seedToolPolicy,lookup:createProjectLookup(f.project,async()=>({data:[],error:null}),async()=>({data:[],error:null}))})
  assert((await bench.prepare()).some(tool=>tool.function.name==='transition_legacy_drawing'))
  const result=await f.tools.execute('transition_legacy_drawing',f.input);assert.equal(result.status,'saved',JSON.stringify(result));const id=result.receipt.recordId
  const prepared=await f.prepare(f.payload(f.input));assert.equal(prepared.status,'saved');assert.deepEqual(prepared.receipt,result.receipt)
  assert.deepEqual(await f.write(f.payload(f.input)),prepared.receipt)
  assert.deepEqual(await f.readDrawing(),{...original,construction_transition:{project_id:f.project,artifact_id:id,revision:1,drawing_artifact_id:f.legacy.recordId,drawing_revision:1,archived:false}})
  const draft=await f.readConstruction(id);assert.deepEqual(draft.parameters,f.parameters)
  assert.deepEqual(draft.recipe,{...f.recipe,definitions:f.recipe.definitions.map((d:any)=>({...d,material_ref:null}))})
  const again=await f.tools.execute('transition_legacy_drawing',{...f.input,key:'another-turn-key'});assert.equal(again.status,'already_prepared');assert.equal(again.construction_source.artifact_id,id)
  assert.equal((await pg.query('select count(*) n from bob.artifact_construction_origins where project_id=$1',[f.project])).rows[0].n,1)
  const height=f.parameters.bindings.find(b=>b.path==='definitions/uprightDef/z_mm')!.node
  const changes=[{id:height,role:'decision' as const,value:90,unit:'mm' as const,reason:'Explicit synthetic height correction'}]
  const computed=await compileConstructionParameterChange(f.project,draft,changes,async()=>({project:new Map(),physical:new Map()}))
  await f.write({kind:'construction_parameters',record_id:id,expected_revision:1,expected_updated_at:null,request_quote:f.message,data:{key:'height',change_note:'Lower saved construction',changes,computed}})
  const request={request_id:null,brief:f.message,handoff,artifact_id:f.legacy.recordId,construction_revision:2,area_id:null,component_id:null,step_id:null}
  let state:any=null,broken=true,renders=0,reviews=0,changedBeforeDispatch=true
  const store={load:async()=>structuredClone(state),save:async(requestId:any,revision:any,status:any,payload:any)=>{state={id:requestId??randomUUID(),revision:revision+1,status,payload:structuredClone(payload)};return structuredClone(state)}}
  const assistant=()=>createCadAssistant({projectId:f.project,userId:owner,ownerRequest:f.message,hasAccess:async()=>true,available:true,deadline:Date.now()+200000,requestStore:store,runtimeVersion:async()=>broken?'broken-fixture':'fixed-fixture',
   makeLookup:()=>createProjectLookup(f.project,async(_p,i)=>({data:{records:i.dataset==='target'?[{id:'project',revision:1,solution_id:f.solution}]:[],related:[],truncated:false},error:null}),1000,40),
   readArtifact:async(artifact,revision,fresh)=>artifact===id?{...await f.readConstruction(id,revision),source_kind:'construction'}:({...await f.readDrawing(artifact,revision),...(fresh&&changedBeforeDispatch?{revision:99}:{})}),
   checkConstruction:()=>checkedConstructionForDrawing(f.options,id,2),
   callModel:async(o,guard)=>{await guard?.();assert.equal(o.aiFunction,'cad-reviewer');reviews++;return reviewReply(handoff)},
   render:async(recipe,source,guard)=>{await guard?.();renders++;assert.deepEqual(source,{artifact_id:id,revision:2});if(broken)throw Error('Synthetic render failure');return {recipe,manifest:{bounding_box_mm:{min:[0,0,0],max:[118,18,90],size:[118,18,90]},checks:{collisions:{status:'complete',overlaps:[]}},annotations:{version:1,coverage:'complete'},drawing_source:source,engine:{name:'build123d'},assembly_id:recipe.assembly_id},files:{front:'PHN2Zy8+'},previews:Object.fromEntries(recipe.views.map(v=>[v,'PHN2Zy8+']))}},
  })
  const interrupted=await assistant().consult(request);assert.notEqual(interrupted.status,'ready');assert.equal(renders,0);assert.equal(reviews,0,'changed legacy head blocks actual paid dispatch')
  changedBeforeDispatch=false;state=null
  const first=await assistant().consult(request);assert.equal(first.stage,'cad_engine');assert.equal(reviews,0);assert.equal(state.payload.brief.construction_revision,2)
  broken=false;const a=assistant(),resumed=await a.consult({...request,request_id:state.id});assert.equal(resumed.status,'ready',JSON.stringify(resumed));assert.equal(renders,2);assert.equal(reviews,1)
  assert.equal(a.candidate!.artifact_id,f.legacy.recordId);assert.equal(a.candidate!.expected_revision,1)
  const candidate=a.candidate!,next={...f.legacyInput,record_id:f.legacy.recordId,expected_revision:1,data:{...candidate}}
  const saved=await f.saveDrawing(next);assert.equal(saved.recordId,f.legacy.recordId);assert.equal(saved.revision,2)
  const current=await f.readDrawing();assert.deepEqual(current.construction_source,{project_id:f.project,artifact_id:id,revision:2});assert.equal(current.construction_transition,null)
  assert.deepEqual((await f.readDrawing(f.legacy.recordId,1)).recipe,original.recipe)
  assert.equal((await pg.query('select count(*) n from bob.artifact_construction_revisions where project_id=$1',[f.project])).rows[0].n,2)
  assert.equal((await pg.query('select count(*) n from bob.artifact_cad_revisions where project_id=$1',[f.project])).rows[0].n,2)
  assert.deepEqual((await f.prepare(f.payload(f.input))).receipt,result.receipt,'exact replay survives the drawing head change')
  assert.equal((await asProjectUser(pg,outsider,'select * from bob.artifact_construction_origins where project_id=$1',[f.project])).rows.length,0)
  await assert.rejects(asProjectUser(pg,owner,'delete from bob.artifact_construction_origins where project_id=$1',[f.project]),/permission denied/)
  await assert.rejects(rpc(outsider,'bob.prepare_legacy_construction_transition',[...f.binding,JSON.stringify(f.payload(f.input))]),/project_denied|turn_claim|denied/)
  await assert.rejects(rpc(null,'bob.prepare_legacy_construction_transition',[...f.binding,JSON.stringify(f.payload(f.input))],'anon'),/permission denied/)
  await assert.rejects(rpc(owner,'bob.prepare_legacy_construction_transition',[...f.binding.slice(0,3),f.binding[3]+1,JSON.stringify(f.payload(f.input))]),/turn_claim|generation|claim/)
  await pg.query('delete from bob.projects where id=$1',[f.project])
  assert.equal((await pg.query('select count(*) n from bob.artifact_construction_origins where project_id=$1',[f.project])).rows[0].n,0,'normal project removal cascades origin metadata')
 })

 await t.test('two prepared operations produce one checkpoint and stable retries; altered keys or source heads conflict',async()=>{
  const f=await fixture(),first=f.payload(f.input),second=f.payload({...f.input,key:'second'})
  assert.equal((await f.prepare(first)).status,'ready');assert.equal((await f.prepare(second)).status,'ready')
  const saved=await f.write(first);await assert.rejects(f.write(second),/legacy_transition_already_prepared/)
  await assert.rejects(f.write(f.payload({...f.input,change_note:'different command'})),/operation_reused/)
  assert.deepEqual(await f.write(first),saved)
  assert.equal((await pg.query('select count(*) n from bob.artifact_construction_revisions where project_id=$1',[f.project])).rows[0].n,1)
  const stale=await fixture(),p=stale.payload(stale.input);assert.equal((await stale.prepare(p)).status,'ready')
  await rpc(owner,'bob.artifact_command',[stale.project,'archive',stale.legacy.recordId,1,'{}'])
  await assert.rejects(stale.write(p),/legacy_drawing_changed/)
  assert.equal((await pg.query('select count(*) n from bob.artifact_construction_revisions where project_id=$1',[stale.project])).rows[0].n,0)
 })

 await t.test('matching existing construction is reused; mismatched geometry and missing historical graph remain honest',async()=>{
  const f=await fixture(),recipe={...f.recipe,definitions:f.recipe.definitions.map((d:any)=>({...d,material_ref:null}))}
  const existing=await f.write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:f.message,data:{key:'existing',title:'Existing matching checkpoint',description:'Synthetic',area_id:null,target_revision:1,change_note:'Initial',recipe,parameters:f.parameters,materials:f.materials,joints:f.joints,open_questions:['Hardware unchecked']}})
  const checked=await checkedConstructionForDrawing(f.options,existing.recordId,1);assert.equal(checked.status,'ready')
  const pin={version:1,project_id:f.project,artifact_id:existing.recordId,revision:1,check:checked.checked}
  const premature={...f.legacyInput,record_id:f.legacy.recordId,expected_revision:1,data:{...f.legacyInput.data,artifact_id:f.legacy.recordId,expected_revision:1,
   packet:{...f.legacyInput.data.packet,recipe,manifest:{...f.legacyInput.data.packet.manifest,bob_construction:pin,annotations:{version:1,coverage:'complete'},drawing_source:{artifact_id:existing.recordId,revision:1}}}}}
  await assert.rejects(f.saveDrawing(premature),/legacy_construction_transition_required/)
  assert.equal((await f.readDrawing()).revision,1)
  const wrong=structuredClone(recipe);wrong.definitions[1].x_mm=101
  const different=await f.write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:f.message,data:{key:'different',title:'Different geometry',description:'Synthetic',area_id:null,target_revision:1,change_note:'Initial',recipe:wrong,parameters:compileCadParameters(f.project,wrong,parameterPlan(wrong),new Map(),new Map()),materials:f.materials,joints:f.joints,open_questions:[]}})
  await assert.rejects(f.prepare(f.payload({...f.input,construction_id:different.recordId,construction_revision:1,materials:null,joints:null,open_questions:null})),/legacy_construction_mismatch/)
  const reuse={...f.input,construction_id:existing.recordId,construction_revision:1,materials:null,joints:null,open_questions:null}
  const before=(await pg.query('select count(*) n from bob.artifact_construction_revisions where project_id=$1',[f.project])).rows[0].n
  await assert.rejects(f.write(f.payload({...reuse,key:'existing'})),/operation_reused/,'cannot rewrite an earlier ordinary construction receipt')
  const result=await f.tools.execute('transition_legacy_drawing',reuse);assert.equal(result.status,'saved',JSON.stringify(result));assert.equal(result.receipt.recordId,existing.recordId);assert.equal(result.receipt.operation,'reused')
  assert.equal((await pg.query('select count(*) n from bob.artifact_construction_revisions where project_id=$1',[f.project])).rows[0].n,before)
  const old=await fixture()
  // An isolated historical packet predating parameter provenance, never a new production write.
  await pg.exec("alter table bob.artifact_cad_revisions disable trigger validate_cad_parameter_lineage")
  await pg.query("update bob.artifact_cad_revisions set manifest=manifest-'bob_parameters' where project_id=$1",[old.project])
  await pg.exec("alter table bob.artifact_cad_revisions enable trigger validate_cad_parameter_lineage")
  const gap=await old.tools.execute('transition_legacy_drawing',old.input);assert.equal(gap.status,'needs_data');assert(gap.issues.some((i:any)=>i.code==='parameter_graph_required'))
  assert.equal((await pg.query('select count(*) n from bob.artifact_construction_origins where project_id=$1',[old.project])).rows[0].n,0)
 })
})
