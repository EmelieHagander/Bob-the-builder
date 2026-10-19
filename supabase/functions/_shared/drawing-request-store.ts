import {drawingInputFingerprint} from './drawing-request-recovery.ts'
import type { DrawingRequest, DrawingRequestStore } from './cad-intake.ts'
import type { BobJournal } from './bob-job-journal.ts'
import type { AiCatalogSession } from './ai-catalog.ts'

type Input=Record<string,unknown>
export interface DrawingRequestStoreState { version:1; restored:[string,DrawingRequest][] }
export type CheckpointDrawingRequestStore=DrawingRequestStore&{
 exportState():DrawingRequestStoreState
 restoreState(state:DrawingRequestStoreState):void
}
/** Project identity creation/cancellation use the caller JWT. Only the private
 * working packet and its operational projection use the claimed server RPC. */
export function createDrawingRequestStore(opts:{
 projectId:string; binding:Input;
 caller:(name:string,args:Input)=>Promise<any>;
 privateCall:(args:Input)=>Promise<any>;
 newId:(key?:string)=>Promise<string>;
 release?:(ids:string[])=>Promise<any>;
 journal?:BobJournal;
 aiCatalog:AiCatalogSession;
}):CheckpointDrawingRequestStore {
 const restored=new Map<string,DrawingRequest>()
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
  exportState():DrawingRequestStoreState {
   if(requireRecorded)throw new Error('drawing_request_checkpoint_inflight')
   return JSON.parse(JSON.stringify({version:1,restored:[...restored]}))
  },
  restoreState(state:DrawingRequestStoreState){
   if(state?.version!==1||!Array.isArray(state.restored)||state.restored.some(row=>!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'
     ||!row[1]||typeof row[1]!=='object'||row[1].id!==row[0]||!Number.isSafeInteger(row[1].revision)||row[1].revision<0
     ||typeof row[1].status!=='string'||!row[1].payload||typeof row[1].payload!=='object'))throw new Error('drawing_request_store_checkpoint_invalid')
   const stateCopy:DrawingRequestStoreState=JSON.parse(JSON.stringify(state))
   restored.clear();for(const [id,request] of stateCopy.restored)restored.set(id,request)
   // A replay restriction belongs to the active call stack, never the next
   // worker lease. The new operation journal creates its own scope on demand.
   requireRecorded=undefined
  },
  withReplayScope:async work=>{
   if(!opts.journal)return work()
   return opts.journal.replayScope(async restrict=>{
    const previous=requireRecorded;requireRecorded=restrict
    try{return await work()}finally{requireRecorded=previous}
   })
  },
  atomicSave:true,
  ensureGapTask:(id,expected,gap,requirement,plan)=>caller('ensure_drawing_gap_task',{p_project:opts.projectId,p_id:id,p_expected:expected,p_gap:gap,p_requirement:requirement,p_plan_revision:plan}),
  // Limits are enforced and renewed server-side; Bob never reads the ledger.
  work:async id=>{
   const work=await caller('drawing_request_work',{p_project:opts.projectId,p_id:id})
   if(!work||typeof work!=='object')return work
   const {budget:_budget,...rest}=work;return rest
  },
  linkGap:(id,expected,gap,task,step)=>caller('link_drawing_gap',{p_project:opts.projectId,p_id:id,p_expected:expected,p_gap:gap,p_task:task,p_step:step}),
  list:()=>opts.privateCall({p_operation:'list'}),
  load:id=>restored.has(id)?Promise.resolve(structuredClone(restored.get(id))):opts.privateCall({p_operation:'load',p_id:id}),
  restore:async(id,expected,planRevision,step,quote)=>{
   const result=await caller('restore_drawing_request',{...opts.binding,p_id:id,p_expected:expected,p_plan_revision:planRevision,p_step:step,p_request_quote:quote})
   // A load journaled before restoration must not return its old paused packet.
   restored.set(id,result);return result
  },
  read,
  cancel:async(id,expected)=>{
   try{return await caller('cancel_drawing_request',{p_project:opts.projectId,p_id:id,p_expected:expected})}
   catch(error){
    if(error instanceof Error&&['drawing_request_complete','drawing_request_changed','drawing_request_denied'].includes(error.message))return {
     status:error.message==='drawing_request_denied'?'not_allowed':'conflict',reason:error.message,request_id:id,
     next_action:opts.aiCatalog.text('feedback.drawing-request-store.next-action.e9a22f8d7db1'),
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
