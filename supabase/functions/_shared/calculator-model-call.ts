import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { CALCULATOR_TOOL, hasCalculatorContract, type ProjectCalculator } from './project-calculator.ts'
import type { AiCatalogSession } from './ai-catalog.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { ContextSurface } from './bob-context-continuation.ts'
import { createToolSession } from './project-tools/session.ts'

/** Registered only while one scoped colleague call is in progress. The shared
 * continuation adapter refreshes this same session before a fresh model call. */
export type SpecialistContextSurfaceRegistrar = (role: string, refresh: () => Promise<ContextSurface>) => (() => void)
type CalculatorCallOptions<T> = {
 unlimitedWork?:boolean;catalog:AiCatalogSession;calculator?:ProjectCalculator;hasAccess:()=>Promise<boolean>;deadline:number;
 callModel:(options:OpenAIServiceOptions)=>Promise<OpenAIServiceResponse<T>>;
 registerContextSurface?:SpecialistContextSurfaceRegistrar;
}

/** A specialist gets only its assigned calculator, never Bob's project-wide
 * toolbox. Native schemas and manuals share Bob's discovery/execution fences. */
async function callWithLazyCalculator<T>(options:OpenAIServiceOptions,opts:CalculatorCallOptions<T>):Promise<OpenAIServiceResponse<T>>{
 const calculator=opts.calculator!,catalog=opts.catalog
 const role=options.catalogRoleKey??options.functionName
 const assigned=catalog.role(role).definition.definition.tool_keys
 const failed=(error:string,model='unresolved'):OpenAIServiceResponse<T>=>({success:false,data:null,error,model,usage:{input_tokens:0,output_tokens:0,total_tokens:0}})
 if(!Array.isArray(assigned)||!assigned.includes('tools.calculate_project')||!assigned.includes('tools.describe_tool'))return failed('calculator_contract_missing')
 const {prompt,messages,tools:_tools,tool_choice:_choice,previousResponseId,...structured}=options
 const baseSystem=options.systemMessage??catalog.role(role,options.catalogVariables).systemMessage
 const session=createToolSession({toolInstructions:'lazy',
  definitions:[{spec:CALCULATOR_TOOL,version:1,group:'Calculations',gate:()=>calculator.remaining>0?'available':'budget_exhausted',execute:raw=>calculator.execute(raw)}],
  readPolicy:async()=>{
   if(!await opts.hasAccess())throw new Error('project_denied')
   const available=await calculator.offered()
   return {phase:null,tools:[{name:'calculate_project',description:'Execute traceable versioned calculations in code.',how_to:'',
    schema_version:1,always_load:false,preload_phases:[],active:available.some(tool=>tool.function.name==='calculate_project')}]}
  },
  catalogTool:(name,parameters)=>catalog.tool(name,parameters),
  catalogToolVersion:name=>{
   const version=(catalog.definition('tools.'+name,'tool_contract').definition.envelope as {schema_version?:unknown})?.schema_version
   if(!Number.isSafeInteger(version)||Number(version)<1)throw new Error('tool_catalog_unavailable')
   return Number(version)
  },
 })
 let conversation=messages??(prompt?[{role:'user' as const,content:prompt}]:[]),previous=previousResponseId
 let calculationRounds=0,surface:ContextSurface={}
 const prepareSurface=async():Promise<ContextSurface>=>{
  if(!await opts.hasAccess())throw new Error('project_denied')
  const open=opts.unlimitedWork||calculationRounds<2
  const tools=open?await session.prepare():[]
  if(!open)session.closeSurface()
  surface={systemMessage:baseSystem+'\n\n'+JSON.stringify({tool_directory:open?session.toolbox:[]}),
   tools:tools.length?tools:undefined,catalogToolParameters:{...options.catalogToolParameters,calculate_project:{include_manual:false,card:true}}}
  return surface
 }
 const release=opts.registerContextSurface?.(role,async()=>{session.resetInstructions();return prepareSurface()})
 try{
  for(;;){
   if(!await opts.hasAccess())throw new Error('project_denied')
   if(Date.now()>=opts.deadline)return failed('deadline')
   await prepareSurface()
   const response=await opts.callModel({...structured,...surface,messages:conversation,
    structuredToolOutput:true,previousResponseId:previous,timeoutMs:Math.min(options.timeoutMs??30000,opts.deadline-Date.now())})
   if(!await opts.hasAccess())throw new Error('project_denied')
   if(!response.success||!response.toolCalls?.length)return response
   const calls=response.toolCalls
   // A renewal may have replaced surface inside callModel. Validate against
   // that freshly submitted request, not the superseded pre-renewal fence.
   if(!surface.tools?.length||!response.responseId||(!opts.unlimitedWork&&calls.length>4)||
    calls.some(call=>!call.id||!surface.tools!.some(tool=>tool.function.name===call.function.name))||
    new Set(calls.map(call=>call.id)).size!==calls.length)return failed('calculator_protocol',response.model)
   if(calls.some(call=>call.function.name==='calculate_project'))calculationRounds++
   previous=response.responseId;conversation=[]
   for(const call of calls){
    if(!await opts.hasAccess())throw new Error('project_denied')
    if(Date.now()>=opts.deadline)return failed('deadline',response.model)
    let raw:unknown
    try{raw=JSON.parse(call.function.arguments)}catch{raw=null}
    const result=await session.execute(call.function.name,raw)
    if(!await opts.hasAccess())throw new Error('project_denied')
    // A requested calculation cannot turn into a model-only arithmetic verdict
    // when its live permission or allowance disappears. A task that never
    // needed arithmetic may still finish without opening this optional tool.
    if(call.function.name==='calculate_project'){
     if(result.status==='denied')throw new Error('project_denied')
     if(result.status==='budget_exhausted'||result.status==='unavailable'&&!result.reason&&calculator.remaining===0)return failed('calculator_budget_exhausted',response.model)
     if(result.status==='unavailable'&&(!result.reason||result.reason==='calculator_policy_unavailable'))return failed('calculator_policy_unavailable',response.model)
    }
    conversation.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)})
   }
  }
 }finally{release?.()}
}

/** Optional calculations belong to the specialist's normal structured call.
 * Continue the same provider conversation only after an actual tool request;
 * every model call retains the caller's pinned schema, limits and accounting. */
export async function callWithCalculator<T>(options:OpenAIServiceOptions,opts:CalculatorCallOptions<T>):Promise<OpenAIServiceResponse<T>>{
 if(!opts.calculator||!hasCalculatorContract(opts.catalog))return opts.callModel(options)
 const instructionVersion=opts.catalog.definition('agent-contract.ask-bob','agent_contract').metadata.specialist_tool_instructions_version
 if(instructionVersion===1)return callWithLazyCalculator(options,opts)
 if(instructionVersion!==undefined)throw new Error('calculator_instruction_policy_unavailable')
 // Only immutable jobs pinned before specialist discovery retain these exact
 // eager request inputs. Changing them would invalidate their paid journal.
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
