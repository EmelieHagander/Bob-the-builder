import { parseBobScreen, type BobScreenPointer } from '../domain/bobScreen'
import type { ChatMessage } from '../data/types'
import { parseBobImageIds } from '../domain/bobImages'

export type OutgoingTurn = { text: string; turnId: string; screen?: BobScreenPointer | null; imageIds?: string[]; threadId: string | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** One attempted message, private to this tab/account/project. Never auto-send
 * restored text. The server transcript remains the acknowledgement authority. */
export function readOutgoing(raw: string | null): OutgoingTurn | null {
  try {
    const v = JSON.parse(raw ?? 'null')
    if (!v || typeof v.text !== 'string' || !v.text.trim() || v.text.length > 4096 || !uuid.test(v.turnId)
      || (v.threadId !== null && (typeof v.threadId !== 'string' || !uuid.test(v.threadId)))) return null
    return { text: v.text, turnId: v.turnId, threadId: v.threadId, screen: parseBobScreen(v.screen), ...(v.imageIds !== undefined ? { imageIds: parseBobImageIds(v.imageIds) } : {}) }
  } catch { return null }
}

export function reconcileOutgoing(outgoing: OutgoingTurn | null, threadId: string | undefined, messages: ChatMessage[]) {
  if (!outgoing) return null
  // A reset/replacement thread must not resurrect the prior thread's message.
  if (outgoing.threadId && outgoing.threadId !== (threadId ?? null)) return null
  return messages.some(m => m.from === 'user' && m.turnId === outgoing.turnId) ? null : outgoing
}
