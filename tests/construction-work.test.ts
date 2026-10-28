import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { projectSchema, asProjectUser } from './support/project-schema.ts'
import { constructionFormFixture } from './support/construction-form-fixture.ts'
import { parameterPacket } from './support/cad-parameter-fixture.ts'
import { manufacturePolicy } from './support/construction-instance-policy-fixture.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createConstructionViews, constructionWorkItems } from '../supabase/functions/_shared/construction-views.ts'
import { createProjectWriter } from '../supabase/functions/_shared/project-write.ts'
import { createProjectEdits } from '../supabase/functions/_shared/project-edits.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { runProjectAnswer } from '../supabase/functions/_shared/project-answer.ts'
import { createToolSession, type ToolFollowup } from '../supabase/functions/_shared/project-tools/session.ts'
import { readTaskSources } from '../supabase/functions/_shared/task-sources.ts'
import { checkConstructionWorkOutputs, createConstructionWorkPackets } from '../supabase/functions/_shared/construction-work.ts'
import { catalogFixture, preConstructionWorkCatalogFixture, catalogCall } from './support/ai-catalog-fixture.ts'

test('one work read → atomic Solution/Construction change → complete check, through the ordinary gates', async t => {
 const publication='20261028200450_ai_construction_work_catalog.sql'
 let beforeCatalog:any
 const pg=await projectSchema(async(db,name)=>{
  if(name===publication)beforeCatalog=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
 });t.after(()=>pg.close())
 const rpc=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>
  ((await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0] as any).result
 const owner=randomUUID(),outsider=randomUUID(),turn=randomUUID(),solution=randomUUID()
 const message='Make this same frame wider and deeper; preserve the other requirements and check the result.'
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'work@example.test',outsider,'outside@example.test'])
 const project=(await rpc(owner,'bob.create_project',[JSON.stringify({name:'Coherent work fixture'})])).id
 const {intent,recipe,refinement}=constructionFormFixture()
 const body={title:'Frame and future drawer',description:'Preserve the later drawer requirement.',assumptions:'Strength unknown',tradeoffs:'Partial concept',measurements:[],design_intent:intent}
 await rpc(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify(body)])
 await rpc(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:message})])
 const claim=await rpc(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 const binding=[project,claim.thread_id,turn,claim.generation]
 // Match the existing service-owned unlimited-work pin; no production budget
 // or permission is changed by this isolated fixture.
 const manifest=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) m")).rows[0].m
 await pg.query(`insert into bob_private.bob_jobs(id,project_id,actor_id,thread_id,turn_id,generation,status,
  claim_token,lease_until,credential,worker_url,expires_at,work_allowance_version,ai_catalog_manifest_id)
  values($1,$2,$3,$4,$5,$6,'running',$7,clock_timestamp()+interval '4 minutes','{"fixture":true}',
  'https://fixture.supabase.co/functions/v1/bob-worker',clock_timestamp()+interval '30 minutes',1,$8)`,
  [randomUUID(),project,owner,claim.thread_id,turn,claim.generation,randomUUID(),manifest.manifest_id])
 const write=(payload:any)=>rpc(owner,payload.kind==='construction_work'?'bob.commit_construction_work':'bob.bob_project_write_v17',[...binding,JSON.stringify(payload)])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,
  data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const initial=await write({kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,
  data:{key:'initial',title:'Frame',description:body.description,area_id:null,target_revision:1,change_note:'Initial',recipe,parameters:parameterPacket(project,recipe),
   materials:[{definition_id:'rail',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],instance_policy:manufacturePolicy(recipe),open_questions:['Joinery unverified'],form_refinement:refinement}})
 const id=initial.recordId,read=(revision:number|null=null)=>rpc(owner,'bob.read_construction_draft',[project,id,revision,null])
 const first=await read(),right=first.parameters.bindings.find((b:any)=>b.path==='instances/right/placement/x').node
 const depth=first.parameters.bindings.find((b:any)=>b.path==='definitions/rail/y_mm').node
 let access=true,lostResponse=false,lastPayload:any,preparedPayload:any
 const sqlErrors:string[]=[]
 const transport=async(payload:any)=>{
  lastPayload=structuredClone(payload)
  try{const data=await write(payload);if(lostResponse){lostResponse=false;return {data:null,error:{code:'network',message:'Lost response'}}}return {data,error:null}}
  catch(e:any){sqlErrors.push(e.message);return {data:null,error:{code:e.code,message:e.message}}}
 }
 const writer=createProjectWriter(project,message,transport,async()=>({data:[],error:null}),async()=>({data:[],error:null}),{unlimitedWork:true})
 const edits=createProjectEdits({projectId:project,writer,hasAccess:async()=>access,unlimitedWork:true,
  read:async q=>({data:await rpc(owner,'bob.read_bob_edit_context',[project,q.resource,q.query,q.after]),error:null}),
  readSelected:async area=>({data:await rpc(owner,'bob.read_bob_selected_edit_context',[project,area]),error:null})})
 const preparation=(name:string)=>async(payload:any)=>{
  preparedPayload=structuredClone(payload)
  try{return await rpc(owner,name,[...binding,JSON.stringify(payload)])}
  catch(e:any){return {status:e.code==='42501'?'denied':['PT409','40001'].includes(e.code)?'conflict':e.code==='22023'?'invalid':'unavailable',reason:e.message}}
 }
 let storedReads=0
 const options={projectId:project,message,writer,hasAccess:async()=>access,unlimitedWork:true,constructionViews:true,formEvidence:true,constructionSourceRefresh:true,coherentWork:true,
  now:()=>new Date('2026-10-28T20:00:00Z'),read:(_id:string|null,revision:number|null)=>read(revision),readCurrent:()=>read(),
  readSources:async()=>({project:new Map(),physical:new Map()}),
  prepareEdit:preparation('bob.prepare_construction_edit'),prepareParameterChange:preparation('bob.prepare_construction_parameter_change'),prepareWork:preparation('bob.prepare_construction_work'),prepareSolutionEdit:edits.prepare,
  readCatalog:async(mid:string,revision:number)=>({projectId:project,status:'ok',record:{id:mid,revision,current_revision:revision,kind:'material',source_kind:'design_choice',profile_code:'sheet_stock',categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null}}}}),
  saveObservation:async(o:any)=>rpc(null,'bob.bob_record_construction_observation',[project,owner,claim.thread_id,turn,claim.generation,JSON.stringify(o)],'service_role'),
  readObservations:async(aid:string,revision:number,result:string|null,after:string|null)=>{storedReads++;return rpc(owner,'bob.read_construction_results',[project,aid,revision,result,after])},
  readWorkSources:async(draft:any,stepId:string|null)=>{
   const snapshots=await rpc(owner,'bob.read_bob_selected_edit_context',[project,null]),s=snapshots[0]
   const packet=await readTaskSources({area_id:draft?.area_id??null,step_id:stepId,construction:draft?{artifact_id:id,revision:draft.revision}:null},{projectId:project,
    search:async q=>q.dataset==='target'?{status:'ok',records:[{id:'project',revision:s.target.revision,solution_id:s.record.id,solution_revision:s.record.revision,design_intent:s.record.design_intent}]}:{status:'empty',records:[]},
    construction:draft?q=>createConstructionViews(project).read(draft,q as any):undefined})
   return {packet,solutionEdit:await edits.readSelected(null)}
  },
 }
 const tools=createConstructionTools(options)
 const catalog=catalogFixture(),policyNames=tools.tools.map(s=>s.function.name)
 const session=createToolSession({definitions:tools.tools.map(spec=>({spec,version:1,gate:()=>'available' as const,execute:v=>tools.execute(spec.function.name,v)})),
  readPolicy:async()=>({phase:'design',tools:policyNames.map(name=>({name,description:name,how_to:'',schema_version:1,always_load:false,preload_phases:[],active:true}))}),
  message,toolInstructions:'lazy',selectiveTools:true,preloadTools:()=>['read_construction_draft','change_construction_parameters'],
  followups:catalog.definition('bob.tools','tool_contract').definition.operation_followups as ToolFollowup[],catalogTool:(name,p)=>catalog.tool(name,p)})
 const query=(revision:number|null=null,kind='parameters')=>({artifact_id:id,revision,after:null,view:'work',ids:[],result_id:null,section:null,step_id:null,work_kind:kind})
 let work:any,editRef:string,successful:any
 const solutionChanges=(width:number,deep:number)=>[
  {op:'set',path:`/design_intent/model/nodes/${intent.model.nodes.findIndex(n=>n.id==='frame_s0')}/value`,value_json:JSON.stringify(width)},
  {op:'set',path:`/design_intent/model/nodes/${intent.model.nodes.findIndex(n=>n.id==='frame_s1')}/value`,value_json:JSON.stringify(deep)},
  {op:'set',path:'/design_intent/alignment',value_json:JSON.stringify({status:'aligned',basis:'Requested dimensions preserve the frame requirements and later drawer.'})},
 ]
 const command=(key:string,revision:number,width:number,deep:number)=>({key,record_id:id,expected_revision:revision,target_revision:null,request_quote:message,change_note:'Change both frame dimensions together',
  solution_edit:{edit_ref:editRef,changes:solutionChanges(width,deep),reason:'Requested wider and deeper frame'},
  changes:[{id:right,role:'decision',value:width-18,unit:'mm',reason:'Requested frame width'},{id:depth,role:'decision',value:deep,unit:'mm',reason:'Requested frame depth'}]})
 await t.test('publication changes only four tool interfaces and deterministic availability; old manifests and prompts remain intact',async()=>{
  const current=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  const keys=['bob.tools','tools.read_construction_draft','tools.change_construction_parameters','tools.edit_construction_parts','tools.check_construction_draft']
  for(const prior of beforeCatalog.definitions){
   const row=current.definitions.find((r:any)=>r.prompt_key===prior.prompt_key)
   if(!keys.includes(prior.prompt_key))assert.deepEqual(row,prior,prior.prompt_key)
   else{assert.equal(row.version,prior.version+1);assert.equal(row.content,prior.content);assert.deepEqual(row.definition,catalog.definition(row.prompt_key,row.definition_kind).definition)}
  }
  assert.deepEqual(catalog.definition('bob.tools','tool_contract').definition.core_tools,preConstructionWorkCatalogFixture().definition('bob.tools','tool_contract').definition.core_tools)
  assert.equal(catalog.role('ask-bob').reasoningEffort,'medium')
  assert.equal((preConstructionWorkCatalogFixture().definition('tools.read_construction_draft','tool_contract').definition.parameters as any).properties.view.enum.includes('work'),false)
  await pg.exec(readFileSync(new URL('../supabase/migrations/'+publication,import.meta.url),'utf8'))
  const again=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  assert.deepEqual(again.definitions,current.definitions)
 })
 await t.test('one packet contains editable IDs, dependency closure, original requirements and a bound Solution edit',async()=>{
  const offered=await session.prepare();assert(!offered.some(t=>t.function.name==='check_construction_draft'))
  work=await session.execute('read_construction_draft',query(1));assert.equal(work.status,'ok',JSON.stringify(work));assert.equal(work.coverage.complete,true)
  assert(work.items.some((r:any)=>r.collection==='nodes'&&r.id===right));assert(work.items.some((r:any)=>r.collection==='nodes'&&r.id===depth))
  assert.equal(work.items.filter((r:any)=>r.collection==='instances').length,2)
  const edit=work.items.find((r:any)=>r.collection==='solution_edit').value
  editRef=edit.entry.edit_ref;assert.match(editRef,/^edit_/)
  assert(edit.entry.content.design_intent.features.some((f:any)=>f.description==='Synthetic drawer requirement'))
  const again=await tools.execute('read_construction_draft',query(1));assert.equal(again.diagnostics.reused,true)
 })
 await t.test('a rejected geometry change rolls back Solution, selection, Construction and every receipt',async()=>{
  const invalid=command('invalid-joint-work',1,620,450);invalid.changes[0].value=603
  const before=(await pg.query<any>('select count(*)::int n from bob_private.bob_write_receipts where project_id=$1',[project])).rows[0].n
  const result=await session.execute('change_construction_parameters',invalid)
  assert.equal(result.status,'invalid',JSON.stringify({result,sqlErrors}));assert(sqlErrors.some(s=>s.includes('concept_geometry_changed')),JSON.stringify(sqlErrors))
  const snapshot=(await rpc(owner,'bob.read_bob_selected_edit_context',[project,null]))[0]
  assert.equal(snapshot.record.revision,1);assert.equal(snapshot.target.revision,1);assert.equal((await read()).revision,1)
  assert.equal((await pg.query<any>('select count(*)::int n from bob_private.bob_write_receipts where project_id=$1',[project])).rows[0].n,before)
 })
 await t.test('project outsiders, stale selected heads and mismatched scopes cannot use the composed RPC',async()=>{
  await assert.rejects(rpc(outsider,'bob.read_bob_selected_edit_context',[project,null]),/project_denied/)
  await assert.rejects(rpc(outsider,'bob.prepare_construction_work',[...binding,JSON.stringify(preparedPayload)]),/project_denied|turn_not_claimed/)
  const forged=structuredClone(preparedPayload);forged.data.solution.data.target.area_id='wrong-area'
  await assert.rejects(rpc(owner,'bob.prepare_construction_work',[...binding,JSON.stringify(forged)]),/construction_solution_changed/)
  const other=structuredClone(preparedPayload);other.data.solution.record_id=randomUUID()
  await assert.rejects(rpc(owner,'bob.commit_construction_work',[...binding,JSON.stringify(other)]),/construction_solution_changed/)
  assert.equal((await read()).revision,1)
 })
 await t.test('two dimensions and their selected concept commit as one new Construction revision and expose the checker',async()=>{
  let calls=0,completionCalls=0;const events:any[]=[]
  const result=await runProjectAnswer({projectId:project,userId:owner,message,writer,projectEdits:edits,constructionTools:tools,hasAccess:async()=>access,unlimitedWork:true,aiCatalog:catalog,
   lookup:createProjectLookup(project,async(_project,q)=>({data:{records:q.dataset==='project'?[{id:project,name:'Coherent work fixture'}]:[],related:[],truncated:false},error:null}),undefined,undefined,undefined,{unlimitedWork:true}),
   onTool:event=>events.push(event),callModel:catalogCall(async options=>{
    if(options.functionName==='completion-gate'){completionCalls++;return {success:true,model:'fixture',data:JSON.stringify({work_remaining:false}),usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}
    calls++;const latest=()=>JSON.parse(String(options.messages?.filter(m=>m.role==='tool').at(-1)?.content))
    const next=(name:string,args:unknown)=>({success:true,model:'fixture',data:null,responseId:'coherent-'+calls,usage:{input_tokens:1,output_tokens:1,total_tokens:2},
     toolCalls:[{id:'call-'+calls,type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
    assert.equal(options.aiDefinition?.reasoningEffort,'medium')
    if(calls===1)return next('read_construction_draft',query(1))
    if(calls===2){const packet=latest();assert.equal(packet.coverage.complete,true);assert.equal(packet.diagnostics,undefined,'worker-local reuse telemetry never enters replay-sensitive model input');editRef=packet.items.find((r:any)=>r.collection==='solution_edit').value.entry.edit_ref
     successful=command('both-dimensions',1,620,450);return next('change_construction_parameters',successful)}
    if(calls===3){const saved=latest();assert.equal(saved.status,'saved',JSON.stringify(saved));assert.equal(saved.receipt.recordId,id)
     assert(options.tools?.some(t=>t.function.name==='check_construction_draft'),'checker is offered directly after the saved change')
     return next('check_construction_draft',{artifact_id:id,revision:saved.receipt.revision,component_ids:[],requirement_checks:[],outputs:[]})}
    assert(calls===4||calls===5)
    if(calls===4){assert.equal(latest().status,'checked');assert.equal(latest().coverage.complete,true);assert.equal(latest().diagnostics,undefined)}
    // The existing post-write completion review remains a separate main
    // request. This change removes discovery rounds, not that safety contract.
    return {success:true,model:'fixture',data:'Ramens bredd och djup är sparade och geometrin kontrollerad. Tillverkningsfrågorna kvarstår.',responseId:'coherent-final',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
   },catalog)})
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(calls,5);assert.equal(completionCalls,0)
  assert.deepEqual(events.map(e=>e.name),['read_construction_draft','change_construction_parameters','check_construction_draft'])
  assert.deepEqual(events.map(e=>e.diagnostics?.operation),['work_read','work_change','work_check'])
  const after=await read();assert.equal(after.source_state,'current');assert.equal(after.target_revision,2);assert.equal(after.solution_revision,2)
  assert.equal(after.recipe.instances[1].placement.x,602);assert.equal(after.recipe.definitions[0].y_mm,450)
  for(const field of ['materials','joints','instance_policy','form_refinement'])assert.deepEqual(after[field],first[field],field)
  assert(writer.receipts.some(r=>r.dataset==='solutions'));assert(writer.receipts.some(r=>r.dataset==='target'))
 })
 await t.test('one check returns its findings and coverage; same-revision evidence survives a worker restart',async()=>{
  const input={artifact_id:id,revision:2,component_ids:[],requirement_checks:[],outputs:[]}
  const result=await tools.execute('check_construction_draft',input)
  assert.equal(result.status,'checked',JSON.stringify(result));assert.equal(result.coverage.complete,true)
  assert(Array.isArray(result.issues));assert.equal(result.details_omitted,false);assert.equal(result.outputs.status,'not_requested')
  assert.equal(result.form_evidence.whole_delivery_ready,false);assert.equal(result.fabrication_ready,false)
  const count=storedReads,again=await tools.execute('check_construction_draft',input)
  assert.equal(again.diagnostics.reused,true);assert.equal(again.result.result_id,result.result.result_id);assert.equal(storedReads,count)
  const resumed=createConstructionTools(options),reopened=await resumed.execute('check_construction_draft',input)
  assert.equal(reopened.diagnostics.reused,true,JSON.stringify(reopened));assert.equal(reopened.result.result_id,result.result.result_id)
  access=false;assert.equal((await resumed.execute('check_construction_draft',input)).status,'denied');access=true
 })
 await t.test('part deltas share the same atomic source path and exact replay never duplicates later work',async()=>{
  const packet=await tools.execute('read_construction_draft',query(2,'parts'));editRef=packet.items.find((r:any)=>r.collection==='solution_edit').value.entry.edit_ref
  const draft=await read(),old=draft.parameters.nodes.find((n:any)=>n.id===depth),{normalized,sources,...node}=old
  const parts={key:'parts-and-solution',record_id:id,expected_revision:2,target_revision:null,request_quote:message,change_note:'Revise depth through the bounded part editor',
   solution_edit:{edit_ref:editRef,changes:solutionChanges(620,460),reason:'Requested deeper frame'},changes:{nodes:{upsert:[{...node,value:460}],remove:[]}}}
  const result=await tools.execute('edit_construction_parts',parts)
  assert.equal(result.status,'saved',JSON.stringify({result,sqlErrors}));assert.equal((await read()).revision,3);assert.equal((await read()).source_state,'current')
  const replay=await tools.execute('change_construction_parameters',successful)
  assert.equal(replay.status,'saved',JSON.stringify(replay));assert.equal(replay.receipt.revision,2);assert.equal(replay.diagnostics.reused,true)
  assert.equal((await read()).revision,3);assert.equal(writer.receipts.find(r=>r.recordId===id)!.revision,3)
  assert.equal((await tools.execute('change_construction_parameters',{...successful,change_note:'Different intent with the same key'})).status,'conflict')
  assert.equal((await tools.execute('check_construction_draft',{artifact_id:id,revision:2,component_ids:[],requirement_checks:[],outputs:[]})).status,'conflict')
 })
 await t.test('a lost response preserves one committed operation; recovery reuses its receipt',async()=>{
  const packet=await tools.execute('read_construction_draft',query(3));editRef=packet.items.find((r:any)=>r.collection==='solution_edit').value.entry.edit_ref
  lostResponse=true
  const result=await tools.execute('change_construction_parameters',command('lost-response',3,640,460))
  assert.equal(result.status,'unknown',JSON.stringify({result,sqlErrors}));assert.equal((await read()).revision,4)
  const receipt=await write(lastPayload);assert.equal(receipt.revision,4);assert.equal((await read()).revision,4)
  assert.equal((await rpc(owner,'bob.prepare_construction_work',[...binding,JSON.stringify({...lastPayload,data:{...lastPayload.data,construction:{...lastPayload.data.construction,data:{...lastPayload.data.construction.data,computed:null}}}})] )).status,'saved')
 })
})

test('work selection closes new neighbors, and source changes cannot splice a paged packet',async()=>{
 const {recipe}=constructionFormFixture()
 const draft:any={projectId:'p',artifact_id:randomUUID(),revision:1,current_revision:1,source_state:'current',archived:false,description:'x'.repeat(80000),
  recipe,parameters:parameterPacket('p',recipe),materials:[],joints:[{id:'join',first:{instance_id:'left'},second:{instance_id:'right'}}],instance_policy:manufacturePolicy(recipe),open_questions:[]}
 const selected=constructionWorkItems(draft,['left'])
 const rightNode=draft.parameters.bindings.find((b:any)=>b.path==='instances/right/placement/x').node
 assert(selected.items.some(i=>i.collection==='nodes'&&i.id===rightNode));assert(selected.items.some(i=>i.collection==='instances'&&i.id==='right'))
 const packets=createConstructionWorkPackets('p'),query={artifact_id:draft.artifact_id,revision:1,view:'work',ids:[],result_id:null,section:null,after:null,step_id:null,work_kind:'inspect'}
 const sources:any={packet:{status:'ok',projectId:'p',solution:{status:'empty'},coverage:[],conflicts:[]},solutionEdit:{status:'empty'}}
 const page=await packets.read(draft,query,sources);assert.equal(page.coverage.complete,false);assert(page.next_read)
 const again=await packets.read(draft,query,sources),fresh=await createConstructionWorkPackets('p').read(draft,query,sources)
 const content=({diagnostics,...rest}:any)=>rest
 assert.equal(again.diagnostics.reused,true);assert.equal(fresh.diagnostics.reused,false)
 assert.deepEqual(content(again),content(fresh),'cache loss cannot change exact fragments, coverage or continuation bytes')
 sources.packet.step={status:'ok',plan_revision:2}
 await assert.rejects(packets.read(draft,page.next_read,sources),/construction_view_cursor_invalid/)
})

test('delivery check follows all index pages and never accepts stale, missing or denied reopenings',async()=>{
 const project='p',id=randomUUID(),one=randomUUID(),two=randomUUID();let opens=0,access=true
 const page=(after:string|null)=>({status:'ok',projectId:project,artifact_id:id,revision:2,resource:'drawings',index_only:true,
  records:[{id:after?two:one,revision:1,current_revision:1,archived:false,source:{artifact_id:id,revision:2}}],truncated:after===null,next_after:after===null?one:null})
 const readers={hasAccess:async()=>access,read:async(_id:string,_r:number,_resource:any,after:string|null)=>page(after),
  open:async(_resource:any,recordId:string,revision:number)=>{opens++;return {status:'ok',record:{id:recordId,revision,source_state:'current'}}}}
 const good=await checkConstructionWorkOutputs(project,id,2,['drawings'],readers)
 assert.equal(good.status,'current');assert.equal(opens,2)
 const stale=await checkConstructionWorkOutputs(project,id,2,['drawings'],{...readers,open:async()=>({status:'ok',record:{id:one,revision:2,source_state:'changed'}})})
 assert.equal(stale.status,'incomplete')
 const missing=await checkConstructionWorkOutputs(project,id,2,['drawings'],{...readers,read:async()=>({...page(one),records:[]})})
 assert.equal(missing.resources[0].status,'missing')
 access=false;assert.equal((await checkConstructionWorkOutputs(project,id,2,['drawings'],readers)).status,'denied')
})

test('large delivery inventories retain failures beyond the detail budget and report traversal limits',async()=>{
 const project='p',id=randomUUID(),ids:string[]=Array.from({length:400},()=>randomUUID())
 let opens=0
 const readers={hasAccess:async()=>true,read:async(_id:string,_revision:number,resource:any,after:string|null)=>{
  const start=after===null?0:ids.indexOf(after)+1,end=Math.min(start+12,60)
  return {status:'ok',projectId:project,artifact_id:id,revision:1,resource,index_only:true,
   records:ids.slice(start,end).map(id=>({id,revision:1,current_revision:1,source:{artifact_id:_id,revision:1}})),truncated:end<60,next_after:end<60?ids[end-1]:null}
 },open:async(_resource:any,recordId:string)=>{opens++;return {id:recordId,revision:1,source_state:recordId===ids[59]?'changed':'current'}}}
 const result=await checkConstructionWorkOutputs(project,id,1,['drawings'],readers)
 assert.equal(opens,60);assert.equal(result.status,'incomplete');assert.equal(result.resources[0].complete,true)
 assert.equal(result.resources[0].records.length,48);assert.equal(result.resources[0].record_count,60);assert.equal(result.resources[0].details_omitted,true)
 assert.equal(result.resources[0].details_read.tool,'read_construction_delivery')
 const limited=await checkConstructionWorkOutputs(project,id,1,['drawings'],{...readers,read:async(_id,_revision,resource,after)=>{
  const start=after===null?0:ids.indexOf(after)+1,end=start+12
  return {status:'ok',projectId:project,artifact_id:id,revision:1,resource,index_only:true,
   records:ids.slice(start,end).map(id=>({id,revision:1,current_revision:1,source:{artifact_id:_id,revision:1}})),truncated:true,next_after:ids[end-1]}
 }})
 assert.equal(limited.status,'incomplete');assert.equal(limited.resources[0].complete,false);assert.equal(limited.resources[0].record_count,384)
})
