import { buildingPlanRecipe, planRect, UUID } from '../../../src/lib/buildingPlan.ts'
import { exactObject } from '../../../src/lib/roomLayout.ts'
const text={type:'string'}, number={type:'number'}, integer={type:'integer'}, revision={type:'integer',minimum:1}
const ref={...text,description:'Exact canonical UUID from fresh project research. Never invent one.'}
const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const rect=obj({x_mm:number,y_mm:number,width_mm:number,depth_mm:number})
const level=obj({level_id:ref,level_revision:revision,bounds:rect,wall_mm:number,
  floor_z_mm:{type:['number','null'],description:'Finished-floor elevation from the SAME building datum, in mm. Unknown is null. Never infer from level order.'},
  slab_mm:{type:['number','null'],description:'Thickness below this level finished floor to the slab underside. Unknown is null.'},
  basis:{type:'string',enum:['provided_spec','estimated']},source:{...text,maxLength:500}})
const space=obj({space_id:ref,space_revision:revision,level_id:ref,bounds:{...rect,type:['object','null']},
  basis:{type:'string',enum:['provided_spec','estimated']},source:{...text,maxLength:500}})
const probe=obj({key:text,label:text,from_level_id:ref,to_level_id:ref,bounds:rect})
const recipe=obj({generator:{type:'string',enum:['multifloor_v1']},version:{type:'integer',enum:[1]},building_id:ref,building_revision:revision,
  frame:{type:'string',enum:['east_north_up']},origin:{...text,description:'Explicit shared physical or assumed origin for x/y/z. Identify assumptions. Both levels use it, not independent room origins.'},
  levels:{type:'array',minItems:2,maxItems:6,items:level},spaces:{type:'array',maxItems:32,items:space},probes:{type:'array',maxItems:4,items:probe}})
export const BUILDING_PLAN_TOOL={type:'function' as const,function:{name:'save_project_building_plan',
  description:'Create/revise a bounded multi-floor coordinate study in Bob, using existing canonical Building/Level/Space IDs and selected target. Read current sources and the current artifact first. East is +x, north is +y, up is +z; all floors share one explicit datum. Numeric envelopes are outside bounds; room bounds are inside footprints, not inferred walls or doors. Unknown room bounds and floor heights remain null. A projected study area is NOT a generated staircase or floor opening. Save all plan views atomically as Concept. Normal revise preserves source identities/revisions and evidence. refresh_sources adopts current source revisions without changing coordinates. Keep unrelated data; no physical-state acceptance or safety/readiness claims.',
  parameters:obj({record_id:{type:['string','null']},action:{type:'string',enum:['create','revise','refresh_sources']},expected_revision:integer,
    create_area_id:{type:['string','null']},target_revision:revision,title:text,description:text,assumptions:text,recipe,
    measurements:{type:'array',maxItems:20,items:obj({id:ref,revision})},change_note:text,
    request_quote:{...text,description:'Exact 1–500 character quote from the CURRENT user request authorising this save.'}})}}
export const PROJECTION_TOOL={type:'function' as const,function:{name:'inspect_building_projection',
  description:'Read-only coordinate calculation on an exact CURRENT saved multi-floor plan. Resolve the artifact and level IDs first. Project a rectangle at the same building x/y onto another floor; returns intersected mapped room footprints and known floor/slab elevations. Consumes one project lookup, never saves changes. Does not calculate a staircase, path, headroom or safe opening. A missing mapped room is unknown coverage, not evidence of an empty room. Report stale sources and estimates.',
  parameters:obj({record_id:ref,expected_revision:revision,from_level_id:ref,to_level_id:ref,bounds:rect})}}
const validRef=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v)
const validRevision=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<=2147483647
const validText=(v:unknown,max:number)=>typeof v==='string'&&!!v.trim()&&v.length<=max
export function parseBuildingPlanWrite(v:Record<string,unknown>){
  if(!exactObject(v,BUILDING_PLAN_TOOL.function.parameters.required)||!['create','revise','refresh_sources'].includes(String(v.action))
    ||(v.record_id===null?v.action!=='create'||v.expected_revision!==0:!validRef(v.record_id)||v.action==='create'||!validRevision(v.expected_revision))
    ||(v.record_id!==null?v.create_area_id!==null:v.create_area_id!==null&&!validText(v.create_area_id,200))
    ||!validRevision(v.target_revision)||!validText(v.title,200)||!validText(v.description,6000)||!validText(v.assumptions,3500)
    ||!validText(v.change_note,1000)||!validText(v.request_quote,500)||!Array.isArray(v.measurements)||v.measurements.length>20)return null
  const seen=new Set<string>()
  for(const m of v.measurements){
    if(!exactObject(m,['id','revision'])||!validRef(m.id)||!validRevision(m.revision)||seen.has(m.id.toLowerCase()))return null
    seen.add(m.id.toLowerCase())
  }
  try{
    const data={action:v.action,title:v.title,description:v.description,assumptions:v.assumptions,
      recipe:buildingPlanRecipe(v.recipe),target_revision:v.target_revision,measurements:v.measurements,change_note:v.change_note,
      ...(v.record_id===null?{area_id:v.create_area_id}:{})}
    if(new TextEncoder().encode(JSON.stringify(data)).length>23500)return null
    return {kind:'multifloor' as const,record_id:v.record_id as string|null,expected_updated_at:null,expected_revision:v.expected_revision as number,request_quote:v.request_quote as string,data}
  }catch{return null}
}
export function parseProjection(v:unknown){
  if(!exactObject(v,PROJECTION_TOOL.function.parameters.required)||!validRef(v.record_id)||!validRevision(v.expected_revision)
    ||!validRef(v.from_level_id)||!validRef(v.to_level_id)||v.from_level_id.toLowerCase()===v.to_level_id.toLowerCase())return null
  try{return {record_id:v.record_id.toLowerCase(),expected_revision:Number(v.expected_revision),from_level_id:v.from_level_id.toLowerCase(),to_level_id:v.to_level_id.toLowerCase(),bounds:planRect(v.bounds)}}catch{return null}
}
