import {initWasm,Resvg} from 'npm:@resvg/resvg-wasm@2.6.2'
import type {savedSvgPage} from './saved-drawing-raster.ts'
async function pinned(url:string,size:number,sha:string){
 const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok||!response.body)throw Error('raster_dependency_unavailable')
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0
 for(;;){const{value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>size){await reader.cancel();throw Error('raster_dependency_invalid')}parts.push(value)}
 if(length!==size)throw Error('raster_dependency_invalid')
 const bytes=new Uint8Array(length);let i=0;for(const p of parts){bytes.set(p,i);i+=p.length}
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==sha)throw Error('raster_dependency_invalid');return bytes
}
// Fixed public library/font assets only. No project data leaves this function
// for these requests. Hashes and sizes are verified before initialization.
let ready:Promise<Uint8Array>|undefined
function engine(){return ready??=Promise.all([
 pinned('https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm',2478606,'22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70'),
 pinned('https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.0/ttf/DejaVuSans.ttf',757076,'7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954'),
]).then(async([wasm,font])=>{await initWasm(wasm);return font}).catch(error=>{ready=undefined;throw error})}
export async function rasterSavedView(page:ReturnType<typeof savedSvgPage>){
  const font=await engine(),scale=1024/Math.max(page.width,page.height)
  const renderer=new Resvg(page.svg,{background:'white',fitTo:{mode:'zoom',value:scale},font:{fontBuffers:[font],defaultFontFamily:'DejaVu Sans',sansSerifFamily:'DejaVu Sans',serifFamily:'DejaVu Sans',monospaceFamily:'DejaVu Sans'}})
  try{const image=renderer.render();try{return new Uint8Array(image.asPng())}finally{image.free()}}finally{renderer.free()}
}
