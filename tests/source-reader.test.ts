import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {collectReaderSources,createSourceReader,verifyFindings,SOURCE_FINDINGS_SCHEMA,SOURCE_FINDINGS_TOOL,SOURCE_READER_ROLE} from '../supabase/functions/_shared/source-reader.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import seed from '../supabase/functions/_shared/project-tools/catalog-seed.json' with {type:'json'}

const project='P',artifact='11111111-1111-4111-8111-111111111111',solution='22222222-2222-4222-8222-222222222222'
const intent={version:1,purpose:'construction',summary:'Bunk bed for two children, 90 cm wide mattresses.',references:[],
 features:[{id:'ladder_left',description:'Ladder on the LEFT gable, away from the window.',basis:'user_request',source_ref:null}],
 choices:[{id:'drawers',question:'Drawers under the bed?',status:'deferred',deferral:{reason:'Decide after measuring the floor.'}}],alignment:{status:'aligned',basis:'x'}}
const plan={id:project,status:'approved',revision:7,steps:[{id:'step1',title:'Frame',state:'active',tasks:[],requirements:[{id:'req1',title:'Measure ceiling height',description:'Under the beam, in mm',resolution:'open'}]}]}
const overview={status:'ok',projectId:project,artifact_id:artifact,revision:4,current_revision:4,source_state:'current',archived:false,area_id:null,target_revision:3,
 form:{solution_id:solution,solution_revision:2,mapped_components:2,pending_components:0,pending_choices:0},counts:{open_questions:1}}
const notes={status:'ok',projectId:project,artifact_id:artifact,revision:4,view:'notes',items:[{collection:'description',id:'description',value:'Pine frame, 2 x 90 cm.'},{collection:'open_questions',id:'q1',value:'Is the beam 2380 or 2400 mm above the floor?'}],coverage:{complete:true}}
const input={area_id:null,step_id:'step1',construction:{artifact_id:artifact,revision:4},question:'Which side must the ladder be on, and why?'}
function readers(){
 const lookup=createProjectLookup(project,async(_p,i:any)=>({data:{records:i.dataset==='target'?[{id:'project',revision:3,solution_id:solution,solution_revision:2,design_intent:intent}]:i.dataset==='plan'?[plan]:[],related:[],truncated:false},error:null}),1000,40)
 return {lookup,readers:{search:(q:any)=>lookup.search(q),construction:async(q:any)=>q.view==='notes'?notes:overview}}
}
const enabledCatalog=()=>catalogFixture(s=>{const role=s.definitions.find(r=>r.prompt_key===SOURCE_READER_ROLE)!;role.definition={...role.definition,enabled:true};role.id+=':on';role.payload_hash+=':on'})
const reply=(data:any)=>({success:true,data:JSON.stringify(data),model:'fixture',responseId:'r',usage:{input_tokens:1,output_tokens:1,total_tokens:2}})
function reader(catalog=enabledCatalog(),answer:(o:any)=>any=()=>reply({findings:[
  {source_ref:'feature:ladder_left',kind:'requirement',statement:'The ladder goes on the left gable.',quote:'ladder on the left gable',certainty:'stated'},
  {source_ref:'feature:ladder_left',kind:'constraint',statement:'Invented reason.',quote:'because the radiator is on the right',certainty:'stated'},
  {source_ref:'feature:invented',kind:'requirement',statement:'x',quote:'x',certainty:'stated'}],
 conflicts:[{source_refs:['construction:description','construction:question:q1'],description:'Width vs beam height unclear.'},{source_refs:['feature:ladder_left','nope'],description:'bad'}],not_answered:'Why the left side is preferred beyond the window.'})){
 const calls:any[]=[]
 const r=createSourceReader({aiCatalog:catalog,userId:'u',projectId:project,hasAccess:async()=>true,deadline:Date.now()+60000,callModel:async(o:any)=>{calls.push(o);return answer(o)}})
 return {r,calls}
}

test('code keeps only findings that quote their named source verbatim',async()=>{
 const {r,calls}=reader(),out:any=await r.execute(input,readers().readers)
 assert.equal(out.status,'ok');assert.equal(calls.length,1)
 assert.equal(calls[0].catalogRoleKey,'source-reader');assert.equal(calls[0].catalogSchemaKey,'bob_source_findings')
 const sent=JSON.parse(calls[0].messages[0].content)
 assert.deepEqual(sent.sources.map((s:any)=>s.ref),['solution:summary','feature:ladder_left','choice:drawers','requirement:req1','construction:description','construction:question:q1'])
 assert.deepEqual(out.findings.map((f:any)=>[f.source_ref,f.quote_verified,f.origin]),[['feature:ladder_left',true,'model_interpretation']])
 assert.deepEqual(out.rejected_findings,[{source_ref:'feature:ladder_left',reason:'quote_not_in_source'},{source_ref:'feature:invented',reason:'unknown_source'}])
 assert.deepEqual(out.conflicts.map((c:any)=>c.source_refs),[['construction:description','construction:question:q1']])
 assert.deepEqual(out.pins,{solution:{solution_id:solution,solution_revision:2},step:{step_id:'step1',plan_revision:7},construction:{artifact_id:artifact,revision:4}})
 assert.match(out.limits,/not project truth/)
 assert.equal(r.used,1);assert.deepEqual(r.exportState(),{version:1,used:1})
})

test('inactive, budget-exhausted, sourceless, denied and failed reads never pass unchecked text',async()=>{
 const off=reader(catalogFixture())
 assert.deepEqual(await off.r.execute(input,readers().readers),{status:'unavailable',reason:'source_reader_disabled'});assert.equal(off.calls.length,0)
 const spent=reader();spent.r.restoreState({version:1,used:3})
 assert.equal((await spent.r.execute(input,readers().readers)).status,'budget_exhausted');assert.equal(spent.calls.length,0)
 const empty=reader(),lookup=createProjectLookup(project,async()=>({data:{records:[],related:[],truncated:false},error:null}),1000,40)
 const none:any=await empty.r.execute({...input,step_id:null,construction:null},{search:(q:any)=>lookup.search(q)})
 assert.equal(none.status,'ok');assert.deepEqual(none.findings,[]);assert.equal(empty.calls.length,0,'no model call without text sources')
 const denied=reader()
 assert.deepEqual(await denied.r.execute(input,{...readers().readers,construction:async()=>({status:'denied'})}),{status:'denied'});assert.equal(denied.calls.length,0)
 const failed=reader(enabledCatalog(),()=>({success:false,data:null,model:'x',error:'timeout',usage:{input_tokens:0,output_tokens:0,total_tokens:0}}))
 const f:any=await failed.r.execute(input,readers().readers);assert.equal(f.status,'unavailable');assert.deepEqual(f.findings,[])
 const garbage=reader(enabledCatalog(),()=>reply({nope:true}))
 assert.equal(((await garbage.r.execute(input,readers().readers)) as any).reason,'reader_output_invalid')
 assert.equal((await reader().r.execute({...input,question:'x'},readers().readers)).status,'invalid')
})

test('source collection keeps exact refs and reports truncation',()=>{
 const long='a'.repeat(2500)
 const {sources,truncated}=collectReaderSources({solution:{status:'ok',summary:long,features:[],choices:[]},step:{status:'not_requested'}},{items:[{collection:'description',fragment:{text:'x'}}]})
 assert.equal(sources[0].text.length,2000);assert.deepEqual(truncated,['solution:summary','construction:description'])
 assert.equal(verifyFindings('not json',[]),null)
 assert.equal(verifyFindings({findings:[{source_ref:'a',kind:'requirement',statement:'s',quote:'  Ladder   ON ',certainty:'stated'}],conflicts:[],not_answered:''},[{ref:'a',kind:'k',text:'The ladder on the left'}])!.findings.length,1)
})

test('the publication is inert and generated from code; an enabled role resolves its schema',()=>{
 const catalog=catalogFixture(),box=catalog.definition('bob.tools','tool_contract').definition
 assert.equal(catalog.definition(SOURCE_READER_ROLE).definition.enabled,false)
 assert.throws(()=>catalog.role('source-reader'),/ai_function_disabled/)
 const policy=(box.catalog as any[]).find(p=>p.name==='read_source_findings')
 assert.equal(policy.active,false);assert.deepEqual(seed.filter((p:any)=>p.name==='read_source_findings'),[policy])
 assert.deepEqual(catalog.definition('tools.read_source_findings').definition.parameters,SOURCE_FINDINGS_TOOL.function.parameters)
 const on=enabledCatalog()
 assert.equal(on.role('source-reader').definition.definition.response_schema_key,'schema.bob_source_findings')
 assert.deepEqual(on.schema('bob_source_findings').schema,SOURCE_FINDINGS_SCHEMA)
 const out=execFileSync(process.execPath,['--import','tsx','scripts/build-ai-source-reader-catalog.ts','supabase/migrations/20261028140000_ai_source_reader_catalog.sql','--check'],{encoding:'utf8'})
 assert.match(out,/Verified source reader/)
})

test('Bob is offered the reader only when both its role and its policy are enabled',async()=>{
 for(const [catalog,active,offered] of [[catalogFixture(),true,false],[enabledCatalog(),false,false],[enabledCatalog(),true,true]] as const){
  const {r}=reader(catalog),{lookup}=readers(),box=catalog.definition('bob.tools','tool_contract').definition
  const session=createBobToolSession({lookup,aiCatalog:catalog,sourceReader:r,readPolicy:async()=>({phase:'design',tools:(box.catalog as any[]).map(p=>p.name==='read_source_findings'?{...p,active}:p)})})
  assert.equal((await session.prepare()).some(s=>s.function.name==='read_source_findings'),offered)
  if(offered){const out:any=await session.execute('read_source_findings',{...input,construction:null});assert.equal(out.status,catalog.definition(SOURCE_READER_ROLE).definition.enabled?'ok':'unavailable')}
 }
})
