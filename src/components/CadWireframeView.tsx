import { useCallback, useEffect, useState } from 'react'
import * as db from '../data/database'
import type { CadWireframe } from '../../supabase/functions/_shared/cad-wireframe.ts'
import type { ShellComponent } from '../lib/cadShell'
import { inputStyle } from './form'
import CadWireframeCanvas, { webglAvailable } from './CadWireframeCanvas'

type Load = { key: string; state: 'idle' | 'loading' } | { key: string; state: 'failed'; message: string; retry: boolean } | { key: string; state: 'ready'; geometry: CadWireframe }
const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new Error('The view was closed or timed out.')) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 2000)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
})
export default function CadWireframeView({ projectId, title, artifactId, revision, components, onFallback }: {
  projectId: string; title: string; artifactId?: string; revision?: number; components?: ShellComponent[]; onFallback: (message: string) => void
}) {
  const [selectedKey, setSelectedKey] = useState(''), [instanceId, setInstanceId] = useState('')
  const [load, setLoad] = useState<Load>({ key: '', state: 'idle' }), [attempt, setAttempt] = useState(0), [renderError, setRenderError] = useState('')
  const selected = components?.find(c => c.component_key === selectedKey)
  const id = components ? selected?.child_artifact_id : artifactId, version = components ? selected?.child_revision : revision
  const key = `${projectId}:${id ?? ''}:${version ?? ''}`
  const activeLoad: Load = load.key === key ? load : { key, state: 'idle' }
  const failure = useCallback((message: string) => setRenderError(message), [])
  useEffect(() => {
    setSelectedKey(''); setInstanceId(''); setAttempt(0); setRenderError(''); setLoad({ key: '', state: 'idle' })
  }, [projectId, artifactId, revision, components])
  useEffect(() => {
    if (!webglAvailable()) { onFallback('This browser or device cannot draw 3D here (WebGL is off or unavailable). Showing the saved drawing instead.'); return }
    setRenderError(''); setInstanceId('')
    if (!id || !version) { setLoad({ key, state: 'idle' }); return }
    let live = true
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 65000)
    setLoad({ key, state: 'loading' })
    ;(async () => {
      for (let poll = 0; poll < 30; poll++) {
        const result = await db.getCadWireframe(projectId, id, version, controller.signal, attempt > 0 && poll === 0)
        if (!live) return
        if (result.status === 'ready') { setLoad({ key, state: 'ready', geometry: result.geometry }); return }
        if (result.status === 'failed') { setLoad({ key, state: 'failed', message: 'Could not prepare this saved 3D view. The drawing and STEP file are still available.', retry: result.retry_allowed }); return }
        await wait(controller.signal)
      }
      throw new Error('This 3D view is still being prepared. Close and reopen it to check the saved result.')
    })().catch(error => { if (live) setLoad({ key, state: 'failed', message: error instanceof Error ? error.message : 'Could not load the 3D view.', retry: true }) })
      .finally(() => clearTimeout(timeout))
    return () => { live = false; clearTimeout(timeout); controller.abort() }
  }, [projectId, id, version, key, attempt, onFallback])
  const choose = (key: string) => { setSelectedKey(key); setAttempt(0); setInstanceId(''); setRenderError('') }
  const geometry = activeLoad.state === 'ready' ? activeLoad.geometry : null
  return <section className="cad-wireframe" aria-label="Interactive CAD line view">
    {components && <label className="ui-field">
      <span className="ui-field-label">Detail to load</span>
      <select style={inputStyle} value={selectedKey} onChange={e => choose(e.target.value)}>
        <option value="">Whole drawing · overview</option>
        {components.map(c => <option key={c.component_key} value={c.component_key} disabled={c.status === 'unavailable'}>{c.child_title ?? c.component_key} · version {c.child_revision}{c.status === 'current' ? '' : ' · changed'}</option>)}
      </select>
    </label>}
    {selected && <p className="foundation-hint">Viewing {selected.child_title ?? selected.component_key} · saved version {selected.child_revision}.{selected.status !== 'current' ? ' This piece has changed; the view keeps the pinned version.' : ''}</p>}
    {activeLoad.state === 'loading' && <p role="status" className="foundation-hint">Preparing the saved 3D view… The first opening may take longer; later openings reuse the export.</p>}
    {activeLoad.state === 'failed' && <div role="alert" className="solution-attention"><p>{activeLoad.message}</p>
      {activeLoad.retry && <button type="button" className="btn" onClick={() => setAttempt(n => n + 1)}>Try again</button>}
      {!activeLoad.retry && <p>Preparation stopped after three attempts for this version.</p>}
    </div>}
    {geometry && <label className="ui-field"><span className="ui-field-label">Parts to show</span>
      <select style={inputStyle} value={instanceId} onChange={e => { setInstanceId(e.target.value); setRenderError('') }}>
        <option value="">All parts in this piece</option>
        {geometry.instances.map(i => <option key={i.id} value={i.id}>{i.id}</option>)}
      </select></label>}
    {renderError && <p role="alert" className="solution-attention">{renderError}</p>}
    {!renderError && (!id || geometry) && <CadWireframeCanvas title={selected?.child_title ?? title} geometry={geometry} components={id ? undefined : components}
      selected={selected} instanceId={instanceId} onFailure={failure} />}
  </section>
}
