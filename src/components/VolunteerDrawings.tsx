import { useEffect, useRef, useState } from 'react'
import * as db from '../data/database'
import type { VolunteerDrawing, VolunteerDrawingSummary } from '../data/volunteers'
import { Loading } from './ui'
import { FormError } from './form'
import { CadDrawingView } from './CadDrawingView'
import { StorageBoxDrawing } from './StorageBoxDrawing'
import { generationGeometry, StudWallPreview } from './StudWallPreview'
import { RoomLayoutDrawing } from './RoomLayoutDrawing'
import { BuildingPlanDrawing } from './BuildingPlanDrawing'
import { StairStudyDrawing } from './StairStudyDrawing'

const statusName = { concept: 'Concept', measured: 'Measured', build_ready: 'Build ready' }
const sourceName = { current: 'Sources current', changed: 'Sources changed', unavailable: 'Sources unavailable' }
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

/** Reuses the ordinary drawing renderers, with only a task-scoped capability.
 * Remount on task refresh/progress; never retain a previous readable response on failure. */
export function VolunteerDrawings({ secret, projectId, taskId, onDenied }: {
  secret: string; projectId: string; taskId: string; onDenied: (reason: unknown) => void
}) {
  const [items, setItems] = useState<VolunteerDrawingSummary[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [drawing, setDrawing] = useState<VolunteerDrawing | null>(null)
  const [image, setImage] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const mounted = useRef(false), imageUrl = useRef('')
  const clearDrawing = () => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
    imageUrl.current = ''; setImage(''); setDrawing(null)
  }
  async function list(after: string | null = null) {
    setBusy(true); setError(''); clearDrawing()
    try {
      const result = await db.volunteers.drawings(secret, projectId, taskId, after)
      if (!mounted.current) return
      // Loading another page rechecks the current task relation too.
      setItems(old => after ? [...old.filter(i => !result.items.some(n => n.id === i.id)), ...result.items] : result.items)
      setNext(result.nextCursor)
    } catch (reason) {
      if (mounted.current) { setItems([]); setNext(null); setError(message(reason)); onDenied(reason) }
    } finally { if (mounted.current) setBusy(false) }
  }
  useEffect(() => {
    mounted.current = true; void list()
    return () => { mounted.current = false; if (imageUrl.current) URL.revokeObjectURL(imageUrl.current) }
  }, [secret, projectId, taskId])
  async function open(item: VolunteerDrawingSummary) {
    if (busy) return
    setBusy(true); setError(''); clearDrawing()
    try {
      const result = await db.volunteers.drawing(secret, projectId, taskId, item.id, item.revision)
      if (!mounted.current) return
      let url = ''
      if (result.content?.imageId) {
        const blob = await db.volunteers.image(secret, taskId, result.content.imageId, result)
        if (!mounted.current) return
        url = URL.createObjectURL(blob)
      }
      imageUrl.current = url; setImage(url); setDrawing(result)
    } catch (reason) { if (mounted.current) { setError(message(reason)); onDenied(reason) } }
    finally { if (mounted.current) setBusy(false) }
  }
  const content = drawing?.content
  const geometry = content?.generation ? generationGeometry(content.generation) : null
  return <section aria-label="Task drawings" className="volunteer-steps">
    <h3>Drawings for this task</h3>
    <p className="foundation-hint">Current drawings linked to this task’s work step. Check the saved status and assumptions before starting.</p>
    {!busy && !error && !items.length && <p>No drawings linked to this task’s current step yet. Ask the organiser if you need a drawing.</p>}
    {items.map(item => <article key={item.id} className="card volunteer-step">
      <h4>{item.title} · v{item.revision}</h4>
      <p className="foundation-hint">{item.stepTitle} · {statusName[item.status]} · {sourceName[item.sourceState]}</p>
      <button className="btn" disabled={busy} onClick={() => void open(item)} aria-label={`View drawing: ${item.title}`}>View drawing</button>
    </article>)}
    {busy && <Loading />}
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    {drawing && <article aria-label="Drawing reader" className="volunteer-drawing">
      <h4>{drawing.title} · v{drawing.revision}</h4>
      <p>{statusName[drawing.status]} · {sourceName[drawing.sourceState]}</p>
      {drawing.sourceState === 'changed' && <p role="status" className="solution-attention">Sources changed after this version was saved. The drawing retains its recorded dimensions and status. Ask the organiser to review it before use.</p>}
      {drawing.sourceState === 'unavailable' && <p role="status" className="solution-attention">The sources are no longer available for this task. The drawing is hidden. Ask the organiser to review its links.</p>}
      <p className="volunteer-text">{drawing.description}</p>
      <p className="volunteer-text"><strong>Assumptions:</strong> {drawing.assumptions || 'None recorded. Check with the organiser before starting.'}</p>
      {content && <>
        {content.cad && <CadDrawingView value={content.cad} title={drawing.title} />}
        {content.parametricRecipe && <StorageBoxDrawing recipe={content.parametricRecipe} stamp={{ title: drawing.title, artifactId: drawing.id, revision: drawing.revision, status: statusName[drawing.status], source: `${sourceName[drawing.sourceState]}. ${drawing.assumptions}` }} />}
        {geometry && <StudWallPreview geometry={geometry} />}
        {content.roomLayout && <RoomLayoutDrawing value={content.roomLayout} title={drawing.title} source={`v${drawing.revision} · ${statusName[drawing.status]}`} lineageChanged={drawing.sourceState === 'changed'} participant />}
        {content.multifloorPlan && <BuildingPlanDrawing value={content.multifloorPlan} title={drawing.title} source={`v${drawing.revision} · ${statusName[drawing.status]}`} lineageChanged={drawing.sourceState === 'changed'} participant />}
        {content.stairStudy && <StairStudyDrawing value={content.stairStudy} title={drawing.title} participant />}
        {image && <figure className="volunteer-image"><img src={image} alt={`${drawing.title} — saved drawing`} /></figure>}
        {!content.cad && !content.parametricRecipe && !geometry && !content.roomLayout && !content.multifloorPlan && !content.stairStudy && !image && <p>No viewable geometry or image is saved for this version. Read the description and ask the organiser for details.</p>}
      </>}
      <button className="btn" disabled={busy} onClick={() => void open(drawing)}>Refresh drawing</button>
    </article>}
    {next && <button className="btn" disabled={busy} onClick={() => void list(next)}>Load more drawings</button>}
    <button className="btn" disabled={busy} onClick={() => void list()}>Refresh drawings</button>
  </section>
}
