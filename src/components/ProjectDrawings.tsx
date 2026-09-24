import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { storageBoxSvg } from '../lib/storageBox'
import { StoredImage } from './ProjectImages'
import { useAsync, useProjectVersion } from './ui'

const statusLabel = { concept: 'Concept', measured: 'Measured', build_ready: 'Build ready' }
export function drawingUrl(drawing: { id: string; revision: number }) {
  return `/artifacts?drawing=${encodeURIComponent(drawing.id)}&revision=${drawing.revision}`
}

function Preview({ drawing }: { drawing: db.ProjectDrawingCard }) {
  const { data, error, loading } = useAsync(
    () => db.getProjectDrawingPreview(drawing.project_id, drawing.id, drawing.revision),
    [drawing.project_id, drawing.id, drawing.revision],
  )
  if (error) return <p className="foundation-hint">Preview unavailable. Open the saved drawing.</p>
  if (loading || !data) return <p className="foundation-hint" role="status">Loading drawing…</p>
  let src = data.preview_svg ? `data:image/svg+xml;base64,${data.preview_svg}` : null
  if (!src && data.parametric_recipe) {
    try {
      src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(storageBoxSvg(data.parametric_recipe, 'front', {
        title: drawing.title, revision: drawing.revision, artifactId: drawing.id, status: statusLabel[drawing.status],
      }))}`
    } catch { /* The canonical viewer explains unsupported recipes. */ }
  }
  if (src) return <img src={src} alt={`${drawing.title} — drawing preview`} loading="lazy" />
  if (data.source_media_id) return <StoredImage projectId={drawing.project_id} image={{ id: data.source_media_id, title: drawing.title }} />
  return <p className="foundation-hint">Open drawing for its views and project evidence.</p>
}

function DrawingCard({ drawing }: { drawing: db.ProjectDrawingCard }) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '200px' })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return <article className="project-drawing-card" ref={ref}>
    <Link to={drawingUrl(drawing)} className="project-drawing-open" aria-label={`Open drawing: ${drawing.title} · v${drawing.revision}`}>
      <div className="project-drawing-preview">{visible && <Preview drawing={drawing} />}</div>
      <h3>{drawing.title}</h3>
      <p className="foundation-hint">{statusLabel[drawing.status]} · v{drawing.revision}</p>
    </Link>
    {drawing.steps.length > 0 && <ul className="project-drawing-steps" aria-label="Related steps">
      {drawing.steps.map(step => <li key={step.id}><Link to={`/?step=${encodeURIComponent(step.id)}`}>{step.title}</Link></li>)}
    </ul>}
  </article>
}

export function ProjectDrawings({ projectId }: { projectId: string }) {
  const version = useProjectVersion(), [retry, setRetry] = useState(0)
  const { data, error, loading } = useAsync(() => db.getProjectDrawingCards(projectId), [projectId, version, retry])
  return <section className="foundation-section project-drawings" aria-label="Project drawings">
    <div className="foundation-heading"><h2>Drawings</h2><Link className="btn" to="/artifacts">All drawings</Link></div>
    {error ? <div role="alert"><p>Project drawings could not be loaded.</p><button className="btn" onClick={() => setRetry(n => n + 1)}>Try again</button></div>
      : loading && !data ? <p role="status">Loading project drawings…</p>
        : !data?.length ? <p className="foundation-hint">No saved drawings yet. Drawings Bob saves will appear here.</p>
          : <><div className="project-drawing-grid">{data.slice(0, 3).map(drawing => <DrawingCard key={`${projectId}:${drawing.id}:${drawing.revision}`} drawing={drawing} />)}</div>
            {data.length > 3 && <p className="foundation-hint">Showing the three most recently updated drawings.</p>}</>}
  </section>
}
