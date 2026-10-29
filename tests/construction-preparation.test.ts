import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createToolSession, type ToolFollowup } from '../supabase/functions/_shared/project-tools/session.ts'
import { applyProjectDelta, createProjectEdits, type EditSnapshot } from '../supabase/functions/_shared/project-edits.ts'
import { constructionFormFixture } from './support/construction-form-fixture.ts'
import { designIntent, designIntentPin } from './support/design-intent-fixture.ts'
import { catalogFixture, preCreationCatalogFixture } from './support/ai-catalog-fixture.ts'
import { projectSchema } from './support/project-schema.ts'
const solution='10000000-0000-4000-8000-000000000001'
const query={artifact_id:null,revision:null,after:null,view:'work',ids:[],result_id:null,section:null,step_id:null,work_kind:'inspect'}
function fixture(){
 let access=true,reads=0,writes=0
 const snapshot:EditSnapshot={project_id:'p',key:'project',resource:'selected_solutions',scope_label:'Project',record:{id:solution,revision:1,title:'Box',description:'Box',assumptions:'',tradeoffs:'',design_intent:designIntent('concept'),source_media_id:null},measurements:[],target:{area_id:null,revision:2,solution_id:solution,solution_revision:1}}
 const edits=createProjectEdits({projectId:'p',hasAccess:async()=>access,read:async()=>({data:[snapshot],error:null}),readSelected:async()=>({data:[snapshot],error:null})})
 const readiness:any={status:'needs_data',project_id:'p',area_id:null,target_revision:2,solution_id:solution,solution_revision:1,purpose:'construction',design_intent:designIntent('concept'),issues:[{code:'purpose_mismatch',choice_id:null,message:'The selected intent is for concept, not construction.'}],deferred_choice_ids:[],pin:null}
 const packet:any={status:'ok',projectId:'p',scope:{area_id:null,step_id:null},solution:{status:'ok',target_revision:2,solution_id:solution,solution_revision:1},coverage:[],conflicts:[]}
 const opts:any={projectId:'p',message:'Make a box',hasAccess:async()=>access,unlimitedWork:true,constructionViews:true,coherentWork:true,creationPreparation:true,
  read:async()=>{throw Error('New work must not search for a nonexistent draft')},readSources:async()=>({project:new Map(),physical:new Map()}),readCatalog:async()=>{throw Error('No guessed material search')},
  writer:{commit:async()=>{writes++;throw Error('Preparation must not write')}},readWorkSources:async()=>({packet:structuredClone(packet),solutionEdit:packet.solution.status==='ok'?await edits.readSelected(null):{status:'not_requested'}}),
  readDesignReadiness:async(revision:number,purpose:string,area:string|null)=>{reads++;assert.equal(revision,2);assert.equal(purpose,'construction');assert.equal(area,null);return structuredClone(readiness)}}
 return {opts,snapshot,edits,packet,readiness,counts:()=>({reads,writes}),revoke:()=>{access=false}}
}
test('new work shows save readiness and usable edit paths before geometry; no writes or material guesses',async()=>{
 const f=fixture(),tools=createConstructionTools(f.opts)
 const result:any=await tools.execute('read_construction_draft',query)
 assert.equal(result.status,'ok');assert.equal(result.creation_state,'needs_data');assert.equal(result.coverage.complete,true)
 const sources=result.items.find((i:any)=>i.collection==='governing_sources').value
 assert.equal(sources.preparation.issues[0].code,'purpose_mismatch')
 const entry=result.items.find((i:any)=>i.collection==='solution_edit').value.entry
 const paths=entry.content.edit_paths
 const prepared:any=await f.edits.prepare({edit_ref:entry.edit_ref,changes:[{op:'set',path:paths.purpose,value_json:'"construction"'},{op:'set',path:paths.alignment,value_json:JSON.stringify({status:'aligned',basis:'Delegated box with unchanged dimensions.'})}],reason:'Use the requested construction purpose',request_quote:'Make a box'})
 assert.equal(prepared.status,'ready');assert.equal(prepared.payload.data.solution.design_intent.purpose,'construction')
 assert.equal(prepared.payload.data.solution.design_intent.alignment.status,'aligned')
 await assert.rejects(applyProjectDelta(f.snapshot,[{op:'set',path:'/purpose',value_json:'"construction"'}],'Wrong path'),/Unsupported content path/)
 assert.deepEqual(f.counts(),{reads:1,writes:0})
})
test('new work rejects changed or foreign readiness and revoked access before exposing a packet',async()=>{
 for(const change of [{solution_revision:2},{target_revision:3},{project_id:'foreign'},{area_id:'other'}]){
  const f=fixture();Object.assign(f.readiness,change)
  const result:any=await createConstructionTools(f.opts).execute('read_construction_draft',query)
  assert(['conflict','unavailable'].includes(result.status),JSON.stringify(result));assert.equal(result.items,undefined)
 }
 const f=fixture(),read=f.opts.readDesignReadiness
 f.opts.readDesignReadiness=async(...args:any[])=>{const r=await read(...args);f.revoke();return r}
 assert.equal((await createConstructionTools(f.opts).execute('read_construction_draft',query) as any).status,'denied')
})
test('a missing selection and complete preparation expose only their own catalog continuations; reload and gates stay authoritative',async()=>{
 for(const state of ['no_selected_solution','needs_data','ready']){
  const f=fixture()
  if(state==='no_selected_solution')f.packet.solution={status:'empty'}
  if(state==='ready')Object.assign(f.readiness,{status:'ready',design_intent:designIntent(),issues:[],pin:designIntentPin('p',solution,1,2)})
  const catalog=catalogFixture(),tools=createConstructionTools(f.opts),followups=catalog.definition('bob.tools','tool_contract').definition.operation_followups as ToolFollowup[]
  const names=['read_construction_draft','edit_project_record','save_construction_draft','search_material_catalog','read_material_catalog','create_solution_alternative','select_solution_alternative']
  let blocked=false
  const options={toolInstructions:'lazy' as const,selectiveTools:true,followups,preloadTools:()=>['read_construction_draft'],
   definitions:names.map(name=>({spec:catalog.tool(name),version:1,gate:()=>blocked?'not_allowed' as const:'available' as const,execute:(v:unknown)=>tools.execute(name,v)})),
   readPolicy:async()=>({phase:'concept',tools:names.map(name=>({name,description:name,how_to:'',schema_version:1,always_load:false,preload_phases:[],active:true}))}),catalogTool:(n:string,p:any)=>catalog.tool(n,p)}
  const session=createToolSession(options);await session.prepare()
  const result:any=await session.execute('read_construction_draft',query)
  assert.equal(result.creation_state,state)
  const expected=followups.find(r=>r.when?.field==='creation_state'&&r.when.equals===state)!.tools
  const resumed=createToolSession(options);resumed.restoreState(session.exportState())
  const offered=(await resumed.prepare()).map(t=>t.function.name)
  for(const name of expected)assert(offered.includes(name),`${state}: ${name}`)
  if(state!=='ready')assert(!offered.includes('save_construction_draft'))
  blocked=true;assert.equal((await resumed.execute(expected[0],{}) as any).status,'not_allowed')
  assert.equal(f.counts().writes,0)
 }
})
test('publication updates four interfaces/continuations only, retains pinned manifests and is idempotent',async()=>{
 const publication='20261029093710_bob_creation_preparation_catalog.sql'
 let before:any
 const pg=await projectSchema(async(db,name)=>{if(name===publication)before=(await db.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result},publication)
 try{
  const current=(await pg.query<any>("select shared.resolve_ai_catalog('bob',null) result")).rows[0].result,fixture=catalogFixture()
  const changed=['tools.edit_project_record','tools.search_material_catalog','tools.read_construction_draft','bob.tools']
  for(const prior of before.definitions){
   const row=current.definitions.find((r:any)=>r.prompt_key===prior.prompt_key)
   if(!changed.includes(prior.prompt_key))assert.deepEqual(row,prior,prior.prompt_key)
   else {assert.equal(row.version,prior.version+1);assert.equal(row.content,prior.content);assert.deepEqual(row.definition,fixture.definition(row.prompt_key,row.definition_kind).definition)}
  }
  assert.deepEqual(fixture.definition('bob.tools','tool_contract').definition.core_tools,preCreationCatalogFixture().definition('bob.tools','tool_contract').definition.core_tools)
  const description=fixture.tool('edit_project_record',{include_manual:true}).function.description
  assert(!description.includes(' or /purpose'));assert(!description.includes('or /choices/-'))
  assert(preCreationCatalogFixture().tool('search_material_catalog').function.parameters.required.includes('profile_code'))
  assert(!fixture.tool('search_material_catalog').function.parameters.required.includes('profile_code'))
  const versionCount=(await pg.query<any>('select count(*) n from shared.ai_prompt_versions')).rows[0].n
  await pg.exec(readFileSync(new URL('../supabase/migrations/'+publication,import.meta.url),'utf8'))
  assert.equal((await pg.query<any>('select count(*) n from shared.ai_prompt_versions')).rows[0].n,versionCount)
 }finally{await pg.close()}
})


test('a historical manifest keeps its original read sequence and receives no creation continuation',async()=>{
 const f=fixture();f.opts.creationPreparation=false
 f.opts.readDesignReadiness=async()=>{throw Error('Historical replay must not gain an extra RPC')}
 const result:any=await createConstructionTools(f.opts).execute('read_construction_draft',query)
 assert.equal(result.status,'ok');assert.equal(result.creation_state,undefined);assert.equal(f.counts().reads,0)
})


test('whole-solution needs_data preserves explicit scoped FORM work without approving that scope',async()=>{
 const f=fixture(),form=constructionFormFixture()
 f.opts.formRefinement=true
 f.readiness.design_intent=form.intent
 f.snapshot.record.design_intent=form.intent
 const result:any=await createConstructionTools(f.opts).execute('read_construction_draft',query)
 assert.equal(result.status,'ok');assert.equal(result.creation_state,'needs_data');assert.equal(result.scoped_refinement_available,true)
 const preparation=result.items.find((i:any)=>i.collection==='governing_sources').value.preparation
 assert.equal(preparation.scope,'whole_solution');assert.equal(preparation.status,'needs_data');assert.match(preparation.scoped_refinement,/save gate checks that exact scope/)
 const follows=catalogFixture().definition('bob.tools','tool_contract').definition.operation_followups as ToolFollowup[]
 assert(follows.some(f=>f.when?.field==='scoped_refinement_available'&&f.when.equals===true&&f.tools.includes('save_construction_draft')))
 const blocked=fixture();blocked.opts.readWorkSources=async()=>({packet:blocked.packet,solutionEdit:{status:'unavailable'}})
 assert.equal((await createConstructionTools(blocked.opts).execute('read_construction_draft',query) as any).status,'unavailable')
})
