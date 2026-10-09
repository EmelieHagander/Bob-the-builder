import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {RENDER_CAD_TOOL,RENDER_SAVED_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'
import {createCadAssistant} from './support/cad-parameter-fixture.ts'
import {parseIntakeAssessment,bindMeasuredDimensions,intakeGaps,type DrawingRequest,type DrawingRequestStore} from '../supabase/functions/_shared/cad-intake.ts'
import {createProjectContext} from './support/colleague-catalog-fixture.ts'
import {createMediaAdapter,type MediaRow} from '../supabase/functions/_shared/project-context/media.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {handoff,reviewReply} from './support/cad-review-fixture.ts'
import {createDrawingRequestStore} from '../supabase/functions/_shared/drawing-request-store.ts'
import {BobContinuation,createBobJournal,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'
const id='30000000-0000-4000-8000-000000000001'
const measurement='30000000-0000-4000-8000-000000000002'
const request={request_id:null,handoff,brief:'Draw the construction using current measures',area_id:null,component_id:null,step_id:null,artifact_id:null}
const check=(id:string,status='known',blocking=false)=>({id,status,blocking,source_refs:status==='known'?['requirement:'+id]:[],action:blocking?'measurement':'none',detail:'Whole construction input check: '+id})
const assessment={checks:[check('shape')],additional_needs:[]}
const reply=(name?:string,args:unknown={})=>({success:true,data:null,model:'fixture',responseId:'r',usage:{input_tokens:1,output_tokens:1,total_tokens:2},...(name?{toolCalls:[{id:'c',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]}:{})})
const recipe={contract_version:1 as const,units:'mm' as const,assembly_id:'bed',definitions:[{id:'panel',primitive:'box' as const,material_ref:null,x_mm:999,y_mm:600,z_mm:18}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front' as const,'top' as const]}
const candidate={purpose:'project',recipe,dimension_bindings:[],title:'Bed',description:'Concept',assumptions:'Unverified site fit',target_revision:1,measurements:[]}
test('a completed CAD save replays its original reviewed result after a worker pause, without more CAD calls or writes',async()=>{
 const entries:JournalEntry[]=[];let completed=false,cadCalls=0,renderCalls=0,writes=0,bobCalls=0,replyReady=false
 const f=fixture()
 const run=async()=>{
  const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},Infinity)
  const store=createDrawingRequestStore({aiCatalog:catalogFixture(),projectId:'A',binding:{},journal,newId:async()=>id,
   caller:async name=>name==='check_drawing_request'?{status:completed?'saved':'collecting'}:{id,reused:false},
   privateCall:args=>journal.run('cad:request',args,async()=>args.p_operation==='save'
    ?f.opts.requestStore.save(f.row?.id??null,args.p_expected as number,args.p_status as string,args.p_payload as any):null),
  })
  const a=createCadAssistant({...f.opts,requestStore:store,
   callModel:o=>journal.run('model:'+o.functionName,o,async()=>{cadCalls++;return f.opts.callModel(o)}),
   render:r=>journal.run('cad:render',r,async()=>{renderCalls++;return f.opts.render(r)}),
  })
  const outcome=await a.consult(request)
  assert.equal(outcome.status,'ready','own completed save must not replace the original ready result with stopped')
  await journal.run('model:ask-bob',{outcome,candidate:a.candidate},async()=>{bobCalls++;return 'save_cad_design'})
  await journal.run('write',a.candidate,async()=>{writes++;completed=true;return 'verified receipt'})
  await journal.run('model:ask-bob',{saved:true},async()=>{
   if(!replyReady)throw new BobContinuation('yield','ai_wait')
   bobCalls++;return 'Finished'
  })
 }
 await assert.rejects(run(),e=>e instanceof BobContinuation&&e.kind==='yield')
 const paid=cadCalls
 // Simulate the next response becoming available; all earlier work replays.
 replyReady=true
 await run()
 assert.equal(cadCalls,paid);assert.equal(renderCalls,1);assert.equal(writes,1);assert.equal(bobCalls,2)
})
function fixture(){
 let row:DrawingRequest|null=null,target=true,readError=false,design=0,renders=0,revision=2;const reads:string[]=[]
 const store:DrawingRequestStore={list:async()=>row?[{id:row.id,status:row.status}]:[],load:async key=>key===row?.id?structuredClone(row):null,save:async(key,expected,status,payload)=>{assert.equal(expected,row?.revision??0);assert.equal(key,row?.id??null);row={id,revision:expected+1,status,payload:structuredClone(payload)};return structuredClone(row)}}
 const opts={requestStore:store,projectId:'A',userId:'u',ownerRequest:'Build the whole requested construction.',hasAccess:async()=>true,deadline:Date.now()+300000,available:true,
  makeLookup:()=>createProjectLookup('A',async(_p,q)=>{reads.push(q.dataset);return {data:{records:q.dataset==='target'&&target?[{id:'project',revision:1,solution_id:'s'}]:q.dataset==='measurements'?[{id:measurement,revision,value:'132',unit:'cm',truth:'measured',source:'Measured fixture width'}]:[],related:[],truncated:false},error:readError&&q.dataset==='physical_elements'?{code:'oops'}:null}},1000,40),
  callModel:async(o:any)=>{if(o.functionName==='cad-research')return reply('finish_cad_research',assessment);if(o.functionName==='cad-reviewer')return reviewReply();return ++design===1?reply('render_cad_candidate',candidate):reply()},
  render:async(r:any)=>{renders++;return {recipe:r,manifest:{instances:r.instances},files:{front:'not persisted'},previews:{front:'pixels',top:'pixels'}}},readArtifact:async()=>null}
 return {opts,reads,get row(){return row},get renders(){return renders},get design(){return design},noTarget:()=>{target=false},failRead:()=>{readError=true},repairRead:()=>{readError=false},complement:()=>{revision++}}
}
test('a missing selected target stops before paid intake; ready intent still returns all collected needs together',async()=>{
 const missing=fixture();missing.noTarget()
 const prerequisite=await createCadAssistant({...missing.opts,callModel:async()=>{throw Error('target prerequisite must precede paid work')}}).consult(request)
 assert.equal(prerequisite.status,'prerequisite_required');assert.deepEqual(prerequisite.required_tools,['save_project_solution','select_project_target'])
 assert.equal(missing.renders,0)
 const f=fixture();const a=createCadAssistant({...f.opts,callModel:async o=>{assert.equal(o.functionName,'cad-research');return reply('finish_cad_research',{checks:[check('shape','missing',true)],additional_needs:[check('door','missing',true),check('window','conflict',true)]})}})
 const result=await a.consult(request)
 assert.equal(result.status,'needs_data');assert.equal(result.request_id,id)
 assert.deepEqual(result.gaps?.map(c=>c.detail),['Whole construction input check: shape','Whole construction input check: door','Whole construction input check: window'])
 assert(result.gaps?.slice(1,3).every(c=>/^need_[a-f0-9]{32}$/.test(c.id)));assert.equal(f.renders,0)
 for(const dataset of ['measurements','physical_elements','physical_spaces','plan','tasks'])assert(f.reads.includes(dataset))
 assert.equal(f.row?.status,'needs_data')
})
test('missing sources remain retrieval failures, never invented measurement tasks',async()=>{
 const f=fixture();f.failRead();const result=await createCadAssistant(f.opts).consult(request)
 assert.equal(result.status,'unavailable');assert.equal(result.stage,'intake');assert(result.incomplete?.includes('physical_elements'));assert.deepEqual(result.gaps,[]);assert.equal(f.design,0);assert.equal(f.row?.status,'retrieval_failed')
})
test('complements resume the same request, refresh facts, retain earlier requirements, and save no pixels',async()=>{
 const f=fixture();let blocked=true;const model=f.opts.callModel
 f.opts.callModel=async o=>o.functionName==='cad-research'?reply('finish_cad_research',blocked?{checks:[check('shape','missing',true)],additional_needs:[]}:assessment):model(o)
 const first=await createCadAssistant(f.opts).consult(request);assert.equal(first.status,'needs_data');const reads=f.reads.length;blocked=false;f.complement()
 const a=createCadAssistant(f.opts),second=await a.consult({...request,request_id:id})
 assert.equal(second.status,'ready');assert(f.reads.length>reads);assert.equal(f.row?.id,id);assert.equal(f.row?.status,'reviewed');assert.equal(f.renders,1)
 assert(!JSON.stringify(f.row).includes('pixels'));assert(!JSON.stringify(f.row).includes('not persisted'));assert.deepEqual((f.row?.payload.draft as any).recipe,recipe)
 await a.markSaved();assert.equal(f.row?.status,'saved')
})
test('same-request complement returns immutable scope before research or writes, then resumes with the corrected scope',async()=>{
 const f=fixture();let blocked=true,calls=0;const model=f.opts.callModel
 f.opts.callModel=async o=>{calls++;return o.functionName==='cad-research'&&blocked
  ?reply('finish_cad_research',{checks:[check('shape','missing',true)],additional_needs:[]}):model(o)}
 assert.equal((await createCadAssistant(f.opts).consult(request)).status,'needs_data')
 const original=structuredClone(f.row),reads=f.reads.length,paid=calls
 const assistant=createCadAssistant(f.opts)
 for(const key of ['area_id','step_id','component_id','artifact_id']){
  const result=await assistant.consult({...request,request_id:id,[key]:'30000000-0000-4000-8000-000000000099'})
  assert.equal(result.status,'recovery_required');assert.equal(result.reason,'drawing_scope_changed')
  assert.equal(result.request_id,id);assert.deepEqual(result.scope,{area_id:null,component_id:null,step_id:null,artifact_id:null})
  assert.match(result.next_action,/link_project_drawing/)
  assert.equal(calls,paid);assert.equal(f.reads.length,reads);assert.deepEqual(f.row,original)
 }
 blocked=false;f.complement()
 assert.equal((await assistant.consult({...request,request_id:id})).status,'ready')
 assert.equal(f.row?.id,id);assert.equal(f.renders,1)
 assert.equal(assistant.candidate?.step_id,null,'link the new Step after save, without changing the original scope')
})

test('a partial or fabricated checklist cannot pass readiness',()=>{
 const refs=new Set(['requirement:shape'])
 assert(parseIntakeAssessment(assessment,handoff,refs))
 assert.equal(parseIntakeAssessment({...assessment,checks:[]},handoff,refs),null)
 assert.equal(parseIntakeAssessment({...assessment,checks:[{...check('shape'),source_refs:['imaginary']}]},handoff,refs),null)
 assert.equal(parseIntakeAssessment({...assessment,additional_needs:[check('shape')]},handoff,refs),null)
})
test('unresolved owner choices cannot be waived by a false blocking flag or a different canonical deferral',async()=>{
 const ownerChoice={...check('important_choice','missing',false),action:'owner_decision' as const,detail:'Explain options and recommend a solution before selecting the geometry'}
 const evaluated={checks:[check('shape')],additional_needs:[ownerChoice]}
 assert.equal(intakeGaps(evaluated).length,1)
 assert.equal(intakeGaps(evaluated,new Set(['different_choice'])).length,1)
 assert.equal(intakeGaps(evaluated,new Set(['important_choice'])).length,0)
 assert.equal(intakeGaps({checks:[],additional_needs:[{...ownerChoice,blocking:true}]},new Set(['important_choice'])).length,1)
 assert.equal(intakeGaps({checks:[],additional_needs:[{...ownerChoice,action:'bob_decision'}]}).length,0,'ordinary reversible decisions remain autonomous')
 const f=fixture(),a=createCadAssistant({...f.opts,callModel:async o=>{assert.equal(o.functionName,'cad-research');return reply('finish_cad_research',evaluated)}})
 const result=await a.consult(request)
 assert.equal(result.status,'needs_data');assert.equal(result.gaps?.length,1);assert.match(result.gaps![0].id,/^need_[a-f0-9]{32}$/);assert.equal(result.gaps![0].action,'owner_decision');assert.equal(f.renders,0)
 assert.equal(f.row?.payload.assessment?.additional_needs[0].blocking,true,'persisted stable gap work retains the corrected need')
})

test('P2: unchanged next-turn intake returns the same gaps without paid calls; changed source resumes',async()=>{
 const f=fixture();let calls=0,blocked=true
 const original=f.opts.callModel
 f.opts.callModel=async o=>{
  calls++
  return o.functionName==='cad-research'&&blocked?reply('finish_cad_research',{checks:[check('shape','missing',true)],additional_needs:[]}):original(o)
 }
 const first=await createCadAssistant(f.opts).consult(request)
 assert.equal(first.status,'needs_data');assert(f.row?.payload.retry)
 const revision=f.row!.revision,reads=f.reads.length
 for(let turn=0;turn<3;turn++){
  const assistant=createCadAssistant({...f.opts,ownerRequest:'Please continue '+turn})
  const repeated=await assistant.consult({...request,request_id:id,brief:'Another wording of the same delegation '+turn})
  assert.equal(repeated.retry_suppressed,true);assert.deepEqual(repeated.gaps,first.gaps)
  assert.equal(assistant.candidate,null);assert.equal(assistant.metrics.research_calls,0)
 }
 assert.equal(calls,1);assert.equal(f.renders,0);assert.equal(f.row!.revision,revision)
 assert(f.reads.length>reads,'current evidence is read before suppressing work')
 blocked=false;f.complement()
 assert.equal((await createCadAssistant(f.opts).consult({...request,request_id:id})).status,'ready')
 assert.equal(f.renders,1)
})

test('P2: repaired read failure resumes, and changed structured requirements release the intake gate',async()=>{
 const f=fixture();f.failRead()
 assert.equal((await createCadAssistant(f.opts).consult(request)).status,'unavailable')
 assert.equal((await createCadAssistant(f.opts).consult({...request,request_id:id})).retry_suppressed,true)
 f.repairRead()
 assert.equal((await createCadAssistant(f.opts).consult({...request,request_id:id})).status,'ready')
 const g=fixture();let calls=0
 g.opts.callModel=async()=>{calls++;return reply('finish_cad_research',{checks:[check('shape','missing',true)],additional_needs:[]})}
 await createCadAssistant(g.opts).consult(request)
 const changed=structuredClone(request);changed.handoff.requirements[0].requirement='Use a smaller selected concept'
 await createCadAssistant(g.opts).consult({...changed,request_id:id})
 assert.equal(calls,2)
})

test('P2: discovered collector dependencies refresh before suppressing unchanged paid retries',async()=>{
 const f=fixture();let calls=0
 f.opts.callModel=async()=>++calls%2===1
  ?reply('search_project_data',{dataset:'artifacts',query:null,status:null,area_id:null,record_id:null,after_id:null})
  :reply('finish_cad_research',{checks:[check('shape','missing',true)],additional_needs:[]})
 await createCadAssistant(f.opts).consult(request)
 assert(f.row!.payload.dependencies?.some(d=>d.tool==='search_project_data'&&(d.args as any).dataset==='artifacts'))
 assert(f.row!.payload.retry)
 const repeated=await createCadAssistant(f.opts).consult({...request,request_id:id})
 assert.equal(repeated.retry_suppressed,true)
 assert.equal(calls,2,'extra dependencies were refreshed without another model call')
 const g=fixture();let failedCalls=0
 g.opts.callModel=async()=>{failedCalls++;return reply()}
 await createCadAssistant(g.opts).consult(request)
 assert(g.row!.payload.retry)
 await createCadAssistant(g.opts).consult({...request,request_id:id})
 assert.equal(failedCalls,1,'an unchanged failed assessment cannot repeatedly spend the request budget')
})

test('P2: atomic writer receives the exact request revision and completed requests cannot regenerate',async()=>{
 const f=fixture();f.opts.requestStore.atomicSave=true
 const assistant=createCadAssistant(f.opts)
 assert.equal((await assistant.consult(request)).status,'ready')
 assert.deepEqual(assistant.candidate!.drawing_request,{id,revision:f.row!.revision})
 assert(!JSON.stringify(f.row!.payload.reviewed_candidate).includes('pixels'))
 assert(!JSON.stringify(f.row!.payload.reviewed_candidate).includes('not persisted'))
 await assistant.markSaved()
 assert.equal(f.row!.status,'reviewed','a status-only call cannot pretend the SQL commit happened')
 const receipt={recordId:measurement,revision:1,projectId:'A'}
 const load=f.opts.requestStore.load
 f.opts.requestStore.load=async key=>({...await load(key)!,status:'saved',receipt})
 const recovered=await createCadAssistant({...f.opts,available:false,callModel:async()=>{throw new Error('must not call model')}}).consult({...request,request_id:id})
 assert.equal(recovered.status,'already_saved');assert.deepEqual(recovered.receipt,receipt);assert.equal(f.renders,1)
})
test('new geometry has no saved selection fields; saved selections have no recipe',()=>{
 const fresh=RENDER_CAD_TOOL.function.parameters.properties,saved=RENDER_SAVED_CAD_TOOL.function.parameters.properties
 assert('recipe' in fresh);assert(!('part_ids' in fresh));assert(!('source_artifact_id' in fresh));assert('part_ids' in saved);assert(!('recipe' in saved))
})
test('server binds exact measured values in mm and refuses stale, ambiguous or unpinned input',()=>{
 const records=new Map([[measurement,{id:measurement,revision:2,value:'132',unit:'cm',truth:'measured',source:'Measured fixture width'}]])
 const bindings=[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:2}]
 assert.equal(bindMeasuredDimensions(recipe,bindings,records).definitions[0].x_mm,1320);assert.equal(recipe.definitions[0].x_mm,999)
 assert.throws(()=>bindMeasuredDimensions(recipe,[{...bindings[0],revision:1}],records),/unusable/)
 assert.throws(()=>bindMeasuredDimensions(recipe,bindings,new Map()),/unusable/)
 assert.throws(()=>bindMeasuredDimensions(recipe,[...bindings,...bindings],records),/unusable/)
 assert.throws(()=>bindMeasuredDimensions(recipe,bindings,new Map([[measurement,{revision:2,value:'132-135',unit:'cm'}]])),/unusable/)
})
test('the rendered and independently reviewed candidate uses server-bound measurements',async()=>{
 const f=fixture();let calls=0
 const a=createCadAssistant({...f.opts,callModel:async o=>{
  if(o.functionName==='cad-research')return reply('finish_cad_research',assessment)
  if(o.functionName==='cad-reviewer'){assert(JSON.stringify(o.messages).includes('1320'));return reviewReply()}
  return ++calls===1?reply('render_cad_candidate',{...candidate,dimension_bindings:[{definition_id:'panel',dimension:'x_mm',measurement_id:measurement,revision:2}],measurements:[{id:measurement,revision:2}]}):reply()
 }})
 assert.equal((await a.consult(request)).status,'ready');assert.equal((a.candidate!.packet.recipe.definitions[0] as any).x_mm,1320)
})
test('legacy new geometry with grouping part_ids reaches rendering without saved-source ambiguity',async()=>{
 const f=fixture();let calls=0
 const a=createCadAssistant({...f.opts,callModel:async o=>o.functionName==='cad-research'?reply('finish_cad_research',assessment):o.functionName==='cad-reviewer'?reviewReply():++calls===1?reply('render_cad_candidate',{...candidate,source_artifact_id:null,source_revision:null,part_ids:['invented-group']}):reply()})
 assert.equal((await a.consult(request)).status,'ready');assert.equal(f.renders,1);assert.deepEqual(a.candidate?.part_ids,[])
})

test('collector, designer and reviewer see the selected original image while persisted evidence contains refs only',async()=>{
 const f=fixture();let calls=0;const seen:string[]=[]
 const row:MediaRow={id:measurement,project_id:'A',title:'Relevant original reference',purpose:'reference',state:'ready',content_type:'image/png',byte_size:8,width:2,height:2,bucket_id:'bob-project-media',object_path:`A/${measurement}`,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'}
 const context=createProjectContext({hasAccess:f.opts.hasAccess,sources:[],adapters:[createMediaAdapter('A',{count:async()=>1,list:async()=>[row],read:async()=>row,download:async()=>Uint8Array.from([137,80,78,71,13,10,26,10])})]})
 const a=createCadAssistant({...f.opts,context,referenceImageRefs:()=>['image:'+measurement],callModel:async o=>{
  const content=JSON.stringify(o.messages)
  if(o.functionName==='cad-research'){assert(content.includes('image_catalog'));assert(content.includes('data:image/png;base64,iVBORw0KGgo='));seen.push('collector');return reply('finish_cad_research',assessment)}
  if(o.functionName==='cad-reviewer'){assert(content.includes('data:image/png;base64,iVBORw0KGgo='));seen.push('reviewer');return reviewReply()}
  if(++calls===1){assert(content.includes('data:image/png;base64,iVBORw0KGgo='));seen.push('designer');return reply('render_cad_candidate',candidate)}
  return reply()
 }})
 assert.equal((await a.consult(request)).status,'ready');assert.deepEqual(seen,['collector','designer','reviewer']);assert.deepEqual(f.row?.payload.reference_refs,['image:'+measurement]);assert(!JSON.stringify(f.row).includes('base64'))
})

test('P2b: cancelled/reset requests do no model work; cancellation during collection prevents design',async()=>{
 for(const status of ['cancelled','paused']){
  const f=fixture();await f.opts.requestStore.save(null,0,'needs_data',{brief:request,owner_request:'Private',reference_refs:[]})
  const a=createCadAssistant({...f.opts,requestStore:{...f.opts.requestStore,load:async()=>({...f.row!,status,reason:status==='paused'?'context_cleared':'owner_cancelled'})}})
  const out=await a.consult({...request,request_id:id})
  assert.equal(out.status,status==='paused'?'recovery_required':'cancelled');assert.equal(f.renders,0);assert.equal(a.metrics.research_calls,0)
 }
 const f=fixture();let cancelled=false,calls=0
 const original=f.opts.callModel
 f.opts.callModel=async o=>{calls++;const r=await original(o);cancelled=true;return r}
 const a=createCadAssistant({...f.opts,requestStore:{...f.opts.requestStore,assertActive:async()=>{if(cancelled)throw new Error('drawing_request_cancelled')}}})
 const result=await a.consult(request)
 assert.equal(result.status,'stopped');assert.equal(result.reason,'drawing_request_cancelled')
 assert.equal(calls,1);assert.equal(f.renders,0);assert.equal(a.candidate,null)
})

test('P2c: actual toolbox offers lifecycle tools after design consultations are spent without refilling them',async()=>{
 const {createBobToolSession}=await import('../supabase/functions/_shared/project-tools/bob-tools.ts')
 const {domainToolLoadout}=await import('./support/tool-loadout.ts')
 const f=fixture();let cancellations=0
 f.opts.callModel=async()=>reply('finish_cad_research',{checks:[check('shape','missing',true)],additional_needs:[]})
 const a=createCadAssistant({...f.opts,requestStore:{...f.opts.requestStore,
  restore:async()=>({id,revision:9,status:'collecting',payload:f.row!.payload}),
  read:async()=>({requests:[{id,revision:f.row!.revision,status:'needs_data'}],next_cursor:null}),
  cancel:async(key,revision)=>{assert.equal(key,id);assert.equal(revision,f.row!.revision);cancellations++;return {id,revision:revision+1,status:'cancelled'}},
 }})
 await a.consult(request);await a.consult({...request,request_id:id});assert.equal(a.remaining,0)
 const tools=createBobToolSession({cadAssistant:a,lookup:f.opts.makeLookup(),readPolicy:domainToolLoadout('read_drawing_requests','cancel_drawing_request','restore_drawing_request')})
 const offered=await tools.prepare()
 assert(offered.some(t=>t.function.name==='read_drawing_requests'));assert(offered.some(t=>t.function.name==='cancel_drawing_request'))
 assert(!offered.some(t=>t.function.name==='design_project_cad'))
 assert(offered.some(t=>t.function.name==='restore_drawing_request'))
 assert.equal((await tools.execute('restore_drawing_request',{request_id:id,expected_revision:1,plan_revision:1,step_id:id,request_quote:'Build the whole requested construction.'})).status,'restored')
 assert.equal(a.remaining,0,'restoration does not grant another consultation')
 assert(!(await tools.prepare()).some(t=>t.function.name==='design_project_cad'))
 const read=await tools.execute('read_drawing_requests',{request_id:id,after_id:null})
 assert.equal(read.requests[0].id,id)
 assert.equal((await tools.execute('cancel_drawing_request',{request_id:id,expected_revision:-1})).status,'invalid')
 assert.equal(cancellations,0)
 assert.equal((await tools.execute('cancel_drawing_request',{request_id:id,expected_revision:read.requests[0].revision})).status,'cancelled')
 assert.equal(cancellations,1)
})

test('P2c restore tool runs fresh intake on the same identity and cannot overwrite canonical requirements',async()=>{
 const f=fixture();let paid=0,restores=0,restored=false,blocked=true
 const canonical={...handoff,requirements:[{...handoff.requirements[0],requirement:'Keep the canonical east-side drawer requirement',basis:'project_record' as const,source_ref:measurement}]}
 const store:DrawingRequestStore={...f.opts.requestStore,
  read:async()=>({requests:[]}),cancel:async()=>({status:'cancelled'}),
  load:async()=>restored?{id,revision:3,status:'collecting',payload:{brief:{...request,handoff:canonical},owner_request:'Restore the drawing',reference_refs:[],restoration:{plan_revision:1,step_id:id}}}:{id,revision:2,status:'paused',payload:{brief:{},owner_request:null,reference_refs:[]}},
  restore:async(key,expected,plan,step,quote)=>{assert.equal(key,id);assert.equal(expected,2);assert.equal(quote,'Restore the drawing');restores++;restored=true;return (await store.load(id))!},
  save:async(key,expected,status,payload)=>({id:key!,revision:expected+1,status,payload}),
 }
 const a=createCadAssistant({...f.opts,requestStore:store,ownerRequest:'Restore the drawing',callModel:async o=>{
  paid++;if(o.functionName==='cad-research')assert(JSON.stringify(o.messages).includes('canonical east-side'))
  if(o.functionName==='cad-research')return reply('finish_cad_research',{checks:[blocked?check('shape','missing',true):{...check('shape'),source_refs:[measurement]}],additional_needs:[]})
  return f.opts.callModel(o)
 }})
 assert.equal((await a.consult({...request,request_id:id})).status,'recovery_required');assert.equal(paid,0)
 const args={request_id:id,expected_revision:2,plan_revision:1,step_id:id,request_quote:'Restore the drawing'}
 assert.equal((await a.lifecycle('restore_drawing_request',{...args,request_quote:'fabricated'})).status,'invalid');assert.equal(restores,0)
 assert.equal((await a.lifecycle('restore_drawing_request',args)).status,'restored');assert.equal(paid,0)
 const resumed=await a.consult({...request,request_id:id,handoff:{...handoff,requirements:[{...handoff.requirements[0],requirement:'Overwrite the canonical requirement'}]}})
 assert.equal(resumed.status,'needs_data');assert.equal(resumed.request_id,id);assert.equal(paid,1);assert.equal(f.renders,0)
 assert(f.reads.includes('measurements')&&f.reads.includes('plan'))
 blocked=false
 const complete=await a.consult({...request,request_id:id,handoff:canonical})
 assert.equal(complete.status,'ready',JSON.stringify(complete));assert.equal(complete.request_id,id);assert.equal(f.renders,1)
 assert.equal(a.remaining,0)
})

test('P2c changed canonical requirements stop a restored attempt before paid work',async()=>{
 const f=fixture();let paid=0
 const a=createCadAssistant({...f.opts,requestStore:{...f.opts.requestStore,load:async()=>({id,revision:3,status:'collecting',payload:{brief:request,owner_request:'Restore',reference_refs:[],restoration:{plan_revision:1,step_id:id}}}),assertActive:async()=>{throw Error('drawing_requirements_changed')}},callModel:async()=>{paid++;throw Error('must not pay')}})
 const result=await a.consult({...request,request_id:id});assert.equal(result.reason,'drawing_requirements_changed');assert.equal(paid,0);assert.equal(f.renders,0)
})


test('P2: runtime repair renders the same private draft and reviews it without another designer',async()=>{
 const f=fixture();let version='broken',fail=true,paid=0;const render=f.opts.render,model=f.opts.callModel
 const opts={...f.opts,runtimeVersion:async()=>version,render:async(r:any)=>{if(fail)throw new Error('renderer offline');return render(r)},callModel:async(o:any)=>{paid++;return model(o)}}
 const first=await createCadAssistant(opts).consult(request)
 assert.equal(first.reason,'render_failed');assert.equal(f.row?.status,'retrieval_failed');assert.deepEqual((f.row?.payload.draft as any).recipe,recipe)
 const before=paid
 assert.equal((await createCadAssistant(opts).consult({...request,request_id:id})).retry_suppressed,true);assert.equal(paid,before)
 version='repaired';fail=false
 const result=await createCadAssistant(opts).consult({...request,request_id:id})
 assert.equal(result.status,'ready');assert.equal(f.design,1,'no repeat design');assert.equal(paid,before+1,'only independent review is charged');assert.equal(f.renders,1)
})


test('P2: interrupted collecting checkpoint reuses the exact draft and clears rejected approval before failure persistence',async()=>{
 const f=fixture();let rejectReview=true,paid=0;const model=f.opts.callModel,save=f.opts.requestStore.save
 const opts={...f.opts,callModel:async(o:any)=>{paid++;return model(o)},requestStore:{...f.opts.requestStore,save:async(...args:Parameters<typeof save>)=>{
  if(rejectReview&&args[2]==='reviewed')throw Error('drawing_request_pixels_forbidden')
  if(args[2]==='retrieval_failed')assert.equal(args[3].reviewed_candidate,undefined,'failed approval must not poison failure checkpoint')
  return save(...args)
 }}}
 const failed=await createCadAssistant(opts).consult(request)
 assert.equal(failed.status,'unavailable');assert.equal(f.row?.status,'retrieval_failed');assert.equal(f.row?.payload.reviewed_candidate,undefined)
 const row=f.row!;const payload=structuredClone(row.payload);delete payload.retry
 await save(row.id,row.revision,'collecting',payload)
 const before=paid,designs=f.design;rejectReview=false
 const recovered=await createCadAssistant(opts).consult({...request,request_id:id})
 assert.equal(recovered.status,'ready');assert.equal(f.design,designs,'no additional designer after interrupted checkpoint');assert.equal(paid,before+1);assert.equal(f.renders,2)
})
