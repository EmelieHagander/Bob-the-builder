import type { ModelCall } from './project-answer.ts'
import { countContextTokens } from './bob-token-budget.ts'
import { rethrowContinuation } from './bob-job-journal.ts'
import { isProjectWriteReceipt } from '../../../src/data/bobEvidence.ts'
import { restoreWorkingContext, type ContextMessage, type ContextStore, type WorkingContextSession, type MemoryStair, type StairSummary,
  type StairMessage, type StairEvent, type RecentSource } from './bob-working-context.ts'
import type { MemoryRetrieval } from './bob-memory-retrieval.ts'
import type { ProjectWriteReceipt } from '../../../src/data/provenance.ts'

/** Owner decision 2026-10-30: the conversation part of Bob's prompt is a stair.
 * Summaries are written once with their exact message range and only appended;
 * the newest messages follow them unchanged. A chunk of older messages becomes a
 * level-2 summary when the raw messages pass a token budget; five level-2
 * summaries merge into one level-1, five level-0/1 summaries merge into one
 * level-0. Between those rare steps every turn only appends, so the previous
 * turn's prompt start is reused. Starting values from the 12 live threads
 * (median message 95 tokens, longest thread about 11,000 tokens); tune later. */
export const STAIR_LIMITS = { rawTokens: 4000, keepRecent: 4, chunkInputTokens: 12000, chunkTokens: 400, mergeTokens: 600, perLevel: 4, savesPerTurn: 4 } as const

export interface StairStore {
  stairLoad(): Promise<unknown>
  stairSave(level: number, seqFrom: number, seqTo: number, text: string, supersede: string[]): Promise<unknown>
}
export interface StairFrame extends MemoryStair {
  projectId: string; threadId: string; generation: number; summarizedThroughSeq: number; hasMore: boolean
  current: ContextMessage; recentWrites: ProjectWriteReceipt[]; recentSources: RecentSource[]
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const validSource = (v: unknown): v is RecentSource => object(v) && ['dataset', 'recordId', 'label'].every(k => typeof v[k] === 'string' && (v[k] as string).length > 0 && (v[k] as string).length <= 200)
export function validStairSummary(v: unknown): v is StairSummary {
  return object(v) && typeof v.id === 'string' && [0, 1, 2].includes(v.level as number) && Number.isSafeInteger(v.seqFrom) && Number(v.seqFrom) > 0
    && Number.isSafeInteger(v.seqTo) && Number(v.seqTo) >= Number(v.seqFrom) && typeof v.text === 'string' && v.text.trim().length > 0 && v.text.length <= 4000
}
export function validStairMessage(v: unknown): v is StairMessage {
  return object(v) && Number.isSafeInteger(v.seq) && Number(v.seq) > 0 && ['user', 'assistant'].includes(v.role as string)
    && typeof v.text === 'string' && v.text.length > 0 && v.text.length <= 200000 && ['pending', 'completed', 'failed'].includes(v.state as string)
    && typeof v.createdAt === 'string'
}
const validEvent = (v: unknown): v is StairEvent => object(v) && typeof v.at === 'string' && typeof v.kind === 'string' && JSON.stringify(v).length <= 2000

/** The stored stair is contiguous: summaries cover 1..n without gaps, raw messages follow. */
export function checkedStair(value: unknown): MemoryStair {
  if (!object(value) || !object(value.snapshot) || typeof value.snapshotLockedAt !== 'string'
    || !Array.isArray(value.summaries) || value.summaries.length > 16 || !value.summaries.every(validStairSummary)
    || !Array.isArray(value.raw) || value.raw.length > 200 || !value.raw.every(validStairMessage)
    || !Array.isArray(value.events) || value.events.length > 60 || !value.events.every(validEvent)) throw new Error('context_unavailable')
  let next = 1
  for (const s of value.summaries as StairSummary[]) { if (s.seqFrom !== next) throw new Error('context_unavailable'); next = s.seqTo + 1 }
  const raw = value.raw as StairMessage[]
  if (raw.some((m, i) => m.seq < next || (i > 0 && m.seq <= raw[i - 1].seq))) throw new Error('context_unavailable')
  return { snapshot: value.snapshot, snapshotLockedAt: value.snapshotLockedAt, summaries: value.summaries as StairSummary[], raw, events: value.events as StairEvent[] }
}

function frame(value: unknown, binding: { projectId: string; threadId: string; generation: number; message: string }): StairFrame {
  const v = value as StairFrame
  if (!object(v) || v.projectId !== binding.projectId || v.threadId !== binding.threadId || v.generation !== binding.generation
    || !Number.isSafeInteger(v.summarizedThroughSeq) || typeof v.hasMore !== 'boolean'
    || !object(v.current) || v.current.role !== 'user' || v.current.state !== 'pending' || v.current.text !== binding.message || !Number.isSafeInteger(v.current.seq)
    || !Array.isArray(v.recentWrites) || v.recentWrites.length > 16 || !v.recentWrites.every(r => isProjectWriteReceipt(r, binding.projectId))
    || !Array.isArray(v.recentSources) || v.recentSources.length > 24 || !v.recentSources.every(validSource)) throw new Error('context_unavailable')
  const stair = checkedStair(v)
  if ((stair.summaries.at(-1)?.seqTo ?? 0) !== v.summarizedThroughSeq || stair.raw.some(m => m.seq === v.current.seq)) throw new Error('context_unavailable')
  return { ...v, ...stair }
}

type Fold = { level: 0 | 1 | 2; seqFrom: number; seqTo: number; supersede: StairSummary[]; messages: StairMessage[] }
/** The one next step, or null when the stair is within its limits. */
export function nextStairFold(f: Pick<StairFrame, 'summaries' | 'raw' | 'hasMore'>, limits = STAIR_LIMITS): Fold | null {
  const upper = f.summaries.filter(s => s.level < 2), chunks = f.summaries.filter(s => s.level === 2)
  if (upper.length > limits.perLevel) return { level: 0, seqFrom: upper[0].seqFrom, seqTo: upper.at(-1)!.seqTo, supersede: upper, messages: [] }
  if (chunks.length > limits.perLevel) return { level: 1, seqFrom: chunks[0].seqFrom, seqTo: chunks.at(-1)!.seqTo, supersede: chunks, messages: [] }
  const tokens = f.raw.reduce((sum, m) => sum + countContextTokens(m.text), 0)
  if (!f.raw.length || !f.hasMore && (f.raw.length <= limits.keepRecent || tokens <= limits.rawTokens)) return null
  // Everything but the newest few, bounded per call; the rest follows in later steps.
  // With unread messages after these, all loaded ones are older than the newest.
  const older = f.hasMore ? f.raw : f.raw.slice(0, f.raw.length - limits.keepRecent), messages: StairMessage[] = []
  let used = 0
  for (const m of older) { const t = countContextTokens(m.text); if (messages.length && used + t > limits.chunkInputTokens) break; messages.push(m); used += t }
  return { level: 2, seqFrom: messages[0].seq, seqTo: messages.at(-1)!.seq, supersede: [], messages }
}

/** A summary that cannot be written never stops the answer: the range stays readable at its source. */
export function degradedStairText(fold: Fold): string {
  if (fold.level === 2) return `Meddelanden ${fold.seqFrom}–${fold.seqTo} är inte sammanfattade. Läs dem i källan.`
  const joined = fold.supersede.map(s => `(${s.seqFrom}–${s.seqTo}) ${s.text}`).join('\n')
  return joined.length <= 3000 ? joined : Array.from(joined).slice(0, 2999).join('') + '…'
}

export async function prepareMemoryStair(opts: {
  projectId: string; userId: string; threadId: string; generation: number; message: string;
  store: ContextStore & StairStore; callModel: ModelCall; hasAccess: () => Promise<boolean>; deadline: number; unlimitedWork?: boolean;
  retrieval?: MemoryRetrieval; limits?: typeof STAIR_LIMITS;
}): Promise<WorkingContextSession> {
  const limits = opts.limits ?? STAIR_LIMITS
  const load = async (value?: unknown) => {
    if (!await opts.hasAccess()) throw new Error('project_denied')
    return frame(value ?? await opts.store.stairLoad(), opts)
  }
  let f = await load()
  for (let saves = 0; opts.unlimitedWork || saves < limits.savesPerTurn; saves++) {
    const fold = nextStairFold(f, limits)
    if (!fold) break
    const budget = fold.level === 2 ? limits.chunkTokens : limits.mergeTokens
    const firstAt = fold.messages[0]?.createdAt, lastAt = fold.messages.at(-1)?.createdAt
    const input = fold.level === 2
      ? { task: 'chunk', budget_tokens: budget, messages: fold.messages.map(({ seq, role, state, text }) => ({ seq, role, state, text })),
        events: f.events.filter(e => firstAt !== undefined && lastAt !== undefined && e.at >= firstAt && e.at <= lastAt) }
      : { task: 'merge', budget_tokens: budget, summaries: fold.supersede.map(({ seqFrom, seqTo, text }) => ({ seqFrom, seqTo, text })) }
    let text: string | undefined, feedback: Record<string, unknown> | undefined
    for (let attempt = 0; attempt < 2 && text === undefined; attempt++) {
      if (Date.now() + 5000 >= opts.deadline) throw new Error('context_preparing')
      const response = await opts.callModel({
        app: 'bob', coworkerId: 'bob', functionName: 'memory-stair', aiFunction: 'memory-stair', module: 'global', userId: opts.userId,
        catalogRoleKey: 'memory-stair', catalogSchemaKey: 'bob_memory_stair', schemaName: 'bob_memory_stair',
        messages: [{ role: 'user', content: JSON.stringify({ ...input, ...(feedback ? { validationFeedback: feedback } : {}) }) }],
        maxOutputTokens: 2000, timeoutMs: Math.min(30000, opts.deadline - Date.now()),
      })
      if (!response.success || response.toolCalls?.length) {
        if (response.error === 'turn_budget_exhausted') throw new Error('turn_budget_exhausted')
        continue
      }
      let data: unknown = response.data
      try { if (typeof data === 'string') data = JSON.parse(data) } catch { data = null }
      const summary = object(data) && typeof data.summary === 'string' ? data.summary.trim() : ''
      if (summary && summary.length <= 3000 && countContextTokens(summary) <= budget * 1.5) text = summary
      else feedback = { reason: summary ? 'too_long' : 'empty', budget_tokens: budget }
    }
    if (text === undefined) {
      text = degradedStairText(fold)
      console.warn('[Bob memory]', JSON.stringify({ stair: 'degraded', level: fold.level, from: fold.seqFrom, to: fold.seqTo }))
    }
    if (!await opts.hasAccess()) throw new Error('project_denied')
    f = await load(await opts.store.stairSave(fold.level, fold.seqFrom, fold.seqTo, text, fold.supersede.map(s => s.id)))
  }
  // Unread older messages remain: the next turn continues the stair before answering.
  if (f.hasMore) throw new Error('context_preparing')
  if (opts.retrieval) await opts.retrieval.index()
  return restoreWorkingContext({ version: 1, projectId: opts.projectId, threadId: opts.threadId, searches: 0,
    context: { summary: '', throughSeq: f.summarizedThroughSeq, recent: [f.current], recentWrites: f.recentWrites, recentSources: f.recentSources,
      memoryManagementVersion: 2, stair: { snapshot: f.snapshot, snapshotLockedAt: f.snapshotLockedAt, summaries: f.summaries, raw: f.raw, events: f.events } },
  }, opts)
}

/** Checkpoint each stair operation. A save that committed just before a lost
 * acknowledgement is recognised by its exact range and text. */
export function journalStairStore<T extends StairStore>(store: T, memo: <R>(stream: string, input: unknown, work: () => Promise<R>) => Promise<R>): StairStore {
  return {
    stairLoad: () => memo('context:stair_load', {}, () => store.stairLoad()),
    stairSave: (level, seqFrom, seqTo, text, supersede) => memo('context:stair_save', { level, seqFrom, seqTo, text, supersede }, async () => {
      try { return await store.stairSave(level, seqFrom, seqTo, text, supersede) }
      catch (error) {
        rethrowContinuation(error)
        const current = await store.stairLoad() as { summaries?: StairSummary[] }
        if (current?.summaries?.some(s => s.level === level && s.seqFrom === seqFrom && s.seqTo === seqTo && s.text === text.trim())) return current
        throw error
      }
    }),
  }
}
