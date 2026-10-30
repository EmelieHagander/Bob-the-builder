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
import { buildBobHands, buildBobCompleteHands, bobToolAvailability } from './bob-prompt.ts'
import type { AiCatalogSession } from './ai-catalog.ts'
import { compactReceipts, type ProjectWriter } from './project-write.ts'
import { humanTextIssues } from './human-text.ts'
import { answerTextFragments, type AnswerTextOutcome } from './answer-text.ts'
import { toolRejection } from './tool-rejection.ts'
import type { WorkingContext } from './bob-working-context.ts'
import { prepareProjectOrientation, type ProjectOrientation } from './bob-project-orientation.ts'
import { ORIENTATION_DIRECTORY_TOOL, type OrientationDirectoryReader } from './bob-orientation-directory.ts'
import { restoreOrientationDirectory } from './bob-orientation-directory.ts'
import { countContextTokens } from './bob-token-budget.ts'
import type { ContextSurface } from './bob-context-continuation.ts'
import type { CurrentView } from '../../../src/domain/bobScreen.ts'
import type { AnswerEvidence } from '../../../src/data/provenance.ts'
import { BOB_WRITE_LIMIT } from '../../../src/data/bobEvidence.ts'
import { BUILDING_SCOPE_PRELOAD, createBobToolSession, catalogCoreTools, catalogPhaseTools, CORE_READ_PRELOAD, DRAWING_CONTINUATION_PRELOAD, sortToolbox } from './project-tools/bob-tools.ts'
import type { BuildingLinks } from './project-building-scope.ts'
import type { ProjectFacts } from './project-facts.ts'
import type { ProjectCalculator } from './project-calculator.ts'
import { type ToolPolicyReader, type ToolboxEntry, type ToolInstructions, checkedToolSnapshot } from './project-tools/session.ts'
import catalogSeed from './project-tools/catalog-seed.json' with { type: 'json' }

/** Instruction content comes from the pinned database manifest; shelf state is data. */
export function buildBobSystemMessage(aiCatalog: AiCatalogSession, tools: OpenAIServiceOptions['tools'] = [], toolbox: ToolboxEntry[] = [], completeRequest = false, toolSheets = false, promptTiers = false): string {
  const shelf = sortToolbox(toolbox, aiCatalog.definition('bob.tools', 'tool_contract').definition.shelves as { label: string; tools: string[] }[])
  // Prompt tiers: the availability states move to the end of the input, so the instructions never change.
  return [aiCatalog.role('ask-bob').systemMessage, completeRequest ? buildBobCompleteHands(aiCatalog, tools, shelf, !promptTiers) : buildBobHands(aiCatalog, tools, shelf),
    ...(toolSheets && tools.length ? [aiCatalog.text('bob.toolbox.sheets-at-end')] : [])].join('\n\n')
}

/** Owner decision 2026-10-30 (tool sheets): a provider call to use_tool runs the
 * named tool; anything else is the call itself. */
export const USE_TOOL = 'use_tool'
function unwrapToolCall(call: { function: { name: string; arguments: string } }, toolSheets: boolean): { name: string; args: unknown } {
  let args: unknown = null
  try { args = JSON.parse(call.function.arguments) } catch { /* the handler reports invalid input */ }
  if (!toolSheets || call.function.name !== USE_TOOL) return { name: call.function.name, args }
  const inner = args as { name?: unknown; arguments?: unknown } | null
  // A malformed wrapper reaches the session as use_tool, which no handler owns: an ordinary invalid result.
  if (!inner || typeof inner !== 'object' || typeof inner.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(inner.name) || inner.name === USE_TOOL) return { name: USE_TOOL, args }
  return { name: inner.name, args: inner.arguments ?? null }
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

/** Owner decision 2026-10-30 (prompt tiers): the input is ordered by how often
 * its parts change, so each turn reuses the previous turn's start. The project
 * snapshot locked for the thread comes first, then the conversation stair
 * (summaries written once, each with its source range, then the newer messages
 * with project events where they happened), then this turn: the request and
 * the fresh briefing, which change every turn. */
function buildTieredMessages(aiCatalog: AiCatalogSession, opts: {
  projectId: string; message: string; context: WorkingContext & { stair: NonNullable<WorkingContext['stair']> }; currentView?: CurrentView;
  orientation: ProjectOrientation; catalog: unknown; drawingRequests: unknown; projectFacts?: ProjectFacts;
}): NonNullable<OpenAIServiceOptions['messages']> {
  const text = (key: string) => aiCatalog.text('bob.frame.' + key)
  const { footer: _footer, ...orientation } = opts.orientation
  const context = opts.context, stair = context.stair
  type Item = { at: string; order: number; message: NonNullable<OpenAIServiceOptions['messages']>[number] }
  const history: Item[] = [
    ...stair.raw.map((m, i) => ({ at: m.createdAt, order: i, message: { role: m.role, content: m.text } })),
    ...stair.events.map((e, i) => ({ at: e.at, order: stair.raw.length + i, message: { role: 'user' as const, content: aiCatalog.text('bob.memory.event') + ' ' + JSON.stringify(e) } })),
  ].sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order)
  const unfinished = stair.raw.filter(m => m.state !== 'completed').map(m => ({ seq: m.seq, state: m.state }))
  return [
    { role: 'user', content: aiCatalog.text('bob.memory.snapshot') + '\n' + JSON.stringify({ locked_at: stair.snapshotLockedAt, ...stair.snapshot }) },
    ...(stair.summaries.length || history.length ? [{ role: 'user' as const, content: text('prior-conversation') }] : []),
    ...stair.summaries.map(s => ({ role: 'user' as const, content: aiCatalog.text('bob.memory.summary') + '\n' + JSON.stringify({ source: { from_seq: s.seqFrom, to_seq: s.seqTo } }) + '\n' + s.text })),
    ...history.map(item => item.message),
    { role: 'user', content: opts.message },
    { role: 'user', content: [text('current'), aiCatalog.text('bob.frame.binding', { project_id: opts.projectId }), text('briefing-trust'),
      ...(unfinished.length ? [aiCatalog.text('bob.memory.states'), JSON.stringify(unfinished)] : []),
      ...(opts.currentView ? [text('current-view'), JSON.stringify(opts.currentView)] : []),
      ...(context.recentWrites?.length ? [text('saved'), JSON.stringify({ recentWrites: context.recentWrites })] : []),
      ...(context.recentSources?.length ? [text('sources'), JSON.stringify({ recentSources: context.recentSources })] : []),
      text('briefing-label'), JSON.stringify(orientation),
      ...(opts.projectFacts ? [JSON.stringify({ project_facts: opts.projectFacts })] : []),
      ...(opts.catalog ? [text('catalog'), JSON.stringify(opts.catalog)] : []),
    ].join('\n\n') },
    ...(Array.isArray(opts.drawingRequests) && opts.drawingRequests.length ? [{ role: 'user' as const, content: text('outstanding') + '\n' + JSON.stringify(opts.drawingRequests) }] : []),
  ]
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
export interface TurnObservation { steps: number; tool_calls: number; deferred_calls: number; completion_checks: number; nudges: number; completion_gate?: 'done' | 'review' | 'unavailable'; answer_text?: AnswerTextOutcome; answer_text_issues?: number; end: TurnEnd | 'failed'; output_phase?: OpenAIServiceResponse['outputPhase'] }
export interface TurnProgress { stage: 'thinking' | 'tool' | 'finishing'; tool?: string; step: number; saved: number }

/** Owner decision 2026-10-30: at a fresh turn's start a small read-only role
 * reads the owner's latest instruction and the tool cards and names up to four
 * tools for the turn, so the offered list is right from the first step and
 * stays fixed. Any failure, invalid answer or empty choice keeps the phase set. */
export async function pickTurnTools(opts: ProjectAnswerOptions, core: string[], drawingRequests: unknown, deadline: number): Promise<string[] | null> {
  const candidates = opts.aiCatalog.manifest().definitions.flatMap(row => {
    const name = row.prompt_key.startsWith('tools.') ? row.prompt_key.slice(6) : ''
    const card = row.definition.card_description
    return row.definition_kind === 'tool_contract' && name && !core.includes(name) && typeof card === 'string' && card ? [{ name, card }] : []
  })
  if (!candidates.length) return null
  const result = await opts.callModel({ app: 'bob', coworkerId: 'bob', functionName: 'tool-picker', aiFunction: 'tool-picker', module: 'global',
    userId: opts.userId, catalogRoleKey: 'tool-picker', catalogSchemaKey: 'bob_tool_pick',
    messages: [{ role: 'user', content: JSON.stringify({ latest_instruction: opts.message, memory_summary: opts.context?.summary ?? null,
      recent_conversation: (opts.context?.recent ?? []).slice(-4).map(({ role, text }) => ({ role, text: text.slice(0, 1000) })),
      pending_drawing_requests: Array.isArray(drawingRequests) ? drawingRequests.length : 0,
      always_loaded: core, candidates }) }],
    timeoutMs: Math.max(1000, Math.min(opts.modelTimeoutMs ?? 45_000, 15_000, deadline - Date.now())) })
  let value: unknown = result.data
  try { if (typeof value === 'string') value = JSON.parse(value) } catch { return null }
  const names = (value as { tools?: unknown } | null)?.tools
  if (!result.success || !Array.isArray(names)) return null
  const known = new Set(candidates.map(c => c.name))
  const picked = [...new Set(names.filter((name): name is string => typeof name === 'string' && known.has(name)))].slice(0, 4)
  return picked.length ? picked : null
}
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
  initial: { briefing: unknown; catalog: unknown; drawingRequests: unknown; orientation?: ProjectOrientation; directory?: unknown; toolPick?: string[] | null }
  /** Tool-sheet manifests: tools whose details are already at the end of this conversation. */
  sheets?: string[]
  /** Tool-order manifests: the native tool names in the order sent; later loads are appended. */
  native?: string[]
  /** Prompt-tier manifests: the tool availability last sent at the end of the input. */
  availability?: string
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
  onTool?: (value: { name: string; status: string; step: number; index: number; ms: number; validation_code?: string; diagnostics?:import('./execution-metrics.ts').WorkDiagnostics }) => void;
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
  /** Production turns ask the small tool picker when the manifest publishes it;
   * offline callers keep the phase choice unless they opt in. */
  toolPicker?: boolean;
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
  const coreTools = catalogCoreTools(opts.aiCatalog)
  let preloadTools: string[] = coreTools ?? [...(opts.corePreload ? CORE_READ_PRELOAD : []), ...(opts.buildingLinks && !opts.buildingLinks.whole ? BUILDING_SCOPE_PRELOAD : [])]
  const phaseTools = catalogPhaseTools(opts.aiCatalog, coreTools)
  // The flexible set is chosen at the turn's first tool step and kept, so the
  // offered tool list (and the provider cache) stays stable for the turn.
  // Pending drawing work counts as work in progress and wins over the phase.
  let drawingWork = false, flexiblePhase: string | null | undefined
  // Owner decision 2026-10-30: when the manifest publishes the tool picker, the
  // tools it named for this request replace the phase set; the phase set is the fallback.
  let toolPick: string[] | null = restored?.initial.toolPick ?? null
  // Owner decision 2026-10-30: the base prompt (role, directory, the permanent
  // tools and use_tool) never changes; the job's other tools are described in
  // detail at the end of the conversation, once each, and called through use_tool.
  const toolSheets = !!(phaseTools && coreTools && opts.aiCatalog.definition('bob.tools', 'tool_contract').definition.tool_sheets_version === 1)
  const sheetsSent = new Set<string>(restored?.sheets ?? [])
  // Owner decision after paid box run 5: every tool is native. The turn's first tools keep their
  // order and a tool loaded later is added at the end, so the list only grows within a turn.
  const toolOrder = !!(phaseTools && coreTools && opts.aiCatalog.definition('bob.tools', 'tool_contract').definition.tool_order_version === 1)
  const nativeOrder: string[] = [...(restored?.native ?? [])]
  const orderTools = (specs: NonNullable<OpenAIServiceOptions['tools']>) => {
    if (!toolOrder || !specs.length) return specs
    for (const spec of specs) if (!nativeOrder.includes(spec.function.name)) nativeOrder.push(spec.function.name)
    return nativeOrder.flatMap(name => specs.filter(spec => spec.function.name === name))
  }
  // Prompt tiers (2026-10-30): the stair-pinned context carries the tiered order; availability is sent at the end, only when it changes.
  // With tool order the list grows within a turn, so availability is never part of the instructions either.
  const promptTiers = !!opts.context?.stair || toolOrder
  let availabilitySent: string | undefined = restored?.availability
  const splitSheets = (specs: NonNullable<OpenAIServiceOptions['tools']>) => {
    if (!toolSheets || !specs.length) return { native: specs, sheets: [] as string[] }
    return { native: [...specs.filter(spec => coreTools!.includes(spec.function.name)), opts.aiCatalog.tool(USE_TOOL, { include_manual: true })],
      sheets: specs.map(spec => spec.function.name).filter(name => !coreTools!.includes(name)) }
  }
  const turnPreload = (phase: string | null) => {
    if (!phaseTools) return preloadTools
    if (toolPick) return [...preloadTools, ...toolPick]
    if (flexiblePhase === undefined) flexiblePhase = drawingWork ? 'design' : phase
    return [...preloadTools, ...(flexiblePhase ? phaseTools[flexiblePhase] ?? [] : [])]
  }
  const toolbox = createBobToolSession({ ...opts, ...(contextStrategy ? { toolInstructions } : {}), preloadTools: turnPreload,
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
  // Owner decision 2026-10-29: saved work no longer triggers a full Bob review
  // round. Gaps the server knows get a targeted note; otherwise the small gate
  // judges the answer against the request and this turn's saved work.
  const completionV3 = contract.work_completion_version === 3
  const completionAware = contract.work_completion_version === 1 || completionV2 || completionV3
  // Owner decision 2026-10-29: the chat answer holds no IDs, codes, tool names or
  // revision numbers either. One rewrite note on violation, never a loop.
  const answerTextV1 = completionV3 && contract.answer_text_version === 1
  const writeTools = new Set(completionAware ? opts.aiCatalog.manifest().definitions.filter(row => row.definition_kind === 'tool_contract'
    && Object.hasOwn((row.definition.parameters as any)?.properties ?? {}, 'request_quote')).map(row => row.definition.name as string) : [])
  const workResults: { tool: string; status: string; message?: string; refresh_status?: string; validation?: unknown }[] = structuredClone(restored?.workResults ?? [])
  // A read-only answer with nothing unfinished would otherwise be regenerated
  // by a full review. Manifests with the completion gate ask a small read-only
  // role first; no gate, a failed call or an invalid result keeps the review.
  const completionGate = (completionV2 || completionV3) && opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'role.completion-gate')
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
  // v3 gate: the same small role also sees what this turn saved and attempted,
  // so a claimed result without a saved record is visible. No verdict (failed
  // call, invalid JSON) delivers Bob's answer instead of starting a review.
  const gateVerdict = async (answer: string): Promise<{ remaining: boolean; reason: string } | null> => {
    if (!completionGate) return null
    const result = await opts.callModel({ app: 'bob', coworkerId: 'bob', functionName: 'completion-gate', aiFunction: 'completion-gate', module: 'global',
      userId: opts.userId, catalogRoleKey: 'completion-gate', catalogSchemaKey: 'bob_completion_gate',
      messages: [{ role: 'user', content: JSON.stringify({ latest_instruction: opts.message, memory_summary: opts.context?.summary ?? null,
        recent_conversation: (opts.context?.recent ?? []).slice(-6).map(({ role, text }) => ({ role, text: text.slice(0, 2000) })),
        candidate_final_answer: answer,
        saved_work: compactReceipts(opts.writer?.executedReceipts ?? []).slice(-32).map(({ dataset, label, operation, revision }) =>
          ({ dataset, label, operation, ...(revision ? { revision } : {}) })),
        attempted_actions: workResults.slice(-32).map(({ tool, status, message }) =>
          ({ tool, status, ...(status !== 'saved' && message ? { message: message.slice(0, 200) } : {}) })) }) }],
      timeoutMs: Math.min(opts.modelTimeoutMs ?? 45_000, 30_000, deadline - Date.now()) })
    let verdict: unknown = result.data
    try { if (typeof verdict === 'string') verdict = JSON.parse(verdict) } catch { verdict = null }
    const value = verdict as { work_remaining?: unknown; reason?: unknown } | null
    if (!result.success || typeof value?.work_remaining !== 'boolean') { observation.completion_gate = 'unavailable'; return null }
    observation.completion_gate = value.work_remaining ? 'review' : 'done'
    return { remaining: value.work_remaining, reason: typeof value.reason === 'string' ? value.reason.trim().slice(0, 300) : '' }
  }
  let previousResponseId = restored ? restored.previousResponseId : opts.context || contextStrategy ? undefined : opts.previousResponseId
  const drawingRequests=restored ? restored.initial.drawingRequests : await opts.cadAssistant?.pending()
  if (!coreTools && Array.isArray(drawingRequests) && drawingRequests.length) preloadTools = [...preloadTools, ...DRAWING_CONTINUATION_PRELOAD]
  if (phaseTools && Array.isArray(drawingRequests) && drawingRequests.length) drawingWork = true
  const steps = BOB_TURN_LIMITS.steps, deadline = opts.deadline ?? Date.now() + 220_000
  if (!restored && opts.toolPicker === true && phaseTools && coreTools
    && opts.aiCatalog.manifest().definitions.some(row => row.prompt_key === 'role.tool-picker')) toolPick = await pickTurnTools(opts, coreTools, drawingRequests, deadline)
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
  let messages: NonNullable<OpenAIServiceOptions['messages']> = restored ? structuredClone(restored.messages) : orientation
    ? opts.context?.stair ? buildTieredMessages(opts.aiCatalog, { ...opts, context: opts.context as WorkingContext & { stair: NonNullable<WorkingContext['stair']> }, orientation, catalog, drawingRequests })
      : buildManagedMessages(opts.aiCatalog, { ...opts, orientation, catalog, drawingRequests }) : [
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
      initial: { briefing, catalog, drawingRequests, orientation, directory: orientationReader?.exportState(), ...(toolPick ? { toolPick } : {}) },
      ...(toolSheets ? { sheets: [...sheetsSent] } : {}),
      ...(toolOrder ? { native: [...nativeOrder] } : {}),
      ...(availabilitySent !== undefined ? { availability: availabilitySent } : {}),
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
    let pendingSheets: string[] = []
    // Prompt tiers: availability lists every tool Bob can call this step, through use_tool too.
    let callable: string[] = []
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
    callable = tools.map(tool => tool.function.name)
    if (toolSheets && tools.length) { const split = splitSheets(tools); tools = split.native; pendingSheets = split.sheets.filter(name => !sheetsSent.has(name)) }
    tools = orderTools(tools)
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
      // A rollover summarizes the sheets away: send them again at the end of the next step.
      callable = tools.map(tool => tool.function.name)
      if (toolSheets) { tools = splitSheets(tools).native; sheetsSent.clear() }
      tools = orderTools(tools)
      availabilitySent = undefined
      shelf = closedByLimit || closedByCommentary ? [] : toolbox.toolbox
      // The returned provider request and its eventual handlers share this
      // refreshed fence. A new describe call remains loaded for the next step.
      return { systemMessage: [buildBobSystemMessage(opts.aiCatalog, tools, shelf, opts.completeRequest, toolSheets, promptTiers), toolbox.workflowInstructions].filter(Boolean).join('\n\n'), tools: tools.length ? tools : undefined,
        catalogSchemaParameters: schemaParameters(), catalogToolParameters: toolbox.toolParameters() }
    })
    if (closedByLimit && step > 0 && !closedNoteSent) {
      closedNoteSent = true
      messages = [...messages, { role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + opts.aiCatalog.text('bob.note.closed', { budget: lastStep ? 'step' : 'time' }) }]
    }
    observation.steps = step + 1
    progress({ stage: step === 0 ? 'thinking' : tools.length ? 'thinking' : 'finishing', step: step + 1 })
    // Built once per step: replay rebuilds it for every recorded step too.
    const systemMessage = [buildBobSystemMessage(opts.aiCatalog, tools, shelf, opts.completeRequest, toolSheets, promptTiers), toolbox.workflowInstructions].filter(Boolean).join('\n\n')
    const availability = phase === 'ready' && promptTiers && opts.completeRequest && tools.length
      ? bobToolAvailability(callable.map(name => ({ type: 'function' as const, function: { name, description: '', parameters: {} } })), shelf) : undefined
    const availabilityMessage = availability !== undefined && availability !== availabilitySent ? { role: 'user' as const, content: availability } : null
    if (availabilityMessage) availabilitySent = availability
    // The job's newly available tools, in detail, after everything else in this request.
    const sheetMessage = pendingSheets.length ? { role: 'user' as const, content: opts.aiCatalog.text('bob.toolbox.sheets-intro') + '\n' + JSON.stringify(pendingSheets.map(name => {
      const spec = opts.aiCatalog.tool(name, { ...schemaParameters(), ...(toolbox.toolParameters()?.[name] ?? {}) }).function
      return { name: spec.name, description: spec.description, parameters: spec.parameters }
    })) } : null
    for (const name of pendingSheets) sheetsSent.add(name)
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
      messages: [...messages, ...(opts.projectContext?.carrier() ?? []), ...(step === 0 && initialFooter ? [initialFooter] : []), ...(availabilityMessage ? [availabilityMessage] : []), ...(sheetMessage ? [sheetMessage] : [])], previousResponseId, tools: tools.length ? tools : undefined,
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
      opts.onToolBatch?.(response.toolCalls.slice(0, unlimitedWork ? undefined : BOB_TURN_LIMITS.callsPerStep).map(call => unwrapToolCall(call, toolSheets).name))
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
        // Tool-sheet manifests: use_tool runs the named tool through the same session gates.
        const { name: toolName, args } = unwrapToolCall(call, toolSheets)
        progress({ stage: 'tool', tool: toolName, step: step + 1 })
        let result: any
        const began = Date.now()
        try { result = await toolbox.execute(toolName, args) }
        catch (error) { rethrowContinuation(error); observe('failed'); return { ok: false, error: toolFailureCode(error) } }
        observation.tool_calls++
        // Its result carries the manual and parameters: that tool's sheet is in the conversation now.
        if (toolSheets && toolName === 'describe_tool' && result?.status === 'ok' && typeof result.name === 'string') sheetsSent.add(result.name)
        // Content-free reason for every rejected call: codes and field paths only.
        const rejection = ['invalid', 'conflict'].includes(result?.status) ? toolRejection(result) : null
        if (rejection) console.warn('[Bob tool rejection]', JSON.stringify({ tool: /^[a-z][a-z0-9_]{0,63}$/.test(toolName) ? toolName : 'invalid_name',
          status: result.status, code: rejection.code, fields: rejection.fields }))
        const validationCode = completionV3 && rejection ? rejection.code
          : completionAware && typeof result?.validation?.code === 'string' ? result.validation.code : undefined
        try { opts.onTool?.({ name: toolName, status: String(result?.status ?? 'returned'), step: step + 1, index, ms: Date.now() - began,
          ...(result?.diagnostics?{diagnostics:result.diagnostics}:{}),
          ...(validationCode !== undefined ? { validation_code: validationCode } : {}) }) } catch { /* diagnostics only */ }
        // Cache hits are worker-local telemetry. Their loss on resume must not
        // change model/journal bytes for the same exact source result.
        if (['work_read','work_change','work_check'].includes(result?.diagnostics?.operation)) {
          const { diagnostics: _diagnostics, ...content } = result
          result = content
        }
        if (result?.status === 'denied') {
          // A refused record is not a lost project: only real loss of access ends the turn.
          if (result?.reason !== 'access' || !await opts.hasAccess()) { observe('failed'); return { ok: false, error: 'project_denied' } }
          result = { status: 'not_found', saved: false, message: opts.aiCatalog.text('bob.fact.record-missing') }
        }
        console.log('[Bob tool]', /^[a-z][a-z0-9_]{0,63}$/.test(toolName) ? toolName : 'invalid_name', result?.status ?? 'returned')
        if (completionAware && writeTools.has(toolName)) workResults.push({ tool: toolName, status: String(result?.status ?? 'returned'),
          ...(typeof result?.message === 'string' ? { message: result.message } : {}),
          ...(typeof result?.refresh_status === 'string' ? { refresh_status: result.refresh_status } : {}),
          ...(result?.validation ? { validation: result.validation } : {}) })
        if (unlimitedWork && (result?.status === 'invalid' || result?.status === 'conflict')) {
          // Identical rejected work is stalled, even when its repeated calls
          // keep producing journal entries. Changed inputs or other tool work
          // reset the streak; this is not a total correction allowance.
          const signature = await fingerprint({ tool: toolName, arguments: args ?? call.function.arguments, result })
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
    if (completionV3 && !completionChecked && response.outputPhase !== 'refusal') {
      // One targeted note at most per turn: code-known facts first, else the
      // gate's named gap; internal references in the answer ride the same note.
      const workEligible = !!opts.writer && opts.writer.remaining > 0 && !opts.writer.uncertain && canContinue
      const gate = !workEligible || facts.length ? null : await gateVerdict(answerText)
      const workNote = !workEligible ? null : facts.length ? opts.aiCatalog.text('bob.note.finish', { facts: facts.join(' ') })
        : gate?.remaining ? opts.aiCatalog.text('bob.note.gate-gap', { reason: gate.reason }) : null
      const textIssues = answerTextV1 ? humanTextIssues(answerText) : []
      const textEligible = textIssues.length > 0 && !!response.responseId
        && (unlimitedWork ? Date.now() < deadline : step < steps - 1 && Date.now() + 20000 < deadline)
      const textNote = textEligible ? opts.aiCatalog.text(workNote ? 'bob.note.answer-text-also' : 'bob.note.answer-text', { fragments: answerTextFragments(textIssues) }) : null
      if (workNote || textNote) {
        completionChecked = true; previousResponseId = response.responseId
        if (workNote) observation.completion_checks++
        if (textNote) { observation.answer_text = 'rewrite_requested'; observation.answer_text_issues = textIssues.length }
        reviewedAnswer = answerText
        messages = [{ role: 'user', content: opts.aiCatalog.text('bob.note.prefix') + [workNote, textNote].filter(Boolean).join(' ') }]
        await next(step)
        continue
      }
    }
    const attemptedWork = workResults.length > 0 || !!opts.writer?.executedReceipts.length
    const reviewWork = completionAware && (completionV2 || attemptedWork)
    if (!completionV3 && (facts.length || reviewWork) && !completionChecked && opts.writer && opts.writer.remaining > 0 && (!completionAware || !opts.writer.uncertain)
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
    if (answerTextV1) {
      // Content-free outcome: the delivered words are Bob's, never replaced.
      const remaining = humanTextIssues(answerText).length
      observation.answer_text = observation.answer_text === 'rewrite_requested' ? (remaining ? 'rewrite_unchanged' : 'rewritten') : remaining ? 'delivered_with_issues' : 'clean'
      observation.answer_text_issues = remaining
    }
    observe(completionAware && response.outputPhase === 'refusal' ? 'refused' : closedByCommentary ? 'commentary_limit' : closedByLimit && step > 0 ? (lastStep ? 'step_budget' : 'time_budget') : /\?\s*$/.test(answerText) ? 'asked' : 'answered')
    return answered(answerText, response.responseId, completionAware && response.outputPhase === 'refusal' || facts.length > 0)
  }
  observe('failed')
  return { ok: false, error: 'step_budget_exhausted' }
}
