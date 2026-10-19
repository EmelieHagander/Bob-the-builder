import type { PlanLinks } from './project-plan-links.ts'
import type { WorkRecords } from './project-work-records.ts'
import type { SolutionActions } from './project-solution-actions.ts'
import type { ProjectEdits } from './project-edits.ts'
import type { ConstructionTools } from './construction-draft.ts'
import type { KnowledgeReader } from './building-knowledge.ts'
import type { OperationalReader } from './project-operations.ts'
import { fingerprint, rethrowContinuation } from './bob-job-journal.ts'
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
import { prepareProjectOrientation, type ProjectOrientation } from './bob-project-orientation.ts'
import { ORIENTATION_DIRECTORY_TOOL, type OrientationDirectoryReader } from './bob-orientation-directory.ts'
import { countContextTokens } from './bob-token-budget.ts'
import type { ContextSurface } from './bob-context-continuation.ts'
import type { CurrentView } from '../../../src/domain/bobScreen.ts'
import type { AnswerEvidence } from '../../../src/data/provenance.ts'
import { BOB_WRITE_LIMIT } from '../../../src/data/bobEvidence.ts'
import { createBobToolSession, sortToolbox } from './project-tools/bob-tools.ts'
import type { ProjectCalculator } from './project-calculator.ts'
import { type ToolPolicyReader, type ToolboxEntry, type ToolInstructions, checkedToolSnapshot } from './project-tools/session.ts'
import catalogSeed from './project-tools/catalog-seed.json' with { type: 'json' }

/** Instruction content comes from the pinned database manifest; shelf state is data. */
export function buildBobSystemMessage(aiCatalog: AiCatalogSession, tools: OpenAIServiceOptions['tools'] = [], toolbox: ToolboxEntry[] = []): string {
  return [aiCatalog.role('ask-bob').systemMessage, buildBobHands(aiCatalog, tools, sortToolbox(toolbox, aiCatalog.definition('bob.tools', 'tool_contract').definition.shelves as { label: string; tools: string[] }[]))].join('\n\n')
}

/** Legacy pinned contracts retain their original per-turn work ceilings. */
export const BOB_TURN_LIMITS = { steps: 24, callsPerStep: 8, writes: BOB_WRITE_LIMIT } as const

function buildTurnFrame(aiCatalog: AiCatalogSession, projectId: string, briefing: unknown, context?: WorkingContext, currentView?: CurrentView, unlimitedWork = false): string {
  const text = (key: string) => aiCatalog.text('bob.frame.' + key)
  return [text('current'), aiCatalog.text('bob.frame.binding', { project_id: projectId }),
    text('briefing-trust'), text('prior-conversation'),
    ...(currentView ? [text('current-view'), JSON.stringify(currentView)] : []),
    ...(context ? [text('history'), JSON.stringify({ throughSeq: context.throughSeq, summary: context.summary, index: context.historyIndex ?? [] }),
      text('recent'), JSON.stringify({ messageStates: context.recent.map(m => ({ seq: m.seq, state: m.state })) })] : []),
    ...(context?.recentWrites?.length ? [text('saved'), JSON.stringify({ recentWrites: context.recentWrites })] : []),
    ...(context?.recentSources?.length ? [text('sources'), JSON.stringify({ recentSources: context.recentSources })] : []),
    ...(!unlimitedWork ? [aiCatalog.text('bob.frame.limits', { steps: BOB_TURN_LIMITS.steps, writes: BOB_TURN_LIMITS.writes })] : []),
    text('briefing-label'), JSON.stringify(briefing),
  ].join('\n\n')
}

/** Derived memory and original conversation stay separate from current saved
 * project facts. These are labelled data messages, never role instructions. */
function buildManagedMessages(aiCatalog: AiCatalogSession, opts: {
  projectId: string; message: string; context?: WorkingContext; currentView?: CurrentView;
  orientation: ProjectOrientation; catalog: unknown; drawingRequests: unknown;
}): NonNullable<OpenAIServiceOptions['messages']> {
  const text = (key: string) => aiCatalog.text('bob.frame.' + key)
  const { footer: _footer, ...orientation } = opts.orientation
  const context = opts.context
  return [
    ...(context ? [{ role: 'user' as const, content: [text('prior-conversation'), text('history'),
      JSON.stringify({ throughSeq: context.throughSeq, summary: context.summary, index: context.historyIndex ?? [] }),
      text('recent'), JSON.stringify({ messageStates: context.recent.map(m => ({ seq: m.seq, state: m.state })) }),
    ].join('\n\n') }] : []),
    ...(context ? context.recent.map(m => ({ role: m.role, content: m.text })) : [{ role: 'user' as const, content: opts.message }]),
    { role: 'user', content: [text('current'), aiCatalog.text('bob.frame.binding', { project_id: opts.projectId }), text('briefing-trust'),
      ...(opts.currentView ? [text('current-view'), JSON.stringify(opts.currentView)] : []),
      ...(context?.recentWrites?.length ? [text('saved'), JSON.stringify({ recentWrites: context.recentWrites })] : []),
      ...(context?.recentSources?.length ? [text('sources'), JSON.stringify({ recentSources: context.recentSources })] : []),
      text('briefing-label'), JSON.stringify(orientation),
      ...(opts.catalog ? [text('catalog'), JSON.stringify(opts.catalog)] : []),
    ].join('\n\n') },
    ...(Array.isArray(opts.drawingRequests) && opts.drawingRequests.length
      ? [{ role: 'user' as const, content: text('outstanding') + '\n' + JSON.stringify(opts.drawingRequests) }] : []),
  ]
}
export type ModelCall = (options: OpenAIServiceOptions) => Promise<OpenAIServiceResponse<string>>
export type ProjectAnswer =
  | { ok: true; answer: string; projectId: string; evidence: AnswerEvidence; providerResponseId?: string }
  | { ok: false; error: string }
export type TurnEnd = 'answered' | 'asked' | 'step_budget' | 'time_budget' | 'refused' | 'commentary_limit'
export interface TurnObservation { steps: number; tool_calls: number; deferred_calls: number; completion_checks: number; nudges: number; end: TurnEnd | 'failed'; output_phase?: OpenAIServiceResponse['outputPhase'] }
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
  writer?: ProjectWriter; context?: WorkingContext; deadline?: number; modelTimeoutMs?: number; unlimitedWork?: boolean;
  observe?: (value: TurnObservation) => void; onProgress?: (value: TurnProgress) => void;
  onTool?: (value: { name: string; status: string; step: number; index: number; ms: number; validation_code?: string }) => void;
  projectContext?: ProjectContext; readToolPolicy?: ToolPolicyReader;
  /** Internal comparison only; never read from the owner's request body. */
  toolInstructions?: ToolInstructions;
  /** Main-role compaction epoch; loaded manuals expire on the next prepare. */
  contextEpoch?: () => number;
  /** Refresh the active tool fence atomically before a fresh provider chain. */
  registerContextSurface?: (refresh: () => Promise<ContextSurface>) => void;
  calculator?: ProjectCalculator;
  currentView?: CurrentView; validateCurrentView?: () => Promise<boolean>; getCurrentViewEvidence?: () => CurrentView;
  knowledgeReader?: KnowledgeReader; operationalReader?: OperationalReader; recordReader?: RecordDetailReader; imageTools?: ProjectImageTools; cadAssistant?: CadAssistant; catalogReader?: MaterialCatalogReader; constructionTools?: ConstructionTools; projectEdits?: ProjectEdits; solutionActions?: SolutionActions; workRecords?: WorkRecords; planLinks?: PlanLinks; planAssistant?: ReturnType<typeof createPlanAssistant>;
}): Promise<ProjectAnswer> {
  if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
  const briefing = await opts.lookup.search({ dataset: 'project', query: null, status: null, area_id: null, record_id: null })
  if (briefing.status !== 'ok') return { ok: false, error: briefing.status === 'denied' ? 'project_denied' : 'project_unavailable' }
  const contract = opts.aiCatalog.definition('agent-contract.ask-bob', 'agent_contract').metadata
  const contextStrategy = contract.context_strategy_version === 1
  const boundedOrientation = contextStrategy && contract.orientation_directory_version === 1
  if (boundedOrientation && !opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.read_project_orientation')) throw new Error('tool_catalog_unavailable')
  let orientationReader: OrientationDirectoryReader | undefined
  if (contextStrategy && countContextTokens(opts.aiCatalog.role('ask-bob').systemMessage) > 700) throw new Error('context_input_too_large')
  const toolInstructions = opts.toolInstructions ?? (contextStrategy ? 'lazy' : undefined)
  const catalog = opts.projectContext ? await opts.projectContext.catalog() : null
  const toolbox = createBobToolSession({ ...opts, ...(contextStrategy ? { toolInstructions } : {}),
    ...(boundedOrientation ? { orientationReader: { tools: [ORIENTATION_DIRECTORY_TOOL], execute: (raw: unknown) => {
      if (!orientationReader) throw new Error('context_unavailable')
      return orientationReader.execute(raw)
    } } } : {}), readPolicy: opts.readToolPolicy ?? (async () => {
    const policy = await seedToolPolicy()
    // Offline/injected callers use the pinned catalog's advertised versions.
    // Production always supplies the live caller-authorized policy reader.
    const definitions = opts.aiCatalog.manifest().definitions
    return { ...policy, tools: policy.tools.map(row => {
      const definition = definitions.find(d => d.prompt_key === 'tools.' + row.name)
      const version = (definition?.definition.envelope as { schema_version?: number } | undefined)?.schema_version
      return version ? { ...row, schema_version: version } : row
    }) }
  }) })
  // The manifest is pinned before any journal operation. Do not add even an
  // undefined option or change the call sequence of an older running turn.
  const unlimitedWork = opts.unlimitedWork === true && contract.work_allowance_version === 1
  const completionV2 = contract.work_completion_version === 2
  const completionAware = contract.work_completion_version === 1 || completionV2
  const writeTools = new Set(completionAware ? opts.aiCatalog.manifest().definitions.filter(row => row.definition_kind === 'tool_contract'
    && Object.hasOwn((row.definition.parameters as any)?.properties ?? {}, 'request_quote')).map(row => row.definition.name as string) : [])
  const workResults: { tool: string; status: string; message?: string; refresh_status?: string; validation?: unknown }[] = []
  let previousResponseId = opts.context || contextStrategy ? undefined : opts.previousResponseId
  const drawingRequests=await opts.cadAssistant?.pending()
  const steps = BOB_TURN_LIMITS.steps, deadline = opts.deadline ?? Date.now() + 220_000
  const orientation = contextStrategy ? await prepareProjectOrientation({ ...opts, briefing, deadline,
    ...(boundedOrientation ? { directory: { maxTokens: Number(contract.orientation_max_tokens), pageMaxTokens: Number(contract.orientation_page_max_tokens),
      ready: (reader: OrientationDirectoryReader) => { orientationReader = reader } } } : {}),
  }) : undefined
  const initialFooter = orientation ? { role: 'user' as const,
    content: opts.aiCatalog.text('bob.note.prefix') + JSON.stringify({ orientation: orientation.footer }) } : undefined
  // Legacy pins retain their original message order. New context explicitly
  // labels pending work as data and ends with source-bound request orientation.
  let messages: OpenAIServiceOptions['messages'] = orientation ? buildManagedMessages(opts.aiCatalog, { ...opts, orientation, catalog, drawingRequests }) : [
    { role: 'user', content: buildTurnFrame(opts.aiCatalog, opts.projectId, briefing, opts.context, opts.currentView, unlimitedWork) + (catalog ? opts.aiCatalog.text('bob.frame.catalog') + JSON.stringify(catalog) : '') },
    ...(Array.isArray(drawingRequests)&&drawingRequests.length?[{role:'user' as const,content:opts.aiCatalog.text('bob.frame.outstanding')+'\n'+JSON.stringify(drawingRequests)}]:[]),
    ...(opts.context ? opts.context.recent.map(m => ({ role: m.role, content: m.text })) : [{ role: 'user' as const, content: opts.message }]),
  ]
  let preparedEpoch = contextStrategy ? opts.contextEpoch?.() : undefined
  const observation: TurnObservation = { steps: 0, tool_calls: 0, deferred_calls: 0, completion_checks: 0, nudges: 0, end: 'failed' }
  const observe = (end: TurnObservation['end']) => { observation.end = end; opts.observe?.({ ...observation }) }
  const progress = (value: Omit<TurnProgress, 'saved'>) => { try { opts.onProgress?.({ ...value, saved: opts.writer?.receipts.length ?? 0 }) } catch { /* progress is advisory */ } }
  const saved = (name: string) => toolbox.events.some(e => e.operation === 'execute' && e.name === name && e.status === 'saved')
  let completionChecked = false, protocolNudges = 0, emptyNudges = 0, closedNoteSent = false, commentaryStreak = 0
  let rejectionSignature: string | undefined, rejectionStreak = 0
  for (let step = 0; unlimitedWork || step < steps; step++) {
    if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
    if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
    if (Date.now() >= deadline) { observe('failed'); return { ok: false, error: 'turn_timeout' } }
    if (opts.projectContext && !await opts.projectContext.validate()) return { ok: false, error: 'context_unavailable' }
    let tools: NonNullable<OpenAIServiceOptions['tools']> = []
    const lastStep = !unlimitedWork && step >= steps - 1, lateInTurn = !unlimitedWork && Date.now() + 40000 >= deadline
    try {
      if (contextStrategy && opts.contextEpoch && !opts.registerContextSurface) {
        const epoch = opts.contextEpoch()
        if (epoch !== preparedEpoch) { toolbox.resetInstructions(); preparedEpoch = epoch }
      }
      if (!lastStep && !lateInTurn && commentaryStreak < 2) tools = await toolbox.prepare()
      else toolbox.closeSurface()
    } catch (error) { rethrowContinuation(error); return { ok: false, error: toolFailureCode(error) } }
    const closedByLimit = lastStep || lateInTurn
    const closedByCommentary = completionAware && commentaryStreak >= 2
    let shelf = closedByLimit || closedByCommentary ? [] : toolbox.toolbox
    const schemaParameters = () => ({ server_quote: !!opts.message.trim(), include_manual: toolInstructions !== 'on_demand' && toolInstructions !== 'lazy',
      ...(toolInstructions === 'lazy' ? { card: true } : {}), categories: (tools.find(t => t.function.name === 'list_project_category')?.function.parameters.properties as Record<string, any> | undefined)?.category?.enum ?? [] })
    if (contextStrategy && opts.registerContextSurface) opts.registerContextSurface(async () => {
      if (!await opts.hasAccess()) throw new Error('project_denied')
      if (opts.validateCurrentView && !await opts.validateCurrentView()) throw new Error('context_unavailable')
      if (opts.projectContext && !await opts.projectContext.validate()) throw new Error('context_unavailable')
      toolbox.resetInstructions()
      if (!closedByLimit && !closedByCommentary) tools = await toolbox.prepare()
      else { toolbox.closeSurface(); tools = [] }
      shelf = closedByLimit || closedByCommentary ? [] : toolbox.toolbox
      // The returned provider request and its eventual handlers share this
      // refreshed fence. A new describe call remains loaded for the next step.
      return { systemMessage: buildBobSystemMessage(opts.aiCatalog, tools, shelf), tools: tools.length ? tools : undefined,
        catalogSchemaParameters: schemaParameters(), catalogToolParameters: undefined }
    })
    if (closedByLimit && step > 0 && !closedNoteSent) {
      closedNoteSent = true
      messages = [...messages, { role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.closed', { budget: lastStep ? 'step' : 'time' }) }]
    }
    observation.steps = step + 1
    progress({ stage: step === 0 ? 'thinking' : tools.length ? 'thinking' : 'finishing', step: step + 1 })
    // Built once per step: replay rebuilds it for every recorded step too.
    const systemMessage = buildBobSystemMessage(opts.aiCatalog, tools, shelf)
    console.log('[Bob context]', JSON.stringify({ step, tools: tools.length, system_chars: systemMessage.length, tool_schema_bytes: new TextEncoder().encode(JSON.stringify(tools)).length, message_bytes: new TextEncoder().encode(JSON.stringify(messages)).length, remaining_ms: Math.max(0, deadline - Date.now()) }))
    // A terminal design failure has a known cause. Deliver it without another
    // paid model call that can retry the same job or invent a renderer outage.
    const cadFailure=opts.cadAssistant?.failure
    if(cadFailure?.reason==='turn_budget_exhausted'&&typeof cadFailure.user_message!=='string')return {ok:false,error:'turn_budget_exhausted'}
    const response: OpenAIServiceResponse<string> = typeof cadFailure?.user_message==='string'
      ? {success:true,data:cadFailure.user_message,model:'server',usage:{input_tokens:0,output_tokens:0,total_tokens:0}}
      : await opts.callModel({
      app: 'bob', coworkerId: 'bob', functionName: 'ask-bob', aiFunction: 'ask-bob', module: 'global',
      userId: opts.userId, systemMessage, catalogRoleKey: 'ask-bob', catalogSchemaParameters: schemaParameters(),
      messages: [...messages, ...(opts.projectContext?.carrier() ?? []), ...(step === 0 && initialFooter ? [initialFooter] : [])], previousResponseId, tools: tools.length ? tools : undefined,
      ...(completionAware ? { responsePhaseMode: 'aware' as const } : {}),
      maxOutputTokens: opts.writer ? 8000 : 900, timeoutMs: Math.min(opts.modelTimeoutMs ?? 45_000, deadline - Date.now()),
    })
    if (completionAware && response.outputPhase) observation.output_phase = response.outputPhase
    if (!response.success) { observe('failed'); return { ok: false, error: response.error === 'turn_budget_exhausted' ? response.error : 'ai_unavailable' } }
    if(!cadFailure?.user_message)opts.projectContext?.confirmDelivery()
    if (opts.projectContext && !await opts.projectContext.validate()) return { ok: false, error: 'context_unavailable' }
    if (response.toolCalls?.length) {
      commentaryStreak = 0
      if (!tools.length || !response.responseId) { observe('failed'); return { ok: false, error: 'unsupported_tool_response' } }
      // Access can end while the model is thinking; nothing runs after that.
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
      previousResponseId = response.responseId; messages = []
      for (const [index, call] of response.toolCalls.entries()) {
        if (Date.now() >= deadline) { observe('failed'); return { ok: false, error: 'turn_timeout' } }
        if (!unlimitedWork && index >= BOB_TURN_LIMITS.callsPerStep) {
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
        try { opts.onTool?.({ name: call.function.name, status: String(result?.status ?? 'returned'), step: step + 1, index, ms: Date.now() - began,
          ...(completionAware && typeof result?.validation?.code === 'string' ? { validation_code: result.validation.code } : {}) }) } catch { /* diagnostics only */ }
        if (result?.status === 'denied') {
          // A refused record is not a lost project: only real loss of access ends the turn.
          if (result?.reason !== 'access' || !await opts.hasAccess()) { observe('failed'); return { ok: false, error: 'project_denied' } }
          result = { status: 'not_found', saved: false, message: opts.aiCatalog.text('bob.fact.record-missing') }
        }
        console.log('[Bob tool]', /^[a-z][a-z0-9_]{0,63}$/.test(call.function.name) ? call.function.name : 'invalid_name', result?.status ?? 'returned')
        if (completionAware && writeTools.has(call.function.name)) workResults.push({ tool: call.function.name, status: String(result?.status ?? 'returned'),
          ...(typeof result?.message === 'string' ? { message: result.message } : {}),
          ...(typeof result?.refresh_status === 'string' ? { refresh_status: result.refresh_status } : {}),
          ...(result?.validation ? { validation: result.validation } : {}) })
        if (unlimitedWork && (result?.status === 'invalid' || result?.status === 'conflict')) {
          // Identical rejected work is stalled, even when its repeated calls
          // keep producing journal entries. Changed inputs or other tool work
          // reset the streak; this is not a total correction allowance.
          const signature = await fingerprint({ tool: call.function.name, arguments: args ?? call.function.arguments, result })
          rejectionStreak = signature === rejectionSignature ? rejectionStreak + 1 : 1
          rejectionSignature = signature
          if (rejectionStreak >= 3) { observe('failed'); return { ok: false, error: 'tool_no_progress' } }
        } else { rejectionSignature = undefined; rejectionStreak = 0 }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ...result, ...(!unlimitedWork ? { execution_budget: { model_steps: steps - step - 1, project_reads: opts.lookup.remaining, writes: opts.writer?.remaining ?? 0, corrections: opts.writer?.correctionsRemaining ?? 0, cad_consultations: opts.cadAssistant?.remaining ?? 0, catalog_reads: opts.catalogReader?.remaining ?? 0, image_operations: opts.projectContext?.remaining ?? 0, history_reads: opts.context?.history.remaining ?? 0 } } : {}) }) })
      }
      continue
    }
    const answerText = typeof response.data === 'string' ? response.data.trim() : ''
    const canContinue = !!response.responseId && tools.length > 0 && (unlimitedWork ? Date.now() < deadline : step < steps - 2 && Date.now() + 40000 < deadline)
    if (completionAware && response.outputPhase === 'commentary') {
      // Repeated progress without tool activity is a no-progress condition,
      // not a work quota. A tool result resets the streak.
      if (commentaryStreak < 2 && response.responseId && (unlimitedWork ? Date.now() < deadline : step < steps - 1 && Date.now() + 20000 < deadline)) {
        commentaryStreak++; observation.nudges++; previousResponseId = response.responseId
        messages = [{ role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text(commentaryStreak === 2 ? 'bob.note.commentary-limit' : 'bob.note.commentary') }]
        continue
      }
      observe('commentary_limit'); return { ok: false, error: 'commentary_limit' }
    }
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
      if (emptyNudges < 1 && response.responseId && (unlimitedWork ? Date.now() < deadline : step < steps - 1 && Date.now() + 20000 < deadline)) {
        emptyNudges++; observation.nudges++; previousResponseId = response.responseId
        messages = [{ role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.empty') }]
        continue
      }
      observe('failed'); return { ok: false, error: 'empty_response' }
    }
    // The v2 review also covers a read-only promise to perform delegated work.
    // Existing conversation context remains in the same Responses chain; the
    // latest instruction refines that mandate rather than replacing its memory.
    // Bob decides; his words are never replaced by a server notice.
    const facts = unfinishedFacts(opts.aiCatalog, opts, saved)
    const reviewWork = completionAware && (completionV2 || workResults.length > 0 || !!opts.writer?.executedReceipts.length)
    if ((facts.length || reviewWork) && !completionChecked && opts.writer && opts.writer.remaining > 0 && (!completionAware || !opts.writer.uncertain)
      && canContinue && (!completionAware || response.outputPhase !== 'refusal')) {
      completionChecked = true; observation.completion_checks++; previousResponseId = response.responseId
      messages = [{ role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + (completionAware
        ? opts.aiCatalog.text('bob.note.review-work', { request: opts.message, facts: facts.join(' '), results: JSON.stringify({
          // Recovery can already contain a later save from this same journal.
          // Only commits reached in replay belong to this model-call input.
          writes: compactReceipts(opts.writer.executedReceipts), attempts: workResults.slice(-32), earlier_attempts: Math.max(0, workResults.length - 32),
          current_records: (opts.workRecords?.currentRecords ?? []).map(({ resource, ref, scope, content }) => ({ resource, ref, scope,
            ...(content.status ? { status: content.status } : {}), ...(content.readiness ? { readiness: content.readiness } : {}) })),
          current_content_in_prior_tool_results: true,
          unresolved_tools: opts.writer.unresolvedTools, reads_partial: opts.lookup.partial || !!opts.workRecords?.partial,
        }) }) : opts.aiCatalog.text('bob.note.finish', { facts: facts.join(' ') })) }]
      continue
    }
    if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
    progress({ stage: 'finishing', step: step + 1 })
    if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
    observe(completionAware && response.outputPhase === 'refusal' ? 'refused' : closedByCommentary ? 'commentary_limit' : closedByLimit && step > 0 ? (lastStep ? 'step_budget' : 'time_budget') : /\?\s*$/.test(answerText) ? 'asked' : 'answered')
    return { ok: true, answer: answerText, projectId: opts.projectId, providerResponseId: response.responseId,
      evidence: { kind: 'ai_assessment', ...(opts.currentView ? { currentView: opts.getCurrentViewEvidence?.() ?? opts.currentView } : {}), references: opts.knowledgeReader?.references ?? [], sources: [...opts.lookup.sources, ...(opts.planAssistant?.sources ?? []), ...(opts.cadAssistant?.sources ?? [])].filter((s,i,a)=>a.findIndex(x=>x.dataset===s.dataset&&x.recordId===s.recordId)===i),
        partial: completionAware && response.outputPhase === 'refusal' || facts.length > 0 || !!orientation?.warnings.length || !!opts.projectEdits?.partial || !!opts.solutionActions?.partial || !!opts.workRecords?.partial || !!opts.planLinks?.partial || !!opts.operationalReader?.partial || opts.lookup.partial || toolbox.partial || !!opts.projectContext?.partial || !!opts.catalogReader?.partial || !!opts.planAssistant?.partial || !!opts.cadAssistant?.partial || !!opts.writer?.uncertain || !!opts.writer?.hasUnresolvedWrites,
        ...(opts.writer?.receipts.length ? { writes: compactReceipts(opts.writer.receipts) } : {}) },
    }
  }
  observe('failed')
  return { ok: false, error: 'step_budget_exhausted' }
}
