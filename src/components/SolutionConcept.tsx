import { useState } from 'react'
import { conceptSvg, conceptView } from '../../supabase/functions/_shared/solution-concept.ts'
import type { DesignIntent } from '../../supabase/functions/_shared/project-design-intent.ts'
import './StorageBoxDrawing.css'

/** The data layer has already validated this exact immutable Solution revision. */
export function SolutionConcept({ intent, revision }: { intent: DesignIntent; revision: number }) {
  const [selected, setSelected] = useState<string | null>(null), [zoom, setZoom] = useState(1)
  if (!intent.model) return null
  const viewId = intent.model.views.some(v => v.id === selected) ? selected! : intent.model.views[0].id
  const result = conceptView(intent, viewId), svg = conceptSvg(intent, viewId)
  return <section className="box-drawing" aria-label="Concept model">
    <h4>Concept model · Version {revision}</h4>
    <p className="foundation-hint">Design values and estimates, not a measured drawing or construction approval. Ask Bob to correct this version.</p>
    <p>Origin: {intent.model.frame.origin}</p>
    <div className="foundation-actions" aria-label="Concept views">
      {intent.model.views.map(v => <button key={v.id} className={`btn${v.id === viewId ? ' btn-primary' : ''}`} aria-pressed={v.id === viewId} onClick={() => { setSelected(v.id); setZoom(1) }}>{v.label} · {v.plane}</button>)}
    </div>
    <p>{result.view.plane} · {result.view.kind === 'section' ? `Principle section · ${['X', 'Y', 'Z'][result.axes[2]]} = ${result.at === null ? 'Unknown' : result.at + ' mm'}` : 'Projection'}</p>
    <div className="foundation-actions">
      <button className="btn" disabled={zoom <= 1} onClick={() => setZoom(n => n - 0.5)} aria-label="Zoom concept out">−</button>
      <button className="btn" disabled={zoom >= 3} onClick={() => setZoom(n => n + 0.5)} aria-label="Zoom concept in">+</button>
      <button className="btn" onClick={() => setZoom(1)}>Fit concept</button>
    </div>
    <div className="box-drawing-viewport" tabIndex={0} aria-label="Concept drawing viewport"><div className="box-drawing-sheet" style={{ width: `${zoom * 100}%` }} dangerouslySetInnerHTML={{ __html: svg }} /></div>
    {!result.shapes.length && <p className="solution-attention">No components can be shown in this view. Check unknown dimensions and the section position.</p>}
    <div className="box-parts" tabIndex={0} aria-label="Concept dimensions"><table>
      <caption>Visible components · concept dimensions in mm</caption>
      <thead><tr><th>Part</th><th>Position</th><th>Size</th></tr></thead>
      <tbody>{result.shapes.map((s, i) => <tr key={s.id}><th scope="row">{i + 1}. {s.label}{s.kind !== 'solid' ? ` · ${s.kind}` : ''}</th><td>{s.x} / {s.y}</td><td>{s.width} × {s.height}</td></tr>)}</tbody>
    </table></div>
    {!!result.issues.length && <div role="status" className="solution-attention"><strong>Needs reconciliation</strong><ul>{result.issues.map((i, n) => <li key={n}>{i.message}</li>)}</ul></div>}
    <details className="ui-row-details"><summary>Dimension sources & assumptions</summary>
      {intent.model.nodes.map(n => <p key={n.id}>{n.role === 'derived' ? 'Derived from concept values' : n.role === 'unknown' ? 'Unknown' : n.role === 'estimate' ? 'Estimated' : 'Design decision'}: {n.role === 'derived' ? result.values.get(n.id)?.value ?? 'Unknown' : n.reason}{'value' in n ? ` · ${n.value} ${n.unit}` : ''}</p>)}
    </details>
  </section>
}
