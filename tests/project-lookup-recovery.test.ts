import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectLookup } from '../supabase/functions/_shared/project-lookup.ts'
import { BobContinuation } from '../supabase/functions/_shared/bob-job-journal.ts'
const query=(id='one')=>({dataset:'solutions',query:null,status:null,area_id:null,record_id:id,after_id:null})
const ok={data:{records:[{id:'one'}],related:[],truncated:false},error:null}
const failed={data:null,error:{code:'XX000'}}
const reader=(transport:any)=>createProjectLookup('p',transport,1000,100)
test('only an exact successful reread clears its failed scope, including after checkpoint restore',async()=>{
 let response:any=failed
 const first=reader(async()=>response)
 await first.search(query());await first.search(query('two'));assert(first.partial)
 const resumed=reader(async()=>response);resumed.restoreState(first.exportState())
 response=ok
 await resumed.search({...query(),query:'another filter'});assert(resumed.partial)
 await resumed.search({...query(),after_id:'next-page'});assert(resumed.partial)
 await resumed.search(query());assert(resumed.partial,'other failed scope remains')
 await resumed.search(query('two'));assert(!resumed.partial)
 response=failed;await resumed.search(query());assert(resumed.partial,'a later new failure reopens the gap')
})
test('truncation, malformed calls and legacy unknown gaps cannot be erased by a successful record',async()=>{
 for(const start of ['truncated','invalid','legacy']){
  const r=reader(async()=>ok)
  if(start==='invalid')await r.search({unexpected:true})
  if(start==='legacy')r.restoreState({version:1,projectId:'p',used:1,incomplete:true,sources:[]})
  if(start==='truncated'){
   const prior=reader(async()=>({data:{...ok.data,truncated:true,next_cursor:'one'},error:null}));await prior.search(query());r.restoreState(prior.exportState())
  }
  await r.search(query());assert(r.partial,start)
 }
})
test('empty exact rereads resolve absence; different pages, incomplete results and continuation do not',async()=>{
 let response:any=failed
 const r=reader(async()=>response)
 await r.search(query())
 response={data:{records:[],related:[],truncated:false},error:null}
 assert.equal((await r.search(query())).status,'empty');assert(!r.partial)
 const continuation=reader(async()=>{throw new BobContinuation('yield','pending')})
 await assert.rejects(continuation.search(query()),BobContinuation);assert(!continuation.partial)
 const state=r.exportState();state.incomplete=true
 assert.throws(()=>r.restoreState(state),/lookup_checkpoint_invalid/)
 const foreign={...r.exportState(),projectId:'foreign'}
 assert.throws(()=>r.restoreState(foreign),/lookup_checkpoint_invalid/)
})
