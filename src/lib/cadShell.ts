/** Shell drawings place separately saved CAD pieces by reference (see
 * supabase/migrations/20261008120000_cad_shells.sql). Shared by the app and Bob. */
export const SHELL_BASIS=['shared_origin','owner_placed','bob_decision'] as const
export const SHELL_BASIS_LABELS:Record<typeof SHELL_BASIS[number],string>={shared_origin:'Planned together',owner_placed:'Placed by you',bob_decision:'Bob\'s proposal'}
export interface CadShell{id:string;revision:number;current_revision:number;title:string;description:string;assumptions:string;archived:boolean;area_id:string|null;components:ShellComponent[]}
export interface ShellComponent{component_key:string;child_artifact_id:string;child_revision:number;x_mm:number;y_mm:number;z_mm:number;rz:number;
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
