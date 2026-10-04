import { parseCadAssemblyResult, type CadAssemblyRequest, type CadDrawingSource } from './cad-adapter.ts'
import type { CadPacket } from './cad-assistant.ts'
export const CAD_TRANSPORT_CONTRACT='2026-10-04-checked-construction-annotations'

/** The host and secret are deployment configuration, never model input. */
export function createCadTransport(endpoint:string|undefined,token:string|undefined,fetcher:typeof fetch=fetch){
 return async(recipe:CadAssemblyRequest,drawingSource?:CadDrawingSource):Promise<CadPacket>=>{
  if(!endpoint||!token)throw new Error('cad_not_configured')
  const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('invalid_cad_host')
  const response=await fetcher(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(drawingSource?{recipe,drawing_source:drawingSource}:recipe),signal:AbortSignal.timeout(45000)})
  if(!response.ok||!response.body)throw new Error('cad_unavailable')
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>6*1024*1024){await reader.cancel();throw new Error('cad_output_too_large')}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  const packet=JSON.parse(new TextDecoder().decode(bytes))
  const manifest=parseCadAssemblyResult(packet.manifest,recipe)
  if(!manifest||!packet.files||typeof packet.files!=='object')throw new Error('invalid_cad_result')
  if(drawingSource&&(packet.manifest.drawing_source?.artifact_id!==drawingSource.artifact_id||packet.manifest.drawing_source?.revision!==drawingSource.revision
   ||Object.keys(packet.manifest.drawing_source).sort().join(',')!=='artifact_id,revision'))throw new Error('cad_construction_source_mismatch')
  const expected=['step',...recipe.views]
  if(Object.keys(packet.files).sort().join(',')!==expected.sort().join(','))throw new Error('invalid_cad_files')
  for(const k of expected){
   const encoded=packet.files[k];if(typeof encoded!=='string'||encoded.length>4*1024*1024)throw new Error('invalid_cad_file')
   const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('')
   if(digest!==manifest.exports[k].sha256)throw new Error('cad_hash_mismatch')
  }
  if(!packet.previews || typeof packet.previews!=='object' || Object.keys(packet.previews).sort().join(',')!==[...recipe.views].sort().join(','))throw new Error('cad_previews_missing')
  const previewMetadata:Record<string,{file:string;sha256:string;source_sha256:string}>={}
  for(const view of recipe.views){
   const encoded=packet.previews[view], metadata=packet.manifest.previews?.[view]
   if(typeof encoded!=='string'||encoded.length>700000||!metadata||Object.keys(metadata).sort().join(',')!=='file,sha256,source_sha256'||metadata.file!==view+'.png'||typeof metadata.sha256!=='string'||!/^[0-9a-f]{64}$/.test(metadata.sha256)||metadata.source_sha256!==manifest.exports[view].sha256)throw new Error('invalid_cad_preview')
   const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))
   if(![137,80,78,71,13,10,26,10].every((n,i)=>raw[i]===n)||raw.length<24)throw new Error('invalid_cad_preview')
   const header=new DataView(raw.buffer),width=header.getUint32(16),height=header.getUint32(20)
   if(!width||!height||width>1024||height>1024)throw new Error('invalid_cad_preview')
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('')
   if(digest!==metadata.sha256)throw new Error('cad_preview_hash_mismatch')
   previewMetadata[view]={file:metadata.file,sha256:metadata.sha256,source_sha256:metadata.source_sha256}
  }
  // Keep checked hashes in the exact review/save commitment, while reserving
  // "previews" for pixel payloads that may never enter private request state.
  const persistedManifest:Record<string,unknown>={...manifest};delete persistedManifest.previews
  return {recipe:structuredClone(recipe),manifest:{...persistedManifest,preview_metadata:previewMetadata},files:packet.files,previews:packet.previews}
 }
}
