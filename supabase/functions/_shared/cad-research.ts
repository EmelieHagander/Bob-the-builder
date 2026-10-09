import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import { prepareIntakeAssessment, evidenceRefs, type IntakeAssessment } from './cad-intake.ts'
import type { DesignHandoff } from './cad-review.ts'
import type { AiCatalogSession } from './ai-catalog.ts'
import { rethrowContinuation } from './bob-job-journal.ts'

type Evidence = { tool: string; result: unknown }
export const CAD_RESEARCH_CONTRACT = '2026-10-09-solution-advice-and-purpose-readiness'
const FINISH_NAME='finish_cad_research'

/** Read-only selection, in a separate provider conversation. The constructor gets
 * exact tool results, never a small model's lossy rewrite of measurements. */
export async function collectCadResearch(opts: {
 aiCatalog:AiCatalogSession; userId: string; messages: NonNullable<OpenAIServiceOptions['messages']>;
 tools: () => NonNullable<OpenAIServiceOptions['tools']>;
 execute: (name: string, args: unknown) => Promise<unknown>;
 callModel: (o: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<string>>;
 hasAccess: () => Promise<boolean>; deadline: number;
 handoff:DesignHandoff; previousAssessment?:IntakeAssessment|null; choiceIds?:ReadonlySet<string>; initialEvidence?:Evidence[]; carrier?:()=>NonNullable<OpenAIServiceOptions['messages']>; confirmDelivery?:()=>void;
}) {
 const evidence: Evidence[] = [...opts.initialEvidence??[]]; let bytes = new TextEncoder().encode(JSON.stringify(evidence)).length, truncated = false, calls = 0
 let assessment:IntakeAssessment|null=null
 let messages = opts.messages, previousResponseId: string | undefined
 for (let round = 0; round < 3 && Date.now() + 30000 < opts.deadline; round++) {
  if (!await opts.hasAccess()) throw new Error('project_denied')
  const refs=evidenceRefs(evidence,opts.handoff)
  if(!opts.aiCatalog)throw new Error('ai_catalog_unavailable')
  const catalogSchemaParameters={evidence_refs:[...refs].sort(),...(opts.handoff.requirements.length?{check_ids:opts.handoff.requirements.map(r=>r.id)}:{})}
  const tools = [...opts.tools(),opts.aiCatalog.tool(FINISH_NAME,catalogSchemaParameters)]
  const result = await opts.callModel({ app: 'bob', coworkerId: 'bob', functionName: 'cad-research',
   aiFunction: 'cad-research', module: 'cad', userId: opts.userId, catalogRoleKey:'cad-research',catalogSchemaParameters,
   messages:[...messages,{role:'user',content:JSON.stringify({intake_contract:CAD_RESEARCH_CONTRACT,required_check_ids:opts.handoff.requirements.map(r=>r.id),allowed_source_refs:[...refs].sort(),rules:opts.aiCatalog.text('cad-research.readiness-rules')})},...opts.carrier?.()??[]], tools, previousResponseId, maxOutputTokens: 3000, outputTokenLimit: 3000,
   timeoutMs: Math.min(45000, opts.deadline - Date.now()) })
  calls++
  if (!await opts.hasAccess()) throw new Error('project_denied')
  if (result.error === 'turn_budget_exhausted') throw new Error(result.error)
  if (!result.success || !result.responseId) { truncated = true; break }
  opts.confirmDelivery?.()
  if (!result.toolCalls?.length) break
  if (result.toolCalls.length > 8) { truncated = true; break }
  previousResponseId = result.responseId; messages = []
  let finished = false
  for (const call of result.toolCalls) {
   if (!await opts.hasAccess()) throw new Error('project_denied')
   let out: unknown
   try {
    if (!tools.some(t => t.function.name === call.function.name)) throw new Error('tool_not_offered')
    const args = JSON.parse(call.function.arguments)
    if (call.function.name === FINISH_NAME) {
     assessment=await prepareIntakeAssessment(args,opts.handoff,evidenceRefs(evidence,opts.handoff),opts.previousAssessment,opts.choiceIds)
     if(assessment&&result.toolCalls.length===1){finished=true;continue}
     assessment=null
     const checks=[...(Array.isArray(args?.checks)?args.checks:[]),...(Array.isArray(args?.additional_needs)?args.additional_needs:[])]
     const allowed=evidenceRefs(evidence,opts.handoff)
     out={status:'invalid',reason:opts.aiCatalog.text('cad-research.invalid-assessment'),invalid_source_refs:[...new Set(checks.flatMap(c=>Array.isArray(c?.source_refs)?c.source_refs:[]).filter(r=>typeof r==='string'&&!allowed.has(r)))].slice(0,20),required_check_ids:opts.handoff.requirements.map(r=>r.id),allowed_source_refs:[...allowed].sort()}
    } else
    out = await opts.execute(call.function.name, args)
   } catch (error) { rethrowContinuation(error); if (error instanceof Error && error.message === 'project_denied') throw error; out = {status:'unavailable'} }
   const observed=out as {status?:string;items?:{status:string}[]}|null
   if(call.function.name!==FINISH_NAME&&observed?.status&&['unavailable','denied','invalid','budget_exhausted','record_too_large'].includes(observed.status)||call.function.name==='open_project_item'&&observed?.items?.some(i=>!['prepared','ok'].includes(i.status)))truncated=true
   const entry = { tool: call.function.name, result: out }
   const size = new TextEncoder().encode(JSON.stringify(entry)).length
   if (bytes + size > 120000) { truncated = true; finished = true; break }
   evidence.push(entry); bytes += size
   messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out) })
  }
  if (finished) break
  if (round === 2) truncated = true
 }
 return { evidence, bytes, truncated:truncated||!assessment, calls, assessment }
}
