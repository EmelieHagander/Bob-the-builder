import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { ArtifactVersion } from '../data/artifacts'
import { SHELL_BASIS_LABELS, shellBuildOrder, shellFootprint, shellQuantity, type CadShell, type ShellComponent } from '../lib/cadShell'
import { formatDrawingMm } from '../lib/storageBox'
import './StorageBoxDrawing.css'

const STATUS: Record<ShellComponent['status'], string> = {
  current: 'Up to date',
  newer_revision: 'Newer version saved',
  changed: 'Piece changed',
  archived: 'Piece archived',
  unavailable: 'Piece unavailable',
}

/** Plan view of a shell drawing: each saved piece as its footprint, plus the piece list. */
export function CadShellView({ value, projectId, canEdit, onChanged }: {
  value: CadShell
  projectId: string
  canEdit: boolean
  onChanged?: (next: ArtifactVersion) => void
}) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const latest = value.revision === value.current_revision && !value.archived
  const placed = value.components.map(c => ({ c, f: shellFootprint(c) }))
  const boxes = placed.flatMap(p => p.f ? [p.f] : [])
  const minX = Math.min(...boxes.map(b => b.x)), maxX = Math.max(...boxes.map(b => b.x + b.width))
  const minY = Math.min(...boxes.map(b => b.y)), maxY = Math.max(...boxes.map(b => b.y + b.depth))
  const pad = boxes.length ? Math.max(maxX - minX, maxY - minY) * 0.06 : 0
  const font = boxes.length ? Math.max(maxX - minX, maxY - minY) / 32 : 0
  const flagged = value.components.filter(c => c.status !== 'current').length
  const ordered = shellBuildOrder(placed.map(p => ({ ...p, steps: p.c.steps })))
  const summary = value.plan_summary
  const titleOf = (key: string) => { const c = value.components.find(x => x.component_key === key); return c?.child_title ?? key }

  async function adopt(c: ShellComponent) {
    setBusy(c.component_key); setError('')
    try { onChanged?.(await db.commandCadShell(projectId, 'adopt', value.id, value.revision, { component_key: c.component_key })) }
    catch (e) {
      const message = e instanceof Error ? e.message : ''
      setError(message.includes('cad_shell_changed') ? 'This drawing changed since you opened it. Close and reopen it, then try again.' : 'Could not update the piece. Nothing was changed.')
    } finally { setBusy('') }
  }

  return <section className="box-drawing" aria-label="Combined drawing">
    <p className="foundation-hint">Combines {value.components.length} saved {value.components.length === 1 ? 'drawing' : 'drawings'} by reference. Each piece keeps its own measurements and cut list. Positions are proposals unless marked "Placed by you". Ask Bob to move, add or remove a piece.</p>
    {flagged > 0 && <p role="status" className="solution-attention">{flagged === 1 ? 'One piece has' : `${flagged} pieces have`} changed since this drawing pinned {flagged === 1 ? 'it' : 'them'}. The plan below still shows the pinned versions.</p>}
    {boxes.length ? <div className="box-drawing-viewport" tabIndex={0} aria-label="Combined plan view">
      <svg className="box-drawing-sheet" role="img" aria-label={`Plan view of ${value.title}`} width="100%"
        viewBox={`${minX - pad} ${-(maxY + pad)} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`} style={{ background: 'var(--surface)', maxHeight: '55vh', display: 'block' }}>
        {placed.map(({ c, f }) => f && <g key={c.component_key}>
          <rect x={f.x} y={-(f.y + f.depth)} width={f.width} height={f.depth} fill="var(--surface-2)" fillOpacity={0.55}
            stroke={c.status === 'current' ? 'var(--brand)' : 'var(--clay)'} strokeWidth={font / 6} strokeDasharray={c.status === 'current' ? undefined : `${font / 2} ${font / 3}`} />
          <text x={f.x + f.width / 2} y={-(f.y + f.depth / 2)} fontSize={font} textAnchor="middle" dominantBaseline="middle" fill="var(--ink)">{c.child_title ?? c.component_key}</text>
        </g>)}
      </svg>
    </div> : <p className="solution-attention">No piece has a saved size yet, so the plan view cannot be drawn.</p>}
    {error && <p role="alert" className="solution-attention">{error}</p>}
    {summary && <p className="foundation-hint" role="status">{summary.not_in_plan.length === 0
      ? 'Every piece is linked to a step in the build plan. Pieces are listed in build order.'
      : `${value.components.length - summary.not_in_plan.length} of ${value.components.length} pieces are in the build plan. Ask Bob to link the rest to plan steps.`}</p>}
    <ul className="fact-list" aria-label="Pieces in this drawing" style={{ listStyle: 'none', padding: 0 }}>
      {ordered.map(({ c, f }) => <li key={c.component_key} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <Link to={`/artifacts?drawing=${encodeURIComponent(c.child_artifact_id)}&revision=${c.child_revision}`}><strong>{c.child_title ?? c.component_key}</strong></Link>
        {' '}· version {c.child_revision}
        <div className="foundation-actions" style={{ marginTop: 6 }}>
          <span className="image-purpose">{STATUS[c.status]}</span>
          <span className="image-purpose">{SHELL_BASIS_LABELS[c.placement_basis]}</span>
        </div>
        <p className="foundation-hint" style={{ margin: '6px 0' }}>
          At x {formatDrawingMm(c.x_mm)}, y {formatDrawingMm(c.y_mm)}, height {formatDrawingMm(c.z_mm)} mm{c.rz ? `, turned ${c.rz}°` : ''}
          {f ? ` · footprint ${formatDrawingMm(f.width)} × ${formatDrawingMm(f.depth)} mm` : ''}. {c.reason}
        </p>
        {c.steps && <p className="foundation-hint" style={{ margin: '6px 0' }}>
          <strong>Plan:</strong>{' '}
          {c.steps.length ? c.steps.map((s, i) => <span key={s.id}>{i > 0 && ', '}<Link to={`/project?step=${encodeURIComponent(s.id)}`}>Step {s.position} · {s.title}</Link></span>)
            : 'Not in the plan yet'}
        </p>}
        {c.materials && <p className="foundation-hint" style={{ margin: '6px 0' }}>
          <strong>Materials:</strong>{' '}
          {c.counted_with ? `Same drawing as ${titleOf(c.counted_with)}, counted once there`
            : c.materials.length ? `${c.materials.length} ${c.materials.length === 1 ? 'line' : 'lines'} on this piece${c.materials.some(m => m.needs_review || !m.from_pinned_version) ? ', some need a check' : ''}`
            : 'Not counted yet'}
        </p>}
        {c.status === 'newer_revision' && canEdit && latest && <button type="button" className="btn" disabled={!!busy} onClick={() => adopt(c)}>
          {busy === c.component_key ? 'Updating…' : `Use newest version (${c.child_current_revision})`}
        </button>}
      </li>)}
    </ul>
    {summary && <section aria-label="Materials for the whole drawing" style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 6px' }}>{summary.not_counted.length ? 'Materials so far' : 'Materials for the whole drawing'}</h3>
      <p className="foundation-hint">Adds up each piece's own material list. A piece is counted once even if it is placed twice. Nothing here is a purchase; see the <Link to="/material-plan">material plan</Link>.</p>
      {summary.not_counted.length > 0 && <p role="status" className="solution-attention">
        Not counted yet: {summary.not_counted.map(titleOf).join(', ')}. {summary.not_counted.length === 1 ? 'This piece has' : 'These pieces have'} no material list, so the total below is incomplete.
      </p>}
      {summary.totals.length ? <ul className="fact-list" aria-label="Material totals" style={{ listStyle: 'none', padding: 0 }}>
        {summary.totals.map(t => <li key={`${t.name}:${t.unit}`} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
          <strong>{t.name}</strong>: {shellQuantity(t.required_quantity)} {t.unit}
          <span className="foundation-hint" style={{ display: 'block', margin: '2px 0 0' }}>
            From {t.pieces.map(titleOf).join(', ')}{t.needs_review ? ` · ${t.needs_review === 1 ? 'one line needs' : `${t.needs_review} lines need`} a check (from another version of the piece or the design changed)` : ''}
          </span>
        </li>)}
      </ul> : <p className="foundation-hint">No piece has a material list yet.</p>}
    </section>}
  </section>
}
