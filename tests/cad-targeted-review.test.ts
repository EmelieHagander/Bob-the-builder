import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCadAssistant,fixtureDesignReadiness} from './support/colleague-catalog-fixture.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {shapeId,handoff,reviewReply} from './support/cad-review-fixture.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'
import {checkedConstructionForDrawing} from '../supabase/functions/_shared/construction-draft.ts'
import {compileCadParameters} from '../supabase/functions/_shared/cad-parameters.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {constructionEvidenceBinding,constructionEvidenceContract} from '../supabase/functions/_shared/construction-evidence.ts'
import {drawingCatalogConfiguration} from '../supabase/functions/_shared/drawing-runtime.ts'
import {buildCadReviewPacket,codeFindingReview,formEvidenceCoverage,parseTargetedCadReview,CAD_TARGETED_REVIEW_ROLE,CAD_TARGETED_REVIEW_SCHEMA} from '../supabase/functions/_shared/cad-targeted-review.ts'
import type {DesignHandoff} from '../supabase/functions/_shared/cad-review.ts'
import {parseTargetedReviewRecord} from '../supabase/functions/_shared/cad-targeted-review.ts'
import {isDrawingModelCall} from '../supabase/functions/_shared/bob-model-budget.ts'

const artifact='11111111-1111-4111-8111-111111111111',material='22222222-2222-4222-8222-222222222222'
const today=new Date().toISOString().slice(0,10)
const feature={id:'f1',description:'Leave clear space in front of the drawer',basis:'user_request' as const,source_ref:null}
const resultId='cs_'+'a'.repeat(64)

/** The inert publication with its role enabled, as the later approved
 * enablement would publish it. The published role is disabled. */
function targetedCatalog(){
 return catalogFixture(snapshot=>{
  const role=snapshot.definitions.find(row=>row.prompt_key===CAD_TARGETED_REVIEW_ROLE)!
  role.definition={...role.definition,enabled:true};role.id+=':enabled';role.payload_hash+=':enabled'
 })
}

function fixture(){
 const recipe:any={contract_version:1,units:'mm',assembly_id:'bracket',definitions:[
  {id:'upright',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200},
  {id:'arm',primitive:'box',material_ref:null,x_mm:100,y_mm:80,z_mm:18}],instances:[
  {id:'upright',definition_id:'upright',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}},
  {id:'arm',definition_id:'arm',placement:{x:18,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']}
 const draft:any={status:'ok',projectId:'p_fixture',artifact_id:artifact,revision:1,current_revision:1,archived:false,source_state:'current',source_kind:'construction',target_revision:1,area_id:null,
  title:'Bracket',description:'Synthetic concept',recipe,parameters:compileCadParameters('p_fixture',recipe,parameterPlan(recipe),new Map(),new Map()),
  materials:recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:material,material_revision:1,part_id:null,part_revision:null})),
  joints:[{id:'corner',method:'screwed_butt',first:{instance_id:'upright',face:'x_max'},second:{instance_id:'arm',face:'x_min'},reason:'Concept'}],open_questions:['Fasteners and strength remain unverified']}
 const catalog=new Map([[material+'@1',{id:material,revision:1,current_revision:1,kind:'material',profile_code:'sheet_stock',categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null}}}]])
 return {draft,catalog}
}
/** A stored FORM check for the exact revision, as bob_record_construction_observation keeps it. */
function observation(draft:any,status:'failed'|'properties_passed',binding=constructionEvidenceBinding(draft)){
 return {id:resultId,projectId:draft.projectId,artifact_id:draft.artifact_id,revision:draft.revision,kind:'check',observed_at:'2026-10-28T06:00:00.000Z',
  output:{status:'checked',projectId:draft.projectId,artifact_id:draft.artifact_id,revision:draft.revision,concept_ready:false,fabrication_ready:false,
   form_evidence:{version:1,purpose:'construction_development',contract:constructionEvidenceContract(draft,today),source_binding:binding,
    scope:{requested_component_ids:[],evaluated_component_ids:['drawer'],evaluated_instance_ids:[],pending_component_ids:[]},
    property_checks:[{id:'p1',feature_id:'f1',kind:'clear_space',status:status==='failed'?'failed':'passed',code:status==='failed'?'space_obstructed':'space_clear',basis:'model_geometry',instance_ids:[]}],
    requirements:[{feature_id:'f1',requirement:feature.description,property_check_ids:['p1'],status,functional_fidelity:'unverified'}],
    whole_delivery_ready:false,fabrication_ready:false}}}
}
function runtime(opts:{targeted:boolean;stored?:(draft:any)=>any;readerFails?:boolean;reply?:(o:any)=>any;store?:any;owner?:string;sheet?:string;runtime?:string}){
 const {draft,catalog}=fixture(),calls:any[]=[],reads:any[]=[]
 const check=()=>checkedConstructionForDrawing({projectId:draft.projectId,message:'Draw this construction',hasAccess:async()=>true,read:async()=>structuredClone(draft),
  readCatalog:async(id,revision)=>({status:'ok',projectId:draft.projectId,record:catalog.get(id+'@'+revision)}),readSources:async()=>({project:new Map(),physical:new Map()})},artifact,1)
 const assistant=createCadAssistant({projectId:draft.projectId,userId:'owner',ownerRequest:opts.owner??'Draw this exact bracket',hasAccess:async()=>true,available:true,deadline:Date.now()+200000,
  ...(opts.store?{requestStore:opts.store}:{}),...(opts.runtime?{runtimeVersion:async()=>opts.runtime!}:{}),
  ...(opts.targeted?{aiCatalog:targetedCatalog()}:{}),
  makeLookup:()=>createProjectLookup(draft.projectId,async(_p,i)=>({data:{records:i.dataset==='target'?[{id:'project',revision:1,solution_id:material}]:[],related:[],truncated:false},error:null}),1000,40),
  readDesignReadiness:async(targetRevision,purpose,areaId)=>{
   const readiness=fixtureDesignReadiness(draft.projectId,material,targetRevision,areaId??null,purpose??'concept')
   readiness.design_intent.features=[structuredClone(feature)]
   return readiness
  },
  readArtifact:async()=>structuredClone(draft),checkConstruction:check,
  readConstructionObservations:async(id,revision,result,after)=>{
   reads.push({id,revision,result,after})
   if(opts.readerFails)throw new Error('read failed')
   const head={status:'ok',projectId:draft.projectId,artifact_id:id,revision,current_revision:1,archived:false,source_state:'current'}
   const stored=opts.stored?.(draft)
   if(result===null)return {...head,results:stored?[{result_id:stored.id,kind:'check'}]:[],coverage:{total_items:stored?1:0,complete:true},next_after:null}
   return {...head,observation:stored}
  },
  render:async recipe=>({recipe,manifest:{bounding_box_mm:checkConstruction(draft,catalog,'2026-10-04').bounds_mm,checks:{collisions:{status:'complete',overlaps:[]}},annotations:{version:1,coverage:'complete'},engine:{name:'build123d'},assembly_id:recipe.assembly_id,
   preview_metadata:Object.fromEntries(recipe.views.map(v=>[v,{file:v+'.png',sha256:(opts.sheet??'b').repeat(64),source_sha256:'c'.repeat(64)}]))},files:{front:'Zml4dHVyZQ=='},previews:Object.fromEntries(recipe.views.map(v=>[v,'Zml4dHVyZQ==']))}),
  callModel:async(o:any)=>{
   calls.push(o)
   assert.equal(o.aiFunction,'cad-reviewer','the existing CAD review switch governs both review forms')
   if(o.schemaName==='bob_cad_review'){const h=JSON.parse(o.messages[0].content).handoff;return reviewReply(h)}
   const packet=JSON.parse(o.messages[0].content).review_packet
   const data=opts.reply?.(packet)??{summary:'Targeted fixture review.',requirements:Object.fromEntries(packet.questions.requirements.map((id:string)=>[id,{status:'met',evidence:'Synthetic views show it',correction:null}])),
    views:{status:'met',evidence:'Front and top are readable',correction:null},reference:{status:'not_applicable',evidence:'No reference images were opened',correction:null},issues:[]}
   return {success:true,data:JSON.stringify(data),responseId:'targeted',model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
  }})
 return {draft,assistant,calls,reads}
}
const request={request_id:null,brief:'Draw this exact bracket',handoff,artifact_id:artifact,area_id:null,component_id:null,step_id:null}

test('with the role absent or published disabled the full Rita review runs unchanged and stored checks are not read',async()=>{
 const f=runtime({targeted:false,stored:draft=>observation(draft,'failed')})
 const result=await f.assistant.consult(request)
 assert.equal(result.status,'ready',JSON.stringify(result))
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].catalogRoleKey,'cad-reviewer');assert.equal(f.calls[0].schemaName,'bob_cad_review')
 const input=JSON.parse(f.calls[0].messages[0].content)
 assert.equal(input.review_packet,undefined);assert.deepEqual(input.required_feature_ids,['intent_f1'])
 assert.deepEqual(f.reads,[],'a stored failed probe cannot change the legacy gate')
 assert.equal(f.assistant.quality!.basis,undefined)
})

test('targeted review asks every requirement with its code evidence and code computes the pass',async()=>{
 const f=runtime({targeted:true,stored:draft=>observation(draft,'properties_passed')})
 const result=await f.assistant.consult(request)
 assert.equal(result.status,'ready',JSON.stringify(result))
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].catalogRoleKey,'cad-targeted-reviewer')
 assert.deepEqual(f.calls[0].schema.properties.requirements.required,[shapeId,'intent_f1'],'exact keyed answers for every handoff requirement')
 const packet=JSON.parse(f.calls[0].messages[0].content).review_packet
 assert.deepEqual(packet.questions.requirements,[shapeId,'intent_f1'])
 assert.equal(packet.coverage.form_evidence.status,'current');assert.equal(packet.coverage.form_evidence.result_id,resultId)
 const intent=packet.requirements.find((r:any)=>r.id==='intent_f1')
 assert.equal(intent.required,true);assert.equal(intent.code_evidence.status,'properties_passed');assert.equal(intent.code_evidence.functional_fidelity,'unverified')
 assert.equal(packet.requirements.find((r:any)=>r.id===shapeId).code_evidence,null)
 assert.deepEqual(f.reads.map(r=>r.result),[null,resultId])
 assert.equal(f.assistant.quality!.basis!.mode,'targeted');assert.equal(f.assistant.candidate!.packet.recipe.assembly_id,'bracket')
})

test('a failed stored property check rejects the candidate without a model call',async()=>{
 const f=runtime({targeted:true,stored:draft=>observation(draft,'failed')})
 const result:any=await f.assistant.consult(request)
 assert.equal(f.calls.length,0,'no paid review for a code failure')
 // Like a Rita rejection, the drawing desk routes back to the K2 checkpoint.
 assert.equal(result.status,'needs_data',JSON.stringify(result));assert.equal(result.stage,'review')
 assert.match(result.next_action,/same K2 checkpoint/)
 assert.equal(result.review.verdict,'revise')
 assert.equal(result.review.requirements.find((r:any)=>r.id==='intent_f1').status,'failed')
 assert.match(result.review.issues[0].correction,/p1 space_obstructed/)
 assert.equal(f.assistant.candidate,null)
})

test('changed or unreadable stored evidence is reported and never counts as a pass',async()=>{
 for(const variant of [{stored:(draft:any)=>observation(draft,'failed',{...constructionEvidenceBinding(draft),target_revision:9}),expect:'not_current'},{readerFails:true,expect:'unavailable'},{expect:'none'}]){
  const f=runtime({targeted:true,...variant})
  const result=await f.assistant.consult(request)
  assert.equal(result.status,'ready',JSON.stringify(result))
  const packet=JSON.parse(f.calls[0].messages[0].content).review_packet
  assert.equal(packet.coverage.form_evidence.status,variant.expect)
  assert.equal(packet.requirements.find((r:any)=>r.id==='intent_f1').code_evidence,null)
  assert.deepEqual(packet.code_findings,[])
 }
})

test('an optimistic reviewer cannot pass an unresolved required feature or unreadable views',async()=>{
 const met=(packet:any,overrides:Record<string,any>)=>({summary:'Looks good overall.',requirements:Object.fromEntries(packet.questions.requirements.map((id:string)=>[id,{status:'met',evidence:'ok',correction:null}])),
  views:{status:'met',evidence:'ok',correction:null},reference:{status:'not_applicable',evidence:'none opened',correction:null},issues:[],...overrides})
 const unresolved=runtime({targeted:true,reply:packet=>{const r=met(packet,{});r.requirements.intent_f1={status:'unresolved',evidence:'Cannot see the drawer front',correction:null};return r}})
 for(const f of [unresolved,runtime({targeted:true,reply:packet=>met(packet,{views:{status:'unresolved',evidence:'Top view labels overlap',correction:'Separate the labels'}})})]){
  const result:any=await f.assistant.consult(request)
  assert.equal(result.status,'needs_data');assert.equal(result.review.verdict,'revise');assert.equal(f.calls.length,1);assert.equal(f.assistant.candidate,null)
 }
})

test('packet keeps every requirement and the strict parser rejects omissions and unexplained failures',async()=>{
 const h:DesignHandoff={...structuredClone(handoff),requirements:[...handoff.requirements,{id:'intent_f1',requirement:feature.description,basis:'project_record',source_ref:null},{id:'optional',requirement:'Label the parts',basis:'working_assumption',source_ref:null}]}
 const {draft}=fixture()
 const packet=await buildCadReviewPacket({handoff:h,requiredFeatureIds:new Set(['intent_f1']),candidateFingerprint:'c',construction:{artifact_id:artifact,revision:1},designIntentPin:{version:1},
  renderedViews:['front'],referenceRefs:['image:1'],formEvidence:formEvidenceCoverage(observation(draft,'properties_passed') as any,draft,today)})
 assert.deepEqual(packet.questions,{requirements:[shapeId,'intent_f1','optional'],views:['front'],reference:true})
 assert.deepEqual(packet.coverage.views.missing,['top'])
 assert.equal(packet.code_findings[0].code,'views')
 assert.equal(codeFindingReview(packet).verdict,'revise')
 const answer=(status:string,correction:string|null=null)=>({status,evidence:'Seen in front view',correction})
 const base={summary:'Targeted review',requirements:{[shapeId]:answer('met'),intent_f1:answer('met'),optional:answer('unresolved')},views:answer('met'),reference:answer('met'),issues:[]}
 assert.equal(parseTargetedCadReview(base,packet)!.verdict,'pass','an unresolved optional requirement may stay open')
 assert.equal(parseTargetedCadReview({...base,requirements:{[shapeId]:answer('met'),intent_f1:answer('met')}},packet),null,'every requirement must be answered')
 assert.equal(parseTargetedCadReview({...base,requirements:{...base.requirements,optional:answer('failed')}},packet),null,'a failure must name its correction')
 const failed=parseTargetedCadReview({...base,requirements:{...base.requirements,optional:answer('failed','Add part labels')}},packet)!
 assert.equal(failed.verdict,'revise');assert.equal(failed.issues.at(-1)!.correction,'optional: Add part labels')
 assert.equal(parseTargetedCadReview({...base,reference:answer('not_applicable')},packet),null,'opened references must be compared')
 assert.equal(parseTargetedCadReview({...base,verdict:'pass'},packet),null,'the model has no verdict field')
})

test('the inert publication changes no CAD runtime identity; only enabling the role adds it',()=>{
 const published=catalogFixture().manifest()
 const before=structuredClone(published);before.definitions=before.definitions.filter(row=>row.metadata.publication!=='targeted-cad-review-v1')
 assert.equal(published.definitions.filter(row=>row.metadata.publication==='targeted-cad-review-v1').length,5)
 assert.equal(published.definitions.find(row=>row.prompt_key===CAD_TARGETED_REVIEW_ROLE)!.definition.enabled,false)
 assert.deepEqual(drawingCatalogConfiguration(published),drawingCatalogConfiguration(before),'applying the publication cannot restart a paid drawing attempt')
 const enabled=drawingCatalogConfiguration(targetedCatalog().manifest()).definitions.map(row=>row.key)
 for(const key of [CAD_TARGETED_REVIEW_ROLE,'schema.bob_cad_targeted_review','agent-contract.targeted-cad-review','targeted-cad-review.contract','targeted-cad-review.persona'])assert(enabled.includes(key),key)
 assert.deepEqual(enabled.filter(key=>!key.includes('targeted')),drawingCatalogConfiguration(before).definitions.map(row=>row.key))
})

test('the published schema is the runtime schema and binds exact requirement keys',()=>{
 const session=targetedCatalog()
 assert.deepEqual(session.definition('schema.bob_cad_targeted_review').definition,CAD_TARGETED_REVIEW_SCHEMA)
 const bound=session.schema('bob_cad_targeted_review',{requirement_ids:['a','intent_f1']}).schema as any
 assert.deepEqual(bound.properties.requirements.required,['a','intent_f1'])
 assert.deepEqual(Object.keys(bound.properties.requirements.properties.a.properties).sort(),['correction','evidence','status'])
 const role=session.role('cad-targeted-reviewer')
 assert.equal(role.definition.definition.response_schema_key,'schema.bob_cad_targeted_review')
 assert.match(session.text('targeted-cad-review.contract'),/You do not decide the verdict/)
 assert.throws(()=>catalogFixture().role('cad-targeted-reviewer'),/ai_function_disabled/,'published disabled')
})

/** Owner/thread-private request store, as drawing-request-store.ts provides it. */
function requestStore(){
 let saved:any=null;const writes:any[]=[]
 return {writes,get saved(){return saved},load:async()=>structuredClone(saved),save:async(id:any,revision:any,status:any,payload:any)=>{
  assert.equal(revision,saved?.revision??0)
  saved={id:id??'33333333-3333-4333-8333-333333333333',revision:revision+1,status,payload:structuredClone(payload)};writes.push(structuredClone(saved));return structuredClone(saved)
 }}
}

test('an accepted targeted review is kept privately and reused in a new turn without another model call',async()=>{
 const store=requestStore(),first=runtime({targeted:true,store,runtime:'r1'})
 assert.equal((await first.assistant.consult(request)).status,'ready');assert.equal(first.calls.length,1)
 const record=store.saved.payload.targeted_review
 assert.equal(store.saved.status,'reviewed');assert.equal(record.version,'cad-targeted-review-v1')
 assert.deepEqual(record.requirements,{[shapeId]:'met',intent_f1:'met'})
 assert.doesNotMatch(JSON.stringify(record),/Synthetic views|Draw this exact bracket/,'no reviewer prose or owner text is stored')
 const resumed=runtime({targeted:true,store,runtime:'r1'})
 const result=await resumed.assistant.consult({...request,request_id:store.saved.id})
 assert.equal(result.status,'ready',JSON.stringify(result));assert.equal(resumed.calls.length,0,'unchanged accepted model: no paid review')
 assert.equal(resumed.assistant.quality!.basis!.reused,'all');assert(resumed.assistant.candidate,'the re-rendered candidate is saveable')
 assert.deepEqual(store.saved.payload.targeted_review,record)
})

test('a new owner message or sheet asks only the views and issues; changed sources ask everything again',async()=>{
 for(const variant of [{owner:'Draw this exact bracket. Also show the top clearly.'},{sheet:'d'}]){
  const store=requestStore();await runtime({targeted:true,store,runtime:'r1'}).assistant.consult(request)
  const next=runtime({targeted:true,store,runtime:'r1',...variant})
  assert.equal((await next.assistant.consult({...request,request_id:store.saved.id})).status,'ready')
  assert.equal(next.calls.length,1)
  assert.deepEqual(next.calls[0].schema.properties.requirements.required,[],'requirement answers are reused, not asked')
  assert.deepEqual(JSON.parse(next.calls[0].messages[0].content).review_packet.questions.requirements,[])
  const review=next.assistant.quality!
  assert.equal(review.basis!.reused,'requirements');assert.deepEqual(review.review.requirements.map((r:any)=>r.status),['met','met'])
 }
 for(const variant of [{runtime:'r2'},{stored:(draft:any)=>observation(draft,'properties_passed')}]){
  const store=requestStore();await runtime({targeted:true,store,runtime:'r1'}).assistant.consult(request)
  const next=runtime({targeted:true,store,runtime:'r1',...variant})
  await next.assistant.consult({...request,request_id:store.saved.id})
  assert.deepEqual(next.calls[0].schema.properties.requirements.required,[shapeId,'intent_f1'],'a changed runtime or evidence asks every requirement')
  assert.equal(next.assistant.quality!.basis!.reused,'none')
 }
})

test('a reused record cannot carry an unresolved required feature and malformed records are ignored',()=>{
 assert.equal(parseTargetedReviewRecord({version:'cad-targeted-review-v1',key:'a'.repeat(64),requirements:{x:'failed'},presentation:{owner_request:'b'.repeat(64),views:{},reference:'met'}}),null)
 assert.equal(parseTargetedReviewRecord({version:'cad-targeted-review-v1',key:'a'.repeat(64),requirements:{},presentation:{owner_request:'b'.repeat(64),views:{front:'data:image/png;base64,AA'},reference:'met'}}),null)
})

test('the targeted reviewer shares the durable CAD review reservation; other roles do not',()=>{
 const authority=(roleKey:string,functionName='cad-reviewer')=>({requestId:'33333333-3333-4333-8333-333333333333',
  options:{app:'bob',coworkerId:'bob',module:'cad',functionName,aiFunction:functionName,aiDefinition:{app:'bob',roleKey} as any}})
 assert.equal(isDrawingModelCall(authority('role.cad-reviewer'),'cad-reviewer'),true)
 assert.equal(isDrawingModelCall(authority('role.cad-targeted-reviewer'),'cad-reviewer'),true)
 assert.equal(isDrawingModelCall(authority('role.ask-bob'),'cad-reviewer'),false)
 assert.equal(isDrawingModelCall(authority('role.cad-targeted-reviewer','ask-bob'),'ask-bob'),false)
})
