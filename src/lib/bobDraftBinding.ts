import type { BobScreenPointer } from '../domain/bobScreen'

/** A reply started on a shown model keeps that identity while the UI changes.
 * An unbound draft must not acquire a presentation from a late callback. */
export function createBobDraftBinding() {
  let captured: { project: string; screen: BobScreenPointer | null } | null = null
  return {
    start(project: string, screen: BobScreenPointer | null) {
      if (!captured) captured = { project, screen: screen?.presentationId ? { ...screen } : null }
    },
    restore(project: string, screen: BobScreenPointer | null | undefined) { captured = { project, screen: screen ? { ...screen } : null } },
    clear() { captured = null },
    read(project: string, current: BobScreenPointer | null): BobScreenPointer | null {
      if (!captured) return current
      if (captured.project !== project) return null
      if (captured.screen) return { ...captured.screen }
      if (!current) return null
      const { presentationId: _presentation, ...navigation } = current
      return navigation
    },
  }
}
