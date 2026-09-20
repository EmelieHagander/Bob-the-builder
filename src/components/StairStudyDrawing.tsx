import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { checkedStairStudy, stairGeometry, STAIR_LIMITS, type StairDetails } from '../lib/stairStudy'
import { stairStudySvg } from '../lib/stairStudySvg'
import { formatDrawingMm as f } from '../lib/storageBox'
import './StorageBoxDrawing.css'
const labels={lower:'Lower plan',upper:'Upper plan',section:'Walking section'} as const
const code=(s:string)=>s.replace(/_/g,' ')
export function StairStudyDrawing({value,title,areaId=null}:{value:StairDetails|null;title:string;areaId?:string|null}){
 const [view,setView]=useState<keyof typeof labels>('upper'),[zoom,setZoom]=useState(1)
 const result=useMemo(()=>{
  try{if(!value)throw new Error('Source plan is not available in this project.')
   const d=checkedStairStudy(value,value.project_id,value.artifact_id,value.artifact_revision)
   return {d,g:stairGeometry(d.plan.recipe,d.recipe),error:''}
  }catch(e){return {d:null,g:null,error:e instanceof Error?e.message:'Unsupported stair study.'}}
 },[value])
 if(!result.d||!result.g)return <p role="alert" className="solution-attention">Cannot display stair study: {result.error} Saved history has not been replaced.</p>
 const {d,g}=result,svg=stairStudySvg(d,view,title),name=(id:string)=>d.plan.names[id]??id
 return <section className="box-drawing" aria-label="Stair study">
  <p className="foundation-hint">Ask Bob to compare or change the stair. Plans and the walking section use the same saved recipe; no drawing form is required.</p>
  {d.sources_changed&&<p role="status" className="solution-attention">Source plan changed. This drawing retains its old source version. Review and explicitly refresh before further stair edits.</p>}
  {d.plan.physical_pending&&<p className="solution-attention">Physical proposals are pending. This study uses the pinned accepted identities only.</p>}
  <div className="foundation-actions">{(Object.keys(labels) as (keyof typeof labels)[]).map(k=><button type="button" className={`btn${k===view?' btn-primary':''}`} aria-pressed={k===view} key={k} onClick={()=>{setView(k);setZoom(1)}}>{labels[k]}</button>)}</div>
  <div className="foundation-actions box-drawing-controls">
   <button type="button" className="btn" aria-label="Zoom stair out" disabled={zoom<=1} onClick={()=>setZoom(z=>z-0.5)}>−</button><span>{Math.round(zoom*100)}%</span>
   <button type="button" className="btn" aria-label="Zoom stair in" disabled={zoom>=3} onClick={()=>setZoom(z=>z+0.5)}>+</button>
   <button type="button" className="btn" onClick={()=>setZoom(1)}>Fit stair</button>
   <button type="button" className="btn" onClick={()=>{const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download=`bob-${d.artifact_id}-r${d.artifact_revision}-stair-${view}.svg`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}}>Save stair SVG</button>
  </div>
  <div className="box-drawing-viewport" tabIndex={0} aria-label="Stair drawing viewport"><div className="box-drawing-sheet" style={{width:`${zoom*100}%`}} dangerouslySetInnerHTML={{__html:svg}}/></div>
  {view!=='section'&&<p className="foundation-hint"><strong>Room key:</strong> {d.plan.recipe.spaces.filter(s=>s.level_id===(view==='lower'?g.from.level_id:g.to.level_id)).map((s,i)=>`R${i+1}: ${name(s.space_id)}${s.bounds?'':' (location unknown)'}`).join(' · ')}</p>}
  <dl className="box-dimensions">
   <div><dt>Calculated exit · x / y · direction</dt><dd>{f(g.exit.x_mm)} / {f(g.exit.y_mm)} mm · {g.exit_heading}</dd></div>
   <div><dt>Total rise / equal risers</dt><dd>{f(g.rise_total_mm)} mm / {g.spec.risers} × {f(g.rise_mm)} mm</dd></div>
   <div><dt>Going / walking width</dt><dd>{g.going_mm} / {g.spec.width_mm} mm</dd></div>
   <div><dt>Shape</dt><dd>{g.spec.turn==='straight'?'Straight':`${code(g.spec.turn)} quarter turn with square landing`}</dd></div>
  </dl>
  <p><strong>Upper landing overlaps:</strong> {g.exit_spaces.length?g.exit_spaces.map(r=>`${name(r.space_id)} (${r.contains_area?'contains landing':'partial overlap'})`).join(', '):'No mapped room here; coverage is unknown.'}</p>
  <p className="foundation-hint">Exit marks the centre of the terminal riser. The outlined upper landing starts there; being inside a room does not establish a clear route or doorway.</p>
  <div role="status" className="fact-source" aria-label="Stair check results"><strong>{code(g.state)}</strong>
   {g.conflicts.map(c=><p key={c.code} className="solution-attention">{code(c.code)}{c.parts.length?`: ${c.parts.join(', ')}`:''}</p>)}
   {g.unknown.map(u=><p key={u}>Unknown / needs review: {code(u)}</p>)}
   <p>Headroom criterion: {g.spec.required_headroom_mm} mm. This is a study input, not a regulatory approval.</p>
  </div>
  {g.opening_suggestion&&<p className="foundation-hint">Conservative opening proposal: x/y {f(g.opening_suggestion.x_mm)} / {f(g.opening_suggestion.y_mm)} mm,
   {' '}{f(g.opening_suggestion.width_mm)} × {f(g.opening_suggestion.depth_mm)} mm. Not a minimal hole, structural design or instruction to cut.</p>}
  <details><summary>Walking-surface clearances and exact sources</summary>
   <div className="box-parts" tabIndex={0}><table><caption>Whole walking strips · flat slab / ceiling model only</caption><thead><tr><th>Part</th><th>Lowest known clearance</th><th>Complete inputs?</th></tr></thead><tbody>{g.clearance.map(c=><tr key={c.key}><th scope="row">{code(c.key)}</th><td>{c.minimum_mm===null?'Unknown':`${f(c.minimum_mm)} mm`}</td><td>{c.unknown?'No':'For this model only'}</td></tr>)}</tbody></table></div>
   <p>{g.spec.basis}: {g.spec.source}</p><p>Source plan v{d.plan_revision}. {d.plan.recipe.origin}</p>
   <Link className="btn" to={`/artifacts?drawing=${d.plan_id}&revision=${d.plan_revision}${areaId?`&area=${encodeURIComponent(areaId)}`:''}`}>Open source coordinate plan</Link>
  </details>
  <p className="solution-attention">{STAIR_LIMITS}</p>
 </section>
}
