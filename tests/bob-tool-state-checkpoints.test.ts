import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolSession, type ToolDefinition, type ToolPolicy } from '../supabase/functions/_shared/project-tools/session.ts'
import { createBobModelBudget } from '../supabase/functions/_shared/bob-model-budget.ts'
import { createConstructionTools } from '../supabase/functions/_shared/construction-draft.ts'
import { createProjectImageTools } from '../supabase/functions/_shared/project-image-tools.ts'
import { createCadPieces } from '../supabase/functions/_shared/cad-pieces.ts'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { createProjectCalculator } from '../supabase/functions/_shared/project-calculator.ts'
import { createDrawingRequestStore } from '../supabase/functions/_shared/drawing-request-store.ts'
import { createBobJournal } from '../supabase/functions/_shared/bob-job-journal.ts'
import { createCadAssistant, createPlanAssistant } from './support/colleague-catalog-fixture.ts'
import { catalogFixture } from './support/ai-catalog-fixture.ts'
import { checkedCadFixture, fixtureConstructionId } from './support/checked-cad-fixture.ts'
import { handoff, reviewReply } from './support/cad-review-fixture.ts'
import type { DrawingRequest } from '../supabase/functions/_shared/cad-intake.ts'

const roundtrip = <T>(value:T):T => JSON.parse(JSON.stringify(value))
const fail = async ():Promise<never> => { throw new Error('Completed work must not run again') }
const requestId='33333333-3333-4333-8333-333333333333'

test('tool checkpoint restores loaded manuals, carried manuals and the exact in-flight offer fence', async()=>{
  let ready=false, enabled=true, reads=0, executions=0
  const definitions:ToolDefinition[]=['read_source','save_source'].map(name=>({
    version:1, spec:{type:'function',function:{name,description:name,parameters:{type:'object',properties:{}}}},
    gate:()=>name==='save_source'&&!ready?'missing_context':'available',
    execute:async()=>{executions++;return {status:'ok'}},
  }))
  const rows:ToolPolicy[]=definitions.map(d=>({name:d.spec.function.name,description:d.spec.function.description,how_to:'Exact source manual',schema_version:1,always_load:false,preload_phases:[],active:true}))
  const make=()=>createToolSession({definitions,toolInstructions:'lazy',readPolicy:async()=>{reads++;return {phase:'design',tools:rows.map(r=>({...r,active:enabled}))}}})
  const first=make()
  await first.prepare()
  await first.execute('describe_tool',{name:'read_source'})
  await first.execute('describe_tool',{name:'save_source'})
  await first.prepare();first.carryInstructions()
  const state=roundtrip(first.exportState()),beforeReads=reads
  const next=make();next.restoreState(state)
  assert.deepEqual(next.exportState(),state)
  assert.equal(reads,beforeReads,'Restoration itself performs no policy or domain reads')
  assert.deepEqual(next.toolParameters(),{read_source:{card:false,include_manual:true}})
  state.loaded.length=0;state.shelf.length=0;state.events.length=0
  assert.equal(next.toolbox.length,3,'Caller mutations cannot erase restored state')
  ready=true
  assert.equal((await next.execute('save_source',{})).status,'not_offered','Newly available tool must wait for a new model step')
  assert.equal(executions,0)
  assert.equal((await next.execute('read_source',{})).status,'ok')
  await next.prepare()
  assert.equal((await next.execute('save_source',{})).status,'ok')
  enabled=false
  assert.equal((await next.execute('read_source',{})).status,'unavailable','Checkpoint never grants current project authority')
  const stopped=make();stopped.restoreState(roundtrip(next.exportState()))
  assert.equal(stopped.partial,true)
  assert.deepEqual(stopped.events,next.events)
  stopped.closeSurface()
  const closed=make();closed.restoreState(roundtrip(stopped.exportState()))
  assert.deepEqual(closed.exportState().offered,[])
  assert.deepEqual(closed.exportState().visible,[])
})

test('plan checkpoint preserves validated proposal, source evidence and repair feedback without compiling again',async()=>{
  const measurementId='30000000-0000-4000-8000-000000000001'
  const compiled={expected_revision:0,summary:'Inspect before building',reason:'Physical conditions remain unknown',steps:[{
    step_id:null,title:'Inspect site',goal:'Know the physical conditions',state:'active',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'Retain uncertainty',
    requirements:[{requirement_id:null,type:'measurement',title:'Measure site',description:'Record the controlling width',resolution:'open',responsible_kind:'bob',responsible_person_id:null,evidence_selector:{kind:'measurement',id:measurementId,subject:null,area_id:null}}],
  }],task_candidates:[],observations:[]}
  const lookup=()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='project'?[{id:'A',name:'Site'}]:q.dataset==='measurements'?[{id:measurementId,subject:'Site width',value:'900',unit:'mm',truth:'measured',revision:1}]:[],related:[],truncated:false,next_cursor:null},error:null}),1000,12)
  let calls=0, expectedFeedback:unknown
  const make=()=>createPlanAssistant({projectId:'A',userId:'owner',hasAccess:async()=>true,makeLookup:lookup,unlimitedWork:true,callModel:async options=>{
    calls++
    if(options.functionName==='plan-compiler'&&expectedFeedback)assert.deepEqual(JSON.parse(String(options.prompt)).repair_feedback,expectedFeedback)
    return {success:true,data:options.functionName==='plan-compiler'?compiled:{ready_to_save:true,summary:'Ready as proposal',issues:[]},model:'fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
  }})
  const first=make(),result=await first.consult('compile_project_plan',{plan_intent:'Inspect the site'})
  assert.equal(result.proposal_ready,true)
  const state=roundtrip(first.exportState())
  assert.equal(state.sources[0]?.recordId,measurementId)
  expectedFeedback=state.repairFeedback
  const next=make();next.restoreState(state)
  assert.equal(calls,2)
  assert.equal(next.canSave,true);assert.equal(next.compilationAttempted,true)
  assert.deepEqual(next.compiledProposal,first.compiledProposal)
  assert.deepEqual(next.exportState(),first.exportState())
  state.savableProposal!.summary='External mutation'
  assert.equal(next.compiledProposal?.summary,compiled.summary)
  await next.consult('compile_project_plan',{plan_intent:'Refine the existing proposal'})
  assert.equal(calls,4)
  assert.equal(next.exportState().used,2)
  const unavailable=createPlanAssistant({projectId:'A',userId:'owner',hasAccess:async()=>true,makeLookup:()=>{throw new Error('unavailable')},callModel:fail})
  await unavailable.consult('edit_project_plan',{})
  const partial=make();partial.restoreState(roundtrip(unavailable.exportState()))
  assert.equal(partial.partial,true);assert.equal(partial.exportState().editUsed,1)
})

function imageFixture(){
  let generations=0,uploads=0
  const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);new DataView(bytes.buffer).setUint32(16,16);new DataView(bytes.buffer).setUint32(20,16)
  const writer={remaining:10,commit:async()=>({status:'saved'})} as any
  const args={prompt:'Assembly illustration',title:'Assembly',purpose:'instruction',target_kind:'project',target_id:'A',reference_image_ids:[],request_quote:'Draw'}
  const make=(fails=false)=>createProjectImageTools({projectId:'A',message:'Draw',writer,unlimitedWork:true,hasAccess:async()=>true,deadline:Infinity,newId:async()=>requestId,
    generate:async()=>{generations++;return fails?{ok:false,error:'unavailable'}:{ok:true,image:bytes}},upload:async()=>{uploads++;throw new Error('Upload interrupted')}})
  return {make,args,counts:()=>({generations,uploads})}
}

test('pending image checkpoint recovers exact saved media and cannot pay for the same generation again',async()=>{
  const f=imageFixture(),first=f.make()
  assert.equal((await first.execute('generate_project_image',f.args)).status,'partial')
  const state=roundtrip(first.exportState()),next=f.make();next.restoreState(state)
  assert.deepEqual(next.exportState(),state)
  state.generatedRequests.length=0;state.attemptedRequests.length=0
  const blocked=await next.execute('generate_project_image',{...f.args,prompt:'Another illustration'})
  assert.equal(blocked.status,'recovery_required');assert.equal(blocked.media_id,requestId)
  assert.equal((await next.execute('finalize_project_image',{media_id:requestId,request_quote:'Draw'})).status,'saved')
  assert.equal((await next.execute('generate_project_image',f.args)).status,'already_generated')
  assert.deepEqual(f.counts(),{generations:1,uploads:1})
})

test('failed image attempt checkpoint preserves the no-progress guard',async()=>{
  const f=imageFixture(),first=f.make(true)
  assert.equal((await first.execute('generate_project_image',f.args)).status,'unavailable')
  const next=f.make();next.restoreState(roundtrip(first.exportState()))
  assert.equal((await next.execute('generate_project_image',f.args)).status,'no_progress')
  assert.deepEqual(f.counts(),{generations:1,uploads:0})
})

test('construction and piece checkpoints preserve finite counters even with unlimited policy',async()=>{
  const make=()=>createConstructionTools({projectId:'A',message:'Continue',hasAccess:async()=>true,read:fail,readSources:fail})
  const first=make();for(let n=0;n<12;n++)await first.execute('unknown',{})
  const next=make();next.restoreState(roundtrip(first.exportState()))
  assert.equal(next.remaining,0);assert.equal((await next.execute('unknown',{})).status,'budget_exhausted')
  const pieces=createCadPieces({projectId:'A',ownerRequest:null,hasAccess:async()=>true,aiCatalog:catalogFixture(),requestStore:{save:fail,load:fail,list:fail,releasePieces:fail}})
  pieces.restoreState({version:1,used:1})
  assert.equal((await pieces.execute({})).status,'budget_exhausted')
  const unlimited=createCadPieces({projectId:'A',ownerRequest:null,hasAccess:async()=>true,aiCatalog:catalogFixture(),unlimitedWork:true})
  unlimited.restoreState(roundtrip(pieces.exportState()))
  assert.equal(unlimited.remaining,Infinity)
  assert.deepEqual(unlimited.exportState(),{version:1,used:1})
})

test('model budget checkpoint retains charged and unpriced usage without another model dispatch',async()=>{
  const first=createBobModelBudget(1,24,undefined,{unlimitedWork:true})
  for(const cost of [2,null])await first.run(async()=>({success:true,data:'ok',model:'fixture',estimatedCostUsd:cost,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}))
  const next=createBobModelBudget();next.restoreState(roundtrip(first.exportState()))
  assert.deepEqual(next.usage,{spent:2,calls:2,unpriced:true,limitUsd:1})
  assert.equal((await next.run(fail)).error,'turn_budget_exhausted')
  assert.throws(()=>next.restoreState({version:1,spent:Infinity,calls:0,unpriced:false}),/checkpoint_invalid/)
  assert.throws(()=>next.restoreState({version:2,spent:0,calls:0,unpriced:false} as any),/checkpoint_invalid/)
})

test('calculator checkpoint retains attempts and does not restore permission to execute',async()=>{
  let allowed=true
  const make=(unlimitedWork=false)=>createProjectCalculator({projectId:'A',unlimitedWork,hasAccess:async()=>allowed,readConstruction:fail,readSource:fail,readSources:fail,quotePacks:fail})
  const first=make();for(let i=0;i<12;i++)await first.execute({})
  const next=make();next.restoreState(roundtrip(first.exportState()))
  assert.equal(next.remaining,0);assert.deepEqual(await next.offered(),[])
  assert.equal((await next.execute({})).status,'budget_exhausted')
  const unlimited=make(true);unlimited.restoreState(roundtrip(next.exportState()))
  assert.equal(unlimited.exportState().used,13);assert.equal(unlimited.remaining,Infinity)
  allowed=false;assert.deepEqual(await unlimited.offered(),[])
})

test('drawing store checkpoint retains restored identity while cancellation and completion remain live',async()=>{
  let privateReads=0,restores=0,status='collecting'
  const request:DrawingRequest={id:requestId,revision:3,status,payload:{brief:{brief:'Canonical restored requirements'},owner_request:'Restore',reference_refs:[]}}
  const make=()=>createDrawingRequestStore({projectId:'A',binding:{p_project:'A'},newId:fail,aiCatalog:catalogFixture(),
    journal:createBobJournal({entries:[],save:async()=>{}},Infinity),
    privateCall:async()=>{privateReads++;throw new Error('Must use exact restoration')},
    caller:async name=>{
      if(name==='restore_drawing_request'){restores++;return roundtrip(request)}
      assert.equal(name,'check_drawing_request');return {status}
    },
  })
  const first=make();await first.restore!(requestId,2,1,'step','Restore')
  const state=roundtrip(first.exportState()),next=make();next.restoreState(state)
  state.restored[0][1].payload.brief.brief='External mutation'
  assert.deepEqual(await next.load(requestId),request)
  assert.equal(privateReads,0);assert.equal(restores,1)
  await next.assertActive!(requestId)
  status='cancelled';await assert.rejects(next.assertActive!(requestId),/drawing_request_cancelled/)
  status='saved';await assert.rejects(next.assertActive!(requestId),/drawing_request_complete/)
  await first.withReplayScope!(async()=>{
    assert.throws(()=>first.exportState(),/drawing_request_checkpoint_inflight/)
    await first.assertActive!(requestId)
  })
  const again=make();again.restoreState(roundtrip(first.exportState()))
  await assert.rejects(again.assertActive!(requestId),/drawing_request_complete/,'An earlier replay scope cannot grant completion authority')
})

test('reviewed CAD checkpoint restores candidate, provenance and exact save identity without CAD or model replay',async()=>{
  const recipe:any={contract_version:1,units:'mm',assembly_id:'panel',definitions:[{id:'panel',primitive:'box',material_ref:null,x_mm:18,y_mm:80,z_mm:200}],instances:[{id:'panel',definition_id:'panel',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']}
  const source=checkedCadFixture('A',recipe)
  let renders=0,models=0,row:DrawingRequest|null=null
  const writes:{id:string|null;expected:number;status:string;payload:DrawingRequest['payload']}[]=[]
  const store={load:async()=>roundtrip(row),list:async()=>[],read:async()=>({status:'ok'}),cancel:async()=>({status:'cancelled'}),save:async(id:string|null,expected:number,status:string,payload:DrawingRequest['payload'])=>{
    assert.equal(expected,row?.revision??0)
    assert.equal(id,row?.id??null)
    writes.push(roundtrip({id,expected,status,payload}))
    row={id:requestId,revision:expected+1,status,payload:roundtrip(payload)}
    return roundtrip(row)
  }}
  const make=()=>createCadAssistant({projectId:'A',userId:'owner',ownerRequest:'Draw the panel',hasAccess:async()=>true,deadline:Date.now()+200000,available:true,requestStore:store,
    makeLookup:()=>createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='target'?[{id:'project',revision:1,solution_id:'44444444-4444-4444-8444-444444444444'}]:[],related:[],truncated:false},error:null}),1000,40),
    readArtifact:source.readArtifact,checkConstruction:source.checkConstruction,render:async recipe=>{renders++;return source.packet(recipe)},callModel:async()=>{models++;return reviewReply()},
  })
  const first=make()
  assert.equal((await first.consult({request_id:null,brief:'Draw the panel',handoff,requirement_changes:[],area_id:null,component_id:null,step_id:null,artifact_id:fixtureConstructionId,construction_revision:1})).status,'ready')
  await first.lifecycle('read_drawing_requests',{request_id:null,after_id:null})
  const state=roundtrip(first.exportState()),next=make(),beforeWrites=writes.length
  next.restoreState(state)
  assert.deepEqual(next.exportState(),state)
  assert.deepEqual(next.candidate,first.candidate);assert.deepEqual(next.quality,first.quality)
  assert.equal(next.lifecycleRemaining,11)
  state.candidate!.title='External mutation';state.sources.length=0
  assert.notEqual(next.candidate?.title,'External mutation')
  const saved=next.exportState().savedRequest!
  assert.equal(saved.id,requestId);assert.equal(saved.revision,row!.revision)
  await next.markSaved()
  assert.equal(writes.length,beforeWrites+1)
  assert.deepEqual(writes.at(-1),{id:saved.id,expected:saved.revision,status:'saved',payload:saved.payload})
  assert.equal(models,1);assert.equal(renders,1)
  const again=make();again.restoreState(roundtrip(next.exportState()))
  assert.equal(again.exportState().savedRequest?.revision,row!.revision)
})
