import { useState } from 'react'
import * as db from '../data/database'
import type { StepDrawing } from '../data/projectWork'
import { useAsync, useProjectVersion } from './ui'
import { DrawingPreview, drawingUrl } from './ProjectDrawings'
import { DrawingLink } from './DrawingLink'
import { DrawingSourceNotice } from './DrawingSourceNotice'
import { guideDrawingUrl } from '../lib/guideDrawing'
import { GuidePhoto } from './GuidePhoto'

type Props = {projectId: string; stepId: string; returnLabel: string; returnKey: string; showEmpty?: boolean; guide?: boolean}

function LeadDrawing({drawing, projectId, stepId, returnLabel, returnKey}: Props & {drawing:StepDrawing}) {
  const revision = drawing.artifact_revision, id = drawing.artifact_id
  const version = useProjectVersion(), [attempt,setAttempt] = useState(0)
  const {data, error, loading} = useAsync(async () => {
    if (drawing.isConstruction || drawing.source_state === 'unavailable') return null
    const row = await db.getStepDrawingPreview(projectId,id,revision)
    const image = row?.preview_svg && row.source_state !== 'unavailable' ? await guideDrawingUrl(row.preview_svg) : null
    return row ? { ...row, image } : null
  }, [projectId,id,revision,drawing.source_state,version,attempt])
  const preview = !loading && !error && data?.source_state !== 'unavailable' ? data : null
  const source = preview?.source_state === 'changed' ? { ...drawing, source_state: 'changed' as const } : drawing
  const unavailable = data?.source_state === 'unavailable' || source.source_state === 'unavailable'
  const noCurrentPreview = !loading && !error && !data && !drawing.isConstruction && !unavailable
  const hasImage = !!(preview?.preview_svg || preview?.parametric_recipe || preview?.source_media_id)
  const type = drawing.isConstruction ? 'Model' : drawing.status === 'concept' ? 'Concept drawing' : drawing.status === 'measured' ? 'Measured drawing' : 'Build-ready drawing'
  return <div className="guide-drawing step-drawings" aria-label="Step drawings">
    <DrawingLink projectId={projectId} returnLabel={returnLabel} returnKey={`${returnKey}:${id}`}
      aria-label={`${drawing.title} · v${revision}`} to={drawingUrl({id,revision,area_id:drawing.area_id})}>
      {hasImage && preview && <span className="guide-image">{preview.image
        ? <img src={preview.image} alt={drawing.title} /> : <DrawingPreview drawing={preview} compact />}</span>}
      <span className="guide-figure-label">{type}<span aria-hidden="true"> ↗</span></span>
    </DrawingLink>
    {unavailable ? <p className="guide-caution" role="status">Sources unavailable — check before use</p>
      : source.source_state === 'changed' && <p className="guide-caution" role="status">Sources changed — review drawing</p>}
    {noCurrentPreview && source.source_state === 'current' && <p className="foundation-hint">Open the saved version to check its sources.</p>}
    {error && <button className="btn" onClick={() => setAttempt(n=>n+1)}>Retry preview</button>}
    {!loading && !hasImage && <GuidePhoto projectId={projectId} target={{kind:'plan_step',id:stepId}} />}
  </div>
}

export function StepDrawings(props: Props) {
  const {projectId,stepId,returnLabel,returnKey,showEmpty=false,guide=false} = props
  const version = useProjectVersion(), [retry, setRetry] = useState(0)
  const { data, loading, error } = useAsync(() => db.getStepDrawings(projectId, stepId), [projectId, stepId, version, retry])
  if (error) return <div role="alert">Linked drawings could not be loaded. <button className="btn" onClick={() => setRetry(n => n+1)}>Reload drawings</button></div>
  if (loading || !data) return <p role="status">Loading linked drawings…</p>
  if (!data.length) return guide ? <GuidePhoto projectId={projectId} target={{kind:'plan_step',id:stepId}} />
    : showEmpty ? <p className="foundation-hint">No drawing is linked to this task’s current step yet.</p> : null
  const lead = guide ? data.find(d => !d.isConstruction && d.source_state === 'current') ?? data.find(d => !d.isConstruction && d.source_state === 'changed') ?? data[0] : null
  const rest = data.filter(d => d !== lead)
  const list = <ul className="work-task-list step-drawings" aria-label="Linked drawings">{rest.map(drawing => <li key={drawing.artifact_id}>
    <span className="foundation-hint">{drawing.isConstruction ? 'Construction model' : 'Drawing'} · {drawing.status === 'concept' ? 'Concept' : drawing.status === 'measured' ? 'Measured' : 'Build ready'}</span>
    <DrawingLink projectId={projectId} returnLabel={returnLabel} returnKey={`${returnKey}:${drawing.artifact_id}`}
      to={drawingUrl({ id: drawing.artifact_id, revision: drawing.artifact_revision, area_id: drawing.area_id })}>
      {drawing.title} · v{drawing.artifact_revision}
    </DrawingLink>
    <DrawingSourceNotice source={drawing} />
  </li>)}</ul>
  if (!lead) return list
  return <><LeadDrawing key={`${lead.artifact_id}:${lead.artifact_revision}`} {...props} drawing={lead} />
    {rest.length > 0 && <details id={`supporting-drawings-${stepId}`}><summary>Other drawings ({rest.length})</summary>{list}</details>}
  </>
}
