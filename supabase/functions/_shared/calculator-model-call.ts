import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { hasCalculatorContract, type ProjectCalculator } from './project-calculator.ts'
import type { AiCatalogSession } from './ai-catalog.ts'
import { rethrowContinuation } from './bob-job-journal.ts'

/** Optional calculations belong to the specialist's normal structured call.
 * Continue the same provider conversation only after an actual tool request;
 * every model call retains the caller's pinned schema, limits and accounting. */
export async function callWithCalculator<T>(options:OpenAIServiceOptions,opts:{
 unlimitedWork?:boolean;catalog:AiCatalogSession;calculator?:ProjectCalculator;hasAccess:()=>Promise<boolean>;deadline:number;
 callModel:(options:OpenAIServiceOptions)=>Promise<OpenAIServiceResponse<T>>;
}):Promise<OpenAIServiceResponse<T>>{
 if(!opts.calculator||!hasCalculatorContract(opts.catalog))return opts.callModel(options)
 const {prompt,messages,tools:_tools,tool_choice:_choice,previousResponseId,...structured}=options
 const failed=(error:string,model='unresolved'):OpenAIServiceResponse<T>=>({success:false,data:null,error,model,usage:{input_tokens:0,output_tokens:0,total_tokens:0}})
 if(opts.calculator.remaining===0)return failed('calculator_budget_exhausted')
 let conversation=messages??(prompt?[{role:'user' as const,content:prompt}]:[])
 let previous=previousResponseId
 // Legacy manifests close tools after two rounds. New work policy lets the
 // specialist finish with tools available, retaining deadline and authority checks.
 for(let round=0;opts.unlimitedWork||round<=2;round++){
  if(!await opts.hasAccess())throw new Error('project_denied')
  if(Date.now()>=opts.deadline)return failed('deadline')
  const offered=opts.calculator.remaining>0?await opts.calculator.offered():[]
  if(opts.calculator.remaining>0&&!offered.length)return failed('calculator_policy_unavailable')
  const tools=(opts.unlimitedWork||round<2)&&offered.length?offered:undefined
  const response=await opts.callModel({...structured,messages:conversation,tools,
   structuredToolOutput:true,previousResponseId:previous,
   timeoutMs:Math.min(options.timeoutMs??30000,opts.deadline-Date.now())})
  if(!await opts.hasAccess())throw new Error('project_denied')
  if(!response.success||!response.toolCalls?.length)return response
  const calls=response.toolCalls
  if(!tools||!response.responseId||(!opts.unlimitedWork&&calls.length>4)||
   calls.some(call=>!call.id||!tools.some(tool=>tool.function.name===call.function.name))||
   new Set(calls.map(call=>call.id)).size!==calls.length)return failed('calculator_protocol',response.model)
  previous=response.responseId;conversation=[]
  for(const call of calls){
   if(!await opts.hasAccess())throw new Error('project_denied')
   if(Date.now()>=opts.deadline)return failed('deadline',response.model)
   let raw:unknown
   try{raw=JSON.parse(call.function.arguments)}catch{raw=null}
   let result:Record<string,any>
   try{result=await opts.calculator.execute(raw)}
   catch(error){rethrowContinuation(error);if(error instanceof Error&&error.message==='project_denied')throw error;result={status:'invalid',saved:false}}
   if(!await opts.hasAccess())throw new Error('project_denied')
   conversation.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)})
  }
 }
 return failed('calculator_protocol')
}
