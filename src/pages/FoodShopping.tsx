import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { Icon, Loading, useAsync } from '../components/ui'

export function FoodShopping() {
  const { data: groups } = useAsync(() => db.getFoodShopping(), [])
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  // Seed checkbox state from the data's initial "checked" flags.
  useEffect(() => {
    if (!groups) return
    const seed: Record<string, boolean> = {}
    groups.forEach((g, gi) => g.items.forEach((it, ii) => (seed[`${gi}-${ii}`] = it.checked)))
    setChecked(seed)
  }, [groups])

  const total = groups?.reduce((n, g) => n + g.items.length, 0) ?? 0
  const picked = Object.values(checked).filter(Boolean).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Food shopping</h1>
          <p className="page-sub">For the next build day. Scaled to confirmed headcount.</p>
        </div>
        <div className="cluster no-print">
          <Link to="/food" className="btn"><Icon name="arrow-left" size={15} /> Back to food</Link>
          <button className="btn" onClick={() => window.print()}><Icon name="printer" size={15} /> Print</button>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--ink-soft)' }}>
        <div style={{ flex: 1, maxWidth: 280, height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ width: total ? `${(picked / total) * 100}%` : '0%', height: '100%', background: 'var(--leaf)', borderRadius: 999, transition: 'width .3s ease' }} />
        </div>
        <span style={{ fontWeight: 600 }}>{picked} / {total} picked up</span>
      </div>

      {!groups ? (
        <Loading />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', marginTop: 18 }}>
          {groups.map((g, gi) => (
            <div key={g.category} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 11 }}>
                <Icon name={g.icon} weight="fill" size={18} color="var(--accent-2)" />
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{g.category}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-faint)', marginLeft: 'auto' }}>{g.items.length} items</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {g.items.map((it, ii) => {
                  const key = `${gi}-${ii}`
                  const on = checked[key]
                  return (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 2px', borderTop: ii ? '1px solid var(--line)' : 'none', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!on} onChange={() => setChecked((c) => ({ ...c, [key]: !c[key] }))} style={{ display: 'none' }} />
                      <Icon name={on ? 'check-square' : 'square'} weight={on ? 'fill' : 'regular'} size={20} color={on ? 'var(--leaf)' : 'var(--ink-faint)'} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: on ? 'var(--ink-faint)' : 'var(--ink)', textDecoration: on ? 'line-through' : 'none' }}>{it.name}</div>
                        {it.note && <div style={{ fontSize: 12, color: 'var(--clay)' }}>{it.note}</div>}
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600 }}>{it.qty}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
