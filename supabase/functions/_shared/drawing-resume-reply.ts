import type {OpenAIServiceOptions,OpenAIServiceResponse} from './openai-service.ts'
import type {ProjectWriteReceipt} from '../../../src/data/provenance.ts'
import {isProjectWriteReceipt} from '../../../src/data/bobEvidence.ts'
import {createDeliveryLanguage,type DeliveryFormatter,type NoticeInput} from './delivery-language.ts'
import {humanTextIssues} from './human-text.ts'

/** The receipt comes from the CAD writer/request store, never from the model's
 * outcome or its provisional saved flag. Other saved changes are partial work. */
export function confirmedDrawingReceipt(value:unknown,projectId:string):value is ProjectWriteReceipt{
 return isProjectWriteReceipt(value,projectId)&&value.dataset==='artifacts'&&value.operation!=='deleted'
}

/** The owner-facing meaning of a drawing outcome. Outcome codes and Bob's
 * next_action guidance are model-facing and never reach the chat notice. */
export function drawingNotice(outcome:Record<string,any>):'drawing_unavailable'|'drawing_prerequisite'|'drawing_incomplete'{
 if(['unavailable','blocked'].includes(outcome.status)||outcome.stage==='cad_engine')return 'drawing_unavailable'
 if(outcome.status==='prerequisite_required'||['target','design_readiness'].includes(outcome.stage))return 'drawing_prerequisite'
 return 'drawing_incomplete'
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
 // A gap the owner can act on stays; one carrying internal codes or IDs is left out.
 const missing=[...new Set<string>(gaps.map((g:any):string=>typeof g?.detail==='string'?g.detail.trim():'').filter((d:string)=>d&&!humanTextIssues(d).length))]
 const reason=typeof outcome.reason==='string'?outcome.reason:''
 const input:NoticeInput=saved?{receipts}:{notice:drawingNotice(outcome),receipts,missing}
 const format=opts.formatNotice??createDeliveryLanguage(opts)
 // Budget stops need no further provider call; already seeded phrases and exact
 // labels remain usable. Never return a free outcome.user_message/answer here.
 const answer=outcome.budget_stop||reason==='turn_budget_exhausted'||outcome.status==='already_saved'||outcome.stage==='cad_engine'?format.fallback(input):await format(input)
 if(!await opts.hasAccess())throw new Error('project_denied')
 return answer
}
