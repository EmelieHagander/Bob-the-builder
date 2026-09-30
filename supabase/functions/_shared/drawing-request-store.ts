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
 const read=(id:string|null,after:string|null=null)=>opts.caller('project_drawing_requests',{p_project:opts.projectId,p_id:id,p_after:after})
 return {
  atomicSave:true,
  list:()=>opts.privateCall({p_operation:'list'}),
  load:id=>opts.privateCall({p_operation:'load',p_id:id}),
  read,
  cancel:(id,expected)=>opts.caller('cancel_drawing_request',{p_project:opts.projectId,p_id:id,p_expected:expected}),
  assertActive:async id=>{
   // Intentionally fresh, never journaled: a saved model response cannot restore
   // authority revoked by cancellation/reset in another request.
   const state=(await read(id)).requests[0]
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
   return opts.privateCall({p_operation:'save',p_id:id,p_expected:expected,p_status:status,p_payload:payload})
  },
 }
}
