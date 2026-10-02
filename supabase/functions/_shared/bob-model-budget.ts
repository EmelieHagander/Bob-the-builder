import type { OpenAIServiceResponse } from './openai-service.ts'
import { budgetFailure, type BobBudgetStop } from './bob-budget-stop.ts'

/** A stop threshold, not a provider billing cap: the last in-flight call may
 * cross it. Wrap journal replay too, so completed logical calls rebuild usage
 * exactly once on every worker segment. Never reset this per CAD consultation. */
export function createBobModelBudget(limitUsd = 1, maxCalls = 24) {
 let spent = 0, calls = 0, unpriced = false
 return {
  get usage() { return { spent, calls, unpriced, limitUsd } },
  async run<T>(work: () => Promise<OpenAIServiceResponse<T>>): Promise<OpenAIServiceResponse<T>> {
   const reasons:BobBudgetStop['reasons']=[]
   if(spent>=limitUsd)reasons.push('usd_limit')
   if(calls>=maxCalls)reasons.push('call_limit')
   if(unpriced)reasons.push('unpriced_usage')
   if(reasons.length)return budgetFailure<T>({scope:'turn',reasons,calls,call_limit:maxCalls,spent_usd:spent,usd_limit:limitUsd,unpriced})
   const result = await work()
   calls++
   const cost = result.estimatedCostUsd
   if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) spent += cost
   else if (result.usage.total_tokens > 0) unpriced = true
   return result
  },
 }
}
