import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { savedCutSheets } from '../domain/savedCutPlan'
import { drawingUrl } from './ProjectDrawings'
import { Modal } from './Modal'
import { Loading, LoadFailed, useAsync } from './ui'
import './StorageBoxDrawing.css'

const kinds = { hypothetical: 'Hypothetical format', stock: 'Saved stock format', catalog_part: 'Catalog product format' }

export function SavedCutPlan({ projectId, id, revision, source, onClose }: {
  projectId: string; id: string; revision: number; source: { id: string; revision: number } | null; onClose: () => void
}) {
  const [attempt, retry] = useState(0)
  const { data, loading, error } = useAsync(async () => {
    const plan = await db.getConstructionCutPlanVersion(projectId, id, revision)
    return { plan, sheets: savedCutSheets(plan, source) }
  }, [projectId, id, revision, source?.id, source?.revision, attempt], { timeoutMs: 20000 })
  const result = !loading && !error && data?.plan.id === id && data.plan.revision === revision ? data : null
  return <Modal title={`Saved cut plan · Version ${revision}`} wide onClose={onClose}>
    {loading ? <Loading label="Reading the saved cutting layout…" /> : error ? <LoadFailed what="The saved cut plan" onRetry={() => retry(n => n + 1)} /> : null}
    {result && <>
      <p>Construction version {result.plan.artifact_revision} · {result.sheets.length} {result.sheets.length === 1 ? 'sheet' : 'sheets'} used in this saved layout.</p>
      {result.plan.current_revision !== revision && <p className="solution-attention">A newer cut plan version exists. This is saved version {revision}.</p>}
      {result.plan.source_state !== 'current' && <p className="solution-attention">The construction or material sources have changed. This layout is historical and needs review.</p>}
      <p className="solution-attention">Not approved for cutting. The layout does not verify material condition, fixing, strength or safe working.</p>
      <Link className="btn" to={drawingUrl({ id: result.plan.artifact_id, revision: result.plan.artifact_revision })}>Open source construction</Link>
      {result.sheets.map(sheet => <section key={sheet.id} style={{ marginTop: 'var(--section-gap)' }} aria-label={`Sheet ${sheet.number}`}>
        <h4>Sheet {sheet.number} · {sheet.length} × {sheet.width} × {sheet.thickness} mm</h4>
        <p>{kinds[sheet.kind]} · kerf {sheet.kerf} mm · edge trim {sheet.trim} mm · {sheet.grain === 'none' ? 'no grain restriction' : `grain along ${sheet.grain}`}.</p>
        {sheet.note && <p className="foundation-hint">{sheet.note}</p>}
        <svg role="img" aria-label={`Saved placement of ${sheet.parts.length} parts on sheet ${sheet.number}. Exact dimensions follow in the table.`}
          viewBox={`0 0 ${sheet.length} ${sheet.width}`} style={{ width: '100%', maxHeight: 360, display: 'block', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          {sheet.parts.map((part, i) => <rect key={i} x={part.x} y={part.y} width={part.length} height={part.width}
            fill="var(--accent)" stroke="var(--ink)" strokeWidth={1} vectorEffect="non-scaling-stroke"><title>{part.label}: {part.length} × {part.width} mm</title></rect>)}
        </svg>
        <p className="foundation-hint">Positions in millimetres from the top left of the sheet. Length runs horizontally; width runs vertically.</p>
        <div className="box-parts" tabIndex={0} aria-label={`Parts on sheet ${sheet.number}`}><table>
          <thead><tr><th>Part</th><th>Size (mm)</th><th>Position (mm)</th></tr></thead>
          <tbody>{sheet.parts.map((part, i) => <tr key={i}><td>{part.label}</td><td>{part.length} × {part.width}</td><td>{part.x}, {part.y}</td></tr>)}</tbody>
        </table></div>
        <details><summary>Saved cuts ({sheet.cuts.length}) and offcuts ({sheet.offcuts.length})</summary>
          <p className="foundation-hint">Cuts are listed in their saved order. Position is measured on the named axis; span is measured on the other axis.</p>
          <div className="box-parts" tabIndex={0} aria-label={`Cuts on sheet ${sheet.number}`}><table>
            <thead><tr><th>Cut</th><th>Axis</th><th>Position (mm)</th><th>Span (mm)</th><th>Kerf (mm)</th></tr></thead>
            <tbody>{sheet.cuts.map((cut, i) => <tr key={i}><td>{i + 1}</td><td>{cut.axis}</td><td>{cut.position}</td><td>{cut.start}–{cut.end}</td><td>{cut.kerf}</td></tr>)}</tbody>
          </table></div>
          {!sheet.offcuts.length ? <p>No offcuts recorded.</p> : <ul>{sheet.offcuts.map((offcut, i) => <li key={i}>{offcut.length} × {offcut.width} mm at {offcut.x}, {offcut.y} mm</li>)}</ul>}
        </details>
      </section>)}
      <p className="foundation-hint">Opening this plan does not reserve stock or add purchases. <Link to="/shopping">Open Shopping</Link> to read saved purchasing rows.</p>
    </>}
  </Modal>
}
