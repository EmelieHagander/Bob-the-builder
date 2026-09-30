import {drawingInputFingerprint} from './drawing-request-recovery.ts'
import type { DrawingRequestStore } from './cad-intake.ts'

type Input=Record<string,unknown>
/** Project identity creation/cancellation use the caller JWT. Only the private
 * working packet and its operational projection use the claimed server RPC. */
export function createDrawingRequestStore(opts:{
 projectId:string; binding:Input;
 caller:(name:string,args:Input)=>Promise<any>;
 privateCall:(args:Input)=>Promise<any>;
 newId:()=>Promise<string>;
}):DrawingRequestStore {
 const restored=new Map<string,any>()
 const read=(id:string|null,after:string|null=null)=>opts.caller('project_drawing_requests',{p_project:opts.projectId,p_id:id,p_after:after})
 return {
  atomicSave:true,
  ensureGapTask:(id,expected,gap,requirement,plan)=>opts.caller('ensure_drawing_gap_task',{p_project:opts.projectId,p_id:id,p_expected:expected,p_gap:gap,p_requirement:requirement,p_plan_revision:plan}),
  work:id=>opts.caller('drawing_request_work',{p_project:opts.projectId,p_id:id}),
  linkGap:(id,expected,gap,task,step)=>opts.caller('link_drawing_gap',{p_project:opts.projectId,p_id:id,p_expected:expected,p_gap:gap,p_task:task,p_step:step}),
  list:()=>opts.privateCall({p_operation:'list'}),
  load:id=>restored.has(id)?Promise.resolve(structuredClone(restored.get(id))):opts.privateCall({p_operation:'load',p_id:id}),
  restore:async(id,expected,planRevision,step,quote)=>{
   const result=await opts.caller('restore_drawing_request',{...opts.binding,p_id:id,p_expected:expected,p_plan_revision:planRevision,p_step:step,p_request_quote:quote})
   // A load journaled before restoration must not return its old paused packet.
   restored.set(id,result);return result
  },
  read,
  cancel:async(id,expected)=>{
   try{return await opts.caller('cancel_drawing_request',{p_project:opts.projectId,p_id:id,p_expected:expected})}
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
   if(state?.status==='saved')throw new Error('drawing_request_complete')
  },
  save:async(id,expected,status,payload)=>{
   if(id===null){
    const scope=Object.fromEntries(['area_id','component_id','step_id','artifact_id'].map(k=>[k,payload.brief[k]??null]))
    id=await opts.newId()
    const resolved=await opts.caller('resolve_drawing_request',{...opts.binding,p_id:id,p_scope:scope,p_intent:await drawingInputFingerprint(payload.brief,null,null)})
    if(resolved.reused)throw new Error('drawing_request_reuse:'+resolved.id)
   }
   const result=await opts.privateCall({p_operation:'save',p_id:id,p_expected:expected,p_status:status,p_payload:payload})
   if(restored.has(id))restored.set(id,result)
   return result
  },
 }
}
