import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createBobJournal,BobContinuation,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {backgroundResponse,AIBackgroundPending} from '../supabase/functions/_shared/ai-background.ts'

const input={dataset:'artifacts',query:null,status:null,area_id:null,record_id:null,after_id:null}
const page={data:{records:[{id:'drawing',revision:1}],related:[],truncated:false},error:null}

test('late successful read cannot replace the timeout delivered to a pending paid model',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const entries:JournalEntry[]=[],oldFetch=globalThis.fetch
 let started:()=>void=()=>{}
 const readStarted=new Promise<void>(resolve=>{started=resolve})
 let lateRead:((value:typeof page)=>void)|undefined,reads=0,posts=0,reserved:any,response:any=null
 const rpc=async(name:string,args:any)=>{
  if(name==='ai_job_reserve'){
   if(reserved){assert.equal(args.p_fingerprint,reserved.p_fingerprint);return {id:'ai-job',status:response?'completed':'queued',response,submit:false}}
   reserved=args;return {id:'ai-job',status:'submitting',submit:true}
  }
  if(name==='ai_job_accept')return true
  throw Error(name)
 }
 globalThis.fetch=async()=>{posts++;return Response.json({id:'provider-response',status:'queued'})}
 const run=async()=>{
  const journal=createBobJournal({entries,save:async e=>{entries.push(structuredClone(e))}},Infinity)
  const transport=Object.assign((_project:string,args:any,signal:AbortSignal)=>journal.run('rpc:lookup',args,async()=>{
   reads++;started();return new Promise<typeof page>(resolve=>{lateRead=resolve})
  },0,signal),{checkpointed:true})
  const found=await createProjectLookup('A',transport,10,40).search(input)
  assert.equal(found.status,'unavailable')
  return journal.run('model:ask-bob',{messages:[{role:'tool',content:JSON.stringify(found)}]},async identity=>{
   try{return await backgroundResponse(rpc,'fixture','bob',{key:'job/'+identity.key,fingerprint:identity.fingerprint,receiver:'bob',context:{jobId:'job',role:'ask-bob'},expiresAt:'2030-01-01T00:00:00Z'}, {}, {user_id:null,module:'global',ai_function:'ask-bob',model:'fixture',input_price_per_1m:1,output_price_per_1m:2,cached_price_per_1m:.1})}
   catch(error){if(error instanceof AIBackgroundPending)throw new BobContinuation('yield','ai_wait',{id:error.jobId,accepted:error.accepted,role:'ask-bob'});throw error}
  })
 }
 try{
  const pending=run()
  await readStarted
  t.mock.timers.tick(10)
  await assert.rejects(pending,BobContinuation)
  lateRead!(page)
  await Promise.resolve()
  assert.deepEqual(entries.find(e=>e.key==='rpc:lookup:0')?.value,{ok:false,error:'operation_aborted'})
  response={id:'provider-response',status:'completed',output:[{type:'function_call',name:'search_project_data',arguments:'{}'}]}
  assert.deepEqual(await run(),response)
  assert.deepEqual(await run(),response)
  assert.equal(reads,1);assert.equal(posts,1)
 }finally{globalThis.fetch=oldFetch}
})

test('lookup waits for its checkpoint, so slow persistence cannot invent a timeout',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 let started:()=>void=()=>{}
 const checkpointStarted=new Promise<void>(resolve=>{started=resolve})
 const entries:JournalEntry[]=[],journal=createBobJournal({entries,save:async e=>{started();await new Promise(resolve=>setTimeout(resolve,30));entries.push(e)}},Infinity)
 const transport=Object.assign((_p:string,args:any,signal:AbortSignal)=>journal.run('rpc:lookup',args,async()=>page,0,signal),{checkpointed:true})
 const pending=createProjectLookup('A',transport,10,40).search(input)
 await checkpointStarted
 t.mock.timers.tick(30)
 assert.equal((await pending).status,'ok')
 assert.equal(entries.length,1)
})

test('changed pending model input stops before reserving or posting another paid response',async()=>{
 const entries:JournalEntry[]=[];let calls=0
 const run=(revision:number)=>createBobJournal({entries,save:async e=>{entries.push(e)}},Infinity).run('model:cad',{revision},async()=>{
  calls++;throw new BobContinuation('yield','ai_wait',{id:'same-job',accepted:true,role:'cad-designer'})
 })
 await assert.rejects(run(1),BobContinuation)
 await assert.rejects(run(2),e=>e instanceof BobContinuation&&e.message==='continuation_changed'&&e.operationKey==='model:cad:0')
 assert.equal(calls,1);assert.equal(entries.length,1)
})
