import { parseCadAssemblyResult, type CadAssemblyRequest } from './cad-adapter.ts'
import type { CadPacket } from './cad-assistant.ts'

/** The host and secret are deployment configuration, never model input. */
export function createCadTransport(endpoint:string|undefined,token:string|undefined,fetcher:typeof fetch=fetch){
 return async(recipe:CadAssemblyRequest):Promise<CadPacket>=>{
  if(!endpoint||!token)throw new Error('cad_not_configured')
  const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('invalid_cad_host')
  const response=await fetcher(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(recipe),signal:AbortSignal.timeout(45000)})
  if(!response.ok||!response.body)throw new Error('cad_unavailable')
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>6*1024*1024){await reader.cancel();throw new Error('cad_output_too_large')}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  const packet=JSON.parse(new TextDecoder().decode(bytes))
  const manifest=parseCadAssemblyResult(packet.manifest,recipe)
  if(!manifest||!packet.files||typeof packet.files!=='object')throw new Error('invalid_cad_result')
  const expected=['step',...recipe.views]
  if(Object.keys(packet.files).sort().join(',')!==expected.sort().join(','))throw new Error('invalid_cad_files')
  for(const k of expected){
   const encoded=packet.files[k];if(typeof encoded!=='string'||encoded.length>4*1024*1024)throw new Error('invalid_cad_file')
   const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('')
   if(digest!==manifest.exports[k].sha256)throw new Error('cad_hash_mismatch')
  }
  return {recipe:structuredClone(recipe),manifest,files:packet.files}
 }
}
