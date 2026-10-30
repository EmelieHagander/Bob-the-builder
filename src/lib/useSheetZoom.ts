import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

export const SHEET_ZOOM_MAX = 4
const clamp = (zoom: number) => Math.min(SHEET_ZOOM_MAX, Math.max(1, zoom))
type Anchor = { x: number; y: number; cx: number; cy: number }

/**
 * Zoom and pan for a drawing inside a scrolling `box-drawing-viewport`.
 * Pinch, and Ctrl/⌘ + wheel (also a trackpad pinch), zoom around the fingers or
 * pointer; a mouse drag pans; one-finger drag keeps the browser's own scrolling.
 * A plain wheel still scrolls the page, so tall drawings never trap scrolling.
 */
export function useSheetZoom() {
  const viewport = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [panning, setPanning] = useState(false)
  const target = useRef(1), rendered = useRef(1), anchor = useRef<Anchor | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)

  /** The drawing point under (x, y) in the viewport, at the zoom now on screen. */
  const pointAt = (el: HTMLElement, x: number, y: number) =>
    ({ cx: (el.scrollLeft + x) / rendered.current, cy: (el.scrollTop + y) / rendered.current })
  const zoomTo = useCallback((next: number, at?: { clientX: number; clientY: number }, fixed?: { cx: number; cy: number }) => {
    const el = viewport.current, zoomed = clamp(next)
    if (el) {
      const box = el.getBoundingClientRect()
      const x = at ? at.clientX - box.left : el.clientWidth / 2, y = at ? at.clientY - box.top : el.clientHeight / 2
      const point = fixed ?? (anchor.current ? { cx: anchor.current.cx, cy: anchor.current.cy } : pointAt(el, x, y))
      anchor.current = { x, y, ...point }
    }
    target.current = zoomed
    setZoom(zoomed)
  }, [])

  useLayoutEffect(() => {
    const el = viewport.current, held = anchor.current
    rendered.current = zoom
    if (!el || !held) return
    el.scrollLeft = held.cx * zoom - held.x
    el.scrollTop = held.cy * zoom - held.y
    anchor.current = null
  }, [zoom])

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    let pinch: { distance: number; zoom: number; cx: number; cy: number } | null = null
    const middle = (t: TouchList) => ({ clientX: (t[0].clientX + t[1].clientX) / 2, clientY: (t[0].clientY + t[1].clientY) / 2 })
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      const box = el.getBoundingClientRect(), mid = middle(e.touches)
      pinch = { distance: distance(e.touches) || 1, zoom: target.current, ...pointAt(el, mid.clientX - box.left, mid.clientY - box.top) }
    }
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      zoomTo(pinch.zoom * distance(e.touches) / pinch.distance, middle(e.touches), { cx: pinch.cx, cy: pinch.cy })
    }
    const end = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo(target.current * Math.exp(-e.deltaY * 0.01), e)
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      el.removeEventListener('wheel', wheel)
    }
  }, [zoomTo])

  const stopDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    setPanning(false)
  }
  const pan = {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      const el = e.currentTarget, box = el.getBoundingClientRect()
      // Mouse only: touch keeps native scrolling, and a press on a scrollbar keeps working.
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.clientX - box.left > el.clientWidth || e.clientY - box.top > el.clientHeight) return
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
      el.setPointerCapture?.(e.pointerId)
      setPanning(true)
      e.preventDefault()
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const held = drag.current
      if (!held || held.id !== e.pointerId) return
      e.currentTarget.scrollLeft = held.left - (e.clientX - held.x)
      e.currentTarget.scrollTop = held.top - (e.clientY - held.y)
    },
    onPointerUp: stopDrag,
    onPointerCancel: stopDrag,
  }
  return { viewport, zoom, panning, pan, zoomBy: (step: number) => zoomTo(target.current + step), reset: () => zoomTo(1) }
}
