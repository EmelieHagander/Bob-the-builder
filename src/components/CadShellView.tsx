import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { ArtifactVersion } from '../data/artifacts'
import {
  SHELL_BASIS_LABELS, SHELL_GRID_MM, footprintOverlaps, nudgeMm, shellFootprint, snapMm, turnQuarter,
  type CadShell, type ShellComponent,
} from '../lib/cadShell'
import { formatDrawingMm } from '../lib/storageBox'
import { inputStyle } from './form'
import './StorageBoxDrawing.css'
import './CadShellView.css'

const STATUS: Record<ShellComponent['status'], string> = {
  current: 'Up to date',
  newer_revision: 'Newer version saved',
  changed: 'Piece changed',
  archived: 'Piece archived',
  unavailable: 'Piece unavailable',
}
const DEFAULT_REASON = 'Moved in the drawing'

type Draft = { key: string; x_mm: number; y_mm: number; rz: number }
type Drag = { pointerId: number; key: string; inverse: DOMMatrix; startX: number; startY: number; clientX: number; clientY: number; from: Draft; moved: boolean }

const name = (c: ShellComponent) => c.child_title ?? c.component_key
const where = (p: { x_mm: number; y_mm: number; rz: number }) => `x ${formatDrawingMm(p.x_mm)} mm, y ${formatDrawingMm(p.y_mm)} mm, turned ${p.rz}°`

/** Plan view of a shell drawing: each saved piece as its footprint, plus the piece list.
 * On the newest revision the owner can drag a piece, nudge it on a 50 mm grid or turn it a
 * quarter; each save is one `place` command marked "Placed by you". */
export function CadShellView({ value, projectId, canEdit, onChanged, onReload }: {
  value: CadShell
  projectId: string
  canEdit: boolean
  onChanged?: (next: ArtifactVersion) => void
  /** Loads the newest saved revision after a conflict. */
  onReload?: () => Promise<void>
}) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [reason, setReason] = useState('')
  const [frozenView, setFrozenView] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<Drag | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  const latest = value.revision === value.current_revision && !value.archived
  const editable = canEdit && latest && !!onChanged
  // A reload can drop the piece being moved; say so instead of losing the move silently.
  const draftPiece = draft && value.components.find(c => c.component_key === draft.key)
  if (draft && !draftPiece) {
    setDraft(null)
    setNotice('The piece you were moving is no longer in this drawing, so your unsaved move was dropped.')
  }
  const placementOf = (c: ShellComponent) => draft?.key === c.component_key ? { ...c, x_mm: draft.x_mm, y_mm: draft.y_mm, rz: draft.rz } : c
  const placed = value.components.map(c => { const p = placementOf(c); return { c, p, f: shellFootprint(p) } })
  const boxes = placed.flatMap(p => p.f ? [p.f] : [])
  const minX = Math.min(...boxes.map(b => b.x)), maxX = Math.max(...boxes.map(b => b.x + b.width))
  const minY = Math.min(...boxes.map(b => b.y)), maxY = Math.max(...boxes.map(b => b.y + b.depth))
  const span = boxes.length ? Math.max(maxX - minX, maxY - minY) : 0
  const pad = span * 0.06
  const font = span / 32
  const viewBox = frozenView ?? `${minX - pad} ${-(maxY + pad)} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`
  const flagged = value.components.filter(c => c.status !== 'current').length
  const overlaps = footprintOverlaps(placed.map(({ c, f }) => ({ key: c, footprint: f })))
  const overlapKeys = new Set(overlaps.flatMap(pair => pair.map(c => c.component_key)))

  const current = value.components.find(c => c.component_key === selected) ?? null
  const shown = current ? placementOf(current) : null
  const changed = !!(draftPiece && (draft!.x_mm !== draftPiece.x_mm || draft!.y_mm !== draftPiece.y_mm || draft!.rz !== draftPiece.rz))
  const pending = changed ? draftPiece : null

  function select(c: ShellComponent) {
    if (pending && pending.component_key !== c.component_key) {
      setNotice(`Save or undo the move of ${name(pending)} before moving another piece.`)
      return false
    }
    if (selected !== c.component_key) { setSelected(c.component_key); setNotice('') }
    return true
  }
  function move(next: Omit<Draft, 'key'>) {
    if (!current) return
    setDraft({ key: current.component_key, ...next }); setNotice('')
  }
  function nudge(dx: -1 | 0 | 1, dy: -1 | 0 | 1) {
    if (!shown) return
    move({ x_mm: dx ? nudgeMm(shown.x_mm, dx) : shown.x_mm, y_mm: dy ? nudgeMm(shown.y_mm, dy) : shown.y_mm, rz: shown.rz })
  }
  function turn() { if (shown) move(turnQuarter(shown)) }
  function undo() { setDraft(null); setError(''); setConflict(false) }

  function svgPoint(inverse: DOMMatrix, x: number, y: number) {
    const p = new DOMPoint(x, y).matrixTransform(inverse)
    return { x: p.x, y: p.y }
  }
  function pointerDown(e: PointerEvent<SVGGElement>, c: ShellComponent) {
    if (!editable || busy || (e.pointerType === 'mouse' && e.button !== 0)) return
    if (!select(c)) return
    const ctm = svg.current?.getScreenCTM()
    if (!ctm) return
    const p = placementOf(c), inverse = ctm.inverse(), start = svgPoint(inverse, e.clientX, e.clientY)
    drag.current = { pointerId: e.pointerId, key: c.component_key, inverse, startX: start.x, startY: start.y, clientX: e.clientX, clientY: e.clientY,
      from: { key: c.component_key, x_mm: p.x_mm, y_mm: p.y_mm, rz: p.rz }, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    // Keep the sheet still under the pointer; it refits after the drop.
    setFrozenView(viewBox)
    e.preventDefault()
  }
  function pointerMove(e: PointerEvent<SVGGElement>) {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.clientX, e.clientY - d.clientY) < 4) return
    if (!d.moved) { d.moved = true; setDragging(true) }
    const p = svgPoint(d.inverse, e.clientX, e.clientY)
    // The sheet draws +y upwards, so screen y is flipped.
    setDraft({ key: d.key, x_mm: snapMm(d.from.x_mm + p.x - d.startX), y_mm: snapMm(d.from.y_mm - (p.y - d.startY)), rz: d.from.rz })
    setNotice('')
  }
  function pointerEnd(e: PointerEvent<SVGGElement>, cancelled: boolean) {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    // A cancelled pointer (the page scrolled instead) puts the piece back where the drag began.
    if (cancelled && d.moved) setDraft(d.from)
    drag.current = null
    setDragging(false); setFrozenView(null)
  }
  function viewportKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!editable || !current || busy) return
    const keys: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    if (keys[e.key]) { e.preventDefault(); nudge(...keys[e.key]) }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); turn() }
  }

  async function command(action: 'adopt' | 'place', c: ShellComponent, data: Record<string, unknown>, failed: string) {
    setBusy(action === 'adopt' ? c.component_key : 'place'); setError(''); setConflict(false); setNotice('')
    try {
      const next = await db.commandCadShell(projectId, action, value.id, value.revision, { component_key: c.component_key, ...data })
      if (action === 'place') { setDraft(null); setReason(''); setNotice(`Saved ${name(c)} at ${where(next.shell?.components.find(p => p.component_key === c.component_key) ?? draft!)}. This drawing is now version ${next.revision}.`) }
      onChanged?.(next)
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      if (message.includes('cad_shell_changed')) {
        setConflict(true)
        setError(action === 'place'
          ? 'This drawing changed since you opened it, so your move was not saved. Your move is kept below. Reload the drawing, check it, then save again.'
          : 'This drawing changed since you opened it. Reload the drawing, then try again.')
      } else setError(failed)
    } finally { setBusy('') }
  }
  function save() {
    if (!pending || !draft) return
    void command('place', pending, { x_mm: draft.x_mm, y_mm: draft.y_mm, z_mm: pending.z_mm, rz: draft.rz, placement_basis: 'owner_placed', reason: reason.trim() || DEFAULT_REASON },
      'Could not save the position. Nothing was changed; your move is still shown below.')
  }
  async function reload() {
    if (!onReload) return
    setBusy('reload'); setNotice('')
    try {
      await onReload()
      setError(''); setConflict(false)
      if (draft) setNotice('Reloaded the newest version. Your unsaved move is still shown; check the plan, then save or undo it.')
    } catch { setError('Could not reload the drawing. Close it and open it again; your unsaved move will be lost.') }
    finally { setBusy('') }
  }

  const active = editable && current ? placed.find(p => p.c === current) ?? null : null
  return <section className="box-drawing" aria-label="Combined drawing">
    <p className="foundation-hint">Combines {value.components.length} saved {value.components.length === 1 ? 'drawing' : 'drawings'} by reference. Each piece keeps its own measurements and cut list. Positions are proposals unless marked "Placed by you". {editable
      ? 'Drag a piece to place it yourself, or choose Move in the list. Ask Bob to add or remove a piece.'
      : 'Ask Bob to move, add or remove a piece.'}</p>
    {canEdit && !latest && <p className="foundation-hint">{value.archived ? 'This drawing is archived, so its pieces cannot be moved.' : `Pieces can only be moved on the newest saved version (${value.current_revision}).`}</p>}
    {flagged > 0 && <p role="status" className="solution-attention">{flagged === 1 ? 'One piece has' : `${flagged} pieces have`} changed since this drawing pinned {flagged === 1 ? 'it' : 'them'}. The plan below still shows the pinned versions.</p>}
    {boxes.length ? <div className="box-drawing-viewport" tabIndex={0} onKeyDown={viewportKey}
      aria-label={editable && current ? `Combined plan view. Arrow keys move ${name(current)} ${SHELL_GRID_MM} mm; R turns it 90°.` : 'Combined plan view'}>
      <svg ref={svg} className="box-drawing-sheet" role="img" aria-label={`Plan view of ${value.title}`} width="100%"
        viewBox={viewBox} style={{ background: 'var(--surface)', maxHeight: '55vh', display: 'block', touchAction: active ? 'none' : undefined }}>
        {placed.map(({ c, f }) => {
          if (!f) return null
          const isActive = c === active?.c, overlap = overlapKeys.has(c.component_key)
          // Pieces keep their order while dragging: moving a node would drop its pointer capture.
          return <g key={c.component_key} data-piece={c.component_key}
            className={editable ? 'shell-piece' + (isActive ? ' is-active' : '') : undefined}
            onPointerDown={editable ? e => pointerDown(e, c) : undefined}
            onPointerMove={editable ? pointerMove : undefined}
            onPointerUp={editable ? e => pointerEnd(e, false) : undefined}
            onPointerCancel={editable ? e => pointerEnd(e, true) : undefined}>
            <rect x={f.x} y={-(f.y + f.depth)} width={f.width} height={f.depth}
              fill={overlap ? 'var(--clay-bg)' : isActive ? 'var(--honey-bg)' : 'var(--surface-2)'} fillOpacity={isActive ? 0.8 : 0.55}
              stroke={c.status === 'current' ? 'var(--brand)' : 'var(--clay)'} strokeWidth={font / 6}
              strokeDasharray={c.status === 'current' ? undefined : `${font / 2} ${font / 3}`} />
            <text x={f.x + f.width / 2} y={-(f.y + f.depth / 2)} fontSize={font} textAnchor="middle" dominantBaseline="middle" fill="var(--ink)">{name(c)}</text>
          </g>
        })}
        {overlaps.map(([a, b]) => {
          const fa = placed.find(p => p.c === a)!.f!, fb = placed.find(p => p.c === b)!.f!
          const x = Math.max(fa.x, fb.x), y = Math.max(fa.y, fb.y)
          const w = Math.min(fa.x + fa.width, fb.x + fb.width) - x, d = Math.min(fa.y + fa.depth, fb.y + fb.depth) - y
          return <rect key={`${a.component_key}:${b.component_key}`} x={x} y={-(y + d)} width={w} height={d} fill="var(--clay)" fillOpacity={0.3}
            stroke="var(--clay)" strokeWidth={font / 6} strokeDasharray={`${font / 3} ${font / 4}`} pointerEvents="none" />
        })}
        {active?.f && <g pointerEvents="none" data-active-outline="">
          <rect x={active.f.x} y={-(active.f.y + active.f.depth)} width={active.f.width} height={active.f.depth} fill="none" stroke="var(--accent-2)" strokeWidth={font / 3} />
          {(dragging || changed) && <text x={active.f.x + active.f.width / 2} y={-(active.f.y + active.f.depth) - font * 0.6} fontSize={font * 1.2} textAnchor="middle"
            fill="var(--ink)" stroke="var(--surface)" strokeWidth={font / 4} paintOrder="stroke">x {formatDrawingMm(active.p.x_mm)} · y {formatDrawingMm(active.p.y_mm)}</text>}
        </g>}
      </svg>
    </div> : <p className="solution-attention">No piece has a saved size yet, so the plan view cannot be drawn.</p>}
    {overlaps.length > 0 && <p role="status" className="solution-attention shell-overlap">
      Footprints overlap: {overlaps.map(([a, b]) => `${name(a)} and ${name(b)}`).join('; ')}. Footprints are the pieces' outer boxes, not a measured clash check, so you can still save.
    </p>}
    {editable && current && shown && <div className="shell-move" role="group" aria-label={`Move ${name(current)}`}>
      <p className="shell-move-title"><strong>Moving {name(current)}</strong></p>
      <p className="shell-move-readout" aria-live="polite">{where(shown)}{changed ? ' · not saved yet' : ''}</p>
      <div className="shell-move-controls">
        <div className="shell-move-pad">
          <button type="button" className="btn shell-up" aria-label={`Move up ${SHELL_GRID_MM} mm`} disabled={!!busy} onClick={() => nudge(0, 1)}>↑</button>
          <button type="button" className="btn shell-left" aria-label={`Move left ${SHELL_GRID_MM} mm`} disabled={!!busy} onClick={() => nudge(-1, 0)}>←</button>
          <button type="button" className="btn shell-right" aria-label={`Move right ${SHELL_GRID_MM} mm`} disabled={!!busy} onClick={() => nudge(1, 0)}>→</button>
          <button type="button" className="btn shell-down" aria-label={`Move down ${SHELL_GRID_MM} mm`} disabled={!!busy} onClick={() => nudge(0, -1)}>↓</button>
        </div>
        <button type="button" className="btn" disabled={!!busy} onClick={turn}>Turn 90°</button>
      </div>
      <p className="foundation-hint">Each step is {SHELL_GRID_MM} mm. Dragging snaps to the same grid.</p>
      <label className="ui-field">
        <div className="ui-field-label">Why it goes here (optional)</div>
        <input style={inputStyle} value={reason} maxLength={200} placeholder={DEFAULT_REASON} onChange={e => setReason(e.target.value)} disabled={!!busy} />
      </label>
      <div className="foundation-actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-primary" disabled={!changed || !!busy || conflict} onClick={save}>{busy === 'place' ? 'Saving…' : 'Save position'}</button>
        {changed && <button type="button" className="btn" disabled={!!busy} onClick={undo}>Undo move</button>}
        {!changed && <button type="button" className="btn" disabled={!!busy} onClick={() => { setSelected(''); setNotice('') }}>Done moving</button>}
      </div>
    </div>}
    {error && <p role="alert" className="solution-attention">{error}</p>}
    {conflict && onReload && <button type="button" className="btn" disabled={!!busy} onClick={() => void reload()}>{busy === 'reload' ? 'Reloading…' : 'Reload drawing'}</button>}
    {notice && <p role="status" className="foundation-hint">{notice}</p>}
    <ul className="fact-list" aria-label="Pieces in this drawing" style={{ listStyle: 'none', padding: 0 }}>
      {placed.map(({ c }) => { const f = shellFootprint(c); return <li key={c.component_key} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <Link to={`/artifacts?drawing=${encodeURIComponent(c.child_artifact_id)}&revision=${c.child_revision}`}><strong>{name(c)}</strong></Link>
        {' '}· version {c.child_revision}
        <div className="foundation-actions" style={{ marginTop: 6 }}>
          <span className="image-purpose">{STATUS[c.status]}</span>
          <span className="image-purpose">{SHELL_BASIS_LABELS[c.placement_basis]}</span>
          {overlapKeys.has(c.component_key) && <span className="image-purpose">Footprints overlap</span>}
        </div>
        <p className="foundation-hint" style={{ margin: '6px 0' }}>
          At x {formatDrawingMm(c.x_mm)}, y {formatDrawingMm(c.y_mm)}, height {formatDrawingMm(c.z_mm)} mm{c.rz ? `, turned ${c.rz}°` : ''}
          {f ? ` · footprint ${formatDrawingMm(f.width)} × ${formatDrawingMm(f.depth)} mm` : ''}. {c.reason}
        </p>
        <div className="foundation-actions">
          {editable && f && <button type="button" className="btn" aria-pressed={selected === c.component_key} aria-label={`Move ${name(c)}`}
            disabled={!!busy || (!!pending && pending !== c)} onClick={() => { if (selected === c.component_key && !changed) setSelected(''); else select(c) }}>Move</button>}
          {c.status === 'newer_revision' && editable && <button type="button" className="btn" disabled={!!busy || !!pending} onClick={() => void command('adopt', c, {}, 'Could not update the piece. Nothing was changed.')}>
            {busy === c.component_key ? 'Updating…' : `Use newest version (${c.child_current_revision})`}
          </button>}
        </div>
      </li> })}
    </ul>
  </section>
}
