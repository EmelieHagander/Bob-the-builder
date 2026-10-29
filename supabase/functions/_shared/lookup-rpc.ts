import { readWithStatementRetry } from './read-retry.ts'
import { LIMITS, type LookupInput, type LookupTransport } from './project-lookup.ts'

export type LookupRpcName = 'search_bob_project_data_v8' | 'search_bob_project_data_v9' | 'search_bob_project_data_v10'
export interface LookupPin { rpc: LookupRpcName; retry: boolean; timeoutMs: number }

/** Time for one statement-timeout retry: two attempts of up to 12 s each,
 * within the same 26 s allowance as other journaled reads. */
export const RETRY_LOOKUP_TIMEOUT_MS = 26_000

/** Lookup RPC and retry policy pinned per execution. A journal keeps what it
 * started with: no pin reads v8, roomDimensionsVersion reads v9, and
 * exactLookupVersion (2026-10-29) reads v10 with one statement-timeout retry. */
export function lookupPin(execution: { roomDimensionsVersion?: 1; exactLookupVersion?: 1 }): LookupPin {
  if (execution.exactLookupVersion === 1) {
    if (execution.roomDimensionsVersion !== 1) throw new Error('exact_lookup_version_invalid')
    return { rpc: 'search_bob_project_data_v10', retry: true, timeoutMs: RETRY_LOOKUP_TIMEOUT_MS }
  }
  return { rpc: execution.roomDimensionsVersion === 1 ? 'search_bob_project_data_v9' : 'search_bob_project_data_v8', retry: false, timeoutMs: LIMITS.timeoutMs }
}

export const lookupArgs = (projectId: string, input: LookupInput) => ({
  p_project_id: projectId, p_dataset: input.dataset, p_query: input.query,
  p_status: input.status, p_area_id: input.area_id, p_record_id: input.record_id, p_after_id: input.after_id ?? null,
})

type RpcResult = { data: unknown; error: { code?: string } | null }
type Memo = <T>(stream: string, input: unknown, work: () => Promise<T>, reserve: number, signal: AbortSignal) => Promise<T>

/** One journaled operation per lookup, under the same stream and input as
 * before. With a retry pin, a statement timeout (57014) is sent once more
 * inside that operation, so a resumed turn replays the recorded outcome. */
export function createLookupTransport(pin: () => LookupPin,
  rpc: (name: LookupRpcName, args: Record<string, unknown>, signal: AbortSignal) => PromiseLike<RpcResult>,
  memo: Memo): LookupTransport {
  return (projectId, input, signal) => {
    const { rpc: name, retry } = pin()
    const args = lookupArgs(projectId, input)
    return memo('rpc:' + name, args, async () => {
      const { data, error } = retry
        ? await readWithStatementRetry(name, attempt => rpc(name, args, attempt), signal)
        : await rpc(name, args, signal)
      return { data, error }
    }, 0, signal)
  }
}
