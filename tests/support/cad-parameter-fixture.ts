/** Explicit synthetic decisions for existing transport/render fixtures. Never
 * used by production to manufacture missing provenance. */
import {createCadAssistant as production} from '../../supabase/functions/_shared/cad-assistant.ts'
import {createHash} from 'node:crypto'
import {cadParameterTargets,compileCadParameters,type ParameterPlan} from '../../supabase/functions/_shared/cad-parameters.ts'
import type {CadAssemblyRequest} from '../../supabase/functions/_shared/cad-adapter.ts'
import type {CadLineage} from '../../supabase/functions/_shared/cad-lineage.ts'
export function parameterPlan(recipe:CadAssemblyRequest,bindings:any[]=[]):ParameterPlan{
 const plan:ParameterPlan={version:1,frames:[],nodes:[],bindings:[]}
 for(const [path,target] of cadParameterTargets(recipe)){
  const id='p'+createHash('sha256').update(path).digest('hex').slice(0,20)
  const binding=bindings.find(b=>path==='definitions/'+b.definition_id+'/'+b.dimension)
  plan.nodes.push(binding?{id,role:'source',source:binding.space_measurement_id?{kind:'space_measurement',id:binding.space_measurement_id,space_revision:binding.space_revision}:{kind:'project_measurement',id:binding.measurement_id,revision:binding.revision}}:{id,role:'decision',value:target.get(),unit:target.unit,reason:'Explicit synthetic fixture design choice'})
  plan.bindings.push({path,node:id})
 }
 return plan
}
export function parameterPacket(projectId:string,recipe:CadAssemblyRequest,lineage?:CadLineage){
 const project=new Map(),physical=new Map()
 const bindings=lineage?.bindings.map(b=>{
  const s=b.source;(s.kind==='project_measurement'?project:physical).set(s.id,{...s,source:s.description,project_id:projectId})
  return {definition_id:b.definition_id,dimension:b.dimension,...(s.kind==='project_measurement'?{measurement_id:s.id,revision:s.revision}:{space_measurement_id:s.id,space_revision:s.space_revision})}
 })??[]
 return compileCadParameters(projectId,recipe,parameterPlan(recipe,bindings),project,physical)
}

export async function withParameterPlans(promise:any){
 const reply=await promise
 if(!reply?.toolCalls)return reply
 return {...reply,toolCalls:reply.toolCalls.map((call:any)=>{
  if(call.function.name!=='render_cad_candidate')return call
  try{
   const args=JSON.parse(call.function.arguments)
   if(!args.recipe||args.parameter_plan)return call
   args.parameter_plan=parameterPlan(args.recipe,args.dimension_bindings??[])
   return {...call,function:{...call.function,arguments:JSON.stringify(args)}}
  }catch{return call}
 })}
}
export function createCadAssistant(opts:Parameters<typeof production>[0]){
 return production({...opts,callModel:o=>withParameterPlans(opts.callModel(o))})
}
