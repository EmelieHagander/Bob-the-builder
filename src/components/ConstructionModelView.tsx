import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as db from '../data/database'
import type { ArtifactVersion } from '../data/artifacts'
import { constructionModel, CONSTRUCTION_VIEWS, type ConstructionModel, type ConstructionView } from '../domain/constructionModel'
import { ModelFeedbackContext } from './ModelFeedbackContext'
import { Loading, LoadFailed, useAsync } from './ui'
import './CadShell3D.css'

function CanvasUnavailable({ onFailure }: { onFailure: () => void }) {
  useEffect(onFailure, [onFailure])
  return <></>
}

/** One mounted stage owns one source and named view. A late render callback
 * cannot attach evidence to a different camera or construction revision. */
function ModelStage({ model, value, view, zoom, reload }: {
  model: ConstructionModel; value: ArtifactVersion; view: ConstructionView; zoom: number; reload: () => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(false), [failed, setFailed] = useState(false)
  const ready = useCallback(() => setRendered(true), [])
  const fail = useCallback(() => { setRendered(false); setFailed(true) }, [])
  const Canvas = useMemo(() => lazy(() => import('./ConstructionModelCanvas').catch(() => ({ default: CanvasUnavailable }))), [])
  return <>
    <div ref={viewport}>
      {failed ? <LoadFailed what="The 3D view" onRetry={reload} /> : <Suspense fallback={<Loading label="Loading the 3D view…" />}>
        <Canvas model={model} view={view} zoom={zoom} onRendered={ready} onFailure={fail} />
      </Suspense>}
    </div>
    {rendered && !failed && <ModelFeedbackContext projectId={value.projectId} solutionId={value.solutionId} revision={value.solutionRevision}
      construction={{ id: value.id, revision: value.revision }} viewId={view} areaId={value.areaId ?? null} viewport={viewport} enabled />}
  </>
}

/** Reopens the existing Construction source, not a generated illustration. */
export function ConstructionModelView({ value }: { value: ArtifactVersion }) {
  const [attempt, retry] = useState(0), [view, setView] = useState<ConstructionView>('overview'), [zoom, setZoom] = useState(1)
  const { data, loading, error } = useAsync(async () => {
    const source = await db.getBuildConstructionSource(value.projectId, value.id, value.revision)
    if (source.draft.solution_id !== value.solutionId || source.draft.solution_revision !== value.solutionRevision
      || source.draft.area_id !== (value.areaId ?? null)) throw new Error('construction_source_changed')
    return constructionModel(source)
  }, [value.projectId, value.id, value.revision, value.solutionId, value.solutionRevision, attempt], { timeoutMs: 20000 })
  const reload = () => retry(n => n + 1)
  const model = !loading && !error && data?.status === 'ready' ? data.model : null
  const materials = model ? [...new Map(model.parts.map(part => [part.materialId + '@' + part.materialRevision, part])).values()] : []
  return <section className="shell3d" aria-label="Construction model">
    <h4>Saved construction in 3D</h4>
    <p className="foundation-hint">Construction version {value.revision}. Views keep the same saved parts and positions. Technical checks and final drawings remain separate.</p>
    {loading ? <Loading label="Reading the saved construction…" /> : error ? <LoadFailed what="The saved construction" onRetry={reload} />
      : data && data.status !== 'ready' ? <div role="status"><p>{data.message}</p><button className="btn" onClick={reload}>Reload model</button></div> : null}
    {model && <>
      <div className="foundation-actions shell3d-controls" role="group" aria-label="Construction views">
        {CONSTRUCTION_VIEWS.map(id => <button className="btn" key={id} aria-pressed={view === id} onClick={() => { setView(id); setZoom(1) }}>{id[0].toUpperCase() + id.slice(1)}</button>)}
      </div>
      <div className="foundation-actions shell3d-controls" role="group" aria-label="Model zoom">
        <button className="btn" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} disabled={zoom <= 0.5}>Zoom out</button>
        <button className="btn" onClick={() => setZoom(1)} disabled={zoom === 1}>Fit model</button>
        <button className="btn" onClick={() => setZoom(z => Math.min(3, z + 0.25))} disabled={zoom >= 3}>Zoom in</button>
      </div>
      <ModelStage key={[value.projectId, value.id, value.revision, view, attempt].join(':')} model={model} value={value} view={view} zoom={zoom} reload={reload} />
      <ul className="shell3d-legend" aria-label="Saved materials">{materials.map(part => <li key={part.materialId + '@' + part.materialRevision}>
        <span className="shell3d-swatch" style={{ backgroundColor: part.color }} aria-hidden />
        <span>{part.materialName} · material version {part.materialRevision}<br />{part.colorIsSpecification ? 'Specified colour; texture is not shown.' : 'Neutral display finish; actual appearance unspecified.'}</span>
      </li>)}</ul>
      {!!model.gaps.length && <div className="solution-attention"><strong>Not established by this view</strong><ul>{model.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></div>}
    </>}
  </section>
}
