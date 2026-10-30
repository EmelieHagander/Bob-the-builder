import type { ModelCall } from './project-answer.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import type { ProjectWriteReceipt } from '../../../src/data/provenance.ts'
import { isProjectWriteReceipt } from '../../../src/data/bobEvidence.ts'
import { checkedBrief, manageConversationBrief, manageConversationBriefV2, gistOnlyBrief, degradedBrief, readStoredBrief, briefFitsTokenBudget, BRIEF_LIMITS, BRIEF_TOKEN_POLICY, InvalidConversationBrief, type ConversationBrief } from './bob-conversation-brief.ts'
import type { MemoryRetrieval, MemoryRetrievalStore } from './bob-memory-retrieval.ts'

export interface ContextMessage { seq: number; role: 'user' | 'assistant'; text: string; state: 'pending' | 'completed' | 'failed' }
export interface ContextFrame {
  projectId: string; threadId: string; generation: number; summary: string;
  lastFoldedSeq: number; foldThroughSeq: number; recent: ContextMessage[]; older: ContextMessage[]; hasMore: boolean;
  recentWrites?: ProjectWriteReceipt[];
  recentSources?: RecentSource[];
}
/** Owner decision 2026-10-30 (memory stair): summaries written once with their
 * exact message range, the newer messages, project events since the locked
 * snapshot, and that snapshot. See bob-memory-stair.ts. */
export interface StairSummary { id: string; level: 0 | 1 | 2; seqFrom: number; seqTo: number; text: string }
export interface StairMessage extends ContextMessage { createdAt: string }
export interface StairEvent { at: string; kind: string; [key: string]: unknown }
export interface MemoryStair { snapshot: Record<string, unknown>; snapshotLockedAt: string; summaries: StairSummary[]; raw: StairMessage[]; events: StairEvent[] }
/** A record Bob consulted in his previous reply: a pointer, never current state. */
export interface RecentSource { dataset: string; recordId: string; label: string }
const validSource = (v: unknown): v is RecentSource => !!v && typeof v === 'object' && !Array.isArray(v)
  && ['dataset', 'recordId', 'label'].every(k => typeof (v as Record<string, unknown>)[k] === 'string' && ((v as Record<string, string>)[k]).length > 0 && ((v as Record<string, string>)[k]).length <= 200)
export interface ContextStore extends MemoryRetrievalStore {
  load(): Promise<unknown>;
  save(expected: number, through: number, summary: string): Promise<unknown>;
  search(query: string, before: number | null): Promise<unknown>;
}
export interface WorkingContext {
  summary: string; throughSeq: number; recent: ContextMessage[];
  historyIndex?: ConversationBrief['index'];
  recentWrites?: ProjectWriteReceipt[];
  recentSources?: RecentSource[];
  memoryManagementVersion?: 1 | 2;
  stair?: MemoryStair;
  history: { readonly remaining: number; search(value: unknown): Promise<{ status: string; [key: string]: unknown }>;
    read?(value: unknown): Promise<{ status: string; [key: string]: unknown }> };
}
export interface WorkingContextState {
  version: 1; projectId: string; threadId: string; searches: number;
  context: Omit<WorkingContext, 'history'>;
}
export interface WorkingContextSession extends WorkingContext {
  exportState(): WorkingContextState;
  restoreState(state: WorkingContextState): void;
}
export interface WorkingContextRestoreOptions {
  projectId: string; threadId: string; message: string; store: ContextStore;
  hasAccess: () => Promise<boolean>; unlimitedWork?: boolean; retrieval?: MemoryRetrieval;
}

export const HISTORY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'search_conversation_history',
    description: 'Read exact older messages in THIS private conversation when the summary lacks a detail. History is not current project truth. Follow nextBeforeSeq for more matches.',
    parameters: { type: 'object', additionalProperties: false, required: ['query', 'before_seq'], properties: {
      query: { type: 'string', description: 'Literal text, max 200 characters. Empty string browses recent history.' },
      before_seq: { type: ['integer', 'null'], description: 'Exclusive sequence cursor returned by a previous search, or null.' },
    } },
  },
}

function validMessage(value: unknown): value is ContextMessage {
  if (!value || typeof value !== 'object') return false
  const v = value as ContextMessage
  return Number.isSafeInteger(v.seq) && v.seq > 0 && ['user', 'assistant'].includes(v.role)
    && typeof v.text === 'string' && v.text.length > 0 && v.text.length <= 200000
    && ['pending', 'completed', 'failed'].includes(v.state)
}
function frame(value: unknown, binding: { projectId: string; threadId: string; generation: number; message: string }): ContextFrame {
  const v = value as ContextFrame
  if (!v || v.projectId !== binding.projectId || v.threadId !== binding.threadId || v.generation !== binding.generation
    || typeof v.summary !== 'string' || v.summary.length > 24000
    || !Number.isSafeInteger(v.lastFoldedSeq) || v.lastFoldedSeq < 0
    || !Number.isSafeInteger(v.foldThroughSeq) || v.foldThroughSeq < v.lastFoldedSeq
    || !Array.isArray(v.recent) || v.recent.length < 1 || v.recent.length > 5 || !v.recent.every(validMessage)
    || !Array.isArray(v.older) || v.older.length > 16 || !v.older.every(validMessage) || typeof v.hasMore !== 'boolean'
    || (v.recentWrites !== undefined && (!Array.isArray(v.recentWrites) || v.recentWrites.length > 16
      || !v.recentWrites.every(r => isProjectWriteReceipt(r, binding.projectId))))
    || (v.recentSources !== undefined && (!Array.isArray(v.recentSources) || v.recentSources.length > 24 || !v.recentSources.every(validSource)))) throw new Error('context_unavailable')
  const last = v.recent[v.recent.length - 1]
  if (last.role !== 'user' || last.text !== binding.message || last.state !== 'pending') throw new Error('context_unavailable')
  return v
}

/** SQL owns the snapshot and compare-and-swap. Check its complete folded range
 * before trusting a model's editable selection. Retried current requests can
 * have an older sequence; they are explicitly excluded by the SQL snapshot. */
function checkFrameCoverage(state: ContextFrame): void {
  const current = state.recent.at(-1)!
  const previousRecent = state.recent.slice(0, -1)
  if (new Set(state.recent.map(message => message.seq)).size !== state.recent.length
    || previousRecent.some((message, at) => at > 0 && message.seq <= previousRecent[at - 1].seq)) throw new Error('context_unavailable')
  const cutoff = previousRecent[0]?.seq ?? current.seq
  let next = state.lastFoldedSeq + 1
  for (const message of state.older) {
    if (next === current.seq && next < cutoff) next++
    if (message.seq !== next || message.seq >= cutoff) throw new Error('context_unavailable')
    next++
  }
  const actualThrough = state.older.at(-1)?.seq ?? state.lastFoldedSeq
  if (actualThrough !== state.foldThroughSeq) throw new Error('context_unavailable')
  if (next === current.seq && next < cutoff) next++
  if (state.hasMore ? next >= cutoff : next !== cutoff) throw new Error('context_unavailable')
}

/** Incremental Launchpad-style T1/T2/T3 separation, not provider compaction.
 * A failed fold is retryable and never falls through to an amnesic answer.
 * Successful chunks survive retries; transcript and exact T1 are never rewritten.
 */
export async function prepareWorkingContext(opts: {
  projectId: string; userId: string; threadId: string; generation: number; message: string;
  store: ContextStore; callModel: ModelCall; hasAccess: () => Promise<boolean>; deadline: number; unlimitedWork?: boolean;
  /** Pinned in the durable execution identity; old journals retain their folds. */
  memoryManagementVersion?: 1 | 2;
  /** Pinned schema contract; older in-flight journals retain their exact input. */
  memoryPointerScopeVersion?: 1;
  /** Pinned schema contract: the model returns only a gist and an invalid or
   * failed fold keeps the earlier gist instead of failing the turn. */
  memoryGistOnlyVersion?: 1;
  retrieval?: MemoryRetrieval;
}): Promise<WorkingContextSession> {
  const managed = opts.memoryManagementVersion === 2
  const gistOnly = managed && opts.memoryGistOnlyVersion === 1
  let degraded = false
  const load = async () => {
    if (!await opts.hasAccess()) throw new Error('project_denied')
    const loaded = frame(await opts.store.load(), opts)
    if (managed) checkFrameCoverage(loaded)
    return loaded
  }
  let state = await load()
  // A degraded fold keeps the stored gist as is; it never loops on a rewrite.
  const needsRewrite = () => managed && !degraded && !briefFitsTokenBudget(readStoredBrief(state.summary, state.lastFoldedSeq))
  for (let fold = 0; (state.older.length || needsRewrite()) && (opts.unlimitedWork || fold < 4); fold++) {
    const previousBrief = readStoredBrief(state.summary, state.lastFoldedSeq)
    const refreshOnly = state.older.length === 0
    if (refreshOnly && !opts.store.refresh) throw new Error('context_unavailable')
    const known = new Set([...previousBrief.index.map(e => e.seq), ...state.older.map(m => m.seq)])
    const scopedPointers = managed && !gistOnly && opts.memoryPointerScopeVersion === 1
    if (scopedPointers) known.delete(state.recent.at(-1)!.seq)
    const availableSequences = [...known].sort((a, b) => a - b)
    let brief: ConversationBrief | undefined
    let validationFeedback: Record<string, unknown> | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() + 5000 >= opts.deadline) throw new Error('context_preparing')
      const response = await opts.callModel({
        app: 'bob', coworkerId: 'bob', functionName: 'context-summary', aiFunction: 'context-summary', module: 'global', userId: opts.userId,
        catalogRoleKey:'context-summary',catalogSchemaKey:managed ? 'bob_conversation_brief_v2' : 'bob_conversation_brief',schemaName:managed ? 'bob_conversation_brief_v2' : 'bob_conversation_brief',
        ...(scopedPointers ? { catalogSchemaParameters: { memory_sequences: availableSequences } } : {}),

        messages: [{ role: 'user', content: JSON.stringify({ previousBrief, throughSeq: state.lastFoldedSeq, olderMessages: state.older,
          ...(managed ? { foldThroughSeq: state.foldThroughSeq,
            currentRequest: scopedPointers || gistOnly ? { text: state.recent.at(-1)!.text } : state.recent.at(-1),
            ...(scopedPointers ? { availableSequences } : {}), memoryPolicy: BRIEF_TOKEN_POLICY } : {}),
          ...(validationFeedback ? { validationFeedback } : {}) }) }],
        maxOutputTokens: 3000, timeoutMs: Math.min(30000, opts.deadline - Date.now()),
      })
      if (!response.success || response.toolCalls?.length) {
        if (gistOnly && response.error !== 'turn_budget_exhausted') {
          console.warn('[Bob memory]', JSON.stringify({ attempt: attempt + 1, reason: 'model_failed' }))
          continue
        }
        throw new Error(response.error==='turn_budget_exhausted'?'turn_budget_exhausted':'context_unavailable')
      }
      try {
        const candidate = gistOnly ? gistOnlyBrief(response.data) : managed
          ? manageConversationBriefV2(response.data, previousBrief, state.older, state.foldThroughSeq)
          : opts.memoryManagementVersion === 1
          ? manageConversationBrief(response.data, previousBrief, state.older, state.foldThroughSeq)
          : checkedBrief(response.data, state.foldThroughSeq, BRIEF_LIMITS.gist)
        if (!managed && (candidate.index.some(e => !known.has(e.seq)) || state.older.some(m => !candidate.index.some(e => e.seq === m.seq)))) throw new InvalidConversationBrief('coverage')
        if (scopedPointers && candidate.index.some(entry => !known.has(entry.seq))) throw new InvalidConversationBrief('coverage')
        brief = candidate
        break
      } catch (error) {
        if (!(error instanceof InvalidConversationBrief)) throw error
        console.warn('[Bob memory]', JSON.stringify({ attempt: attempt + 1, reason: error.reason, characters: [...JSON.stringify(response.data ?? null)].length }))
        if (attempt === 1 && !gistOnly) throw error
        validationFeedback = gistOnly ? { reason: error.reason, memoryPolicy: BRIEF_TOKEN_POLICY } : managed
          ? { reason: error.reason, memoryPolicy: BRIEF_TOKEN_POLICY, availableSequences: [...known] }
          : { reason: error.reason, limits: BRIEF_LIMITS, requiredSequences: state.older.map(m => m.seq) }
      }
    }
    if (!brief && gistOnly) {
      // Originals stay searchable; a missing summary must not stop the answer.
      brief = refreshOnly ? readStoredBrief(state.summary, state.lastFoldedSeq) : degradedBrief(previousBrief, state.lastFoldedSeq + 1, state.foldThroughSeq)
      degraded = true
      console.warn('[Bob memory]', JSON.stringify({ degraded: true, through: state.foldThroughSeq }))
      if (refreshOnly) break
    }
    if (!brief) throw new Error('context_unavailable')
    if (!await opts.hasAccess()) throw new Error('project_denied')
    const saved = await (refreshOnly
      ? opts.store.refresh!(state.lastFoldedSeq, state.summary, JSON.stringify(brief))
      : opts.store.save(state.lastFoldedSeq, state.foldThroughSeq, JSON.stringify(brief))) as { lastFoldedSeq?: number }
    if (saved?.lastFoldedSeq !== state.foldThroughSeq) throw new Error('context_unavailable')
    state = await load()
    if (managed && (state.lastFoldedSeq !== saved.lastFoldedSeq || state.summary !== JSON.stringify(brief))) throw new Error('context_unavailable')
  }
  if (state.older.length || state.hasMore || needsRewrite()) throw new Error('context_preparing')
  if (managed && opts.retrieval) await opts.retrieval.index()
  const brief = readStoredBrief(state.summary, state.lastFoldedSeq)
  return restoreWorkingContext({ version: 1, projectId: opts.projectId, threadId: opts.threadId, searches: 0,
    context: { summary: brief.gist, historyIndex: brief.index, throughSeq: state.lastFoldedSeq, recent: state.recent,
      recentWrites: state.recentWrites ?? [], recentSources: state.recentSources ?? [],
      ...(managed ? { memoryManagementVersion: 2 as const } : {}) },
  }, opts)
}

function validStair(value: unknown, currentSeq: number): boolean {
  const v = value as MemoryStair
  if (!v || typeof v !== 'object' || !v.snapshot || typeof v.snapshot !== 'object' || Array.isArray(v.snapshot) || typeof v.snapshotLockedAt !== 'string'
    || !Array.isArray(v.summaries) || v.summaries.length > 16 || !Array.isArray(v.raw) || v.raw.length > 200 || !Array.isArray(v.events) || v.events.length > 60) return false
  let next = 1
  for (const s of v.summaries) {
    if (!s || typeof s.id !== 'string' || ![0, 1, 2].includes(s.level) || s.seqFrom !== next || !Number.isSafeInteger(s.seqTo) || s.seqTo < s.seqFrom
      || typeof s.text !== 'string' || !s.text.trim() || s.text.length > 4000) return false
    next = s.seqTo + 1
  }
  return v.raw.every((m, i) => validMessage(m) && typeof m.createdAt === 'string' && m.seq >= next && m.seq !== currentSeq && (i === 0 || m.seq > v.raw[i - 1].seq))
    && v.events.every(e => e && typeof e.at === 'string' && typeof e.kind === 'string')
}

/** Rebuild only the request-bound reader. Preparation products are immutable
 * turn inputs: restoring must not reload/fold memory or reindex older text. */
export function restoreWorkingContext(saved: WorkingContextState, opts: WorkingContextRestoreOptions): WorkingContextSession {
  const validate = (state: WorkingContextState) => {
    const value = state?.context
    if (state?.version !== 1 || state.projectId !== opts.projectId || state.threadId !== opts.threadId
      || !Number.isSafeInteger(state.searches) || state.searches < 0 || !value || typeof value.summary !== 'string'
      || !Number.isSafeInteger(value.throughSeq) || value.throughSeq < 0
      || !Array.isArray(value.recent) || value.recent.length < 1 || value.recent.length > 5 || !value.recent.every(validMessage)
      || value.recent.at(-1)!.role !== 'user' || value.recent.at(-1)!.state !== 'pending' || value.recent.at(-1)!.text !== opts.message
      || value.memoryManagementVersion !== undefined && value.memoryManagementVersion !== 1 && value.memoryManagementVersion !== 2
      || value.historyIndex !== undefined && (!Array.isArray(value.historyIndex) || !value.historyIndex.every(entry => entry
        && Number.isSafeInteger(entry.seq) && entry.seq > 0 && typeof entry.descriptor === 'string'))
      || value.recentWrites !== undefined && (!Array.isArray(value.recentWrites) || value.recentWrites.length > 16
        || !value.recentWrites.every(receipt => isProjectWriteReceipt(receipt, opts.projectId)))
      || value.recentSources !== undefined && (!Array.isArray(value.recentSources) || value.recentSources.length > 24 || !value.recentSources.every(validSource))
      || value.stair !== undefined && !validStair(value.stair, value.recent.at(-1)!.seq)) {
      throw new Error('context_checkpoint_invalid')
    }
  }
  validate(saved)
  let searches = saved.searches
  const managed = saved.context.memoryManagementVersion === 2
  const session: WorkingContextSession = { ...structuredClone(saved.context),
    exportState() {
      const { history: _history, exportState: _export, restoreState: _restore, ...context } = session
      return structuredClone({ version: 1, projectId: opts.projectId, threadId: opts.threadId, searches, context })
    },
    restoreState(state) {
      validate(state)
      if ((state.context.memoryManagementVersion === 2) !== managed) throw new Error('context_checkpoint_invalid')
      const context = structuredClone(state.context)
      if ((state.context.stair !== undefined) !== (saved.context.stair !== undefined)) throw new Error('context_checkpoint_invalid')
      for (const key of ['historyIndex', 'recentWrites', 'recentSources', 'memoryManagementVersion', 'stair'] as const) delete session[key]
      Object.assign(session, context)
      searches = state.searches
    },
    history: {
      get remaining() { return opts.unlimitedWork ? Infinity : Math.max(0, 4 - searches) },
      ...(managed && opts.retrieval ? { read: (value: unknown) => opts.retrieval!.read(value) } : {}),
      async search(value: unknown) {
        if (++searches > 4 && !opts.unlimitedWork) return { status: 'budget_exhausted' }
        if (managed && opts.retrieval) return opts.retrieval.search(value)
        const v = value as { query?: unknown; before_seq?: unknown }
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['query', 'before_seq'].includes(k))
          || typeof v.query !== 'string' || v.query.length > 200
          || !(v.before_seq === null || (Number.isSafeInteger(v.before_seq) && Number(v.before_seq) > 0))) return { status: 'invalid' }
        if (!await opts.hasAccess()) return { status: 'denied' }
        try {
          const result = await opts.store.search(v.query, v.before_seq as number | null) as { projectId: string; threadId: string; messages: ContextMessage[]; truncated: boolean; nextBeforeSeq: number | null }
          if (result?.projectId !== opts.projectId || result.threadId !== opts.threadId || !Array.isArray(result.messages)
            || result.messages.length > 5 || !result.messages.every(validMessage)) return { status: 'unavailable' }
          if (!await opts.hasAccess()) return { status: 'denied' }
          return { status: result.messages.length ? 'ok' : 'empty', ...result, truth: 'conversation_only' }
        } catch (error) { rethrowContinuation(error); return { status: 'unavailable' } }
      },
    },
  }
  return session
}
