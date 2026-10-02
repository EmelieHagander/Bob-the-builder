import type { ChatMessage } from './types'
import { isBobAnswerEvidence } from './bobEvidence'

export interface TranscriptRow {
  role: string; text: string; turn_id?: string; delivery_state: string
  seq: number; updated_at?: string; evidence?: unknown
}

/** Transcript visibility is independent of execution status. Event replies have
 * their own turn IDs and cannot settle an unrelated owner message. */
export function readBobTranscript(rows: TranscriptRow[], projectId: string, notices: Map<string, string>, now = Date.now()) {
  const messages: ChatMessage[] = []
  let latestSeq = 0
  let unfinished: { text: string; turnId: string; expiresAt: number; pending: boolean } | undefined
  let lastCompletedTurnId: string | undefined
  for (const row of rows) {
    if (row.role === 'user') {
      messages.push({ from: 'user', text: row.text, turnId: row.turn_id,
        deliveryState: row.delivery_state as ChatMessage['deliveryState'] })
      if (row.delivery_state === 'failed') latestSeq = Math.max(latestSeq, Number(row.seq) || 0)
      // A later owner message supersedes the older retry action, not its text.
      unfinished = undefined
      if (row.delivery_state !== 'completed' && row.turn_id) {
        const expiresAt = Date.parse(row.updated_at ?? '') + 5 * 60_000
        unfinished = { text: row.text, turnId: row.turn_id, expiresAt,
          pending: row.delivery_state === 'pending' && expiresAt > now }
      }
      const notice = row.turn_id && notices.get(row.turn_id)
      if (notice) messages.push({ from: 'bob', text: notice })
    } else if (row.role === 'assistant' && row.delivery_state === 'completed') {
      latestSeq = Math.max(latestSeq, Number(row.seq) || 0)
      lastCompletedTurnId = row.turn_id
      if (row.turn_id && unfinished?.turnId === row.turn_id) unfinished = undefined
      messages.push({ from: 'bob', text: row.text, turnId: row.turn_id,
        ...(isBobAnswerEvidence(row.evidence, projectId) ? { evidence: row.evidence } : {}) })
    }
  }
  return { messages, latestSeq, unfinished, lastCompletedTurnId }
}
