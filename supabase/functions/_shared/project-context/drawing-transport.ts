import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.110.2'
import type {DrawingViewTransport} from './drawings.ts'
import {readImageResponse} from './media.ts'
import {SAVED_VIEW_PNG_MAX} from '../saved-drawing-raster.ts'
export function createDrawingViewTransport(client:SupabaseClient<any,any,any>,opts:{projectId:string;url:string;key:string;authHeader:string;fetcher?:typeof fetch}):DrawingViewTransport{
 return{
  async list(input,signal){const{data,error}=await client.rpc('list_saved_drawing_views',{p_project:opts.projectId,p_after:input.after_id,p_area:input.area_id,p_query:input.query}).abortSignal(signal);if(error)throw Error('drawing_view_unavailable');return data},
  async read(id,revision,view,signal){const{data,error}=await client.rpc('read_saved_drawing_view',{p_project:opts.projectId,p_artifact:id,p_revision:revision,p_view:view,p_svg:false}).abortSignal(signal);if(error)throw Error('drawing_view_unavailable');return data},
  async raster(pin,signal){
   if(pin.project_id!==opts.projectId)throw Error('project_denied')
   const response=await(opts.fetcher??fetch)(opts.url.replace(/\/$/,'')+'/functions/v1/drawing-preview',{method:'POST',redirect:'error',cache:'no-store',signal,headers:{Authorization:opts.authHeader,apikey:opts.key,'Content-Type':'application/json'},body:JSON.stringify(pin)})
   if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png'||response.headers.get('x-drawing-source-sha256')!==pin.source_sha256||response.headers.get('x-drawing-view')!==pin.view){await response.body?.cancel();throw Error('drawing_view_unavailable')}
   // The endpoint returns one bounded image, never SVG/STEP or an export packet.
   const length=Number(response.headers.get('content-length'))
   if(length>SAVED_VIEW_PNG_MAX){await response.body?.cancel();throw Error('image_too_large')}
   if(Number.isSafeInteger(length)&&length>0)return readImageResponse(response,length,signal)
   if(!response.body)throw Error('drawing_view_unavailable')
   const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0
   for(;;){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>SAVED_VIEW_PNG_MAX){await reader.cancel();throw Error('image_too_large')}parts.push(value)}
   const bytes=new Uint8Array(total);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length}return bytes
  },
 }
}
