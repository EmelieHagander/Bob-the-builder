import { stairGeometry, STAIR_LIMITS, type StairDetails } from './stairStudy.ts'
import { insideEnvelope, rectContains, rectIntersection, type PlanRect } from './buildingPlan.ts'
const f=(n:number)=>String(Number(n.toFixed(3)))
const xml=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
export function stairStudySvg(d:StairDetails,view:'lower'|'upper'|'section',title:string):string {
 if(!['lower','upper','section'].includes(view))throw new Error('Unsupported stair view')
 const g=stairGeometry(d.plan.recipe,d.recipe),s=g.spec
 const text=(x:number,y:number,v:unknown,more='')=>`<text x="${f(x)}" y="${f(y)}" ${more}>${xml(v)}</text>`
 const line=(x1:number,y1:number,x2:number,y2:number,more='')=>`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#222" ${more}/>`
 let image=''
 if(view!=='section'){
  const level=view==='lower'?g.from:g.to
  const bounds=[...d.plan.recipe.levels.map(l=>l.bounds),...g.surfaces.map(t=>t.bounds),...(s.opening?[s.opening]:[])]
  const minX=Math.min(...bounds.map(r=>r.x_mm)),minY=Math.min(...bounds.map(r=>r.y_mm))
  const maxX=Math.max(...bounds.map(r=>r.x_mm+r.width_mm)),maxY=Math.max(...bounds.map(r=>r.y_mm+r.depth_mm))
  const scale=Math.min(780/(maxX-minX),420/(maxY-minY)),ox=90+(780-(maxX-minX)*scale)/2,oy=160+(420-(maxY-minY)*scale)/2
  const x=(n:number)=>ox+(n-minX)*scale,y=(n:number)=>oy+(maxY-n)*scale
  const rect=(r:PlanRect,fill='none',more='')=>`<rect x="${f(x(r.x_mm))}" y="${f(y(r.y_mm+r.depth_mm))}" width="${f(r.width_mm*scale)}" height="${f(r.depth_mm*scale)}" fill="${fill}" stroke="#222" ${more}/>`
  image+=rect(level.bounds,'#ddd')+rect(insideEnvelope(level),'white')
  d.plan.recipe.spaces.filter(r=>r.level_id===level.level_id).forEach((room,i)=>{
   if(room.bounds){image+=rect(room.bounds,'none','stroke-dasharray="7 4"')
    image+=text(x(room.bounds.x_mm+150),y(room.bounds.y_mm+room.bounds.depth_mm-250),`R${i+1}`,'font-weight="bold"')}
  })
  g.surfaces.forEach(t=>{
   image+=rect(t.bounds,t.kind==='tread'?'#f3f3f3':t.kind==='turn_landing'?'#ddd':'none',t.kind==='approach'||t.kind==='exit_landing'?'stroke-dasharray="3 3"':'')
   if(t.kind==='turn_landing')image+=text(x(t.bounds.x_mm+t.bounds.width_mm/2),y(t.bounds.y_mm+t.bounds.depth_mm/2),'L','text-anchor="middle" font-weight="bold"')
  })
  if(s.opening)image+=rect(s.opening,'none','stroke-width="3" stroke-dasharray="10 5"')
  const mark=(p:{x_mm:number;y_mm:number},label:string)=>`<circle cx="${f(x(p.x_mm))}" cy="${f(y(p.y_mm))}" r="4" fill="#222"/>`+text(x(p.x_mm)+9,y(p.y_mm)-12,label,'font-size="15" font-weight="bold"')
  image+=mark(g.start,'START')+mark(g.exit,'EXIT')
  const dir=({north:[0,1],south:[0,-1],east:[1,0],west:[-1,0]} as const)[g.exit_heading as StairDetails['recipe']['heading']]
  image+=line(x(g.exit.x_mm),y(g.exit.y_mm),x(g.exit.x_mm+dir[0]*500),y(g.exit.y_mm+dir[1]*500),'stroke-width="3"')
  image+=text(25,169,'N ↑','font-weight="bold"')+text(25,196,'E →','font-weight="bold"')
  image+=text(30,624,'L = square turning landing · Dashed R outlines = room footprints, NOT walls/doors','font-size="14"')
  image+=text(30,646,'Heavy dash = proposed floor opening · Dotted rectangles = approach and upper landing','font-size="14"')
 }else{
  const zMin=g.from.floor_z_mm!,zMax=Math.max(g.to.floor_z_mm!+700,g.upper_ceiling_z_mm??0)
  const pathMin=-s.landing_depth_mm,pathMax=g.path_length_mm+s.landing_depth_mm
  const sx=780/(pathMax-pathMin),sy=420/(zMax-zMin)
  const x=(n:number)=>90+(n-pathMin)*sx,y=(n:number)=>590-(n-zMin)*sy
  if(g.upper_ceiling_z_mm!==null)image+=line(90,y(g.upper_ceiling_z_mm),870,y(g.upper_ceiling_z_mm),'stroke-width="2"')
  g.surfaces.forEach((t,i)=>{
   const start=x(t.path_start_mm),end=x(t.path_end_mm),z=y(t.z_mm)
   image+=line(start,z,end,z,'stroke-width="2"')
   if(i)image+=line(start,y(g.surfaces[i-1].z_mm),start,z,'stroke-width="2"')
   const open=s.opening&&rectContains(s.opening,t.bounds)
   const partial=s.opening&&rectIntersection(s.opening,t.bounds)&&!open
   if(t.kind!=='exit_landing'&&!open&&g.slab_underside_z_mm!==null){
    image+=`<rect x="${f(start)}" y="${f(y(g.to.floor_z_mm!))}" width="${f(end-start)}" height="${f((g.to.floor_z_mm!-g.slab_underside_z_mm)*sy)}" fill="#ddd" stroke="#555" ${partial?'stroke-dasharray="2 2"':''}/>`
   }
  })
  image+=text(90,140,`Rise ${f(g.rise_total_mm)} mm · ${s.risers} equal rises × ${f(g.rise_mm)} mm`,'font-size="16"')
  image+=text(90,616,'START','font-size="14"')+text(830,616,'EXIT','text-anchor="end" font-size="14"')
  image+=text(30,644,'Developed walking section: turns unfolded. Horizontal and vertical scales differ.','font-size="14"')
 }
 const subtitle=view==='section'?'Developed walking section':`${view==='lower'?'Lower':'Upper'} plan · ${d.plan.names[(view==='lower'?g.from:g.to).level_id]}`
 return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="810" viewBox="0 0 960 810" role="img" aria-label="${xml(subtitle)}"><title>${xml(title)} · ${xml(subtitle)}</title><desc>${xml(STAIR_LIMITS)}</desc><rect width="960" height="810" fill="white"/><g fill="#222" font-family="Arial,sans-serif" font-size="17">
 ${text(30,35,title.slice(0,65),'font-size="23" font-weight="bold"')}${text(30,65,`${subtitle.slice(0,65)} · v${d.artifact_revision}`)}
 ${text(30,95,d.sources_changed?'SOURCES CHANGED · saved study retained':`CONCEPT · ${g.state.replace(/_/g,' ')}${g.contains_estimates?' · contains estimates':''}`,'font-size="15" font-weight="bold"')}
 ${image}${text(30,674,`Width ${s.width_mm} mm · Going ${s.going_mm} mm · Exit x/y ${f(g.exit.x_mm)} / ${f(g.exit.y_mm)} mm → ${g.exit_heading}`,'font-size="15"')}
 ${text(30,702,`Requested headroom ${s.required_headroom_mm} mm · ${g.conflicts.length} conflicts · ${g.unknown.length} unknown inputs/checks`,'font-size="15"')}
 ${text(30,730,'No global fit/safety approval · Read written dimensions · NOT TO SCALE','font-size="14"')}
 ${text(30,754,`Source plan ${d.plan_id} · v${d.plan_revision}`,'font-size="12"')}
 ${text(30,779,`${d.artifact_id} · stair_study_v1 / 1`,'font-size="12"')}</g></svg>`
}
