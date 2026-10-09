import {fingerprint} from './bob-job-journal.ts'
import {CAD_RESEARCH_CONTRACT} from './cad-research.ts'
import {CAD_REVIEW_CONTRACT} from './cad-review.ts'
import {CAD_TRANSPORT_CONTRACT} from './cad-transport.ts'
import {createAiCatalogSession,type AiCatalogSession,type AiCatalogManifest} from './ai-catalog.ts'
import {BOB_MODEL_BUDGET_POLICY_REVISION} from './bob-model-budget.ts'

const cadRoles=['cad-research','cad-designer','cad-reviewer']
/** Follow catalog references from CAD roles, including server-selected CAD
 * fragments and read-tool contracts. The manifest remains the source, but a
 * new Bob/plan persona or a model-row timestamp cannot restart a paid attempt. */
export function drawingCatalogConfiguration(manifest:AiCatalogManifest){
 const byKey=new Map(manifest.definitions.map(row=>[row.prompt_key,row]))
 const pending=cadRoles.map(role=>'role.'+role),selected=new Set<string>(),models=new Set<string>()
 const cadSources=['cad-assistant.ts','cad-research.ts','cad-review.ts','cad-intake.ts','drawing-review.ts','project-grounding.ts','project-lookup.ts','material-catalog.ts','building-knowledge.ts','project-context/dispatcher.ts']
 for(const row of manifest.definitions){
  const source=row.metadata.migrated_from
  if(/^cad[.-]|^feedback\.cad-/.test(row.prompt_key)||row.prompt_key==='bob.grounding'
    ||typeof source==='string'&&cadSources.some(file=>source.endsWith('/'+file)))pending.push(row.prompt_key)
 }
 const references=(value:unknown):void=>{
  if(typeof value==='string'&&byKey.has(value))pending.push(value)
  else if(Array.isArray(value))value.forEach(references)
  else if(value&&typeof value==='object')Object.values(value).forEach(references)
 }
 while(pending.length){
  const key=pending.pop()!
  if(selected.has(key))continue
  const row=byKey.get(key)
  if(!row)throw new Error('drawing_runtime_unavailable')
  selected.add(key);references(row.definition)
  if(row.definition_kind==='execution_profile'){
   const tier=row.definition.tier??row.definition.model_type
   const binding=manifest.definitions.filter(d=>d.definition_kind==='tier_binding'&&d.definition.tier===tier)
   if(binding.length!==1)throw new Error('drawing_runtime_unavailable')
   pending.push(binding[0].prompt_key)
  }
  if(row.definition_kind==='tier_binding'){
   if(typeof row.definition.model_name!=='string')throw new Error('drawing_runtime_unavailable')
   models.add(row.definition.model_name)
  }
 }
 return {
  definitions:[...selected].sort().map(key=>{const row=byKey.get(key)!;return {key,id:row.id,payload_hash:row.payload_hash}}),
  models:[...models].sort().map(name=>{
   const model=manifest.models.find(row=>row.model_name===name)
   if(!model)throw new Error('drawing_runtime_unavailable')
   return {model_name:model.model_name,provider:model.provider,model_type:model.model_type,max_output_tokens:model.max_output_tokens,
    supports_images:model.supports_images,supports_reasoning:model.supports_reasoning,supports_image_output:model.supports_image_output,
    capabilities:model.capabilities,input_cost_per_1m_tokens:model.input_cost_per_1m_tokens,
    output_cost_per_1m_tokens:model.output_cost_per_1m_tokens,cached_input_cost_per_1m_tokens:model.cached_input_cost_per_1m_tokens}
  }),
 }
}

/** A retry is tied to the actual catalog and flow policy, not retired direct
 * model/settings fields. Existing turns pass their pinned session; a queue
 * eligibility check resolves the current service-owned manifest. Credentials,
 * provider results and retrieval timestamps never enter the fingerprint. */
export async function drawingRuntimeVersion(client:any,configured:{model:boolean;cad:boolean},pinnedCatalog?:AiCatalogSession){
 const catalog=pinnedCatalog??createAiCatalogSession(client.schema('shared'),{app:'bob'})
 const manifest=await catalog.load(),configuration=drawingCatalogConfiguration(manifest)
 const [settings,models]=await Promise.all([
  client.schema('shared').from('ai_settings').select('function_name,module_id,is_enabled')
   .eq('app','bob').eq('coworker_id','bob').in('function_name',['cad-research','cad-designer','cad-reviewer']).in('module_id',['cad','global']).order('function_name').order('module_id').abortSignal(AbortSignal.timeout(10000)),
  client.schema('shared').from('ai_models').select('model_name,is_active').in('model_name',configuration.models.map(row=>row.model_name)).order('model_name').abortSignal(AbortSignal.timeout(10000)),
 ])
 if(settings.error||models.error)throw new Error('drawing_runtime_unavailable')
 const effective=cadRoles.map(role=>settings.data?.find((r:any)=>r.function_name===role&&r.module_id==='cad')??settings.data?.find((r:any)=>r.function_name===role&&r.module_id==='global')??null)
 return fingerprint({engine_contract:2,transport_contract:CAD_TRANSPORT_CONTRACT,research_contract:CAD_RESEARCH_CONTRACT,review_contract:CAD_REVIEW_CONTRACT,
  budget_policy_revision:BOB_MODEL_BUDGET_POLICY_REVISION,configured,catalog:configuration,
  settings:effective.map((row:any)=>row?{function_name:row.function_name,module_id:row.module_id,is_enabled:row.is_enabled}:null),
  live_models:configuration.models.map(model=>({model_name:model.model_name,is_active:models.data?.find((row:any)=>row.model_name===model.model_name)?.is_active===true}))})
}
