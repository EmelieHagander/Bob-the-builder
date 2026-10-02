import {test} from 'node:test'
import assert from 'node:assert/strict'
import {drawingResumeReply} from '../supabase/functions/_shared/drawing-resume-reply.ts'
import {BobContinuation} from '../supabase/functions/_shared/bob-job-journal.ts'
const usage={input_tokens:0,output_tokens:0,total_tokens:0}
const outcome={status:'needs_data',gaps:[{id:'depth',action:'owner_decision',detail:'Owner must choose depth.'},{id:'depth_again',action:'owner_decision',detail:'Same missing depth.'}]}
test('P4 event reply gets the complete actual outcome and no action tools, including a suppressed retry',async()=>{
 const answer=await drawingResumeReply({message:'Draw a 60 by 80 cm shelf.',userId:'u',outcome:{...outcome,retry_suppressed:true},saved:false,hasAccess:async()=>true,callModel:async o=>{
  assert.equal(o.tools,undefined);assert.equal(o.aiFunction,'bob-delivery-language')
  assert.equal(o.functionName,'work-router');assert.equal(o.module,'global');assert.equal(o.outputTokenLimit,2000)
  const input=JSON.parse(String(o.messages![0].content));assert.deepEqual(input.outcome,{...outcome,retry_suppressed:true});assert.equal(input.saved_receipt_confirmed,false)
  return {success:true,data:JSON.stringify({answer:'Vilket djup vill du ha på hyllan?'}),model:'fixture',usage}
 }})
 assert.equal(answer,'Vilket djup vill du ha på hyllan?')
})
test('language failure retains concrete gaps or technical cause, and cannot swallow a worker pause or access loss',async()=>{
 const base={message:'Draw',userId:'u',outcome,saved:false,hasAccess:async()=>true,callModel:async()=>({success:false,data:null,model:'fixture',usage})}
 assert.match(await drawingResumeReply(base),/Owner must choose depth/)
 assert.match(await drawingResumeReply(base),/\?$/)
 assert(!((await drawingResumeReply({...base,outcome:{status:'needs_data',gaps:[{action:'bob_decision',detail:'Select a reversible joint.'}]}})).includes('?')))
 assert.match(await drawingResumeReply({...base,outcome:{status:'unavailable',reason:'review_sources_incomplete'}}),/review_sources_incomplete/)
 await assert.rejects(drawingResumeReply({...base,callModel:async()=>{throw new BobContinuation('yield')}}),BobContinuation)
 await assert.rejects(drawingResumeReply({...base,hasAccess:async()=>false}),/project_denied/)
})
