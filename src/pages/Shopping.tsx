import { useEffect, useState } from 'react'
import * as db from '../data/database'
import { Icon, Loading, MaterialPill, useAsync } from '../components/ui'
import type { Material } from '../data/types'

/** Parse "1 920 kr" → 1920 for a rough running total. */
function parseCost(cost: string): number {
  const digits = cost.replace(/[^\d]/g, '')
  return digits ? parseInt(digits, 10) : 0
}

export function Shopping() {
  const { data: groups } = useAsync(() => db.getMaterialsGrouped(), [])
  const { data: materials } = useAsync(() => db.getMaterials(), [])
  const [bought, setBought] = useState<Record<string, boolean>>({})

  // Treat already-delivered materials as ticked off.
  useEffect(() => {
    if (!materials) return
    const seed: Record<string, boolean> = {}
    materials.forEach((m) => (seed[m.id] = m.status === 'delivered'))
    setBought(seed)
  }, [materials])

  const total = materials?.length ?? 0
  const picked = Object.values(bought).filter(Boolean).length
  const estTotal = (materials ?? []).reduce((sum, m) => sum + parseCost(m.cost), 0)

  const row = (m: Material, last: boolean) => {
    const on = bought[m.id]
    return (
      <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px', borderBottom: last ? 'none' : '1px solid var(--line)', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!on} onChange={() => setBought((b) => ({ ...b, [m.id]: !b[m.id] }))} style={{ display: 'none' }} />
        <Icon name={on ? 'check-square' : 'square'} weight={on ? 'fill' : 'regular'} size={20} color={on ? 'var(--leaf)' : 'var(--ink-faint)'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: on ? 'var(--ink-faint)' : 'var(--ink)', textDecoration: on ? 'line-through' : 'none' }}>{m.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{m.qty} · {m.area} · {m.supplier}</div>
        </div>
        <span className="no-print"><MaterialPill status={m.status} /></span>
        <span style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600, width: 78, textAlign: 'right' }}>{m.cost}</span>
      </label>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Shopping list</h1>
          <p className="page-sub">Every material across the build, grouped by category.</p>
        </div>
        <div className="cluster no-print">
          <button className="btn" onClick={() => window.print()}><Icon name="printer" size={15} /> Print</button>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13.5, color: 'var(--ink-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 200, height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: total ? `${(picked / total) * 100}%` : '0%', height: '100%', background: 'var(--leaf)', borderRadius: 999, transition: 'width .3s ease' }} />
          </div>
          <span style={{ fontWeight: 600 }}>{picked} / {total} sorted</span>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="receipt" size={15} color="var(--accent-2)" /> Est. total <strong style={{ color: 'var(--ink)' }}>{estTotal.toLocaleString('sv-SE')} kr</strong>
        </span>
      </div>

      {!groups ? (
        <Loading />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', marginTop: 18, alignItems: 'start' }}>
          {groups.map((g) => (
            <div key={g.category} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                <Icon name={g.icon} weight="fill" size={18} color="var(--accent-2)" />
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{g.category}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-faint)', marginLeft: 'auto' }}>{g.items.length} items</span>
              </div>
              {g.items.map((m, i) => row(m, i === g.items.length - 1))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
