import type { CadDrawing } from '../data/artifacts'
import { cadParts, cadCutListCsv, cadPartMarkers } from '../data/cadParts'
import type { DrawingSourceStatus } from '../data/drawingSources'
import { CadSourceMap } from './CadSourceMap'
import { lazy, Suspense, useCallback, useState } from 'react'
import './StorageBoxDrawing.css'
import { useAsync } from './ui'
import { drawingGeometryUrl } from '../lib/guideDrawing'
import { ZoomableImage } from './ZoomableImage'
import { CadBuildGuide, type BuildGuideNotes, type GuidePageLoader } from './CadBuildGuide'
import * as db from '../data/database'
const WireframeView = lazy(() => import('./CadWireframeView').catch(() => ({ default: WireframeUnavailable })))
function WireframeUnavailable({onFallback}:{onFallback:(message:string)=>void}) {
 return <div role="alert"><p>The 3D viewer could not be loaded. Check the connection and try again.</p><button type="button" className="btn" onClick={()=>onFallback('')}>Show saved drawing</button></div>
}

const viewNames: Record<string, string> = {
 isometric: 'Overview', isometric_front_left: 'Overview front-left', isometric_back_left: 'Overview back-left',
 isometric_back_right: 'Overview back-right', front: 'Front', back: 'Back', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom',
}

function CadSheet({ encoded, label, title, file }: { encoded: string; label: string; title: string; file: string }) {
 const [annotated, setAnnotated] = useState(false)
 const { data, loading } = useAsync(async () => ({ encoded, url: await drawingGeometryUrl(encoded) }), [encoded])
 const geometry = data?.encoded === encoded ? data.url : null
 const original = 'data:image/svg+xml;base64,' + encoded
 return <figure className="cad-sheet">
  <figcaption className="foundation-actions"><strong>{label}</strong>
   {geometry && <label className="foundation-check"><input type="checkbox" checked={annotated} onChange={event => setAnnotated(event.target.checked)} />Dimensions &amp; part numbers</label>}
   <a download={file} href={original}>Download drawing</a>
  </figcaption>
  {loading ? <p role="status">Loading drawing…</p> :
   <ZoomableImage key={annotated ? 'sheet' : 'shape'} src={geometry && !annotated ? geometry : original} alt={`${title} — ${label}`} label={label} fit={geometry && !annotated ? 'contain' : 'width'} />}
 </figure>
}

function DrawingViews({ files, title }: { files: CadDrawing['files']; title: string }) {
 const [selected, setSelected] = useState('')
 const views = Object.entries(viewNames).filter(([key]) => files[key])
 const current = views.find(([key]) => key === selected) ?? views[0]
 if (!current) return null
 const [key, label] = current
 return <>
  {views.length > 1 && <label className="cad-view-select">View <select value={key} onChange={event => setSelected(event.target.value)}>
   {views.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select></label>}
  <CadSheet key={key} encoded={files[key]} label={label} title={title} file={key + '.svg'} />
 </>
}

/** SVG is an image document, never injected into the page's DOM. */
export function CadDrawingView({value,title,projectId,artifactId,revision,sourceStatus,loadGuidePages}:{value:Pick<CadDrawing,'files'|'recipe'|'source_changed'> & Partial<Pick<CadDrawing,'manifest'>> & {build_guide?:Record<string,any>|null};title:string;projectId?:string;artifactId?:string;revision?:number;sourceStatus?:DrawingSourceStatus;/** Volunteers pass their own scoped reader; members read through project RLS. */loadGuidePages?:GuidePageLoader}){
 const [interactive,setInteractive]=useState(false),[notice,setNotice]=useState('')
 const memberPages=useCallback<GuidePageLoader>((guideId,keys)=>db.getCadGuidePages(projectId!,guideId,keys),[projectId])
 const fallback=useCallback((message:string)=>{setInteractive(false);setNotice(message)},[])
 const checks=value.manifest?.checks,markers=cadPartMarkers(value.manifest)
 if(sourceStatus?.source_state==='unavailable')return <section aria-label={`${title} CAD drawings`}>
  <p className="solution-attention">Current-use drawing preview is withheld until source access and freshness can be checked. This saved revision remains part of the project history.</p>
  <CadSourceMap recipe={value.recipe} manifest={value.manifest} projectId={projectId} sourceStatus={sourceStatus} />
 </section>
 return <section aria-label={`${title} CAD drawings`}>
  {value.manifest?.bob_form_checkpoint
   ?<p className="solution-attention">Partial drawing · dimensions in mm. Part of the build is not drawn yet.</p>
   :<p className="foundation-hint">Concept · dimensions in mm. Site fit and construction checks remain as stated in the drawing assumptions.</p>}
  {value.source_changed&&<p role="alert" className="solution-attention">The source construction has changed. This detail still shows its recorded revision.</p>}
  <CadSourceMap recipe={value.recipe} manifest={value.manifest} projectId={projectId} sourceStatus={sourceStatus} />
  {projectId&&artifactId&&revision&&<div className="foundation-actions">
   <button type="button" className="btn" aria-pressed={interactive} onClick={()=>{setNotice('');setInteractive(v=>!v)}}>{interactive?'Close 3D view':'View in 3D'}</button>
  </div>}
  {notice&&<p role="status" className="foundation-hint">{notice}</p>}
  {interactive&&projectId&&artifactId&&revision&&<Suspense fallback={<p role="status">Loading the 3D viewer…</p>}>
   <WireframeView projectId={projectId} artifactId={artifactId} revision={revision} title={title} onFallback={fallback}/>
  </Suspense>}
  <DrawingViews key={`${projectId}:${artifactId}:${revision}`} files={value.files} title={title} />
  <CadBuildGuide guide={(value.manifest?.build_guide??value.build_guide) as BuildGuideNotes|null|undefined} files={value.files} title={title} sourceChanged={value.source_changed} loadPages={loadGuidePages??(projectId?memberPages:undefined)} projectId={loadGuidePages?undefined:projectId} />
  {value.files.step&&<a className="btn" download="assembly.step" href={`data:application/step;base64,${value.files.step}`}>Download 3D model</a>}
  <details><summary>Parts and sizes</summary>
   <p>Sizes are before notches and holes, with nothing added for saw cuts. Check grain and joints before cutting.</p>
   <a download="cut-list.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(cadCutListCsv(value.recipe))}`}>Download cut list</a>
   <div className="box-parts"><table><thead><tr>{markers.size>0&&<th scope="col">On drawing</th>}<th scope="col">Part</th><th scope="col">Quantity</th><th scope="col">Size</th><th scope="col">Notches or holes</th></tr></thead><tbody>
   {cadParts(value.recipe).map(d=><tr key={d.id}>{markers.size>0&&<td>{markers.get(d.id)??'—'}</td>}<th scope="row">{d.name}</th><td>{d.quantity}</td><td>{d.size}</td><td>{d.cuts||'None'}</td></tr>)}
  </tbody></table></div></details>
  <details><summary>Geometry checks</summary>
   {!checks?<p>No collision or clearance check was recorded for this version.</p>:<>
    <p>Overlap check: {checks.collisions?.status==='complete'?'complete':'partial'}. {checks.collisions?.overlaps?.length??0} overlaps found. An overlap may be an intended joint; review it before building.</p>
    {(checks.collisions?.overlaps??[]).map((c:any,i:number)=><p key={i}>{c.first_id} / {c.second_id}: {Number(c.volume_mm3).toFixed(1)} mm³ overlap</p>)}
    {(checks.clearances??[]).map((c:any)=><p key={c.id}>{c.id}: {Number(c.distance_mm).toFixed(2)} mm; required {c.min_mm} mm — {c.status==='clear'?'clear':'insufficient'}</p>)}
    {(checks.motions??[]).map((c:any)=><p key={c.id}>{c.id}: {c.status==='clear_envelope'?'travel envelope clear':'possible obstruction — inspect travel'}.</p>)}
    <p>Travel checks cover the specified straight movement and obstacles. They use a conservative bounding envelope. These checks do not verify load capacity or conditions on site.</p>
   </>}
  </details>
 </section>
}
