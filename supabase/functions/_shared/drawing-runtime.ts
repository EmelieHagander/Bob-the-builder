import {fingerprint} from './bob-job-journal.ts'
import {CAD_RESEARCH_CONTRACT} from './cad-research.ts'

/** Only Bob's CAD settings and advertised model capabilities affect this hash.
 * Credentials and provider responses never enter it. A changed technical
 * configuration can release a prior failure; a new timestamp alone cannot. */
export async function drawingRuntimeVersion(client:any,configured:{model:boolean;cad:boolean}){
 const [settings,models]=await Promise.all([
  client.schema('shared').from('ai_settings').select('function_name,module_id,model,max_output_tokens,temperature,reasoning_effort,is_enabled')
   .eq('app','bob').eq('coworker_id','bob').in('function_name',['cad-research','cad-designer','cad-reviewer']).in('module_id',['cad','global']).order('function_name').order('module_id').abortSignal(AbortSignal.timeout(10000)),
  client.schema('shared').from('ai_models').select('model_name,max_output_tokens,supports_images,supports_reasoning,is_default').eq('is_active',true).order('model_name').abortSignal(AbortSignal.timeout(10000)),
 ])
 if(settings.error||models.error)throw new Error('drawing_runtime_unavailable')
 const effective=['cad-research','cad-designer','cad-reviewer'].map(role=>settings.data?.find((r:any)=>r.function_name===role&&r.module_id==='cad')??settings.data?.find((r:any)=>r.function_name===role&&r.module_id==='global')??null)
 const fallback=models.data?.find((m:any)=>m.is_default)??models.data?.[0]
 const used=new Set(effective.map((r:any)=>r?.model??fallback?.model_name))
 return fingerprint({engine_contract:2,research_contract:CAD_RESEARCH_CONTRACT,configured,settings:effective,models:models.data?.filter((m:any)=>used.has(m.model_name)||m===fallback)})
}
