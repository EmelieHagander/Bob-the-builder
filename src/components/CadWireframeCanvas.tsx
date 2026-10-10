import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CadWireframe } from '../../supabase/functions/_shared/cad-wireframe.ts'
import type { ShellComponent } from '../lib/cadShell'
import { fitDistance, shellMatrix } from '../lib/shell3d'
import { createWireframeObjects, createWireframeOverview } from '../lib/wireframeObjects'
import './CadShell3D.css'

export function webglAvailable() {
  try {
    const context = document.createElement('canvas').getContext('webgl2')
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    return !!context
  } catch { return false }
}
type Props = { title: string; geometry: CadWireframe | null; components?: ShellComponent[]; selected?: ShellComponent; instanceId?: string; onFailure: (message: string) => void }
export default function CadWireframeCanvas({ title, geometry, components, selected, instanceId, onFailure }: Props) {
  const host = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null), fitRef = useRef(() => {})
  const [expanded, setExpanded] = useState(false)
  const [counts, setCounts] = useState({ segments: 0, drawCalls: 0 })
  useEffect(() => {
    const el = host.current
    if (!el) return
    const css = getComputedStyle(el)
    const ink = css.getPropertyValue('--ink').trim() || '#1a291e', warning = css.getPropertyValue('--clay').trim() || '#934418'
    let objects: ReturnType<typeof createWireframeObjects> | ReturnType<typeof createWireframeOverview>
    try { objects = geometry ? createWireframeObjects(geometry, ink, selected ? shellMatrix(selected) : undefined, instanceId) : createWireframeOverview(components ?? [], ink, warning) }
    catch (error) { onFailure(error instanceof Error ? error.message : 'Could not draw this saved version.'); return }
    if (!objects) { onFailure('No saved piece bounds are available for the 3D overview.'); return }
    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer({ antialias: true, powerPreference: 'low-power' }) }
    catch { objects.dispose(); onFailure('This device could not start 3D. The saved 2D drawings are still available.'); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.setClearColor(css.getPropertyValue('--canvas').trim() || '#f5f0df')
    const canvas = renderer.domElement; canvas.className = 'shell3d-canvas'; el.appendChild(canvas)
    const world = new Scene(); world.add(objects.group)
    const camera = new PerspectiveCamera(45, 1, 1, 1e8); camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, canvas)
    controls.screenSpacePanning = true; controls.listenToKeyEvents(el)
    let frame = 0, renders = 0, disposed = false
    const requestRender = () => {
      if (disposed || document.hidden || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (disposed || document.hidden) return
        renderer.render(world, camera)
        // Read-only diagnostics for idle/render/budget checks in browser QA.
        el.dataset.renders = String(++renders)
        el.dataset.drawCalls = String(renderer.info.render.calls)
        el.dataset.segments = String(objects!.segments)
      })
    }
    const fit = () => {
      const { center, distance, radius } = fitDistance(objects!.bounds, camera.fov, camera.aspect)
      const target = new Vector3(...center)
      camera.position.copy(target).addScaledVector(new Vector3(0.8, -1.2, 1.7).normalize(), distance)
      camera.near = Math.max(0.1, distance / 500); camera.far = distance + radius * 20
      camera.updateProjectionMatrix(); controls.target.copy(target); controls.maxDistance = distance * 8
      controls.update(); requestRender()
    }
    fitRef.current = fit
    const resize = () => {
      if (!el.clientWidth || !el.clientHeight) return
      renderer.setSize(el.clientWidth, el.clientHeight, false)
      camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); requestRender()
    }
    const observer = new ResizeObserver(resize); observer.observe(el); resize(); fit()
    setCounts({ segments: objects.segments, drawCalls: objects.drawCalls })
    controls.addEventListener('change', requestRender)
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0 } else requestRender() }
    document.addEventListener('visibilitychange', visibility)
    const lost = (event: Event) => { event.preventDefault(); onFailure('The device ran short of graphics memory. Close 3D and use the saved drawings, or open a smaller part.') }
    canvas.addEventListener('webglcontextlost', lost)
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect()
      document.removeEventListener('visibilitychange', visibility); canvas.removeEventListener('webglcontextlost', lost)
      controls.dispose(); objects!.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove()
      fitRef.current = () => {}
    }
  }, [geometry, components, selected, instanceId, expanded, onFailure])

  useEffect(() => {
    if (!expanded) return
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    root.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setExpanded(false) }
      if (event.key === 'Tab') {
        const nodes = [...(root.current?.querySelectorAll<HTMLElement>('button,[tabindex="0"]') ?? [])]
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      document.body.style.overflow = overflow; window.removeEventListener('keydown', key, true)
      if (previous?.isConnected && previous !== document.body) previous.focus()
      else root.current?.querySelector<HTMLButtonElement>('[data-fullscreen-toggle]')?.focus()
    }
  }, [expanded])

  const content = <div ref={root} className={expanded ? 'cad-wireframe-fullscreen' : 'shell3d'}
    role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label={expanded ? `${title} · 3D fullscreen` : undefined}>
    <div className="foundation-actions shell3d-controls">
      <button type="button" className="btn" onClick={() => fitRef.current()}>Fit view</button>
      <button type="button" className="btn" data-fullscreen-toggle onClick={() => setExpanded(v => !v)}>{expanded ? 'Close fullscreen' : 'Fullscreen'}</button>
      <span className="foundation-hint">Drag to turn · pinch to zoom · two fingers to move</span>
    </div>
    <div ref={host} className="shell3d-viewport" tabIndex={0} role="img" aria-label={`3D line view of ${title}`}
      data-budget-segments={counts.segments} data-budget-calls={counts.drawCalls} />
    <p className="foundation-hint">{geometry ? 'CAD edges · curved edges approximated for viewing. Saved dimensions remain on the drawing.' : 'Overview · saved bounding boxes only. Choose a piece to load its CAD edges.'}</p>
  </div>
  return expanded ? createPortal(content, document.body) : content
}
