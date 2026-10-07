import type { OpenAIServiceResponse } from './openai-service.ts'
import { budgetFailure, type BobBudgetStop } from './bob-budget-stop.ts'

/** Spend and calls held back so an independent review and the user-facing
 * delivery can still run after design/research work has used the rest. */
export const BOB_REVIEW_RESERVE = { usd: 0.15, calls: 3, roles: ['cad-reviewer', 'bob-delivery-language'] as const }

/** A stop threshold, not a provider billing cap: the last in-flight call may
 * cross it. Wrap journal replay too, so completed logical calls rebuild usage
 * exactly once on every worker segment. Never reset this per CAD consultation.
 * Roles outside the reserve stop at the limit minus the reserve; reserved roles
 * may use the whole limit. The reserve is shared, not per role. */
export function createBobModelBudget(limitUsd = 1, maxCalls = 24, reserve: { usd: number; calls: number; roles: readonly string[] } = BOB_REVIEW_RESERVE) {
 let spent = 0, calls = 0, unpriced = false
 return {
  get usage() { return { spent, calls, unpriced, limitUsd } },
  async run<T>(work: () => Promise<OpenAIServiceResponse<T>>, role?: string): Promise<OpenAIServiceResponse<T>> {
   const reserved = !!role && reserve.roles.includes(role)
   const usdLimit = reserved ? limitUsd : Math.max(0, limitUsd - reserve.usd)
   const callLimit = reserved ? maxCalls : Math.max(0, maxCalls - reserve.calls)
   const reasons:BobBudgetStop['reasons']=[]
   if(spent>=usdLimit)reasons.push('usd_limit')
   if(calls>=callLimit)reasons.push('call_limit')
   if(unpriced)reasons.push('unpriced_usage')
   // Name the reserve only when it, not the whole turn limit, caused the stop.
   if((spent>=usdLimit||calls>=callLimit)&&spent<limitUsd&&calls<maxCalls)reasons.push('review_reserve')
   if(reasons.length)return budgetFailure<T>({scope:'turn',reasons,calls,call_limit:callLimit,spent_usd:spent,usd_limit:usdLimit,unpriced})
   const result = await work()
   calls++
   const cost = result.estimatedCostUsd
   if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) spent += cost
   else if (result.usage.total_tokens > 0) unpriced = true
   return result
  },
 }
}
