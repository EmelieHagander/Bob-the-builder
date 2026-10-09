import {handoff} from './support/cad-review-fixture.ts'
import {drawingInputFingerprint} from '../supabase/functions/_shared/drawing-request-recovery.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createDrawingRequestStore} from '../supabase/functions/_shared/drawing-request-store.ts'
import {BobContinuation,createBobJournal,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'

test('completed reconstruction permits exact checkpoints, rejects new or changed operations, and keeps cancellation/reset fresh',async()=>{
 const entries:JournalEntry[]=[]
 await createBobJournal({entries,save:async e=>{entries.push(e)}},Infinity).run('cad:model',{revision:1},async()=> 'reviewed')
 for(const status of ['saved','cancelled','paused']){
  const journal=createBobJournal({entries,save:async()=>{throw Error('must not checkpoint new work')}},Infinity)
  const store=createDrawingRequestStore({projectId:'A',binding:{},journal,newId:async()=> 'id',privateCall:async()=>null,caller:async()=>({status})})
  await assert.rejects(store.assertActive!('id'),new RegExp(status==='saved'?'drawing_request_complete':status==='cancelled'?'drawing_request_cancelled':'drawing_context_cleared'))
  if(status!=='saved'){
   await assert.rejects(store.withReplayScope!(async()=>{await store.assertActive!('id');throw Error('must stop')}),new RegExp(status==='cancelled'?'drawing_request_cancelled':'drawing_context_cleared'))
   continue
  }
  let dispatches=0
  await store.withReplayScope!(async()=>{
   await store.assertActive!('id')
   assert.equal(await journal.run('cad:model',{revision:1},async()=>{dispatches++;return 'duplicate'}),'reviewed')
   await assert.rejects(journal.run('cad:render',{},async()=>{dispatches++;return 'new'}),/continuation_incomplete/)
  })
  assert.equal(dispatches,0)
  assert.throws(()=>journal.check(),/continuation_incomplete/)
  const changed=createBobJournal({entries,save:async()=>{}},Infinity)
  await assert.rejects(changed.replayScope(async restrict=>{
   restrict();return changed.run('cad:model',{revision:2},async()=>{dispatches++;return 'changed'})
  }),/continuation_changed/)
  assert.equal(dispatches,0)
 }
 // The restriction ends with reconstruction; Bob can take its next step.
 const journal=createBobJournal({entries,save:async e=>{entries.push(e)}},Infinity)
 await journal.replayScope(async restrict=>{restrict();await journal.run('cad:model',{revision:1},async()=> 'duplicate')})
 assert.equal(await journal.run('model:ask-bob',{},async()=> 'reply'),'reply')
})

test('P4: own budget/status changes cannot rewrite a replayed tool reply; cancellation stays live',async()=>{
 for(const checkpoint of [false,true]){
  const entries:JournalEntry[]=[];let revision=1,status='needs_data',calls=0
  const run=async()=>{
   const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},Infinity)
   const store=createDrawingRequestStore({projectId:'A',binding:{p_generation:revision},newId:async()=> 'id',privateCall:async()=>null,
    ...(checkpoint?{journal}:{}),caller:async name=>name==='check_drawing_request'?{status}:{revision,budget:{calls:revision}}})
   const work=await store.work!('id')
   await journal.run('model',work,async()=>{calls++;return 'recorded'})
   await store.assertActive!('id')
   if(revision===1)throw new BobContinuation('yield')
   return work
  }
  await assert.rejects(run(),BobContinuation);revision=2
  if(!checkpoint){await assert.rejects(run(),/continuation_changed/);assert.equal(calls,1);continue}
  assert.deepEqual(await run(),{revision:1},'the replayed reply is kept and the ledger never reaches Bob');assert.equal(calls,1)
  status='cancelled';await assert.rejects(run(),/drawing_request_cancelled/)
 }
})

test('P2b production store binds a stable caller-created identity, keeps packets private and checks fresh status',async()=>{
 const calls:{transport:string;name:string;args:any}[]=[];let status='needs_data'
 const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
 const binding={p_project:'A',p_thread:'thread',p_turn:'turn',p_generation:2}
 const store=createDrawingRequestStore({projectId:'A',binding,newId:async()=>'stable-request',
  caller:async(name,args)=>{calls.push({transport:'caller',name,args});return name==='check_drawing_request'?{id:'stable-request',status}:{id:'stable-request',revision:0,status:'collecting'}},
  privateCall:async(args)=>{calls.push({transport:'private',name:'bob_drawing_request',args});return {id:args.p_id,revision:1,status:args.p_status,payload:args.p_payload}},
 })
 const payload={brief:{...scope,brief:'PRIVATE brief',handoff},owner_request:'PRIVATE transcript',reference_refs:[]}
 const row=await store.save(null,0,'needs_data',payload)
 assert.equal(row.id,'stable-request')
 assert.deepEqual(calls[0],{transport:'caller',name:'resolve_drawing_request',args:{...binding,p_id:'stable-request',p_scope:scope,p_intent:await drawingInputFingerprint(payload.brief,null,null)}})
 assert.equal(calls[1].transport,'private');assert.equal(calls[1].args.p_id,'stable-request')
 assert(!JSON.stringify(calls[0]).includes('PRIVATE'))
 await store.assertActive!('stable-request');status='cancelled'
 await assert.rejects(store.assertActive!('stable-request'),/drawing_request_cancelled/)
 assert.equal(calls.filter(c=>c.name==='check_drawing_request').length,2,'live status never replays a memoized active response')
 await store.cancel!('stable-request',1)
 assert.equal(calls.at(-1)?.transport,'caller');assert.equal(calls.at(-1)?.name,'cancel_drawing_request')
})

test('P2b expected cancellation conflicts return a recoverable result, while transport failures remain failures',async()=>{
 let failure='drawing_request_changed'
 const store=createDrawingRequestStore({projectId:'A',binding:{},newId:async()=>'id',privateCall:async()=>null,caller:async()=>{throw new Error(failure)}})
 assert.equal((await store.cancel!('id',1)).status,'conflict')
 failure='drawing_request_complete';assert.equal((await store.cancel!('id',1)).reason,'drawing_request_complete')
 failure='drawing_request_denied';assert.equal((await store.cancel!('id',1)).status,'not_allowed')
 failure='network';await assert.rejects(store.cancel!('id',1),/network/)
})

test('P2c restoration supersedes an earlier journaled paused load without allocating a new identity',async()=>{
 const calls:any[]=[];const paused={id:'same',revision:2,status:'paused',payload:{brief:{},owner_request:null,reference_refs:[]}}
 const restored={...paused,revision:3,status:'collecting',payload:{brief:{brief:'Canonical requirements'},owner_request:'Restore',reference_refs:[]}}
 const store=createDrawingRequestStore({projectId:'A',binding:{p_project:'A',p_thread:'T',p_turn:'turn',p_generation:2},newId:async()=>{throw Error('must not allocate')},
  privateCall:async args=>{calls.push(args);return paused},caller:async(name,args)=>{calls.push({name,args});return name==='restore_drawing_request'?restored:{id:'same',status:'collecting'}}})
 assert.equal((await store.load('same'))?.status,'paused')
 await store.restore!('same',2,1,'step','Restore')
 assert.deepEqual(await store.load('same'),restored)
 assert.deepEqual(calls[1],{name:'restore_drawing_request',args:{p_project:'A',p_thread:'T',p_turn:'turn',p_generation:2,p_id:'same',p_expected:2,p_plan_revision:1,p_step:'step',p_request_quote:'Restore'}})
})
