import { useEffect, useRef, useState } from 'react'
import * as db from '../data/database'
import type { ProjectWriteReceipt } from '../data/provenance'
import { useAsync, useProjectVersion } from './ui'
import { DrawingSourceNotice } from './DrawingSourceNotice'
import { Modal } from './Modal'
import { ZoomableImage } from './ZoomableImage'

function SavedDrawing({projectId,id,revision}:{projectId:string;id:string;revision:number}){
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[retry,setRetry]=useState(0),[open,setOpen]=useState(false),[imageFailed,setImageFailed]=useState(false)
 const version=useProjectVersion()
 useEffect(()=>{
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'200px'})
  if(ref.current)observer.observe(ref.current)
  return ()=>observer.disconnect()
 },[])
 const {data,error,loading}=useAsync(()=>visible?db.getProjectDrawingPreview(projectId,id,revision):Promise.resolve(null),[projectId,id,revision,visible,version,retry])
 useEffect(()=>setImageFailed(false),[data,retry])
 const src=data?.svg?`data:image/svg+xml;base64,${data.svg}`:null
 const historical=data?.latestRevision!==revision
 const label=data?`${data.title} · v${revision}`:`Saved drawing · v${revision}`
 return <div ref={ref} className="bob-chat-drawing">
  {error?<div role="alert"><p>Drawing preview could not be loaded.</p><button className="btn" type="button" onClick={()=>setRetry(n=>n+1)}>Retry drawing preview</button></div>
   :loading&&visible?<p role="status">Loading saved drawing…</p>:data&&<>
    <p className="foundation-hint">{label}{historical?' · historical revision':''}{data.archived?' · archived':''}</p>
    <DrawingSourceNotice source={data.sourceStatus}/>
    {src&&!imageFailed?<button type="button" className="bob-chat-image" aria-label={`Enlarge drawing: ${label}`} onClick={()=>{setRetry(n=>n+1);setOpen(true)}}><img src={src} alt={`${label} — ${data.view}`} loading="lazy" onError={()=>setImageFailed(true)}/></button>
     :<p className="foundation-hint">{data.sourceStatus.source_state==='unavailable'?'Preview withheld until source access can be checked.':'No saved image for this drawing. Open the drawing for details.'}</p>}
    <p className="foundation-hint">Concept drawing · visual approval and construction checks are separate.</p>
    {imageFailed&&<p role="alert">The saved image could not be displayed. <button className="btn" type="button" onClick={()=>setRetry(n=>n+1)}>Retry drawing preview</button></p>}
   </>}
  {open&&src&&data&&!loading&&!error&&!imageFailed&&<Modal title={label} layer={100} wide onClose={()=>setOpen(false)}><DrawingSourceNotice source={data.sourceStatus}/><ZoomableImage src={src} alt={`${label} — ${data.view}`} label="Saved drawing" fit="width"/></Modal>}
 </div>
}
/** Transcript stores exact receipts, never picture bytes or generated URL text. */
export function BobChatDrawings({projectId,receipts}:{projectId:string;receipts?:ProjectWriteReceipt[]}){
 const refs=new Map<string,ProjectWriteReceipt>()
 for(const receipt of receipts??[])if(receipt.projectId===projectId&&receipt.dataset==='artifacts'&&receipt.operation!=='deleted'&&Number.isSafeInteger(receipt.revision)&&Number(receipt.revision)>0)
  refs.set(`${receipt.recordId}:${receipt.revision}`,receipt)
 return <>{[...refs.values()].map(r=><SavedDrawing key={`${projectId}:${r.recordId}:${r.revision}`} projectId={projectId} id={r.recordId} revision={r.revision!}/>)}</>
}
