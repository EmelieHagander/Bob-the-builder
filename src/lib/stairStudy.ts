import { buildingPlanRecipe, buildingPlanGeometry, checkedBuildingPlan, insideEnvelope, planRect, planUm,
  rectContains, rectIntersection, UUID, type BuildingPlanDetails, type BuildingPlanRecipe, type PlanRect } from './buildingPlan.ts'
import { exactObject } from './roomLayout.ts'

/** Walking-surface geometry, not fabricated stringers or a building approval.
 * A versioned specification contains no duplicate floor heights/room geometry.
 * Start is the CENTRE of the first riser, looking uphill. +x east, +y north.
 */
export interface StairSpec {
  generator: 'stair_study_v1'; version: 1
  from_level_id: string; to_level_id: string
  start_x_mm: number; start_y_mm: number
  heading: 'north' | 'east' | 'south' | 'west'
  turn: 'straight' | 'left' | 'right'
  risers: number; first_flight_risers: number | null
  width_mm: number; going_mm: number; landing_depth_mm: number
  opening: PlanRect | null
  required_headroom_mm: number
  upper_ceiling_above_floor_mm: number | null
  basis: 'estimated' | 'provided_spec'; source: string
}
export interface StairDetails {
  project_id: string; artifact_id: string; artifact_revision: number; building_id: string
  plan_id: string; plan_revision: number; recipe: StairSpec
  sources_changed: boolean; plan: BuildingPlanDetails
}
export const STAIR_KEYS = ['generator','version','from_level_id','to_level_id','start_x_mm','start_y_mm','heading','turn',
  'risers','first_flight_risers','width_mm','going_mm','landing_depth_mm','opening','required_headroom_mm','upper_ceiling_above_floor_mm','basis','source']
export const STAIR_LIMITS = 'Concept stair study: straight or quarter-turn with a square level landing, NOT curved/winder/spiral stairs. Walking surfaces only. Checks cover modelled envelopes, a rectangular proposed floor opening and flat ceilings. No doors, beams, roof slopes, walls/obstacles, routes, stringers, rails, structure, fire/child safety or building approval. Written dimensions govern; not to scale.'
export function stairSpec(v: unknown): StairSpec {
  if (!exactObject(v, STAIR_KEYS) || v.generator !== 'stair_study_v1' || v.version !== 1) throw new Error('Unsupported stair specification.')
  const uid = (n: unknown) => { if (typeof n !== 'string' || !UUID.test(n)) throw new Error('Use exact floor identities.'); return n.toLowerCase() }
  const integer = (n: unknown, lo: number, hi: number) => { if (!Number.isSafeInteger(n) || Number(n)<lo || Number(n)>hi) throw new Error('Use whole millimetres/counts within the supported stair range.'); return Number(n) }
  const from = uid(v.from_level_id), to = uid(v.to_level_id)
  if (from === to || !['north','east','south','west'].includes(String(v.heading)) || !['straight','left','right'].includes(String(v.turn))) throw new Error('Choose distinct floors and a supported stair direction.')
  const risers = integer(v.risers,3,60)
  const first = v.turn === 'straight' ? null : integer(v.first_flight_risers,2,risers-2)
  if (v.turn==='straight' && v.first_flight_risers!==null) throw new Error('Straight stairs have no intermediate landing.')
  if (!['estimated','provided_spec'].includes(String(v.basis)) || typeof v.source!=='string' || !v.source.trim() || v.source.length>500) throw new Error('Identify the specification source/assumptions; never label it as measured.')
  return { generator:'stair_study_v1',version:1,from_level_id:from,to_level_id:to,
    start_x_mm:planUm(v.start_x_mm)/1000,start_y_mm:planUm(v.start_y_mm)/1000,
    heading:v.heading as StairSpec['heading'],turn:v.turn as StairSpec['turn'],risers,first_flight_risers:first,
    width_mm:integer(v.width_mm,100,3000),going_mm:integer(v.going_mm,50,1000),landing_depth_mm:integer(v.landing_depth_mm,100,3000),
    opening:v.opening===null?null:planRect(v.opening),required_headroom_mm:integer(v.required_headroom_mm,1000,4000),
    upper_ceiling_above_floor_mm:v.upper_ceiling_above_floor_mm===null?null:integer(v.upper_ceiling_above_floor_mm,100,10000),
    basis:v.basis as StairSpec['basis'],source:v.source }
}
export interface StairSurface { key: string; bounds: PlanRect; z_mm: number; path_start_mm: number; path_end_mm: number; kind: 'tread'|'turn_landing'|'approach'|'exit_landing' }
type Point = { x_mm:number; y_mm:number }
const add = (a:number,b:number) => (Math.round(a*1000)+Math.round(b*1000))/1000
/** Axis-aligned exact union bounding rectangle. It is a conservative opening
 * proposal, NOT a minimal hole or authorization to remove a slab. */
export function rectUnion(rects: PlanRect[]): PlanRect | null {
  if (!rects.length) return null
  const x=Math.min(...rects.map(r=>r.x_mm)),y=Math.min(...rects.map(r=>r.y_mm))
  return {x_mm:x,y_mm:y,width_mm:add(Math.max(...rects.map(r=>add(r.x_mm,r.width_mm))),-x),depth_mm:add(Math.max(...rects.map(r=>add(r.y_mm,r.depth_mm))),-y)}
}
export function stairGeometry(planValue: unknown, specValue: unknown) {
  const plan=buildingPlanRecipe(planValue), spec=stairSpec(specValue)
  const from=plan.levels.find(l=>l.level_id===spec.from_level_id),to=plan.levels.find(l=>l.level_id===spec.to_level_id)
  if (!from || !to) throw new Error('Both stair floors must belong to the exact source plan.')
  if (from.floor_z_mm===null || to.floor_z_mm===null) throw new Error('Floor elevations are unknown. Supply both heights from the same datum before calculating a stair.')
  const riseTotal=add(to.floor_z_mm,-from.floor_z_mm)
  if (riseTotal<=0 || riseTotal>10000) throw new Error('Stairs must rise to a higher floor within 10000 mm.')
  if (plan.levels.some(l=>l.level_id!==from.level_id && l.level_id!==to.level_id && (l.floor_z_mm===null || l.floor_z_mm>from.floor_z_mm! && l.floor_z_mm<to.floor_z_mm!))) throw new Error('An intermediate or unlocated floor must be resolved before studying this stair.')
  const h=riseTotal/spec.risers,w=spec.width_mm,g=spec.going_mm,L=spec.landing_depth_mm
  const rot=({north:0,east:1,south:2,west:3} as const)[spec.heading]
  const point=(x:number,y:number):Point => {
    const [dx,dy]=[[x,y],[y,-x],[-x,-y],[-y,x]][rot]
    return {x_mm:add(spec.start_x_mm,dx),y_mm:add(spec.start_y_mm,dy)}
  }
  const rect=(x:number,y:number,width:number,depth:number):PlanRect=>{
    const pts=[point(x,y),point(x+width,y),point(x,y+depth),point(x+width,y+depth)]
    const minx=Math.min(...pts.map(p=>p.x_mm)),miny=Math.min(...pts.map(p=>p.y_mm))
    return {x_mm:minx,y_mm:miny,width_mm:add(Math.max(...pts.map(p=>p.x_mm)),-minx),depth_mm:add(Math.max(...pts.map(p=>p.y_mm)),-miny)}
  }
  const surfaces:StairSurface[]=[]
  const push=(key:string,bounds:PlanRect,z:number,start:number,end:number,kind:StairSurface['kind'])=>surfaces.push({key,bounds,z_mm:z,path_start_mm:start,path_end_mm:end,kind})
  push('approach',rect(-w/2,-L,w,L),from.floor_z_mm,-L,0,'approach')
  let endX=0,endY=0,path=0,outHeading=rot
  const first=spec.first_flight_risers??spec.risers
  for(let i=1;i<first;i++) push(`step_${i}`,rect(-w/2,(i-1)*g,w,g),from.floor_z_mm+i*h,(i-1)*g,i*g,'tread')
  const run1=(first-1)*g
  if(spec.turn==='straight'){endY=run1;path=run1}
  else {
    push('turn_landing',rect(-w/2,run1,w,w),from.floor_z_mm+first*h,run1,run1+w,'turn_landing')
    const sign=spec.turn==='right'?1:-1,second=spec.risers-first
    for(let i=1;i<second;i++){
      const x=sign===1?w/2+(i-1)*g:-w/2-i*g
      push(`step_${first+i}`,rect(x,run1,g,w),from.floor_z_mm+(first+i)*h,run1+w+(i-1)*g,run1+w+i*g,'tread')
    }
    endX=sign*(w/2+(second-1)*g);endY=run1+w/2;path=run1+w+(second-1)*g
    outHeading=(rot+(sign===1?1:3))%4
  }
  const exitBounds=spec.turn==='straight'?rect(-w/2,endY,w,L):spec.turn==='right'?rect(endX,endY-w/2,L,w):rect(endX-L,endY-w/2,L,w)
  push('exit_landing',exitBounds,to.floor_z_mm,path,path+L,'exit_landing')
  const conflicts:{code:string;parts:string[]}[]=[], unknown:string[]=[]
  const lowerSurfaces=surfaces.filter(s=>s.kind!=='exit_landing')
  const insideFrom=insideEnvelope(from),insideTo=insideEnvelope(to)
  const outsideLower=lowerSurfaces.filter(s=>!rectContains(insideFrom,s.bounds))
  if(outsideLower.length)conflicts.push({code:'outside_lower_envelope',parts:outsideLower.map(s=>s.key)})
  if(!rectContains(insideTo,exitBounds))conflicts.push({code:'exit_landing_outside_upper_envelope',parts:['exit_landing']})
  if(spec.opening && !rectContains(insideTo,spec.opening))conflicts.push({code:'opening_outside_upper_envelope',parts:[]})
  if(spec.opening && rectIntersection(spec.opening,exitBounds))conflicts.push({code:'exit_landing_over_floor_void',parts:['exit_landing']})
  const slabUnder=to.slab_mm===null?null:add(to.floor_z_mm,-to.slab_mm)
  const ceiling=spec.upper_ceiling_above_floor_mm===null?null:add(to.floor_z_mm,spec.upper_ceiling_above_floor_mm)
  if(slabUnder===null)unknown.push('upper_slab_thickness')
  if(ceiling===null)unknown.push('upper_ceiling')
  if(!spec.opening)unknown.push('floor_opening')
  // A cell is an entire walking strip, not a point sample. Partly covered treads
  // must also meet the slab clearance outside the opening. No holes between samples.
  const clearance=surfaces.map(s=>{
    if(s.kind==='exit_landing')return {key:s.key,minimum_mm:ceiling===null?null:ceiling-s.z_mm,unknown:ceiling===null}
    const covered=spec.opening?rectContains(spec.opening,s.bounds):false
    const intersects=spec.opening?!!rectIntersection(spec.opening,s.bounds):false
    const values:number[]=[];let uncertain=false
    if(!covered){if(slabUnder===null)uncertain=true;else values.push(slabUnder-s.z_mm)}
    if(intersects){if(ceiling===null)uncertain=true;else values.push(ceiling-s.z_mm)}
    return {key:s.key,minimum_mm:values.length?Math.min(...values):null,unknown:uncertain||!spec.opening}
  })
  const low=clearance.filter(c=>c.minimum_mm!==null && c.minimum_mm+1e-7<spec.required_headroom_mm)
  if(low.length)conflicts.push({code:spec.opening?'modelled_headroom_below_requested':'opening_needed_for_headroom',parts:low.map(c=>c.key)})
  const needsOpening=slabUnder===null?null:lowerSurfaces.filter(s=>slabUnder-s.z_mm+1e-7<spec.required_headroom_mm)
  const openingSuggestion=needsOpening===null?null:rectUnion(needsOpening.map(s=>s.bounds))
  const hits=(levelId:string,bounds:PlanRect)=>plan.spaces.filter(s=>s.level_id===levelId && s.bounds && rectIntersection(s.bounds,bounds)).map(s=>({space_id:s.space_id,contains_area:rectContains(s.bounds!,bounds)}))
  const exitHits=hits(to.level_id,exitBounds), approachHits=hits(from.level_id,surfaces[0].bounds)
  if(!exitHits.some(s=>s.contains_area))unknown.push('exit_landing_room_coverage')
  if(!approachHits.some(s=>s.contains_area))unknown.push('approach_room_coverage')
  const planConflicts=buildingPlanGeometry(plan).conflicts
  if(planConflicts.length)unknown.push('source_plan_coordinate_conflicts')
  // Doors, walls, services and sloping ceilings are not present in multifloor_v1.
  // Never emit an overall safe/fit flag even when the bounded checks pass.
  const state=conflicts.length?'conflict':unknown.length?'incomplete':'modelled_checks_only'
  return {spec,from,to,rise_total_mm:riseTotal,rise_mm:h,going_mm:g,tread_count:surfaces.filter(s=>s.kind==='tread').length,
    pitch_degrees:Math.atan2(h,g)*180/Math.PI,step_formula_mm:2*h+g,
    start:point(0,0),exit:point(endX,endY),exit_heading:['north','east','south','west'][outHeading],
    surfaces,exit_landing:exitBounds,approach:surfaces[0].bounds,footprint:rectUnion(lowerSurfaces.filter(s=>s.kind!=='approach').map(s=>s.bounds))!,
    path_length_mm:path,slab_underside_z_mm:slabUnder,upper_ceiling_z_mm:ceiling,
    clearance,opening_suggestion:openingSuggestion,exit_spaces:exitHits,approach_spaces:approachHits,
    conflicts,unknown,state,source_conflicts:planConflicts.length,
    contains_estimates:spec.basis==='estimated'||[from,to,...plan.spaces].some(s=>s.basis==='estimated'),limits:STAIR_LIMITS}
}
export function checkedStairStudy(value:unknown,project:string,id:string,revision:number):StairDetails {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Stair study unavailable.')
  const d=value as StairDetails
  if(d.project_id!==project||d.artifact_id!==id||d.artifact_revision!==revision||typeof d.sources_changed!=='boolean'
    ||!UUID.test(d.plan_id)||!Number.isSafeInteger(d.plan_revision)||d.plan_revision<1)throw new Error('Stair source identity mismatch.')
  const plan=checkedBuildingPlan(d.plan,project,d.plan_id,d.plan_revision),recipe=stairSpec(d.recipe)
  if(d.building_id!==plan.building_id)throw new Error('Stair Building mismatch.')
  stairGeometry(plan.recipe,recipe)
  return {...d,plan,recipe}
}
export function stairSummary(plan:BuildingPlanRecipe,spec:StairSpec){
  const g=stairGeometry(plan,spec)
  return {rise_total_mm:g.rise_total_mm,rise_mm:g.rise_mm,risers:g.spec.risers,tread_count:g.tread_count,going_mm:g.going_mm,
    step_formula_mm:g.step_formula_mm,pitch_degrees:g.pitch_degrees,start:g.start,exit:g.exit,exit_heading:g.exit_heading,
    footprint:g.footprint,walking_length_mm:g.path_length_mm,
    headroom:{criterion_mm:g.spec.required_headroom_mm,minimum_known_mm:g.clearance.some(c=>c.minimum_mm!==null)?Math.min(...g.clearance.flatMap(c=>c.minimum_mm===null?[]:[c.minimum_mm])):null,unknown_surfaces:g.clearance.filter(c=>c.unknown).length},
    exit_landing:g.exit_landing,exit_spaces:g.exit_spaces,opening_suggestion:g.opening_suggestion,
    state:g.state,conflicts:g.conflicts,unknown:g.unknown,contains_estimates:g.contains_estimates,limits:STAIR_LIMITS}
}
export function withDerivedStair<T extends Record<string,unknown>>(r:T,project:string):T & Record<string,unknown>{
  if(!r.stair_study)return r.has_stair_study?{...r,drawing_error:'Stair source unavailable. Do not reconstruct from memory.'}:r
  const d=checkedStairStudy(r.stair_study,project,String(r.id),Number(r.revision))
  return {...r,derived_stair:{...stairSummary(d.plan.recipe,d.recipe),sources_changed:d.sources_changed}}
}
