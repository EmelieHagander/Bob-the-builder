import { useEffect, useRef, useState } from 'react'
import * as db from '../data/database'
import type { ProjectWriteReceipt, ProjectSource } from '../data/provenance'
import { useAsync, useProjectVersion } from './ui'
import { DrawingSourceNotice } from './DrawingSourceNotice'
import { Modal } from './Modal'
import { ZoomableImage } from './ZoomableImage'
import { SolutionConcept } from './SolutionConcept'
import { conceptSvg } from '../../supabase/functions/_shared/solution-concept'

function usePreviewVisibility(){
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false)
 useEffect(()=>{
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return}
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'200px'})
  if(ref.current)observer.observe(ref.current)
  return ()=>observer.disconnect()
 },[])
 return {ref,visible}
}
function SavedConcept({projectId,id,revision,view:requestedView}:{projectId:string;id:string;revision:number;view?:string}){
 const {ref,visible}=usePreviewVisibility(),[retry,setRetry]=useState(0),[open,setOpen]=useState(false),[imageFailed,setImageFailed]=useState(false)
 const version=useProjectVersion()
 const {data,error,loading}=useAsync(()=>visible?db.getSolutionChatPreview(projectId,id,revision):Promise.resolve(null),[projectId,id,revision,requestedView,visible,version,retry])
 useEffect(()=>setImageFailed(false),[data,retry])
 const current=data?.projectId===projectId&&data.id===id&&data.revision===revision?data:null
 const intent=current?.intent,view=requestedView?intent?.model?.views.find(v=>v.id===requestedView):intent?.model?.views[0]
 const label=current?`${current.title} · v${revision}`:`Saved concept · v${revision}`
 const src=intent&&view?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(conceptSvg(intent,view.id))}`:null
 return <div ref={ref} className="bob-chat-drawing">
  {error?<div role="alert"><p>Saved concept could not be loaded.</p><button className="btn" type="button" onClick={()=>setRetry(n=>n+1)}>Retry concept preview</button></div>
   :loading&&visible?<p role="status">Loading saved concept…</p>:current&&<>
    <p className="foundation-hint">{label}{current.latestRevision!==revision?' · historical revision':''}{current.archived||current.currentlyArchived?' · archived':''}</p>
    {src&&!imageFailed?<button type="button" className="bob-chat-image" aria-label={`Enlarge concept: ${label}`} onClick={()=>{setRetry(n=>n+1);setOpen(true)}}><img src={src} alt={`${label} — ${view!.label}`} loading="lazy" onError={()=>setImageFailed(true)}/></button>
     :<p role="status">The saved concept could not be displayed. The original version is retained. <button className="btn" type="button" onClick={()=>setRetry(n=>n+1)}>Retry concept preview</button></p>}
    {intent?.model&&<p className="foundation-hint">{intent.model.views.map(v=>v.label).join(' · ')}. Open to inspect all views.</p>}
    <p className="foundation-hint">Concept · design values and estimates, not measured or approved for construction.</p>
   </>}
  {open&&current&&intent&&src&&!loading&&!error&&!imageFailed&&<Modal title={label} layer={100} wide onClose={()=>setOpen(false)}>
   {current.latestRevision!==revision&&<p className="solution-attention">Historical revision. The current solution is v{current.latestRevision}.</p>}
   {(current.archived||current.currentlyArchived)&&<p className="solution-attention">This solution is archived.</p>}
   <SolutionConcept intent={intent} revision={revision} projectId={projectId} solutionId={id} contextActive={false} areaId={null} readOnly initialView={requestedView}/>
  </Modal>}
 </div>
}
function SavedDrawing({projectId,id,revision,view:requestedView}:{projectId:string;id:string;revision:number;view?:string}){
 const {ref,visible}=usePreviewVisibility(),[retry,setRetry]=useState(0),[open,setOpen]=useState(false),[imageFailed,setImageFailed]=useState(false)
 const version=useProjectVersion()
 const {data,error,loading}=useAsync(()=>visible?db.getProjectDrawingPreview(projectId,id,revision,requestedView):Promise.resolve(null),[projectId,id,revision,requestedView,visible,version,retry])
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
export function BobChatDrawings({projectId,receipts,sources}:{projectId:string;receipts?:ProjectWriteReceipt[];sources?:ProjectSource[]}){
 const [expanded, setExpanded] = useState(false)
 const shown = new Map<string, ProjectSource>()
 for (const source of sources ?? []) {
   if (source.projectId === projectId && source.visual) shown.set(source.visual.ref, source)
 }
 const views = [...shown.values()].map(source => {
   const visual = source.visual!
   const Preview = visual.kind === 'concept' ? SavedConcept : SavedDrawing
   return <Preview key={visual.ref} projectId={projectId} id={source.recordId} revision={visual.revision} view={visual.view} />
 })
 const shownVersions = new Set([...shown.values()].map(s => `${s.visual!.kind}:${s.recordId}:${s.visual!.revision}`))
 const saved = new Map<string, ProjectWriteReceipt>()
 for (const r of receipts ?? []) {
   if (r.projectId !== projectId || r.operation === 'deleted' || !r.revision) continue
   if (r.dataset !== 'solutions' && r.dataset !== 'artifacts') continue
   const key = `${r.dataset === 'solutions' ? 'concept' : 'cad'}:${r.recordId}:${r.revision}`
   if (!shownVersions.has(key)) saved.set(key,r)
 }
 // An explicit presentation pins the view, even if a later revision was saved.
 // With receipts alone, each distinct document can contribute its latest view.
 // A construction receipt has no drawing preview and must not bury a separate drawing.
 const primary = views.slice(0, 1), secondary = views.slice(1)
 const latest = new Map<string,number>()
 for (const r of saved.values()) {
   const id = r.dataset + ':' + r.recordId
   latest.set(id, Math.max(latest.get(id) ?? 0, r.revision!))
 }
 for (const [key,r] of saved) {
   const Preview = r.dataset === 'solutions' ? SavedConcept : SavedDrawing
   const preview = <Preview key={key} projectId={projectId} id={r.recordId} revision={r.revision!} />
   const document = r.dataset + ':' + r.recordId
   if (views.length || r.revision !== latest.get(document)) secondary.push(preview)
   else primary.push(preview)
 }
 if (!primary.length) return null
 return <>{primary}{secondary.length > 0 && <details className="chat-earlier-results" onToggle={e => setExpanded(e.currentTarget.open)}>
   <summary>Other views and versions · {secondary.length}</summary>{expanded && secondary}
 </details>}</>
}
