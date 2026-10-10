import {CAD_PARAMETERS_SCHEMA, CadParameterGap, compileCadParameters, inheritCadParameters, parseParameterPlan, parameterSourcePins, type ParameterInput} from './cad-parameters.ts'
import {parseCadAssemblyRequest} from './cad-adapter.ts'

// A delta names existing inputs only. It carries no geometry, bindings, formula,
// catalog pins or normalised values for the model to recreate.
export const CONSTRUCTION_PARAMETER_CHANGES_SCHEMA={type:'array',minItems:1,maxItems:128,items:{anyOf:
 (CAD_PARAMETERS_SCHEMA.properties.nodes as any).items.anyOf.filter((s:any)=>!s.properties.operation)}}
export async function compileConstructionParameterChange(projectId:string,draft:Record<string,any>,changes:ParameterInput[],readSources:(pins:ReturnType<typeof parameterSourcePins>)=>Promise<{project:Map<string,Record<string,any>>;physical:Map<string,Record<string,any>>}>){
 if(draft?.projectId!==projectId||draft.status!=='ok')throw new Error('invalid_parameter_checkpoint')
 const recipe=parseCadAssemblyRequest(structuredClone(draft.recipe))
 if(!recipe)throw new Error('invalid_parameter_checkpoint')
 const checked=inheritCadParameters(projectId,recipe,draft.parameters,structuredClone(recipe))
 const plan=parseParameterPlan({version:1,frames:checked.frames.map(({source_version,translation_mm,rotation_degrees,axes,...f})=>f),
  nodes:checked.nodes.map(({normalized,sources,...n})=>n),bindings:checked.bindings})
 const seen=new Set<string>(),nodes=new Map(plan.nodes.map(n=>[n.id,n])),gaps:CadParameterGap['gaps']=[]
 for(const change of changes){
  const old=nodes.get(change.id)
  if(!old||seen.has(change.id)||old.role==='derived')throw new Error('invalid_parameter_change_identity')
  seen.add(change.id)
  if(change.role==='unknown'){gaps.push({id:change.id,unit:change.unit,reason:change.reason});continue}
  if(change.role!==old.role)throw new Error('invalid_parameter_change_role')
  if(change.role==='source'){
   if(old.role!=='source'||change.source.kind!==old.source.kind||change.source.id!==old.source.id)throw new Error('invalid_parameter_change_source_identity')
  }else if((change.role==='decision'||change.role==='estimate')&&('unit' in old)&&change.unit!==old.unit)throw new Error('parameter_unit_mismatch')
  nodes.set(change.id,change)
 }
 if(gaps.length)throw new CadParameterGap(gaps)
 plan.nodes=plan.nodes.map(n=>nodes.get(n.id)!)
 // The canonical compiler and SQL validator remain the only evaluators.
 const sources=await readSources(parameterSourcePins(plan))
 const parameters=compileCadParameters(projectId,recipe,plan,sources.project,sources.physical)
 if(!parseCadAssemblyRequest(recipe))throw new Error('invalid_parameter_geometry')
 return {recipe,parameters}
}
