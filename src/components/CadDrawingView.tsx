import type { CadDrawing } from '../data/artifacts'

/** SVG is an image document, never injected into the page's DOM. */
export function CadDrawingView({value,title}:{value:CadDrawing;title:string}){
 const names:Record<string,string>={front:'Front',right:'Right',top:'Top',isometric:'Overview'}
 return <section aria-label={`${title} CAD drawings`}>
  <p className="foundation-hint">Concept · dimensions in mm. Site fit and construction checks remain as stated in the drawing assumptions.</p>
  {value.source_changed&&<p role="alert" className="solution-attention">The source construction has changed. This detail still shows its recorded revision.</p>}
  {Object.entries(names).filter(([key])=>value.files[key]).map(([key,label])=><figure key={key} style={{margin:'12px 0'}}>
   <img alt={`${title} — ${label}`} src={`data:image/svg+xml;base64,${value.files[key]}`} style={{width:'100%',maxHeight:480,objectFit:'contain',background:'white',border:'1px solid var(--line)'}} />
   <figcaption><a download={`${key}.svg`} href={`data:image/svg+xml;base64,${value.files[key]}`}>{label} · download drawing</a></figcaption>
  </figure>)}
  {value.files.step&&<a className="btn" download="assembly.step" href={`data:application/step;base64,${value.files.step}`}>Download 3D model</a>}
  <details><summary>Parts and dimensions</summary><div style={{overflowX:'auto'}}><table><thead><tr><th>Part</th><th>Dimensions (mm)</th></tr></thead><tbody>
   {(value.recipe.definitions??[]).map((d:any)=><tr key={d.id}><td>{d.id}</td><td>{d.primitive==='box'?`${d.x_mm} × ${d.y_mm} × ${d.z_mm}`:`Ø ${d.outside_diameter_mm} × ${d.length_mm}; wall ${d.wall_thickness_mm}`}</td></tr>)}
  </tbody></table></div></details>
 </section>
}
