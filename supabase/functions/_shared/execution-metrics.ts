import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import type { TurnObservation } from './project-answer.ts'

export type ExecutionEvent = {
  run_id: string; turn_id: string; event_key: string; kind: 'model' | 'delivery' | 'tool'; role: string; status: string;
  duration_ms: number; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null;
  counts: Record<string, number | boolean | string | string[] | null>
}
const roles=new Set(['ask-bob','cad-research','cad-designer','cad-reviewer','context-summary','plan-compiler','plan-reviewer','bob-delivery-language'])
const number=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:0
const code=(s:unknown,fallback:string)=>typeof s==='string'&&/^[a-z][a-z0-9_]{0,39}$/.test(s)?s:fallback
const label=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(s)?s:null
const toolNames=(tools:OpenAIServiceOptions['tools'])=>(tools??[]).slice(0,32).map(t=>code(t.function?.name,'invalid_name'))
const failureKind=(result:OpenAIServiceResponse<unknown>)=>result.success?null
  :/abort|timed?\s*out|timeout/i.test(result.error??'')?'request_aborted'
  :/OpenAI API error: 429/.test(result.error??'')?'rate_limited'
  :/OpenAI API error: 5[0-9]{2}/.test(result.error??'')?'provider_server_error'
  :/Network error/.test(result.error??'')?'network_error':'model_error'
/** No prompts, record labels, source IDs, images, arguments or provider errors.
 * Model calls are persisted INSIDE the journal operation, so replays cannot bill
 * or count twice. Tool and delivery events use deterministic keys and upsert. */
export function createExecutionMetrics(opts:{runId:string;turnId:string;startedAt:number;write:(e:ExecutionEvent)=>Promise<void>;now?:()=>number}){
  const now=opts.now??Date.now
  let turn:TurnObservation|undefined
  const base=()=>({run_id:opts.runId,turn_id:opts.turnId})
  const write=async(e:ExecutionEvent)=>{try{await opts.write(e)}catch{console.warn('[Bob metrics] unavailable')}}
  return {
    observe(value:TurnObservation){turn=structuredClone(value)},
    /** step is the journal key (model:<function>:<position>); attempt>0 marks a re-sent call. */
    async model(options:OpenAIServiceOptions,result:OpenAIServiceResponse<unknown>,elapsed:number,call:{step:string|null;attempt:number}={step:null,attempt:0}){
      await write({...base(),event_key:'model:'+crypto.randomUUID(),kind:'model',role:roles.has(options.aiFunction)?options.aiFunction:'other',status:result.success?'ok':'failed',
        duration_ms:Math.round(number(elapsed)),input_tokens:number(result.usage?.input_tokens),output_tokens:number(result.usage?.output_tokens),
        cost_usd:typeof result.estimatedCostUsd==='number'?number(result.estimatedCostUsd):null,
        counts:{offered_tool_count:options.tools?.length??0,offered_tools:toolNames(options.tools),
          returned_tool_count:result.toolCalls?.length??0,returned_tools:(result.toolCalls??[]).slice(0,32).map(t=>code(t.function?.name,'invalid_name')),
          timeout_ms:number(options.timeoutMs),failure_kind:failureKind(result),
          model:label(result.model),reasoning_effort:label(result.reasoningEffort),
          cached_input_tokens:number(result.usage?.cached_input_tokens),reasoning_tokens:number(result.usage?.reasoning_tokens),
          step:label(call.step),attempt:number(call.attempt)}})
    },
    /** One row per executed tool call: which tool, its status and the step. */
    tool(input:{name:string;status:string;step:number;index:number;ms:number}){
      void write({...base(),event_key:`tool:${input.step}:${input.index}`.slice(0,80),kind:'tool',role:'tool',status:code(input.status,'returned'),
        duration_ms:Math.round(number(input.ms)),input_tokens:null,output_tokens:null,cost_usd:null,
        counts:{tool:code(input.name,'invalid_name'),step:number(input.step)}})
    },
    async finish(input:{ok:boolean;partial?:boolean;uncertain?:boolean;recovered?:boolean;writes:number;error?:string;cad?:{consultations:number;renders:number;input_corrections:number;reviews:number;review_rejections:number;review_unavailable:number;review_passed:boolean}}){
      const end=turn?.end
      const status=!input.ok?'failed':input.uncertain?'uncertain':input.recovered?'recovered':input.partial?'partial'
        :end==='asked'?'asked':end==='step_budget'||end==='time_budget'?end:input.writes>0?'saved':input.cad?.review_passed?'candidate_ready':'answered'
      await write({...base(),event_key:'delivery',kind:'delivery',role:'bob',status,duration_ms:Math.max(0,now()-opts.startedAt),input_tokens:null,output_tokens:null,cost_usd:null,
        counts:{end_reason:!input.ok?code(input.error,'failed'):end??null,steps:turn?.steps??null,tool_calls:turn?.tool_calls??null,deferred_calls:turn?.deferred_calls??null,
          completion_checks:turn?.completion_checks??null,nudges:turn?.nudges??null,saved_records:number(input.writes),
          cad_consultations:input.cad?.consultations??0,cad_renders:input.cad?.renders??0,cad_input_corrections:input.cad?.input_corrections??0,
          cad_reviews:input.cad?.reviews??0,cad_review_rejections:input.cad?.review_rejections??0,cad_review_unavailable:input.cad?.review_unavailable??0,cad_review_passed:input.cad?.review_passed??false}})
    },
  }
}
