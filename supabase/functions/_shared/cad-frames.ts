import type {CadAssemblyRequest} from './cad-adapter.ts'
import type {CadParameters,ParameterInput,ParameterUnit} from './cad-parameters.ts'

export type CadFrameInput={id:string;kind:'room'|'image';source_ref:string;required:boolean;reason:string;placement:{x:string;y:string;z:string;rx:string;ry:string;rz:string}|null}
export type CadFrame=CadFrameInput&{source_version:string|null;translation_mm:number[]|null;rotation_degrees:number[]|null;axes:number[][]|null}
const keys=['x','y','z','rx','ry','rz'] as const
const exact=(v:any,fields:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...fields].sort().join(',')
const id=(v:any)=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(v)
export function parseCadFrames(value:unknown):CadFrameInput[]{
 if(!Array.isArray(value)||value.length>16)throw new Error('invalid_coordinate_frames')
 const seen=new Set<string>()
 for(const f of value){
  if(!exact(f,['id','kind','source_ref','required','reason','placement'])||!id(f.id)||seen.has(f.id)||!['room','image'].includes(f.kind)||typeof f.required!=='boolean'||typeof f.reason!=='string'||!f.reason.trim()||f.reason.length>2000||typeof f.source_ref!=='string')throw new Error('invalid_coordinate_frame')
  if(f.kind==='room'?!/^parameter:[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(f.source_ref):!/^image:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(f.source_ref))throw new Error('invalid_coordinate_source')
  if(f.placement!==null&&(!exact(f.placement,[...keys])||keys.some(k=>!id(f.placement[k]))))throw new Error('invalid_coordinate_transform')
  seen.add(f.id)
 }
 return structuredClone(value)
}
/** Columns are the external frame's positive axes expressed in assembly space.
 * build123d 0.13 Location defaults to intrinsic XYZ: Rx * Ry * Rz.
 * https://build123d.readthedocs.io/en/v0.13.0/_modules/geometry.html */
export function intrinsicAxes(angles:number[]):number[][]{
 const [x,y,z]=angles.map(v=>v*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z)
 const rows=[[cy*cz,-cy*sz,sy],[cx*sz+sx*sy*cz,cx*cz-sx*sy*sz,-sx*cy],[sx*sz-cx*sy*cz,sx*cz+cx*sy*sz,cx*cy]]
 return [0,1,2].map(i=>rows.map(row=>Number(row[i].toFixed(12))||0))
}
export function cadCoordinateSystem(recipe:CadAssemblyRequest){
 return {version:1,id:recipe.assembly_id,length_unit:'mm',angle_unit:'deg',origin:[0,0,0],positive_axes:[[1,0,0],[0,1,0],[0,0,1]],rotation:'build123d_0.13_intrinsic_xyz',
  definition_origins:{box:'minimum_corner',cylinder:'xy_center_z_min',tube:'xy_center_z_min'},
  instance_parent:'assembly',cut_parent:'definition',frame_identity:'artifact_revision_and_recipe_path',
  views:{front:{toward_camera:[0,-1,0],up:[0,0,1]},right:{toward_camera:[1,0,0],up:[0,0,1]},top:{toward_camera:[0,0,1],up:[0,1,0]},isometric:{toward_camera:[1,-1,1],up:[0,0,1]}}}
}
export function compileCadFrames(frames:CadFrameInput[],evaluate:(id:string)=>CadParameters['nodes'][number],images:Map<string,string>):CadFrame[]{
 return frames.map(f=>{
  let source_version:string|null=null
  if(f.kind==='room'){
   const n=evaluate(f.source_ref.slice(10))
   if(n.role!=='source'||n.source.kind!=='space_measurement')throw new Error('coordinate_room_source_required')
  }else{
   source_version=images.get(f.source_ref)??null
   if(!source_version)throw new Error('coordinate_image_unread')
  }
  if(!f.placement)return {...f,source_version,translation_mm:null,rotation_degrees:null,axes:null}
  const values=keys.map(k=>{
   const n=evaluate(f.placement![k]),expected:ParameterUnit=k.startsWith('r')?'deg':'mm'
   if(n.normalized.unit!==expected||Math.abs(n.normalized.value)>(expected==='deg'?360000:1e7))throw new Error('coordinate_transform_unit_or_range')
   return n.normalized.value
  })
  return {...f,source_version,translation_mm:values.slice(0,3),rotation_degrees:values.slice(3),axes:intrinsicAxes(values.slice(3))}
 })
}
export function frameParameterIds(frames:CadFrameInput[]):string[]{
 return frames.flatMap(f=>[...(f.kind==='room'?[f.source_ref.slice(10)]:[]),...f.placement?Object.values(f.placement):[]])
}
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const parameter={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'}
export const CAD_FRAMES_SCHEMA={type:'array',maxItems:16,description:'External-to-assembly transforms; every translation/rotation component names a parameter node. Room source_ref is parameter:<physical source node>; image source_ref is an exact opened image:<UUID>. Image camera directions and room compass axes are distinct. Null placement preserves unknown orientation/origin; required unknown transforms stop the request. Do not convert a reference image into measured truth. Local part, cut and view frames are supplied by the pinned engine convention.',items:object({id:parameter,kind:{type:'string',enum:['room','image']},source_ref:{type:'string'},required:{type:'boolean'},reason:{type:'string',minLength:1,maxLength:2000},placement:{anyOf:[object(Object.fromEntries(keys.map(k=>[k,parameter]))),{type:'null'}]}})}
