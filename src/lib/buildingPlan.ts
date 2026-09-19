/** One versioned coordinate study, projected into several 2D views. No scene/AI pixels.
 * Canonical Building/Level/Space identities remain the physical model. Numeric inputs
 * are explicit design specifications/estimates, never an implicit as-built update.
 */
export type PlanBasis = 'provided_spec' | 'estimated'
export interface PlanRect { x_mm: number; y_mm: number; width_mm: number; depth_mm: number }
export interface PlanLevel {
  level_id: string; level_revision: number; bounds: PlanRect; wall_mm: number
  floor_z_mm: number | null; slab_mm: number | null; basis: PlanBasis; source: string
}
export interface PlanSpace {
  space_id: string; space_revision: number; level_id: string; bounds: PlanRect | null; basis: PlanBasis; source: string
}
export interface PlanProbe { key: string; label: string; from_level_id: string; to_level_id: string; bounds: PlanRect }
export interface BuildingPlanRecipe {
  generator: 'multifloor_v1'; version: 1; building_id: string; building_revision: number
  frame: 'east_north_up'; origin: string; levels: PlanLevel[]; spaces: PlanSpace[]; probes: PlanProbe[]
}
export interface BuildingPlanDetails {
  project_id: string; artifact_id: string; artifact_revision: number; building_id: string
  recipe: BuildingPlanRecipe; names: Record<string, string>; sources_changed: boolean; physical_pending: boolean
}
export const BUILDING_PLAN_LIMITS = 'Coordinate study, not a surveyed as-built plan or construction approval. Rectangular envelopes and room/zone footprints only; unplaced rooms remain unknown. A probe is a projected study area, NOT a designed staircase or an approved floor opening. Doors, circulation, beams, roofs, headroom along a stair, services and structure are not checked.'
export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(v, k))) throw new Error('Unexpected coordinate-plan fields.')
}
const uid = (v: unknown) => { if (typeof v !== 'string' || !UUID.test(v)) throw new Error('Invalid physical identity.'); return v.toLowerCase() }
const rev = (v: unknown) => { if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > 2147483647) throw new Error('Invalid source revision.'); return Number(v) }
const text = (v: unknown, max: number) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('A bounded source/label is required.'); return v }
const basis = (v: unknown): PlanBasis => { if (v !== 'provided_spec' && v !== 'estimated') throw new Error('Do not label design geometry as measured.'); return v }
/** Exact integer micrometres for accepted values. Coordinates can be negative; sizes cannot. */
export function planUm(v: unknown, min = -100000, max = 100000): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || !/^-?\d+(?:\.\d{1,3})?$/.test(String(v))) throw new Error('Use bounded millimetres with at most three decimals; unknown is null, not zero.')
  return Math.round(v * 1000)
}
export function planRect(v: unknown): PlanRect {
  exact(v, ['x_mm','y_mm','width_mm','depth_mm'])
  return { x_mm: planUm(v.x_mm)/1000, y_mm: planUm(v.y_mm)/1000,
    width_mm: planUm(v.width_mm,0.001,50000)/1000, depth_mm: planUm(v.depth_mm,0.001,50000)/1000 }
}
export function buildingPlanRecipe(v: unknown): BuildingPlanRecipe {
  exact(v, ['generator','version','building_id','building_revision','frame','origin','levels','spaces','probes'])
  if (v.generator !== 'multifloor_v1' || v.version !== 1 || v.frame !== 'east_north_up') throw new Error('Unsupported plan generator/frame/version.')
  if (!Array.isArray(v.levels) || v.levels.length < 2 || v.levels.length > 6
    || !Array.isArray(v.spaces) || v.spaces.length > 32 || !Array.isArray(v.probes) || v.probes.length > 4) throw new Error('Use 2–6 levels, at most 32 spaces and 4 study areas.')
  const levels = v.levels.map(l => {
    exact(l, ['level_id','level_revision','bounds','wall_mm','floor_z_mm','slab_mm','basis','source'])
    const bounds = planRect(l.bounds), wall = planUm(l.wall_mm,0,2000)
    if (2*wall >= planUm(bounds.width_mm) || 2*wall >= planUm(bounds.depth_mm)) throw new Error('Exterior walls leave no inside floor area.')
    return { level_id: uid(l.level_id), level_revision: rev(l.level_revision), bounds, wall_mm: wall/1000,
      floor_z_mm: l.floor_z_mm === null ? null : planUm(l.floor_z_mm)/1000,
      slab_mm: l.slab_mm === null ? null : planUm(l.slab_mm,0,2000)/1000, basis: basis(l.basis), source: text(l.source,500) }
  })
  const levelIds = new Set(levels.map(l => l.level_id))
  if (levelIds.size !== levels.length) throw new Error('A physical level appears twice.')
  const elevations = levels.filter(l => l.floor_z_mm !== null).map(l => l.floor_z_mm)
  if (new Set(elevations).size !== elevations.length) throw new Error('Distinct levels cannot have identical known floor heights.')
  const spaces = v.spaces.map(s => {
    exact(s, ['space_id','space_revision','level_id','bounds','basis','source'])
    if (!levelIds.has(uid(s.level_id))) throw new Error('Space level must be included in the plan.')
    return { space_id: uid(s.space_id), space_revision: rev(s.space_revision), level_id: uid(s.level_id),
      bounds: s.bounds === null ? null : planRect(s.bounds), basis: basis(s.basis), source: text(s.source,500) }
  })
  if (new Set(spaces.map(s => s.space_id)).size !== spaces.length) throw new Error('A physical space appears twice.')
  const probes = v.probes.map(p => {
    exact(p, ['key','label','from_level_id','to_level_id','bounds'])
    if (typeof p.key !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(p.key)) throw new Error('Invalid study-area key.')
    const from = uid(p.from_level_id), to = uid(p.to_level_id)
    if (from === to || !levelIds.has(from) || !levelIds.has(to)) throw new Error('Study areas must reference two different included levels.')
    return { key: p.key, label: text(p.label,80), from_level_id: from, to_level_id: to, bounds: planRect(p.bounds) }
  })
  if (new Set(probes.map(p => p.key)).size !== probes.length) throw new Error('Duplicate study-area key.')
  return { generator: 'multifloor_v1', version: 1, building_id: uid(v.building_id), building_revision: rev(v.building_revision),
    frame: 'east_north_up', origin: text(v.origin,500), levels, spaces, probes }
}
const um = (v: number) => Math.round(v * 1000)
export function insideEnvelope(l: PlanLevel): PlanRect {
  const t = um(l.wall_mm)
  return { x_mm: (um(l.bounds.x_mm)+t)/1000, y_mm: (um(l.bounds.y_mm)+t)/1000,
    width_mm: (um(l.bounds.width_mm)-2*t)/1000, depth_mm: (um(l.bounds.depth_mm)-2*t)/1000 }
}
export function rectContains(a: PlanRect, b: PlanRect): boolean {
  return um(a.x_mm) <= um(b.x_mm) && um(a.y_mm) <= um(b.y_mm)
    && um(a.x_mm)+um(a.width_mm) >= um(b.x_mm)+um(b.width_mm)
    && um(a.y_mm)+um(a.depth_mm) >= um(b.y_mm)+um(b.depth_mm)
}
export function rectIntersection(a: PlanRect, b: PlanRect): PlanRect | null {
  const x = Math.max(um(a.x_mm),um(b.x_mm)), y = Math.max(um(a.y_mm),um(b.y_mm))
  const w = Math.min(um(a.x_mm)+um(a.width_mm),um(b.x_mm)+um(b.width_mm))-x
  const d = Math.min(um(a.y_mm)+um(a.depth_mm),um(b.y_mm)+um(b.depth_mm))-y
  return w > 0 && d > 0 ? { x_mm:x/1000,y_mm:y/1000,width_mm:w/1000,depth_mm:d/1000 } : null
}
export function buildingPlanGeometry(value: unknown) {
  const recipe = buildingPlanRecipe(value)
  const levels = recipe.levels.map(l => ({ ...l, inside: insideEnvelope(l) }))
  const conflicts: { kind: string; ids: string[] }[] = []
  for (const s of recipe.spaces) {
    if (s.bounds && !rectContains(levels.find(l => l.level_id === s.level_id)!.inside,s.bounds)) conflicts.push({kind:'space_outside_inside_envelope',ids:[s.space_id]})
  }
  for (let i=0;i<recipe.spaces.length;i++) for (let j=i+1;j<recipe.spaces.length;j++) {
    const a=recipe.spaces[i], b=recipe.spaces[j]
    if (a.level_id===b.level_id && a.bounds && b.bounds && rectIntersection(a.bounds,b.bounds)) conflicts.push({kind:'overlapping_space_footprints_review_zones',ids:[a.space_id,b.space_id]})
  }
  const probes = recipe.probes.map(p => {
    const from=levels.find(l=>l.level_id===p.from_level_id)!, to=levels.find(l=>l.level_id===p.to_level_id)!
    const hits = (levelId:string) => recipe.spaces.filter(s=>s.level_id===levelId && s.bounds).flatMap(s=>{
      const intersection=rectIntersection(s.bounds!,p.bounds)
      return intersection ? [{space_id:s.space_id,intersection,contains_study_area:rectContains(s.bounds!,p.bounds)}] : []
    })
    const dz = from.floor_z_mm === null || to.floor_z_mm === null ? null : (um(to.floor_z_mm)-um(from.floor_z_mm))/1000
    const slabClearance = dz !== null && dz > 0 && to.slab_mm !== null ? (um(dz)-um(to.slab_mm))/1000 : null
    const inFrom=rectContains(from.inside,p.bounds), inTo=rectContains(to.inside,p.bounds)
    if (!inFrom || !inTo) conflicts.push({kind:'study_area_outside_inside_envelope',ids:[p.key]})
    if (slabClearance !== null && slabClearance <= 0) conflicts.push({kind:'upper_slab_reaches_lower_floor',ids:[p.key]})
    return { ...p, from_spaces:hits(from.level_id), to_spaces:hits(to.level_id), within_from_outline:inFrom, within_to_outline:inTo,
      floor_delta_mm:dz, lower_floor_to_upper_slab_mm:slabClearance,
      vertical_state: dz === null ? 'unknown_floor_height' : slabClearance === null ? 'floor_delta_only' : 'floor_delta_and_slab_only' }
  })
  return { recipe, levels, probes, conflicts, unplaced_spaces:recipe.spaces.filter(s=>s.bounds===null).map(s=>s.space_id),
    contains_estimates:[...recipe.levels,...recipe.spaces].some(s=>s.basis==='estimated'), limits:BUILDING_PLAN_LIMITS }
}
export function checkedBuildingPlan(value: unknown, projectId: string, artifactId: string, revision: number): BuildingPlanDetails {
  if (!object(value) || value.project_id!==projectId || value.artifact_id!==artifactId || value.artifact_revision!==revision
    || typeof value.sources_changed!=='boolean' || typeof value.physical_pending!=='boolean' || !object(value.names)) throw new Error('Building plan identity or source state mismatch.')
  const recipe = buildingPlanRecipe(value.recipe)
  if (recipe.building_id!==value.building_id) throw new Error('Building mismatch.')
  for (const id of [recipe.building_id,...recipe.levels.map(l=>l.level_id),...recipe.spaces.map(s=>s.space_id)]) text(value.names[id],200)
  return { ...value, recipe } as unknown as BuildingPlanDetails
}
export function withDerivedBuildingPlan<T extends Record<string, unknown>>(record: T, projectId: string): T & Record<string, unknown> {
  if (!record.multifloor_plan) return record.has_multifloor_plan ? { ...record, drawing_error:'Coordinate plan unavailable in this project. Do not reconstruct it from memory.' } : record
  const d=checkedBuildingPlan(record.multifloor_plan,projectId,String(record.id),Number(record.revision)), g=buildingPlanGeometry(d.recipe)
  return { ...record, derived_multifloor:{ unit:'mm', truth:'design_study', probes:g.probes.map(p=>({key:p.key,from_hit_count:p.from_spaces.length,to_hit_count:p.to_spaces.length,
      floor_delta_mm:p.floor_delta_mm,lower_floor_to_upper_slab_mm:p.lower_floor_to_upper_slab_mm,vertical_state:p.vertical_state,
      within_from_outline:p.within_from_outline,within_to_outline:p.within_to_outline,detail_tool:'inspect_building_projection'})), conflicts:g.conflicts.slice(0,8), conflicts_total:g.conflicts.length,
    unplaced_spaces:g.unplaced_spaces, sources_changed:d.sources_changed, contains_estimates:g.contains_estimates, limits:BUILDING_PLAN_LIMITS } }
}
