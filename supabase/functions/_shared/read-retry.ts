/** A read the database cancelled at the authenticated statement timeout
 * (SQLSTATE 57014) is retried once with its own time allowance. Reads only:
 * on 2026-10-20/21 single construction reads took 0.2-8 s depending on shared
 * database load, and one cancelled read stopped a whole CAD render. */
export const READ_ATTEMPT_MS = 12000

/** Content-free diagnostics: never log RPC arguments, error messages or user data. */
export async function readWithStatementRetry<T extends { error: { code?: string } | null }>(
  name: string, call: (signal: AbortSignal) => PromiseLike<T>, outer?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now()
    const each = AbortSignal.timeout(READ_ATTEMPT_MS)
    try {
      const result = await call(outer ? AbortSignal.any([outer, each]) : each)
      const code = result.error?.code ?? null
      if (code || attempt > 1) console.error('[Read outcome]', JSON.stringify({
        rpc: name, attempt, elapsed_ms: Date.now() - started,
        code: typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : 'other',
        retry: code === '57014' && attempt < 2 && !outer?.aborted,
        outer_aborted: !!outer?.aborted,
      }))
      if (code === '57014' && attempt < 2 && !outer?.aborted) continue
      return result
    } catch (error) {
      console.error('[Read outcome]', JSON.stringify({
        rpc: name, attempt, elapsed_ms: Date.now() - started,
        code: 'thrown', kind: error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout' : error instanceof Error && error.name === 'AbortError' ? 'abort' : 'exception',
        outer_aborted: !!outer?.aborted,
      }))
      throw error
    }
  }
}
