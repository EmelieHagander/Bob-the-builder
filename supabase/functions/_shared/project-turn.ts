import { createDeliveryLanguage } from './delivery-language.ts'
import type { DeliveryObservation } from './execution-metrics.ts'
import type { KnowledgeReader } from './building-knowledge.ts'
import type { OperationalReader } from './project-operations.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { RecordDetailReader } from './project-record-detail.ts'
import type { ProjectImageTools } from './project-image-tools.ts'
import { type CadAssistant } from './cad-assistant.ts'
import type { MaterialCatalogReader } from './material-catalog.ts'
import type { ToolPolicyReader } from './project-tools/session.ts'
import type { ProjectContext } from './project-context/dispatcher.ts'
import type { createPlanAssistant } from './plan-assistant.ts'
import type { WorkingContext } from './bob-working-context.ts'
import type { AnswerEvidence } from '../../../src/data/provenance.ts'
import { runProjectAnswer, type ModelCall, type ProjectAnswer } from './project-answer.ts'
import type { createProjectLookup } from './project-lookup.ts'
import { compactReceipts, type ProjectWriter } from './project-write.ts'

/** Production orchestration, injected for failure/retry tests without an AI key. */
export async function runClaimedProjectTurn(opts: {
  projectId: string; userId: string; message: string; generation?: number; previousResponseId?: string;
  lookup: ReturnType<typeof createProjectLookup>; writer?: ProjectWriter; callModel: ModelCall;
  hasAccess: () => Promise<boolean>;
  projectContext?: ProjectContext;
  knowledgeReader?: KnowledgeReader; operationalReader?: OperationalReader; recordReader?: RecordDetailReader; imageTools?: ProjectImageTools; cadAssistant?: CadAssistant; catalogReader?: MaterialCatalogReader; planAssistant?: ReturnType<typeof createPlanAssistant>;
  readToolPolicy?: ToolPolicyReader;
  prepareContext?: () => Promise<WorkingContext>;
  observeDelivery?: (value: DeliveryObservation) => void;
  deadline?: number; resume?: boolean; beforeSettle?: () => void; modelTimeoutMs?: number;
  initialDrawingDelivery?: () => Promise<boolean>;
  initialWriteReceipts?: () => Promise<import('./project-write.ts').WriteReadback[]>;
  commit?: (result: Extract<ProjectAnswer, { ok: true }>, generation: number) => Promise<void>;
  fail: (generation: number) => Promise<void>;
}): Promise<ProjectAnswer> {
  let generation = opts.generation ?? 0
  const fail = async () => { try { await opts.fail(generation) } catch { /* lease expiry remains a recovery path */ } }
  let result: ProjectAnswer = { ok: false, error: 'ai_unavailable' }
  let recovered = false
  const formatNotice=createDeliveryLanguage(opts)
  try {
    if (opts.writer) recovered = (await opts.writer.recover()).length > 0
    if (!recovered || opts.resume) {
      const context = opts.prepareContext ? await opts.prepareContext() : undefined
      result = await runProjectAnswer({ ...opts, context, formatNotice })
    }
  } catch (error) {
    rethrowContinuation(error)
    const code = error instanceof Error ? error.message : ''
    result = { ok: false, error: ['context_preparing', 'context_unavailable', 'project_denied', 'tool_catalog_unavailable'].includes(code) ? code : 'ai_unavailable' }
  }
  let recoveryAnswer:string|undefined
  try {
    if(opts.writer?.receipts.length&&((recovered&&!opts.resume)||opts.writer.uncertain||!result.ok||!result.providerResponseId))
      recoveryAnswer=await formatNotice({notice:opts.writer.uncertain?'uncertain':'recovered',receipts:opts.writer.receipts})
  } catch(error) {
    rethrowContinuation(error)
    await fail()
    return {ok:false,error:'project_denied'}
  }
  opts.beforeSettle?.()
  if (opts.writer) {
    const uncertain = opts.writer.uncertain
    try { generation = await opts.writer.settle() }
    catch {
      await fail()
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      return { ok: true, projectId: opts.projectId, answer: formatNotice.fallback({notice:'uncertain',receipts:opts.writer.receipts}),
        evidence: { kind: 'ai_assessment', references: opts.knowledgeReader?.references ?? [], sources: [], partial: true, writes: compactReceipts(opts.writer.receipts) } }
    }
    if (!await opts.hasAccess()) { await fail(); return { ok: false, error: 'project_denied' } }
    const evidence: AnswerEvidence = { kind: 'ai_assessment', references: opts.knowledgeReader?.references ?? [], sources: [...opts.lookup.sources, ...(opts.planAssistant?.sources ?? []), ...(opts.cadAssistant?.sources ?? [])].filter((s,i,a)=>a.findIndex(x=>x.dataset===s.dataset&&x.recordId===s.recordId)===i),
      partial: !!opts.operationalReader?.partial || opts.lookup.partial || !!opts.projectContext?.partial || !!opts.catalogReader?.partial || !!opts.planAssistant?.partial || !!opts.cadAssistant?.partial || !result.ok || (result.ok && result.evidence.partial), writes: compactReceipts(opts.writer.receipts) }
    if (opts.writer.receipts.length && ((recovered && !opts.resume) || uncertain || !result.ok || !result.providerResponseId)) {
      result = { ok: true, projectId: opts.projectId, answer: recoveryAnswer??formatNotice.fallback({notice:'recovered',receipts:opts.writer.receipts}), evidence }
    } else if (uncertain && !opts.writer.receipts.length) result = { ok: false, error: 'write_not_saved' }
    else if (result.ok) result = { ...result, evidence }
  }
  if (!result.ok) { await fail(); return result }
  if (opts.projectContext && !await opts.projectContext.validate()) {
    if (!await opts.hasAccess()) { await fail(); return { ok: false, error: 'project_denied' } }
    if (opts.writer?.receipts.length) {
      result = { ok: true, projectId: opts.projectId, answer: formatNotice.fallback({notice:'recovered',receipts:opts.writer.receipts}),
        evidence: { kind: 'ai_assessment', references: opts.knowledgeReader?.references ?? [], sources: [], partial: true, writes: compactReceipts(opts.writer.receipts) } }
    } else { await fail(); return { ok: false, error: 'context_unavailable' } }
  }
  if (opts.commit) {
    if (!result.providerResponseId && !result.evidence.writes?.length) { await fail(); return { ok: false, error: 'provider_state_unavailable' } }
    try { await opts.commit(result, generation) }
    catch {
      await fail()
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      if (!result.evidence.writes?.length) return { ok: false, error: 'conversation_unavailable' }
      return { ...result, evidence:{...result.evidence,partial:true}, answer: result.answer + '\n\n' + formatNotice.fallback({notice:'chat_unsynced'}) }
    }
  }
  return result
}
