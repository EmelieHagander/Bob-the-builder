import type {CadAssemblyRequest} from './cad-adapter.ts'
import type {ParameterInput,ParameterPlan} from './cad-parameters.ts'

/** Repeat templates let the designer state "N copies along one axis" once.
 * They expand into ordinary instances plus derived parameter nodes before the
 * existing contract runs, so renderer, saved artifacts and provenance stay unchanged. */
export type CadArray={id:string;definition_id:string;axis:'x'|'y'|'z';count:number}
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/
const exact=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const PLACE=['x','y','z','rx','ry','rz'] as const
export const CAD_ARRAYS_SCHEMA={type:'array',maxItems:64,description:'Repeat templates for evenly spaced identical parts (studs, slats, joists, rungs). Each expands to instances <id>.1..<id>.<count>. Bind arrays/<id>/start/x|y|z|rx|ry|rz (first copy) and arrays/<id>/spacing_mm (centre-to-centre step along axis); do not bind the expanded instances. Copy N sits at start + (N-1) x spacing along axis.',
 items:{type:'object',additionalProperties:false,required:['id','definition_id','axis','count'],properties:{id:{type:'string',pattern:ID.source},definition_id:{type:'string',pattern:ID.source},axis:{type:'string',enum:['x','y','z']},count:{type:'integer',minimum:2,maximum:256}}}}

export function expandCadArrays(raw:unknown,plan:ParameterPlan):{recipe:unknown;plan:ParameterPlan}{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!('arrays' in raw))return {recipe:raw,plan}
 const {arrays,...rest}=raw as Record<string,any>
 if(!Array.isArray(arrays)||arrays.length>64)throw new Error('invalid_cad_array')
 const recipe=structuredClone(rest) as CadAssemblyRequest
 if(!Array.isArray(recipe.instances))recipe.instances=[]
 const nodes:ParameterInput[]=[...plan.nodes],ids=new Set(nodes.map(n=>n.id)),instanceIds=new Set(recipe.instances.map(i=>i?.id))
 const consumed=new Set<string>(),bound=new Map(plan.bindings.map(b=>[b.path,b.node]))
 const node=(path:string)=>{const n=bound.get(path);if(!n)throw new Error('parameter_gaps:'+JSON.stringify({unbound:[path]}));consumed.add(path);return n}
 const add=(n:ParameterInput)=>{if(ids.has(n.id))throw new Error('cad_array_node_conflict:'+n.id);ids.add(n.id);nodes.push(n)}
 const bindings:ParameterPlan['bindings']=[],shared=new Set<string>()
 for(const a of arrays as CadArray[]){
  if(!exact(a,['id','definition_id','axis','count'])||!ID.test(a.id)||!ID.test(a.definition_id)||!['x','y','z'].includes(a.axis)||!Number.isSafeInteger(a.count)||a.count<2||a.count>256)throw new Error('invalid_cad_array')
  const start=Object.fromEntries(PLACE.map(k=>[k,node(`arrays/${a.id}/start/${k}`)])),spacing=node(`arrays/${a.id}/spacing_mm`)
  for(let i=0;i<a.count;i++){
   const id=`${a.id}.${i+1}`
   if(!ID.test(id)||instanceIds.has(id))throw new Error('cad_array_instance_conflict:'+id)
   instanceIds.add(id);recipe.instances.push({id,definition_id:a.definition_id,placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}})
   let along=start[a.axis]
   if(i>0){
    const index=`repeat.n${i}`,offset=`${a.id}.o${i}`;along=`${a.id}.p${i}`
    if(!shared.has(index)){add({id:index,role:'decision',value:i,unit:'scalar',reason:`Step count from the first copy of a repeat`});shared.add(index)}
    add({id:offset,role:'derived',operation:'multiply_v1',operands:[spacing,index],rounding:'exact'})
    add({id:along,role:'derived',operation:'add_v1',operands:[start[a.axis],offset],rounding:'exact'})
   }
   for(const k of PLACE)bindings.push({path:`instances/${id}/placement/${k}`,node:k===a.axis?along:start[k]})
  }
 }
 const leftover=plan.bindings.filter(b=>b.path.startsWith('arrays/')&&!consumed.has(b.path))
 if(leftover.length)throw new Error('cad_array_unknown_binding:'+leftover[0].path)
 // Expanded graphs share the stored parameter limit (db: 1..1024 nodes).
 if(nodes.length>1024)throw new Error('cad_array_parameter_budget: split the construction or use fewer copies')
 return {recipe,plan:{...plan,nodes,bindings:[...plan.bindings.filter(b=>!consumed.has(b.path)),...bindings]}}
}
