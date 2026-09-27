import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runProjectAnswer, seedToolPolicy } from './support/bob-model-routing.ts'
import { runClaimedProjectTurn } from './support/bob-model-routing.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectWriter, WRITE_TOOLS } from '../supabase/functions/_shared/project-write.ts'
import { createBobToolSession } from '../supabase/functions/_shared/project-tools/bob-tools.ts'
import { isBobAnswerEvidence } from '../src/data/bobEvidence.ts'
const usage={input_tokens:1,output_tokens:1,total_tokens:2}, time='2026-09-21T08:00:00Z'
const userId='00000000-0000-4000-8000-000000000001'
const message='Spara uppgiften att kontrollmäta öppningen.'
const args={record_id:null,area_id:'areaA',name:'Kontrollmät öppningen',instructions:'Mät öppningen och notera källan.',expected_updated_at:null,request_quote:'Spara uppgiften'}
const response=(name:string,arguments_:unknown,n:number)=>({success:true,data:null,model:'fixture',usage,responseId:'resp_'+n,
  toolCalls:[{id:'call_'+n,type:'function' as const,function:{name,arguments:JSON.stringify(arguments_)}}]})
const final=()=>({success:true,data:'Uppgiften är sparad.',model:'fixture',usage,responseId:'resp_done'})
function fixture() {
  let writes=0, broken=false
  const receipt={projectId:'A',dataset:'tasks',recordId:'taskNew',label:'Kontrollmät öppningen',operation:'created',savedAt:time,record:{id:'taskNew'}}
  const lookup=createProjectLookup('A',async(_p,i)=>({data:{records:i.dataset==='project'?[{id:'A',name:'Synthetic project',phase:'concept'}]:[],related:[],truncated:false},error:null}),1000,12)
  const writer=createProjectWriter('A',message,async p=>{assert.equal(p.kind,'task');writes++;return{data:receipt,error:null}},
    async()=>({data:[],error:null}),async()=>({data:{generation:2,receipts:writes?[receipt]:[]},error:null}))
  const readToolPolicy=async()=>{if(broken)throw new Error('Private database diagnostic');const s=await seedToolPolicy();return{phase:'concept',tools:s.tools.map(r=>r.name==='save_project_task'?{...r,always_load:false,preload_phases:[]}:r)}}
  return{opts:{projectId:'A',userId,message,generation:1,lookup,writer,readToolPolicy,hasAccess:async()=>true,fail:async()=>{}},
    get writes(){return writes},breakPolicy(){broken=true}}
}

test('real claimed loop offers the task tool with its guide from the first step, executes and persists its receipt',async()=>{
  const f=fixture();let calls=0,committed:any
  const result=await runClaimedProjectTurn({...f.opts,commit:async r=>{committed=r},callModel:async o=>{
    calls++
    assert.equal(o.tool_choice,undefined)
    const task=o.tools?.find(t=>t.function.name==='save_project_task')
    if(calls===1){assert(task,'no discovery round: the tool is on the bench');assert.deepEqual(task.function.parameters,WRITE_TOOLS.find(t=>t.function.name==='save_project_task')!.function.parameters)
      assert.match(task.function.description,/Read Areas\/tasks|Create or revise a Task/);assert.equal(f.writes,0);return response('save_project_task',args,calls)}
    const output=JSON.parse(String(o.messages![0].content))
    assert.equal(output.status,'saved');assert.equal(output.receipt.recordId,'taskNew');return final()
  }})
  assert(result.ok);assert.equal(calls,2);assert.equal(f.writes,1)
  assert.equal(result.evidence.writes?.[0].recordId,'taskNew');assert(isBobAnswerEvidence(result.evidence,'A'))
  assert.deepEqual(committed.evidence,result.evidence)
  assert(!result.evidence.sources.some(s=>/tool_catalog/.test(s.dataset)),'Tool guidance is not a project observation')
})

test('guest has no write tools on the bench and a guessed write is refused',async()=>{
  const f=fixture(),toolbox=createBobToolSession({lookup:f.opts.lookup,readPolicy:seedToolPolicy})
  assert(!(await toolbox.prepare()).some(t=>t.function.name.startsWith('save_')))
  assert(!toolbox.toolbox.some(e=>e.name.startsWith('save_')),'forbidden tools are not even listed')
  assert.equal((await toolbox.execute('save_project_task',args)).status,'not_allowed');assert.equal(f.writes,0)
})

test('fresh live policy failure never falls back to the embedded seed or calls the model',async()=>{
  const f=fixture();f.breakPolicy();let calls=0
  const result=await runProjectAnswer({...f.opts,callModel:async()=>{calls++;return final()}})
  assert.deepEqual(result,{ok:false,error:'tool_catalog_unavailable'});assert.equal(calls,0);assert.equal(f.writes,0)
})

test('policy failure after a successful mutation preserves the settled write without inventing a retry',async()=>{
  const f=fixture();let calls=0
  const result=await runClaimedProjectTurn({...f.opts,callModel:async()=>{
    if(++calls===1)return response('save_project_task',args,calls)
    f.breakPolicy();return response('search_project_data',{dataset:'tasks',query:null,status:null,area_id:null,record_id:null,after_id:null},calls)
  }})
  assert(result.ok);assert.equal(f.writes,1);assert.equal(result.evidence.writes?.[0].recordId,'taskNew')
  assert.equal(result.providerResponseId,undefined);assert(result.evidence.partial)
})

test('phase never narrows or mandates the toolbox and never expands authority',async()=>{
  const f=fixture(),policy=await seedToolPolicy()
  for(const phase of ['design','build',null]){
  const result=await runProjectAnswer({...f.opts,readToolPolicy:async()=>({...policy,phase}),callModel:async o=>{
    for(const name of ['inspect_building_projection','save_project_building_plan','save_project_stair','design_project_cad','delete_project_task','set_project_phase'].filter(n=>n!=='design_project_cad'))
      assert(o.tools?.some(t=>t.function.name===name),name+' offered in phase '+phase)
    assert.equal(o.tool_choice,undefined)
    return final()
  }})
  assert(result.ok)}
  assert.equal(f.writes,0)
})

test('production binds its caller-JWT catalog reader and retains selected-image grounding',async()=>{
  const code=await readFile(new URL('../supabase/functions/_shared/ask-openai.ts',import.meta.url),'utf8')
  assert.match(code,/readToolPolicy: createToolPolicyReader\(client, opts.projectId\)/)
  assert.match(code,/callModel: createGroundedModelCall/)
  const reader=await readFile(new URL('../supabase/functions/_shared/project-tools/policy-reader.ts',import.meta.url),'utf8')
  assert.match(reader,/eq\('id', projectId\)/);assert.match(reader,/select\('id,phase'\)/)
  assert.doesNotMatch(reader,/SUPABASE_SERVICE_ROLE_KEY|seedToolPolicy|localStorage/)
})


test('printed tool protocol gets one plain nudge and never reaches Bob prose',async()=>{
  const f=fixture();let calls=0
  const result=await runProjectAnswer({...f.opts,callModel:async o=>{
    calls++
    if(calls===1)return {success:true,data:'to=functions.save_project_task 彩神争锋是不是json\n{"name":"save_project_task"}',model:'fixture',usage,responseId:'resp_printed'}
    if(calls===2){
      assert.match(String(o.messages![0].content),/^\[Server note — not from the owner\] Your last message printed a tool call as text/)
      assert.equal(o.messages![0].role,'user');assert.equal(o.tool_choice,undefined)
      return response('save_project_task',args,calls)
    }
    return final()
  }})
  assert(result.ok);assert.equal(calls,3);assert.equal(f.writes,1)
  if(result.ok) assert.doesNotMatch(result.answer,/functions\.|load_tool|彩神/)
})

test('printed domain/write tool syntax fails closed instead of being shown or executed',async()=>{
  const f=fixture()
  const result=await runProjectAnswer({...f.opts,callModel:async()=>({
    success:true,data:'to=functions.save_project_task <tool_call> {"name":"oops"}',model:'fixture',usage,responseId:'resp_bad'
  })})
  assert.deepEqual(result,{ok:false,error:'unsupported_tool_response'})
  assert.equal(f.writes,0)
})

test('every active catalog tool sits on a named shelf, and every shelf entry exists in the catalog',async()=>{
  const {TOOLBOX_SHELVES}=await import('../supabase/functions/_shared/project-tools/bob-tools.ts')
  const policy=await seedToolPolicy(),shelved=new Set(TOOLBOX_SHELVES.flatMap(s=>s.tools))
  assert.deepEqual(policy.tools.filter(r=>r.active&&!shelved.has(r.name)).map(r=>r.name),[])
  assert.deepEqual([...shelved].filter(n=>!policy.tools.some(r=>r.name===n)),[])
})
