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
export function budgetStopMessage(stop:BobBudgetStop|undefined) {
 if(stop?.reasons.some(r=>r==='pending_outcome'||r==='unpriced_usage'))return 'Ritförsöket pausades eftersom kostnaden eller utfallet för ett tidigare modellanrop ännu inte är klarlagt.'
 if(stop?.reasons.includes('context_cleared'))return 'Ritförsöket pausades eftersom ett tidigare arbetsresultat inte längre finns kvar i samtalet.'
 if(stop?.reasons.includes('review_reserve'))return 'Ritförsöket stoppades innan granskning och svar, eftersom resten av turens budget är reserverad för dem.'
 const resume=stop?.scope==='drawing_request'?' Skriv till mig igen om ritningen, så får den mer budget och jag tar vid där den stannade.':''
 if(stop?.reasons.includes('usd_limit'))return 'Ritförsöket stoppades av kostnadsgränsen.'+resume
 if(stop?.reasons.includes('call_limit'))return 'Ritförsöket stoppades av gränsen för antal modellanrop.'+resume
 return 'Ritförsöket stoppades av en resursgräns; den exakta orsaken är inte tillgänglig.'
}
export function budgetResumeAction(stop:BobBudgetStop|undefined) {
 if(stop?.reasons.some(r=>r==='pending_outcome'||r==='unpriced_usage'))return 'Reconcile the prior provider outcome and cost before another dispatch. Do not release or replace its reservation.'
 if(stop?.reasons.includes('context_cleared'))return 'Restore the same request through its existing context-recovery path. A new request must not bypass previous accounting.'
 if(stop?.reasons.includes('review_reserve'))return 'Design/research reached the turn limit minus the review/delivery reserve. Review or deliver what exists; do not dispatch more design work in this turn.'
 if(stop?.reasons.some(r=>r==='usd_limit'||r==='call_limit'))return stop.scope==='drawing_request'
  ?'This drawing request reached its own cost or call limit. Tell the owner plainly and finish this reply; do not read requests, budgets or sources to look for a way around it. The owner\'s next message about this drawing renews its budget: call design_project_cad at once with this same request_id, brief and handoff, and the server adds one more allocation before resuming.'
  :'This turn\'s model budget is used. Tell the owner what exists and that the next message continues this same request_id; do not retry in this turn.'
 return 'Inspect the current budget boundary before retrying. The unavailable diagnostic is not evidence that more money or more input is needed.'
}
