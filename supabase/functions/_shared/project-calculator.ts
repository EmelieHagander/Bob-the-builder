import { CAD_PARAMETERS_SCHEMA, CadParameterGap, compileParameterGraph, inheritCadParameters, parseParameterPlan, parameterSourcePins, type CadParameters, type ParameterInput } from './cad-parameters.ts'
import { checkedBuildingPlan, UUID } from '../../../src/lib/buildingPlan.ts'
import { checkedStairStudy, stairSpec, stairSummary, type StairSpec } from '../../../src/lib/stairStudy.ts'
import { STAIR_SPEC_SCHEMA } from './project-stair.ts'
import { schemaIssues } from './schema-issues.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { AiCatalogSession } from './ai-catalog.ts'

const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const uuid={type:'string',format:'uuid'},revision={type:'integer',minimum:1,maximum:2147483647}
const method=(name:string)=>({type:'string',enum:[name]})
const graphNodes=CAD_PARAMETERS_SCHEMA.properties.nodes
const stairRecipe=STAIR_SPEC_SCHEMA
export const CALCULATOR_TOOL={type:'function' as const,function:{name:'calculate_project',
 description:'Read-only code calculator. Execute a versioned parameter graph, inspect a stair on an exact authorised plan, replay an exact saved construction/stair, replay purchase arithmetic on an exact material need, or quote aggregate supplier packs. Source inputs use database IDs/revisions, never copied measured values. Graph units: mm, deg, scalar; a multiplication needs a scalar. Return method versions, named inputs, dependencies, provenance, units, rounding and current-source readiness. Missing/unsupported inputs remain gaps. Preview does not save; persist models through save_construction_draft, save_project_stair or the canonical material writer. Historical replay never adopts changed sources or replaces an old result. No eval, general area/money graph, physical approval, stock reservation or purchase.',
 parameters:obj({calculation:{anyOf:[
  obj({method:method('parameter_graph_v1'),nodes:graphNodes,outputs:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'}}}),
  obj({method:method('construction_parameters_v1'),record_id:uuid,revision}),
  obj({method:method('stair_study_v1'),plan_id:uuid,plan_revision:revision,recipe:stairRecipe}),
  obj({method:method('saved_stair_study_v1'),record_id:uuid,revision}),
  obj({method:method('material_purchase_v1'),requirement_id:uuid,revision}),
  obj({method:method('pack_purchase_v1'),article_id:uuid,article_revision:revision,needs:{type:'array',minItems:1,maxItems:24,items:obj({id:uuid,revision})}}),
 ]}})}}

export function hasCalculatorContract(catalog:AiCatalogSession){return catalog.manifest().definitions.some(row=>row.prompt_key==='tools.calculate_project')}
export type CalculationSourceKind='plan'|'stair'|'material'
export type CalculatorOptions={projectId:string;hasAccess:()=>Promise<boolean>;unlimitedWork?:boolean;
 isEnabled?:()=>Promise<boolean>;
 readConstruction:(id:string,revision:number|null)=>Promise<Record<string,any>>;
 readSource:(kind:CalculationSourceKind,id:string,revision:number)=>Promise<Record<string,any>>;
 readSources:(pins:ReturnType<typeof parameterSourcePins>)=>Promise<{project:Map<string,Record<string,any>>;physical:Map<string,Record<string,any>>}>;
 quotePacks:(id:string,revision:number,needs:{id:string;revision:number}[])=>Promise<Record<string,any>>;
}

function graphResult(nodes:CadParameters['nodes'],outputs:CadParameters['nodes']){
 return {inputs:nodes.filter(n=>n.role!=='derived').map(n=>({id:n.id,role:n.role,value:n.normalized.value,unit:n.normalized.unit,
  ...('reason' in n?{reason:n.reason}:{}),sources:n.sources})),
 dependencies:nodes.filter((n):n is CadParameters['nodes'][number]&Extract<ParameterInput,{role:'derived'}>=>n.role==='derived')
  .map(n=>({id:n.id,operation:n.operation,version:1,operands:n.operands,rounding:n.rounding})),
 outputs:outputs.map(n=>({id:n.id,...n.normalized,rounding:n.role==='derived'?n.rounding:'exact',precision:'decimal_6'}))}
}
function stairResult(plan:ReturnType<typeof checkedBuildingPlan>,recipe:StairSpec){
 const summary=stairSummary(plan.recipe,recipe)
 const levels=[recipe.from_level_id,recipe.to_level_id].map(id=>plan.recipe.levels.find(l=>l.level_id===id)!)
 return {inputs:[...levels.map(l=>({id:l.level_id,value:l.floor_z_mm,unit:'mm',role:l.basis,
   source:{kind:'multifloor_plan',id:plan.artifact_id,revision:plan.artifact_revision,level_id:l.level_id,level_revision:l.level_revision}})),
  ...['risers','going_mm','required_headroom_mm'].map(k=>({id:k,value:recipe[k as keyof StairSpec],unit:k==='risers'?'scalar':'mm',role:recipe.basis,reason:recipe.source}))],
 dependencies:[{id:'rise_mm',operation:'stair_equal_rise_v1',operands:['rise_total_mm','risers'],rounding:'binary64_unrounded'},
  {id:'step_formula_mm',operation:'stair_step_formula_v1',operands:['rise_mm','going_mm'],rounding:'binary64_unrounded'}],
 outputs:([
  ['rise_total_mm',summary.rise_total_mm,'mm'],['rise_mm',summary.rise_mm,'mm'],['step_formula_mm',summary.step_formula_mm,'mm'],
  ['pitch_degrees',summary.pitch_degrees,'deg'],['walking_length_mm',summary.walking_length_mm,'mm'],
  ['minimum_known_headroom_mm',summary.headroom.minimum_known_mm,'mm'],
 ] as const).map(([id,value,unit])=>({id,value,unit,rounding:'binary64_unrounded',
  display:value===null?null:value.toFixed(3),display_rounding:'js_toFixed_3',display_is_input:false})),
 recipe,summary,numerical_policy:{geometry_mm:'0.001',rise_and_trigonometry:'binary64_unrounded',display:'js_toFixed_3; never feed display-rounded rise into totals or criteria'}}
}

/** Shared by Bob and specialists in one turn. Invalid attempts count; live
 * caller access is checked before and after every read, including replay. */
export interface ProjectCalculatorState { version:1; used:number }
export function createProjectCalculator(opts:CalculatorOptions){
 let used=0
 const enabled=async()=>{try{return await opts.isEnabled?.()??true}catch(error){rethrowContinuation(error);return false}}
 return {
 exportState():ProjectCalculatorState{return {version:1,used}},
 restoreState(state:ProjectCalculatorState){if(state?.version!==1||!Number.isSafeInteger(state.used)||state.used<0)throw new Error('project_calculator_checkpoint_invalid');used=state.used},
 tools:[CALCULATOR_TOOL],get remaining(){return opts.unlimitedWork?Infinity:Math.max(0,12-used)},
 async offered(){return (opts.unlimitedWork||used<12)&&await opts.hasAccess()&&await enabled()?[CALCULATOR_TOOL]:[]},
 async execute(raw:unknown):Promise<Record<string,any>>{
  if(++used>12&&!opts.unlimitedWork)return {status:'budget_exhausted',saved:false}
  const issues=schemaIssues(CALCULATOR_TOOL.function.parameters,raw)
  if(issues.length)return {status:'invalid',saved:false,issues}
  if(!await opts.hasAccess())return {status:'denied',saved:false}
  if(!await enabled())return {status:'unavailable',saved:false,reason:'calculator_policy_unavailable'}
  const c=structuredClone((raw as any).calculation)
  for(const key of ['record_id','plan_id','requirement_id','article_id'])if(key in c){
   if(!UUID.test(c[key]))return {status:'invalid',saved:false,reason:'invalid_calculation_reference'}
   c[key]=c[key].toLowerCase()
  }
  if(c.needs){
   if(c.needs.some((n:any)=>!UUID.test(n.id))||new Set(c.needs.map((n:any)=>n.id.toLowerCase())).size!==c.needs.length)return {status:'invalid',saved:false,reason:'invalid_calculation_reference'}
   c.needs=c.needs.map((n:any)=>({...n,id:n.id.toLowerCase()}))
  }
  try{
   let result:Record<string,any>
   const base={status:'calculated',schema_version:1,project_id:opts.projectId,saved:false}
   if(c.method==='parameter_graph_v1'){
    const plan=parseParameterPlan({version:1,frames:[],nodes:c.nodes,bindings:[]})
    const sources=await opts.readSources(parameterSourcePins(plan))
    const graph=compileParameterGraph(opts.projectId,plan.nodes,c.outputs,sources.project,sources.physical)
    result={...base,method:{id:c.method,version:1},model:{owner:'preview',persisted:false},source_state:'proposed',
     ...graphResult(graph.nodes,graph.outputs),save_tools:['save_construction_draft']}
   }else if(c.method==='construction_parameters_v1'){
    const row=await opts.readConstruction(c.record_id,c.revision)
    if(row?.status==='not_found')return {status:'not_found',saved:false}
    if(row?.status!=='ok'||row.projectId!==opts.projectId||row.artifact_id!==c.record_id||row.revision!==c.revision)throw new Error('calculation_source_unavailable')
    const parameters=inheritCadParameters(opts.projectId,row.recipe,row.parameters,structuredClone(row.recipe))
    const current=await opts.readConstruction(c.record_id,null)
    if(current?.status!=='ok'||current.projectId!==opts.projectId||current.artifact_id!==c.record_id)throw new Error('calculation_source_unavailable')
    result={...base,method:{id:c.method,version:1},model:{owner:'construction',id:c.record_id,revision:c.revision,persisted:true},
     source_state:current.revision===c.revision&&current.source_state==='current'&&!current.archived?'current':'changed',
     ...graphResult(parameters.nodes,parameters.nodes.filter(n=>n.role==='derived')),bindings:parameters.bindings,
     save_tools:['change_construction_parameters','save_construction_draft']}
   }else if(c.method==='stair_study_v1'||c.method==='saved_stair_study_v1'){
    const saved=c.method==='saved_stair_study_v1'
    const id=saved?c.record_id:c.plan_id,rev=saved?c.revision:c.plan_revision
    const source=await opts.readSource(saved?'stair':'plan',id,rev)
    if(source?.status==='not_found')return {status:'not_found',saved:false}
    if(source?.status!=='ok'||source.project_id!==opts.projectId||source.id!==id||source.revision!==rev)throw new Error('calculation_source_unavailable')
    const study=saved?checkedStairStudy(source.record,opts.projectId,id,rev):null
    const plan=study?.plan??checkedBuildingPlan(source.record,opts.projectId,id,rev)
    const recipe=study?.recipe??stairSpec(c.recipe)
    const missing=plan.recipe.levels.filter(l=>[recipe.from_level_id,recipe.to_level_id].includes(l.level_id)&&l.floor_z_mm===null)
    if(missing.length)return {status:'needs_data',saved:false,gaps:missing.map(l=>({id:l.level_id+'.floor_z_mm',unit:'mm',reason:'Floor elevation is unknown in the exact source plan.'}))}
    result={...base,method:{id:'stair_study_v1',version:1},model:{owner:saved?'stair':'preview',id,revision:rev,persisted:saved},
     source_state:source.source_state,...stairResult(plan,recipe),save_tools:['save_project_stair']}
   }else if(c.method==='material_purchase_v1'){
    const source=await opts.readSource('material',c.requirement_id,c.revision)
    if(source?.status==='not_found')return {status:'not_found',saved:false}
    if(source?.status!=='ok'||source.project_id!==opts.projectId||source.id!==c.requirement_id||source.revision!==c.revision||!source.calculation)throw new Error('calculation_source_unavailable')
    result={...base,method:{id:c.method,version:1},model:{owner:'material_requirement',id:c.requirement_id,revision:c.revision,persisted:true},
     source_state:source.source_state,...source.calculation,save_tools:['manage_project_material','derive_cad_material_requirement']}
   }else{
    const quote=await opts.quotePacks(c.article_id,c.article_revision,c.needs)
    if(quote.article_id!==c.article_id||quote.article_revision!==c.article_revision||quote.calculation_version!=='k4-pack-aggregate-v1')throw new Error('calculation_source_unavailable')
    result={...base,method:{id:'k4-pack-aggregate-v1',version:1},model:{owner:'preview',persisted:false},source_state:['current','changed'].includes(quote.source_state)?quote.source_state:'unknown',
     inputs:quote.needs,dependencies:[{id:'purchase_count',operation:'aggregate_then_ceil_v1',rounding:'whole_pack_ceiling'}],
     outputs:[{id:'purchase_count',value:quote.purchase_count,unit:quote.purchase_unit,rounding:'whole_pack_ceiling'},
      {id:'surplus_quantity',value:quote.surplus_quantity,unit:quote.content_unit,rounding:'exact'}],quote,
     gaps:quote.pack_state==='unknown'?['content_per_purchase_unit']:[],save_tools:['manage_project_material']}
   }
   if(!await opts.hasAccess())return {status:'denied',saved:false}
   if(!await enabled())return {status:'unavailable',saved:false,reason:'calculator_policy_unavailable'}
   if(new TextEncoder().encode(JSON.stringify(result)).length>256*1024)return {status:'record_too_large',saved:false}
   return result
  }catch(error){
   rethrowContinuation(error)
   if(error instanceof CadParameterGap)return {status:'needs_data',saved:false,gaps:error.gaps}
   const reason=error instanceof Error?error.message:''
   return /^(invalid_parameter_[a-z_]+|parameter_[a-z_]+|invalid_saved_parameters)$/.test(reason)
    ?{status:'invalid',saved:false,reason}:{status:'unavailable',saved:false,reason:'calculation_source_unavailable'}
  }
 }}
}
export type ProjectCalculator=ReturnType<typeof createProjectCalculator>
