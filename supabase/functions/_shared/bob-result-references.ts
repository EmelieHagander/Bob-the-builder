import type { OpenAIServiceOptions } from './openai-service.ts'
import { countContextTokens, countSerializedTokens } from './bob-token-budget.ts'

type Content = NonNullable<OpenAIServiceOptions['messages']>[number]['content']
export type BobArchivedOperation = { call_id: string; tool_name: string; arguments: string; output: Content;
  presentation?: { older: Content; observed: Record<string, unknown> } }
/** First page of a large result. Sized above CONSTRUCTION_VIEW_TOKENS (2000)
 * plus the arguments/escaping envelope so that one whole construction view
 * page stays literal: at 2000 every view page was cut again here and Bob
 * paid one or two get_work_history steps per read (96 pages on 2026-10-20). */
export const BOB_RESULT_PAGE_TOKENS = 3000
/** Construction view pages are already bounded by their own pager (up to
 * CONSTRUCTION_VIEW_MAX_TOKENS, 6000, for jobs pinning constructionPageVersion).
 * A pinned allowance is measured on the text the model receives, so a whole
 * page plus its execution envelope stays literal instead of costing
 * get_work_history steps. Other tools keep BOB_RESULT_PAGE_TOKENS. */
export const BOB_CONSTRUCTION_RESULT_TOKENS = 8000
/** Recent results kept whole across exchanges before older ones become references. */
export const BOB_RESULT_WINDOW_TOKENS = 20000
/** Window version 2: when the whole older results exceed the ceiling, keep
 * them down to this share of it, so the transcript prefix changes in fewer,
 * larger steps instead of one demotion per request (prompt cache). */
export const BOB_RESULT_WINDOW_TARGET_SHARE = 0.75

const sources = new WeakMap<BobArchivedOperation, string[]>()
const firstPages = new WeakMap<BobArchivedOperation, string>()
const summaries = new WeakMap<BobArchivedOperation, Record<string, unknown>>()
function observed(operation: BobArchivedOperation): Record<string, unknown> {
  if (operation.presentation) return operation.presentation.observed
  let summary = summaries.get(operation)
  if (summary) return summary
  summary = { call_id: operation.call_id, tool_name: operation.tool_name }
  let value: unknown = operation.output
  try { if (typeof value === 'string') value = JSON.parse(value) } catch { /* exact unparsed original remains retrievable */ }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['status', 'saved', 'revision', 'version']) {
      const field = (value as Record<string, unknown>)[key]
      if (typeof field === 'boolean' || typeof field === 'number' && Number.isFinite(field)
        || typeof field === 'string' && field.length <= 180) summary[key] = field
    }
  }
  summaries.set(operation, summary)
  return summary
}

/** Every offset refers to the immutable JSON original, not a fresh project
 * read. Budget the serialized envelope, including JSON escaping and cursors. */
export function bobResultPage(operation: BobArchivedOperation, after = 0): Record<string, unknown> {
  let chars = sources.get(operation)
  if (!chars) sources.set(operation, chars = Array.from(JSON.stringify({ arguments: operation.arguments, output: operation.output })))
  if (!Number.isSafeInteger(after) || after < 0 || after > chars.length) throw new Error('context_cursor_invalid')
  const envelope = (end: number) => ({ status: 'ok', observed_result: observed(operation),
    content: chars!.slice(after, end).join(''), after, next_after: end < chars!.length ? end : null,
    truncated: end < chars!.length,
    reopen: { tool: 'get_work_history', arguments: { call_id: operation.call_id, after: end < chars!.length ? end : null } } })
  // Bound the tokenization work too; a very compressible page may be smaller
  // than the allowance. Binary search needs only a fitting prefix, not a
  // monotonic tokenizer or an encode of the entire remaining source.
  let low = after, high = Math.min(chars.length, after + BOB_RESULT_PAGE_TOKENS * 8)
  if (countSerializedTokens(JSON.stringify(envelope(low))) > BOB_RESULT_PAGE_TOKENS) throw new Error('context_page_unavailable')
  while (low < high) {
    const end = Math.ceil((low + high) / 2)
    if (countSerializedTokens(JSON.stringify(envelope(end))) <= BOB_RESULT_PAGE_TOKENS) low = end
    else high = end - 1
  }
  if (low === after && after < chars.length) throw new Error('context_page_unavailable')
  return envelope(low)
}

/** Projection never overwrites the archived original. Keep images literal;
 * their capacity is checked by the native request estimator. Old successful
 * read bodies become references; writes, checks and errors keep their bounded
 * first page, so receipts and repair feedback do not disappear with age. */
export function projectBobResult(operation: BobArchivedOperation, older: boolean, literalTokens?: number): Content {
  if (operation.presentation && older) return operation.presentation.older
  if (typeof operation.output !== 'string') return operation.output
  const summary = observed(operation)
  const read = /^(read_|search_|list_|open_|get_work_history$)/.test(operation.tool_name)
  if (older && read && (summary.status === undefined || summary.status === 'ok' || summary.status === 'success') && summary.saved !== true) {
    return JSON.stringify({ observed_result: summary, content_omitted: true,
      reopen: { tool: 'get_work_history', arguments: { call_id: operation.call_id, after: null } } })
  }
  let page = firstPages.get(operation)
  if (page === undefined) {
    // Default: the original escaped count, unchanged for older jobs and other
    // tools. A pinned per-tool allowance counts what the model receives; one
    // more escape level would cut quote-dense pages the pager already bounded.
    const limit = literalTokens ?? BOB_RESULT_PAGE_TOKENS
    const size = literalTokens === undefined ? countSerializedTokens(operation.output) : countContextTokens(operation.output)
    page = operation.output.length <= limit * 8 && size <= limit ? operation.output : JSON.stringify(bobResultPage(operation))
    firstPages.set(operation, page)
  }
  return page
}

const READ_TOOL = /^(read_|search_|list_|open_|get_work_history$)/
const DISCOVERY_TOOL = /^(search_|list_|open_|get_work_history$)/
/** Fields that name a version of the same record rather than another record. */
const VERSION_FIELDS = new Set(['revision', 'expected_revision', 'target_revision', 'construction_revision'])
const sortedJson = (value: unknown): unknown => Array.isArray(value) ? value.map(sortedJson)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJson((value as Record<string, unknown>)[key])])) : value

/** The record a read result shows: same read tool and the same arguments,
 * where a revision field counts as the same record and a page cursor does
 * not. Writes, checks and unparseable calls have no key and are never
 * superseded. */
export function bobResultRecordKey(operation: Pick<BobArchivedOperation, 'tool_name' | 'arguments'>): string | null {
  if (!READ_TOOL.test(operation.tool_name)) return null
  let value: unknown
  try { value = JSON.parse(operation.arguments) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = Object.fromEntries(Object.entries(value).filter(([key]) => !VERSION_FIELDS.has(key)))
  return operation.tool_name + '\u0000' + JSON.stringify(sortedJson(record))
}

export interface BobWindowResult { call_id: string; tool_name: string; arguments: string; tokens: number }
/** Window version 2 (owner decision 2026-10-29: Bob gets what he needs when
 * he needs it). Input is every tool result in transcript order; `older` marks
 * those beyond the always-whole last two exchanges. While the older results
 * fit the same ceiling as version 1, nothing changes, so the cached prompt
 * prefix stays valid. Above it, an older read repeated later (superseded)
 * leaves first; the rest are kept down to the target share, state reads,
 * writes and checks before discovery searches, newest first within each
 * group. Pure: the same transcript gives the same window on every resumed
 * worker. `supersededBy` names only demoted superseded reads. */
export function selectBobResultWindow(results: (BobWindowResult & { older: boolean })[], ceiling: number,
  target = Math.floor(ceiling * BOB_RESULT_WINDOW_TARGET_SHARE)): { whole: Set<string>; supersededBy: Map<string, string> } {
  const older = results.filter(result => result.older)
  if (older.reduce((sum, result) => sum + result.tokens, 0) <= ceiling)
    return { whole: new Set(older.map(result => result.call_id)), supersededBy: new Map() }
  const supersededBy = new Map<string, string>(), latest = new Map<string, string>()
  for (let i = results.length - 1; i >= 0; i--) {
    const key = bobResultRecordKey(results[i])
    if (key === null) continue
    const newer = latest.get(key)
    if (newer === undefined) latest.set(key, results[i].call_id)
    else if (results[i].older) supersededBy.set(results[i].call_id, newer)
  }
  const candidates = older.filter(result => !supersededBy.has(result.call_id))
  const whole = new Set<string>()
  let used = 0
  for (const discovery of [false, true]) for (let i = candidates.length - 1; i >= 0; i--) {
    const result = candidates[i]
    if (DISCOVERY_TOOL.test(result.tool_name) !== discovery || used + result.tokens > target) continue
    used += result.tokens; whole.add(result.call_id)
  }
  return { whole, supersededBy }
}

/** An older read whose record was read again later. The newer result is in
 * the transcript; the exact original stays recoverable. */
export function supersededBobResult(operation: BobArchivedOperation, newer: string): string {
  return JSON.stringify({ observed_result: observed(operation), content_omitted: true, superseded_by: newer,
    reopen: { tool: 'get_work_history', arguments: { call_id: operation.call_id, after: null } } })
}

/** Persist the small projections at first observation. A resumed worker must
 * not parse/tokenize every old original to rebuild its reference again. */
export function prepareBobResult(operation: BobArchivedOperation, literalTokens?: number): BobArchivedOperation {
  const recent = projectBobResult(operation, false, literalTokens)
  const prepared = { ...operation, presentation: { older: projectBobResult(operation, true, literalTokens), observed: observed(operation) } }
  // The recent projection already lives in the transcript; do not persist a
  // second copy of every page in the archive. Only future demotion is cached.
  if (typeof recent === 'string') firstPages.set(prepared, recent)
  return prepared
}
