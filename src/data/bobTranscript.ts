import type { ChatMessage } from './types'
import { isBobAnswerEvidence } from './bobEvidence'

export interface TranscriptRow {
  role: string; text: string; turn_id?: string; delivery_state: string
  seq: number; updated_at?: string; evidence?: unknown
}

export type DrawingTurnRecovery = { status: 'completed'; requestIds: string[] }
  | { status: 'queued' | 'running'; requestIds: string[]; expiresAt: number; progress?: unknown }

/** The authenticated status RPC, rather than answer prose or unrelated receipts,
 * establishes whether this exact originating turn's drawing work recovered. */
export function readDrawingTurnRecovery(value: unknown, now = Date.now()): DrawingTurnRecovery | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const recovery = value as Record<string, unknown>
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (recovery.scope !== 'drawing' || !Array.isArray(recovery.requestIds) || !recovery.requestIds.length
    || !recovery.requestIds.every(id => typeof id === 'string' && uuid.test(id))) return undefined
  if (recovery.status === 'completed') return { status: 'completed', requestIds: recovery.requestIds }
  if (recovery.status !== 'queued' && recovery.status !== 'running') return undefined
  const expiresAt = typeof recovery.expiresAt === 'string' ? Date.parse(recovery.expiresAt) : NaN
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return undefined
  return { status: recovery.status, requestIds: recovery.requestIds, expiresAt, progress: recovery.progress }
}

export function reconcileDrawingTurnRecovery(transcript: ReturnType<typeof readBobTranscript>, turnId: string, recovery: DrawingTurnRecovery | undefined, recoveredBudgetStop = false) {
  if (!recovery || transcript.unfinished?.turnId !== turnId) return transcript
  const completed = recovery.status === 'completed'
  return { ...transcript,
    messages: transcript.messages.map(message => message.from === 'user' && message.turnId === turnId
      ? { ...message, deliveryRecovery: completed ? 'completed' as const : 'pending' as const } : message),
    unfinished: completed ? recoveredBudgetStop ? undefined : transcript.unfinished
      : { ...transcript.unfinished, pending: true, expiresAt: recovery.expiresAt },
  }
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
