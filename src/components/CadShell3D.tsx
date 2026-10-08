import { useEffect, useMemo, useRef, useState } from 'react'
import { AmbientLight, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as db from '../data/database'
import type { CadShell, ShellComponent } from '../lib/cadShell'
import { buildShellScene, fitDistance, type ShellPiece3D, type ShellScene3D } from '../lib/shell3d'
import { createShellObjects } from '../lib/shell3dObjects'
import './CadShell3D.css'

const FLAG_LABEL: Record<ShellComponent['status'], string> = {
  current: '',
  newer_revision: 'Newer version saved · dashed outline',
  changed: 'Piece changed · dashed outline',
  archived: 'Piece archived · dashed outline',
  unavailable: '',
}
function pieceNote(p: ShellPiece3D) {
  if (p.state === 'unavailable') return 'Not drawn: this piece is unavailable'
  if (p.state === 'no_recipe') return 'Not drawn: no saved 3D recipe for this version'
  if (p.state === 'invalid_recipe') return 'Not drawn: its saved recipe cannot be read'
  return [`${p.primitives} ${p.primitives === 1 ? 'part' : 'parts'}`, FLAG_LABEL[p.status], p.simplified ? 'holes and tube bores not shown' : ''].filter(Boolean).join(' · ')
}

export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch { return false }
}

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; scene: ShellScene3D }

/** Browser-composed 3D view of a whole shell drawing. Loaded lazily with three.js. */
export default function CadShell3D({ value, projectId, onFallback }: {
  value: CadShell
  projectId: string
  onFallback: (message: string) => void
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const fitRef = useRef<() => void>(() => {})
  const pins = useMemo(() => value.components.filter(c => c.status !== 'unavailable').map(c => ({ id: c.child_artifact_id, revision: c.child_revision })), [value])

  useEffect(() => {
    if (!webglAvailable()) {
      onFallback('This browser or device cannot draw 3D here (WebGL is off or unavailable). Showing the plan view instead.')
      return
    }
    let live = true
    setLoad({ state: 'loading' })
    db.getCadShellPieceRecipes(projectId, pins).then(recipes => {
      if (!live) return
      const scene = buildShellScene(value.components.map(component => ({ component, recipe: recipes.get(`${component.child_artifact_id}:${component.child_revision}`) })))
      setLoad({ state: 'ready', scene })
    }).catch(() => { if (live) setLoad({ state: 'failed' }) })
    return () => { live = false }
  }, [projectId, pins, value, attempt, onFallback])

  const scene = load.state === 'ready' ? load.scene : null
  useEffect(() => {
    const el = host.current
    if (!scene || !scene.bounds || !el) return
    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer({ antialias: window.devicePixelRatio < 2, powerPreference: 'low-power' }) }
    catch { onFallback('This device could not start the 3D view. Showing the plan view instead.'); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0xf5f0df)
    const canvas = renderer.domElement
    canvas.className = 'shell3d-canvas'
    el.appendChild(canvas)
    const world = new Scene()
    const objects = createShellObjects(scene)
    world.add(objects.group)
    world.add(new HemisphereLight(0xffffff, 0x8a8370, 1.6), new AmbientLight(0xffffff, 0.35))
    const sun = new DirectionalLight(0xffffff, 1.6)
    sun.position.set(0.6, -0.9, 1.4)
    world.add(sun)
    const camera = new PerspectiveCamera(45, 1, 10, 1e6)
    camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, canvas)
    controls.listenToKeyEvents(el)
    controls.screenSpacePanning = true
    let frame = 0
    const render = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderer.render(world, camera) }) }
    const fit = () => {
      const { center, distance, radius } = fitDistance(scene.bounds!, camera.fov, camera.aspect)
      const target = new Vector3(...center)
      const dir = camera.position.clone().sub(controls.target)
      if (dir.lengthSq() < 1e-6) dir.set(0.8, -1.2, 1.7) // first view: from the south-east and above, so rooms show their contents
      camera.position.copy(target).addScaledVector(dir.normalize(), distance)
      camera.near = Math.max(1, distance / 200); camera.far = distance + radius * 20
      camera.updateProjectionMatrix()
      controls.target.copy(target)
      controls.maxDistance = distance * 6
      controls.update()
      render()
    }
    fitRef.current = fit
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()
    fit()
    controls.addEventListener('change', render)
    const lost = (e: Event) => { e.preventDefault(); onFallback('The 3D view stopped because the device ran short of graphics memory. Showing the plan view instead.') }
    canvas.addEventListener('webglcontextlost', lost)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      controls.dispose()
      objects.dispose()
      renderer.dispose()
      canvas.remove()
      fitRef.current = () => {}
    }
  }, [scene, onFallback])

  const total = value.components.length
  if (load.state === 'loading') return <p role="status" className="foundation-hint">Loading {total} {total === 1 ? 'piece' : 'pieces'} for the 3D view…</p>
  if (load.state === 'failed') return <div role="alert" className="solution-attention">
    <p style={{ margin: 0 }}>Could not load the pieces for the 3D view. Nothing was changed.</p>
    <div className="foundation-actions" style={{ marginTop: 8 }}>
      <button type="button" className="btn" onClick={() => setAttempt(n => n + 1)}>Try again</button>
      <button type="button" className="btn" onClick={() => onFallback('')}>Show plan view</button>
    </div>
  </div>
  const drawn = load.scene.pieces.filter(p => p.state === 'drawn').length
  return <div className="shell3d" aria-label="3D view">
    {drawn < total && <p role="status" className="solution-attention">{drawn === 0
      ? 'No piece could be drawn in 3D. The list below says why for each piece.'
      : `${drawn} of ${total} pieces are drawn. The list below says why the others are missing.`}</p>}
    {load.scene.bounds && <>
      <div className="foundation-actions shell3d-controls">
        <button type="button" className="btn" onClick={() => fitRef.current()}>Fit all</button>
        <span className="foundation-hint">Drag to turn · pinch or scroll to zoom · two fingers or right-drag to move</span>
      </div>
      <div ref={host} className="shell3d-viewport" tabIndex={0} role="img"
        aria-label={`3D view of ${value.title}: ${drawn} ${drawn === 1 ? 'piece' : 'pieces'}, ${load.scene.primitives} parts`} />
    </>}
    <ul className="shell3d-legend" aria-label="3D legend">
      {load.scene.pieces.map(p => <li key={p.key} data-state={p.state}>
        <span className="shell3d-swatch" aria-hidden="true" style={{ background: p.state === 'drawn' ? p.color : 'transparent' }} data-flagged={p.flagged || undefined} />
        <span><strong>{p.title}</strong> · version {p.revision}<br /><span className="foundation-hint">{pieceNote(p)}</span></span>
      </li>)}
    </ul>
  </div>
}
