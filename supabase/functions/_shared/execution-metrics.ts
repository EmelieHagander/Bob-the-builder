import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import type { TurnObservation } from './project-answer.ts'
import { TASK_WORK_VALIDATION_CODES } from './project-write.ts'
import { ANSWER_TEXT_OUTCOMES } from './answer-text.ts'
import { TOOL_REJECTION_CODES } from './tool-rejection.ts'

export type ExecutionEvent = {
  run_id: string; turn_id: string; event_key: string; kind: 'model' | 'delivery' | 'tool'; role: string; status: string;
  duration_ms: number; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null;
  counts: Record<string, number | boolean | string | string[] | null>
}
export interface ExecutionMetricsState {
  version: 1; runId: string; turnId: string; startedAt: number; observation: TurnObservation | null;
}
export type WorkDiagnostics={operation?:string;reused?:boolean;revision?:number;new_revision?:number|null;source_changed?:boolean;coverage_complete?:boolean;outputs_requested?:number}
function workCounts(value:WorkDiagnostics|undefined):Record<string,number|boolean|string|null>{
 if(!value||!['work_read','work_change','work_check'].includes(value.operation??''))return {}
 const counts:Record<string,number|boolean|string|null>={work_operation:value.operation!}
 for(const key of ['reused','source_changed','coverage_complete'] as const)if(typeof value[key]==='boolean')counts['work_'+key]=value[key]!
 for(const key of ['revision','new_revision','outputs_requested'] as const)if(Number.isSafeInteger(value[key])&&Number(value[key])>=0)counts['work_'+key]=Number(value[key])
 return counts
}
// Event attribution preserves historic role names; this is not a dispatch registry.
const roles=new Set(['ask-bob','cad-research','cad-designer','cad-reviewer','context-summary','plan-compiler','plan-reviewer','bob-delivery-language'])
const outputPhases=new Set(['commentary','final_answer','legacy','tool_calls','refusal','incomplete'])
const phaseCounts=(phase:unknown):Record<string,string>=>typeof phase==='string'&&outputPhases.has(phase)?{output_phase:phase}:{}
const validationCodes=new Set<string>([...TASK_WORK_VALIDATION_CODES,'tool_shape','request_quote','field_value','task_location','domain_fields','human_text',
  // Rejection reasons recorded for new manifests (2026-10-29): typed tool codes and the content editor's fixed messages.
  ...TOOL_REJECTION_CODES,'stale_construction_text','parameter_unused_node','invalid_recipe','computed_geometry_invalid','unsupported_image_frame','request_quote_required'])
const validationCounts=(value:unknown):Record<string,string>=>typeof value==='string'&&validationCodes.has(value)?{validation_code:value}:{}
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
  let startedAt=opts.startedAt
  const base=()=>({run_id:opts.runId,turn_id:opts.turnId})
  const write=async(e:ExecutionEvent)=>{try{await opts.write(e)}catch{console.warn('[Bob metrics] unavailable')}}
  return {
    exportState():ExecutionMetricsState{return structuredClone({version:1,runId:opts.runId,turnId:opts.turnId,startedAt,observation:turn??null})},
    restoreState(state:ExecutionMetricsState){
      if(state?.version!==1||state.runId!==opts.runId||state.turnId!==opts.turnId||!Number.isFinite(state.startedAt)||state.startedAt<0
        ||state.observation!==null&&(!state.observation||!['steps','tool_calls','deferred_calls','completion_checks','nudges'].every(key=>Number.isSafeInteger(state.observation![key as keyof TurnObservation])&&Number(state.observation![key as keyof TurnObservation])>=0)
          ||!['answered','asked','step_budget','time_budget','refused','commentary_limit','failed'].includes(state.observation.end)
          ||state.observation.completion_gate!==undefined&&!['done','review','unavailable'].includes(state.observation.completion_gate)
          ||state.observation.answer_text!==undefined&&!ANSWER_TEXT_OUTCOMES.includes(state.observation.answer_text)
          ||state.observation.answer_text_issues!==undefined&&!(Number.isSafeInteger(state.observation.answer_text_issues)&&state.observation.answer_text_issues>=0)
          ||state.observation.output_phase!==undefined&&!outputPhases.has(state.observation.output_phase)))throw new Error('metrics_checkpoint_invalid')
      turn=state.observation===null?undefined:structuredClone(state.observation)
      startedAt=state.startedAt
    },
    observe(value:TurnObservation){turn=structuredClone(value)},
    /** step is the journal key (model:<function>:<position>); attempt>0 marks a re-sent call. */
    async model(options:OpenAIServiceOptions,result:OpenAIServiceResponse<unknown>,elapsed:number,call:{step:string|null;attempt:number}={step:null,attempt:0}){
      await write({...base(),event_key:'model:'+crypto.randomUUID(),kind:'model',role:roles.has(options.aiFunction)?options.aiFunction:'other',status:result.success?'ok':'failed',
        duration_ms:Math.round(number(elapsed)),input_tokens:number(result.usage?.input_tokens),output_tokens:number(result.usage?.output_tokens),
        cost_usd:typeof result.estimatedCostUsd==='number'?number(result.estimatedCostUsd):null,
        counts:{...phaseCounts(result.outputPhase),offered_tool_count:options.tools?.length??0,offered_tools:toolNames(options.tools),
          returned_tool_count:result.toolCalls?.length??0,returned_tools:(result.toolCalls??[]).slice(0,32).map(t=>code(t.function?.name,'invalid_name')),
          timeout_ms:number(options.timeoutMs),failure_kind:failureKind(result),
          model:label(result.model),reasoning_effort:label(result.reasoningEffort),
          ai_manifest_id:label(options.aiDefinition?.manifestId),
          ai_role_version_id:label(options.aiDefinition?.roleVersionId),
          ai_profile_version_id:label(options.aiDefinition?.profileVersionId),
          ai_tier:label(options.aiDefinition?.tier),
          cached_input_tokens:number(result.usage?.cached_input_tokens),reasoning_tokens:number(result.usage?.reasoning_tokens),
          step:label(call.step),attempt:number(call.attempt)}})
    },
    /** One row per executed tool call: which tool, its status and the step. */
    tool(input:{name:string;status:string;step:number;index:number;ms:number;validation_code?:string;diagnostics?:WorkDiagnostics;rejection?:{code:string;fields:string[];message_id?:string}}){
      void write({...base(),event_key:`tool:${input.step}:${input.index}`.slice(0,80),kind:'tool',role:'tool',status:code(input.status,'returned'),
        duration_ms:Math.round(number(input.ms)),input_tokens:null,output_tokens:null,cost_usd:null,
        counts:{tool:code(input.name,'invalid_name'),step:number(input.step),...validationCounts(input.validation_code),...workCounts(input.diagnostics),
          // Why a call was rejected (2026-10-31): a code and field paths only, never content.
          ...(input.rejection?{rejection_code:code(input.rejection.code,'unspecified'),rejection_fields:input.rejection.fields.filter(f=>typeof f==='string'&&f.length<=120).slice(0,8),
            ...(typeof input.rejection.message_id==='string'&&/^m[0-9a-f]{8}$/.test(input.rejection.message_id)?{rejection_message:input.rejection.message_id}:{})}:{})}})
    },
    async finish(input:{ok:boolean;partial?:boolean;uncertain?:boolean;recovered?:boolean;writes:number;error?:string;uncertainResends?:number;reusedModelCalls?:number;cad?:{consultations:number;renders:number;input_corrections:number;reviews:number;review_rejections:number;review_unavailable:number;review_passed:boolean}}){
      const end=turn?.end
      const status=!input.ok?'failed':input.uncertain?'uncertain':input.recovered?'recovered':input.partial?'partial'
        :end==='asked'?'asked':end==='step_budget'||end==='time_budget'||end==='refused'||end==='commentary_limit'?end:input.writes>0?'saved':input.cad?.review_passed?'candidate_ready':'answered'
      await write({...base(),event_key:'delivery',kind:'delivery',role:'bob',status,duration_ms:Math.max(0,now()-startedAt),input_tokens:null,output_tokens:null,cost_usd:null,
        counts:{...phaseCounts(turn?.output_phase),end_reason:!input.ok?code(input.error,'failed'):end??null,steps:turn?.steps??null,tool_calls:turn?.tool_calls??null,deferred_calls:turn?.deferred_calls??null,
          completion_checks:turn?.completion_checks??null,nudges:turn?.nudges??null,saved_records:number(input.writes),
          cad_consultations:input.cad?.consultations??0,cad_renders:input.cad?.renders??0,cad_input_corrections:input.cad?.input_corrections??0,
          cad_reviews:input.cad?.reviews??0,cad_review_rejections:input.cad?.review_rejections??0,cad_review_unavailable:input.cad?.review_unavailable??0,cad_review_passed:input.cad?.review_passed??false,
          uncertain_resends:number(input.uncertainResends),reused_model_calls:number(input.reusedModelCalls),
          ...(turn?.answer_text?{answer_text:turn.answer_text,answer_text_issues:number(turn.answer_text_issues)}:{})}})
    },
  }
}
