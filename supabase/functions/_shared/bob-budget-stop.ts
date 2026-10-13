import type { OpenAIServiceResponse } from './openai-service.ts'
import type { AiCatalogSession } from './ai-catalog.ts'

const reasons = ['usd_limit','call_limit','unpriced_usage','pending_outcome','context_cleared','review_reserve','unknown'] as const
export type BobBudgetStop = {
 scope:'turn'|'drawing_request'|'task'; reasons:(typeof reasons[number])[];
 calls?:number; call_limit?:number; spent_usd?:number; usd_limit?:number; pending_calls?:number; unpriced?:boolean;
}
/** A Bob-owned diagnostic, not a provider error or a new allocation. */
export function readBudgetStop(value:unknown):BobBudgetStop|undefined {
 const stop=(value as {budget_stop?:any}|null)?.budget_stop
 if(!stop||!['turn','drawing_request','task'].includes(stop.scope)||!Array.isArray(stop.reasons)||!stop.reasons.length||stop.reasons.length>reasons.length
  ||stop.reasons.some((r:unknown)=>!reasons.includes(r as typeof reasons[number])))return
 const result:BobBudgetStop={scope:stop.scope,reasons:[...new Set(stop.reasons)] as BobBudgetStop['reasons']}
 for(const key of ['calls','call_limit','spent_usd','usd_limit','pending_calls'] as const){
  const n=stop[key];if(typeof n==='number'&&Number.isFinite(n)&&n>=0)result[key]=n
 }
 if(typeof stop.unpriced==='boolean')result.unpriced=stop.unpriced
 return result
}
export function budgetFailure<T>(stop:BobBudgetStop):OpenAIServiceResponse<T>&{budget_stop:BobBudgetStop} {
 return {success:false,data:null,model:'unavailable',usage:{input_tokens:0,output_tokens:0,total_tokens:0},
  error:'turn_budget_exhausted',budget_stop:stop}
}
export class BobBudgetError extends Error {
 readonly budget_stop:BobBudgetStop|undefined
 constructor(response:unknown,readonly stage:'intake'|'design'|'review'='design'){super('turn_budget_exhausted');this.budget_stop=readBudgetStop(response)}
}
/** Owner-facing. Limits are the server's business: the owner hears that the
 * drawing paused and how it continues, never figures or allocation rules. */
export function budgetStopMessage(stop:BobBudgetStop|undefined) {
 if(stop?.reasons.some(r=>r==='pending_outcome'||r==='unpriced_usage'))return 'Ritförsöket pausades tills ett tidigare steg är avslutat. Skriv till mig igen om ritningen om en stund, så fortsätter jag.'
 if(stop?.reasons.includes('context_cleared'))return 'Ritförsöket pausades eftersom ett tidigare arbetsresultat inte längre finns kvar i samtalet.'
 if(stop?.reasons.includes('review_reserve'))return 'Ritförsöket stoppades före granskning och svar i den här omgången. Skriv till mig igen om ritningen, så fortsätter jag.'
 if(!stop)return 'Ritförsöket pausades vid en gräns; den exakta orsaken är inte tillgänglig. Skriv till mig igen om ritningen, så fortsätter jag.'
 return 'Ritförsöket pausades vid en gräns. Skriv till mig igen om ritningen, så fortsätter jag där den stannade.'
}
/** Model-facing. Bob is told what to do; sizing and renewal of limits stay server-side (texts live in the AI catalog). */
export function budgetResumeAction(stop:BobBudgetStop|undefined,aiCatalog:AiCatalogSession) {
 if(stop?.reasons.some(r=>r==='pending_outcome'||r==='unpriced_usage'))return aiCatalog.text('feedback.bob-budget-stop.resume.9c3a74e182d5')
 if(stop?.reasons.includes('context_cleared'))return aiCatalog.text('feedback.bob-budget-stop.resume.f0e268bdddc1')
 if(stop?.reasons.includes('review_reserve'))return aiCatalog.text('feedback.bob-budget-stop.resume.f43f67fe832d')
 if(stop?.reasons.some(r=>r==='usd_limit'||r==='call_limit'))return stop.scope==='drawing_request'||stop.scope==='task'
  ?aiCatalog.text('feedback.bob-budget-stop.resume.eefd1193bc73')
  :aiCatalog.text('feedback.bob-budget-stop.resume.51aac0199a6c')
 return aiCatalog.text('feedback.bob-budget-stop.resume.bca602f7146a')
}
/** What Bob sees of a stop: the pause and its next action, never the ledger. */
export function withoutBudgetDetails<T extends Record<string,unknown>>(outcome:T):Omit<T,'budget_stop'|'budget_grant'> {
 const {budget_stop:_stop,budget_grant:_grant,...rest}=outcome
 return rest.reason==='turn_budget_exhausted'?{...rest,reason:'paused_at_limit'}:rest
}
