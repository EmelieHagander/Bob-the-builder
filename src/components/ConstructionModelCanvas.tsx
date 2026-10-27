import { useEffect, useRef } from 'react'
import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import type { ConstructionModel, ConstructionView } from '../domain/constructionModel'
import { constructionModelObjects } from '../lib/constructionModelObjects'
import { fitDistance } from '../lib/shell3d'
import './CadShell3D.css'

const directions: Record<ConstructionView, [number, number, number]> = {
  overview:[0.8,-1.2,1], front:[0,-1,0], back:[0,1,0], left:[-1,0,0], right:[1,0,0], top:[0,0,1],
}

export default function ConstructionModelCanvas({ model, view, zoom, onRendered, onFailure }: {
  model: ConstructionModel; view: ConstructionView; zoom: number
  onRendered: () => void; onFailure: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const objects = constructionModelObjects(model)
    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer({ antialias:true, powerPreference:'low-power' }) }
    catch { objects.dispose(); onFailure(); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.setClearColor(getComputedStyle(el).getPropertyValue('--canvas').trim() || '#f5f0df')
    const canvas = renderer.domElement
    canvas.className = 'shell3d-canvas construction-model-canvas'
    canvas.setAttribute('aria-label', `Saved construction, ${view} view`)
    canvas.setAttribute('role', 'img')
    el.appendChild(canvas)
    const scene = new Scene(); scene.add(objects.group, new AmbientLight(0xffffff, 1.5))
    const light = new DirectionalLight(0xffffff, 2.5)
    const span = Math.max(...model.bounds.max.map((v,i)=>v-model.bounds.min[i]))
    light.position.set(span,-span,span*2); scene.add(light)
    const camera = new PerspectiveCamera(45, 1, 0.1, 1e8)
    camera.up.set(...(view === 'top' ? [0,1,0] : [0,0,1]) as [number,number,number])
    let frame = 0, disposed = false
    const draw = () => {
      if (disposed || document.hidden || !el.clientWidth || !el.clientHeight) return
      renderer.setSize(el.clientWidth, el.clientHeight, false)
      camera.aspect = el.clientWidth / el.clientHeight
      const fit = fitDistance(model.bounds, camera.fov, camera.aspect)
      const center = new Vector3(...fit.center)
      camera.position.copy(center).addScaledVector(new Vector3(...directions[view]).normalize(), fit.distance)
      camera.near = Math.max(0.1,fit.distance/1000); camera.far = fit.distance + fit.radius*20
      camera.zoom = zoom; camera.lookAt(center); camera.updateProjectionMatrix()
      try { renderer.render(scene,camera); el.dataset.instances=String(model.parts.length); onRendered() }
      catch { onFailure() }
    }
    const schedule = () => { if (!frame) frame=requestAnimationFrame(()=>{frame=0;draw()}) }
    const resize = new ResizeObserver(schedule); resize.observe(el)
    const lost = (event: Event) => { event.preventDefault(); onFailure() }
    canvas.addEventListener('webglcontextlost',lost)
    document.addEventListener('visibilitychange',schedule); schedule()
    return () => {
      disposed=true;cancelAnimationFrame(frame);resize.disconnect()
      document.removeEventListener('visibilitychange',schedule);canvas.removeEventListener('webglcontextlost',lost)
      objects.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove()
    }
  },[model,view,zoom,onRendered,onFailure])
  return <div ref={host} className="shell3d-viewport" />
}
