import { rethrowContinuation } from './bob-job-journal.ts'
import type { ProjectWriter } from './project-write.ts'
import { humanTextRejection } from './human-text.ts'
import { parseBobImageIds } from '../../../src/domain/bobImages.ts'
const str={type:'string'}
function tool(name:string,description:string,properties:Record<string,unknown>){return {type:'function' as const,function:{name,description,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}}}}
const target={type:'string',enum:['project','area','task','step','plan_step']}
export const IMAGE_TOOLS=[
 tool('generate_project_image','Create an illustrative mockup or instruction image, save it privately and attach it where needed. For a mockup in a photographed place, copy the attached image ids into reference_image_ids and describe the planned build and what must stay unchanged (setting, perspective and existing features). These exact photos reach the image model. Use [] for an illustration without references. Read existing media to avoid duplicates; open and review the saved result before recommending it. Illustrations are not measured geometry or a fallback for failed CAD. plan_step is a living-plan Step; step is a Task instruction step.',{prompt:str,title:str,purpose:{type:'string',enum:['proposal','instruction']},target_kind:target,target_id:str,reference_image_ids:{type:'array',maxItems:4,uniqueItems:true,items:{type:'string',format:'uuid'}},request_quote:str}),
 tool('attach_project_image','Attach an existing ready project image to an Area, Task, instruction step or living-plan Step. Reuses the original file.',{media_id:str,target_kind:target,target_id:str,request_quote:str}),
 tool('finalize_project_image','Recover a pending image whose bytes were uploaded successfully. Makes no new generation or upload; storage metadata is checked before ready status.',{media_id:str,request_quote:str}),
]
export interface ProjectImageToolsState {
 version:1
 generated:boolean
 pendingMedia:string|null
 generatedRequests:[string,string][]
 attemptedRequests:string[]
}
export function createProjectImageTools(opts:{delivery?:{validateTarget:(kind:string,id:string)=>Promise<{status:string}>;generationKey:(prompt:string,refs:string[])=>Promise<string>};unlimitedWork?:boolean;projectId:string;message:string;writer:ProjectWriter;hasAccess:()=>Promise<boolean>;deadline:number;defaultImageIds?:string[];newId?:()=>Promise<string>;generate:(prompt:string,referenceIds:string[])=>Promise<{ok:true;image:Uint8Array}|{ok:false;error:string}>;upload:(id:string,bytes:Uint8Array)=>Promise<void>}){
 let generated=false
 let pendingMedia:string|null=null
 const generatedRequests=new Map<string,string>()
 const attemptedRequests=new Set<string>()
 const recoverable=!!opts.delivery||!!opts.unlimitedWork
 const attach=async(v:Record<string,string>,id:string,original?:any)=>{
  if(v.target_kind==='project'&&v.target_id===opts.projectId)return original??{status:'already_generated',saved:true,media_id:id}
  const linked=await opts.writer.commit({kind:'image_link',record_id:id,expected_updated_at:null,expected_revision:null,request_quote:v.request_quote,data:{target_kind:v.target_kind,target_id:v.target_id}})
  return linked.status==='saved'?{...linked,saved:true,media_id:id,reused:!original}:{status:'partial',stage:'attachment',saved:false,image_saved:true,media_id:id,attachment_status:linked.status,recovery:'The image is saved in the project. Correct the target and attach this image; do not generate a replacement.'}
 }

 return {
 exportState():ProjectImageToolsState{return {version:1,generated,pendingMedia,generatedRequests:[...generatedRequests],attemptedRequests:[...attemptedRequests]}},
 restoreState(state:ProjectImageToolsState){
  if(state?.version!==1||typeof state.generated!=='boolean'||!(state.pendingMedia===null||typeof state.pendingMedia==='string')
    ||!Array.isArray(state.generatedRequests)||state.generatedRequests.some(row=>!Array.isArray(row)||row.length!==2||row.some(value=>typeof value!=='string'))
    ||!Array.isArray(state.attemptedRequests)||state.attemptedRequests.some(value=>typeof value!=='string'))throw new Error('project_image_tools_checkpoint_invalid')
  generated=state.generated;pendingMedia=state.pendingMedia
  generatedRequests.clear();for(const [key,id] of state.generatedRequests)generatedRequests.set(key,id)
  attemptedRequests.clear();for(const key of state.attemptedRequests)attemptedRequests.add(key)
 },
 tools:IMAGE_TOOLS,get remaining(){return opts.writer.remaining},async execute(name:string,raw:unknown){
  const spec=IMAGE_TOOLS.find(t=>t.function.name===name)
  if(!spec||!raw||typeof raw!=='object'||Array.isArray(raw))return {status:'invalid'}
  const v=raw as Record<string,string>
  const strings=spec.function.parameters.required.filter(k=>k!=='reference_image_ids')
  if(Object.keys(v).some(k=>!spec.function.parameters.required.includes(k))||strings.some(k=>typeof v[k]!=='string'||!v[k].trim())||v.request_quote.length>500||!opts.message.includes(v.request_quote))return {status:'invalid'}
  let referenceIds:string[]=[]
  try{if(name==='generate_project_image')referenceIds=parseBobImageIds(v.reference_image_ids)??opts.defaultImageIds??[]}catch{return {status:'invalid'}}
  if(!await opts.hasAccess())throw new Error('project_denied')
  if(Date.now()>opts.deadline-(opts.unlimitedWork?0:15000))return {status:'budget_exhausted'}
  if(name!=='finalize_project_image'&&(!['project','area','task','step','plan_step'].includes(v.target_kind)||v.target_id.length>200))return {status:'invalid'}
  if(opts.delivery&&name!=='finalize_project_image'){
   let target:{status:string}
   try{target=await opts.delivery.validateTarget(v.target_kind,v.target_id)}catch(error){rethrowContinuation(error);if(error instanceof Error&&error.message==='project_denied')throw error;return {status:'unavailable',stage:'target',saved:false}}
   if(!await opts.hasAccess())throw new Error('project_denied')
   if(target.status!=='ready')return {status:target.status==='not_found'?'invalid':'unavailable',stage:'target',saved:false,reason:'image_target_unavailable'}
  }
  if(name==='attach_project_image'||name==='finalize_project_image'){
   const result=await opts.writer.commit({kind:name==='attach_project_image'?'image_link':'image_finalize',record_id:v.media_id,expected_updated_at:null,expected_revision:null,request_quote:v.request_quote,data:name==='attach_project_image'?{target_kind:v.target_kind,target_id:v.target_id}:{}})
   if(recoverable&&name==='finalize_project_image'&&result.status==='saved'&&pendingMedia===v.media_id)pendingMedia=null
   return result
  }
  if(v.prompt.length>6000||v.title.length>200||!['proposal','instruction'].includes(v.purpose))return {status:'invalid'}
  // The title is shown with the image; the prompt is for the image model.
  const prose=humanTextRejection([['title',v.title]])
  if(prose)return {status:'invalid',validation:{code:'human_text',fields:prose.fields},message:'No image generated. '+prose.message}
  // Removing the turn quota must not turn a retry or unfinished upload into a
  // second paid generation. Keep the saved identity and recover it explicitly.
  let requestKey:string
  try{requestKey=opts.delivery?await opts.delivery.generationKey(v.prompt,referenceIds):JSON.stringify([v.prompt,v.title,v.purpose,v.target_kind,v.target_id,referenceIds])}
  catch(error){rethrowContinuation(error);if(error instanceof Error&&error.message==='project_denied')throw error;return {status:'unavailable',stage:'reference_images',saved:false}}
  if(recoverable&&pendingMedia)return {status:'recovery_required',saved:false,media_id:pendingMedia,recovery:'Inspect and finalize the pending image before generating another image.'}
  if(recoverable&&generatedRequests.has(requestKey)){
   const id=generatedRequests.get(requestKey)!
   return opts.delivery?attach(v,id):{status:'already_generated',saved:false,media_id:id,recovery:'Open the existing image; this exact generation request has already been saved.'}
  }
  if((!opts.unlimitedWork&&generated)||opts.writer.remaining<(opts.delivery?3:2))return {status:'budget_exhausted'}
  if(recoverable&&attemptedRequests.has(requestKey))return {status:'no_progress',saved:false,recovery:'This exact generation attempt already failed. Inspect its failure and correct the inputs before another attempt.'}
  if(recoverable)attemptedRequests.add(requestKey)
  generated=true
  let result:Awaited<ReturnType<typeof opts.generate>>
  try{result=await opts.generate(v.prompt,referenceIds)}catch(error){rethrowContinuation(error);return {status:'unavailable',stage:'reference_images',saved:false}}
  if(!result.ok)return {status:'unavailable',stage:'generation',saved:false}
  const bytes=result.image
  if(bytes.length<24||bytes.length>6*1024*1024||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n))return {status:'unavailable',stage:'image_format',saved:false}
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=header.getUint32(16),height=header.getUint32(20)
  if(!width||!height||width>20000||height>20000||width*height>48000000)return {status:'unavailable',stage:'image_dimensions',saved:false}
  if(!await opts.hasAccess())throw new Error('project_denied')
  const id=opts.newId?await opts.newId():crypto.randomUUID(),payload={record_id:id,expected_updated_at:null,expected_revision:null,request_quote:v.request_quote}
  const reserved=await opts.writer.commit({...payload,kind:'image_reserve',data:{title:v.title,purpose:v.purpose,byte_size:bytes.length,width,height,target_kind:opts.delivery?'project':v.target_kind,target_id:opts.delivery?opts.projectId:v.target_id}})
  if(reserved.status!=='saved')return reserved
  if(recoverable){pendingMedia=id;generatedRequests.set(requestKey,id)}
  try{await opts.upload(id,bytes)}catch(error){rethrowContinuation(error);return {status:'partial',stage:'upload',saved:false,media_id:id,message:'A pending entry exists. Inspect it before another generation; do not claim the image is ready.'}}
  const finalized=await opts.writer.commit({...payload,kind:'image_finalize',data:{}})
  if(recoverable&&finalized.status==='saved')pendingMedia=null
  const delivered=opts.delivery&&finalized.status==='saved'?await attach(v,id,finalized):finalized
  return {...delivered,saved:delivered.saved??delivered.status==='saved',media_id:id,reference_image_ids:referenceIds,representation:'illustration',geometry_verified:false,
   project_id:opts.projectId,target_kind:v.target_kind,target_id:v.target_id,
   review_instruction:'Open this image and compare it with current project facts and its linked Step before recommending it. It has no CAD review and does not fulfill a dimensioned drawing request. Report any CAD failure separately.',
   ...(finalized.status!=='saved'?{recovery:'Use finalize_project_image with this media_id; never generate a replacement blindly.'}:{})}
 }}
}
export type ProjectImageTools=ReturnType<typeof createProjectImageTools>
