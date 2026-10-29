import { readWithStatementRetry } from './read-retry.ts'
import { LIMITS, type LookupInput, type LookupTransport } from './project-lookup.ts'

export type LookupRpcName = 'search_bob_project_data_v8' | 'search_bob_project_data_v9' | 'search_bob_project_data_v10'
export interface LookupPin { rpc: LookupRpcName; retry: boolean; timeoutMs: number; reuse: boolean }

/** A reused read is at most this old (2026-10-29). */
export const READ_REUSE_MAX_AGE_MS = 120_000

/** Identical project reads within one turn (lookupReuseVersion 1). A paid
 * drawing turn on 2026-10-29 sent 26 lookups, mostly the same project,
 * measurements, physical and target reads repeated by review evidence, image
 * grounding and each design attempt. A successful result is reused for an
 * identical read until this turn writes anything or the result is older than
 * READ_REUSE_MAX_AGE_MS. Access is still re-checked by every caller. Reuse
 * happens inside the journaled operation, so journal positions, fingerprints
 * and replay never depend on it; a resumed worker simply starts empty. */
export interface LookupReuse {
  get(key: string): { data: unknown; observedAt: string } | undefined
  set(key: string, data: unknown): void
  /** Called around every write of this turn. */
  invalidate(): void
  readonly stats: { hits: number; misses: number }
}
export function createLookupReuse(now: () => number = Date.now, maxAgeMs = READ_REUSE_MAX_AGE_MS): LookupReuse {
  const entries = new Map<string, { data: unknown; at: number }>()
  const stats = { hits: 0, misses: 0 }
  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry || now() - entry.at > maxAgeMs) { entries.delete(key); stats.misses++; return undefined }
      stats.hits++
      return { data: structuredClone(entry.data), observedAt: new Date(entry.at).toISOString() }
    },
    set(key, data) { entries.set(key, { data: structuredClone(data), at: now() }) },
    invalidate() { entries.clear() },
    stats,
  }
}

/** Time for one statement-timeout retry: two attempts of up to 12 s each,
 * within the same 26 s allowance as other journaled reads. */
export const RETRY_LOOKUP_TIMEOUT_MS = 26_000

/** Lookup RPC and retry policy pinned per execution. A journal keeps what it
 * started with: no pin reads v8, roomDimensionsVersion reads v9, and
 * exactLookupVersion (2026-10-29) reads v10 with one statement-timeout retry.
 * lookupReuseVersion (2026-10-29) adds in-turn reuse of identical reads. */
export function lookupPin(execution: { roomDimensionsVersion?: 1; exactLookupVersion?: 1; lookupReuseVersion?: 1 }): LookupPin {
  if (execution.lookupReuseVersion !== undefined && (execution.lookupReuseVersion !== 1 || execution.exactLookupVersion !== 1)) throw new Error('lookup_reuse_version_invalid')
  if (execution.exactLookupVersion === 1) {
    if (execution.roomDimensionsVersion !== 1) throw new Error('exact_lookup_version_invalid')
    return { rpc: 'search_bob_project_data_v10', retry: true, timeoutMs: RETRY_LOOKUP_TIMEOUT_MS, reuse: execution.lookupReuseVersion === 1 }
  }
  return { rpc: execution.roomDimensionsVersion === 1 ? 'search_bob_project_data_v9' : 'search_bob_project_data_v8', retry: false, timeoutMs: LIMITS.timeoutMs, reuse: false }
}

export const lookupArgs = (projectId: string, input: LookupInput) => ({
  p_project_id: projectId, p_dataset: input.dataset, p_query: input.query,
  p_status: input.status, p_area_id: input.area_id, p_record_id: input.record_id, p_after_id: input.after_id ?? null,
})

type RpcResult = { data: unknown; error: { code?: string } | null }
type Memo = <T>(stream: string, input: unknown, work: () => Promise<T>, reserve: number, signal: AbortSignal) => Promise<T>

/** One journaled operation per lookup, under the same stream and input as
 * before. With a retry pin, a statement timeout (57014) is sent once more
 * inside that operation, so a resumed turn replays the recorded outcome. With
 * a reuse pin an identical earlier result is recorded instead of a new RPC,
 * carrying its original observation time. Errors are never reused. */
export function createLookupTransport(pin: () => LookupPin,
  rpc: (name: LookupRpcName, args: Record<string, unknown>, signal: AbortSignal) => PromiseLike<RpcResult>,
  memo: Memo, reuse?: LookupReuse): LookupTransport {
  return (projectId, input, signal) => {
    const { rpc: name, retry, reuse: reusePinned } = pin()
    const args = lookupArgs(projectId, input)
    const cache = reusePinned ? reuse : undefined
    return memo('rpc:' + name, args, async () => {
      const key = name + '\u0000' + JSON.stringify(args)
      const reused = cache?.get(key)
      if (reused) return { data: reused.data, error: null, observedAt: reused.observedAt }
      const { data, error } = retry
        ? await readWithStatementRetry(name, attempt => rpc(name, args, attempt), signal)
        : await rpc(name, args, signal)
      if (cache && !error) cache.set(key, data)
      return { data, error }
    }, 0, signal)
  }
}
