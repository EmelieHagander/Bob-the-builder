import type {ContextAdapter,Opened,ListRequest} from './dispatcher.ts'
import {sameSavedView,savedViewName,savedViewVersion,validateSavedPng,SAVED_VIEW_PNG_MAX,type SavedViewPin,type SavedViewRecord} from '../saved-drawing-raster.ts'
export interface DrawingViewTransport{
 list(input:ListRequest,signal:AbortSignal):Promise<{projectId:string;total:number;records:{id:string;revision:number;title:string;area_id:string|null;views:string[];source_state:string;source_reasons:unknown}[]}>
 read(artifact:string,revision:number,view:string,signal:AbortSignal):Promise<unknown>
 raster(pin:SavedViewPin,signal:AbortSignal):Promise<Uint8Array>
}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
export function drawingViewRef(id:string,revision:number,view:string){return `drawing:${id}:${revision}:${view}`}
export function parseDrawingViewRef(ref:string){const p=ref.split(':');return p.length===4&&p[0]==='drawing'&&uuid.test(p[1])&&/^[1-9][0-9]{0,8}$/.test(p[2])&&savedViewName.test(p[3])&&p[3].length<=80?{artifact_id:p[1].toLowerCase(),revision:Number(p[2]),view:p[3]}:null}
async function read(projectId:string,transport:DrawingViewTransport,ref:string,signal:AbortSignal){
 const pin=parseDrawingViewRef(ref);if(!pin)throw Error('drawing_view_reference_invalid')
 const row=await transport.read(pin.artifact_id,pin.revision,pin.view,signal) as SavedViewRecord|null
 if(!row||!sameSavedView(row,{...pin,project_id:projectId,source_sha256:row.source_sha256})||typeof row.title!=='string'||row.title.length>200||!Number.isSafeInteger(row.current_revision)||row.current_revision<1||typeof row.archived!=='boolean'||typeof row.recorded_at!=='string'||!Number.isFinite(Date.parse(row.recorded_at))||!/^[0-9a-f]{64}$/.test(row.source_sha256))throw Error('drawing_view_unavailable')
 return row
}
export function createDrawingViewAdapter(projectId:string,transport:DrawingViewTransport):ContextAdapter{
 return{category:'drawing_views',prefix:'drawing',descriptionCache:false,
  async count(signal){const page=await transport.list({category:'drawing_views',query:null,area_id:null,after_id:null},signal);if(page.projectId!==projectId||!Array.isArray(page.records))throw Error('drawing_view_unavailable');if(!Number.isSafeInteger(page.total)||page.total<0)throw Error('drawing_view_unavailable');return page.total},
  async list(input,signal){
   if(input.after_id&&!uuid.test(input.after_id))throw Error('invalid_cursor')
   const page=await transport.list(input,signal);if(page.projectId!==projectId||!Array.isArray(page.records)||page.records.length>13)throw Error('drawing_view_unavailable')
   const rows=page.records.slice(0,12);for(const r of rows)if(!uuid.test(r.id)||!Number.isSafeInteger(r.revision)||r.revision<1||typeof r.title!=='string'||!Array.isArray(r.views)||!r.views.length||r.views.length>256||r.views.some(v=>typeof v!=='string'||!savedViewName.test(v)||v.length>80))throw Error('drawing_view_unavailable')
   return{items:rows.map(r=>({ref:drawingViewRef(r.id,r.revision,r.views[0]),project_id:projectId,title:`${r.title} · v${r.revision}`,purpose:'saved_drawing',source_kind:'saved_cad_view',artifact_revision:r.revision,source_state:r.source_state,source_reasons:r.source_reasons,views:r.views.map(view=>({view,ref:drawingViewRef(r.id,r.revision,view)})),links:[{area_id:r.area_id}],links_truncated:false})),next_cursor:page.records.length>12?rows.at(-1)!.id:null}
  },
  async open(ref,signal):Promise<Opened>{
   const row=await read(projectId,transport,ref,signal),version=savedViewVersion(row)
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(version)))].map(n=>n.toString(16).padStart(2,'0')).join('')
   return{item:{ref,project_id:projectId,title:`${row.title} · v${row.revision} · ${row.view}`,purpose:'saved_drawing',source_kind:'saved_cad_view',artifact_revision:row.revision,current_revision:row.current_revision,historical:row.revision!==row.current_revision,archived:row.archived,view:row.view,source_state:row.source_state,source_reasons:row.source_reasons,links:[{area_id:row.area_id}],links_truncated:false},
    version,bytes:SAVED_VIEW_PNG_MAX,image:{type:'image_url',image_url:`private-image:${ref}/${digest}`},source:{projectId,dataset:'image_pixels',recordId:row.artifact_id,label:`Ritningsvy öppnad: ${row.title} · v${row.revision} · ${row.view}`,retrievedAt:new Date().toISOString(),updatedAt:row.recorded_at,truth:'ai_assessment',visual:{kind:'cad',ref,revision:row.revision,view:row.view}}}
  },
  async current(ref,expected,signal){try{return savedViewVersion(await read(projectId,transport,ref,signal))===expected}catch{return false}},
 }
}
export async function resolveDrawingViewImage(projectId:string,transport:DrawingViewTransport,record:Opened,signal:AbortSignal){
 const row=await read(projectId,transport,record.item.ref,signal)
 if(savedViewVersion(row)!==record.version)throw Error('context_changed')
 const bytes=await transport.raster({project_id:projectId,artifact_id:row.artifact_id,revision:row.revision,view:row.view,source_sha256:row.source_sha256},signal);validateSavedPng(bytes)
 if(savedViewVersion(await read(projectId,transport,record.item.ref,signal))!==record.version)throw Error('context_changed')
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
 return 'data:image/png;base64,'+btoa(binary)
}
