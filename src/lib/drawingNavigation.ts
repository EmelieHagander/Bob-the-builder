import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export type DrawingOrigin = {
  projectId: string; key: string; path: string; label: string; scrollY: number
  anchor: string; disclosures: { id: string; open: boolean }[]
}

/** Navigation context is never project authority or an arbitrary return URL. */
export function drawingOrigin(state: unknown, projectId: string): DrawingOrigin | null {
  const value = (state as { drawingOrigin?: DrawingOrigin } | null)?.drawingOrigin
  if (!value || value.projectId !== projectId || typeof value.key !== 'string'
    || typeof value.path !== 'string' || !/^\/(?:project|artifacts|tasks\/[^/?#]+|areas\/[^/?#]+)(?:\?[^#]*)?$/.test(value.path)
    || typeof value.label !== 'string' || typeof value.anchor !== 'string'
    || !Number.isFinite(value.scrollY) || value.scrollY < 0 || !Array.isArray(value.disclosures)
    || value.disclosures.some(item => !item || typeof item.id !== 'string' || typeof item.open !== 'boolean')) return null
  return value
}

export function useOpenDrawing(projectId: string, label: string) {
  const location = useLocation(), navigate = useNavigate()
  return (to: string, anchor: string) => {
    const origin: DrawingOrigin = { projectId, key: location.key, path: location.pathname + location.search,
      label, scrollY: window.scrollY, anchor,
      disclosures: [...document.querySelectorAll<HTMLDetailsElement>('.main-col details[id]')].map(item => ({ id: item.id, open: item.open })) }
    navigate(to, { state: { drawingOrigin: origin } })
  }
}

const positions = new Map<string, DrawingOrigin>()

/** Restore only a drawing's originating page, after its async work has rendered. */
export function useDrawingReturnPosition(projectId: string) {
  const location = useLocation()
  useEffect(() => {
    const origin = drawingOrigin(location.state, projectId)
    if (location.pathname === '/artifacts' && origin) {
      positions.set(`${projectId}:${origin.key}`, origin)
      if (positions.size > 20) positions.delete(positions.keys().next().value!)
    }
    const key = `${projectId}:${location.key}`, saved = positions.get(key)
    if (!saved || location.pathname + location.search !== saved.path) return
    let frame = 0, done = false
    const stop = () => {
      done = true; observer.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(timeout)
      window.removeEventListener('pointerdown', stop); window.removeEventListener('wheel', stop)
      positions.delete(key)
    }
    const restore = () => {
      if (done) return
      for (const item of saved.disclosures) {
        const element = document.getElementById(item.id)
        if (element instanceof HTMLDetailsElement && element.open !== item.open) element.open = item.open
      }
      const anchor = [...document.querySelectorAll<HTMLElement>('[data-drawing-return]')].find(item => item.dataset.drawingReturn === saved.anchor && item.getClientRects().length)
      if (!anchor) return
      // Wait for the restored disclosures' React content and page height too.
      if (document.documentElement.scrollHeight + 2 < saved.scrollY + window.innerHeight) return
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' })
      anchor.focus({ preventScroll: true })
      stop()
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore) }
    const observer = new MutationObserver(schedule)
    observer.observe(document.querySelector('.main-col') ?? document.body, { subtree: true, childList: true, attributes: true })
    const timeout = window.setTimeout(() => { if (!done) { window.scrollTo(0, saved.scrollY); stop() } }, 5000)
    window.addEventListener('pointerdown', stop, { once: true }); window.addEventListener('wheel', stop, { once: true })
    schedule()
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(timeout); window.removeEventListener('pointerdown', stop); window.removeEventListener('wheel', stop) }
  }, [projectId, location.key, location.pathname, location.search, location.state])
}
