import type {OpenAIServiceOptions,OpenAIServiceResponse} from './openai-service.ts'
import {rethrowContinuation} from './bob-job-journal.ts'

/** Private delivery of the actual domain outcome. The language call cannot
 * dispatch tools, choose dimensions or establish a saved result. */
export async function drawingResumeReply(opts:{message:string;userId:string;outcome:Record<string,any>;saved:boolean;hasAccess:()=>Promise<boolean>;callModel:(o:OpenAIServiceOptions)=>Promise<OpenAIServiceResponse<string>>}){
 const {outcome,saved}=opts
 const gaps=Array.isArray(outcome.gaps)?outcome.gaps:[]
 const ownerNeeds=gaps.filter(g=>['owner_decision','measurement'].includes(g.action)).map(g=>String(g.detail??'')).filter(Boolean)
 const fallback=saved?'Ritningen är sparad.':typeof outcome.user_message==='string'?outcome.user_message
  :outcome.status==='needs_data'&&gaps.length
   ?'Ritningen är inte sparad. '+(ownerNeeds.length?'Kan du lämna följande komplettering: '+[...new Set(ownerNeeds)].join(' ')+'?':'Följande konstruktionsarbete återstår: '+gaps.map(g=>String(g.detail??'')).filter(Boolean).join(' '))
   :'Ritningen är inte sparad. Uppdraget behöver fortsatt arbete; '+String(outcome.reason??outcome.status??'resultatet kunde inte bekräftas')+'.'
 if(typeof outcome.user_message==='string'&&!saved)return fallback
 if(!await opts.hasAccess())throw new Error('project_denied')
 try{
  const result=await opts.callModel({app:'bob',coworkerId:'bob',functionName:'work-router',aiFunction:'bob-delivery-language',module:'global',userId:opts.userId,catalogRoleKey:'drawing-resume-reply',catalogSchemaKey:'drawing_resume_reply',
   messages:[{role:'user',content:JSON.stringify({owner_request:opts.message,saved_receipt_confirmed:saved,outcome})}],schemaName:'drawing_resume_reply',maxOutputTokens:2000,outputTokenLimit:2000,timeoutMs:15000})
  if(!await opts.hasAccess())throw new Error('project_denied')
  if(result.success&&typeof result.data==='string'){
   const parsed=JSON.parse(result.data)
   if(parsed&&Object.keys(parsed).join(',')==='answer'&&typeof parsed.answer==='string'&&parsed.answer.trim()&&parsed.answer.length<=6000)return parsed.answer.trim()
  }
 }catch(error){rethrowContinuation(error);if(error instanceof Error&&error.message==='project_denied')throw error}
 return fallback
}
