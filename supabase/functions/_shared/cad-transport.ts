import { cadPreviewKeys, parseCadAssemblyResult, parseCadFastenerSchedule, type CadAssemblyRequest, type CadDrawingSource, type CadFastenerSchedule } from './cad-adapter.ts'
import type { CadPacket } from './cad-assistant.ts'
/** Plain loop: Uint8Array.from with a mapper costs ~100 ms per MB of CPU. */
function decodeBase64(encoded:string):Uint8Array<ArrayBuffer>{const text=atob(encoded),raw=new Uint8Array(text.length);for(let i=0;i<text.length;i++)raw[i]=text.charCodeAt(i);return raw}
export const CAD_TRANSPORT_CONTRACT='2026-10-17-paged-construction-annotations'
const sha256Hex=async(raw:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('')
/** Exact export set and bytes of a rendering. A resumed save restores candidate
 * files from their journal step through this same check. */
export async function verifyCadFiles(files:Record<string,unknown>,views:readonly string[],exports:Record<string,any>):Promise<void>{
 const expected=['step',...views]
 if(Object.keys(files).sort().join(',')!==expected.sort().join(','))throw new Error('invalid_cad_files')
 for(const k of expected){
  const encoded=files[k];if(typeof encoded!=='string'||encoded.length>4*1024*1024)throw new Error('invalid_cad_file')
  if(await sha256Hex(decodeBase64(encoded))!==exports?.[k]?.sha256)throw new Error('cad_hash_mismatch')
 }
}

type RpcCall=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>
/** The fastener schedule of exactly the pinned construction revision, read as
 * the caller through bob.read_construction_fasteners (fixed rules of thumb,
 * not a strength calculation). A drawing never shows another revision's. */
export async function readConstructionFasteners(call:RpcCall,projectId:string,source:CadDrawingSource):Promise<CadFastenerSchedule>{
 const {data,error}=await call('read_construction_fasteners',{p_project:projectId,p_artifact:source.artifact_id,p_revision:source.revision})
 if(error)throw new Error(error.code==='42501'?'project_denied':'construction_fasteners_unavailable')
 const row=data as Record<string,unknown>|null
 if(!row||row.status!=='ok'||row.project_id!==projectId||String(row.artifact_id).toLowerCase()!==source.artifact_id.toLowerCase()||row.revision!==source.revision)
  throw new Error('construction_fasteners_unavailable')
 const {status:_status,project_id:_project,artifact_id:_artifact,revision:_revision,...schedule}=row
 const parsed=parseCadFastenerSchedule(schedule)
 if(!parsed)throw new Error('construction_fasteners_unavailable')
 return parsed
}

/** The host and secret are deployment configuration, never model input. A
 * fastener schedule travels only with its construction source and must come
 * back drawn as annotations version 2; without one the worker answers version 1. */
export function createCadTransport(endpoint:string|undefined,token:string|undefined,fetcher:typeof fetch=fetch){
 return async(recipe:CadAssemblyRequest,drawingSource?:CadDrawingSource,fasteners?:CadFastenerSchedule):Promise<CadPacket>=>{
  if(!endpoint||!token)throw new Error('cad_not_configured')
  if(fasteners&&!drawingSource)throw new Error('cad_fasteners_without_source')
  const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('invalid_cad_host')
  const body=drawingSource?{recipe,drawing_source:drawingSource,...(fasteners?{fasteners}:{})}:recipe
  const response=await fetcher(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)})
  if(!response.ok||!response.body)throw new Error('cad_unavailable')
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>6*1024*1024){await reader.cancel();throw new Error('cad_output_too_large')}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  const packet=JSON.parse(new TextDecoder().decode(bytes))
  const manifest=parseCadAssemblyResult(packet.manifest,recipe,fasteners??null)
  if(!manifest||!packet.files||typeof packet.files!=='object')throw new Error('invalid_cad_result')
  if(drawingSource&&(packet.manifest.drawing_source?.artifact_id!==drawingSource.artifact_id||packet.manifest.drawing_source?.revision!==drawingSource.revision
   ||Object.keys(packet.manifest.drawing_source).sort().join(',')!=='artifact_id,revision'))throw new Error('cad_construction_source_mismatch')
  await verifyCadFiles(packet.files,recipe.views,manifest.exports)
  const previewKeys=cadPreviewKeys(recipe)
  if(!packet.previews || typeof packet.previews!=='object' || Object.keys(packet.previews).sort().join(',')!==[...previewKeys].sort().join(',')
    ||!packet.manifest.previews||Object.keys(packet.manifest.previews).sort().join(',')!==[...previewKeys].sort().join(','))throw new Error('cad_previews_missing')
  const previewMetadata:Record<string,{file:string;sha256:string;source_sha256:string}>={}
  for(const view of previewKeys){
   const sourceView=view.split('.')[0]
   const encoded=packet.previews[view], metadata=packet.manifest.previews?.[view]
   if(typeof encoded!=='string'||encoded.length>700000||!metadata||Object.keys(metadata).sort().join(',')!=='file,sha256,source_sha256'||metadata.file!==view+'.png'||typeof metadata.sha256!=='string'||!/^[0-9a-f]{64}$/.test(metadata.sha256)||metadata.source_sha256!==manifest.exports[sourceView].sha256)throw new Error('invalid_cad_preview')
   const raw=decodeBase64(encoded)
   if(![137,80,78,71,13,10,26,10].every((n,i)=>raw[i]===n)||raw.length<24)throw new Error('invalid_cad_preview')
   const header=new DataView(raw.buffer),width=header.getUint32(16),height=header.getUint32(20)
   if(!width||!height||width>1024||height>1024)throw new Error('invalid_cad_preview')
   if(await sha256Hex(raw)!==metadata.sha256)throw new Error('cad_preview_hash_mismatch')
   previewMetadata[view]={file:metadata.file,sha256:metadata.sha256,source_sha256:metadata.source_sha256}
  }
  // Keep checked hashes in the exact review/save commitment, while reserving
  // "previews" for pixel payloads that may never enter private request state.
  const persistedManifest:Record<string,unknown>={...manifest};delete persistedManifest.previews
  return {recipe:structuredClone(recipe),manifest:{...persistedManifest,preview_metadata:previewMetadata},files:packet.files,previews:packet.previews}
 }
}
