import type { ProjectStepWorkspace } from '../data/projectWork'
import { drawingUrl } from './ProjectDrawings'
import { DrawingLink } from './DrawingLink'
import { DrawingSourceNotice } from './DrawingSourceNotice'

/** Task and Plan use the same authorized Step links and pinned revisions. */
export function StepDrawings({ projectId, drawings, returnLabel, returnKey }: {
  projectId: string; drawings: ProjectStepWorkspace['drawings']; returnLabel: string; returnKey: string
}) {
  return <ul className="work-task-list step-drawings" aria-label="Step drawings">{drawings.map(drawing => <li key={drawing.artifact_id}>
    <DrawingLink projectId={projectId} returnLabel={returnLabel} returnKey={`${returnKey}:${drawing.artifact_id}`}
      to={drawingUrl({ id: drawing.artifact_id, revision: drawing.artifact_revision, area_id: drawing.area_id })}>
      {drawing.title} · v{drawing.artifact_revision}
    </DrawingLink>
    <span className="foundation-hint">{drawing.status === 'concept' ? 'Concept' : drawing.status === 'measured' ? 'Measured' : 'Build ready'}</span>
    <DrawingSourceNotice source={drawing} />
  </li>)}</ul>
}
