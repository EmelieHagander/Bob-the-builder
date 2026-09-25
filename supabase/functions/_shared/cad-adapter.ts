export type CadSolid =
  | { primitive:'box'; x_mm:number; y_mm:number; z_mm:number }
  | { primitive:'tube'; outside_diameter_mm:number; wall_thickness_mm:number; length_mm:number }
  | { primitive:'cylinder'; diameter_mm:number; length_mm:number }
export type CadCut=(Exclude<CadSolid,{primitive:'tube'}>)&{placement:CadPlacement}
export type CadPrimitive=CadSolid&{id:string;material_ref:string|null;cuts?:CadCut[]}
export type CadPlacement={x:number;y:number;z:number;rx:number;ry:number;rz:number}
export type CadInstance={id:string;definition_id:string;placement:CadPlacement}
export type CadView='front'|'right'|'top'|'isometric'
export type CadClearance={id:string;first_id:string;second_id:string;min_mm:number}
export type CadMotion={id:string;moving_ids:string[];obstacle_ids:string[];delta:{x:number;y:number;z:number}}
export type CadAssemblyRequest={contract_version:1;units:'mm';assembly_id:string;definitions:CadPrimitive[];instances:CadInstance[];views:CadView[];clearances?:CadClearance[];motions?:CadMotion[]}
export type CadAssemblyResult={contract_version:1;engine:{name:'build123d';version:'0.13.0';units:'mm'};assembly_id:string;
  bounding_box_mm:{min:number[];max:number[];size:number[]};definitions:CadPrimitive[];
  instances:{id:string;definition_id:string;bounding_box_mm:{min:number[];max:number[];size:number[]}}[];
  exports:Record<string,{file:string;sha256:string}>;checks?:Record<string,unknown>}

const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const id=(v:unknown):v is string=>typeof v==='string'&&ID.test(v)
const finite=(v:unknown,bound:number,positive=false):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=bound&&(!positive||v>0)
const place=(v:unknown)=>obj(v)&&exact(v,['x','y','z','rx','ry','rz'])
  &&finite(v.x,1e7)&&finite(v.y,1e7)&&finite(v.z,1e7)&&finite(v.rx,360000)&&finite(v.ry,360000)&&finite(v.rz,360000)
function solid(v:Record<string,unknown>,prefix:string[],cut=false):boolean{
  if(v.primitive==='box')return exact(v,[...prefix,'primitive','x_mm','y_mm','z_mm'])&&finite(v.x_mm,1e6,true)&&finite(v.y_mm,1e6,true)&&finite(v.z_mm,1e6,true)
  if(v.primitive==='cylinder')return exact(v,[...prefix,'primitive','diameter_mm','length_mm'])&&finite(v.diameter_mm,1e6,true)&&finite(v.length_mm,1e6,true)
  if(v.primitive==='tube'&&!cut)return exact(v,[...prefix,'primitive','outside_diameter_mm','wall_thickness_mm','length_mm'])
    &&finite(v.outside_diameter_mm,1e6,true)&&finite(v.wall_thickness_mm,1e6,true)&&finite(v.length_mm,1e6,true)
    &&v.wall_thickness_mm*2<v.outside_diameter_mm
  return false
}
function primitive(v:unknown):v is CadPrimitive{
  if(!obj(v)||!id(v.id)||(v.material_ref!==null&&!id(v.material_ref)))return false
  if(v.cuts!==undefined&&(!Array.isArray(v.cuts)||v.cuts.length>16||v.cuts.some(c=>!obj(c)||!place(c.placement)||!solid(c,['placement'],true))))return false
  return solid(v,['id','material_ref',...(v.cuts===undefined?[]:['cuts'])])
}
export function parseCadAssemblyRequest(v:unknown):CadAssemblyRequest|null{
  if(!obj(v)||!exact(v,['contract_version','units','assembly_id','definitions','instances','views',...('clearances' in v?['clearances']:[]),...('motions' in v?['motions']:[])])||v.contract_version!==1||v.units!=='mm'||!id(v.assembly_id)
    ||!Array.isArray(v.definitions)||v.definitions.length<1||v.definitions.length>128||v.definitions.some(x=>!primitive(x))
    ||!Array.isArray(v.instances)||v.instances.length<1||v.instances.length>512||!Array.isArray(v.views)||v.views.length<1||v.views.length>4)return null
  const defs=v.definitions as CadPrimitive[], ids=new Set(defs.map(d=>d.id)); if(ids.size!==defs.length||defs.reduce((n,d)=>n+(d.cuts?.length??0),0)>256)return null
  const seen=new Set<string>()
  for(const raw of v.instances){if(!obj(raw)||!exact(raw,['id','definition_id','placement'])||!id(raw.id)||seen.has(raw.id)||!id(raw.definition_id)||!ids.has(raw.definition_id)||!place(raw.placement))return null;seen.add(raw.id)}
  const allowed=new Set<CadView>(['front','right','top','isometric'])
  if(new Set(v.views).size!==v.views.length||v.views.some(x=>typeof x!=='string'||!allowed.has(x as CadView)))return null
  const checkIds=new Set<string>()
  const checkId=(x:unknown)=>{if(!id(x)||checkIds.has(x))return false;checkIds.add(x);return true}
  if(v.clearances!==undefined&&(!Array.isArray(v.clearances)||v.clearances.length>16||v.clearances.some(c=>!obj(c)||!exact(c,['id','first_id','second_id','min_mm'])||!checkId(c.id)||!seen.has(c.first_id as string)||!seen.has(c.second_id as string)||c.first_id===c.second_id||!finite(c.min_mm,1e6)||c.min_mm<0)))return null
  const instanceList=(x:unknown,limit:number):x is string[]=>Array.isArray(x)&&x.length>0&&x.length<=limit&&new Set(x).size===x.length&&x.every(a=>seen.has(a))
  if(v.motions!==undefined&&(!Array.isArray(v.motions)||v.motions.length>16||v.motions.some(c=>!obj(c)||!exact(c,['id','moving_ids','obstacle_ids','delta'])||!checkId(c.id)||!instanceList(c.moving_ids,8)||!instanceList(c.obstacle_ids,32)||c.moving_ids.some(a=>(c.obstacle_ids as string[]).includes(a))||!obj(c.delta)||!exact(c.delta,['x','y','z'])||!['x','y','z'].every(k=>finite((c.delta as Record<string,unknown>)[k],1e6)))))return null
  return v as unknown as CadAssemblyRequest
}
const stable=(v:unknown):string=>JSON.stringify(v,(_key,value)=>obj(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)
const vec=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x,1e7))
const bounds=(v:unknown)=>obj(v)&&exact(v,['min','max','size'])&&vec(v.min)&&vec(v.max)&&vec(v.size)
  &&(v.size as number[]).every((n,i)=>n>=0&&Math.abs(((v.max as number[])[i]-(v.min as number[])[i])-n)<0.001)
function checkedGeometry(v:unknown,r:CadAssemblyRequest){
  if(!obj(v)||!exact(v,['collisions','clearances','motions'])||!obj(v.collisions)||!Array.isArray(v.clearances)||!Array.isArray(v.motions))return false
  const c=v.collisions,ids=new Set(r.instances.map(i=>i.id))
  if(!['complete','partial'].includes(String(c.status))||!Number.isSafeInteger(c.tested_pairs)||Number(c.tested_pairs)<0||Number(c.tested_pairs)>256
    ||!Number.isSafeInteger(c.skipped_pairs)||Number(c.skipped_pairs)<0||Number(c.skipped_pairs)>130816||(c.status==='complete')!==(c.skipped_pairs===0)
    ||!Array.isArray(c.overlaps)||c.overlaps.length>Number(c.tested_pairs)||c.overlaps.some(x=>!obj(x)||!ids.has(x.first_id as string)||!ids.has(x.second_id as string)||x.first_id===x.second_id||!finite(x.volume_mm3,1e19,true)))return false
  if(v.clearances.length!==(r.clearances?.length??0)||v.motions.length!==(r.motions?.length??0))return false
  if(v.clearances.some((x,i)=>{const expected=r.clearances![i];return !obj(x)||x.id!==expected.id||x.first_id!==expected.first_id||x.second_id!==expected.second_id||x.min_mm!==expected.min_mm
    ||!finite(x.distance_mm,4e7)||x.distance_mm<0||x.status!==(x.distance_mm+1e-6>=expected.min_mm?'clear':'insufficient')}))return false
  if(v.motions.some((x,i)=>{const expected=r.motions![i];return !obj(x)||x.id!==expected.id||x.method!=='swept_aabb_translation'||!Array.isArray(x.pairs)||x.pairs.length>256
    ||x.status!==(x.pairs.length?'potential_obstruction':'clear_envelope')||x.pairs.some(p=>!obj(p)||!expected.moving_ids.includes(p.moving_id as string)||!expected.obstacle_ids.includes(p.obstacle_id as string))}))return false
  return true
}
export function parseCadAssemblyResult(v:unknown,r:CadAssemblyRequest):CadAssemblyResult|null{
  if(!obj(v)||v.contract_version!==1||v.assembly_id!==r.assembly_id||!obj(v.engine)||v.engine.name!=='build123d'||v.engine.version!=='0.13.0'||v.engine.units!=='mm'
    ||!bounds(v.bounding_box_mm)||!Array.isArray(v.instances)||v.instances.length!==r.instances.length||!obj(v.exports))return null
  if(stable(v.definitions)!==stable(r.definitions))return null
  if((r.clearances?.length||r.motions?.length)&&!obj(v.checks))return null
  if(v.checks!==undefined&&!checkedGeometry(v.checks,r))return null
  const seen=new Set<string>()
  for(const row of v.instances){if(!obj(row)||typeof row.id!=='string'||seen.has(row.id)||!r.instances.some(i=>i.id===row.id&&i.definition_id===row.definition_id)||!bounds(row.bounding_box_mm))return null;seen.add(row.id)}
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
