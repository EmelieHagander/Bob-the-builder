import { useState } from 'react'
import * as db from '../data/database'
import { useAsync, useProjectVersion } from './ui'
import { drawingUrl } from './ProjectDrawings'
import { DrawingLink } from './DrawingLink'
import { DrawingSourceNotice } from './DrawingSourceNotice'

/** Task and Plan use the same authorized Step links and pinned revisions. */
export function StepDrawings({ projectId, stepId, returnLabel, returnKey, showEmpty = false }: {
  projectId: string; stepId: string; returnLabel: string; returnKey: string; showEmpty?: boolean
}) {
  const version = useProjectVersion(), [retry, setRetry] = useState(0)
  const { data, loading, error } = useAsync(() => db.getStepDrawings(projectId, stepId), [projectId, stepId, version, retry])
  if (error) return <div role="alert">Linked drawings could not be loaded. <button className="btn" onClick={() => setRetry(n => n+1)}>Reload drawings</button></div>
  if (loading || !data) return <p role="status">Loading linked drawings…</p>
  if (!data.length) return showEmpty ? <p className="foundation-hint">No drawing is linked to this task’s current step yet.</p> : null
  return <ul className="work-task-list step-drawings" aria-label="Step drawings">{data.map(drawing => <li key={drawing.artifact_id}>
    <span className="foundation-hint">{drawing.isConstruction ? 'Construction model' : 'Drawing'} · {drawing.status === 'concept' ? 'Concept' : drawing.status === 'measured' ? 'Measured' : 'Build ready'}</span>
    <DrawingLink projectId={projectId} returnLabel={returnLabel} returnKey={`${returnKey}:${drawing.artifact_id}`}
      to={drawingUrl({ id: drawing.artifact_id, revision: drawing.artifact_revision, area_id: drawing.area_id })}>
      {drawing.title} · v{drawing.artifact_revision}
    </DrawingLink>
    <DrawingSourceNotice source={drawing} />
  </li>)}</ul>
}
