/** A shell drawing combines separately saved CAD pieces by reference. Bob and the
 * app change it through the same server command (bob.cad_shell_command); pieces
 * keep their own cut lists, and a newer piece is flagged, never adopted silently. */
import { SHELL_BASIS } from '../../../src/lib/cadShell.ts'
export { shellFootprint } from '../../../src/lib/cadShell.ts'
const KEY=/^[a-z][a-z0-9_-]{0,39}$/
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const text=(v:unknown,n:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=n
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const mm=(v:unknown)=>Number.isSafeInteger(v)&&Math.abs(Number(v))<=10_000_000
const placement={
 x_mm:{type:'integer',description:'East offset of the piece origin in the shell, whole mm.'},
 y_mm:{type:'integer',description:'North offset, whole mm.'},
 z_mm:{type:'integer',description:'Height offset, whole mm.'},
 rz:{type:'integer',enum:[0,90,180,270],description:'Rotation about the vertical axis, degrees.'},
 placement_basis:{type:'string',enum:[...SHELL_BASIS],description:'shared_origin: piece was planned in the shell coordinates (plan_cad_pieces). owner_placed: the owner said where. bob_decision: your reversible proposal.'},
 reason:{type:'string',maxLength:500,description:'Why the piece sits here, in the owner\'s words where possible.'},
}
const component={type:'object',additionalProperties:false,required:['component_key','child_artifact_id','child_revision',...Object.keys(placement)],properties:{
 component_key:{type:'string',pattern:KEY.source,description:'Stable short key, e.g. bedroom, bunk_bed.'},
 child_artifact_id:{type:'string',description:'Saved CAD drawing id from read_drawing_requests or a save receipt.'},
 child_revision:{type:['integer','null'],description:'Null pins the current saved revision.'},...placement}}
const nullable=(s:Record<string,unknown>)=>({...s,type:[s.type,'null']})
export const COMPOSE_CAD_SHELL_TOOL={type:'function' as const,function:{name:'compose_cad_shell',
 description:'Combine separately saved CAD drawings (rooms, walls, furniture) into one shell drawing, or move, add, remove or update a piece in an existing shell. The shell only places pieces; it never redraws or copies them. Positions are proposals unless the owner gave them.',
 parameters:{type:'object',additionalProperties:false,required:['record_id','expected_revision','action','title','description','assumptions','area_id','components','component_key','placement','component','request_quote'],properties:{
  record_id:{type:['string','null'],description:'Null only for action=create.'},
  expected_revision:{type:'integer',minimum:0,description:'0 for create; otherwise the shell revision you last read.'},
  action:{type:'string',enum:['create','place','add','remove','adopt']},
  title:{type:['string','null'],maxLength:200},description:{type:['string','null'],maxLength:4000},assumptions:{type:['string','null'],maxLength:3000},area_id:{type:['string','null']},
  components:{type:['array','null'],minItems:1,maxItems:64,items:component,description:'create only.'},
  component_key:{type:['string','null'],description:'place, remove or adopt.'},
  placement:nullable({type:'object',additionalProperties:false,required:Object.keys(placement),properties:placement,description:'place only.'}),
  component:nullable({...component,description:'add only.'}),
  request_quote:{type:'string',description:'Exact quote from the CURRENT user message authorising this change.'}}}}}
export const READ_CAD_SHELL_TOOL={type:'function' as const,function:{name:'read_cad_shell',
 description:'Read a shell drawing: its pieces, their exact pinned revisions, placements, footprints, and whether a piece has a newer saved revision. Null revision reads current.',
 parameters:{type:'object',additionalProperties:false,required:['shell_id','revision'],properties:{shell_id:{type:'string'},revision:{type:['integer','null'],minimum:1}}}}}

function parsePlacement(v:unknown){
 if(!exact(v,Object.keys(placement))||!mm(v.x_mm)||!mm(v.y_mm)||!mm(v.z_mm)||![0,90,180,270].includes(v.rz as number)
  ||!SHELL_BASIS.includes(v.placement_basis as any)||!text(v.reason,500))return null
 return {x_mm:v.x_mm,y_mm:v.y_mm,z_mm:v.z_mm,rz:v.rz,placement_basis:v.placement_basis,reason:v.reason}
}
function parseComponent(v:unknown){
 if(!exact(v,component.required)||typeof v.component_key!=='string'||!KEY.test(v.component_key)||typeof v.child_artifact_id!=='string'||!UUID.test(v.child_artifact_id)
  ||!(v.child_revision===null||Number.isSafeInteger(v.child_revision)&&Number(v.child_revision)>0))return null
 const {component_key,child_artifact_id,child_revision,...rest}=v,p=parsePlacement(rest)
 return p&&{component_key,child_artifact_id:child_artifact_id.toLowerCase(),child_revision,...p}
}
/** Returns the claimed-turn writer payload, or null when the call is malformed. */
export function parseCadShellWrite(v:Record<string,unknown>){
 const action=String(v.action),create=action==='create'
 if(!exact(v,COMPOSE_CAD_SHELL_TOOL.function.parameters.required)||!['create','place','add','remove','adopt'].includes(action)||!text(v.request_quote,500)
  ||!Number.isSafeInteger(v.expected_revision)||(create?v.record_id!==null||v.expected_revision!==0:typeof v.record_id!=='string'||!UUID.test(v.record_id)||Number(v.expected_revision)<1))return null
 const unused=(keys:string[])=>keys.every(k=>v[k]===null)
 let fields:Record<string,unknown>|null=null
 if(create){
  const comps=Array.isArray(v.components)&&v.components.length>=1&&v.components.length<=64?v.components.map(parseComponent):null
  if(comps&&comps.every(Boolean)&&new Set(comps.map(c=>c!.component_key)).size===comps.length&&text(v.title,200)&&text(v.description,4000)&&text(v.assumptions,3000)
   &&(v.area_id===null||text(v.area_id,200))&&unused(['component_key','placement','component']))
   fields={title:v.title,description:v.description,assumptions:v.assumptions,area_id:v.area_id,components:comps}
 }else if(unused(['title','description','assumptions','area_id','components'])){
  const key=typeof v.component_key==='string'&&KEY.test(v.component_key)?v.component_key:null
  if(action==='place'&&key&&v.component===null){const p=parsePlacement(v.placement);if(p)fields={component_key:key,...p}}
  if(action==='add'&&v.component_key===null&&v.placement===null){const c=parseComponent(v.component);if(c)fields={component:c}}
  if((action==='remove'||action==='adopt')&&key&&v.placement===null&&v.component===null)fields={component_key:key}
 }
 if(!fields)return null
 return {kind:'cad_shell' as const,record_id:create?null:(v.record_id as string).toLowerCase(),expected_updated_at:null,expected_revision:Number(v.expected_revision),
  request_quote:v.request_quote as string,data:{action,fields}}
}
export function parseCadShellRead(v:unknown){
 if(!exact(v,['shell_id','revision'])||typeof v.shell_id!=='string'||!UUID.test(v.shell_id)||!(v.revision===null||Number.isSafeInteger(v.revision)&&Number(v.revision)>0))return null
 return {shell_id:v.shell_id.toLowerCase(),revision:v.revision as number|null}
}

export const LINK_CAD_SHELL_STEPS_TOOL={type:'function' as const,function:{name:'link_cad_shell_steps',
 description:'Link the pieces of a shell drawing to current plan Steps in one go, or unlink them. Each link is held by the piece, exactly as link_project_drawing would save it; the shell itself is not changed.',
 parameters:{type:'object',additionalProperties:false,required:['shell_id','expected_revision','links','request_quote'],properties:{
  shell_id:{type:'string',description:'Shell drawing id from read_cad_shell or its save receipt.'},
  expected_revision:{type:'integer',minimum:1,description:'The shell revision you last read.'},
  links:{type:'array',minItems:1,maxItems:64,description:'One entry per piece and Step, in build order.',items:{type:'object',additionalProperties:false,required:['component_key','step_id','action'],properties:{
   component_key:{type:'string',pattern:KEY.source,description:'Exactly as read_cad_shell returns it.'},
   step_id:{type:'string',description:'Exact current plan Step id.'},
   action:{type:'string',enum:['link','unlink']}}}},
  request_quote:{type:'string',description:'Exact quote from the CURRENT user message authorising this change.'}}}}}
/** Returns the claimed-turn writer payload for link_cad_shell_steps, or null when malformed. */
export function parseCadShellStepsWrite(v:Record<string,unknown>){
 if(!exact(v,LINK_CAD_SHELL_STEPS_TOOL.function.parameters.required)||typeof v.shell_id!=='string'||!UUID.test(v.shell_id)||!text(v.request_quote,500)
  ||!Number.isSafeInteger(v.expected_revision)||Number(v.expected_revision)<1||!Array.isArray(v.links)||v.links.length<1||v.links.length>64)return null
 const links=v.links.map(l=>exact(l,['component_key','step_id','action'])&&typeof l.component_key==='string'&&KEY.test(l.component_key)
  &&typeof l.step_id==='string'&&UUID.test(l.step_id)&&(l.action==='link'||l.action==='unlink')?{component_key:l.component_key,step_id:l.step_id.toLowerCase(),action:l.action}:null)
 if(!links.every(Boolean)||new Set(links.map(l=>`${l!.component_key}:${l!.step_id}`)).size!==links.length)return null
 return {kind:'cad_shell_steps' as const,record_id:v.shell_id.toLowerCase(),expected_updated_at:null,expected_revision:Number(v.expected_revision),
  request_quote:v.request_quote as string,data:{links}}
}
