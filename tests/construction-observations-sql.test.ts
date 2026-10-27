import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {parameterPacket} from './support/cad-parameter-fixture.ts'
import {manufacturePolicy} from './support/construction-instance-policy-fixture.ts'
import {createConstructionTools,CONSTRUCTION_EVIDENCE_CHECK_TOOL} from '../supabase/functions/_shared/construction-draft.ts'
import {CONSTRUCTION_EVIDENCE_VIEW_TOOL} from '../supabase/functions/_shared/construction-views.ts'
import {createAiCatalogSession} from '../supabase/functions/_shared/ai-catalog.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import {countSerializedTokens} from '../supabase/functions/_shared/bob-token-budget.ts'

test('FORM observations survive a private reset, remain source-bound, and cannot be forged through a member API',async t=>{
 let before:any
 const pg=await projectSchema(async(db,name)=>{if(name==='20261027101808_ai_construction_evidence_catalog.sql')before=(await db.query("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result});t.after(()=>pg.close())
 const owner=randomUUID(),stranger=randomUUID(),turn=randomUUID(),solution=randomUUID(),message='Develop the frame; keep later work open.'
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'evidence@example.test',stranger,'stranger@example.test'])
 const call=async(uid:string|null,name:string,args:any[],role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,role)).rows[0].result
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'FORM evidence'})])).id
 const other=(await call(owner,'bob.create_project',[JSON.stringify({name:'Other project'})])).id
 const {intent,recipe,refinement}=constructionFormFixture()
 const body={title:'Frame with later drawers',description:'Synthetic only',assumptions:'Not measured',tradeoffs:'Not approved',measurements:[],design_intent:intent}
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify(body)])
 const target=await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Fixture'})])
 const claim=await call(null,'bob.bob_claim_turn',[project,owner,turn,message],'service_role')
 const write=(payload:any)=>call(owner,'bob.bob_project_write_v17',[project,claim.thread_id,turn,claim.generation,JSON.stringify(payload)])
 const material=await write({kind:'catalog',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{action:'ensure',key:'material',kind:'material',name:'Fixture plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'',source_kind:'design_choice',source_quote:message,source_seq:null}})
 const payload:any={kind:'construction',record_id:null,expected_revision:0,expected_updated_at:null,request_quote:message,data:{key:'frame',title:'Frame',description:'A development checkpoint',area_id:null,target_revision:target.revision,change_note:'Initial',recipe,parameters:parameterPacket(project,recipe),materials:[{definition_id:'rail',material_id:material.recordId,material_revision:1,part_id:null,part_revision:null}],joints:[],instance_policy:manufacturePolicy(recipe),open_questions:[],form_refinement:refinement}}
 const saved=await write(payload),id=saved.recordId
 const read=(revision:number|null)=>call(owner,'bob.read_construction_draft',[project,id,revision,null])
 const record=(o:any,user=owner,p=project,generation=claim.generation)=>call(null,'bob.bob_record_construction_observation',[p,user,claim.thread_id,turn,generation,JSON.stringify(o)],'service_role')
 const history=(result:string|null=null,after:string|null=null,p=project,uid=owner)=>call(uid,'bob.read_construction_results',[p,id,1,result,after])
 let catalogReads=0,observations:any[]=[],checks:any[]=[],laterClaim:any,laterTurn:string
 const options={projectId:project,message,constructionViews:true,formEvidence:true,unlimitedWork:true,hasAccess:async()=>true,
  read:async(_id:string|null,revision:number|null)=>read(revision),readSources:async()=>({project:new Map(),physical:new Map()}),
  readCatalog:async(materialId:string,revision:number)=>{catalogReads++;return call(owner,'bob.catalog_read',[project,JSON.stringify({action:'read',id:materialId,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}})])},
  saveObservation:async(o:any)=>{observations.push(structuredClone(o));return record(o)},
  readObservations:async(_id:string,revision:number,result:string|null,after:string|null)=>call(owner,'bob.read_construction_results',[project,id,revision,result,after])}
 await t.test('immutable catalog publication opts in current jobs while preserving all other definitions and prior schemas',async()=>{
  const manifest:any=(await pg.query("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result
  const current=createAiCatalogSession({rpc:async()=>({data:null,error:null})} as any,{app:'bob',manifest})
  const prior=createAiCatalogSession({rpc:async()=>({data:null,error:null})} as any,{app:'bob',manifest:before})
  for(const tool of [CONSTRUCTION_EVIDENCE_CHECK_TOOL,CONSTRUCTION_EVIDENCE_VIEW_TOOL]){
   const key='tools.'+tool.function.name,row=manifest.definitions.find((r:any)=>r.prompt_key===key)
   assert.deepEqual(current.tool(tool.function.name).function.parameters,tool.function.parameters)
   assert.equal(row.metadata.construction_evidence_version,1)
   assert.deepEqual(catalogFixture().definition(key,row.definition_kind).definition,row.definition)
  }
  assert.equal(prior.tool('check_construction_draft').function.parameters.properties.component_ids,undefined)
  assert(!prior.tool('read_construction_draft').function.parameters.properties.view.enum.includes('results'))
  for(const old of before.definitions.filter((r:any)=>!['tools.check_construction_draft','tools.read_construction_draft'].includes(r.prompt_key)))assert.deepEqual(manifest.definitions.find((r:any)=>r.prompt_key===old.prompt_key),old)
 })
 await t.test('real tool stores exact code output and bounded history pages reopen it in a new session',async()=>{
  for(let n=0;n<6;n++){
   const checked=await createConstructionTools(options).execute('check_construction_draft',{artifact_id:id,revision:1,component_ids:['frame'],requirement_checks:[{id:'span'+n,feature_id:'frame',kind:'minimum_span',component_id:'frame',axis:'x',minimum_node:'frame_s0'}]})
   assert.equal(checked.status,'checked',JSON.stringify(checked));assert.equal(checked.persistence,'saved');checks.push(checked)
  }
  const calls=catalogReads,newTurn=createConstructionTools(options)
  const q={artifact_id:id,revision:1,view:'results',ids:[],result_id:null,section:null,after:null}
  const first=await newTurn.execute('read_construction_draft',q)
  assert.equal(first.coverage.total_items,6);assert.equal(first.items.length,4);assert.equal(first.coverage.complete,false);assert(countSerializedTokens(first)<2000)
  const second=await newTurn.execute('read_construction_draft',first.next_read)
  assert.equal(second.items.length,2);assert.equal(second.coverage.end_of_selection,true);assert.equal(second.coverage.complete,false)
  assert.equal(new Set([...first.items,...second.items].map((r:any)=>r.id)).size,6)
  const detail=await createConstructionTools(options).execute('read_construction_draft',{...checks[0].result.read,section:'form_evidence.property_checks'})
  assert.equal(detail.reuse_status,'current_for_analysis');assert.equal(detail.items[0].value.id,'span0');assert.equal(detail.items[0].value.status,'passed')
  assert.equal(catalogReads,calls,'a new turn only reads saved observations')
  assert.deepEqual((await history(observations[0].id)).observation,observations[0])
  assert.deepEqual(await record({...observations[0],observed_at:new Date().toISOString()}),observations[0],'same result ID preserves first observation time')
  await assert.rejects(history(null,first.next_read.after.replace(':1:',':2:')),/cursor_invalid/)
 })
 await t.test('real database boundaries reject direct forgery, wrong project, wrong claim and envelope substitution',async()=>{
  const o=observations[0]
  await assert.rejects(call(owner,'bob.bob_record_construction_observation',[project,owner,claim.thread_id,turn,claim.generation,JSON.stringify(o)]),/permission denied/)
  await assert.rejects(asProjectUser(pg,owner,'insert into bob_private.construction_observations(project_id,artifact_id,artifact_revision,result_id,observation) values($1,$2,1,$3,$4)',[project,id,o.id,JSON.stringify(o)]),/permission denied/)
  await assert.rejects(asProjectUser(pg,owner,'select * from bob_private.construction_observations'),/permission denied/)
  await assert.rejects(history(o.id,null,project,stranger),/project_denied/)
  assert.equal((await history(o.id,null,other)).status,'not_found')
  await assert.rejects(record(o,stranger),/denied|claim/)
  await assert.rejects(record(o,owner,project,Number(claim.generation)+1),/claim|context_changed|conversation_changed/)
  await assert.rejects(record(o,owner,other),/denied|claim|context_changed|conversation_changed/)
  const forged=structuredClone(o);forged.output.concept_ready=true
  await assert.rejects(record(forged),/invalid_construction_observation/)
  const rebound=structuredClone(o);rebound.output.form_evidence.source_binding.solution_revision++
  await assert.rejects(record(rebound),/construction_source_mismatch/)
  const reused=structuredClone(o);reused.output.form_evidence.property_checks[0].status='failed'
  await assert.rejects(record(reused),/construction_observation_reused/)
 })
 await t.test('a reset removes the private claim, retains project evidence and permits reading from a genuinely new turn',async()=>{
  await call(null,'bob.bob_commit_turn_v2',[project,owner,claim.thread_id,turn,claim.generation,'Fixture check saved',JSON.stringify({kind:'ai_assessment',sources:[],partial:false}),'resp_fixture'],'service_role')
  const thread:any=(await pg.query('select next_seq from bob.bob_threads where id=$1',[claim.thread_id])).rows[0]
  await call(owner,'bob.bob_reset_conversation',[project,claim.thread_id,thread.next_seq])
  await assert.rejects(record(observations[0]),/denied|claim|context_changed|conversation_changed/)
  const nextTurn=randomUUID(),next=await call(null,'bob.bob_claim_turn',[project,owner,nextTurn,'Read the earlier checks'],'service_role')
  laterClaim=next;laterTurn=nextTurn
  assert.notEqual(next.thread_id,claim.thread_id)
  const result=await createConstructionTools(options).execute('read_construction_draft',{...checks[0].result.read,section:'form_evidence.property_checks'})
  assert.equal(result.items[0].value.id,'span0');assert.equal(result.reuse_status,'current_for_analysis')
 })
 await t.test('source revisions and archives preserve history but stop current reuse and new stale records',async()=>{
  const changed=structuredClone(body);changed.design_intent.model.nodes.find(n=>n.id==='frame_s0')!.value=620
  await call(owner,'bob.solution_command',[project,'revise',solution,1,JSON.stringify({...changed,change_note:'Wider'})])
  await call(owner,'bob.solution_command',[project,'select',solution,target.revision,JSON.stringify({solution_revision:2,reason:'Use new width'})])
  const result=await createConstructionTools(options).execute('read_construction_draft',{...checks[0].result.read,section:'form_evidence.property_checks'})
  assert.equal(result.reuse_status,'source_changed');assert.equal(result.items[0].value.actual_mm,600)
  assert.equal((await history(observations[0].id)).source_state,'changed')
  const old=structuredClone(observations[0]);old.id='cs_'+'f'.repeat(64)
  const staleRecord=()=>call(null,'bob.bob_record_construction_observation',[project,owner,laterClaim.thread_id,laterTurn,laterClaim.generation,JSON.stringify(old)],'service_role')
  await assert.rejects(staleRecord(),/construction_source_changed/)
  await call(owner,'bob.artifact_command',[project,'archive',id,1,'{}'])
  const archived=await createConstructionTools(options).execute('read_construction_draft',checks[0].result.read)
  assert.equal(archived.reuse_status,'source_changed');assert.equal(archived.archived,true)
  await pg.query('update bob.people set auth_user_id=null where project_id=$1 and auth_user_id=$2',[project,owner])
  await assert.rejects(history(observations[0].id),/project_denied/)
  await assert.rejects(staleRecord(),/denied/)
 })
})
