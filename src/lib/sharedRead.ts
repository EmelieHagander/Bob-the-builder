/** Coalesce concurrent reads, never retain a settled result or an error. */
export function createSharedRead() {
  const pending = new Map<string, Promise<unknown>>()
  return {
    clear() { pending.clear() },
    run<T>(key: string, load: () => Promise<T>): Promise<T> {
      const existing = pending.get(key)
      if (existing) return existing as Promise<T>
      const request = Promise.resolve().then(load)
      pending.set(key, request)
      const remove = () => { if (pending.get(key) === request) pending.delete(key) }
      void request.then(remove, remove)
      return request
    },
  }
}
