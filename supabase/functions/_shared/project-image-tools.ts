import { rethrowContinuation } from './bob-job-journal.ts'
import type { ProjectWriter } from './project-write.ts'
const str={type:'string'}
function tool(name:string,description:string,properties:Record<string,unknown>){return {type:'function' as const,function:{name,description,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}}}}
const target={type:'string',enum:['project','area','task','step','plan_step']}
export const IMAGE_TOOLS=[
 tool('generate_project_image','Create an illustrative proposal or instruction image, save it privately and attach it where needed. Read existing media first to avoid duplicate generations. Never use an illustration as measured geometry. plan_step is a living-plan Step; step is a Task instruction step.',{prompt:str,title:str,purpose:{type:'string',enum:['proposal','instruction']},target_kind:target,target_id:str,request_quote:str}),
 tool('attach_project_image','Attach an existing ready project image to an Area, Task, instruction step or living-plan Step. Reuses the original file.',{media_id:str,target_kind:target,target_id:str,request_quote:str}),
 tool('finalize_project_image','Recover a pending image whose bytes were uploaded successfully. Makes no new generation or upload; storage metadata is checked before ready status.',{media_id:str,request_quote:str}),
]
export function createProjectImageTools(opts:{projectId:string;message:string;writer:ProjectWriter;hasAccess:()=>Promise<boolean>;deadline:number;newId?:()=>Promise<string>;generate:(prompt:string)=>Promise<{ok:true;image:Uint8Array}|{ok:false;error:string}>;upload:(id:string,bytes:Uint8Array)=>Promise<void>}){
 let generated=false
 return {tools:IMAGE_TOOLS,get remaining(){return opts.writer.remaining},async execute(name:string,raw:unknown){
  const spec=IMAGE_TOOLS.find(t=>t.function.name===name)
  if(!spec||!raw||typeof raw!=='object'||Array.isArray(raw))return {status:'invalid'}
  const v=raw as Record<string,string>
  if(Object.keys(v).length!==spec.function.parameters.required.length||spec.function.parameters.required.some(k=>typeof v[k]!=='string'||!v[k].trim())||v.request_quote.length>500||!opts.message.includes(v.request_quote))return {status:'invalid'}
  if(!await opts.hasAccess())throw new Error('project_denied')
  if(Date.now()>opts.deadline-15000)return {status:'budget_exhausted'}
  if(name!=='finalize_project_image'&&(!['project','area','task','step','plan_step'].includes(v.target_kind)||v.target_id.length>200))return {status:'invalid'}
  if(name==='attach_project_image'||name==='finalize_project_image')return opts.writer.commit({kind:name==='attach_project_image'?'image_link':'image_finalize',record_id:v.media_id,expected_updated_at:null,expected_revision:null,request_quote:v.request_quote,data:name==='attach_project_image'?{target_kind:v.target_kind,target_id:v.target_id}:{}})
  if(generated||opts.writer.remaining<2)return {status:'budget_exhausted'}
  if(v.prompt.length>6000||v.title.length>200||!['proposal','instruction'].includes(v.purpose))return {status:'invalid'}
  generated=true
  const result=await opts.generate(v.prompt)
  if(!result.ok)return {status:'unavailable',stage:'generation',saved:false}
  const bytes=result.image
  if(bytes.length<24||bytes.length>6*1024*1024||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n))return {status:'unavailable',stage:'image_format',saved:false}
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=header.getUint32(16),height=header.getUint32(20)
  if(!width||!height||width>20000||height>20000||width*height>48000000)return {status:'unavailable',stage:'image_dimensions',saved:false}
  if(!await opts.hasAccess())throw new Error('project_denied')
  const id=opts.newId?await opts.newId():crypto.randomUUID(),payload={record_id:id,expected_updated_at:null,expected_revision:null,request_quote:v.request_quote}
  const reserved=await opts.writer.commit({...payload,kind:'image_reserve',data:{title:v.title,purpose:v.purpose,byte_size:bytes.length,width,height,target_kind:v.target_kind,target_id:v.target_id}})
  if(reserved.status!=='saved')return reserved
  try{await opts.upload(id,bytes)}catch(error){rethrowContinuation(error);return {status:'partial',stage:'upload',saved:false,media_id:id,message:'A pending entry exists. Inspect it before another generation; do not claim the image is ready.'}}
  const finalized=await opts.writer.commit({...payload,kind:'image_finalize',data:{}})
  return {...finalized,saved:finalized.status==='saved',media_id:id,...(finalized.status!=='saved'?{recovery:'Use finalize_project_image with this media_id; never generate a replacement blindly.'}:{})}
 }}
}
export type ProjectImageTools=ReturnType<typeof createProjectImageTools>
