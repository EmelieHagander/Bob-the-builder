/** Durable operation results, private to one authenticated turn. Replay rebuilds
 * the existing assistants' local state; it never sends a made-up user message. */
export class BobContinuation extends Error {
  constructor(readonly kind: 'yield' | 'stop', message = 'background_continue', readonly aiWait?: { id: string; accepted: boolean; role: string }, readonly operationKey?:string) { super(message) }
}
export function rethrowContinuation(error: unknown): void {
  if (error instanceof BobContinuation) throw error
}
export type JournalEntry = { key: string; fingerprint: string; value: unknown }
// Initial dispatch plus at most two retries of the same logical operation.
const MAX_OPERATION_RETRIES = 2
/** Dispatched calls whose provider outcome is unknown (connection lost, segment
 * wall). They may already be billed, so they are re-sent at most once and the
 * re-send is reported to the owner. A definite 429/5xx keeps two retries. */
const UNCERTAIN_RETRY_REASONS = new Set(['provider_uncertain', 'segment_wall'])
const MAX_UNCERTAIN_RETRIES = 1
/** attempt counts earlier dispatched retries of this exact operation (0 = first send). */
export type JournalIdentity = { key: string; fingerprint: string; attempt: number }
export interface JournalStore {
  entries: JournalEntry[]
  save(entry: JournalEntry): Promise<void>
}
export interface BobJournal {
  /** Reconstruct a completed operation from recorded steps only. The scope
   * must opt in after a fresh lifecycle check; it grants no new dispatch. */
  replayScope<T>(work: (requireRecorded: () => void) => Promise<T>): Promise<T>
  run<T>(stream: string, input: unknown, operation: (identity: JournalIdentity) => Promise<T>, reserveMs?: number): Promise<T>
  check(): void
  /** Milliseconds left in this worker's segment. */
  remaining(): number
  /** Re-sends after an unknown provider outcome, recorded across all segments. */
  uncertainResends(): number
  /** Model calls answered from an earlier failed attempt of this turn. */
  reusedModelCalls(): number
}
/** JSONB checkpoints reorder object keys. Return the same JSON representation
 * both before and after persistence, including nested structured model output.
 * Keep every field/value: only object order changes, never array order or truth.
 * Clone on delivery so a caller cannot mutate the journal's recorded result. */
export function stableJsonValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stableJsonValue) as T
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, v]) => [key, stableJsonValue(v)]),
  ) as T
  return value
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['timeoutMs', 'retrievedAt'].includes(key)).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => [key, canonical(v)]))
  // Lookup packets are also embedded in tool-message strings. Retrieval time
  // is metadata, not an input change; record versions and all facts still match.
  return typeof value === 'string' ? value.replace(/"retrievedAt":"[^"]*"/g, '"retrievedAt":"recorded"') : value
}
export async function fingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}
/** reusable: successful model results from an earlier failed attempt of the
 * same turn, keyed by exact input fingerprint. A match is recorded as this
 * job's own step without dispatching; anything else runs normally. */
export function createBobJournal(store: JournalStore, segmentDeadline: number, now = Date.now, reusable: ReadonlyMap<string, unknown> = new Map()): BobJournal {
  const entries = new Map(store.entries.map(e => [e.key, e]))
  const positions = new Map<string, number>()
  let stopped: BobContinuation | undefined
  const replayScopes: { recordedOnly: boolean }[] = []
  return {
    async replayScope<T>(work: (requireRecorded: () => void) => Promise<T>): Promise<T> {
      const scope = { recordedOnly: false }
      replayScopes.push(scope)
      try { return await work(() => { scope.recordedOnly = true }) }
      finally { replayScopes.pop() }
    },
    check() { if (stopped) throw stopped },
    remaining() { return Math.max(0, segmentDeadline - now()) },
    reusedModelCalls() {
      return [...entries.values()].filter(e => (e.value as { reused?: unknown } | null)?.reused === true).length
    },
    uncertainResends() {
      return [...entries.values()].filter(e => /:retry:\d+$/.test(e.key)
        && UNCERTAIN_RETRY_REASONS.has(String((e.value as { reason?: unknown } | null)?.reason))).length
    },
    async run<T>(stream: string, input: unknown, operation: (identity: JournalIdentity) => Promise<T>, reserveMs = 0): Promise<T> {
      if (stopped) throw stopped
      const position = positions.get(stream) ?? 0
      positions.set(stream, position + 1)
      const key = `${stream}:${position}`, hash = await fingerprint(input)
      const retries=[...entries.values()].filter(e=>e.key.startsWith(key+':retry:'))
      if(retries.some(e=>e.fingerprint!==hash)){
        stopped=new BobContinuation('stop','continuation_changed',undefined,key);throw stopped
      }
      const prior = entries.get(key)
      if (prior) {
        if (prior.fingerprint !== hash) {
          stopped = new BobContinuation('stop', 'continuation_changed',undefined,key); throw stopped
        }
        const outcome = prior.value as { ok: boolean; result?: T; error?: string }
        if (!outcome.ok) throw new Error(outcome.error ?? 'operation_failed')
        return stableJsonValue(outcome.result) as T
      }
      if (replayScopes.some(scope => scope.recordedOnly)) {
        stopped = new BobContinuation('stop', 'continuation_incomplete', undefined, key); throw stopped
      }
      if (reserveMs && now() + reserveMs + 8000 > segmentDeadline) {
        stopped = new BobContinuation('yield'); throw stopped
      }
      if (entries.size >= 512) { stopped = new BobContinuation('stop', 'continuation_limit'); throw stopped }
      if (stream === 'image:generate') {
        const marker = { key: key + ':started', fingerprint: hash, value: true }
        if (entries.has(marker.key)) { stopped = new BobContinuation('stop', 'image_outcome_unknown'); throw stopped }
        try { await store.save(marker) } catch { stopped = new BobContinuation('yield'); throw stopped }
        entries.set(marker.key, marker)
      }
      const earlier = stream.startsWith('model:') && !retries.length ? reusable.get(hash) as { ok?: unknown; result?: unknown } | undefined : undefined
      if (earlier?.ok === true) {
        const entry = { key, fingerprint: hash, value: { ok: true, result: earlier.result, reused: true } }
        try { await store.save(entry) }
        catch { stopped = new BobContinuation('yield', 'checkpoint_unavailable'); throw stopped }
        entries.set(key, entry)
        return stableJsonValue(earlier.result) as T
      }
      let value: T | undefined, failure: string | undefined
      try { value = await operation({ key, fingerprint: hash, attempt: retries.length }) }
      catch (error) {
        if(error instanceof BobContinuation&&error.kind==='yield'&&['provider_retry','provider_uncertain','segment_wall'].includes(error.message)){
          // A durable queue must not retry the same failing model call until
          // the twenty-minute turn expires. Keep the retry count with its
          // exact input, across workers, then return an honest failure. A
          // segment_wall happens AFTER dispatch and can cost money too.
          // Pre-dispatch yields and waiting on the same AI job are excluded.
          const uncertainSoFar=retries.filter(e=>UNCERTAIN_RETRY_REASONS.has(String((e.value as {reason?:unknown}|null)?.reason))).length
          const allowed=UNCERTAIN_RETRY_REASONS.has(error.message)?uncertainSoFar<MAX_UNCERTAIN_RETRIES:true
          if(allowed&&retries.length<MAX_OPERATION_RETRIES){
            const marker={key:key+':retry:'+(retries.length+1),fingerprint:hash,value:{reason:error.message}}
            try{await store.save(marker)}catch{stopped=new BobContinuation('yield','checkpoint_unavailable');throw stopped}
            entries.set(marker.key,marker);stopped=error;throw stopped
          }
          failure='provider_retry_exhausted'
        }else{
        if (error instanceof BobContinuation) stopped = error
        rethrowContinuation(error)
        if (stream === 'image:generate') throw error
        failure = error instanceof Error ? error.message.slice(0,500) : 'operation_failed'
        }
      }
      // Save before the caller can dispatch another operation. A lost response
      // at a domain-write boundary is reconciled by the existing SQL ledger.
      const entry = { key, fingerprint: hash, value: failure ? { ok: false, error: failure } : { ok: true, result: value === undefined ? null : value } }
      try { await store.save(entry) }
      catch { stopped = new BobContinuation('yield', 'checkpoint_unavailable'); throw stopped }
      entries.set(key, entry)
      if (failure) throw new Error(failure)
      return stableJsonValue(value) as T
    },
  }
}
