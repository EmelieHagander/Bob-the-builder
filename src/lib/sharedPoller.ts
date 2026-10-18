export type PollReason = 'poll' | 'refresh'

/** One visible-tab poll loop per resource, regardless of subscriber count. */
export function createSharedPoller<T>(load: () => Promise<T>, event: string, intervalMs = 10_000) {
  const listeners = new Set<(value: T, reason: PollReason) => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false, queued = false, generation = 0
  const poll = async (reason: PollReason = 'poll') => {
    if (!listeners.size || document.visibilityState === 'hidden') return
    if (running) { if (reason === 'refresh') queued = true; return }
    clearTimeout(timer)
    running = true
    const captured = generation
    try {
      const value = await load()
      if (captured === generation) for (const listener of listeners) listener(value, reason)
    } catch { /* Keep the last displayed state until the next authorized read. */ }
    finally {
      running = false
      if (listeners.size) {
        const again = queued; queued = false
        timer = setTimeout(() => void poll(again ? 'refresh' : 'poll'), again ? 0 : intervalMs)
      }
    }
  }
  const refresh = () => { void poll('refresh') }
  const reconnect = () => { void poll('poll') }
  return (listener: (value: T, reason: PollReason) => void) => {
    listeners.add(listener)
    if (listeners.size === 1) {
      window.addEventListener(event, refresh)
      window.addEventListener('focus', reconnect)
      document.addEventListener('visibilitychange', reconnect)
      void poll()
    }
    return () => {
      listeners.delete(listener)
      if (!listeners.size) {
        generation++; queued = false; clearTimeout(timer)
        window.removeEventListener(event, refresh)
        window.removeEventListener('focus', reconnect)
        document.removeEventListener('visibilitychange', reconnect)
      }
    }
  }
}
