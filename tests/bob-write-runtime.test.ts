import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createProjectWriter, parseProjectWrite, WRITE_TOOLS, type WriteReadback } from '../supabase/functions/_shared/project-write.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { runClaimedProjectTurn } from '../supabase/functions/_shared/project-turn.ts'
import { BOB_PERSONA } from '../supabase/functions/_shared/bob-prompt.ts'
import { isBobAnswerEvidence } from '../src/data/bobEvidence.ts'

const time='2026-09-17T12:00:00.000Z'
const args={record_id:null,area_id:'areaA',name:'Chosen plan',instructions:'Build the selected option.',expected_updated_at:null,request_quote:'A'}
const receipt:WriteReadback={projectId:'A',dataset:'tasks',recordId:'new-task',label:'Chosen plan',operation:'created',savedAt:time,record:{id:'new-task',name:'Chosen plan',status:'todo'}}
const noError=(data:unknown)=>({data,error:null})
const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const final=()=>({success:true,data:'Sparat.',model:'fixture',responseId:'resp_final',usage})
const base=()=>({projectId:'A',userId:'userA',message:'A',generation:1,hasAccess:async()=>true,
  lookup:createProjectLookup('A',async()=>noError({records:[{id:'A',name:'Project A',updated_at:time}],related:[],truncated:false})),fail:async()=>{}})
function writerFixture({recovered=[] as WriteReadback[], throwWrite=false, committedOnTimeout=true, settlementFails=false}={}) {
  let writes=0
  const stored=[...recovered]
  const writer=createProjectWriter('A','A',async()=>{
    writes++
    if(!throwWrite||committedOnTimeout)stored.push(receipt)
    if(throwWrite)throw new Error('lost transport')
    return noError(receipt)
  },async()=>noError(stored),async()=>{
    if(settlementFails)throw new Error('lost recovery transport')
    return noError({generation:2,receipts:stored})
  })
  return {writer,get writes(){return writes}}
}

test('strict write shapes bind project server-side and accept a real current-turn approval, never forged fields',()=>{
  const payload=parseProjectWrite('save_project_task',args,'A','A')!
  assert.equal(payload.kind,'task'); assert.equal(payload.request_quote,'A')
  for(const bad of [{...args,projectId:'B'},{...args,owner_user_id:'someone'},{...args,request_quote:'Invented approval'},null,[],{...args,expected_updated_at:time}]) {
    assert.equal(parseProjectWrite('save_project_task',bad,'A','A'),null)
  }
  const plan=parseProjectWrite('save_project_description',{description:'70 × 160',expected_updated_at:time,request_quote:'A'},'BOUND','A')!
  assert.equal(plan.record_id,'BOUND')
  assert.equal(parseProjectWrite('delete_project',{},'A','A'),null)
  assert.equal(WRITE_TOOLS.length,13)
  assert.equal(new Set(WRITE_TOOLS.map(t=>t.function.name)).size,13)
  assert(WRITE_TOOLS.some(t=>t.function.name==='save_project_drawing'))
  assert(WRITE_TOOLS.some(t=>t.function.name==='save_catalog_definition'))
  assert(WRITE_TOOLS.some(t=>t.function.name==='propose_project_plan'))
  assert(WRITE_TOOLS.some(t=>t.function.name==='decide_project_plan'))
  assert(WRITE_TOOLS.some(t=>t.function.name==='link_project_plan_evidence'))
})

test('catalog revise may preserve metadata with null while ensure still requires concrete metadata',()=>{
  const value={action:'ensure',key:'fixture',kind:'material',record_id:null,expected_revision:0,name:'Fixture',aliases:['plywood'],
    profile_code:'sheet_stock',profile_revision:1,categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},
    material_id:null,material_revision:null,notes:'Keep note',source_kind:'user_statement',source_quote:'A',source_seq:null,request_quote:'A'}
  assert(parseProjectWrite('save_catalog_definition',value,'A','A'))
  assert.equal(parseProjectWrite('save_catalog_definition',{...value,aliases:null},'A','A'),null)
  assert.equal(parseProjectWrite('save_catalog_definition',{...value,notes:null},'A','A'),null)
  const revised={...value,action:'revise',record_id:'30000000-0000-4000-8000-000000000001',expected_revision:1,aliases:null,notes:null}
  const parsed=parseProjectWrite('save_catalog_definition',revised,'A','A')!
  assert.equal(parsed.record_id,revised.record_id)
  assert.equal(parsed.data.aliases,null)
  assert.equal(parsed.data.notes,null)
})

test('measurement parser enforces canonical units, uncertainty, decimal limits and current revision',()=>{
  const input={record_id:null,create_area_id:null,create_component_id:null,expected_revision:0,subject:'Chosen width',value:'70',unit:'cm',truth:'provided_spec',source:'User selected option A',notes:'Not measured on site',required:false,change_note:'Chosen dimension',request_quote:'A'}
  assert.equal(parseProjectWrite('save_project_measurement',input,'A','A')!.data.truth,'provided_spec')
  for(const change of [{truth:'measured',source:''},{value:'NaN'},{value:'1e3'},{value:'1.0001'},{value:'1000001'},{truth:'unknown'},{unit:'ft'},{expected_revision:1},{required:'false'}]){
    assert.equal(parseProjectWrite('save_project_measurement',{...input,...change},'A','A'),null)
  }
  assert.equal(parseProjectWrite('save_project_measurement',{...input,truth:'unknown',value:null,source:''},'A','A')!.data.value,null)
})

test('clear approval A leads through the real tool loop to one save and compact receipt, without a second approval turn',async()=>{
  const f=writerFixture()
  let calls=0
  let commit:any
  const result=await runClaimedProjectTurn({...base(),writer:f.writer,
    callModel:async options=>{
      calls++
      assert(options.systemMessage!.startsWith(BOB_PERSONA))
      assert.match(options.systemMessage!,/do not ask the user to approve the same action again/)
      assert(options.tools?.some(t=>t.function.name==='save_project_task'))
      if(calls===1)return {success:true,data:null,model:'fixture',responseId:'resp_tool',usage,toolCalls:[{id:'call_1',type:'function',function:{name:'save_project_task',arguments:JSON.stringify(args)}}]}
      const output=JSON.parse(options.messages![0].content!)
      assert.equal(output.status,'saved');assert.equal(output.receipt.record.status,'todo')
      return final()
    },commit:async(result,generation)=>{commit={result,generation}},
  })
  assert.equal(result.ok,true);assert.equal(f.writes,1);assert.equal(calls,2)
  assert.equal(commit.generation,2);assert.equal(commit.result.evidence.writes.length,1)
  assert.equal(commit.result.evidence.writes[0].record,undefined,'full before/after content stays out of the transcript receipt')
})

test('retry with existing receipts runs no model and no writes, commits a recovered answer with a fresh provider chain',async()=>{
  const f=writerFixture({recovered:[receipt]})
  let calls=0
  let committed:any
  const result=await runClaimedProjectTurn({...base(),writer:f.writer,callModel:async()=>{calls++;return final()},commit:async(r,g)=>{committed={r,g}}})
  assert.equal(result.ok,true);assert.equal(calls,0);assert.equal(f.writes,0)
  assert.equal(committed.r.providerResponseId,undefined)
  assert.match(committed.r.answer,/Chosen plan/)
  assert.equal(committed.g,2)
})

test('timeout after database commit stops further writes and settlement returns the actual saved change',async()=>{
  const f=writerFixture({throwWrite:true})
  let calls=0
  const result=await runClaimedProjectTurn({...base(),writer:f.writer,callModel:async()=>{
    calls++
    if(calls===1)return {success:true,data:null,model:'fixture',responseId:'resp_tool',usage,toolCalls:[
      {id:'call_1',type:'function',function:{name:'save_project_task',arguments:JSON.stringify(args)}},
      {id:'call_2',type:'function',function:{name:'save_project_task',arguments:JSON.stringify({...args,name:'Must not run'})}},
    ]}
    return {success:false,data:null,model:'fixture',usage}
  }})
  assert.equal(result.ok,true);assert.equal(f.writes,1)
  if(result.ok){assert.equal(result.evidence.writes!.length,1);assert.match(result.answer,/verifierade/)}
})

test('model exception after a successful save returns receipts; lost transcript commit never asks to repeat writes',async()=>{
  const f=writerFixture()
  let calls=0
  const result=await runClaimedProjectTurn({...base(),writer:f.writer,callModel:async()=>{
    if(calls++)throw new Error('model dropped connection')
    return {success:true,data:null,model:'fixture',responseId:'resp_tool',usage,toolCalls:[{id:'call_1',type:'function',function:{name:'save_project_task',arguments:JSON.stringify(args)}}]}
  },commit:async()=>{throw new Error('lost transcript')}})
  assert.equal(result.ok,true)
  if(result.ok){assert.match(result.answer,/Upprepa inte ändringarna/);assert.equal(result.evidence.writes!.length,1)}
})

test('unverifiable settlement is explicit; access revocation suppresses both answer and receipts',async()=>{
  const f=writerFixture({recovered:[receipt],settlementFails:true})
  const result=await runClaimedProjectTurn({...base(),writer:f.writer,callModel:async()=>final()})
  assert.equal(result.ok,true)
  if(result.ok){assert.match(result.answer,/kunde inte verifieras/);assert.equal(result.evidence.partial,true)}
  const denied=await runClaimedProjectTurn({...base(),writer:writerFixture({recovered:[receipt]}).writer,hasAccess:async()=>false,callModel:async()=>final()})
  assert.deepEqual(denied,{ok:false,error:'project_denied'})
})

test('an uncommitted timed-out write is not reported as a save after settlement',async()=>{
  const f=writerFixture({throwWrite:true,committedOnTimeout:false})
  let calls=0
  const result=await runClaimedProjectTurn({...base(),writer:f.writer,callModel:async()=>{
    if(calls++)return final()
    return {success:true,data:null,model:'fixture',responseId:'resp_tool',usage,toolCalls:[{id:'call_1',type:'function',function:{name:'save_project_task',arguments:JSON.stringify(args)}}]}
  }})
  assert.deepEqual(result,{ok:false,error:'write_not_saved'})
})

test('browser evidence rejects wrong-project, malformed and oversize receipt sets, including restored history',()=>{
  const evidence={kind:'ai_assessment',sources:[],partial:false,writes:[receipt]}
  assert(isBobAnswerEvidence(evidence,'A'))
  assert(!isBobAnswerEvidence(evidence,'B'))
  for(const writes of [[{...receipt,recordId:''}],[{...receipt,savedAt:'not a date'}],[{...receipt,dataset:'auth.users'}],Array(9).fill(receipt),{}])assert(!isBobAnswerEvidence({...evidence,writes},'A'))
})

test('deployed wiring uses caller-JWT writes and fenced commit, not service-role project writes',async()=>{
  const source=await readFile(new URL('../supabase/functions/_shared/ask-openai.ts',import.meta.url),'utf8')
  assert.match(source,/client\.rpc\('bob_project_write_v9'/)
  assert.match(source,/client\.rpc\('catalog_read'/)
  assert.match(source,/client\.rpc\('bob_settle_project_writes'/)
  assert.doesNotMatch(source,/internal\.rpc\('bob_project_write(?:_v\d+)?'/)
  assert.doesNotMatch(source,/internal\.rpc\('catalog_read'/)
  const conversation=await readFile(new URL('../supabase/functions/_shared/bob-conversation.ts',import.meta.url),'utf8')
  assert.match(conversation,/bob_commit_turn_v2/);assert.match(conversation,/p_generation: input\.generation/)
})


test('living-plan parser keeps proposal, approval and evidence shapes bounded and project-bound',()=>{
  const requirement={requirement_id:null,type:'measurement',title:'Opening width',description:'Measure before cutting',resolution:'open',
    responsible_kind:'person',responsible_person_id:'person-a',evidence_selector:{kind:'measurement',id:null,subject:'Opening width',area_id:'areaA'}}
  const step={step_id:null,title:'Verify opening',goal:'Know the real opening before framing',
    brief:'Lock the opening geometry before framing; keep measured facts separate from design choices.',
    state:'active',area_id:'areaA',responsible_kind:'bob',responsible_person_id:null,notes:'',
    tasks:[{task_key:'measure_opening',task_id:null,area_id:'areaA',title:'Measure opening',instructions:'Measure the clear opening and record the result.'}],
    requirements:[requirement]}
  const proposal={expected_revision:0,summary:'Measure, then frame',reason:'Initial plan',steps:[step],request_quote:'Planera projektet'}
  const parsed=parseProjectWrite('propose_project_plan',proposal,'A','Planera projektet')!
  assert.equal(parsed.kind,'plan_proposal');assert.equal(parsed.expected_revision,0)
  assert.equal(parseProjectWrite('propose_project_plan',{...proposal,steps:[step,{...step,title:'Second active'}]},'A','Planera projektet'),null)
  const decision=parseProjectWrite('decide_project_plan',{action:'approve',proposal_revision:1,expected_revision:0,decision_note:'Ser bra ut',request_quote:'Godkänn planen'},'A','Godkänn planen')!
  assert.equal(decision.kind,'plan_decision')
  const evidence=parseProjectWrite('link_project_plan_evidence',{plan_revision:1,requirement_id:'30000000-0000-4000-8000-000000000001',
    relation:'resolves',evidence_kind:'measurement',evidence_id:'30000000-0000-4000-8000-000000000002',evidence_revision:2,request_quote:'Koppla måttet'},'A','Koppla måttet')!
  assert.equal(evidence.kind,'plan_evidence')
  assert.equal(parseProjectWrite('link_project_plan_evidence',{plan_revision:1,requirement_id:'30000000-0000-4000-8000-000000000001',
    relation:'resolves',evidence_kind:'measurement',evidence_id:'30000000-0000-4000-8000-000000000002',evidence_revision:null,request_quote:'Koppla måttet'},'A','Koppla måttet'),null)
})
