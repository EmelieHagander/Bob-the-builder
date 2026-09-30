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
    await opts.caller('create_drawing_request',{...opts.binding,p_id:id,p_scope:scope})
   }
   const result=await opts.privateCall({p_operation:'save',p_id:id,p_expected:expected,p_status:status,p_payload:payload})
   if(restored.has(id))restored.set(id,result)
   return result
  },
 }
}
