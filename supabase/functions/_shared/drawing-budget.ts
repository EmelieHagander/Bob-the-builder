import { fingerprint } from './bob-job-journal.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { budgetFailure, readBudgetStop } from './bob-budget-stop.ts'

/** The database owns task periods and attempt identity. An explicit new owner
 * task may replace a terminal uncertain attempt without settling its old bill.
 * Same-task continuations retain one attempt and completed results are reused. */
export function createDrawingBudget(opts:{
 executionId:string;
 command:(input:Record<string,unknown>)=>Promise<any>;
}) {
 return async(id:string, options:OpenAIServiceOptions, work:(recovery?:{key?:string;context?:Record<string,unknown>;expiresAt?:string;fingerprint?:string})=>Promise<OpenAIServiceResponse<string>>)=>{
  const key=await fingerprint(options)
  const binding={p_id:id,p_key:key,p_execution:opts.executionId}
  const reserved=await opts.command({...binding,p_operation:'reserve'})
  const outcome=(result:OpenAIServiceResponse<string>)=>reserved.prior_outcome_unknown&&result.responseId?{...result,priorAttemptUncertain:true}:result
  if(reserved.status==='completed')return outcome(reserved.response as OpenAIServiceResponse<string>)
  if(!['reserved','recover'].includes(reserved.status))return budgetFailure<string>(readBudgetStop(reserved)??{
   scope:'drawing_request',reasons:[reserved.status==='context_cleared'?'context_cleared':reserved.status==='outcome_unknown'?'pending_outcome':'unknown'],
  })
  if(typeof reserved.key==='string')binding.p_key=reserved.key
  const recovery=reserved.recovery??(reserved.key&&reserved.key!==key?{fingerprint:reserved.key}:undefined)
  const result=await work(recovery)
  // A transport failure with no priced receipt can have happened after billing.
  // Leave its reservation pending for provider reconciliation, never mark it free.
  if(!result.success&&result.estimatedCostUsd==null)return result
  if(reserved.execution_id)binding.p_execution=reserved.execution_id
  // No catch/release: an exception after dispatch does not prove no charge.
  await opts.command({...binding,p_operation:'complete',p_response:result})
  return outcome(result)
 }
}
