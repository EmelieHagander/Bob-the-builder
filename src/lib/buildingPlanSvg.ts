import { buildingPlanGeometry, type BuildingPlanDetails, type PlanRect } from './buildingPlan.ts'
const xml=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
const f=(v:number)=>String(Number(v.toFixed(3)))
/** Controlled deterministic vectors; provider/user markup is never rendered. */
export function buildingPlanSvg(d:BuildingPlanDetails,view:string,title:string,source='',lineageChanged=false):string{
 const g=buildingPlanGeometry(d.recipe),l=g.levels.find(l=>l.level_id===view)
 if(!l&&view!=='heights')throw new Error('Unknown coordinate-plan view.')
 const text=(x:number,y:number,t:unknown,more='')=>`<text x="${f(x)}" y="${f(y)}" ${more}>${xml(t)}</text>`
 let image='',subtitle='Height comparison · not a building section'
 const shapes=[...g.levels.map(l=>l.bounds),...g.recipe.spaces.flatMap(s=>s.bounds?[s.bounds]:[]),...g.probes.map(p=>p.bounds)]
 const minX=Math.min(...shapes.map(r=>r.x_mm)),maxX=Math.max(...shapes.map(r=>r.x_mm+r.width_mm))
 if(l){
  subtitle=d.names[l.level_id]
  const minY=Math.min(...shapes.map(r=>r.y_mm)),maxY=Math.max(...shapes.map(r=>r.y_mm+r.depth_mm))
  const scale=Math.min(740/(maxX-minX),410/(maxY-minY)),ox=110+(740-(maxX-minX)*scale)/2,oy=180+(410-(maxY-minY)*scale)/2
  const x=(n:number)=>ox+(n-minX)*scale,y=(n:number)=>oy+(maxY-n)*scale
  const rect=(r:PlanRect,fill:string,extra='')=>`<rect x="${f(x(r.x_mm))}" y="${f(y(r.y_mm+r.depth_mm))}" width="${f(r.width_mm*scale)}" height="${f(r.depth_mm*scale)}" fill="${fill}" stroke="#222" stroke-width="1.5" ${extra}/>`
  image=rect(l.bounds,'#ddd')+rect(l.inside,'#fff')
  const dim=(a:number,b:number,yy:number,label:string)=>`<path d="M${f(a)},${f(yy-5)}v10 M${f(a)},${f(yy)}H${f(b)} M${f(b)},${f(yy-5)}v10" stroke="#222" fill="none"/>${text((a+b)/2,yy-9,label,'text-anchor="middle" font-size="15"')}`
  image+=dim(x(l.bounds.x_mm),x(l.bounds.x_mm+l.bounds.width_mm),oy-32,`Outside E–W ${f(l.bounds.width_mm)} mm`)
  image+=dim(x(l.inside.x_mm),x(l.inside.x_mm+l.inside.width_mm),oy+(maxY-minY)*scale+34,`Inside E–W ${f(l.inside.width_mm)} mm`)
  image+=text(28,183,`N ↑`,'font-weight="bold"')+text(28,210,'E →','font-weight="bold"')
  const spaces=g.recipe.spaces.filter(s=>s.level_id===l.level_id)
  spaces.forEach((s,i)=>{
   if(!s.bounds)return
   image+=rect(s.bounds,'none','stroke-dasharray="7 4"')
   const cx=x(s.bounds.x_mm+s.bounds.width_mm/2),cy=y(s.bounds.y_mm+s.bounds.depth_mm/2)
   image+=text(cx,cy,`R${i+1}`,'text-anchor="middle" font-weight="bold"')
  })
  g.probes.filter(p=>p.from_level_id===l.level_id||p.to_level_id===l.level_id).forEach(p=>{
   image+=rect(p.bounds,'#eee','stroke-dasharray="3 3"')
   image+=`<path d="M${f(x(p.bounds.x_mm))},${f(y(p.bounds.y_mm))}L${f(x(p.bounds.x_mm+p.bounds.width_mm))},${f(y(p.bounds.y_mm+p.bounds.depth_mm))}" stroke="#222"/>`
   image+=text(x(p.bounds.x_mm+p.bounds.width_mm/2),y(p.bounds.y_mm+p.bounds.depth_mm/2),`P${g.probes.findIndex(q=>q.key===p.key)+1}`,'text-anchor="middle" font-weight="bold"')
  })
  image+=text(30,668,`Outside N–S ${f(l.bounds.depth_mm)} mm · inside ${f(l.inside.depth_mm)} mm · wall ${f(l.wall_mm)} mm`,'font-size="15"')
  image+=text(30,692,`Finished floor z: ${l.floor_z_mm===null?'UNKNOWN':f(l.floor_z_mm)+' mm'} · slab below: ${l.slab_mm===null?'UNKNOWN':f(l.slab_mm)+' mm'}`,'font-size="15"')
 }else{
  const known=g.levels.filter(l=>l.floor_z_mm!==null)
  if(!known.length)image=text(60,300,'Floor elevations are unknown. No vertical geometry inferred.')
  else{
   const zMin=Math.min(...known.map(l=>l.floor_z_mm!-(l.slab_mm??0)))-100,zMax=Math.max(...known.map(l=>l.floor_z_mm!))+300
   const sc=Math.min(700/(maxX-minX),400/(zMax-zMin)),x=(v:number)=>130+(v-minX)*sc,y=(v:number)=>590-(v-zMin)*sc
   known.forEach(l=>{
    image+=`<line x1="${f(x(l.bounds.x_mm))}" x2="${f(x(l.bounds.x_mm+l.bounds.width_mm))}" y1="${f(y(l.floor_z_mm!))}" y2="${f(y(l.floor_z_mm!))}" stroke="#222" stroke-width="2"/>`
    if(l.slab_mm!==null)image+=`<rect x="${f(x(l.bounds.x_mm))}" y="${f(y(l.floor_z_mm!))}" width="${f(l.bounds.width_mm*sc)}" height="${f(l.slab_mm*sc)}" fill="#ddd" stroke="#555"/>`
    image+=text(x(l.bounds.x_mm),y(l.floor_z_mm!)-13,`${d.names[l.level_id].slice(0,32)} · z ${f(l.floor_z_mm!)} mm`,'font-size="16"')
   })
  }
  image+=text(30,668,'No roof, beams or stair travel are modelled. This diagram does NOT check headroom.','font-size="15"')
  image+=text(30,692,`${g.levels.filter(l=>l.floor_z_mm===null).length} level(s) have unknown floor height and are not positioned vertically.`,'font-size="15"')
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="810" viewBox="0 0 960 810" role="img" aria-label="${xml(subtitle+' · shared coordinate study')}"><title>${xml(title)} · ${xml(subtitle)}</title><desc>${xml(g.limits)}</desc><rect width="960" height="810" fill="white"/><g fill="#222" font-family="Arial,sans-serif" font-size="17">
 ${text(30,34,title.slice(0,65),'font-size="23" font-weight="bold"')}${text(30,63,`${subtitle.slice(0,60)} · revision ${d.artifact_revision}`)}
 ${text(30,92,d.sources_changed||lineageChanged?'SOURCES CHANGED — saved coordinates retained':'CONCEPT · coordinate study · '+(g.contains_estimates?'contains estimates':'supplied design inputs'),'font-size="15" font-weight="bold"')}
 ${text(30,119,source.slice(0,110),'font-size="12"')}${image}
 ${text(30,720,'Dashed R outlines are room/zone footprints, not walls or doors. P areas are projections, not stair designs.','font-size="13"')}
 ${text(30,746,'All coordinates in mm · East +x / North +y / Up +z · SAME DATUM · NOT TO SCALE','font-size="14"')}
 ${text(30,774,`${d.artifact_id} · multifloor_v1 / 1`,'font-size="12"')}</g></svg>`
}
