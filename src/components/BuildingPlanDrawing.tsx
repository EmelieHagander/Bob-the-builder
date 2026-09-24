import { useMemo, useState } from 'react'
import { BUILDING_PLAN_LIMITS, buildingPlanGeometry, checkedBuildingPlan, type BuildingPlanDetails } from '../lib/buildingPlan'
import { buildingPlanSvg } from '../lib/buildingPlanSvg'
import { formatDrawingMm as f } from '../lib/storageBox'
import './StorageBoxDrawing.css'
const number=(n:number|null)=>n===null?'Unknown':`${f(n)} mm`
export function BuildingPlanDrawing({value,title,source,lineageChanged=false,participant=false}:{value:BuildingPlanDetails|null;title:string;source:string;lineageChanged?:boolean;participant?:boolean}){
 const [chosen,setChosen]=useState<string|null>(null),[zoom,setZoom]=useState(1)
 const result=useMemo(()=>{
  try{
   if(!value)throw new Error('Sources are not available in this project. The historical plan has not been replaced.')
   const d=checkedBuildingPlan(value,value.project_id,value.artifact_id,value.artifact_revision)
   return {d,g:buildingPlanGeometry(d.recipe),error:''}
  }catch(e){return {d:null,g:null,error:e instanceof Error?e.message:'Unsupported coordinate plan.'}}
 },[value])
 if(!result.d||!result.g)return <p role="alert" className="solution-attention">Cannot display coordinate plan: {result.error}</p>
 const {d,g}=result,view=chosen&&g.levels.some(l=>l.level_id===chosen)?chosen:chosen==='heights'?'heights':g.levels[0].level_id
 const svg=buildingPlanSvg(d,view,title,source,lineageChanged),level=g.levels.find(l=>l.level_id===view)
 const name=(id:string)=>d.names[id]??id
 const spaces=g.recipe.spaces.filter(s=>!level||s.level_id===level.level_id)
 return <section className="box-drawing" aria-label="Multi-floor coordinate plan">
  <p className="foundation-hint">{participant ? 'Saved coordinate study. Ask the organiser about changes or unclear dimensions.' : 'Ask Bob to update this study or compare a location between floors. You do not need to draw the views.'}</p>
  {(d.sources_changed||lineageChanged)&&<p role="status" className="solution-attention">Sources changed. These are the saved coordinates, not an automatically updated plan. {participant ? 'Ask the organiser to review these sources before use.' : 'Ask Bob to review and explicitly refresh sources.'}</p>}
  {d.physical_pending&&<p className="solution-attention">Physical proposals are pending; this study references accepted source versions only.</p>}
  <div className="foundation-actions" aria-label="Floor plan views">
   {g.levels.map(l=><button type="button" className={`btn${view===l.level_id?' btn-primary':''}`} key={l.level_id} aria-pressed={view===l.level_id} onClick={()=>{setChosen(l.level_id);setZoom(1)}}>{name(l.level_id)}</button>)}
   <button type="button" className={`btn${view==='heights'?' btn-primary':''}`} aria-pressed={view==='heights'} onClick={()=>{setChosen('heights');setZoom(1)}}>Height comparison</button>
  </div>
  <div className="foundation-actions box-drawing-controls">
   <button type="button" className="btn" aria-label="Zoom coordinate plan out" disabled={zoom<=1} onClick={()=>setZoom(z=>z-0.5)}>−</button>
   <span aria-live="polite">{Math.round(zoom*100)}%</span>
   <button type="button" className="btn" aria-label="Zoom coordinate plan in" disabled={zoom>=3} onClick={()=>setZoom(z=>z+0.5)}>+</button>
   <button type="button" className="btn" onClick={()=>setZoom(1)}>Fit plan</button>
   <button type="button" className="btn" onClick={()=>{
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),a=document.createElement('a')
    a.href=url;a.download=`bob-${d.artifact_id}-r${d.artifact_revision}-${view}.svg`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)
   }}>Save coordinate SVG</button>
  </div>
  <div className="box-drawing-viewport" tabIndex={0} aria-label="Coordinate plan viewport">
   <div className="box-drawing-sheet" style={{width:`${zoom*100}%`}} dangerouslySetInnerHTML={{__html:svg}}/>
  </div>
  {level&&<dl className="box-dimensions">
   <div><dt>Outside · east–west × north–south</dt><dd>{f(level.bounds.width_mm)} × {f(level.bounds.depth_mm)} mm</dd></div>
   <div><dt>Inside envelope · before partitions</dt><dd>{f(level.inside.width_mm)} × {f(level.inside.depth_mm)} mm</dd></div>
   <div><dt>Finished-floor height · common datum</dt><dd>{number(level.floor_z_mm)}</dd></div>
   <div><dt>Slab below finished floor</dt><dd>{number(level.slab_mm)}</dd></div>
  </dl>}
  <div className="box-parts" tabIndex={0} aria-label="Room coordinates">
   <table><caption>Room / zone footprints · not walls</caption><thead><tr><th scope="col">Room</th><th scope="col">x / y (mm)</th><th scope="col">W × D (mm)</th><th scope="col">Basis</th></tr></thead>
    <tbody>{spaces.map((s,i)=><tr key={s.space_id}><th scope="row">{level?`R${i+1} · `:''}{name(s.space_id)}</th><td>{s.bounds?`${f(s.bounds.x_mm)} / ${f(s.bounds.y_mm)}`:'Not positioned'}</td><td>{s.bounds?`${f(s.bounds.width_mm)} × ${f(s.bounds.depth_mm)}`:'Unknown'}</td><td>{s.basis==='estimated'?'Estimated':'Supplied specification'}</td></tr>)}</tbody>
   </table>
  </div>
  {g.probes.map((p,i)=><div className="fact-source" key={p.key} aria-label={`Projection ${p.key}`}>
   <strong>P{i+1} · {p.label}</strong><p>{name(p.from_level_id)} → {name(p.to_level_id)} · same x/y {f(p.bounds.x_mm)} / {f(p.bounds.y_mm)} mm</p>
   <p>Target mapped footprints: {p.to_spaces.length?p.to_spaces.map(h=>`${name(h.space_id)} (${h.contains_study_area?'contains study area':'partial overlap'})`).join(', '):'No mapped footprint here — physical coverage is unknown.'}</p>
   <p>Floor-height difference: {number(p.floor_delta_mm)}. Lower floor to upper slab underside: {number(p.lower_floor_to_upper_slab_mm)}.</p>
   {(!p.within_from_outline||!p.within_to_outline)&&<p className="solution-attention">Study area crosses the inside envelope on at least one floor.</p>}
   <p className="foundation-hint">This locates a projected area, not a staircase exit or headroom clearance.</p>
  </div>)}
  {g.conflicts.length>0&&<div role="status" className="solution-attention"><strong>Coordinate conflicts to review</strong>{g.conflicts.slice(0,24).map((c,i)=><p key={i}>{c.kind.replace(/_/g,' ')}: {c.ids.map(name).join(', ')}</p>)}{g.conflicts.length>24&&<p>{g.conflicts.length} conflicts in total. Showing the first 24; review the coordinates before proceeding.</p>}</div>}
  <details><summary>Shared datum and source versions</summary><p>{g.recipe.origin}</p><p>Building: {name(d.building_id)} · v{g.recipe.building_revision}. {source}</p>
   {g.recipe.levels.map(l=><p key={l.level_id}>{name(l.level_id)} · v{l.level_revision} · {l.basis}: {l.source}</p>)}
   {g.recipe.spaces.map(s=><p key={s.space_id}>{name(s.space_id)} · v{s.space_revision} · {s.basis}: {s.source}</p>)}
  </details>
  <p className="solution-attention">{BUILDING_PLAN_LIMITS}</p>
 </section>
}
