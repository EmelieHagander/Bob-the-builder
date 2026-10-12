import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { hasCalculatorContract, type ProjectCalculator } from './project-calculator.ts'
import type { AiCatalogSession } from './ai-catalog.ts'
import { rethrowContinuation } from './bob-job-journal.ts'

/** Structured specialists get a bounded read-only calculation phase followed
 * by their original tool-free schema call. Every call uses the existing caller
 * budget/accounting wrapper. Never weaken the shared adapter's JSON boundary. */
export async function callWithCalculator<T>(options:OpenAIServiceOptions,opts:{
 catalog:AiCatalogSession;calculator?:ProjectCalculator;hasAccess:()=>Promise<boolean>;deadline:number;
 callModel:(options:OpenAIServiceOptions)=>Promise<OpenAIServiceResponse<T>>;
}):Promise<OpenAIServiceResponse<T>>{
 if(!opts.calculator||!hasCalculatorContract(opts.catalog))return opts.callModel(options)
 const {schema,schemaName,schemaDescription,catalogSchemaKey,prompt,messages,previousResponseId,...phase}=options
 const original=messages??(prompt?[{role:'user' as const,content:prompt}]:[])
 const evidence:unknown[]=[]
 const failed=(error:string,model='unresolved'):OpenAIServiceResponse<T>=>({success:false,data:null,error,model,usage:{input_tokens:0,output_tokens:0,total_tokens:0}})
 if(opts.calculator.remaining===0)return failed('calculator_budget_exhausted')
 let conversation:NonNullable<OpenAIServiceOptions['messages']>=[...original,{role:'user',content:opts.catalog.text('calculator.schema-phase')}]
 let previous:string|undefined
 for(let round=0;round<2&&opts.calculator.remaining>0;round++){
  if(!await opts.hasAccess())throw new Error('project_denied')
  if(Date.now()>=opts.deadline)return failed('deadline')
  const tools=await opts.calculator.offered()
  if(!tools.length)return failed('calculator_policy_unavailable')
  const response=await opts.callModel({...phase,messages:conversation,tools,previousResponseId:previous,
   outputTokenLimit:Math.min(options.outputTokenLimit??6000,6000),timeoutMs:Math.min(options.timeoutMs??30000,opts.deadline-Date.now())})
  if(!await opts.hasAccess())throw new Error('project_denied')
  if(!response.success)return response
  if(!response.toolCalls?.length)break
  if(!response.responseId||response.toolCalls.length>4)return failed('calculator_protocol',response.model)
  previous=response.responseId;conversation=[]
  for(const call of response.toolCalls){
   if(!await opts.hasAccess())throw new Error('project_denied')
   let result:Record<string,any>={status:'invalid',saved:false,reason:'tool_not_offered'}
   try{if(call.function.name===tools[0].function.name)result=await opts.calculator.execute(JSON.parse(call.function.arguments))}
   catch(error){rethrowContinuation(error);if(error instanceof Error&&error.message==='project_denied')throw error;result={status:'invalid',saved:false}}
   evidence.push({tool:call.function.name,result})
   conversation.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)})
  }
 }
 if(!await opts.hasAccess())throw new Error('project_denied')
 if(Date.now()>=opts.deadline)return failed('deadline')
 // Separate provider conversation: complete exact code results, no phase prose
 // and no tools property (even [] suppresses text.format in the shared service).
 const {tools:_tools,tool_choice:_choice,...structured}=options
 const final=await opts.callModel({...structured,prompt:undefined,previousResponseId:undefined,
  messages:[...original,{role:'user',content:JSON.stringify({calculation_evidence:evidence,calculation_phase_closed:true})}],
  timeoutMs:Math.min(options.timeoutMs??30000,opts.deadline-Date.now())})
 if(!await opts.hasAccess())throw new Error('project_denied')
 return final
}
