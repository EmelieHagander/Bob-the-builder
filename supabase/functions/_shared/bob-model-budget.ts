import type { OpenAIServiceResponse } from './openai-service.ts'

/** A stop threshold, not a provider billing cap: the last in-flight call may
 * cross it. Wrap journal replay too, so completed logical calls rebuild usage
 * exactly once on every worker segment. Never reset this per CAD consultation. */
export function createBobModelBudget(limitUsd = 1, maxCalls = 24) {
 let spent = 0, calls = 0, unpriced = false
 return {
  get usage() { return { spent, calls, unpriced, limitUsd } },
  async run<T>(work: () => Promise<OpenAIServiceResponse<T>>): Promise<OpenAIServiceResponse<T>> {
   if (spent >= limitUsd || calls >= maxCalls || unpriced) return {
    success: false, data: null, model: 'unavailable',
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, error: 'turn_budget_exhausted',
   }
   const result = await work()
   calls++
   const cost = result.estimatedCostUsd
   if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) spent += cost
   else if (result.usage.total_tokens > 0) unpriced = true
   return result
  },
 }
}
