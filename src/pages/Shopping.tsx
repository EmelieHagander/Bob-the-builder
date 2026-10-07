import { useBobSurface } from '../lib/bobSurface'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { ChecklistRow, EmptyState, Icon, LoadFailed, Loading, MaterialPill, useAsync } from '../components/ui'
import { MaterialModal } from '../components/editors'
import type { Material } from '../data/types'

/** Parse "1 920 kr" → 1920 for a rough running total. */
function parseCost(cost: string): number {
  const digits = cost.replace(/[^\d]/g, '')
  return digits ? parseInt(digits, 10) : 0
}

export function Shopping() {
  useBobSurface(db.getActiveProjectId() ?? '', { surface: 'shopping' }, 'Shopping')
  const [version, setVersion] = useState(0)
  const projectId = db.getActiveProjectId() ?? ''
  const { data: groups, error: groupsError } = useAsync(() => db.getMaterialsGrouped(), [version])
  const { data: materials, error: materialsError } = useAsync(() => db.getMaterials(), [version])
  const { data: areas } = useAsync(() => db.getAreas(), [version])
  const listError = groupsError ?? materialsError
  const { data: planSources, error: planSourceError } = useAsync(() => db.getMaterialShoppingSources(projectId), [projectId, version])
  const { data: cutPlanSources, error: cutPlanSourceError } = useAsync(() => db.getCutPlanShoppingSources(projectId), [projectId, version])
  const [adding, setAdding] = useState(false)
  const [bought, setBought] = useState<Record<string, boolean>>({})

  // Treat already-delivered materials as ticked off.
  useEffect(() => {
    if (!materials) return
    const seed: Record<string, boolean> = {}
    materials.forEach((m) => (seed[m.id] = m.status === 'delivered'))
    setBought(seed)
  }, [materials])

  // Ticking persists: got it = delivered, unticked goes back to needed.
  // Optimistic — the checkbox flips immediately and reverts if the write fails.
  const toggle = (m: Material) => {
    const next = !bought[m.id]
    setBought((b) => ({ ...b, [m.id]: next }))
    db.setMaterialStatus(m.id, next ? 'delivered' : 'needed').catch(() => {
      setBought((b) => ({ ...b, [m.id]: !next }))
    })
  }

  const total = materials?.length ?? 0
  const picked = Object.values(bought).filter(Boolean).length
  const estTotal = (materials ?? []).reduce((sum, m) => sum + parseCost(m.cost), 0)
  const sourceByMaterial = new Map((planSources ?? []).filter(item => item.materialId).map(item => [item.materialId!, item]))

  const cutSourceByMaterial = new Map((cutPlanSources ?? []).map(item => [item.materialId, item.source]))

  const row = (m: Material) => {
    const on = bought[m.id]
    const source = sourceByMaterial.get(m.id)
    const cutSource = cutSourceByMaterial.get(m.id)
    const displayStatus = on ? 'delivered' : m.status === 'delivered' ? 'needed' : m.status
    return (
      <div key={m.id}><ChecklistRow checked={!!on} onChange={() => toggle(m)} trailing={m.cost}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: on ? 'var(--ink-faint)' : 'var(--ink)', textDecoration: on ? 'line-through' : 'none' }}>{m.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{m.qty} · {m.area} · {m.supplier}</div>
          <div style={{ marginTop: 4, fontSize: 11.5, color: source?.sourceOutdated || source?.sourceStale || source?.shoppingEdited ? 'var(--clay)' : 'var(--ink-faint)' }}>
            {cutSource ? `From cut plans · ${cutSource.contribution_count} active contribution${cutSource.contribution_count === 1 ? '' : 's'}${cutSource.shopping_edited ? ' · shopping row edited' : ''}` : source ? `From material plan${source.sourceOutdated ? ' · plan updated' : ''}${source.sourceStale ? ' · source changed' : ''}${source.shoppingEdited ? ' · shopping row edited' : ''}` : planSourceError || cutPlanSourceError ? 'Source unavailable' : !planSources || !cutPlanSources ? 'Checking source…' : 'Manual shopping item'}
          </div>

        </div>
        <div className="ui-row-meta no-print"><MaterialPill status={displayStatus} /></div>
      </ChecklistRow>
          {cutSource && <details style={{ marginTop: 6, fontSize: 12 }}>
            <summary>Sheet quantities and sources</summary>
            <p>Whole sheets, not finished blanks. Check the saved plan sources, supplier product and pack size before ordering.</p>
            <ul>{cutSource.contributions.map(c => <li key={c.plan_id}>{c.quantity} sheet{c.quantity === 1 ? '' : 's'} · plan revision {c.plan_revision} · <Link to={`/artifacts?drawing=${encodeURIComponent(c.artifact_id)}&revision=${c.artifact_revision}`}>Construction revision {c.artifact_revision}</Link></li>)}</ul>
            {cutSource.truncated && <p>Showing {cutSource.contributions.length} of {cutSource.contribution_count} contributions. Ask Bob to read the remaining plans.</p>}
            {!cutSource.contribution_count && <p>All plan contributions withdrawn. This row is retained for reference.</p>}
          </details>}
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Shopping list</h1>
          <p className="page-sub">Every material across the build, grouped by category.</p>
        </div>
        <div className="cluster no-print foundation-actions">
          <Link className="btn" to="/material-plan"><Icon name="calculator" size={15} /> Material plan</Link>
          <button className="btn" onClick={() => window.print()}><Icon name="printer" size={15} /> Print</button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" weight="bold" size={15} /> Add material
          </button>
        </div>
      </div>

      {listError ? <LoadFailed what="The shopping list" onRetry={() => setVersion(v => v + 1)} /> : <>
      {materials && <div style={{ marginTop: 'var(--section-gap)', display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)', flexWrap: 'wrap', fontSize: 13.5, color: 'var(--ink-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)' }}>
          <div style={{ width: 200, height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: total ? `${(picked / total) * 100}%` : '0%', height: '100%', background: 'var(--leaf)', borderRadius: 999, transition: 'width .3s ease' }} />
          </div>
          <span style={{ fontWeight: 600 }}>{picked} / {total} sorted</span>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="receipt" size={15} color="var(--accent-2)" /> Est. total <strong style={{ color: 'var(--ink)' }}>{estTotal.toLocaleString('sv-SE')} kr</strong>
        </span>
      </div>}

      {(planSourceError || cutPlanSourceError) && <div role="alert" className="card" style={{ padding: 'var(--panel-padding)', marginTop: 'var(--section-gap)' }}>
        Shopping sources could not be checked. <button className="btn" onClick={() => setVersion(v => v + 1)}>Retry sources</button>
      </div>}
      {!groups ? (
        <Loading />
      ) : groups.length === 0 ? (
        <div style={{ marginTop: 'var(--section-gap)' }}>
          <EmptyState icon="package" title="Nothing on the list yet" hint="Add the first material — it lands here grouped by category." />
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', marginTop: 'var(--section-gap)', alignItems: 'start' }}>
          {groups.map((g) => (
            <div key={g.category} className="card" style={{ padding: 'var(--panel-padding)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)', marginBottom: 8 }}>
                <Icon name={g.icon} weight="fill" size={18} color="var(--accent-2)" />
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{g.category}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-faint)', marginLeft: 'auto' }}>{g.items.length} items</span>
              </div>
              {g.items.map(row)}
            </div>
          ))}
        </div>
      )}
      </>}

      {adding && (
        <MaterialModal
          areas={areas ?? []}
          categories={[...new Set((materials ?? []).map((m) => m.category))]}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}
