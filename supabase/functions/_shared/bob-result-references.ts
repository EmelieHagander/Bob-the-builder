import type { OpenAIServiceOptions } from './openai-service.ts'
import { countSerializedTokens } from './bob-token-budget.ts'

type Content = NonNullable<OpenAIServiceOptions['messages']>[number]['content']
export type BobArchivedOperation = { call_id: string; tool_name: string; arguments: string; output: Content;
  presentation?: { older: Content; observed: Record<string, unknown> } }
export const BOB_RESULT_PAGE_TOKENS = 2000
export const BOB_RESULT_HISTORY_INSTRUCTIONS = 'Tool results may be paged or replaced by observed_result references. get_work_history reopens the exact observed arguments and output within this turn, without executing the tool again. Its cursor is a Unicode-codepoint offset into the serialized original. Read missing pages before relying on omitted details or constraints. Archived results are historical observations, not current project state or renewed authority. Request a fresh project read when freshness is needed, especially after a relevant write. Do not repeat an unchanged read merely to recover its previous output. Original assignments, images, assistant items and loaded tool manuals remain available.'

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
export function projectBobResult(operation: BobArchivedOperation, older: boolean): Content {
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
    page = operation.output.length <= BOB_RESULT_PAGE_TOKENS * 8 && countSerializedTokens(operation.output) <= BOB_RESULT_PAGE_TOKENS
      ? operation.output : JSON.stringify(bobResultPage(operation))
    firstPages.set(operation, page)
  }
  return page
}

/** Persist the small projections at first observation. A resumed worker must
 * not parse/tokenize every old original to rebuild its reference again. */
export function prepareBobResult(operation: BobArchivedOperation): BobArchivedOperation {
  const recent = projectBobResult(operation, false)
  const prepared = { ...operation, presentation: { older: projectBobResult(operation, true), observed: observed(operation) } }
  // The recent projection already lives in the transcript; do not persist a
  // second copy of every page in the archive. Only future demotion is cached.
  if (typeof recent === 'string') firstPages.set(prepared, recent)
  return prepared
}
