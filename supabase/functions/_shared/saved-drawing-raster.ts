import {validImageSignature} from './project-context/media.ts'
export const SAVED_VIEW_PNG_MAX=700000
export const SAVED_VIEW_RENDERER='resvg-2.6.2-dejavu-2.37-sheets-v1'
export type SavedViewPin={project_id:string;artifact_id:string;revision:number;view:string;source_sha256:string}
export type SavedViewRecord={status:'ready';projectId:string;artifact_id:string;revision:number;current_revision:number;view:string;source_view:string;source_sha256:string;title:string;archived:boolean;recorded_at:string;area_id:string|null;source_state:string;source_reasons:unknown;svg?:string}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
export const savedViewName=/^[A-Za-z][A-Za-z0-9_-]*(?:\.sheet(?:[2-9]|[1-9][0-9]))?$/
export function savedViewPin(v:any):SavedViewPin|null{return v&&Object.keys(v).sort().join(',')==='artifact_id,project_id,revision,source_sha256,view'
 &&typeof v.project_id==='string'&&v.project_id.length>0&&v.project_id.length<=200&&uuid.test(v.artifact_id)&&Number.isSafeInteger(v.revision)&&v.revision>0
 &&typeof v.view==='string'&&v.view.length<=80&&savedViewName.test(v.view)&&/^[0-9a-f]{64}$/.test(v.source_sha256)?v:null}
export function sameSavedView(record:any,pin:SavedViewPin):record is SavedViewRecord{return record?.status==='ready'&&record.projectId===pin.project_id&&record.artifact_id===pin.artifact_id&&record.revision===pin.revision&&record.view===pin.view&&record.source_sha256===pin.source_sha256&&['current','changed'].includes(record.source_state)}
export async function sourceSvg(record:SavedViewRecord){
 if(typeof record.svg!=='string'||record.svg.length>2097152)throw Error('saved_view_unavailable')
 let raw:Uint8Array;try{const binary=atob(record.svg);raw=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)raw[i]=binary.charCodeAt(i)}catch{throw Error('saved_view_invalid')}
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',raw as Uint8Array<ArrayBuffer>))
 if([...hash].map(n=>n.toString(16).padStart(2,'0')).join('')!==record.source_sha256)throw Error('saved_view_changed')
 return new TextDecoder('utf-8',{fatal:true}).decode(raw)
}
/** Reframe one sheet from the immutable SVG. No geometry generation, URLs,
 * script execution, external resources or inferred drawing approval. */
export function savedSvgPage(svg:string,view:string):{svg:string;width:number;height:number;page:number;pages:number}{
 if(svg.length>1572864||!savedViewName.test(view)||/<!DOCTYPE|<!ENTITY|<(?:script|foreignObject|image|iframe)\b|@import/i.test(svg))throw Error('saved_view_invalid')
 for(const match of svg.matchAll(/(?:\b|:)href\s*=\s*(["'])(.*?)\1/gi))if(!match[2].startsWith('#'))throw Error('saved_view_external_resource')
 for(const match of svg.matchAll(/url\(([^)]*)\)/gi))if(!match[1].trim().replace(/^["']|["']$/g,'').startsWith('#'))throw Error('saved_view_external_resource')
 if((svg.match(/</g)??[]).length>60000)throw Error('saved_view_too_complex')
 const root=svg.match(/^(?:\s*<\?xml[^?]*\?>)?\s*<svg\b([^>]*)>/i);if(!root)throw Error('saved_view_invalid')
 const attr=(name:string)=>root[1].match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(["\\\'])(.*?)\\1','i'))?.[2]
 const box=(attr('viewBox')??'').trim().split(/[\s,]+/).map(Number)
 if(box.length!==4||box.some(n=>!Number.isFinite(n)||Math.abs(n)>1e7)||box[2]<=0||box[3]<=0)throw Error('saved_view_invalid')
 const pageHeight=attr('data-page-height')?Number(attr('data-page-height')):box[3],pages=Math.round(box[3]/pageHeight),page=Number(view.split('.sheet')[1]??1)
 if(!Number.isFinite(pageHeight)||pageHeight<=0||pages<1||pages>12||Math.abs(pageHeight*pages-box[3])>0.01||page<1||page>pages)throw Error('saved_view_page_unavailable')
 const fields=root[1].replace(/\s+(?:width|height|viewBox|overflow)\s*=\s*(["']).*?\1/gi,'')
 const head=`<svg${fields} width="${box[2]}" height="${pageHeight}" viewBox="${box[0]} ${box[1]+(page-1)*pageHeight} ${box[2]} ${pageHeight}" overflow="hidden">`
 return{svg:head+svg.slice(root[0].length),width:box[2],height:pageHeight,page,pages}
}
export function validateSavedPng(bytes:Uint8Array){if(bytes.length> SAVED_VIEW_PNG_MAX||bytes.length<24||!validImageSignature(bytes,'image/png'))throw Error('saved_view_image_invalid');const h=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(!h.getUint32(16)||!h.getUint32(20)||h.getUint32(16)>1024||h.getUint32(20)>1024)throw Error('saved_view_image_invalid')}
export function createSavedDrawingHandler(opts:{read:(authorization:string,pin:SavedViewPin,svg:boolean)=>Promise<any>;raster:(page:ReturnType<typeof savedSvgPage>)=>Promise<Uint8Array>; sourceSvg?:(record:SavedViewRecord)=>Promise<string>}){
 const cache=new Map<string,{at:number;bytes:Uint8Array}>()
 const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Expose-Headers':'x-drawing-source-sha256, x-drawing-view','Cache-Control':'no-store'}
 return async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers})
  if(req.method!=='POST')return new Response(null,{status:405,headers})
  const auth=req.headers.get('authorization')??'';if(!/^Bearer\s+\S+$/i.test(auth))return new Response(null,{status:401,headers})
  let pin:SavedViewPin|null;try{const body=await req.text();if(body.length>1500)throw Error();pin=savedViewPin(JSON.parse(body))}catch{pin=null}
  if(!pin)return Response.json({status:'invalid'},{status:400,headers})
  try{
   const record=await opts.read(auth,pin,false);if(!sameSavedView(record,pin))return new Response(null,{status:403,headers})
   const cacheKey=JSON.stringify([SAVED_VIEW_RENDERER,pin.project_id,pin.artifact_id,pin.revision,pin.view,pin.source_sha256]),known=cache.get(cacheKey)
   let bytes=known&&Date.now()-known.at<300000?known.bytes:undefined
   if(!bytes){
    const source=await opts.read(auth,pin,true);if(!sameSavedView(source,pin)||savedViewVersion(source)!==savedViewVersion(record))return new Response(null,{status:409,headers})
    const page=savedSvgPage(await (opts.sourceSvg??sourceSvg)(source),pin.view);bytes=await opts.raster(page);validateSavedPng(bytes)
   }
   const latest=await opts.read(auth,pin,false);if(!sameSavedView(latest,pin)||savedViewVersion(latest)!==savedViewVersion(record))return new Response(null,{status:409,headers})
   if(!known||Date.now()-known.at>=300000){cache.delete(cacheKey);if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(cacheKey,{at:Date.now(),bytes})}
   return new Response(bytes as BodyInit,{headers:{...headers,'Content-Type':'image/png','x-drawing-source-sha256':pin.source_sha256,'x-drawing-view':pin.view}})
  }catch{return Response.json({status:'unavailable'},{status:503,headers})}
 }
}
export function savedViewVersion(r:SavedViewRecord){return JSON.stringify([SAVED_VIEW_RENDERER,r.artifact_id,r.revision,r.view,r.source_sha256,r.current_revision,r.archived,r.source_state,r.source_reasons])}
