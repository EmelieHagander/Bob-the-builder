/** Durable operation results, private to one authenticated turn. Replay rebuilds
 * the existing assistants' local state; it never sends a made-up user message. */
export class BobContinuation extends Error {
  constructor(readonly kind: 'yield' | 'stop', message = 'background_continue') { super(message) }
}
export function rethrowContinuation(error: unknown): void {
  if (error instanceof BobContinuation) throw error
}
export type JournalEntry = { key: string; fingerprint: string; value: unknown }
export interface JournalStore {
  entries: JournalEntry[]
  save(entry: JournalEntry): Promise<void>
}
export interface BobJournal {
  run<T>(stream: string, input: unknown, operation: () => Promise<T>, reserveMs?: number): Promise<T>
  check(): void
}
/** JSONB checkpoints reorder object keys. Return the same JSON representation
 * both before and after persistence, including nested structured model output.
 * Keep every field/value: only object order changes, never array order or truth.
 * Clone on delivery so a caller cannot mutate the journal's recorded result. */
function stableResult<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stableResult) as T
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, v]) => [key, stableResult(v)]),
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
export function createBobJournal(store: JournalStore, segmentDeadline: number, now = Date.now): BobJournal {
  const entries = new Map(store.entries.map(e => [e.key, e]))
  const positions = new Map<string, number>()
  let stopped: BobContinuation | undefined
  return {
    check() { if (stopped) throw stopped },
    async run<T>(stream: string, input: unknown, operation: () => Promise<T>, reserveMs = 0): Promise<T> {
      if (stopped) throw stopped
      const position = positions.get(stream) ?? 0
      positions.set(stream, position + 1)
      const key = `${stream}:${position}`, hash = await fingerprint(input)
      const prior = entries.get(key)
      if (prior) {
        if (prior.fingerprint !== hash) {
          stopped = new BobContinuation('stop', 'continuation_changed'); throw stopped
        }
        const outcome = prior.value as { ok: boolean; result?: T; error?: string }
        if (!outcome.ok) throw new Error(outcome.error ?? 'operation_failed')
        return stableResult(outcome.result) as T
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
      let value: T | undefined, failure: string | undefined
      try { value = await operation() }
      catch (error) {
        rethrowContinuation(error)
        if (stream === 'image:generate') throw error
        failure = error instanceof Error ? error.message.slice(0,500) : 'operation_failed'
      }
      // Save before the caller can dispatch another operation. A lost response
      // at a domain-write boundary is reconciled by the existing SQL ledger.
      const entry = { key, fingerprint: hash, value: failure ? { ok: false, error: failure } : { ok: true, result: value === undefined ? null : value } }
      try { await store.save(entry) }
      catch { stopped = new BobContinuation('yield', 'checkpoint_unavailable'); throw stopped }
      entries.set(key, entry)
      if (failure) throw new Error(failure)
      return stableResult(value) as T
    },
  }
}
