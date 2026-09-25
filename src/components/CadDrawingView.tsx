import type { CadDrawing } from '../data/artifacts'
import { cadParts, cadCutListCsv } from '../data/cadParts'

/** SVG is an image document, never injected into the page's DOM. */
export function CadDrawingView({value,title}:{value:Pick<CadDrawing,'files'|'recipe'|'source_changed'> & Partial<Pick<CadDrawing,'manifest'>>;title:string}){
 const names:Record<string,string>={front:'Front',right:'Right',top:'Top',isometric:'Overview'}
 const checks=value.manifest?.checks
 return <section aria-label={`${title} CAD drawings`}>
  <p className="foundation-hint">Concept · dimensions in mm. Site fit and construction checks remain as stated in the drawing assumptions.</p>
  {value.source_changed&&<p role="alert" className="solution-attention">The source construction has changed. This detail still shows its recorded revision.</p>}
  {Object.entries(names).filter(([key])=>value.files[key]).map(([key,label])=><figure key={key} style={{margin:'12px 0'}}>
   <img alt={`${title} — ${label}`} src={`data:image/svg+xml;base64,${value.files[key]}`} style={{width:'100%',maxHeight:480,objectFit:'contain',background:'white',border:'1px solid var(--line)'}} />
   <figcaption><a download={`${key}.svg`} href={`data:image/svg+xml;base64,${value.files[key]}`}>{label} · download drawing</a></figcaption>
  </figure>)}
  {value.files.step&&<a className="btn" download="assembly.step" href={`data:application/step;base64,${value.files.step}`}>Download 3D model</a>}
  <details><summary>Parts and dimensions</summary>
   <p>Blank sizes before holes and notches. Check grain, joints and saw allowance before cutting.</p>
   <a download="cut-list.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(cadCutListCsv(value.recipe))}`}>Download cut list</a>
   <div style={{overflowX:'auto'}}><table><thead><tr><th>Part</th><th>Quantity</th><th>Blank dimensions (mm)</th><th>Cuts</th></tr></thead><tbody>
   {cadParts(value.recipe).map(d=><tr key={d.id}><td>{d.id}</td><td>{d.quantity}</td><td>{d.dimensions}</td><td>{d.cuts}</td></tr>)}
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
