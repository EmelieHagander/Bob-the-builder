import {designIntent,designManifest} from './support/design-intent-fixture.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'
import {checkedConstructionForDrawing} from '../supabase/functions/_shared/construction-draft.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {buildCadLineage} from '../supabase/functions/_shared/cad-lineage.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import { shapeId,handoff,reviewReply} from './support/cad-review-fixture.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {drawingCandidateCommitment} from '../supabase/functions/_shared/drawing-request-recovery.ts'
import {BobContinuation,createBobJournal,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'

const artifact='11111111-1111-4111-8111-111111111111',material='22222222-2222-4222-8222-222222222222'
function fixture(projectId='p_fixture'){
 const recipe:any={contract_version:1,units:'mm',assembly_id:'bracket',definitions:[
  {id:'upright',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200},
  {id:'arm',primitive:'box',material_ref:null,x_mm:100,y_mm:80,z_mm:18}],instances:[
  {id:'upright',definition_id:'upright',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}},
  {id:'arm',definition_id:'arm',placement:{x:18,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']}
 const draft:any={status:'ok',projectId,artifact_id:artifact,revision:1,current_revision:1,archived:false,source_state:'current',source_kind:'construction',target_revision:1,area_id:null,
  title:'Bracket',description:'Synthetic concept',recipe,parameters:compileCadParameters(projectId,recipe,parameterPlan(recipe),new Map(),new Map()),
  materials:recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:material,material_revision:1,part_id:null,part_revision:null})),
  joints:[{id:'corner',method:'screwed_butt',first:{instance_id:'upright',face:'x_max'},second:{instance_id:'arm',face:'x_min'},reason:'Concept'}],open_questions:['Fasteners and strength remain unverified']}
 const catalog=new Map([[material+'@1',{id:material,revision:1,current_revision:1,kind:'material',profile_code:'sheet_stock',categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null}}}]])
 return {draft,catalog}
}
function runtime(){
 const {draft,catalog}=fixture();let allowed=true,reads=0,renders=0,reviews=0,afterRender=()=>{},afterReview=()=>{},verdict='pass'
 const check=()=>checkedConstructionForDrawing({projectId:draft.projectId,message:'Draw this construction',hasAccess:async()=>allowed,read:async()=>{reads++;return structuredClone(draft)},
  readCatalog:async(id,revision)=>({status:'ok',projectId:draft.projectId,record:catalog.get(id+'@'+revision)}),readSources:async()=>({project:new Map(),physical:new Map()})},artifact,1)
 const assistant=(extra:any={})=>createCadAssistant({research:false,projectId:draft.projectId,userId:'owner',ownerRequest:'Draw this exact bracket',hasAccess:async()=>allowed,available:true,deadline:Date.now()+200000,
  makeLookup:()=>createProjectLookup(draft.projectId,async(_p,i)=>({data:{records:i.dataset==='target'?[{id:'project',revision:1,solution_id:material}]:[],related:[],truncated:false},error:null}),1000,40),
  readArtifact:async()=>structuredClone(draft),checkConstruction:check,
  render:async recipe=>{renders++;afterRender();return {recipe,manifest:{bounding_box_mm:checkConstruction(draft,catalog,'2026-10-04').bounds_mm,checks:{collisions:{status:'complete',overlaps:[]}},annotations:{version:1,coverage:'complete'},engine:{name:'build123d'},assembly_id:recipe.assembly_id},files:{front:'Zml4dHVyZQ=='},previews:Object.fromEntries(recipe.views.map(v=>[v,'Zml4dHVyZQ==']))}},
  callModel:async o=>{assert.equal(o.aiFunction,'cad-reviewer','construction rendering must not call a geometry designer');reviews++;const r=reviewReply(handoff);if(verdict!=='pass')r.data=JSON.stringify({verdict:'revise',summary:'Fix annotation',requirements:[{id:shapeId,status:'met',evidence:'geometry correct'}],issues:[{severity:'error',code:'readability',correction:'Make label readable'}]});afterReview();return r},...extra,
 })
 return {draft,catalog,assistant,check,setAllowed:(v:boolean)=>{allowed=v},afterRender:(f:()=>void)=>{afterRender=f},afterReview:(f:()=>void)=>{afterReview=f},reject:()=>{verdict='revise'},counts:()=>({reads,renders,reviews})}
}
const request={request_id:null,brief:'Draw this exact bracket',handoff,artifact_id:artifact,area_id:null,component_id:null,step_id:null}
test('K3 uses exact checked checkpoint geometry and full parameter history; reviewer sees joints, material sources and exact pixels',async()=>{
 const f=runtime(),a=f.assistant(),original=structuredClone(f.draft)
 assert.equal((await a.consult(request)).status,'ready');assert.equal(f.counts().renders,1);assert.equal(f.counts().reviews,1)
 assert.deepEqual(a.candidate!.packet.recipe,original.recipe);assert.deepEqual(a.candidate!.packet.manifest.bob_parameters,original.parameters)
 assert.equal(a.candidate!.artifact_id,null,'the construction stays the source, rather than being overwritten by a drawing')
 const pin=a.candidate!.packet.manifest.bob_construction
 assert.equal(pin.artifact_id,artifact);assert.equal(pin.revision,1);assert.equal(pin.check.concept_ready,true);assert.equal(pin.check.fabrication_ready,false)
 assert.deepEqual(f.draft,original)
})
test('K3 cannot render a stale, unchecked, colliding or jointless checkpoint',async()=>{
 for(const mutate of [(d:any)=>d.source_state='changed',(d:any)=>d.current_revision=2,(d:any)=>d.recipe.instances[1].placement.x=10,(d:any)=>d.joints=[]]){
  const f=runtime();mutate(f.draft);const a=f.assistant(),result=await a.consult(request)
  assert.equal(result.stage,'construction');assert.equal(a.candidate,null);assert.equal(f.counts().renders,0);assert.equal(f.counts().reviews,0)
 }
})
test('K3 compares journal-normalized and fresh JSON snapshots by values, preserving every construction field',async()=>{
 const f=runtime(),entries:JournalEntry[]=[],journal=createBobJournal({entries,save:async e=>{entries.push(e)}},Infinity)
 const a=f.assistant({readArtifact:()=>journal.run('read',{},async()=>structuredClone(f.draft))})
 assert.equal((await a.consult(request)).status,'ready')
 assert.equal(f.counts().renders,1);assert.equal(f.counts().reviews,1)
})
test('K3 replay preserves a completed failure after a later checkpoint repair without changing the next Bob input',async()=>{
 for(const checkpoint of [false,true]){
 const f=runtime(),entries:JournalEntry[]=[];f.draft.joints=[];let bobCalls=0
 const run=async()=>{
  const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},Infinity)
  const a=f.assistant({readArtifact:()=>journal.run('read',{},async()=>structuredClone(f.draft)),
   checkConstruction:(id:string,revision:number)=>checkpoint?journal.run('check',{id,revision},f.check):f.check()})
  const reply=await a.consult(request)
  await journal.run('bob-model',reply,async()=>{bobCalls++;return 'repair checkpoint'})
  return reply
 }
 const first=await run();assert.equal(first.status,'needs_data')
 f.draft.joints=fixture().draft.joints;f.draft.current_revision=2
 if(!checkpoint){await assert.rejects(run(),/continuation_changed/);assert.equal(bobCalls,1);continue}
 assert.deepEqual(await run(),first);assert.equal(bobCalls,1);assert.equal(f.counts().renders,0)
 }
})
test('K3 accepts reordered objects but stops changed geometry, parameters, material pins, joints and targets',async()=>{
 for(const mutate of [(d:any)=>{d.recipe.definitions.forEach((r:any)=>r.y_mm=81)},(d:any)=>d.parameters.nodes[0].reason='changed',
  (d:any)=>d.materials.reverse(),(d:any)=>d.joints[0].reason='changed',(d:any)=>d.target_revision=2]){
  const f=runtime(),original=structuredClone(f.draft);mutate(f.draft)
  const a=f.assistant({readArtifact:async()=>original})
  assert.equal((await a.consult(request)).stage,'construction');assert.equal(a.candidate,null);assert.equal(f.counts().renders,0)
 }
})
test('K3 completed replay survives a later source revision, while suspended new render/review dispatch rechecks live sources',async()=>{
 for(const pause of [null,'render','review']){
  const f=runtime(),entries:JournalEntry[]=[];let suspended=pause,renders=0,reviews=0
  const run=async()=>{
   const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},suspended?1000:Infinity,()=>0)
   const a=f.assistant({readArtifact:()=>journal.run('read',{},async()=>structuredClone(f.draft)),
    checkConstruction:(id:string,revision:number,fresh:boolean)=>fresh?f.check():journal.run('gate',{id,revision},f.check),
    render:(recipe:any,source:any,guard?:()=>Promise<void>)=>journal.run('render',{recipe,source},async()=>{
     await guard?.();renders++
     return {recipe,manifest:{bounding_box_mm:checkConstruction(f.draft,f.catalog,'2026-10-04').bounds_mm,checks:{collisions:{status:'complete',overlaps:[]}},annotations:{version:1,coverage:'complete'}},files:{front:'Zml4dHVyZQ=='},previews:Object.fromEntries(recipe.views.map((v:string)=>[v,'Zml4dHVyZQ==']))}
    },suspended==='render'?1000:0),
    callModel:(options:any,guard?:()=>Promise<void>)=>journal.run('review',options,async()=>{await guard?.();reviews++;return reviewReply(handoff)},suspended==='review'?1000:0)})
   const result=await a.consult(request)
   if(result.status==='ready')await journal.run('next-bob-input',result,async()=> 'continue')
   return {result,candidate:a.candidate}
  }
  let original:any
  if(pause)await assert.rejects(run(),BobContinuation)
  else {original=await run();assert.equal(original.result.status,'ready')}
  f.draft.current_revision=2;suspended=null
  const resumed=await run()
  if(pause){assert.equal(resumed.result.stage,'construction');assert.equal(resumed.candidate,null)}
  else assert.deepEqual(resumed.result,original.result,'historical reply must not rewrite the next recorded Bob model input')
  assert.equal(renders,pause==='render'?0:1);assert.equal(reviews,pause?0:1)
 }
})
test('K3 rechecks after render and after provider review; changed source and lost authority fence publication',async()=>{
 for(const stage of ['render','review','authority']){
  const f=runtime();if(stage==='render')f.afterRender(()=>{f.draft.current_revision=2})
  if(stage==='review')f.afterReview(()=>{f.draft.current_revision=2})
  if(stage==='authority')f.afterReview(()=>f.setAllowed(false))
  const a=f.assistant()
  if(stage==='authority')await assert.rejects(a.consult(request),/project_denied/)
  else assert.equal((await a.consult(request)).stage,'construction')
  assert.equal(a.candidate,null);assert.equal(f.counts().reviews,stage==='render'?0:1)
 }
})
test('K3 review rejection returns to checkpoint or renderer repair without inventing another construction',async()=>{
 const f=runtime();f.reject();const a=f.assistant(),result=await a.consult(request)
 assert.equal(result.status,'needs_data');assert.equal(a.candidate,null);assert.equal(f.counts().renders,1);assert.equal(f.counts().reviews,1)
 assert.match(result.next_action,/same K2 checkpoint/)
})
test('an unchanged rejected K3 request resumes its recorded result without another render or paid review',async()=>{
 const f=runtime();f.reject();let saved:any=null
 const store={load:async()=>structuredClone(saved),save:async(id:any,revision:any,status:any,payload:any)=>{
  saved={id:id??'33333333-3333-4333-8333-333333333333',revision:revision+1,status,payload:structuredClone(payload)};return structuredClone(saved)
 }}
 const a=f.assistant({requestStore:store,runtimeVersion:async()=>'same-renderer'})
 assert.equal((await a.consult(request)).status,'needs_data');assert(saved.payload.retry)
 const before=f.counts(),resumed=await f.assistant({requestStore:store,runtimeVersion:async()=>'same-renderer'}).consult({...request,request_id:saved.id})
 assert.equal(resumed.retry_suppressed,true);assert.equal(f.counts().renders,before.renders);assert.equal(f.counts().reviews,before.reviews)
})
test('K3 SQL ties drawing receipt/readback to current construction, rejects changed geometry and preserves history',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close());const owner=randomUUID(),outsider=randomUUID(),turn=randomUUID(),message='Save my synthetic construction and drawing.'
 const rpc=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'k3-owner@example.test',outsider,'k3-other@example.test'])
 const project=(await rpc(owner,'bob.create_project',[JSON.stringify({name:'K3 fixture'})])).id,solution=randomUUID()
 await rpc(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Bracket',description:'Synthetic',assumptions:'Unknown strength',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
 await rpc(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Synthetic target'})])
 const claim=await rpc(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 const write=(p:any)=>rpc(owner,'bob.bob_project_write_v14',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)])
 const mat=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'mat',kind:'material',name:'Plywood concept',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const {draft,catalog}=fixture(project);draft.materials.forEach((m:any)=>m.material_id=mat.recordId)
 const source={kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'checkpoint',title:draft.title,description:draft.description,area_id:null,target_revision:1,change_note:'Initial',recipe:draft.recipe,parameters:draft.parameters,materials:draft.materials,joints:draft.joints,open_questions:draft.open_questions}}
 const checkpoint=await write(source);draft.artifact_id=checkpoint.recordId
 const checked=checkConstruction(draft,new Map([[mat.recordId+'@1',{...catalog.get(material+'@1'),id:mat.recordId}]]),'2026-10-04');assert.equal(checked.concept_ready,true)
 const manifest:any={...designManifest(project,solution),assembly_id:draft.recipe.assembly_id,engine:{name:'build123d'},bob_parameters:draft.parameters,bob_lineage:buildCadLineage(project,draft.recipe,[],new Map(),handoff.coordinates),annotations:{version:1,coverage:'complete'},drawing_source:{artifact_id:checkpoint.recordId,revision:1},bob_construction:{version:1,project_id:project,artifact_id:checkpoint.recordId,revision:1,check:checked}}
 const drawing:any={kind:'cad',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{title:'Bracket drawing',description:'Synthetic concept',assumptions:'Not fabrication ready',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[],area_id:null,component_id:null,step_id:null,artifact_id:null,expected_revision:0,packet:{recipe:draft.recipe,manifest,files:{front:'PHN2Zy8+'}}}}
 for(const change of [(p:any)=>p.data.packet.recipe.instances[1].placement.x=19,(p:any)=>p.data.packet.manifest.bob_construction.check.concept_ready=false,(p:any)=>p.data.packet.manifest.bob_construction.revision=2,(p:any)=>delete p.data.packet.manifest.annotations]){
  const bad=structuredClone(drawing);change(bad);await assert.rejects(write(bad),/drawing_must_reuse_construction|invalid_construction_check|construction_source_changed|construction_annotations_required/)
 }
 const requestId=randomUUID(),scope={area_id:null,component_id:null,step_id:null,artifact_id:checkpoint.recordId}
 await rpc(owner,'bob.create_drawing_request',[project,claim.thread_id,turn,claim.generation,requestId,JSON.stringify(scope)])
 const working={brief:{...scope,brief:message,handoff},owner_request:message,reference_refs:[],reviewed_candidate:drawingCandidateCommitment(drawing.data)}
 const reviewed=await rpc(null,'bob.bob_drawing_request',[project,owner,claim.thread_id,turn,claim.generation,'save',requestId,0,'reviewed',JSON.stringify(working),'reviewed'],'service_role')
 drawing.data.drawing_request={id:requestId,revision:reviewed.revision}
 const saved=await write(drawing);assert.deepEqual(await write(drawing),saved)
 const delivered=await rpc(owner,'bob.project_drawing_requests',[project,requestId,null])
 assert.equal(delivered.requests[0].status,'saved');assert.equal(delivered.requests[0].artifact_id,saved.recordId)
 const read=(uid=owner,revision:number|null=null)=>rpc(uid,'bob.read_cad_artifact',[project,saved.recordId,revision])
 const back=await read();assert.deepEqual(back.recipe,draft.recipe);assert.deepEqual(back.manifest.bob_construction,manifest.bob_construction)
 await assert.rejects(read(outsider),/project_denied/);await assert.rejects(read(null as any),/project_denied/)
 const revise=structuredClone(source);revise.record_id=checkpoint.recordId;revise.expected_revision=1;revise.data.key='revision';revise.data.change_note='New description';revise.data.description='Revised concept'
 await write(revise)
 const stale=structuredClone(drawing);delete stale.data.drawing_request;stale.data.title='Stale drawing'
 await assert.rejects(write(stale),/construction_source_changed/)
 const state=(await asProjectUser(pg,owner,'select source_state,source_reasons from bob.artifact_source_status where artifact_id=$1 and revision=1',[saved.recordId])).rows[0]
 assert.equal(state.source_state,'changed');assert((state.source_reasons as string[]).includes('construction_source_changed'))
 assert.deepEqual((await read(owner,1)).recipe,draft.recipe)
})
