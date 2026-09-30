import {handoff} from './support/cad-review-fixture.ts'
import {drawingInputFingerprint} from '../supabase/functions/_shared/drawing-request-recovery.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createDrawingRequestStore} from '../supabase/functions/_shared/drawing-request-store.ts'

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
