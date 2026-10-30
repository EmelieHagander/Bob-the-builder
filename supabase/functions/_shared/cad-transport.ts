import { cadPreviewKeys, parseCadAssemblyResult, type CadAssemblyRequest, type CadDrawingSource } from './cad-adapter.ts'
import type { CadPacket } from './cad-assistant.ts'
/** Plain loop: Uint8Array.from with a mapper costs ~100 ms per MB of CPU. */
function decodeBase64(encoded:string):Uint8Array<ArrayBuffer>{const text=atob(encoded),raw=new Uint8Array(text.length);for(let i=0;i<text.length;i++)raw[i]=text.charCodeAt(i);return raw}
export const CAD_TRANSPORT_CONTRACT='2026-10-17-paged-construction-annotations'
const sha256Hex=async(raw:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('')
/** Exact export set and bytes of a rendering, plus any build-guide pages its
 * notes list. A resumed save restores candidate files from their journal step
 * through this same check. */
export async function verifyCadFiles(files:Record<string,unknown>,views:readonly string[],exports:Record<string,any>,buildGuide?:{status?:string;pages?:{key:string;sha256:string}[]}|null):Promise<void>{
 const pages=buildGuide?.status==='generated'&&Array.isArray(buildGuide.pages)?buildGuide.pages:[]
 const expected=['step',...views]
 if(Object.keys(files).sort().join(',')!==[...expected,...pages.map(p=>p.key)].sort().join(','))throw new Error('invalid_cad_files')
 for(const k of expected){
  const encoded=files[k];if(typeof encoded!=='string'||encoded.length>4*1024*1024)throw new Error('invalid_cad_file')
  if(await sha256Hex(decodeBase64(encoded))!==exports?.[k]?.sha256)throw new Error('cad_hash_mismatch')
 }
 for(const page of pages){
  const encoded=files[page.key];if(!/^guide-[0-9]{1,2}$/.test(page.key)||typeof encoded!=='string'||encoded.length>1400*1024)throw new Error('invalid_cad_file')
  if(await sha256Hex(decodeBase64(encoded))!==page.sha256)throw new Error('cad_hash_mismatch')
 }
}

export type CadGuideRequest={recipe:CadAssemblyRequest;drawing_source:CadDrawingSource;joints:unknown[];steps:{joint_ids:string[]}[];fasteners:unknown|null;context_ids:string[]}
export type CadGuideResult={notes:{version:1;basis:'proposed_order';pages:{key:string;sha256:string;kind:string;[k:string]:unknown}[]};files:Record<string,string>}

/** Build-guide pages for one exact construction revision (2026-10-30). Same host
 * and secret as drawings; its own route, so /render and its contract stay unchanged. */
export function createCadGuideTransport(endpoint:string|undefined,token:string|undefined,fetcher:typeof fetch=fetch){
 return async(request:CadGuideRequest):Promise<CadGuideResult>=>{
  if(!endpoint||!token)throw new Error('cad_not_configured')
  const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('invalid_cad_host')
  url.pathname='/guide'
  const response=await fetcher(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(45000)})
  if(!response.ok||!response.body)throw new Error('cad_guide_unavailable')
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>6*1024*1024){await reader.cancel();throw new Error('cad_guide_too_large')}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  const packet=JSON.parse(new TextDecoder().decode(bytes))
  const guide=packet?.guide,files=packet?.files
  if(!guide||typeof guide!=='object'||guide.version!==1||guide.basis!=='proposed_order'||!Array.isArray(guide.pages)||!guide.pages.length||guide.pages.length>60
   ||!files||typeof files!=='object'||Array.isArray(files))throw new Error('invalid_cad_guide')
  const source=guide.drawing_source
  if(!source||Object.keys(source).sort().join(',')!=='artifact_id,revision'||source.artifact_id!==request.drawing_source.artifact_id||source.revision!==request.drawing_source.revision)throw new Error('cad_construction_source_mismatch')
  const keys=guide.pages.map((p:any)=>p?.key)
  if(new Set(keys).size!==keys.length||Object.keys(files).sort().join(',')!==[...keys].sort().join(','))throw new Error('invalid_cad_guide')
  for(const page of guide.pages){
   if(typeof page.key!=='string'||!/^guide-[0-9]{1,2}$/.test(page.key)||typeof page.sha256!=='string'||!/^[0-9a-f]{64}$/.test(page.sha256)||typeof page.kind!=='string')throw new Error('invalid_cad_guide')
   const encoded=files[page.key];if(typeof encoded!=='string'||encoded.length>1400*1024)throw new Error('invalid_cad_guide')
   const raw=decodeBase64(encoded)
   if(new TextDecoder().decode(raw.slice(0,4))!=='<svg'||await sha256Hex(raw)!==page.sha256)throw new Error('cad_guide_hash_mismatch')
  }
  const notes={...guide};delete notes.drawing_source
  return {notes,files}
 }
}

/** The host and secret are deployment configuration, never model input. A
 * drawing is sent recipe + source only; it carries no fasteners (owner
 * decision 2026-10-26), so the result must be annotations version 1. */
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
