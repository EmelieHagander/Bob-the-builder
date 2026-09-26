import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'

export interface DeliveryObservation {
  requested: number; missing: number; rounds: number; continuations: number; intent_available: boolean;
  kinds: string[]
}
export type ExecutionEvent = {
  run_id: string; turn_id: string; event_key: string; kind: 'model' | 'delivery'; role: string; status: string;
  duration_ms: number; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null;
  counts: Record<string, number | boolean | string[] | null>
}
const roles=new Set(['ask-bob','cad-designer','cad-reviewer','context-summary','plan-compiler','plan-reviewer','bob-tool-discovery','bob-work-intent','bob-delivery-language'])
const number=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:0
/** No prompts, record labels, source IDs, images, arguments or provider errors.
 * Persist real calls INSIDE the journal operation. Replays cannot bill/count twice. */
export function createExecutionMetrics(opts:{runId:string;turnId:string;startedAt:number;write:(e:ExecutionEvent)=>Promise<void>;now?:()=>number}){
  const now=opts.now??Date.now
  let delivery:DeliveryObservation|undefined
  const base=()=>({run_id:opts.runId,turn_id:opts.turnId})
  const write=async(e:ExecutionEvent)=>{try{await opts.write(e)}catch{console.warn('[Bob metrics] unavailable')}}
  return {
    observe(value:DeliveryObservation){delivery=structuredClone(value)},
    async model(options:OpenAIServiceOptions,result:OpenAIServiceResponse<unknown>,elapsed:number){
      await write({...base(),event_key:'model:'+crypto.randomUUID(),kind:'model',role:roles.has(options.aiFunction)?options.aiFunction:'other',status:result.success?'ok':'failed',
        duration_ms:Math.round(number(elapsed)),input_tokens:number(result.usage?.input_tokens),output_tokens:number(result.usage?.output_tokens),
        cost_usd:typeof result.estimatedCostUsd==='number'?number(result.estimatedCostUsd):null,counts:{}})
    },
    async finish(input:{ok:boolean;partial?:boolean;uncertain?:boolean;recovered?:boolean;writes:number;cad?:{consultations:number;renders:number;input_corrections:number;reviews:number;review_rejections:number;review_unavailable:number;review_passed:boolean}}){
      const status=!input.ok?'failed':input.uncertain?'uncertain':input.recovered?'recovered':input.partial||delivery&&delivery.missing>0?'partial':delivery?.requested?'receipt_matched':input.cad?.review_passed?'candidate_ready':'read_only'
      await write({...base(),event_key:'delivery',kind:'delivery',role:'bob',status,duration_ms:Math.max(0,now()-opts.startedAt),input_tokens:null,output_tokens:null,cost_usd:null,
        counts:{requested:delivery?.requested??null,missing:delivery?.missing??null,rounds:delivery?.rounds??null,continuations:delivery?.continuations??null,
          intent_available:delivery?.intent_available??false,kinds:delivery?.kinds??[],saved_records:number(input.writes),
          cad_consultations:input.cad?.consultations??0,cad_renders:input.cad?.renders??0,cad_input_corrections:input.cad?.input_corrections??0,
          cad_reviews:input.cad?.reviews??0,cad_review_rejections:input.cad?.review_rejections??0,cad_review_unavailable:input.cad?.review_unavailable??0,cad_review_passed:input.cad?.review_passed??false}})
    },
  }
}
