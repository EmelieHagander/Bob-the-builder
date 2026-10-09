import {drawingInputFingerprint} from './drawing-request-recovery.ts'
import type { DrawingBudgetGrant, DrawingRequestStore } from './cad-intake.ts'
import { fingerprint, type BobJournal } from './bob-job-journal.ts'

// One grant identity per turn, request and budget revision: a replayed or
// repeated resume in the same turn never adds a second allocation.
const grantUuid=(h:string)=>`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${(8+(parseInt(h[16],16)&3)).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`

type Input=Record<string,unknown>
/** Project identity creation/cancellation use the caller JWT. Only the private
 * working packet and its operational projection use the claimed server RPC. */
export function createDrawingRequestStore(opts:{
 projectId:string; binding:Input;
 caller:(name:string,args:Input)=>Promise<any>;
 privateCall:(args:Input)=>Promise<any>;
 newId:(key?:string)=>Promise<string>;
 release?:(ids:string[])=>Promise<any>;
 journal?:BobJournal;
}):DrawingRequestStore {
 const restored=new Map<string,any>()
 let requireRecorded:(()=>void)|undefined
 // Rebuild the same transcript after a worker pause. Our own later saves and
 // paid calls change revisions/budget; they must not rewrite earlier reads.
 // Cancellation/reset checks stay fresh at assertActive below.
 const caller=(name:string,args:Input)=>{
  const {p_generation:_generation,...stable}=args
  return opts.journal?opts.journal.run('cad:caller:'+name,stable,()=>opts.caller(name,args)):opts.caller(name,args)
 }
 const read=(id:string|null,after:string|null=null)=>caller('project_drawing_requests',{p_project:opts.projectId,p_id:id,p_after:after})
 return {
  withReplayScope:async work=>{
   if(!opts.journal)return work()
   return opts.journal.replayScope(async restrict=>{
    const previous=requireRecorded;requireRecorded=restrict
    try{return await work()}finally{requireRecorded=previous}
   })
  },
  atomicSave:true,
  ensureGapTask:(id,expected,gap,requirement,plan)=>caller('ensure_drawing_gap_task',{p_project:opts.projectId,p_id:id,p_expected:expected,p_gap:gap,p_requirement:requirement,p_plan_revision:plan}),
  work:id=>caller('drawing_request_work',{p_project:opts.projectId,p_id:id}),
  linkGap:(id,expected,gap,task,step)=>caller('link_drawing_gap',{p_project:opts.projectId,p_id:id,p_expected:expected,p_gap:gap,p_task:task,p_step:step}),
  list:()=>opts.privateCall({p_operation:'list'}),
  load:id=>restored.has(id)?Promise.resolve(structuredClone(restored.get(id))):opts.privateCall({p_operation:'load',p_id:id}),
  restore:async(id,expected,planRevision,step,quote)=>{
   const result=await caller('restore_drawing_request',{...opts.binding,p_id:id,p_expected:expected,p_plan_revision:planRevision,p_step:step,p_request_quote:quote})
   // A load journaled before restoration must not return its old paused packet.
   restored.set(id,result);return result
  },
  read,
  // The owner's request to continue is the authorization; the same owner-only
  // SQL as the "Add request budget" button adds +$1 / +24 calls once.
  grant:async(id):Promise<DrawingBudgetGrant>=>{
   const budget=(await caller('drawing_request_work',{p_project:opts.projectId,p_id:id}))?.budget
   if(!budget||budget.legacy_untracked||!Number.isSafeInteger(budget.revision))return {status:'unavailable',reason:'budget_unavailable'}
   if(budget.calls<budget.call_limit&&budget.spent_usd<budget.usd_limit)return {status:'budget_remaining',budget_revision:budget.revision}
   const grant=grantUuid(await fingerprint({turn:opts.binding.p_turn??null,request:id,revision:budget.revision}))
   try{
    const result=await caller('grant_drawing_budget',{p_project:opts.projectId,p_id:id,p_expected:budget.revision,p_grant:grant})
    return {status:'granted',budget_revision:result?.revision,added:{usd:1,calls:24}}
   }catch(error){
    if(error instanceof Error&&['budget_remaining','budget_outcome_unknown','budget_changed','budget_unavailable','drawing_request_inactive','drawing_request_denied'].includes(error.message))
     return {status:error.message==='budget_remaining'?'budget_remaining':'not_granted',reason:error.message,budget_revision:budget.revision}
    throw error
   }
  },
  cancel:async(id,expected)=>{
   try{return await caller('cancel_drawing_request',{p_project:opts.projectId,p_id:id,p_expected:expected})}
   catch(error){
    if(error instanceof Error&&['drawing_request_complete','drawing_request_changed','drawing_request_denied'].includes(error.message))return {
     status:error.message==='drawing_request_denied'?'not_allowed':'conflict',reason:error.message,request_id:id,
     next_action:'Read the current request status. A completed Artifact remains saved; only the initiating authorized member may cancel unfinished work.',
    }
    throw error
   }
  },
  assertActive:async id=>{
   // Intentionally fresh, never journaled: a saved model response cannot restore
   // authority revoked by cancellation/reset in another request.
   const state=await opts.caller('check_drawing_request',{p_project:opts.projectId,p_id:id})
   if(state?.status==='cancelled')throw new Error('drawing_request_cancelled')
   if(state?.status==='paused')throw new Error('drawing_context_cleared')
   if(state?.status==='saved'){
    // Our later save may already have completed this request. Rebuild only
    // journaled CAD work in this scope; missing/changed steps stop before any
    // new model/render/write. Outside reconstruction, completion still stops.
    if(requireRecorded)requireRecorded()
    else throw new Error('drawing_request_complete')
   }
  },
  ...(opts.release?{releasePieces:opts.release}:{}),
  save:async(id,expected,status,payload,idKey)=>{
   if(id===null){
    const scope=Object.fromEntries(['area_id','component_id','step_id','artifact_id'].map(k=>[k,payload.brief[k]??null]))
    id=await opts.newId(idKey)
    const resolved=await caller('resolve_drawing_request',{...opts.binding,p_id:id,p_scope:scope,p_intent:await drawingInputFingerprint(payload.brief,null,null)})
    if(resolved.reused)throw new Error('drawing_request_reuse:'+resolved.id)
   }
   const result=await opts.privateCall({p_operation:'save',p_id:id,p_expected:expected,p_status:status,p_payload:payload})
   if(restored.has(id))restored.set(id,result)
   return result
  },
 }
}
