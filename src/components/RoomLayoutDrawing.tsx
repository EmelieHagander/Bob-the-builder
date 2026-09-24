import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { checkedRoomLayout, ROOM_LAYOUT_LIMITS, roomLayoutGeometry, roomLayoutStale, roomLayoutSvg, type RoomLayoutDetails, type RoomLayoutView } from '../lib/roomLayout'
import { formatDrawingMm } from '../lib/storageBox'
import { StorageBoxDrawing } from './StorageBoxDrawing'
import './StorageBoxDrawing.css'

export function RoomLayoutDrawing({ value, title, source, lineageChanged = false, participant = false }: { value: RoomLayoutDetails | null; title: string; source: string; lineageChanged?: boolean; participant?: boolean }) {
  const [view, setView] = useState<RoomLayoutView | 'furniture'>('overview')
  const [zoom, setZoom] = useState(1)
  const result = useMemo(() => {
    try {
      if (!value) throw new Error('Linked sources are no longer available in this project.')
      const d = checkedRoomLayout(value, value.project_id, value.artifact_id, value.artifact_revision)
      if (!d.context_available) throw new Error('The project no longer has the physical context used by this drawing. Its version has not been changed.')
      return { d, g: roomLayoutGeometry(d.parameters, d.furniture_recipe), error: '' }
    } catch (e) { return { d: null, g: null, error: e instanceof Error ? e.message : 'Room layout unavailable.' } }
  }, [value])
  if (!result.d || !result.g) return <p role="alert" className="solution-attention">Cannot display linked room layout: {result.error}</p>
  const { d, g } = result
  const stale = roomLayoutStale(d) || lineageChanged
  const views = { overview: 'Both rooms', left: d.left_name, right: d.right_name, furniture: 'Furniture construction' } as const
  const svg = view === 'furniture' ? '' : roomLayoutSvg(d, view, title, source, lineageChanged)
  const drawingUrl = `/artifacts?drawing=${encodeURIComponent(d.furniture_artifact_id)}&revision=${d.furniture_revision}${d.furniture_area_id ? `&area=${encodeURIComponent(d.furniture_area_id)}` : ''}`
  return <section className="box-drawing" aria-label="Linked room plan">
    <p className="foundation-hint">{participant ? 'Saved proposed plan: two rooms, one shared wall. Ask the organiser about changes.' : 'One proposed plan, two rooms, one shared wall. Ask Bob to move the wall or reposition the furniture; you do not need to redraw the views.'}</p>
    {stale && <p role="status" className="solution-attention">Sources changed after this plan was saved. The displayed geometry still uses the pinned versions. {participant ? 'Ask the organiser to review the sources before using this plan.' : 'Ask Bob to review and explicitly refresh the sources before making further changes.'}</p>}
    {d.physical_pending && <p className="solution-attention">There are pending physical proposals. This plan retains its accepted source versions, not those proposals.</p>}
    <p role="status" className={g.fit === 'outside_room' ? 'solution-attention' : 'foundation-hint'}>
      {g.fit === 'outside_room'
        ? 'Furniture does not fit this room outline. Its construction and part dimensions have NOT been changed.'
        : 'Furniture is inside this rectangular outline only. Doors, circulation, heights and safety are not checked.'}
    </p>
    <div className="foundation-actions" aria-label="Linked plan views">
      {(Object.keys(views) as (keyof typeof views)[]).map(key => <button type="button" className={`btn${view === key ? ' btn-primary' : ''}`} key={key}
        aria-pressed={view === key} onClick={() => { setView(key); setZoom(1) }}>{views[key]}</button>)}
    </div>
    {view === 'furniture' ? <StorageBoxDrawing recipe={d.furniture_recipe} stamp={{ title: d.furniture_title,
      artifactId: d.furniture_artifact_id, revision: d.furniture_revision, status: 'Pinned construction', source: `Used by ${title} · plan v${d.artifact_revision}. ${source}` }} /> : <>
      <div className="foundation-actions box-drawing-controls">
        <button type="button" className="btn" aria-label="Zoom linked plan out" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1,z-0.5))}>−</button>
        <span aria-live="polite">{Math.round(zoom*100)}%</span>
        <button type="button" className="btn" aria-label="Zoom linked plan in" disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3,z+0.5))}>+</button>
        <button type="button" className="btn" onClick={() => setZoom(1)}>Fit plan</button>
        <button type="button" className="btn" onClick={() => {
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
          const a = document.createElement('a'); a.href = url; a.download = `bob-${d.artifact_id}-r${d.artifact_revision}-${view}.svg`
          document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000)
        }}>Save plan SVG</button>
      </div>
      <div className="box-drawing-viewport" tabIndex={0} aria-label="Linked plan viewport">
        <div className="box-drawing-sheet" style={{ width: `${zoom*100}%` }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </>}
    <dl className="box-dimensions">
      <div><dt>{d.left_name} · inside width</dt><dd>{formatDrawingMm(g.left.width)} mm</dd></div>
      <div><dt>{d.right_name} · inside width</dt><dd>{formatDrawingMm(g.right.width)} mm</dd></div>
      <div><dt>Shared wall · thickness</dt><dd>{formatDrawingMm(g.wall.width)} mm</dd></div>
      <div><dt>Fixed span · both rooms + wall</dt><dd>{formatDrawingMm(g.parameters.span_mm)} mm</dd></div>
      <div><dt>Furniture footprint · one instance</dt><dd>{formatDrawingMm(g.furniture.width)} × {formatDrawingMm(g.furniture.depth)} mm</dd></div>
      <div><dt>Placement · local x / y</dt><dd>{formatDrawingMm(g.furniture.x)} / {formatDrawingMm(g.furniture.y)} mm</dd></div>
    </dl>
    <p className="foundation-hint">Anchored to the {d.parameters.anchor === 'shared_wall' ? 'shared' : 'outer'} wall in {d.parameters.furniture_room === 'left' ? d.left_name : d.right_name}; gap {formatDrawingMm(d.parameters.gap_mm)} mm, offset {formatDrawingMm(d.parameters.offset_mm)} mm. This is a placement rule, not an attachment or fixing.</p>
    <details><summary>Exact source versions and identities</summary>
      <p className="foundation-hint" style={{ overflowWrap: 'anywhere' }}>Building {d.building_id}<br />{d.left_name}: {d.left_space_id} · v{d.left_space_revision}<br />
        {d.right_name}: {d.right_space_id} · v{d.right_space_revision}<br />{d.wall_name}: {d.wall_element_id} · v{d.wall_element_revision}<br />
        Furniture instance: {d.instance_id}<br />{source}</p>
    </details>
    {!participant && <p><Link className="btn" to={drawingUrl}>Open furniture drawing · v{d.furniture_revision}</Link></p>}
    <p className="foundation-hint">Furniture part sizes come from that single pinned drawing. Viewing it in several plans does not create another physical copy or add material purchases.</p>
    <p className="solution-attention">{ROOM_LAYOUT_LIMITS}</p>
  </section>
}
