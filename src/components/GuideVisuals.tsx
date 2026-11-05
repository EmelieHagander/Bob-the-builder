import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { MediaAsset, MediaTarget } from '../data/types'
import * as db from '../data/database'
import type { StepDrawing } from '../data/projectWork'
import { Icon, useAsync, useProjectVersion } from './ui'
import { DrawingPreview, drawingUrl } from './ProjectDrawings'
import { DrawingLink } from './DrawingLink'
import { StoredImage } from './ProjectImages'
import { guideDrawingUrl } from '../lib/guideDrawing'
import { GuidePhoto } from './GuidePhoto'

type Props = {
  projectId: string; planStepId?: string | null; target: MediaTarget; taskId?: string
  returnLabel: string; returnKey: string
}

type Visual =
  | { key: string; kind: 'drawing'; drawing: StepDrawing }
  | { key: string; kind: 'photo'; photo: MediaAsset; taskPhoto: boolean }

// One authorized read per visible, pinned revision. The main frame and its
// thumbnail share the result only for this mounted project and guide.
async function readPreview(projectId: string, drawing: StepDrawing) {
  if (drawing.isConstruction || drawing.source_state === 'unavailable') return null
  const row = await db.getStepDrawingPreview(projectId, drawing.artifact_id, drawing.artifact_revision)
  const image = row?.preview_svg && row.source_state !== 'unavailable' ? await guideDrawingUrl(row.preview_svg) : null
  return row ? { ...row, image } : null
}
type PreviewLoader = (drawing: StepDrawing) => ReturnType<typeof readPreview>
const revisionKey = (d: StepDrawing) => `drawing:${d.artifact_id}:${d.artifact_revision}`

function Thumbnail({ drawing, load }: { drawing: StepDrawing; load: PreviewLoader }) {
  const element = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    })
    if (element.current) observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  const { data } = useAsync(() => visible ? load(drawing) : Promise.resolve(null), [visible, load, drawing])
  return <span ref={element} className="choice-thumb" aria-hidden="true">
    {data && drawing.source_state !== 'unavailable' && data.source_state !== 'unavailable' && (data.image || data.source_media_id || data.parametric_recipe)
      ? data.image ? <img src={data.image} alt="" /> : <DrawingPreview drawing={data} compact />
      : <Icon name={drawing.isConstruction ? 'cube' : 'blueprint'} size={23} />}
  </span>
}

type FigureProps = Pick<Props, 'projectId' | 'returnLabel' | 'returnKey'> & {
  drawing: StepDrawing; load: PreviewLoader; taskView: boolean; onMissing: (key: string) => void
}
function LeadDrawing({ drawing, projectId, returnLabel, returnKey, load, taskView, onMissing }: FigureProps) {
  const revision = drawing.artifact_revision, id = drawing.artifact_id
  const [attempt, setAttempt] = useState(0)
  const { data, error, loading } = useAsync(() => load(drawing), [load, drawing, attempt])
  const preview = !loading && !error && drawing.source_state !== 'unavailable' && data?.source_state !== 'unavailable' ? data : null
  const changed = drawing.source_state === 'changed' || data?.source_state === 'changed'
  const unavailable = drawing.source_state === 'unavailable' || data?.source_state === 'unavailable'
  const noCurrentPreview = !loading && !error && !data && !drawing.isConstruction && !unavailable
  const hasImage = !!(preview?.preview_svg || preview?.parametric_recipe || preview?.source_media_id)
  useEffect(() => {
    if (!loading && (!hasImage || error)) onMissing(revisionKey(drawing))
  }, [loading, hasImage, error, onMissing, drawing])
  const labels: Record<string, string> = { concept: 'Concept drawing', measured: 'Measured drawing', build_ready: 'Build-ready drawing' }
  const type = drawing.isConstruction ? 'Model' : labels[drawing.status] ?? 'Saved drawing'
  return <div className="guide-drawing step-drawings" aria-label="Step drawings">
    {unavailable ? <p className="guide-caution" role="status">Sources unavailable — check before use</p>
      : changed && <p className="guide-caution" role="status">Sources changed — review drawing</p>}
    <DrawingLink projectId={projectId} returnLabel={returnLabel} returnKey={`${returnKey}:${id}`}
      aria-label={`${drawing.title} · v${revision}`} to={drawingUrl({ id, revision, area_id: drawing.area_id })}>
      {hasImage && preview && <span className="guide-image">{preview.image
        ? <img src={preview.image} alt={drawing.title} /> : <DrawingPreview drawing={preview} compact />}<span className="guide-expand" aria-hidden="true"><Icon name="arrows-out" size={18} /></span></span>}
      <span className="guide-figure-label">{taskView ? 'Plan step · ' : ''}{type}<span aria-hidden="true"> ↗</span></span>
    </DrawingLink>
    {noCurrentPreview && !changed && <p className="foundation-hint">Open the saved version to check its sources.</p>}
    {error && <button className="btn" onClick={() => setAttempt(n => n + 1)}>Retry preview</button>}
  </div>
}

async function linkedPhotos(projectId: string, target: MediaTarget, wanted: string | null, pages: number) {
  const photos = new Map<string, MediaAsset>()
  const collect = (items: MediaAsset[]) => {
    for (const image of items) {
      const linked = image.links.some(link => link.kind === target.kind && link.targetId === target.id)
      if (image.projectId === projectId && image.state === 'ready' && linked) photos.set(image.id, image)
    }
  }
  let offset = 0
  let more = true
  for (let page = 0; page < pages && more; page++) {
    const result = await db.getProjectImages(projectId, target, offset, true)
    collect(result.items)
    more = result.hasMore && result.items.length > 0
    offset += result.items.length
  }
  // Restore a selection beyond the first page with one exact scoped read.
  if (wanted && more && !photos.has(wanted)) {
    const result = await db.getProjectImages(projectId, target, 0, true, wanted)
    collect(result.items.filter(image => image.id === wanted))
  }
  return { items: [...photos.values()], more }
}

/** The large frame is shared by the plan and the task. Selection changes only
 * the viewed media, and its URL restores the same drawing after a reader visit. */
export function GuideVisuals({ projectId, planStepId, target, taskId, returnLabel, returnKey }: Props) {
  const [params, setParams] = useSearchParams()
  const [mediaVersion, setMediaVersion] = useState(0), [drawRetry, setDrawRetry] = useState(0), [pages, setPages] = useState(1)
  const version = useProjectVersion(), selected = params.get('visual')
  const [initialSelection] = useState(selected)
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set())
  const noteMissing = useCallback((key: string) => {
    setMissing(known => known.has(key) ? known : new Set([...known, key]))
  }, [])
  const loadPreview = useMemo<PreviewLoader>(() => {
    const cache = new Map<string, ReturnType<typeof readPreview>>()
    return drawing => {
      const key = revisionKey(drawing) + ':' + drawing.source_state
      const cached = cache.get(key)
      if (cached) return cached
      const pending = readPreview(projectId, drawing).catch(error => {
        cache.delete(key)
        throw error
      })
      cache.set(key, pending)
      return pending
    }
  }, [projectId, version, drawRetry])
  useEffect(() => {
    const changed = () => setMediaVersion(n => n + 1)
    window.addEventListener(db.MEDIA_CHANGED_EVENT, changed)
    return () => window.removeEventListener(db.MEDIA_CHANGED_EVENT, changed)
  }, [])
  const drawings = useAsync(() => planStepId ? db.getStepDrawings(projectId, planStepId) : Promise.resolve([]),
    [projectId, planStepId, version, drawRetry])
  const photos = useAsync(() => linkedPhotos(projectId, target, initialSelection?.startsWith('photo:') ? initialSelection.slice(5) : null, pages),
    [projectId, target.kind, target.id, version, mediaVersion, pages, initialSelection])
  const taskPhotos = useAsync(() => taskId && target.kind === 'step'
    ? linkedPhotos(projectId, { kind: 'task', id: taskId }, initialSelection?.startsWith('task-photo:') ? initialSelection.slice(10) : null, pages)
    : Promise.resolve({ items: [], more: false }), [projectId, target.kind, taskId, version, mediaVersion, pages, initialSelection])

  const documents: Visual[] = (drawings.data ?? []).map(d => ({ key: revisionKey(d), kind: 'drawing', drawing: d }))
  const pictures: Visual[] = (photos.data?.items ?? []).map(p => ({ key: 'photo:' + p.id, kind: 'photo', photo: p, taskPhoto: target.kind === 'task' }))
  const ownIds = new Set(pictures.map(p => p.key))
  const parentPictures: Visual[] = (taskPhotos.data?.items ?? []).filter(p => !ownIds.has('photo:' + p.id)).map(p => ({ key: 'task-photo:' + p.id, kind: 'photo', photo: p, taskPhoto: true }))
  const items = [...documents, ...pictures, ...parentPictures]
  const currentDrawing = documents.find(v => v.kind === 'drawing' && !v.drawing.isConstruction && !missing.has(v.key) && v.drawing.source_state === 'current')
  const instruction = pictures.find(v => v.kind === 'photo' && v.photo.purpose === 'instruction')
  const closestPhoto = target.kind === 'plan_step' ? instruction : instruction ?? pictures[0]
  const active = items.find(v => v.key === selected) ?? closestPhoto ?? currentDrawing ?? pictures[0] ?? parentPictures[0]
    ?? documents.find(v => v.kind === 'drawing' && !v.drawing.isConstruction && v.drawing.source_state === 'changed') ?? documents[0]
  const more = photos.data?.more || taskPhotos.data?.more
  const select = (v: Visual) => {
    const next = new URLSearchParams(params)
    next.set('visual', v.key)
    if (target.kind === 'step') next.set('instruction', target.id)
    if (target.kind === 'plan_step') next.set('step', target.id)
    setParams(next, { replace: true, preventScrollReset: true })
  }

  return <>
    {drawings.error && <div role="alert">Linked drawings could not be loaded. <button className="btn" onClick={() => setDrawRetry(n => n + 1)}>Reload drawings</button></div>}
    {(photos.error || taskPhotos.error) && <div role="alert">Photos could not be loaded. <button className="btn" onClick={() => setMediaVersion(n => n + 1)}>Retry photos</button></div>}
    {active && <section className="guide-visuals" aria-label={target.kind === 'plan_step' ? 'Step images and drawings' : 'Task images and drawings'}>
      {active.kind === 'drawing'
        ? <LeadDrawing key={active.key} drawing={active.drawing} load={loadPreview} taskView={target.kind !== 'plan_step'} onMissing={noteMissing} projectId={projectId} returnLabel={returnLabel} returnKey={returnKey} />
        : <GuidePhoto key={active.key} projectId={projectId} photo={active.photo} taskPhoto={active.taskPhoto} />}
      {(items.length > 1 || more) && <div className="visual-choices" role="group" aria-label="Choose a picture or drawing">
        {items.map(v => {
          const isDrawing = v.kind === 'drawing'
          const type = isDrawing ? (v.drawing.isConstruction ? 'Model' : 'Drawing') : 'Photo'
          const name = isDrawing ? `${v.drawing.title} · v${v.drawing.artifact_revision}` : v.photo.title
          const warning = isDrawing && v.drawing.source_state !== 'current'
          return <button type="button" className="visual-choice" key={v.key} aria-pressed={v.key === active.key}
            aria-label={`${type}: ${name}${warning ? ' · check sources' : ''}`} title={name} onClick={() => select(v)}>
            {isDrawing ? <Thumbnail drawing={v.drawing} load={loadPreview} />
              : <span className="choice-thumb" aria-hidden="true"><StoredImage projectId={projectId} image={v.photo} allowRetry={false} /></span>}
            <span>{type}{warning && <Icon name="warning" size={12} />}</span>
          </button>
        })}
        {more && <button className="btn" onClick={() => setPages(n => n + 1)}>More photos</button>}
      </div>}
    </section>}
  </>
}
