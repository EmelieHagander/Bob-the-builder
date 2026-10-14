import { HANDOFF_INPUT_SCHEMA, prepareDesignHandoff } from './cad-handoff.ts'
import type { DesignHandoff } from './cad-review.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { DrawingRequestStore } from './cad-intake.ts'
import type { AiCatalogSession } from './ai-catalog.ts'

/** Each piece pins its own saved construction before entering the drawing queue.
 * The worker rechecks that exact source and renders it without geometry design. */
const KEY=/^[a-z][a-z0-9_-]{0,39}$/
const text=(v:unknown,n:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=n
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const exact=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const nullable={type:['string','null']}
export const PLAN_CAD_PIECES_TOOL={type:'function' as const,function:{name:'plan_cad_pieces',
 description:'Queue drawings for 2-12 exact saved construction revisions of a larger build. Save and check every piece first, with stable part IDs, pinned materials, declared joints and placements in the shared assembly coordinates. Pass each construction Artifact ID and its exact receipt revision. All pieces are checked before any request is stored or released. Workers render the pinned geometry one piece at a time without designing replacement assemblies. Give each piece its requirements, shared origin/axes and requested views. A failed piece retains its request_id for retry. For one construction use design_project_cad.',
 parameters:{type:'object',additionalProperties:false,required:['assembly_title','assembly_brief','area_id','pieces'],properties:{
  assembly_title:{type:'string',maxLength:200},
  assembly_brief:{type:'string',maxLength:3000,description:'Whole-build intent, shared origin/axes and how the pieces meet.'},
  area_id:nullable,
  pieces:{type:'array',minItems:2,maxItems:12,items:{type:'object',additionalProperties:false,required:['piece_key','brief','component_id','handoff','artifact_id','construction_revision'],properties:{
   piece_key:{type:'string',pattern:KEY.source,description:'Stable short key, e.g. wall_north, floor, roof, bunk_bed.'},
   brief:{type:'string',maxLength:5000},component_id:nullable,handoff:HANDOFF_INPUT_SCHEMA,
   artifact_id:{type:'string',description:'Exact saved construction Artifact ID for this piece.'},
   construction_revision:{type:'integer',minimum:1,maximum:999999999,description:'Exact saved/read construction revision; every piece requires a source.'}}}}}}}}

export function createCadPieces(opts:{requestStore?:DrawingRequestStore;projectId:string;ownerRequest:string|null;hasAccess:()=>Promise<boolean>;aiCatalog:AiCatalogSession;checkConstruction?:(id:string,revision:number,fresh?:boolean)=>Promise<Record<string,any>>}){
 let used=0
 return {tools:opts.requestStore?.releasePieces?[PLAN_CAD_PIECES_TOOL]:[],get remaining(){return Math.max(0,1-used)},
 async execute(raw:unknown){
  const store=opts.requestStore
  if(!store?.releasePieces)return {status:'unavailable',saved:false}
  if(!await opts.hasAccess())throw new Error('project_denied')
  if(used>=1)return {status:'budget_exhausted',saved:false,next_action:opts.aiCatalog.text('feedback.cad-pieces.next-action.6318eb66b0fd')}
  const v=raw as any
  if(!exact(v,['assembly_title','assembly_brief','area_id','pieces'])||!text(v.assembly_title,200)||!text(v.assembly_brief,3000)||(v.area_id!==null&&!text(v.area_id,200))
   ||!Array.isArray(v.pieces)||v.pieces.length<2||v.pieces.length>12)return {status:'invalid',saved:false}
  const keys=new Set<string>(),issues:{piece_key:unknown;reason:string}[]=[],handoffs=new Map<string,DesignHandoff>()
  for(const p of v.pieces){
   if(!(exact(p,['piece_key','brief','component_id','handoff','artifact_id','construction_revision'])||exact(p,['piece_key','brief','component_id','handoff']))||!KEY.test(p.piece_key)||keys.has(p.piece_key)){issues.push({piece_key:p?.piece_key,reason:'invalid_piece'});continue}
   keys.add(p.piece_key)
   if(!uuid(p.artifact_id)||!Number.isSafeInteger(p.construction_revision)||p.construction_revision<1||p.construction_revision>999999999)issues.push({piece_key:p.piece_key,reason:'construction_required'})
   else if(!text(p.brief,5000)||(p.component_id!==null&&!uuid(p.component_id)))issues.push({piece_key:p.piece_key,reason:'invalid_piece'})
   else {
    const prepared=await prepareDesignHandoff(p.handoff)
    if('reason' in prepared)issues.push({piece_key:p.piece_key,reason:prepared.reason})
    else handoffs.set(p.piece_key,prepared.handoff)
   }
  }
  // Validate everything before storing anything: a half-stored split is harder to explain than none.
  if(issues.length)return {status:issues.some(i=>i.reason==='construction_required')?'needs_data':'invalid',stage:'construction',saved:false,issues}
  if(!opts.checkConstruction)return {status:'unavailable',stage:'construction',saved:false,reason:'construction_checker_unavailable'}
  for(const p of v.pieces){
   const result=await opts.checkConstruction(p.artifact_id,p.construction_revision,true)
   if(result.status==='denied')throw new Error('project_denied')
   const d=result.draft
   if(result.status!=='ready'||!d||d.projectId!==opts.projectId||d.artifact_id!==p.artifact_id||d.revision!==p.construction_revision
    ||(d.area_id??null)!==v.area_id||(d.component_id!==undefined&&(d.component_id??null)!==p.component_id))issues.push({piece_key:p.piece_key,reason:result.status==='ready'?'construction_scope_changed':'construction_not_ready'})
  }
  if(issues.length)return {status:'needs_data',stage:'construction',saved:false,issues}
  if(!await opts.hasAccess())throw new Error('project_denied')
  used++
  const pieces:{piece_key:string;request_id:string|null;status:string}[]=[]
  for(const [index,p] of v.pieces.entries()){
   const brief={area_id:v.area_id,component_id:p.component_id,step_id:null,artifact_id:p.artifact_id,construction_revision:p.construction_revision,handoff:handoffs.get(p.piece_key)!,
    brief:opts.aiCatalog.text('cad.piece-brief',{position:index+1,count:v.pieces.length,piece_key:p.piece_key,assembly_title:v.assembly_title,assembly_brief:v.assembly_brief,piece_brief:p.brief}).slice(0,6000)}
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
   next_action:opts.aiCatalog.text('feedback.cad-pieces.next-action.a8cb04d07c6d')}
 }}
}
