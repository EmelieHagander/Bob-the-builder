import { fingerprint } from './bob-job-journal.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'

/** The database owns allocation and dispatch identity. A new turn is not a new
 * budget. Reservations are made before the provider; uncertain outcomes stay
 * reserved and can only be recovered by the same durable execution. */
export function createDrawingBudget(opts:{
 executionId:string;
 command:(input:Record<string,unknown>)=>Promise<any>;
}) {
 return async(id:string, options:OpenAIServiceOptions, work:(recovery?:{key:string;context:Record<string,unknown>;expiresAt:string})=>Promise<OpenAIServiceResponse<string>>)=>{
  const key=await fingerprint(options)
  const binding={p_id:id,p_key:key,p_execution:opts.executionId}
  const reserved=await opts.command({...binding,p_operation:'reserve'})
  if(reserved.status==='completed')return reserved.response as OpenAIServiceResponse<string>
  if(!['reserved','recover'].includes(reserved.status))return {success:false,data:null,model:'unavailable',usage:{input_tokens:0,output_tokens:0,total_tokens:0},error:'turn_budget_exhausted'}
  const result=await work(reserved.recovery)
  if(reserved.execution_id)binding.p_execution=reserved.execution_id
  // No catch/release: an exception after dispatch does not prove no charge.
  await opts.command({...binding,p_operation:'complete',p_response:result})
  return result
 }
}
