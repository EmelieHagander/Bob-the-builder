import type { ChatMessage } from './types'
import type { TranscriptRow } from './bobTranscript'

export const BOB_HISTORY_PAGE_SIZE = 5
export interface BobHistoryPage {
  threadId?: string
  messages: ChatMessage[]
  oldestSeq?: number
  hasMore?: boolean
}

/** One look-ahead row establishes the cursor without a full history/count read. */
export function readHistoryWindow(input: TranscriptRow[], size = BOB_HISTORY_PAGE_SIZE) {
  const descending = [...input].sort((a, b) => b.seq - a.seq)
  const rows = descending.slice(0, size).reverse()
  return { rows, oldestSeq: rows[0]?.seq, hasMore: descending.length > size }
}

/** Refresh the tail while retaining older pages the reader explicitly opened. */
export function refreshHistoryPage(current: BobHistoryPage, latest: BobHistoryPage): BobHistoryPage {
  if (!latest.threadId || current.threadId !== latest.threadId || latest.oldestSeq === undefined) return latest
  const earlier = current.messages.filter(m => m.seq !== undefined && m.seq < latest.oldestSeq!)
  return { ...latest, messages: [...earlier, ...latest.messages],
    oldestSeq: earlier.length ? current.oldestSeq : latest.oldestSeq,
    hasMore: earlier.length ? current.hasMore : latest.hasMore }
}

export function prependHistoryPage(current: BobHistoryPage, older: BobHistoryPage): BobHistoryPage {
  if (!current.threadId || older.threadId !== current.threadId) return current
  const earlier = older.messages.filter(m => m.seq !== undefined && (current.oldestSeq === undefined || m.seq < current.oldestSeq))
  return { ...current, messages: [...earlier, ...current.messages],
    oldestSeq: older.oldestSeq ?? current.oldestSeq, hasMore: older.hasMore }
}
