import type { PlanLinks } from './project-plan-links.ts'
import type { BuildingScope } from './project-building-scope.ts'
import type { WorkRecords } from './project-work-records.ts'
import type { SolutionActions } from './project-solution-actions.ts'
import type { ProjectEdits } from './project-edits.ts'
import type { AiCatalogSession } from './ai-catalog.ts'
import type { AgentWorkpads } from './bob-agent-workpad.ts'
import type { ConstructionTools } from './construction-draft.ts'
import { answerNotice, createDeliveryLanguage, withNotice, type NoticeInput } from './delivery-language.ts'
import type { KnowledgeReader } from './building-knowledge.ts'
import type { OperationalReader } from './project-operations.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { RecordDetailReader } from './project-record-detail.ts'
import type { ProjectImageTools } from './project-image-tools.ts'
import { type CadAssistant } from './cad-assistant.ts'
import type { MaterialCatalogReader } from './material-catalog.ts'
import type { ToolPolicyReader, ToolInstructions } from './project-tools/session.ts'
import type { ProjectContext } from './project-context/dispatcher.ts'
import type { createPlanAssistant } from './plan-assistant.ts'
import type { WorkingContext } from './bob-working-context.ts'
import type { ContextSurface } from './bob-context-continuation.ts'
import type { CurrentView } from '../../../src/domain/bobScreen.ts'
import type { AnswerEvidence } from '../../../src/data/provenance.ts'
import { runProjectAnswer, type BobAnswerCheckpoint, type ModelCall, type ProjectAnswer, type TurnObservation, type TurnProgress } from './project-answer.ts'
import type { createProjectLookup } from './project-lookup.ts'
import type { ProjectCalculator } from './project-calculator.ts'
import { compactReceipts, type ProjectWriter } from './project-write.ts'
import { bobTurnFailure, type BobTurnFailure, type BobTurnFailureStage } from './bob-turn-failure.ts'

/** Production orchestration, injected for failure/retry tests without an AI key. */
export async function runClaimedProjectTurn(opts: { continuedWork?:boolean;
  aiCatalog: AiCatalogSession;
  /** Same pinned build-guide switch that runProjectAnswer forwards into the toolbox. */
  boundDrawingWork?:boolean;
  workerOperations?:import('./worker-operations.ts').WorkerOperations;
  buildGuideTools?: boolean;
  calculator?: ProjectCalculator;
  projectId: string; userId: string; message: string; generation?: number; previousResponseId?: string;
  lookup: ReturnType<typeof createProjectLookup>; writer?: ProjectWriter; callModel: ModelCall;
  hasAccess: () => Promise<boolean>;
  projectContext?: ProjectContext;
  currentView?: CurrentView; validateCurrentView?: () => Promise<boolean>; getCurrentViewEvidence?: () => CurrentView;
  knowledgeReader?: KnowledgeReader; operationalReader?: OperationalReader; recordReader?: RecordDetailReader; imageTools?: ProjectImageTools; cadAssistant?: CadAssistant; catalogReader?: MaterialCatalogReader; constructionTools?: ConstructionTools; projectEdits?: ProjectEdits; solutionActions?: SolutionActions; workRecords?: WorkRecords; planLinks?: PlanLinks; buildingScope?: BuildingScope; buildTree?: import('./build-tree.ts').BuildTreeTools; planAssistant?: ReturnType<typeof createPlanAssistant>;
  sourceReader?: import('./source-reader.ts').SourceReader;
  readToolPolicy?: ToolPolicyReader;
  toolInstructions?: ToolInstructions; contextEpoch?: () => number;
  carryLoadedTools?: boolean;
  corePreload?: boolean;
  toolPicker?: boolean;
  buildingLinks?: import('./project-building-scope.ts').BuildingLinks;
  pureFacts?: boolean; projectFacts?: import('./project-facts.ts').ProjectFacts;
  registerContextSurface?: (refresh: () => Promise<ContextSurface>) => void;
  prepareContext?: () => Promise<WorkingContext>;
  observe?: (value: TurnObservation) => void; onProgress?: (value: TurnProgress) => void;
  onFailure?: (value: BobTurnFailure) => void;
  onTool?: (value: { name: string; status: string; step: number; index: number; ms: number; validation_code?: string }) => void;
  onToolBatch?: (names: string[]) => void;
  /** Runs once after a completed answer, before settlement; see description-weigher.ts. */
  weighDescription?: (answer: string) => Promise<unknown>;
  deadline?: number; resume?: boolean; beforeSettle?: () => void; modelTimeoutMs?: number; unlimitedWork?: boolean;
  finalAnswer?: boolean;
  workerCheckpoint?: boolean;
  compactToolState?: boolean;
  workpads?: AgentWorkpads;
  releaseContext?: (responseId: string) => void;
  checkpoint?: BobAnswerCheckpoint;
  commit?: (result: Extract<ProjectAnswer, { ok: true }>, generation: number) => Promise<void>;
  fail: (generation: number) => Promise<void>;
}): Promise<ProjectAnswer> {
  let generation = opts.generation ?? 0
  const fail = async () => { try { await opts.fail(generation) } catch { /* lease expiry remains a recovery path */ } }
  let result: ProjectAnswer = { ok: false, error: 'ai_unavailable' }
  let recovered = false
  let stage: BobTurnFailureStage = 'recover'
  const failed = (at: BobTurnFailureStage, error: unknown) => opts.onFailure?.(bobTurnFailure(at, error))
  const formatNotice=createDeliveryLanguage(opts)
  try {
    if (opts.writer) recovered = (await opts.writer.recover()).length > 0
    if (!recovered || opts.resume) {
      stage = 'prepare_context'
      const context = opts.prepareContext ? await opts.prepareContext() : undefined
      stage = 'answer'
      result = await runProjectAnswer({ ...opts, context,
        callModel: async request => {
          stage = 'model'
          const response = await opts.callModel(request)
          stage = 'answer'
          return response
        },
        ...(opts.checkpoint ? { checkpoint: { ...opts.checkpoint, save: async state => {
          stage = 'checkpoint'
          await opts.checkpoint!.save(state)
          stage = 'answer'
        } } } : {}),
      })
      if (!result.ok) failed(stage, result.error)
    }
  } catch (error) {
    rethrowContinuation(error)
    failed(stage, error)
    const code = error instanceof Error ? error.message : ''
    result = { ok: false, error: ['context_preparing', 'context_unavailable', 'context_input_too_large', 'project_denied', 'tool_catalog_unavailable', 'turn_budget_exhausted'].includes(code) ? code : 'ai_unavailable' }
  }
  // A verified local failure notice needs no provider cursor. It must survive
  // settlement/commit without replacing prior writes or buying a new reply.
  const cadFailureNotice=result.ok&&typeof opts.cadAssistant?.failure?.user_message==='string'
    &&result.answer===opts.cadAssistant.failure.user_message
  let recovery:{input:NoticeInput;text:string}|undefined
  // A replacement answer that is only a notice carries exactly that one marker.
  const noticeOnly=(evidence:AnswerEvidence,input:NoticeInput,text:string):AnswerEvidence=>({...evidence,notices:[answerNotice(input,text)]})
  try {
    if(opts.writer?.receipts.length&&((recovered&&!opts.resume)||opts.writer.uncertain||!result.ok||(!result.providerResponseId&&!cadFailureNotice))){
      const input:NoticeInput={notice:opts.writer.uncertain?'uncertain':'recovered',receipts:opts.writer.receipts}
      recovery={input,text:await formatNotice(input)}
    }
  } catch(error) {
    rethrowContinuation(error)
    await fail()
    return {ok:false,error:'project_denied'}
  }
  // The description follows what this turn saved; its own write settles with them.
  if (opts.weighDescription && result.ok && opts.writer?.receipts.length && !opts.writer.uncertain && !(recovered && !opts.resume)) {
    try { await opts.weighDescription(result.answer) }
    catch (error) { rethrowContinuation(error) }
  }
  opts.beforeSettle?.()
  if (opts.writer) {
    const uncertain = opts.writer.uncertain
    try { generation = await opts.writer.settle() }
    catch (error) {
      rethrowContinuation(error)
      failed('settle', error)
      await fail()
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      const input:NoticeInput={notice:'uncertain',receipts:opts.writer.receipts}, answer=formatNotice.fallback(input)
      return { ok: true, projectId: opts.projectId, answer,
        evidence: noticeOnly({ kind: 'ai_assessment', references: opts.knowledgeReader?.references ?? [], sources: [], partial: true, writes: compactReceipts(opts.writer.receipts) }, input, answer) }
    }
    if (!await opts.hasAccess()) { await fail(); return { ok: false, error: 'project_denied' } }
    const evidence: AnswerEvidence = { kind: 'ai_assessment', references: opts.knowledgeReader?.references ?? [], sources: [...opts.lookup.sources, ...(opts.planAssistant?.sources ?? []), ...(opts.cadAssistant?.sources ?? [])].filter((s,i,a)=>a.findIndex(x=>x.dataset===s.dataset&&x.recordId===s.recordId)===i),
      partial: !!opts.operationalReader?.partial || opts.lookup.partial || !!opts.projectContext?.partial || !!opts.catalogReader?.partial || !!opts.planAssistant?.partial || !!opts.cadAssistant?.partial || !result.ok || (result.ok && result.evidence.partial), writes: compactReceipts(opts.writer.receipts) }
    if (result.ok && result.providerResponseId && uncertain && opts.writer.receipts.length && !(recovered && !opts.resume)) {
      // Bob's own words stay; the server appends what settlement verified.
      let notice: string
      try { notice = await formatNotice({ notice: 'uncertain', receipts: opts.writer.receipts }) }
      catch (error) { rethrowContinuation(error); notice = formatNotice.fallback({ notice: 'uncertain', receipts: opts.writer.receipts }) }
      result = { ...result, answer: result.answer + '\n\n' + notice, evidence: withNotice(evidence, answerNotice({ notice: 'uncertain', receipts: opts.writer.receipts }, notice)) }
    } else if (opts.writer.receipts.length && ((recovered && !opts.resume) || uncertain || !result.ok || (!result.providerResponseId&&!cadFailureNotice))) {
      const input:NoticeInput=recovery?.input??{notice:'recovered',receipts:opts.writer.receipts}, answer=recovery?.text??formatNotice.fallback(input)
      result = { ok: true, projectId: opts.projectId, answer, evidence: noticeOnly(evidence, input, answer) }
    } else if (uncertain && !opts.writer.receipts.length) result = { ok: false, error: 'write_not_saved' }
    else if (result.ok) result = { ...result, evidence }
  }
  if (!result.ok) { await fail(); return result }
  if (opts.currentView) {
    const valid = !opts.validateCurrentView || await opts.validateCurrentView()
    if (!valid) {
      failed('current_view', 'context_unavailable')
      if (!await opts.hasAccess()) { await fail(); return { ok: false, error: 'project_denied' } }
      if (!result.evidence.writes?.length) { await fail(); return { ok: false, error: 'context_unavailable' } }
      // Preserve committed changes while withholding a reply based on a changed focus.
      const input:NoticeInput={ notice: 'recovered', receipts: opts.writer?.receipts ?? [] }, answer=formatNotice.fallback(input)
      result = { ok: true, projectId: opts.projectId, answer,
        evidence: noticeOnly({ ...result.evidence, sources: [], partial: true, currentView: { status: 'unavailable', projectId: opts.projectId,
          surface: opts.currentView.surface, focus: {}, sources: [], warnings: ['focus_changed_after_read'], retrievedAt: new Date().toISOString() } }, input, answer) }
    } else result = { ...result, evidence: { ...result.evidence, currentView: opts.getCurrentViewEvidence?.() ?? opts.currentView } }
  }
  if (opts.projectContext && !await opts.projectContext.validate()) {
    failed('project_context', 'context_unavailable')
    if (!await opts.hasAccess()) { await fail(); return { ok: false, error: 'project_denied' } }
    if (opts.writer?.receipts.length) {
      const input:NoticeInput={notice:'recovered',receipts:opts.writer.receipts}, answer=formatNotice.fallback(input)
      result = { ok: true, projectId: opts.projectId, answer,
        evidence: noticeOnly({ kind: 'ai_assessment', references: opts.knowledgeReader?.references ?? [], sources: [], partial: true, writes: compactReceipts(opts.writer.receipts) }, input, answer) }
    } else { await fail(); return { ok: false, error: 'context_unavailable' } }
  }
  if (opts.commit) {
    if (!result.providerResponseId && !result.evidence.writes?.length && !cadFailureNotice) { await fail(); return { ok: false, error: 'provider_state_unavailable' } }
    try { await opts.commit(result, generation) }
    catch (error) {
      rethrowContinuation(error)
      failed('commit', 'conversation_unavailable')
      await fail()
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      if (!result.evidence.writes?.length) return { ok: false, error: 'conversation_unavailable' }
      let notice: string
      try { notice = await formatNotice({ notice: 'chat_unsynced' }) }
      catch (error) { rethrowContinuation(error); notice = formatNotice.fallback({ notice: 'chat_unsynced' }) }
      return { ...result, evidence: withNotice({...result.evidence,partial:true}, answerNotice({ notice: 'chat_unsynced' }, notice)), answer: result.answer + '\n\n' + notice }
    }
  }
  return result
}
