/** Shell drawings place separately saved CAD pieces by reference (see
 * supabase/migrations/20261008120000_cad_shells.sql). Shared by the app and Bob. */
export const SHELL_BASIS=['shared_origin','owner_placed','bob_decision'] as const
export const SHELL_BASIS_LABELS:Record<typeof SHELL_BASIS[number],string>={shared_origin:'Planned together',owner_placed:'Placed by you',bob_decision:'Bob\'s proposal'}
export interface CadShell{id:string;revision:number;current_revision:number;title:string;description:string;assumptions:string;archived:boolean;area_id:string|null;components:ShellComponent[];plan_summary?:ShellPlanSummary}
export interface ShellComponent extends ShellPlanFields{component_key:string;child_artifact_id:string;child_revision:number;x_mm:number;y_mm:number;z_mm:number;rz:number;
 placement_basis:typeof SHELL_BASIS[number];reason:string;child_title:string|null;child_current_revision:number|null;
 bounding_box_mm:{min:number[];max:number[];size:number[]}|null;status:'current'|'newer_revision'|'changed'|'archived'|'unavailable'}
/** Plan-view rectangle of a placed piece: its bounding box rotated about the piece origin, then moved. */
export function shellFootprint(c:Pick<ShellComponent,'x_mm'|'y_mm'|'rz'|'bounding_box_mm'>){
 const b=c.bounding_box_mm,ok=(a:unknown)=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)
 if(!b||!ok(b.min)||!ok(b.max)||b.max[0]<=b.min[0]||b.max[1]<=b.min[1])return null
 const r=c.rz*Math.PI/180,cos=Math.round(Math.cos(r)),sin=Math.round(Math.sin(r))
 const corners=[[b.min[0],b.min[1]],[b.max[0],b.min[1]],[b.max[0],b.max[1]],[b.min[0],b.max[1]]].map(([x,y])=>[c.x_mm+x*cos-y*sin,c.y_mm+x*sin+y*cos])
 const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1])
 return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),depth:Math.max(...ys)-Math.min(...ys)}
}

/** Owner moves in the plan view snap to this grid. */
export const SHELL_GRID_MM = 50
export type ShellFootprint = NonNullable<ReturnType<typeof shellFootprint>>
export type ShellPlacement = Pick<ShellComponent, 'x_mm' | 'y_mm' | 'rz' | 'bounding_box_mm'>

/** Nearest grid line, as whole mm (the shell stores integers). */
export function snapMm(v: number, step = SHELL_GRID_MM) {
  return Math.round(Math.round(v / step) * step) || 0
}

/** One grid step in a direction; a piece off the grid lands on the next grid line that way. */
export function nudgeMm(v: number, dir: 1 | -1, step = SHELL_GRID_MM) {
  const r = Math.round(v)
  return (dir > 0 ? Math.floor(r / step) * step + step : Math.ceil(r / step) * step - step) || 0
}

/** A quarter turn that keeps the footprint centred where it was (snapped to the grid).
 * Without a saved size there is no footprint, so the piece turns about its origin. */
export function turnQuarter(c: ShellPlacement, step = SHELL_GRID_MM): Pick<ShellComponent, 'x_mm' | 'y_mm' | 'rz'> {
  const rz = ((c.rz % 360) + 450) % 360
  const before = shellFootprint(c), after = shellFootprint({ ...c, x_mm: 0, y_mm: 0, rz })
  if (!before || !after) return { x_mm: c.x_mm, y_mm: c.y_mm, rz }
  const cx = before.x + before.width / 2, cy = before.y + before.depth / 2
  return { x_mm: snapMm(cx - (after.x + after.width / 2), step), y_mm: snapMm(cy - (after.y + after.depth / 2), step), rz }
}

const area = (f: ShellFootprint) => f.width * f.depth
const inside = (a: ShellFootprint, b: ShellFootprint) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.depth <= a.y + a.depth

/** Pairs of footprints that share area. A piece wholly inside a larger one (furniture in a room)
 * is expected and not listed; edges that only touch are not overlaps. This compares bounding
 * boxes only: it is a visual warning, not a measured clash check. */
export function footprintOverlaps<K>(items: { key: K; footprint: ShellFootprint | null }[]): [K, K][] {
  const out: [K, K][] = []
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].footprint, b = items[j].footprint
    if (!a || !b) continue
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const d = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y)
    if (w <= 0 || d <= 0) continue
    if ((inside(a, b) && area(a) > area(b)) || (inside(b, a) && area(b) > area(a))) continue
    out.push([items[i].key, items[j].key])
  }
  return out
}

/** Plan and material read-out added by 20261008150000_cad_shell_plan_link.sql. Absent
 * while that migration is not live: the app then shows nothing rather than guessing. */
export interface ShellStep{id:string;title:string;position:number;state:string}
export interface ShellMaterial{id:string;revision:number;name:string;category:string;unit:string;required_quantity:string;artifact_revision:number;from_pinned_version:boolean;needs_review:boolean}
export interface ShellPlanSummary{totals:{name:string;unit:string;required_quantity:string;lines:number;pieces:string[];needs_review:number}[];
 counted_pieces:number;not_counted:string[];counted_once:{component_key:string;counted_with:string}[];not_in_plan:string[]}
export interface ShellPlanFields{steps?:ShellStep[];materials?:ShellMaterial[];counted_with?:string|null}

/** Build order: pieces by their earliest linked plan Step; pieces not in the plan last. */
export function shellBuildOrder<T extends {steps?:ShellStep[]}>(components:T[]):T[]{
 const first=(c:T)=>c.steps?.length?Math.min(...c.steps.map(s=>s.position)):Number.POSITIVE_INFINITY
 return components.map((c,i)=>({c,i})).sort((a,b)=>first(a.c)-first(b.c)||a.i-b.i).map(x=>x.c)
}
/** "12.5000" -> "12.5"; quantities stay decimal strings from the database. */
export function shellQuantity(q:string){return q.includes('.')?q.replace(/0+$/,'').replace(/\.$/,''):q}
