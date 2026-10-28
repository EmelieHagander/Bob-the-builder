import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {readTaskSources,TASK_SOURCES_TOOL} from '../supabase/functions/_shared/task-sources.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createBobToolSession} from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'
import seed from '../supabase/functions/_shared/project-tools/catalog-seed.json' with {type:'json'}

const project='P',artifact='11111111-1111-4111-8111-111111111111',solution='22222222-2222-4222-8222-222222222222'
const intent={version:1,purpose:'construction',summary:'Bunk bed',references:[{image_id:'img1',role:'inspiration',note:'x'}],
 features:[{id:'ladder_left',description:'Ladder on the left gable',basis:'user_request',source_ref:null}],
 choices:[{id:'drawers',question:'Drawers under the bed?',status:'deferred',deferral:{reason:'Owner decides later'}},{id:'wood',question:'Pine or birch?',status:'resolved',selected_direction:'Pine'}],
 alignment:{status:'aligned',basis:'Discussed'}}
const target=(area:string|null)=>({id:area??'project',revision:3,solution_id:solution,solution_revision:2,design_intent:intent})
const plan={id:project,status:'approved',revision:7,steps:[{id:'step1',title:'Build frame',state:'active',tasks:[],requirements:[{id:'req1',type:'artifact',resolution:'open'},{id:'req2',type:'measurement',resolution:'satisfied'}]}]}
const overview=(over:any={})=>({status:'ok',projectId:project,artifact_id:artifact,revision:4,current_revision:4,source_state:'current',archived:false,area_id:null,target_revision:3,
 form:{verification:'unverified',solution_id:solution,solution_revision:2,mapped_components:3,pending_components:1,pending_choices:0},counts:{open_questions:2},...over})
function readers(opts:{targets?:Record<string,any>;planStatus?:string;construction?:(q:any)=>any}={}){
 const calls:any[]=[]
 const lookup=createProjectLookup(project,async(_p,input:any)=>{
  calls.push({dataset:input.dataset,area_id:input.area_id,record_id:input.record_id})
  if(input.dataset==='target'){const key=input.area_id??'project',row=(opts.targets??{project:target(null)})[key];return {data:{records:row?[row]:[],related:[],truncated:false},error:null}}
  if(input.dataset==='plan')return opts.planStatus==='denied'?{data:null,error:{code:'42501',message:'denied'}}:{data:{records:[plan],related:[],truncated:false},error:null}
  return {data:{records:[],related:[],truncated:false},error:null}
 },1000,40)
 return {calls,lookup,readers:{projectId:project,search:(q:any)=>lookup.search(q),construction:async(q:any)=>{calls.push({construction:q});return opts.construction?opts.construction(q):overview()}}}
}
const input={area_id:null,step_id:'step1',construction:{artifact_id:artifact,revision:4}}

test('one read returns the selected Solution, Step requirements and Construction state with exact pointers',async()=>{
 const r=readers(),out:any=await readTaskSources(input,r.readers)
 assert.equal(out.status,'ok')
 assert.deepEqual([out.solution.solution_id,out.solution.solution_revision,out.solution.target_revision],[solution,2,3])
 assert.deepEqual(out.solution.features,[{id:'ladder_left',description:'Ladder on the left gable',basis:'user_request',source_ref:null}])
 assert.deepEqual(out.step.requirements.map((x:any)=>x.id),['req1','req2']);assert.equal(out.step.plan_revision,7)
 assert.deepEqual([out.construction.revision,out.construction.form.pending_components,out.construction.open_questions],[4,1,2])
 assert.deepEqual(out.construction.reopen,{tool:'read_construction_draft',input:{artifact_id:artifact,revision:4,after:null,view:'notes',ids:[],result_id:null,section:null}})
 assert.deepEqual(out.open_items,[{source:'solution',choice_id:'drawers',status:'deferred'},{source:'step_requirements',requirement_id:'req1'},
  {source:'construction',pending_components:1,pending_choices:0},{source:'construction',open_questions:2}])
 assert.deepEqual(out.conflicts,[]);assert.deepEqual(out.coverage.map((c:any)=>c.status),['ok','ok','ok'])
 assert.match(out.limits,/Private conversation/)
 assert.deepEqual(r.calls.map(c=>c.dataset??'construction'),['target','plan','construction'],'fixed read order for journal replay')
})

test('an Area without its own target inherits the project target and says so',async()=>{
 const r=readers(),out:any=await readTaskSources({...input,area_id:'area1',step_id:null,construction:null},r.readers)
 assert.equal(out.solution.inherited_from_project,true);assert.equal(out.coverage[0].note,'Area has no own target; the project target applies.')
 assert.deepEqual(r.calls.map(c=>[c.dataset,c.area_id,c.record_id]),[['target','area1',null],['target',null,'project']])
 assert.equal(out.step.status,'not_requested');assert.equal(out.construction.status,'not_requested')
})

test('stale or differently pinned Construction is reported as conflicts, never silently accepted',async()=>{
 const r=readers({construction:()=>overview({current_revision:5,source_state:'changed',area_id:'area9',target_revision:2,form:{solution_id:solution,solution_revision:1,pending_components:0,pending_choices:0}})})
 const out:any=await readTaskSources(input,r.readers)
 assert.deepEqual(out.conflicts.map((c:any)=>c.code),['construction_not_current','construction_solution_differs','construction_target_differs','construction_scope_differs'])
})

test('denial stops the whole read; other failures stay explicit gaps',async()=>{
 assert.deepEqual(await readTaskSources(input,readers({planStatus:'denied'}).readers),{status:'denied'})
 assert.deepEqual(await readTaskSources(input,readers({construction:()=>({status:'denied'})}).readers),{status:'denied'})
 const thrown:any=await readTaskSources(input,readers({construction:()=>{throw new Error('construction offline')}}).readers)
 assert.equal(thrown.status,'ok');assert.equal(thrown.construction.status,'unavailable');assert.equal(thrown.coverage[2].status,'unavailable')
 const missing:any=await readTaskSources({...input,step_id:'nope'},readers().readers)
 assert.equal(missing.step.status,'step_not_in_approved_plan')
 const noTarget:any=await readTaskSources({...input,construction:null},readers({targets:{}}).readers)
 assert.equal(noTarget.solution.status,'empty')
 assert.equal((await readTaskSources({area_id:null,step_id:null},readers().readers) as any).status,'invalid')
 assert.equal((await readTaskSources({...input,construction:{artifact_id:'x',revision:1}},readers().readers) as any).status,'invalid')
})

test('the publication is inert: Bob is not offered the tool until its policy is enabled',async()=>{
 const catalog=catalogFixture(),box=catalog.definition('bob.tools','tool_contract').definition
 const policy=(box.catalog as any[]).find(p=>p.name==='read_task_sources')
 assert.equal(policy.active,false)
 assert.deepEqual(seed.filter((p:any)=>p.name==='read_task_sources'),[policy],'seed policy equals the published policy')
 assert.deepEqual(catalog.definition('tools.read_task_sources').definition.parameters,TASK_SOURCES_TOOL.function.parameters)
 for(const active of [false,true]){
  const r=readers(),session=createBobToolSession({lookup:r.lookup,aiCatalog:catalog,
   readPolicy:async()=>({phase:'design',tools:(box.catalog as any[]).map(p=>p.name==='read_task_sources'?{...p,active}:p)})})
  assert.equal((await session.prepare()).some(s=>s.function.name==='read_task_sources'),active)
  const out:any=await session.execute('read_task_sources',{area_id:null,step_id:'step1',construction:null})
  assert.equal(out.status,active?'ok':'unavailable')
 }
})

test('the migration is generated from the executable contract and seed policy',()=>{
 const out=execFileSync(process.execPath,['--import','tsx','scripts/build-ai-task-sources-catalog.ts','supabase/migrations/20261028120000_ai_task_sources_catalog.sql','--check'],{encoding:'utf8'})
 assert.match(out,/Verified task sources contract/)
 assert.match(readFileSync('supabase/migrations/20261028120000_ai_task_sources_catalog.sql','utf8'),/"active": false/)
})
