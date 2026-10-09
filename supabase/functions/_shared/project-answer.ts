import type { ConstructionTools } from './construction-draft.ts'
import type { KnowledgeReader } from './building-knowledge.ts'
import type { OperationalReader } from './project-operations.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { RecordDetailReader } from './project-record-detail.ts'
import type { ProjectImageTools } from './project-image-tools.ts'
import { type CadAssistant } from './cad-assistant.ts'
import type { MaterialCatalogReader } from './material-catalog.ts'
import type { createPlanAssistant } from './plan-assistant.ts'
import type { ProjectContext } from './project-context/dispatcher.ts'
import type { OpenAIServiceOptions, OpenAIServiceResponse } from './openai-service.ts'
import type { createProjectLookup } from './project-lookup.ts'
import { buildBobHands } from './bob-prompt.ts'
import type { AiCatalogSession } from './ai-catalog.ts'
import { compactReceipts, type ProjectWriter } from './project-write.ts'
import type { WorkingContext } from './bob-working-context.ts'
import type { CurrentView } from '../../../src/domain/bobScreen.ts'
import type { AnswerEvidence } from '../../../src/data/provenance.ts'
import { BOB_WRITE_LIMIT } from '../../../src/data/bobEvidence.ts'
import { createBobToolSession, sortToolbox } from './project-tools/bob-tools.ts'
import { type ToolPolicyReader, type ToolboxEntry, type ToolInstructions, checkedToolSnapshot } from './project-tools/session.ts'
import catalogSeed from './project-tools/catalog-seed.json' with { type: 'json' }

/** Instruction content comes from the pinned database manifest; shelf state is data. */
export function buildBobSystemMessage(aiCatalog: AiCatalogSession, tools: OpenAIServiceOptions['tools'] = [], toolbox: ToolboxEntry[] = []): string {
  return [aiCatalog.role('ask-bob').systemMessage, buildBobHands(aiCatalog, tools, sortToolbox(toolbox, aiCatalog.definition('bob.tools', 'tool_contract').definition.shelves as { label: string; tools: string[] }[]))].join('\n\n')
}

/** Per-turn execution ceilings. Writes are enforced again by every SQL writer. */
export const BOB_TURN_LIMITS = { steps: 24, callsPerStep: 8, writes: BOB_WRITE_LIMIT } as const

function buildTurnFrame(aiCatalog: AiCatalogSession, projectId: string, briefing: unknown, context?: WorkingContext, currentView?: CurrentView): string {
  const text = (key: string) => aiCatalog.text('bob.frame.' + key)
  return [text('current'), aiCatalog.text('bob.frame.binding', { project_id: projectId }),
    text('briefing-trust'), text('prior-conversation'),
    ...(currentView ? [text('current-view'), JSON.stringify(currentView)] : []),
    ...(context ? [text('history'), JSON.stringify({ throughSeq: context.throughSeq, summary: context.summary, index: context.historyIndex ?? [] }),
      text('recent'), JSON.stringify({ messageStates: context.recent.map(m => ({ seq: m.seq, state: m.state })) })] : []),
    ...(context?.recentWrites?.length ? [text('saved'), JSON.stringify({ recentWrites: context.recentWrites })] : []),
    ...(context?.recentSources?.length ? [text('sources'), JSON.stringify({ recentSources: context.recentSources })] : []),
    aiCatalog.text('bob.frame.limits', { steps: BOB_TURN_LIMITS.steps, writes: BOB_TURN_LIMITS.writes }),
    text('briefing-label'), JSON.stringify(briefing),
  ].join('\n\n')
}
export type ModelCall = (options: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<string>>
export type ProjectAnswer =
  | { ok: true; answer: string; projectId: string; evidence: AnswerEvidence; providerResponseId?: string }
  | { ok: false; error: string }
export type TurnEnd = 'answered' | 'asked' | 'step_budget' | 'time_budget'
export interface TurnObservation { steps: number; tool_calls: number; deferred_calls: number; completion_checks: number; nudges: number; end: TurnEnd | 'failed' }
export interface TurnProgress { stage: 'thinking' | 'tool' | 'finishing'; tool?: string; step: number; saved: number }

/** Embedded seed is for injected/offline callers only. Production supplies the
 * caller-JWT reader in ask-openai.ts; a failed live read NEVER falls back here. */
export const seedToolPolicy: ToolPolicyReader = async () => checkedToolSnapshot({ phase: null, tools: catalogSeed })
const toolFailureCode = (error: unknown) => error instanceof Error && ['project_denied', 'tool_execution_unavailable'].includes(error.message)
  ? error.message : 'tool_catalog_unavailable'
const hasPrintedToolProtocol = (value: string) =>
  /(?:^|\s)(?:to|recipient)\s*=\s*functions\.[a-z][a-z0-9_]{0,63}\b/i.test(value)
  || /<\/?tool_call\b/i.test(value)

/** Facts only the server knows: prepared-but-unsaved results and uncorrected
 * rejections. Bob decides what to do with them; nothing is forced. */
function unfinishedFacts(aiCatalog: AiCatalogSession, opts: { writer?: ProjectWriter; cadAssistant?: CadAssistant; planAssistant?: ReturnType<typeof createPlanAssistant> }, saved: (name: string) => boolean): string[] {
  const facts: string[] = []
  if (opts.planAssistant?.canSave && !saved('save_compiled_project_plan')) facts.push(aiCatalog.text('bob.fact.plan-ready'))
  if (opts.cadAssistant?.candidate && !saved('save_cad_design')) facts.push(aiCatalog.text('bob.fact.drawing-ready'))
  if (opts.cadAssistant?.partial && !opts.cadAssistant.candidate && saved('generate_project_image') && !saved('save_cad_design')) facts.push(aiCatalog.text('bob.fact.cad-incomplete'))
  const rejected = opts.writer?.needsRepair ? opts.writer.unresolvedTools : []
  if (rejected.length) facts.push(aiCatalog.text('bob.fact.rejected', { tools: [...new Set(rejected)].join(', ') }))
  return facts
}

export async function runProjectAnswer(opts: {
  aiCatalog: AiCatalogSession;
  projectId: string; userId: string; message: string;
  lookup: ReturnType<typeof createProjectLookup>; callModel: ModelCall;
  hasAccess: () => Promise<boolean>; previousResponseId?: string;
  writer?: ProjectWriter; context?: WorkingContext; deadline?: number; modelTimeoutMs?: number;
  observe?: (value: TurnObservation) => void; onProgress?: (value: TurnProgress) => void;
  onTool?: (value: { name: string; status: string; step: number; index: number; ms: number }) => void;
  projectContext?: ProjectContext; readToolPolicy?: ToolPolicyReader;
  /** Internal comparison only; never read from the owner's request body. */
  toolInstructions?: ToolInstructions;
  currentView?: CurrentView; validateCurrentView?: () => Promise<boolean>; getCurrentViewEvidence?: () => CurrentView;
  knowledgeReader?: KnowledgeReader; operationalReader?: OperationalReader; recordReader?: RecordDetailReader; imageTools?: ProjectImageTools; cadAssistant?: CadAssistant; catalogReader?: MaterialCatalogReader; constructionTools?: ConstructionTools; planAssistant?: ReturnType<typeof createPlanAssistant>;
}): Promise<ProjectAnswer> {
  if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
  const briefing = await opts.lookup.search({ dataset: 'project', query: null, status: null, area_id: null, record_id: null })
  if (briefing.status !== 'ok') return { ok: false, error: briefing.status === 'denied' ? 'project_denied' : 'project_unavailable' }
  const catalog = opts.projectContext ? await opts.projectContext.catalog() : null
  const toolbox = createBobToolSession({ ...opts, readPolicy: opts.readToolPolicy ?? seedToolPolicy })
  let previousResponseId = opts.context ? undefined : opts.previousResponseId
  let messages: OpenAIServiceOptions['messages'] = [
    { role: 'user', content: buildTurnFrame(opts.aiCatalog, opts.projectId, briefing, opts.context, opts.currentView) + (catalog ? opts.aiCatalog.text('bob.frame.catalog') + JSON.stringify(catalog) : '') },
    ...(opts.context ? opts.context.recent.map(m => ({ role: m.role, content: m.text })) : [{ role: 'user' as const, content: opts.message }]),
  ]
  const drawingRequests=await opts.cadAssistant?.pending()
  if(Array.isArray(drawingRequests)&&drawingRequests.length)messages.push({role:'user',content:opts.aiCatalog.text('bob.frame.outstanding')+'\n'+JSON.stringify(drawingRequests)})
  const steps = BOB_TURN_LIMITS.steps, deadline = opts.deadline ?? Date.now() + 220_000
  const observation: TurnObservation = { steps: 0, tool_calls: 0, deferred_calls: 0, completion_checks: 0, nudges: 0, end: 'failed' }
  const observe = (end: TurnObservation['end']) => { observation.end = end; opts.observe?.({ ...observation }) }
  const progress = (value: Omit<TurnProgress, 'saved'>) => { try { opts.onProgress?.({ ...value, saved: opts.writer?.receipts.length ?? 0 }) } catch { /* progress is advisory */ } }
  const saved = (name: string) => toolbox.events.some(e => e.operation === 'execute' && e.name === name && e.status === 'saved')
  let completionChecked = false, protocolNudges = 0, emptyNudges = 0, closedNoteSent = false
  for (let step = 0; step < steps; step++) {
    if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
    if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
    if (Date.now() >= deadline) { observe('failed'); return { ok: false, error: 'turn_timeout' } }
    if (opts.projectContext && !await opts.projectContext.validate()) return { ok: false, error: 'context_unavailable' }
    let tools: NonNullable<OpenAIServiceOptions['tools']> = []
    const lastStep = step >= steps - 1, lateInTurn = Date.now() + 40000 >= deadline
    try {
      if (!lastStep && !lateInTurn) tools = await toolbox.prepare()
      else toolbox.closeSurface()
    } catch (error) { rethrowContinuation(error); return { ok: false, error: toolFailureCode(error) } }
    const closedByLimit = lastStep || lateInTurn
    const shelf = closedByLimit ? [] : toolbox.toolbox
    if (closedByLimit && step > 0 && !closedNoteSent) {
      closedNoteSent = true
      messages = [...messages, { role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.closed', { budget: lastStep ? 'step' : 'time' }) }]
    }
    observation.steps = step + 1
    progress({ stage: step === 0 ? 'thinking' : tools.length ? 'thinking' : 'finishing', step: step + 1 })
    console.log('[Bob context]', JSON.stringify({ step, tools: tools.length, system_chars: buildBobSystemMessage(opts.aiCatalog, tools, shelf).length, tool_schema_bytes: new TextEncoder().encode(JSON.stringify(tools)).length, message_bytes: new TextEncoder().encode(JSON.stringify(messages)).length, remaining_ms: Math.max(0, deadline - Date.now()) }))
    // A terminal design failure has a known cause. Deliver it without another
    // paid model call that can retry the same job or invent a renderer outage.
    const cadFailure=opts.cadAssistant?.failure
    if(cadFailure?.reason==='turn_budget_exhausted')return {ok:false,error:'turn_budget_exhausted'}
    const response: OpenAIServiceResponse<string> = typeof cadFailure?.user_message==='string'
      ? {success:true,data:cadFailure.user_message,model:'server',usage:{input_tokens:0,output_tokens:0,total_tokens:0}}
      : await opts.callModel({
      app: 'bob', coworkerId: 'bob', functionName: 'ask-bob', aiFunction: 'ask-bob', module: 'global',
      userId: opts.userId, systemMessage: buildBobSystemMessage(opts.aiCatalog, tools, shelf), catalogRoleKey: 'ask-bob', catalogSchemaParameters: { server_quote: !!opts.message.trim(), include_manual: opts.toolInstructions !== 'on_demand', categories: (tools.find(t => t.function.name === 'list_project_category')?.function.parameters.properties as Record<string, any> | undefined)?.category?.enum ?? [] },
      messages: [...messages, ...(opts.projectContext?.carrier() ?? [])], previousResponseId, tools: tools.length ? tools : undefined,
      maxOutputTokens: opts.writer ? 8000 : 900, timeoutMs: Math.min(opts.modelTimeoutMs ?? 45_000, deadline - Date.now()),
    })
    if (!response.success) { observe('failed'); return { ok: false, error: response.error === 'turn_budget_exhausted' ? response.error : 'ai_unavailable' } }
    if(!cadFailure?.user_message)opts.projectContext?.confirmDelivery()
    if (opts.projectContext && !await opts.projectContext.validate()) return { ok: false, error: 'context_unavailable' }
    if (response.toolCalls?.length) {
      if (!tools.length || !response.responseId) { observe('failed'); return { ok: false, error: 'unsupported_tool_response' } }
      // Access can end while the model is thinking; nothing runs after that.
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
      previousResponseId = response.responseId; messages = []
      for (const [index, call] of response.toolCalls.entries()) {
        if (Date.now() >= deadline) { observe('failed'); return { ok: false, error: 'turn_timeout' } }
        if (index >= BOB_TURN_LIMITS.callsPerStep) {
          observation.deferred_calls++
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: 'deferred', message: opts.aiCatalog.text('bob.note.deferred', { calls: BOB_TURN_LIMITS.callsPerStep }) }) })
          continue
        }
        // Each awaited call opens a new concurrency window, including within
        // one model batch. Only verified own receipts may advance the focus.
        if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
        if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
        let args: unknown = null
        try { args = JSON.parse(call.function.arguments) } catch { /* the handler reports invalid input */ }
        progress({ stage: 'tool', tool: call.function.name, step: step + 1 })
        let result: any
        const began = Date.now()
        try { result = await toolbox.execute(call.function.name, args) }
        catch (error) { rethrowContinuation(error); observe('failed'); return { ok: false, error: toolFailureCode(error) } }
        observation.tool_calls++
        try { opts.onTool?.({ name: call.function.name, status: String(result?.status ?? 'returned'), step: step + 1, index, ms: Date.now() - began }) } catch { /* diagnostics only */ }
        if (result?.status === 'denied') {
          // A refused record is not a lost project: only real loss of access ends the turn.
          if (result?.reason !== 'access' || !await opts.hasAccess()) { observe('failed'); return { ok: false, error: 'project_denied' } }
          result = { status: 'not_found', saved: false, message: opts.aiCatalog.text('bob.fact.record-missing') }
        }
        console.log('[Bob tool]', /^[a-z][a-z0-9_]{0,63}$/.test(call.function.name) ? call.function.name : 'invalid_name', result?.status ?? 'returned')
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ...result, execution_budget: { model_steps: steps - step - 1, project_reads: opts.lookup.remaining, writes: opts.writer?.remaining ?? 0, corrections: opts.writer?.correctionsRemaining ?? 0, cad_consultations: opts.cadAssistant?.remaining ?? 0, catalog_reads: opts.catalogReader?.remaining ?? 0, image_operations: opts.projectContext?.remaining ?? 0, history_reads: opts.context?.history.remaining ?? 0 } }) })
      }
      continue
    }
    const answerText = typeof response.data === 'string' ? response.data.trim() : ''
    const canContinue = !!response.responseId && tools.length > 0 && step < steps - 2 && Date.now() + 40000 < deadline
    // Provider syntax printed as prose never reaches the owner, and is never executed.
    if (answerText && hasPrintedToolProtocol(answerText)) {
      if (protocolNudges < 2 && canContinue) {
        protocolNudges++; observation.nudges++; previousResponseId = response.responseId
        messages = [{ role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.native-call') }]
        continue
      }
      observe('failed'); return { ok: false, error: 'unsupported_tool_response' }
    }
    if (!answerText) {
      if (emptyNudges < 1 && response.responseId && step < steps - 1 && Date.now() + 20000 < deadline) {
        emptyNudges++; observation.nudges++; previousResponseId = response.responseId
        messages = [{ role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.empty') }]
        continue
      }
      observe('failed'); return { ok: false, error: 'empty_response' }
    }
    // One factual look at results the server knows are prepared but unsaved. Bob
    // decides; his words are never replaced by a server notice.
    const facts = unfinishedFacts(opts.aiCatalog, opts, saved)
    if (facts.length && !completionChecked && opts.writer && opts.writer.remaining > 0 && canContinue) {
      completionChecked = true; observation.completion_checks++; previousResponseId = response.responseId
      messages = [{ role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.finish', { facts: facts.join(' ') }) }]
      continue
    }
    if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
    progress({ stage: 'finishing', step: step + 1 })
    if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
    observe(closedByLimit && step > 0 ? (lastStep ? 'step_budget' : 'time_budget') : /\?\s*$/.test(answerText) ? 'asked' : 'answered')
    return { ok: true, answer: answerText, projectId: opts.projectId, providerResponseId: response.responseId,
      evidence: { kind: 'ai_assessment', ...(opts.currentView ? { currentView: opts.getCurrentViewEvidence?.() ?? opts.currentView } : {}), references: opts.knowledgeReader?.references ?? [], sources: [...opts.lookup.sources, ...(opts.planAssistant?.sources ?? []), ...(opts.cadAssistant?.sources ?? [])].filter((s,i,a)=>a.findIndex(x=>x.dataset===s.dataset&&x.recordId===s.recordId)===i),
        partial: facts.length > 0 || !!opts.operationalReader?.partial || opts.lookup.partial || toolbox.partial || !!opts.projectContext?.partial || !!opts.catalogReader?.partial || !!opts.planAssistant?.partial || !!opts.cadAssistant?.partial || !!opts.writer?.uncertain || !!opts.writer?.hasUnresolvedWrites,
        ...(opts.writer?.receipts.length ? { writes: compactReceipts(opts.writer.receipts) } : {}) },
    }
  }
  observe('failed')
  return { ok: false, error: 'step_budget_exhausted' }
}
