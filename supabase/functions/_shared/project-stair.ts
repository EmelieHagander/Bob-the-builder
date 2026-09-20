import { stairSpec, STAIR_KEYS } from '../../../src/lib/stairStudy.ts'
import { UUID } from '../../../src/lib/buildingPlan.ts'
import { exactObject } from '../../../src/lib/roomLayout.ts'
const text={type:'string'},num={type:'number'},int={type:'integer'},rev={type:'integer',minimum:1}
const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const rect=obj({x_mm:num,y_mm:num,width_mm:num,depth_mm:num})
const specification=obj({generator:{type:'string',enum:['stair_study_v1']},version:{type:'integer',enum:[1]},from_level_id:text,to_level_id:text,
 start_x_mm:{...num,description:'Centre of first riser, at lower floor; shared building x/east datum.'},start_y_mm:{...num,description:'Centre of first riser, shared building y/north datum.'},
 heading:{type:'string',enum:['north','east','south','west']},turn:{type:'string',enum:['straight','left','right']},risers:{...int,minimum:3,maximum:60},
 first_flight_risers:{type:['integer','null'],description:'Rises to square intermediate landing for a quarter turn; 2 through total-2. Null for straight.'},
 width_mm:{...int,description:'Walking strip width, whole mm; no stringers/handrails added.'},going_mm:int,landing_depth_mm:int,
 opening:{...rect,type:['object','null'],description:'Explicit rectangular floor-opening proposal. Null means unspecified, not a solid/empty floor. Inspect first for a conservative suggestion; do not remove slabs.'},
 required_headroom_mm:{...int,description:'Explicit project study criterion, not an automatically determined legal standard.'},
 upper_ceiling_above_floor_mm:{type:['integer','null'],description:'Flat upper ceiling height above upper finished floor. Null if unknown; never infer it from slab thickness.'},
 basis:{type:'string',enum:['provided_spec','estimated']},source:{...text,description:'Identify actual supplied dimensions or explicit reversible design assumptions.'}})
export const STAIR_INSPECT_TOOL={type:'function' as const,function:{name:'inspect_stair_options',
 description:'READ ONLY: calculate 1–4 candidate stairs on an exact current multi-floor plan. Reads the plan with current caller access (one lookup), then derives treads, turning landing, upper exit coordinates/direction and room overlaps. Reports modelled envelope/opening/headroom conflicts, missing inputs and a conservative opening rectangle. Supports straight or quarter-turn WITH SQUARE LANDING, not rounded winders/spirals. Never call a projection a stair solution. Passing these limited checks is not proof of doors, circulation, structure, safety or building approval. Recommend only by the returned evidence and stated user goals. No save or physical mutation.',
 parameters:obj({plan_id:text,plan_revision:rev,candidates:{type:'array',minItems:1,maxItems:4,items:obj({label:text,recipe:specification})}})}}
export const STAIR_WRITE_TOOL={type:'function' as const,function:{name:'save_project_stair',
 description:'Save/revise the requested stair study as a Concept Artifact inside Bob, never as accepted building work. Read and inspect the exact multi-floor plan first; inherit its Project/Area target and measurement evidence. Only straight and square-landing quarter-turn shapes. The server binds the source revision; no copied floor/room geometry allowed. Revising changes only the stair, not its source plan. refresh_source explicitly adopts a newer revision of the SAME plan, preserving every stair parameter; inspect and explain any changed rise/headroom/outlet context. Reuse existing stair ID and revision for changes; never duplicate. Success requires the saved receipt. No form is required of the user.',
 parameters:obj({record_id:{type:['string','null']},expected_revision:int,action:{type:'string',enum:['create','revise','refresh_source']},plan_id:text,plan_revision:rev,
 title:text,description:text,assumptions:text,recipe:specification,change_note:text,request_quote:{...text,description:'Exact quote from CURRENT user request authorising this save.'}})}}
const id=(x:unknown):x is string=>typeof x==='string'&&UUID.test(x)
const revision=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0&&Number(x)<=2147483647
const string=(x:unknown,max:number)=>typeof x==='string'&&!!x.trim()&&x.length<=max
export function parseStairInspection(v:unknown){
 if(!exactObject(v,STAIR_INSPECT_TOOL.function.parameters.required)||!id(v.plan_id)||!revision(v.plan_revision)
  ||!Array.isArray(v.candidates)||v.candidates.length<1||v.candidates.length>4)return null
 try{return {plan_id:v.plan_id.toLowerCase(),plan_revision:Number(v.plan_revision),candidates:v.candidates.map(c=>{
  if(!exactObject(c,['label','recipe'])||!string(c.label,80))throw new Error('Invalid candidate')
  return {label:c.label as string,recipe:stairSpec(c.recipe)}
 })}}catch{return null}
}
export function parseStairWrite(v:Record<string,unknown>){
 if(!exactObject(v,STAIR_WRITE_TOOL.function.parameters.required)||!['create','revise','refresh_source'].includes(String(v.action))
  ||(v.record_id===null?v.expected_revision!==0||v.action!=='create':!id(v.record_id)||!revision(v.expected_revision)||v.action==='create')
  ||!id(v.plan_id)||!revision(v.plan_revision)||!string(v.title,200)||!string(v.description,4000)||!string(v.assumptions,3000)
  ||!string(v.change_note,1000)||!string(v.request_quote,500))return null
 try{return {kind:'stair' as const,record_id:v.record_id as string|null,expected_updated_at:null,expected_revision:Number(v.expected_revision),request_quote:v.request_quote as string,
  data:{action:v.action,plan_id:v.plan_id.toLowerCase(),plan_revision:Number(v.plan_revision),title:v.title,description:v.description,
   assumptions:v.assumptions,recipe:stairSpec(v.recipe),change_note:v.change_note}}}catch{return null}
}
// Keep shared schema and runtime validator in step; all fields must be supplied.
if(Object.keys(specification.properties).sort().join()!==[...STAIR_KEYS].sort().join())throw new Error('Stair schema mismatch')
