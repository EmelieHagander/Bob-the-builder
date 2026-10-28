import type { PlanLinks } from './project-plan-links.ts'
import type { BuildingScope } from './project-building-scope.ts'
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
import { buildBobHands, buildBobCompleteHands } from './bob-prompt.ts'
import type { AiCatalogSession } from './ai-catalog.ts'
import { compactReceipts, type ProjectWriter } from './project-write.ts'
import type { WorkingContext } from './bob-working-context.ts'
import { prepareProjectOrientation, type ProjectOrientation } from './bob-project-orientation.ts'
import { ORIENTATION_DIRECTORY_TOOL, type OrientationDirectoryReader } from './bob-orientation-directory.ts'
import { restoreOrientationDirectory } from './bob-orientation-directory.ts'
import { countContextTokens } from './bob-token-budget.ts'
import type { ContextSurface } from './bob-context-continuation.ts'
import type { CurrentView } from '../../../src/domain/bobScreen.ts'
import type { AnswerEvidence } from '../../../src/data/provenance.ts'
import { BOB_WRITE_LIMIT } from '../../../src/data/bobEvidence.ts'
import { BUILDING_SCOPE_PRELOAD, createBobToolSession, CORE_READ_PRELOAD, DRAWING_CONTINUATION_PRELOAD, sortToolbox } from './project-tools/bob-tools.ts'
import type { BuildingLinks } from './project-building-scope.ts'
import type { ProjectFacts } from './project-facts.ts'
import type { ProjectCalculator } from './project-calculator.ts'
import { type ToolPolicyReader, type ToolboxEntry, type ToolInstructions, checkedToolSnapshot } from './project-tools/session.ts'
import catalogSeed from './project-tools/catalog-seed.json' with { type: 'json' }

/** Instruction content comes from the pinned database manifest; shelf state is data. */
export function buildBobSystemMessage(aiCatalog: AiCatalogSession, tools: OpenAIServiceOptions['tools'] = [], toolbox: ToolboxEntry[] = [], completeRequest = false): string {
  return [aiCatalog.role('ask-bob').systemMessage, (completeRequest ? buildBobCompleteHands : buildBobHands)(aiCatalog, tools, sortToolbox(toolbox, aiCatalog.definition('bob.tools', 'tool_contract').definition.shelves as { label: string; tools: string[] }[]))].join('\n\n')
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
  orientation: ProjectOrientation; catalog: unknown; drawingRequests: unknown; projectFacts?: ProjectFacts;
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
      ...(opts.projectFacts ? [JSON.stringify({ project_facts: opts.projectFacts })] : []),
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
export interface TurnObservation { steps: number; tool_calls: number; deferred_calls: number; completion_checks: number; nudges: number; completion_gate?: 'done' | 'review'; end: TurnEnd | 'failed'; output_phase?: OpenAIServiceResponse['outputPhase'] }
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

/** Private, versioned execution state. This is data, never an authorization grant.
 * A committed boundary skips earlier model/tool handlers; an interrupted active
 * operation still uses the existing journal and SQL write ledger. */
export interface BobAnswerState {
  version: 1
  projectId: string
  step: number
  phase: 'ready' | 'model' | 'response' | 'tools'
  initial: { briefing: unknown; catalog: unknown; drawingRequests: unknown; orientation?: ProjectOrientation; directory?: unknown }
  messages: NonNullable<OpenAIServiceOptions['messages']>
  previousResponseId?: string
  preparedEpoch?: number
  observation: TurnObservation
  toolbox: ReturnType<ReturnType<typeof createBobToolSession>['exportState']>
  workResults: { tool: string; status: string; message?: string; refresh_status?: string; validation?: unknown }[]
  completionChecked: boolean; protocolNudges: number; emptyNudges: number; closedNoteSent: boolean; commentaryStreak: number
  rejectionSignature?: string; rejectionStreak: number
  /** Bob's answer sent back for the completion review; delivered if a spending stop ends the review. */
  reviewedAnswer?: string
  tools: NonNullable<OpenAIServiceOptions['tools']>
  closedByLimit: boolean; closedByCommentary: boolean
  request?: OpenAIServiceOptions
  response?: OpenAIServiceResponse<string>
  toolIndex: number
  result?: ProjectAnswer
}
export interface BobAnswerCheckpoint {
  state?: BobAnswerState
  save(state: BobAnswerState): Promise<void>
}
export type ProjectAnswerOptions = {
  aiCatalog: AiCatalogSession;
  projectId: string; userId: string; message: string;
  lookup: ReturnType<typeof createProjectLookup>; callModel: ModelCall;
  hasAccess: () => Promise<boolean>; previousResponseId?: string;
  writer?: ProjectWriter; context?: WorkingContext; deadline?: number; modelTimeoutMs?: number; unlimitedWork?: boolean;
  observe?: (value: TurnObservation) => void; onProgress?: (value: TurnProgress) => void;
  onTool?: (value: { name: string; status: string; step: number; index: number; ms: number; validation_code?: string }) => void;
  /** Names of the calls this model step will execute, before the first runs.
   * Called again with the same names when a checkpointed step resumes. */
  onToolBatch?: (names: string[]) => void;
  projectContext?: ProjectContext; readToolPolicy?: ToolPolicyReader;
  /** Internal comparison only; never read from the owner's request body. */
  toolInstructions?: ToolInstructions;
  /** Pinned per execution: a context rollover keeps loaded tools, with their
   * manuals in the offered schemas, instead of resetting them. */
  carryLoadedTools?: boolean;
  /** Pinned per execution: the core reading tools are loaded from the first step. */
  corePreload?: boolean;
  /** Pinned per execution: which buildings this project links, read once at turn start. */
  buildingLinks?: BuildingLinks;
  /** Pinned per execution (projectFactsVersion): orientation blocks are cut,
   * never summarized by a model, and saved project facts join the briefing. */
  pureFacts?: boolean; projectFacts?: ProjectFacts;
  /** Pinned for new durable main turns; never changes a running old job. */
  completeRequest?: boolean;
  resultReferences?: boolean;
  /** Main-role compaction epoch; loaded manuals expire on the next prepare. */
  contextEpoch?: () => number;
  /** Refresh the active tool fence atomically before a fresh provider chain. */
  registerContextSurface?: (refresh: () => Promise<ContextSurface>) => void;
  calculator?: ProjectCalculator;
  currentView?: CurrentView; validateCurrentView?: () => Promise<boolean>; getCurrentViewEvidence?: () => CurrentView;
  checkpoint?: BobAnswerCheckpoint;
  knowledgeReader?: KnowledgeReader; operationalReader?: OperationalReader; recordReader?: RecordDetailReader; imageTools?: ProjectImageTools; cadAssistant?: CadAssistant; catalogReader?: MaterialCatalogReader; constructionTools?: ConstructionTools; projectEdits?: ProjectEdits; solutionActions?: SolutionActions; workRecords?: WorkRecords; planLinks?: PlanLinks; buildingScope?: BuildingScope; planAssistant?: ReturnType<typeof createPlanAssistant>;
  sourceReader?: import('./source-reader.ts').SourceReader;
}
export async function runProjectAnswer(opts: ProjectAnswerOptions): Promise<ProjectAnswer> {
  const saved = opts.checkpoint?.state
  if (saved) {
    const counter = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0
    const invalid = saved.version !== 1 || saved.projectId !== opts.projectId || !counter(saved.step)
      || !['ready', 'model', 'response', 'tools'].includes(saved.phase)
      || ![saved.toolIndex, saved.protocolNudges, saved.emptyNudges, saved.commentaryStreak, saved.rejectionStreak].every(counter)
      || ![saved.completionChecked, saved.closedNoteSent, saved.closedByLimit, saved.closedByCommentary].every(v => typeof v === 'boolean')
      || saved.reviewedAnswer !== undefined && (typeof saved.reviewedAnswer !== 'string' || !saved.reviewedAnswer)
      || !saved.initial || !saved.toolbox || !saved.observation || !Array.isArray(saved.messages) || !Array.isArray(saved.tools) || !Array.isArray(saved.workResults)
      || (saved.phase !== 'ready' && (!saved.request || saved.request.app !== 'bob' || saved.request.aiFunction !== 'ask-bob' || saved.request.userId !== opts.userId))
      || (['response', 'tools'].includes(saved.phase) && !saved.response)
      || (saved.phase === 'tools' && (!saved.response?.responseId || !saved.response.toolCalls?.length || saved.toolIndex > saved.response.toolCalls.length))
      || (saved.phase === 'ready' && (saved.toolIndex !== 0 || saved.request !== undefined || saved.response !== undefined))
      || (saved.result?.ok === true && saved.result.projectId !== opts.projectId)
    if (invalid) throw new Error('turn_checkpoint_invalid')
  }
  if (saved?.result) return structuredClone(saved.result)
  let latest = saved
  const checkpoint = opts.checkpoint ? { state: saved, save: async (state: BobAnswerState) => {
    await opts.checkpoint!.save(state); latest = state
  } } : undefined
  const result = await runProjectAnswerFromState({ ...opts, checkpoint })
  // Settlement and transcript commit can themselves yield. Never regenerate a
  // completed answer while reconciling those final operations.
  if (checkpoint && latest) await checkpoint.save({ ...latest, result })
  return result
}
async function runProjectAnswerFromState(opts: ProjectAnswerOptions): Promise<ProjectAnswer> {
  const restored = opts.checkpoint?.state
  if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
  const briefing = restored ? restored.initial.briefing as Awaited<ReturnType<typeof opts.lookup.search>> : await opts.lookup.search({ dataset: 'project', query: null, status: null, area_id: null, record_id: null })
  if (briefing.status !== 'ok') return { ok: false, error: briefing.status === 'denied' ? 'project_denied' : 'project_unavailable' }
  const contract = opts.aiCatalog.definition('agent-contract.ask-bob', 'agent_contract').metadata
  const contextStrategy = contract.context_strategy_version === 1
  const boundedOrientation = contextStrategy && contract.orientation_directory_version === 1
  if (boundedOrientation && !opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'tools.read_project_orientation')) throw new Error('tool_catalog_unavailable')
  let orientationReader: OrientationDirectoryReader | undefined
  if (contextStrategy && countContextTokens(opts.aiCatalog.role('ask-bob').systemMessage) > 700) throw new Error('context_input_too_large')
  const toolInstructions = opts.toolInstructions ?? (contextStrategy ? 'lazy' : undefined)
  const catalog = restored ? restored.initial.catalog : opts.projectContext ? await opts.projectContext.catalog() : null
  // Set once the pending drawing requests are known below; prepare() reads it at the first model step.
  let preloadTools: string[] = [...(opts.corePreload ? CORE_READ_PRELOAD : []), ...(opts.buildingLinks && !opts.buildingLinks.whole ? BUILDING_SCOPE_PRELOAD : [])]
  const toolbox = createBobToolSession({ ...opts, ...(contextStrategy ? { toolInstructions } : {}), preloadTools: () => preloadTools,
    ...(boundedOrientation ? { orientationReader: { tools: [ORIENTATION_DIRECTORY_TOOL], execute: (raw: unknown) => {
      if (!orientationReader) throw new Error('context_unavailable')
      return orientationReader.execute(raw)
    }, exportState: () => {
      if (!orientationReader) throw new Error('context_unavailable')
      return orientationReader.exportState()
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
  if (restored) toolbox.restoreState(restored.toolbox)
  // The manifest is pinned before any journal operation. Do not add even an
  // undefined option or change the call sequence of an older running turn.
  const unlimitedWork = opts.unlimitedWork === true && contract.work_allowance_version === 1
  const completionV2 = contract.work_completion_version === 2
  const completionAware = contract.work_completion_version === 1 || completionV2
  const writeTools = new Set(completionAware ? opts.aiCatalog.manifest().definitions.filter(row => row.definition_kind === 'tool_contract'
    && Object.hasOwn((row.definition.parameters as any)?.properties ?? {}, 'request_quote')).map(row => row.definition.name as string) : [])
  const workResults: { tool: string; status: string; message?: string; refresh_status?: string; validation?: unknown }[] = structuredClone(restored?.workResults ?? [])
  // A read-only answer with nothing unfinished would otherwise be regenerated
  // by a full review. Manifests with the completion gate ask a small read-only
  // role first; no gate, a failed call or an invalid result keeps the review.
  const completionGate = completionV2 && opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'role.completion-gate')
  const workRemains = async (answer: string): Promise<boolean> => {
    if (!completionGate) return true
    const result = await opts.callModel({ app: 'bob', coworkerId: 'bob', functionName: 'completion-gate', aiFunction: 'completion-gate', module: 'global',
      userId: opts.userId, catalogRoleKey: 'completion-gate', catalogSchemaKey: 'bob_completion_gate',
      messages: [{ role: 'user', content: JSON.stringify({ latest_instruction: opts.message, memory_summary: opts.context?.summary ?? null,
        recent_conversation: (opts.context?.recent ?? []).slice(-6).map(({ role, text }) => ({ role, text: text.slice(0, 2000) })),
        candidate_final_answer: answer }) }],
      timeoutMs: Math.min(opts.modelTimeoutMs ?? 45_000, 30_000, deadline - Date.now()) })
    let verdict: unknown = result.data
    try { if (typeof verdict === 'string') verdict = JSON.parse(verdict) } catch { return true }
    observation.completion_gate = (verdict as { work_remaining?: unknown } | null)?.work_remaining === false ? 'done' : 'review'
    return !(result.success && (verdict as { work_remaining?: unknown } | null)?.work_remaining === false)
  }
  let previousResponseId = restored ? restored.previousResponseId : opts.context || contextStrategy ? undefined : opts.previousResponseId
  const drawingRequests=restored ? restored.initial.drawingRequests : await opts.cadAssistant?.pending()
  if (Array.isArray(drawingRequests) && drawingRequests.length) preloadTools = [...preloadTools, ...DRAWING_CONTINUATION_PRELOAD]
  const steps = BOB_TURN_LIMITS.steps, deadline = opts.deadline ?? Date.now() + 220_000
  if (restored?.initial.directory) {
    const directory = restoreOrientationDirectory(restored.initial.directory as Parameters<typeof restoreOrientationDirectory>[0], { projectId: opts.projectId, hasAccess: opts.hasAccess })
    orientationReader = directory.reader
  }
  const orientation = restored ? restored.initial.orientation : contextStrategy ? await prepareProjectOrientation({ ...opts, briefing, deadline,
    ...(opts.pureFacts ? { presentation: 'cut' as const } : {}),
    ...(boundedOrientation ? { directory: { maxTokens: Number(contract.orientation_max_tokens), pageMaxTokens: opts.resultReferences
      ? Math.min(2000, Number(contract.orientation_page_max_tokens)) : Number(contract.orientation_page_max_tokens),
      ready: (reader: OrientationDirectoryReader) => { orientationReader = reader } } } : {}),
  }) : undefined
  const initialFooter = orientation ? { role: 'user' as const,
    content: opts.aiCatalog.text('bob.note.prefix') + JSON.stringify({ orientation: orientation.footer,
      ...(opts.buildingLinks ? { buildings: { linked: opts.buildingLinks.linked, owner_can_link: opts.buildingLinks.linkable } } : {}) }) } : undefined
  // Legacy pins retain their original message order. New context explicitly
  // labels pending work as data and ends with source-bound request orientation.
  let messages: NonNullable<OpenAIServiceOptions['messages']> = restored ? structuredClone(restored.messages) : orientation ? buildManagedMessages(opts.aiCatalog, { ...opts, orientation, catalog, drawingRequests }) : [
    { role: 'user', content: buildTurnFrame(opts.aiCatalog, opts.projectId, briefing, opts.context, opts.currentView, unlimitedWork) + (catalog ? opts.aiCatalog.text('bob.frame.catalog') + JSON.stringify(catalog) : '') },
    ...(Array.isArray(drawingRequests)&&drawingRequests.length?[{role:'user' as const,content:opts.aiCatalog.text('bob.frame.outstanding')+'\n'+JSON.stringify(drawingRequests)}]:[]),
    ...(opts.context ? opts.context.recent.map(m => ({ role: m.role, content: m.text })) : [{ role: 'user' as const, content: opts.message }]),
  ]
  let preparedEpoch = restored ? restored.preparedEpoch : contextStrategy ? opts.contextEpoch?.() : undefined
  const observation: TurnObservation = structuredClone(restored?.observation ?? { steps: 0, tool_calls: 0, deferred_calls: 0, completion_checks: 0, nudges: 0, end: 'failed' })
  const observe = (end: TurnObservation['end']) => { observation.end = end; opts.observe?.({ ...observation }) }
  const progress = (value: Omit<TurnProgress, 'saved'>) => { try { opts.onProgress?.({ ...value, saved: opts.writer?.receipts.length ?? 0 }) } catch { /* progress is advisory */ } }
  const saved = (name: string) => toolbox.events.some(e => e.operation === 'execute' && e.name === name && e.status === 'saved')
  let completionChecked = restored?.completionChecked ?? false, protocolNudges = restored?.protocolNudges ?? 0, emptyNudges = restored?.emptyNudges ?? 0, closedNoteSent = restored?.closedNoteSent ?? false, commentaryStreak = restored?.commentaryStreak ?? 0
  let rejectionSignature = restored?.rejectionSignature, rejectionStreak = restored?.rejectionStreak ?? 0
  let reviewedAnswer = restored?.reviewedAnswer
  let phase = restored?.phase ?? 'ready', toolIndex = restored?.toolIndex ?? 0
  let request = restored?.request, pendingResponse = restored?.response
  let tools: NonNullable<OpenAIServiceOptions['tools']> = structuredClone(restored?.tools ?? [])
  let closedByLimit = restored?.closedByLimit ?? false, closedByCommentary = restored?.closedByCommentary ?? false
  const save = async (step: number) => {
    if (!opts.checkpoint) return
    await opts.checkpoint.save(structuredClone({ version: 1, projectId: opts.projectId, step, phase,
      initial: { briefing, catalog, drawingRequests, orientation, directory: orientationReader?.exportState() },
      messages, previousResponseId, preparedEpoch, observation, toolbox: toolbox.exportState(), workResults,
      completionChecked, protocolNudges, emptyNudges, closedNoteSent, commentaryStreak, rejectionSignature, rejectionStreak, reviewedAnswer,
      tools, closedByLimit, closedByCommentary, request, response: pendingResponse, toolIndex }))
  }
  const answered = (text: string, responseId: string | undefined, incomplete: boolean): ProjectAnswer => ({ ok: true, answer: text, projectId: opts.projectId, providerResponseId: responseId,
      evidence: { kind: 'ai_assessment', ...(opts.currentView ? { currentView: opts.getCurrentViewEvidence?.() ?? opts.currentView } : {}), references: opts.knowledgeReader?.references ?? [], sources: [...opts.lookup.sources, ...(opts.planAssistant?.sources ?? []), ...(opts.cadAssistant?.sources ?? [])].filter((s,i,a)=>a.findIndex(x=>x.dataset===s.dataset&&x.recordId===s.recordId)===i),
        partial: incomplete || !!orientation?.warnings.length || !!opts.projectEdits?.partial || !!opts.solutionActions?.partial || !!opts.workRecords?.partial || !!opts.planLinks?.partial || !!opts.buildingScope?.partial || !!opts.operationalReader?.partial || opts.lookup.partial || toolbox.partial || !!opts.projectContext?.partial || !!opts.catalogReader?.partial || !!opts.planAssistant?.partial || !!opts.cadAssistant?.partial || !!opts.writer?.uncertain || !!opts.writer?.hasUnresolvedWrites,
        ...(opts.writer?.receipts.length ? { writes: compactReceipts(opts.writer.receipts) } : {}) },
    })
  const next = async (step: number) => { phase = 'ready'; request = undefined; pendingResponse = undefined; toolIndex = 0; await save(step + 1) }
  if (!restored) await save(0)
  for (let step = restored?.step ?? 0; unlimitedWork || step < steps; step++) {
    if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
    if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
    if (Date.now() >= deadline) { observe('failed'); return { ok: false, error: 'turn_timeout' } }
    if (opts.projectContext && !await opts.projectContext.validate()) return { ok: false, error: 'context_unavailable' }
    const lastStep = !unlimitedWork && step >= steps - 1, lateInTurn = !unlimitedWork && Date.now() + 40000 >= deadline
    if (phase === 'ready') {
    tools = []
    try {
      if (opts.completeRequest) toolbox.carryInstructions()
      if (contextStrategy && opts.contextEpoch && !opts.registerContextSurface) {
        const epoch = opts.contextEpoch()
        if (epoch !== preparedEpoch) { if (opts.carryLoadedTools) toolbox.carryInstructions(); else toolbox.resetInstructions(); preparedEpoch = epoch }
      }
      if (!lastStep && !lateInTurn && commentaryStreak < 2) tools = await toolbox.prepare()
      else toolbox.closeSurface()
    } catch (error) { rethrowContinuation(error); return { ok: false, error: toolFailureCode(error) } }
    closedByLimit = lastStep || lateInTurn
    closedByCommentary = completionAware && commentaryStreak >= 2
    }
    let shelf = closedByLimit || closedByCommentary ? [] : toolbox.toolbox
    const schemaParameters = () => ({ server_quote: !!opts.message.trim(), include_manual: toolInstructions !== 'on_demand' && toolInstructions !== 'lazy',
      ...(toolInstructions === 'lazy' ? { card: true } : {}), categories: (tools.find(t => t.function.name === 'list_project_category')?.function.parameters.properties as Record<string, any> | undefined)?.category?.enum ?? [] })
    if (contextStrategy && opts.registerContextSurface) opts.registerContextSurface(async () => {
      if (!await opts.hasAccess()) throw new Error('project_denied')
      if (opts.validateCurrentView && !await opts.validateCurrentView()) throw new Error('context_unavailable')
      if (opts.projectContext && !await opts.projectContext.validate()) throw new Error('context_unavailable')
      if (opts.completeRequest || opts.carryLoadedTools) toolbox.carryInstructions(); else toolbox.resetInstructions()
      if (!closedByLimit && !closedByCommentary) tools = await toolbox.prepare()
      else { toolbox.closeSurface(); tools = [] }
      shelf = closedByLimit || closedByCommentary ? [] : toolbox.toolbox
      // The returned provider request and its eventual handlers share this
      // refreshed fence. A new describe call remains loaded for the next step.
      return { systemMessage: [buildBobSystemMessage(opts.aiCatalog, tools, shelf, opts.completeRequest), toolbox.workflowInstructions].filter(Boolean).join('\n\n'), tools: tools.length ? tools : undefined,
        catalogSchemaParameters: schemaParameters(), catalogToolParameters: toolbox.toolParameters() }
    })
    if (closedByLimit && step > 0 && !closedNoteSent) {
      closedNoteSent = true
      messages = [...messages, { role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.closed', { budget: lastStep ? 'step' : 'time' }) }]
    }
    observation.steps = step + 1
    progress({ stage: step === 0 ? 'thinking' : tools.length ? 'thinking' : 'finishing', step: step + 1 })
    // Built once per step: replay rebuilds it for every recorded step too.
    const systemMessage = [buildBobSystemMessage(opts.aiCatalog, tools, shelf, opts.completeRequest), toolbox.workflowInstructions].filter(Boolean).join('\n\n')
    console.log('[Bob context]', JSON.stringify({ step, tools: tools.length, system_chars: systemMessage.length, tool_schema_bytes: new TextEncoder().encode(JSON.stringify(tools)).length, message_bytes: new TextEncoder().encode(JSON.stringify(messages)).length, remaining_ms: Math.max(0, deadline - Date.now()) }))
    // A terminal design failure has a known cause. Deliver it without another
    // paid model call that can retry the same job or invent a renderer outage.
    const cadFailure=opts.cadAssistant?.failure
    if(cadFailure?.reason==='turn_budget_exhausted'&&typeof cadFailure.user_message!=='string')return {ok:false,error:'turn_budget_exhausted'}
    if (phase === 'ready') {
      request = {
      app: 'bob', coworkerId: 'bob', functionName: 'ask-bob', aiFunction: 'ask-bob', module: 'global',
      userId: opts.userId, systemMessage, catalogRoleKey: 'ask-bob', catalogSchemaParameters: schemaParameters(),
      ...(toolbox.toolParameters() ? { catalogToolParameters: toolbox.toolParameters() } : {}),
      messages: [...messages, ...(opts.projectContext?.carrier() ?? []), ...(step === 0 && initialFooter ? [initialFooter] : [])], previousResponseId, tools: tools.length ? tools : undefined,
      ...(completionAware ? { responsePhaseMode: 'aware' as const } : {}),
      ...(opts.completeRequest ? { responseItemsMode: 'preserve' as const, responsePhaseMode: 'aware' as const } : {}),
      maxOutputTokens: opts.writer ? 8000 : 900, timeoutMs: Math.min(opts.modelTimeoutMs ?? 45_000, deadline - Date.now()),
      }
      phase = 'model'
      await save(step)
    }
    if (phase === 'model') {
      if (!request) throw new Error('turn_checkpoint_invalid')
      pendingResponse = typeof cadFailure?.user_message === 'string'
        ? { success: true, data: cadFailure.user_message, model: 'server', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }
        : await opts.callModel(request)
      if (pendingResponse.success && !cadFailure?.user_message) opts.projectContext?.confirmDelivery()
      phase = 'response'
      await save(step)
    }
    if (!pendingResponse) throw new Error('turn_checkpoint_invalid')
    const response = pendingResponse
    if (completionAware && response.outputPhase) observation.output_phase = response.outputPhase
    if (!response.success && response.error === 'turn_budget_exhausted' && reviewedAnswer) {
      // The spending stop ended the completion review. Bob's reviewed answer
      // is delivered as partial instead of a server recovery template.
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
      observe('step_budget')
      return answered(reviewedAnswer, undefined, true)
    }
    if (!response.success) { observe('failed'); return { ok: false, error: response.error === 'turn_budget_exhausted' ? response.error : 'ai_unavailable' } }
    if (opts.projectContext && !await opts.projectContext.validate()) return { ok: false, error: 'context_unavailable' }
    if (response.toolCalls?.length) {
      commentaryStreak = 0
      if (!tools.length || !response.responseId) { observe('failed'); return { ok: false, error: 'unsupported_tool_response' } }
      // Access can end while the model is thinking; nothing runs after that.
      if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
      if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
      if (phase === 'response') {
        previousResponseId = response.responseId; messages = []; toolIndex = 0; phase = 'tools'
        await save(step)
      }
      opts.onToolBatch?.(response.toolCalls.slice(0, unlimitedWork ? undefined : BOB_TURN_LIMITS.callsPerStep).map(call => call.function.name))
      for (let index = toolIndex; index < response.toolCalls.length; index++) {
        const call = response.toolCalls[index]
        if (Date.now() >= deadline) { observe('failed'); return { ok: false, error: 'turn_timeout' } }
        if (!unlimitedWork && index >= BOB_TURN_LIMITS.callsPerStep) {
          observation.deferred_calls++
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: 'deferred', message: opts.aiCatalog.text('bob.note.deferred', { calls: BOB_TURN_LIMITS.callsPerStep }) }) })
          toolIndex = index + 1; await save(step)
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
        toolIndex = index + 1; await save(step)
      }
      await next(step)
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
        await next(step)
        continue
      }
      observe('commentary_limit'); return { ok: false, error: 'commentary_limit' }
    }
    // Provider syntax printed as prose never reaches the owner, and is never executed.
    if (answerText && hasPrintedToolProtocol(answerText)) {
      if (protocolNudges < 2 && canContinue) {
        protocolNudges++; observation.nudges++; previousResponseId = response.responseId
        messages = [{ role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.native-call') }]
        await next(step)
        continue
      }
      observe('failed'); return { ok: false, error: 'unsupported_tool_response' }
    }
    if (!answerText) {
      if (emptyNudges < 1 && response.responseId && (unlimitedWork ? Date.now() < deadline : step < steps - 1 && Date.now() + 20000 < deadline)) {
        emptyNudges++; observation.nudges++; previousResponseId = response.responseId
        messages = [{ role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.empty') }]
        await next(step)
        continue
      }
      observe('failed'); return { ok: false, error: 'empty_response' }
    }
    // The v2 review also covers a read-only promise to perform delegated work.
    // Existing conversation context remains in the same Responses chain; the
    // latest instruction refines that mandate rather than replacing its memory.
    // Bob decides; his words are never replaced by a server notice.
    const facts = unfinishedFacts(opts.aiCatalog, opts, saved)
    const attemptedWork = workResults.length > 0 || !!opts.writer?.executedReceipts.length
    const reviewWork = completionAware && (completionV2 || attemptedWork)
    if ((facts.length || reviewWork) && !completionChecked && opts.writer && opts.writer.remaining > 0 && (!completionAware || !opts.writer.uncertain)
      && canContinue && (!completionAware || response.outputPhase !== 'refusal')
      && (facts.length || attemptedWork || await workRemains(answerText))) {
      completionChecked = true; observation.completion_checks++; previousResponseId = response.responseId
      reviewedAnswer = answerText
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
      await next(step)
      continue
    }
    if (!await opts.hasAccess()) return { ok: false, error: 'project_denied' }
    progress({ stage: 'finishing', step: step + 1 })
    if (opts.validateCurrentView && !await opts.validateCurrentView()) return { ok: false, error: 'context_unavailable' }
    observe(completionAware && response.outputPhase === 'refusal' ? 'refused' : closedByCommentary ? 'commentary_limit' : closedByLimit && step > 0 ? (lastStep ? 'step_budget' : 'time_budget') : /\?\s*$/.test(answerText) ? 'asked' : 'answered')
    return answered(answerText, response.responseId, completionAware && response.outputPhase === 'refusal' || facts.length > 0)
  }
  observe('failed')
  return { ok: false, error: 'step_budget_exhausted' }
}
