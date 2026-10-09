import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { budgetFailure, type BobBudgetStop } from './bob-budget-stop.ts'

/** Spend and calls held back so an independent review and the user-facing
 * delivery can still run after design/research work has used the rest. */
export const BOB_REVIEW_RESERVE = { usd: 0.15, calls: 3, roles: ['cad-reviewer', 'bob-delivery-language'] as const }

/** Changing allocation ownership or CAD handoff behavior invalidates a prior
 * technical retry failure; it neither resets nor grants the persisted budget. */
export const BOB_MODEL_BUDGET_POLICY_REVISION = 'drawing-ledger-immediate-review-v2'
export type DrawingBudgetAuthority = {
 requestId: string;
 options: Pick<OpenAIServiceOptions,'app'|'coworkerId'|'module'|'functionName'|'aiFunction'|'aiDefinition'>;
}
/** Constructed inside the trusted requestModel scope, never from model/browser
 * input. These calls also pass through the durable DB reservation before work.
 * A bound request does not make Bob, planners or other roles CAD operations. */
export function isDrawingModelCall(authority: DrawingBudgetAuthority | undefined, role?: string): boolean {
 if(!authority||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(authority.requestId))return false
 const options=authority.options
 return options.app==='bob'&&options.coworkerId==='bob'&&options.module==='cad'
  &&['cad-research','cad-designer','cad-reviewer'].includes(options.functionName)
  &&options.aiFunction===options.functionName&&(role===undefined||role===options.functionName)
  &&options.aiDefinition?.app==='bob'&&options.aiDefinition.roleKey==='role.'+options.functionName
}

/** A stop threshold, not a provider billing cap: the last in-flight call may
 * cross it. Wrap journal replay too, so completed logical calls rebuild usage
 * exactly once on every worker segment. Never reset this per CAD consultation.
 * Ordinary roles outside the reserve stop at the limit minus the reserve;
 * reserved ordinary roles may use the whole limit. A server-bound CAD operation
 * is accounted exactly once by its persisted request ledger instead: this
 * transient guard cannot override its allocation or starve Bob's final save. */
export function createBobModelBudget(limitUsd = 1, maxCalls = 24, reserve: { usd: number; calls: number; roles: readonly string[] } = BOB_REVIEW_RESERVE) {
 let spent = 0, calls = 0, unpriced = false
 return {
  get usage() { return { spent, calls, unpriced, limitUsd } },
  async run<T>(work: () => Promise<OpenAIServiceResponse<T>>, role?: string, authority?: DrawingBudgetAuthority): Promise<OpenAIServiceResponse<T>> {
   if(isDrawingModelCall(authority,role))return work()
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
