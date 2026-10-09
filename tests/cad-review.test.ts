import {test} from 'node:test'
import assert from 'node:assert/strict'
import {type CadPacket} from '../supabase/functions/_shared/cad-assistant.ts'
import {createCadAssistant} from './support/cad-parameter-fixture.ts'
import {parseDesignHandoff,parseCadReview,candidateFingerprint,cadReviewSchema} from '../supabase/functions/_shared/cad-review.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
import {createProjectContext} from '../supabase/functions/_shared/project-context/dispatcher.ts'
import {DRAWING_REVIEW_INSTRUCTION,collectDrawingReviewEvidence} from '../supabase/functions/_shared/drawing-review.ts'
import {BobContinuation,createBobJournal,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'
import {budgetFailure} from '../supabase/functions/_shared/bob-budget-stop.ts'
const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const reply=(data:any)=>({success:true,data,model:'fixture',responseId:'designer-cursor',usage})
const call=(name:string,args:any)=>({...reply(null),toolCalls:[{id:'c',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'concept',definitions:[{id:'panel',primitive:'box' as const,x_mm:600,y_mm:300,z_mm:18,material_ref:null}],instances:[{id:'panel-1',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const design={recipe,title:'Concept',description:'Requested concept',assumptions:'Physical fit unresolved',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[]}
const request={brief:'Use the reference.',handoff:{...handoff,coordinates:{origin:'entry corner',positive_x:'east',positive_y:'north',positive_z:'up'}},area_id:null,component_id:null,step_id:null,artifact_id:null}
function fixture(){let renderCount=0,designerCalls=0,reviewCalls=0
 const seen:any[]=[]
 const opts={research:false,ownerRequest:'The window faces east. Put access on the reference side.',projectId:'A',userId:'u',deadline:Date.now()+300000,available:true,hasAccess:async()=>true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'solution'}]:[],related:[],truncated:false},error:null}),1000,40),
  render:async(r:typeof recipe):Promise<CadPacket>=>{renderCount++;return {recipe:r,manifest:{engine:{name:'build123d'},instances:r.instances},files:{front:'exact-svg'},previews:Object.fromEntries(r.views.map(view=>[view,`render-${renderCount}-${view}`]))}},
  readArtifact:async()=>null,
  callModel:async(o:any)=>{seen.push(o);if(o.functionName==='cad-reviewer'){reviewCalls++;return reviewReply()}
   return ++designerCalls===1?call('render_cad_candidate',design):reply('Ready')},
 }
 return {opts,seen,get renders(){return renderCount},get reviewCalls(){return reviewCalls}}
}
test('original request and structured directions reach a separate, tool-free reviewer with exact generated pixels',async()=>{
 const f=fixture(),a=createCadAssistant(f.opts)
 assert.equal((await a.consult(request)).status,'ready')
 const review=f.seen.find(o=>o.functionName==='cad-reviewer')
 assert.equal(review.previousResponseId,undefined);assert.equal(review.tools,undefined)
 assert.deepEqual(review.schema.properties.requirements.required,['shape'])
 assert.equal(review.schema.properties.requirements.additionalProperties,false)
 const data=JSON.parse(review.messages[0].content)
 assert.equal(data.owner_request,f.opts.ownerRequest);assert.equal(data.handoff.coordinates.positive_x,'east')
 assert.deepEqual(data.candidate.recipe,recipe)
 assert(JSON.stringify(review.messages).includes('render-1-front'))
 assert.equal(a.quality!.fingerprint,await candidateFingerprint(a.candidate!))
 assert.equal(a.metrics.review_passed,true)
})
test('candidate review defers delivery receipts without certifying saved work or weakening geometry checks',async()=>{
 const f=fixture(),model=f.opts.callModel
 const handoffWithDelivery={...request.handoff,requirements:[...request.handoff.requirements,{id:'save_link',requirement:'Save and link the drawing to the work Step',basis:'user_request' as const,source_ref:null}]}
 f.opts.callModel=async o=>{
  if(o.functionName!=='cad-reviewer')return model(o)
  const context=JSON.parse(o.messages[0].content)
  assert.equal(context.review_scope.stage,'candidate');assert.equal(context.review_scope.saved,false)
  assert.deepEqual(context.review_scope.deferred_checks,['save_receipt','step_link_receipt','reopen_saved_revision'])
  assert.match(o.systemMessage,/Do not mark a future delivery action met/)
  assert.match(o.systemMessage,/Wrong intended project\/target\/scope/)
  return reply(JSON.stringify({verdict:'pass',summary:'Candidate ready; delivery remains',requirements:{shape:{status:'met',evidence:'Geometry checked'},save_link:{status:'unresolved',evidence:'pending_delivery: save and link after review'}},issues:[]}))
 }
 const assistant=createCadAssistant(f.opts),result=await assistant.consult({...request,handoff:handoffWithDelivery})
 assert.equal(result.status,'ready');assert.equal(result.saved,false)
 assert.equal(assistant.quality?.review.requirements.find(r=>r.id==='save_link')?.status,'unresolved')
 const broken=parseCadReview({verdict:'pass',summary:'Incorrect width',requirements:{shape:{status:'failed',evidence:'Wrong width'},save_link:{status:'unresolved',evidence:'pending_delivery'}},issues:[]},handoffWithDelivery)
 assert.equal(broken?.verdict,'revise','deferred delivery cannot override a construction failure')
})
test('review budget failure retains boundary, counters and review stage and cannot expose a savable candidate',async()=>{
 const f=fixture(),model=f.opts.callModel
 f.opts.callModel=async o=>o.functionName==='cad-reviewer'?budgetFailure<string>({scope:'drawing_request',reasons:['call_limit'],calls:24,call_limit:24}):model(o)
 const assistant=createCadAssistant(f.opts),result=await assistant.consult(request)
 assert.equal(result.reason,'paused_at_limit');assert.equal(result.stage,'review')
 assert.equal(result.budget_stop,undefined,'Bob is not shown the ledger')
 assert.equal(assistant.failure?.reason,'turn_budget_exhausted','the server-side record keeps the real cause')
 assert.deepEqual(assistant.failure?.budget_stop,{scope:'drawing_request',reasons:['call_limit'],calls:24,call_limit:24})
 assert.match(result.user_message,/pausades vid en gräns/);assert.equal(assistant.candidate,null)
 assert.deepEqual(await assistant.consult(request),result,'same assistant does not restart after a budget stop')
})
test('review rejection returns concrete feedback to the designer and requires a new reviewed candidate',async()=>{
 const f=fixture();let designers=0,reviews=0
 f.opts.callModel=async o=>{
  if(o.functionName==='cad-reviewer'){
   if(++reviews===1)return reply(JSON.stringify({verdict:'pass',summary:'Wrong side',requirements:[{id:'shape',status:'failed',evidence:'Wrong reference side'}],issues:[{severity:'error',code:'orientation',correction:'Move access to the negative X side'}]}))
   assert.equal(JSON.parse(o.messages[0].content).candidate.recipe.instances[0].placement.x,-600)
   return reviewReply()
  }
  designers++
  if(designers===1)return call('render_cad_candidate',design)
  if(designers===3){assert(JSON.stringify(o.messages).includes('negative X'));assert.equal(o.tool_choice,undefined,'repair is requested, never forced');assert.equal(o.messages[0].role,'user');assert.match(String(o.messages[0].content),/^\[Server note — not from the owner\]/);return call('render_cad_candidate',{...design,recipe:{...recipe,instances:[{...recipe.instances[0],placement:{...recipe.instances[0].placement,x:-600}}]}})}
  return reply('Ready')
 }
 const a=createCadAssistant(f.opts);assert.equal((await a.consult(request)).status,'ready');assert.equal(f.renders,2);assert.equal(a.metrics.review_rejections,1)
 assert.equal(a.candidate!.packet.recipe.instances[0].placement.x,-600)
})
test('missing previews, unavailable/malformed review and omitted requirements cannot expose a savable candidate',async()=>{
 for(const failure of ['pixels','provider','coverage']){
  const f=fixture(),model=f.opts.callModel
  if(failure==='pixels')f.opts.render=async r=>({recipe:r,manifest:{},files:{}})
  f.opts.callModel=async o=>o.functionName!=='cad-reviewer'?model(o):failure==='provider'?{...reply(null),success:false}:reply(JSON.stringify({verdict:'pass',summary:'Fine',requirements:[],issues:[]}))
  const a=createCadAssistant(f.opts),result=await a.consult(request)
  assert.equal(result.status,'unavailable');assert.equal(result.stage,'review');assert.equal(a.candidate,null);assert.equal(a.quality,null)
 }
})
test('requested view omissions override a permissive model review and bounded repairs cannot certify the old candidate',async()=>{
 const f=fixture(),model=f.opts.callModel
 f.opts.callModel=async o=>o.functionName==='cad-reviewer'?reviewReply():o.messages?.some((m:any)=>m.role==='system'&&String(m.content).includes('Independent review'))?call('render_cad_candidate',design):model(o)
 const a=createCadAssistant(f.opts),result=await a.consult({...request,handoff:{...request.handoff,views:['front','top','isometric']}})
 assert.equal(result.status,'incomplete');assert.equal(a.candidate,null);assert.equal(a.metrics.review_rejections,1)
})
test('handoff rejects unknown shape, duplicate requirement identities and fabricated coordinate types',()=>{
 assert(parseDesignHandoff(handoff));assert.equal(parseDesignHandoff({...handoff,requirements:[handoff.requirements[0],handoff.requirements[0]]}),null)
 assert.equal(parseDesignHandoff({...handoff,coordinates:{...handoff.coordinates,positive_x:42}}),null)
 assert.equal(parseCadReview({verdict:'pass',summary:'fine',requirements:[],issues:[]},handoff),null)
})
test('strict review keys cover the whole handoff; a plan-only pass cannot replace it',()=>{
 const full={...handoff,requirements:[...handoff.requirements,{id:'width',requirement:'Bind exact width',basis:'project_record' as const,source_ref:'measurement-id'}]}
 const schema=cadReviewSchema(full)
 const map=schema.properties.requirements as any
 assert.deepEqual(map.required,['shape','width']);assert.equal(map.additionalProperties,false)
 const value={verdict:'pass',summary:'Reviewed exact candidate',requirements:{shape:{status:'met',evidence:'One panel'},width:{status:'met',evidence:'Measurement revision 2'}},issues:[]}
 assert.deepEqual(parseCadReview(value,full)?.requirements.map(r=>r.id),['shape','width'])
 assert.equal(parseCadReview({...value,requirements:{'plan-uuid':value.requirements.shape}},full),null)
 assert.equal(parseCadReview({...value,requirements:{shape:value.requirements.shape}},full),null)
 assert.equal(parseCadReview({...value,requirements:{...value.requirements,width:{...value.requirements.width,id:'invented'}}},full),null)
 assert.equal(parseCadReview({...value,requirements:{...value.requirements,width:{status:'failed',evidence:'Wrong binding'}}},full)?.verdict,'revise')
})
test('review gets original reference pixels and revocation during review prevents saving',async()=>{
 const f=fixture();let valid=true,sawReference=false
 const source={projectId:'A',dataset:'image_pixels',recordId:'ref',label:'Reference',retrievedAt:'now',truth:'unknown' as const}
 const images=createProjectContext({hasAccess:f.opts.hasAccess,sources:[],adapters:[{category:'images',prefix:'image',count:async()=>1,list:async()=>({items:[],next_cursor:null}),open:async()=>({item:{ref:'image:ref',title:'Reference'},image:{type:'image_url',image_url:'data:image/png;base64,original-reference'},source,version:'v1',bytes:1}),current:async()=>valid}]})
 const model=f.opts.callModel
 f.opts.callModel=async o=>{if(o.functionName==='cad-reviewer'){sawReference=JSON.stringify(o.messages).includes('original-reference');valid=false}return model(o)}
 const a=createCadAssistant({...f.opts,context:images,referenceImageRefs:()=>['image:ref']})
 await assert.rejects(a.consult(request),/project_denied/);assert(sawReference);assert.equal(a.candidate,null)
})

test('the last designer call can render and its exact output still receives independent review',async()=>{
 const f=fixture();let calls=0
 f.opts.callModel=async o=>{
  f.seen.push(o)
  if(o.functionName==='cad-reviewer')return reviewReply()
  calls++
  assert.equal(o.tool_choice,undefined)
  if(calls<10)return call('search_project_data',{dataset:'tasks',query:null,status:null,area_id:null,record_id:null,after_id:null})
  assert(o.tools.some((t:any)=>t.function.name==='render_cad_candidate'),'the final call must retain construction tools')
  return call('render_cad_candidate',design)
 }
 const a=createCadAssistant(f.opts)
 assert.equal((await a.consult(request)).status,'ready')
 assert.equal(calls,10);assert.equal(f.renders,1);assert.equal(a.metrics.reviews,1)
 assert(JSON.stringify(f.seen.at(-1).messages).includes('render-1-front'))
})
test('retrying a late research call preserves prior work and keeps the final render available after replay',async()=>{
 const f=fixture(),entries:JournalEntry[]=[],store={entries,save:async(e:JournalEntry)=>{entries.push(structuredClone(e))}}
 let providerCalls=0,reviewCalls=0
 const run=()=>{
  const journal=createBobJournal(store,Infinity)
  return createCadAssistant({...f.opts,
   callModel:o=>journal.run('model:'+o.functionName,o,async()=>{
    if(o.functionName==='cad-reviewer'){reviewCalls++;return reviewReply()}
    providerCalls++
    if(providerCalls===9)throw new BobContinuation('yield','provider_retry')
    if(providerCalls<=10)return call('search_project_data',{dataset:'tasks',query:null,status:null,area_id:null,record_id:null,after_id:null})
    assert(o.tools?.some(t=>t.function.name==='render_cad_candidate'))
    return call('render_cad_candidate',design)
   }),
   render:r=>journal.run('render',r,()=>f.opts.render(r as typeof recipe)),
  })
 }
 await assert.rejects(run().consult(request),e=>e instanceof BobContinuation&&e.message==='provider_retry')
 const resumed=run();assert.equal((await resumed.consult(request)).status,'ready')
 assert.equal(providerCalls,11,'eight earlier calls replay; one failed request is retried, then the final call renders')
 assert.equal(reviewCalls,1);assert.equal(f.renders,1)
})

test('a last-call render rejected by review remains unsavable without another designer attempt',async()=>{
 const f=fixture();let calls=0,reviews=0
 f.opts.callModel=async o=>{
  if(o.functionName==='cad-reviewer'){reviews++;return reply(JSON.stringify({verdict:'revise',summary:'Door is on the wrong wall',requirements:[{id:'shape',status:'failed',evidence:'Wrong wall'}],issues:[]}))}
  return ++calls<10?call('search_project_data',{dataset:'tasks',query:null,status:null,area_id:null,record_id:null,after_id:null}):call('render_cad_candidate',design)
 }
 const a=createCadAssistant(f.opts)
 assert.equal((await a.consult(request)).status,'incomplete')
 assert.equal(a.candidate,null);assert.equal(reviews,1);assert.equal(calls,10)
})

test('review independently reads project, Step and paginated room facts omitted by the designer',async()=>{
 const f=fixture(),reads:any[]=[]
 f.opts.makeLookup=()=>createProjectLookup('A',async(_p,q)=>{
  reads.push(q)
  const records=q.dataset==='target'?[{id:'project',revision:1,solution_id:'solution'}]
   :q.dataset==='project'?[{id:'A',name:'Synthetic workshop'}]
   :q.dataset==='plan'?[{id:'plan',steps:[{id:'step-1',title:'Draw the room'}]}]
   :q.dataset==='measurements'?[q.after_id?{id:'m2',subject:'East wall window offset',value:'1200',truth:'measured'}:{id:'m1',subject:'Door width',value:'850',truth:'measured'}]
   :q.dataset==='physical_elements'?[{id:'door',wall:'south',offset_mm:700}]:[]
  const more=q.dataset==='measurements'&&!q.after_id
  return {data:{records,related:[],truncated:more,next_cursor:more?'m1':null},error:null}
 },1000,40)
 const a=createCadAssistant(f.opts)
 assert.equal((await a.consult({...request,step_id:'step-1'})).status,'ready')
 const review=f.seen.find(o=>o.functionName==='cad-reviewer'),data=JSON.parse(review.messages[0].content)
 assert.equal(data.project_id,'A');assert.equal(data.step_id,'step-1')
 assert.deepEqual(data.source_evidence,[],'the designer did not fetch these records')
 assert(JSON.stringify(data.independent_evidence).includes('East wall window offset'))
 assert(JSON.stringify(data.independent_evidence).includes('Draw the room'))
 assert.deepEqual(data.independent_evidence.incomplete_datasets,[])
 assert(reads.some(q=>q.dataset==='measurements'&&q.after_id==='m1'))
 assert(review.systemMessage.includes(DRAWING_REVIEW_INSTRUCTION))
 assert(a.sources.some(s=>s.recordId==='door'))
})

test('independent evidence flags truncated or failed reads and stops on denied access',async()=>{
 const lookup=(code:string|null)=>createProjectLookup('A',async(_p,q)=>({
  data:{records:[],related:[],truncated:q.dataset==='physical_spaces',next_cursor:null},
  error:q.dataset==='physical_elements'?{code:code!}:null,
 }),1000,40)
 const evidence=await collectDrawingReviewEvidence(lookup('backend_error'),false)
 assert(evidence.incomplete_datasets.includes('physical_spaces'))
 assert(evidence.incomplete_datasets.includes('physical_elements'))
 await assert.rejects(collectDrawingReviewEvidence(lookup('42501'),false),/project_denied/)
})
