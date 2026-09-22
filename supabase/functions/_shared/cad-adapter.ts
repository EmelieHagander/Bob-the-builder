export type CadPrimitive =
  | { id:string; primitive:'box'; material_ref:string|null; x_mm:number; y_mm:number; z_mm:number }
  | { id:string; primitive:'tube'; material_ref:string|null; outside_diameter_mm:number; wall_thickness_mm:number; length_mm:number }
export type CadPlacement={x:number;y:number;z:number;rx:number;ry:number;rz:number}
export type CadInstance={id:string;definition_id:string;placement:CadPlacement}
export type CadView='front'|'right'|'top'|'isometric'
export type CadAssemblyRequest={contract_version:1;units:'mm';assembly_id:string;definitions:CadPrimitive[];instances:CadInstance[];views:CadView[]}
export type CadAssemblyResult={contract_version:1;engine:{name:'build123d';version:'0.13.0';units:'mm'};assembly_id:string;
  bounding_box_mm:{min:number[];max:number[];size:number[]};definitions:CadPrimitive[];
  instances:{id:string;definition_id:string;bounding_box_mm:{min:number[];max:number[];size:number[]}}[];
  exports:Record<string,{file:string;sha256:string}>}

const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const id=(v:unknown):v is string=>typeof v==='string'&&ID.test(v)
const finite=(v:unknown,bound:number,positive=false):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=bound&&(!positive||v>0)
const place=(v:unknown)=>obj(v)&&exact(v,['x','y','z','rx','ry','rz'])
  &&finite(v.x,1e7)&&finite(v.y,1e7)&&finite(v.z,1e7)&&finite(v.rx,360000)&&finite(v.ry,360000)&&finite(v.rz,360000)
function primitive(v:unknown):v is CadPrimitive{
  if(!obj(v)||!id(v.id)||(v.material_ref!==null&&!id(v.material_ref)))return false
  if(v.primitive==='box')return exact(v,['id','primitive','material_ref','x_mm','y_mm','z_mm'])&&finite(v.x_mm,1e6,true)&&finite(v.y_mm,1e6,true)&&finite(v.z_mm,1e6,true)
  if(v.primitive==='tube')return exact(v,['id','primitive','material_ref','outside_diameter_mm','wall_thickness_mm','length_mm'])
    &&finite(v.outside_diameter_mm,1e6,true)&&finite(v.wall_thickness_mm,1e6,true)&&finite(v.length_mm,1e6,true)
    &&v.wall_thickness_mm*2<v.outside_diameter_mm
  return false
}
export function parseCadAssemblyRequest(v:unknown):CadAssemblyRequest|null{
  if(!obj(v)||!exact(v,['contract_version','units','assembly_id','definitions','instances','views'])||v.contract_version!==1||v.units!=='mm'||!id(v.assembly_id)
    ||!Array.isArray(v.definitions)||v.definitions.length<1||v.definitions.length>128||v.definitions.some(x=>!primitive(x))
    ||!Array.isArray(v.instances)||v.instances.length<1||v.instances.length>512||!Array.isArray(v.views)||v.views.length<1||v.views.length>4)return null
  const defs=v.definitions as CadPrimitive[], ids=new Set(defs.map(d=>d.id)); if(ids.size!==defs.length)return null
  const seen=new Set<string>()
  for(const raw of v.instances){if(!obj(raw)||!exact(raw,['id','definition_id','placement'])||!id(raw.id)||seen.has(raw.id)||!id(raw.definition_id)||!ids.has(raw.definition_id)||!place(raw.placement))return null;seen.add(raw.id)}
  const allowed=new Set<CadView>(['front','right','top','isometric'])
  if(new Set(v.views).size!==v.views.length||v.views.some(x=>typeof x!=='string'||!allowed.has(x as CadView)))return null
  return v as unknown as CadAssemblyRequest
}
const vec=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x,1e7))
const bounds=(v:unknown)=>obj(v)&&exact(v,['min','max','size'])&&vec(v.min)&&vec(v.max)&&vec(v.size)
export function parseCadAssemblyResult(v:unknown,r:CadAssemblyRequest):CadAssemblyResult|null{
  if(!obj(v)||v.contract_version!==1||v.assembly_id!==r.assembly_id||!obj(v.engine)||v.engine.name!=='build123d'||v.engine.version!=='0.13.0'||v.engine.units!=='mm'
    ||!bounds(v.bounding_box_mm)||!Array.isArray(v.instances)||v.instances.length!==r.instances.length||!obj(v.exports))return null
  for(const key of ['step',...r.views]){const e=v.exports[key];if(!obj(e)||!exact(e,['file','sha256'])||typeof e.file!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(e.file)||typeof e.sha256!=='string'||!/^[0-9a-f]{64}$/.test(e.sha256))return null}
  return v as unknown as CadAssemblyResult
}
export type CadTransport=(request:CadAssemblyRequest,signal:AbortSignal)=>Promise<unknown>
export function createCadAdapter(transport:CadTransport,timeoutMs=20000){
  return{async render(input:unknown){const request=parseCadAssemblyRequest(input);if(!request)return{status:'invalid' as const}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs)
    try{const result=parseCadAssemblyResult(await transport(request,controller.signal),request);return result?{status:'ok' as const,result}:{status:'unavailable' as const}}
    catch{return{status:'unavailable' as const}}finally{clearTimeout(timer)}}}
}
