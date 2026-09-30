import {parseCadFrames,compileCadFrames,cadCoordinateSystem,frameParameterIds,CAD_FRAMES_SCHEMA,type CadFrameInput,type CadFrame} from './cad-frames.ts'
import {CAD_DIMENSIONS,measurementMillimetres,type CadLineage} from './cad-lineage.ts'
import type {CadAssemblyRequest} from './cad-adapter.ts'

export type ParameterUnit='mm'|'deg'|'scalar'
export type ParameterSource=CadLineage['bindings'][number]['source']
type Ref={kind:'project_measurement';id:string;revision:number}|{kind:'space_measurement';id:string;space_revision:number}
export type ParameterInput=
 |{id:string;role:'source';source:Ref}
 |{id:string;role:'decision'|'estimate';value:number;unit:ParameterUnit;reason:string}
 |{id:string;role:'derived';operation:'add_v1'|'subtract_v1'|'multiply_v1'|'divide_v1';operands:[string,string];rounding:'exact'|'half_away_6'}
 |{id:string;role:'unknown';unit:ParameterUnit;reason:string}
export type ParameterPlan={version:1;frames:CadFrameInput[];nodes:ParameterInput[];bindings:{path:string;node:string}[]}
export type CadParameters={version:1;project_id:string;coverage:'complete';precision:'decimal_6';coordinate_system:ReturnType<typeof cadCoordinateSystem>;frames:CadFrame[];nodes:(ParameterInput&{normalized:{value:number;unit:ParameterUnit};sources:ParameterSource[]})[];bindings:ParameterPlan['bindings']}
const exact=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const id=(v:any):v is string=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(v)
const uuid=(v:any):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const unit=(v:any):v is ParameterUnit=>['mm','deg','scalar'].includes(v)
const reason=(v:any)=>typeof v==='string'&&!!v.trim()&&v.length<=2000
const scale=1000000n
export class CadParameterSourceError extends Error {
 constructor(message:string,readonly technical=false){super(message)}
}
export class CadParameterGap extends Error {
 constructor(readonly gaps:{id:string;unit:ParameterUnit;reason:string}[]){super('unknown_required_parameters')}
}
function decimal(v:unknown):bigint{
 if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e9||Number(v.toFixed(6))!==v)throw new Error('parameter_precision')
 const [whole,fraction]=Math.abs(v).toFixed(6).split('.')
 return (BigInt(whole)*scale+BigInt(fraction))*(v<0?-1n:1n)
}
const number=(v:bigint)=>{const n=Number(v)/1e6;decimal(n);return n}
function quotient(a:bigint,b:bigint,rounding:string){
 if(b===0n)throw new Error('parameter_division_by_zero')
 const q=a/b,r=a%b
 if(!r)return q
 if(rounding==='exact')throw new Error('parameter_inexact_result')
 const abs=(v:bigint)=>v<0n?-v:v
 return q+(abs(r)*2n>=abs(b)?((a<0n)!==(b<0n)?-1n:1n):0n)
}

/** Enumerate controlling numbers from the recipe itself; model declarations
 * cannot choose which dimensions, cuts, placements or checks need provenance. */
export function cadParameterTargets(recipe:CadAssemblyRequest){
 const targets=new Map<string,{unit:ParameterUnit;get:()=>number;set:(n:number)=>void}>()
 const add=(path:string,obj:any,key:string,u:ParameterUnit='mm')=>targets.set(path,{unit:u,get:()=>obj[key],set:n=>{obj[key]=n}})
 const place=(path:string,p:any)=>{for(const k of ['x','y','z','rx','ry','rz'])add(path+'/'+k,p,k,k.startsWith('r')?'deg':'mm')}
 for(const d of recipe.definitions){
  for(const k of CAD_DIMENSIONS)if(Object.prototype.hasOwnProperty.call(d,k))add('definitions/'+d.id+'/'+k,d,k)
  d.cuts?.forEach((c,i)=>{for(const k of CAD_DIMENSIONS)if(Object.prototype.hasOwnProperty.call(c,k))add('definitions/'+d.id+'/cuts/'+i+'/'+k,c,k);place('definitions/'+d.id+'/cuts/'+i+'/placement',c.placement)})
 }
 for(const i of recipe.instances)place('instances/'+i.id+'/placement',i.placement)
 for(const c of recipe.clearances??[])add('clearances/'+c.id+'/min_mm',c,'min_mm')
 for(const m of recipe.motions??[])for(const k of ['x','y','z'])add('motions/'+m.id+'/delta/'+k,m.delta,k)
 return targets
}
export function parseParameterPlan(raw:unknown):ParameterPlan{
 const v=raw as any
 if(!exact(v,['version','frames','nodes','bindings'])||v.version!==1||!Array.isArray(v.nodes)||!v.nodes.length||v.nodes.length>1024||!Array.isArray(v.bindings)||v.bindings.length>8192)throw new Error('invalid_parameter_plan')
 parseCadFrames(v.frames)
 const seen=new Set<string>()
 for(const n of v.nodes){
  if(!id(n?.id)||seen.has(n.id))throw new Error('invalid_parameter_identity');seen.add(n.id)
  if(n.role==='source'){
   const s=n.source
   if(!exact(n,['id','role','source'])||!uuid(s?.id)||!(s.kind==='project_measurement'&&exact(s,['kind','id','revision'])&&Number.isSafeInteger(s.revision)&&s.revision>0||s.kind==='space_measurement'&&exact(s,['kind','id','space_revision'])&&Number.isSafeInteger(s.space_revision)&&s.space_revision>0))throw new Error('invalid_parameter_source')
  }else if(n.role==='decision'||n.role==='estimate'){
   if(!exact(n,['id','role','value','unit','reason'])||!unit(n.unit)||!reason(n.reason))throw new Error('invalid_parameter_decision');decimal(n.value)
  }else if(n.role==='derived'){
   if(!exact(n,['id','role','operation','operands','rounding'])||!['add_v1','subtract_v1','multiply_v1','divide_v1'].includes(n.operation)||!['exact','half_away_6'].includes(n.rounding)||!Array.isArray(n.operands)||n.operands.length!==2||!n.operands.every(id))throw new Error('invalid_parameter_formula')
  }else if(n.role!=='unknown'||!exact(n,['id','role','unit','reason'])||!unit(n.unit)||!reason(n.reason))throw new Error('invalid_parameter_role')
 }
 const paths=new Set<string>()
 for(const b of v.bindings){if(!exact(b,['path','node'])||typeof b.path!=='string'||b.path.length>240||paths.has(b.path)||!id(b.node))throw new Error('invalid_parameter_binding');paths.add(b.path)}
 return structuredClone(v)
}
export function parameterSourcePins(plan:ParameterPlan){
 const project=new Map<string,number>(),physical=new Map<string,number>()
 for(const n of plan.nodes)if(n.role==='source'){
  const source=n.source, map=source.kind==='project_measurement'?project:physical, revision=source.kind==='project_measurement'?source.revision:source.space_revision
  if(map.has(source.id)&&map.get(source.id)!==revision)throw new Error('conflicting_parameter_source')
  map.set(source.id,revision)
 }
 if(project.size>20||physical.size>20)throw new Error('parameter_source_budget')
 return {project:[...project].map(([id,revision])=>({id,revision})),physical:[...physical].map(([space_measurement_id,space_revision])=>({space_measurement_id,space_revision}))}
}
function sourceSnapshot(projectId:string,ref:Ref,project:Map<string,Record<string,any>>,physical:Map<string,Record<string,any>>):ParameterSource{
 const r=(ref.kind==='project_measurement'?project:physical).get(ref.id)
 if(!r||r.id!==ref.id||!['measured','provided_spec','estimated'].includes(r.truth)||!reason(r.source))throw new Error('parameter_source_unavailable')
 if(ref.kind==='project_measurement'){
  if(r.revision!==ref.revision||r.archived||r.project_id!=null&&r.project_id!==projectId)throw new Error('parameter_source_changed')
  return {kind:ref.kind,id:ref.id,revision:ref.revision,value:String(r.value),unit:r.unit,truth:r.truth,description:r.source}
 }
 if(r.space_revision!==ref.space_revision||![r.building_id,r.space_id,r.measurement_id].every(uuid)||!Number.isSafeInteger(r.measurement_revision)||r.measurement_revision<1)throw new Error('parameter_source_changed')
 return {kind:ref.kind,id:ref.id,building_id:r.building_id,space_id:r.space_id,space_revision:r.space_revision,measurement_id:r.measurement_id,measurement_revision:r.measurement_revision,value:String(r.value),unit:r.unit,truth:r.truth,description:r.source}
}

/** Evaluate a declarative DAG with decimal arithmetic. No executable model code,
 * implicit unit conversions, inferred decisions or unknown-to-zero coercion. */
export function compileCadParameters(projectId:string,recipe:CadAssemblyRequest,raw:unknown,project:Map<string,Record<string,any>>,physical:Map<string,Record<string,any>>,images=new Map<string,string>()):CadParameters{
 const plan=parseParameterPlan(raw),targets=cadParameterTargets(recipe),inputs=new Map(plan.nodes.map(n=>[n.id,n]))
 parameterSourcePins(plan)
 const result=new Map<string,CadParameters['nodes'][number]>(),active=new Set<string>()
 const missing=[...targets.keys()].filter(path=>!plan.bindings.some(b=>b.path===path))
 for(const f of plan.frames)if(f.kind==='image'&&!images.has(f.source_ref))throw new Error('coordinate_image_unread')
 const unknown=plan.nodes.filter((n):n is Extract<ParameterInput,{role:'unknown'}>=>n.role==='unknown')
 const frameGaps=plan.frames.filter(f=>f.required&&f.placement===null).map(f=>({id:f.id,unit:'scalar' as const,reason:f.reason}))
 if(unknown.length||frameGaps.length)throw new CadParameterGap([...unknown.map(({id,unit,reason})=>({id,unit,reason})),...frameGaps])
 if(missing.length)throw new Error('parameter_gaps:'+JSON.stringify({unbound:missing}))
 function evaluate(key:string):CadParameters['nodes'][number]{
  if(result.has(key))return result.get(key)!
  if(active.has(key))throw new Error('parameter_cycle')
  const n=inputs.get(key);if(!n)throw new Error('parameter_operand_missing')
  active.add(key)
  let value:number,u:ParameterUnit,sources:ParameterSource[]=[]
  if(n.role==='source'){
   const source=sourceSnapshot(projectId,n.source,project,physical)
   value=measurementMillimetres(source);u='mm';sources=[source]
  }else if(n.role==='decision'||n.role==='estimate'){value=n.value;u=n.unit}
  else if(n.role==='derived'){
   const [a,b]=n.operands.map(evaluate),x=decimal(a.normalized.value),y=decimal(b.normalized.value)
   const au=a.normalized.unit,bu=b.normalized.unit
   let v:bigint
   if(n.operation==='add_v1'||n.operation==='subtract_v1'){
    if(au!==bu)throw new Error('parameter_unit_mismatch');u=au;v=n.operation==='add_v1'?x+y:x-y
   }else if(n.operation==='multiply_v1'){
    if(au!=='scalar'&&bu!=='scalar')throw new Error('parameter_unit_mismatch');u=au==='scalar'?bu:au;v=quotient(x*y,scale,n.rounding)
   }else{
    if(bu!=='scalar'&&au!==bu)throw new Error('parameter_unit_mismatch');u=au===bu?'scalar':au;v=quotient(x*scale,y,n.rounding)
   }
   value=number(v)
   // Operand IDs retain the dependency graph. Keep each original snapshot only
   // on its source node; copying it into every descendant grows quadratically.
  }else throw new Error('parameter_unknown')
  decimal(value)
  const evaluated={...n,normalized:{value,unit:u},sources}
  active.delete(key);result.set(key,evaluated);return evaluated
 }
 const writes:{set:(n:number)=>void;value:number}[]=[]
 for(const b of plan.bindings){
  const t=targets.get(b.path);if(!t)throw new Error('parameter_path_missing')
  const n=evaluate(b.node);if(n.normalized.unit!==t.unit)throw new Error('parameter_unit_mismatch')
  writes.push({set:t.set,value:n.normalized.value})
 }
 const frames=compileCadFrames(plan.frames,evaluate,images)
 if(result.size!==plan.nodes.length)throw new Error('parameter_unused_node')
 for(const write of writes)write.set(write.value)
 return {version:1,project_id:projectId,coverage:'complete',precision:'decimal_6',coordinate_system:cadCoordinateSystem(recipe),frames,nodes:[...result.values()],bindings:plan.bindings}
}

export function cadParameterSources(value:CadParameters|undefined):ParameterSource[]{
 return value?.nodes.flatMap(n=>n.role==='source'?n.sources:[])??[]
}
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)
/** Recompute stored nodes and geometry before selecting a detail. Inheritance
 * retains only dependencies reachable from the selected parameter bindings. */
export function inheritCadParameters(projectId:string,sourceRecipe:CadAssemblyRequest,stored:unknown,recipe:CadAssemblyRequest):CadParameters{
 const v=stored as CadParameters
 if(!exact(v,['version','project_id','coverage','precision','coordinate_system','frames','nodes','bindings'])||v.version!==1||v.project_id!==projectId||v.coverage!=='complete'||v.precision!=='decimal_6'||!Array.isArray(v.nodes))throw new Error('invalid_saved_parameters')
 const project=new Map<string,Record<string,any>>(),physical=new Map<string,Record<string,any>>()
 const nodes=v.nodes.map(n=>{
  const {normalized,sources,...input}=n
  if(!exact(normalized,['value','unit'])||!Array.isArray(sources))throw new Error('invalid_saved_parameters')
  if(n.role==='source'){
   if(sources.length!==1)throw new Error('invalid_saved_parameters')
   const s=sources[0];if(!s||s.kind!==n.source.kind||s.id!==n.source.id)throw new Error('invalid_saved_parameters')
   const record={...s,source:s.description,project_id:projectId}
   ;(s.kind==='project_measurement'?project:physical).set(s.id,record)
  }else if(sources.length)throw new Error('invalid_saved_parameters')
  return input as ParameterInput
 })
 if(!Array.isArray(v.frames))throw new Error('invalid_saved_parameters')
 const frames=v.frames.map(({source_version,translation_mm,rotation_degrees,axes,...f})=>f),images=new Map(v.frames.filter(f=>f.kind==='image').map(f=>[f.source_ref,f.source_version!] as [string,string]))
 const original=structuredClone(sourceRecipe)
 const checked=compileCadParameters(projectId,original,{version:1,frames,nodes,bindings:v.bindings},project,physical,images)
 if(stable(original)!==stable(sourceRecipe)||stable(checked)!==stable(v))throw new Error('invalid_saved_parameters')
 const paths=cadParameterTargets(recipe),bindings=v.bindings.filter(b=>paths.has(b.path)),needed=new Set<string>(),index=new Map(nodes.map(n=>[n.id,n]))
 function retain(id:string){if(needed.has(id))return;needed.add(id);const node=index.get(id)!;if(node.role==='derived')node.operands.forEach(retain)}
 bindings.forEach(b=>retain(b.node));frameParameterIds(frames).forEach(retain)
 const before=stable(recipe),result=compileCadParameters(projectId,recipe,{version:1,frames,nodes:nodes.filter(n=>needed.has(n.id)),bindings},project,physical,images)
 if(stable(recipe)!==before)throw new Error('invalid_saved_parameters')
 return result
}

const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const identifier={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'}
const units={type:'string',enum:['mm','deg','scalar']}
const revision={type:'integer',minimum:1},identity={type:'string',format:'uuid'}
const explanation={type:'string',minLength:1,maxLength:2000}
export const CAD_PARAMETERS_SCHEMA=object({version:{type:'integer',enum:[1]},frames:CAD_FRAMES_SCHEMA,
 nodes:{type:'array',minItems:1,maxItems:1024,items:{anyOf:[
  object({id:identifier,role:{type:'string',enum:['source']},source:{anyOf:[object({kind:{type:'string',enum:['project_measurement']},id:identity,revision}),object({kind:{type:'string',enum:['space_measurement']},id:identity,space_revision:revision})]}}),
  object({id:identifier,role:{type:'string',enum:['decision','estimate']},value:{type:'number',minimum:-1e9,maximum:1e9},unit:units,reason:explanation}),
  object({id:identifier,role:{type:'string',enum:['derived']},operation:{type:'string',enum:['add_v1','subtract_v1','multiply_v1','divide_v1']},operands:{type:'array',minItems:2,maxItems:2,items:identifier},rounding:{type:'string',enum:['exact','half_away_6']}}),
  object({id:identifier,role:{type:'string',enum:['unknown']},unit:units,reason:explanation}),
 ]}},bindings:{type:'array',minItems:1,maxItems:8192,items:object({path:{type:'string',maxLength:240},node:identifier})},
})
