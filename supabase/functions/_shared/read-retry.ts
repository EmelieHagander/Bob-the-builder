/** A read the database cancelled at the authenticated statement timeout
 * (SQLSTATE 57014) is retried once with its own time allowance. Reads only:
 * on 2026-10-20/21 single construction reads took 0.2-8 s depending on shared
 * database load, and one cancelled read stopped a whole CAD render. */
export const READ_ATTEMPT_MS = 12000

export async function readWithStatementRetry<T extends { error: { code?: string } | null }>(
  name: string, call: (signal: AbortSignal) => PromiseLike<T>, outer?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const each = AbortSignal.timeout(READ_ATTEMPT_MS)
    const result = await call(outer ? AbortSignal.any([outer, each]) : each)
    if (result.error?.code === '57014' && attempt < 2 && !outer?.aborted) {
      console.error('[Read retry]', JSON.stringify({ rpc: name, reason: 'statement_timeout' }))
      continue
    }
    return result
  }
}
