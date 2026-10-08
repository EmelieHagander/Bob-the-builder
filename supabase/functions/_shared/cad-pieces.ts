import { DESIGN_HANDOFF_SCHEMA, parseDesignHandoff } from './cad-review.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { DrawingRequestStore } from './cad-intake.ts'

/** A build too large for one designer answer is split into pieces. Each piece is
 * its own drawing request with its own budget; the existing drawing-event queue
 * designs and saves them one by one after the turn, so one failure costs one piece. */
const KEY=/^[a-z][a-z0-9_-]{0,39}$/
const text=(v:unknown,n:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=n
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const exact=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const nullable={type:['string','null']}
export const PLAN_CAD_PIECES_TOOL={type:'function' as const,function:{name:'plan_cad_pieces',
 description:'Split one large build (a room, extension, house, or anything with more than about 24 parts or several structural systems) into 2-12 pieces that are each designed and saved as their own drawing. Pieces are queued and designed one at a time after this reply; each saved piece appears in this conversation. A failed piece does not stop the others and can be resumed by its request_id with design_project_cad. Give every piece a complete standalone brief and handoff in the same shared coordinate system (state the origin and axes once in assembly_brief and repeat them in each handoff). For a single small object use design_project_cad instead.',
 parameters:{type:'object',additionalProperties:false,required:['assembly_title','assembly_brief','area_id','pieces'],properties:{
  assembly_title:{type:'string',maxLength:200},
  assembly_brief:{type:'string',maxLength:3000,description:'Whole-build intent, shared origin/axes and how the pieces meet.'},
  area_id:nullable,
  pieces:{type:'array',minItems:2,maxItems:12,items:{type:'object',additionalProperties:false,required:['piece_key','brief','component_id','handoff'],properties:{
   piece_key:{type:'string',pattern:KEY.source,description:'Stable short key, e.g. wall_north, floor, roof, bunk_bed.'},
   brief:{type:'string',maxLength:5000},component_id:nullable,handoff:DESIGN_HANDOFF_SCHEMA}}}}}}}

export function createCadPieces(opts:{requestStore?:DrawingRequestStore;ownerRequest:string|null;hasAccess:()=>Promise<boolean>}){
 let used=0
 return {tools:opts.requestStore?.releasePieces?[PLAN_CAD_PIECES_TOOL]:[],get remaining(){return Math.max(0,1-used)},
 async execute(raw:unknown){
  const store=opts.requestStore
  if(!store?.releasePieces)return {status:'unavailable',saved:false}
  if(used>=1)return {status:'budget_exhausted',saved:false,next_action:'Pieces were already queued in this turn. Read them with read_drawing_requests.'}
  const v=raw as any
  if(!exact(v,['assembly_title','assembly_brief','area_id','pieces'])||!text(v.assembly_title,200)||!text(v.assembly_brief,3000)||(v.area_id!==null&&!text(v.area_id,200))
   ||!Array.isArray(v.pieces)||v.pieces.length<2||v.pieces.length>12)return {status:'invalid',saved:false}
  const keys=new Set<string>(),issues:{piece_key:unknown;reason:string}[]=[]
  for(const p of v.pieces){
   if(!exact(p,['piece_key','brief','component_id','handoff'])||!KEY.test(p.piece_key)||keys.has(p.piece_key)){issues.push({piece_key:p?.piece_key,reason:'invalid_piece'});continue}
   keys.add(p.piece_key)
   if(!text(p.brief,5000)||(p.component_id!==null&&!uuid(p.component_id)))issues.push({piece_key:p.piece_key,reason:'invalid_piece'})
   else if(!parseDesignHandoff(p.handoff))issues.push({piece_key:p.piece_key,reason:'invalid_handoff'})
  }
  // Validate everything before storing anything: a half-stored split is harder to explain than none.
  if(issues.length)return {status:'invalid',saved:false,issues}
  if(!await opts.hasAccess())throw new Error('project_denied')
  used++
  const pieces:{piece_key:string;request_id:string|null;status:string}[]=[]
  for(const [index,p] of v.pieces.entries()){
   const brief={area_id:v.area_id,component_id:p.component_id,step_id:null,artifact_id:null,handoff:p.handoff,
    brief:`Piece ${index+1} of ${v.pieces.length} (${p.piece_key}) of "${v.assembly_title}". Whole build: ${v.assembly_brief}\n\nThis piece: ${p.brief}`.slice(0,6000)}
   try{
    const saved=await store.save(null,0,'collecting',{brief,owner_request:opts.ownerRequest,reference_refs:[]},'piece:'+p.piece_key)
    pieces.push({piece_key:p.piece_key,request_id:saved.id,status:'queued'})
   }catch(error){
    rethrowContinuation(error)
    if(error instanceof Error&&error.message==='project_denied')throw error
    if(error instanceof Error&&error.message.startsWith('drawing_request_reuse:'))pieces.push({piece_key:p.piece_key,request_id:error.message.split(':')[1],status:'existing_request'})
    else pieces.push({piece_key:p.piece_key,request_id:null,status:'not_stored'})
   }
  }
  const ids=pieces.filter(p=>p.status==='queued').map(p=>p.request_id!)
  let released:string[]=[]
  if(ids.length){
   try{released=(await store.releasePieces(ids)).released}
   catch(error){rethrowContinuation(error);if(error instanceof Error&&error.message==='project_denied')throw error}
  }
  for(const p of pieces)if(p.status==='queued'&&!released.includes(p.request_id!))p.status='stored_not_started'
  return {status:released.length?'queued':'not_started',saved:false,pieces,
   next_action:'Tell the owner which pieces were queued. Each is designed and saved separately after this reply, one at a time, while the owner has Bob open; saved pieces appear in this conversation. Do not call design_project_cad for queued pieces in this turn. existing_request pieces are already in progress; stored_not_started pieces start with design_project_cad and their request_id; not_stored pieces were not created. When the pieces are saved, combine them with compose_cad_shell (placement_basis shared_origin at 0,0,0) so the owner sees the whole build, then link each piece to the plan Step that builds it with link_cad_shell_steps.'}
 }}
}
