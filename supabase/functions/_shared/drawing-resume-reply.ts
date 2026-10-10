import type {OpenAIServiceOptions,OpenAIServiceResponse} from './openai-service.ts'
import type {ProjectWriteReceipt} from '../../../src/data/provenance.ts'
import {isProjectWriteReceipt} from '../../../src/data/bobEvidence.ts'
import {createDeliveryLanguage,type DeliveryFormatter,type NoticeInput} from './delivery-language.ts'

/** The receipt comes from the CAD writer/request store, never from the model's
 * outcome or its provisional saved flag. Other saved changes are partial work. */
export function confirmedDrawingReceipt(value:unknown,projectId:string):value is ProjectWriteReceipt{
 return isProjectWriteReceipt(value,projectId)&&value.dataset==='artifacts'&&value.operation!=='deleted'
}

/** Private status is composed from domain state and exact receipts. Localisation
 * prepares outcome-independent phrases; it cannot write the status answer. */
export async function drawingResumeReply(opts:{
 projectId:string;message:string;userId:string;outcome:Record<string,any>;
 drawingReceipt?:unknown;receipts?:ProjectWriteReceipt[];
 hasAccess:()=>Promise<boolean>;
 callModel:(o:OpenAIServiceOptions)=>Promise<OpenAIServiceResponse<any>>;
 formatNotice?:DeliveryFormatter;
}){
 if(!await opts.hasAccess())throw new Error('project_denied')
 const {outcome,drawingReceipt}=opts
 const saved=confirmedDrawingReceipt(drawingReceipt,opts.projectId)
 const receipts=(opts.receipts??[]).filter(r=>isProjectWriteReceipt(r,opts.projectId))
 if(saved&&!receipts.some(r=>r.dataset==='artifacts'&&r.recordId===drawingReceipt.recordId&&r.revision===drawingReceipt.revision))receipts.push(drawingReceipt)
 const gaps=Array.isArray(outcome.gaps)?outcome.gaps:[]
 const missing=[...new Set<string>(gaps.map((g:any):string=>typeof g?.detail==='string'?g.detail.trim():'').filter(Boolean))]
 const reason=typeof outcome.reason==='string'?outcome.reason:typeof outcome.status==='string'?outcome.status:'drawing_result_unconfirmed'
 const detail=[reason,typeof outcome.next_action==='string'?outcome.next_action:''].filter(Boolean).join('\n')
 const input:NoticeInput=saved?{receipts}
  :{notice:['unavailable','blocked'].includes(outcome.status)?'drawing_unavailable':'drawing_incomplete',receipts,missing,detail}
 const format=opts.formatNotice??createDeliveryLanguage(opts)
 // Budget stops need no further provider call; already seeded phrases and exact
 // labels remain usable. Never return a free outcome.user_message/answer here.
 const answer=outcome.budget_stop||reason==='turn_budget_exhausted'||outcome.status==='already_saved'||outcome.stage==='cad_engine'?format.fallback(input):await format(input)
 if(!await opts.hasAccess())throw new Error('project_denied')
 return answer
}
