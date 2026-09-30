import { useLayoutEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import type { BobScreenPointer } from '../domain/bobScreen'

export interface BobSurfaceSnapshot { pointer: BobScreenPointer; label: string }

/** Navigation hints only. Names in the local label never cross the AI boundary. */
export function createBobSurfaceStore() {
  const entries = new Map<symbol, { projectId: string; route: string; value: BobSurfaceSnapshot; priority: number; order: number }>()
  const listeners = new Set<() => void>()
  let revision = 0
  const changed = () => { revision++; listeners.forEach(listener => listener()) }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    version: () => revision,
    publish(projectId: string, route: string, value: BobSurfaceSnapshot, priority = 1) {
      const token = Symbol('surface')
      entries.set(token, { projectId, route, value: { pointer: Object.freeze({ ...value.pointer }), label: value.label }, priority, order: revision })
      changed()
      // A delayed cleanup can remove only its own publication, never a newer page.
      return () => { if (entries.delete(token)) changed() }
    },
    read(projectId: string, route: string): BobSurfaceSnapshot | null {
      const match = [...entries.values()].filter(entry => entry.projectId === projectId && entry.route === route)
        .sort((a, b) => b.priority - a.priority || b.order - a.order)[0]
      return match?.value ?? null
    },
  }
}

const store = createBobSurfaceStore()
export const BOB_OPEN_EVENT = 'bob:open-current-view'
export const openBobForCurrentSurface = () => window.dispatchEvent(new Event(BOB_OPEN_EVENT))
const browserRoute = () => typeof window === 'undefined' ? '' : window.location.hash.slice(1) || '/'
export const getBobSurface = (projectId: string) => store.read(projectId, browserRoute())?.pointer ?? null

export function useBobSurface(projectId: string, pointer: BobScreenPointer | null, label: string, priority = 1) {
  const location = useLocation()
  const route = location.pathname + location.search
  const serialized = pointer ? JSON.stringify(pointer) : ''
  useLayoutEffect(() => {
    if (!projectId || !serialized) return
    return store.publish(projectId, route, { pointer: JSON.parse(serialized) as BobScreenPointer, label }, priority)
  }, [projectId, route, serialized, label, priority])
}

export function useBobSurfaceSnapshot(projectId: string) {
  const location = useLocation()
  useSyncExternalStore(store.subscribe, store.version, store.version)
  return store.read(projectId, location.pathname + location.search)
}
