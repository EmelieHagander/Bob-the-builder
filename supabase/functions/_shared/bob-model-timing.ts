/** Claude streams inside the Edge worker; it has no durable provider job to
 * poll after a yield. Leave time for the response and its journal receipt.
 *
 * A 140-second segment also fits Supabase's 150-second free-tier wall clock.
 * Pre-dispatch yields cost no provider retries; interrupted streams retain the
 * existing bounded, potentially billed retry semantics.
 */
export const CLAUDE_BACKGROUND_TIMEOUT_MS = 120_000
export const CLAUDE_MIN_REQUEST_WINDOW_MS = 90_000
export const CLAUDE_JOURNAL_SLACK_MS = 8_000

export function claudeJournalReserveMs(requestedTimeoutMs: number): number {
  return Math.min(requestedTimeoutMs, CLAUDE_MIN_REQUEST_WINDOW_MS)
}

/** Recheck after pre-dispatch context work, which may consume segment time. */
export function claudeDispatchWindow(requestedTimeoutMs: number, remainingMs: number): { ready: boolean; timeoutMs: number } {
  return {
    ready: remainingMs >= claudeJournalReserveMs(requestedTimeoutMs) + CLAUDE_JOURNAL_SLACK_MS,
    timeoutMs: Math.max(1_000, Math.min(requestedTimeoutMs, remainingMs - CLAUDE_JOURNAL_SLACK_MS)),
  }
}
