import type { OpenAIServiceResponse } from './openai-service.ts'

const reasons = ['usd_limit','call_limit','unpriced_usage','pending_outcome','context_cleared','review_reserve','unknown'] as const
export type BobBudgetStop = {
 scope:'turn'|'drawing_request'; reasons:(typeof reasons[number])[];
 calls?:number; call_limit?:number; spent_usd?:number; usd_limit?:number; pending_calls?:number; unpriced?:boolean;
}
/** A Bob-owned diagnostic, not a provider error or a new allocation. */
export function readBudgetStop(value:unknown):BobBudgetStop|undefined {
 const stop=(value as {budget_stop?:any}|null)?.budget_stop
 if(!stop||!['turn','drawing_request'].includes(stop.scope)||!Array.isArray(stop.reasons)||!stop.reasons.length||stop.reasons.length>reasons.length
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
/** Model-facing. Bob is told what to do, not how limits are sized or renewed. */
export function budgetResumeAction(stop:BobBudgetStop|undefined) {
 if(stop?.reasons.some(r=>r==='pending_outcome'||r==='unpriced_usage'))return 'A previous step of this drawing is still being settled. Tell the owner the drawing is paused and finish this reply; do not retry in this turn. It continues on a later message about it.'
 if(stop?.reasons.includes('context_cleared'))return 'Restore the same request through its existing context-recovery path. Do not create a new request.'
 if(stop?.reasons.includes('review_reserve'))return 'Design work reached this turn\'s limit before review. Review or deliver what exists; do not dispatch more design work in this turn.'
 if(stop?.scope==='turn')return 'This turn\'s work limit is reached. Tell the owner what exists and that the next message continues this same request_id; do not retry in this turn.'
 return 'This drawing paused at a limit. Tell the owner plainly and finish this reply; do not read requests or sources to look for a way around it. The owner\'s next message about this drawing continues it: call design_project_cad at once with this same request_id, brief and handoff.'
}
/** What Bob sees of a stop: the pause and its next action, never the ledger. */
export function withoutBudgetDetails<T extends Record<string,unknown>>(outcome:T):Omit<T,'budget_stop'|'budget_grant'> {
 const {budget_stop:_stop,budget_grant:_grant,...rest}=outcome
 return rest.reason==='turn_budget_exhausted'?{...rest,reason:'paused_at_limit'}:rest
}
