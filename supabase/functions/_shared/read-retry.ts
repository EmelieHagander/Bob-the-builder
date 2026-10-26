/** A call the database cancelled at the authenticated statement timeout
 * (SQLSTATE 57014) is retried once with its own time allowance.
 *
 * Reads: on 2026-10-20/21 single construction reads took 0.2-8 s depending on
 * shared database load, and one cancelled read stopped a whole CAD render.
 *
 * Writes: a statement the database cancelled rolled back its whole
 * transaction, so nothing was saved and the same call can be sent again; the
 * writer's receipt ledger keeps an exact replay idempotent. On 2026-10-22 and
 * 2026-10-26 a reviewed drawing save was cancelled at 8 s and the drawing was
 * lost, while the same save took 1.35 s on replay. A thrown error (lost
 * response, client timeout) is never retried: its outcome is unknown. */
export const READ_ATTEMPT_MS = 12000

export type StatementRetryOptions = {
  /** Log label: [Read outcome] or [Write outcome]. */
  label?: 'Read' | 'Write'
  /** Also log successful calls at least this slow, so slow saves show up. */
  slowMs?: number
}

/** Content-free diagnostics: never log RPC arguments, error messages or user data. */
export async function withStatementRetry<T extends { error: { code?: string } | null }>(
  name: string, call: (signal: AbortSignal) => PromiseLike<T>, outer?: AbortSignal,
  options: StatementRetryOptions = {}): Promise<T> {
  const tag = `[${options.label ?? 'Read'} outcome]`
  for (let attempt = 1; ; attempt++) {
    const started = Date.now()
    const each = AbortSignal.timeout(READ_ATTEMPT_MS)
    try {
      const result = await call(outer ? AbortSignal.any([outer, each]) : each)
      const code = result.error?.code ?? null
      const elapsed = Date.now() - started
      const retry = code === '57014' && attempt < 2 && !outer?.aborted
      if (code || attempt > 1 || (options.slowMs !== undefined && elapsed >= options.slowMs)) console.error(tag, JSON.stringify({
        rpc: name, attempt, elapsed_ms: elapsed,
        code: code === null ? 'ok' : typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : 'other',
        retry, outer_aborted: !!outer?.aborted,
      }))
      if (retry) continue
      return result
    } catch (error) {
      console.error(tag, JSON.stringify({
        rpc: name, attempt, elapsed_ms: Date.now() - started,
        code: 'thrown', kind: error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout' : error instanceof Error && error.name === 'AbortError' ? 'abort' : 'exception',
        outer_aborted: !!outer?.aborted,
      }))
      throw error
    }
  }
}

export const readWithStatementRetry = <T extends { error: { code?: string } | null }>(
  name: string, call: (signal: AbortSignal) => PromiseLike<T>, outer?: AbortSignal): Promise<T> =>
  withStatementRetry(name, call, outer)
