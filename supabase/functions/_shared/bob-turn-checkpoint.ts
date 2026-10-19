import { BobContinuation, stableJsonValue, validateBobJournalState } from './bob-job-journal.ts'
import type { BobJournal, BobJournalState } from './bob-job-journal.ts'

export type BobTurnCheckpointBinding = { jobId: string; turnId: string; catalogManifestId: string }
export type BobTurnCheckpoint = BobTurnCheckpointBinding & {
  version: 1
  revision: number
  state: Record<string, unknown>
  journalState: BobJournalState
}
export type BobTurnCheckpointWrite = {
  expectedRevision: number
  state: Record<string, unknown>
  journalState: BobJournalState
}
export interface BobTurnCheckpointStore {
  current(): BobTurnCheckpoint | null
  commit(state: Record<string, unknown>): Promise<BobTurnCheckpoint>
}

/** Runtime snapshots are private to the exact job, logical turn and immutable
 * catalog. A different contract must fail explicitly instead of replaying it. */
export function validateBobTurnCheckpoint(value: unknown, binding: BobTurnCheckpointBinding): BobTurnCheckpoint {
  const checkpoint = value as Partial<BobTurnCheckpoint> | null
  if (!checkpoint || checkpoint.version !== 1 || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision! < 1
    || checkpoint.jobId !== binding.jobId || checkpoint.turnId !== binding.turnId || checkpoint.catalogManifestId !== binding.catalogManifestId
    || !checkpoint.state || typeof checkpoint.state !== 'object' || Array.isArray(checkpoint.state)) throw new Error('invalid_turn_checkpoint')
  return { ...stableJsonValue(checkpoint as BobTurnCheckpoint), journalState: validateBobJournalState(checkpoint.journalState) }
}

export function createBobTurnCheckpoint(options: BobTurnCheckpointBinding & {
  checkpoint: unknown
  journal: BobJournal
  save(write: BobTurnCheckpointWrite): Promise<unknown>
}): BobTurnCheckpointStore {
  let current = options.checkpoint == null ? null : validateBobTurnCheckpoint(options.checkpoint, options)
  let saving = false
  return {
    current: () => current && stableJsonValue(current),
    async commit(state) {
      if (saving) throw new Error('checkpoint_commit_in_progress')
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid_turn_checkpoint')
      saving = true
      try {
        const expectedRevision = current?.revision ?? 0
        const nextState = stableJsonValue(state), journalState = options.journal.exportState()
        const same = (snapshot: BobTurnCheckpoint) => JSON.stringify(snapshot.state) === JSON.stringify(nextState)
          && JSON.stringify(stableJsonValue(snapshot.journalState)) === JSON.stringify(stableJsonValue(journalState))
        if (current && same(current)) return stableJsonValue(current)
        const saved = await options.save({ expectedRevision, state: nextState, journalState })
        const next = validateBobTurnCheckpoint(saved, options)
        if (next.revision !== expectedRevision + 1 && !(next.revision === expectedRevision && same(next))) throw new Error('invalid_checkpoint_revision')
        current = next
        return stableJsonValue(next)
      } catch (error) {
        if (error instanceof BobContinuation) throw error
        // A lost RPC response may already have committed. Start a new claim and
        // read its durable head; never continue with an uncertain local cursor.
        throw new BobContinuation('yield', 'checkpoint_unavailable')
      } finally { saving = false }
    },
  }
}
