import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { FoodItem } from '../data/types'
import { ChecklistRow, EmptyState, Icon, Loading, useAsync } from '../components/ui'
import { FoodItemModal } from '../components/editors'

export function FoodShopping() {
  const [version, setVersion] = useState(0)
  const { data: groups } = useAsync(() => db.getFoodShopping(), [version])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [adding, setAdding] = useState(false)

  // Seed checkbox state from the stored "checked" flags.
  useEffect(() => {
    if (!groups) return
    const seed: Record<string, boolean> = {}
    groups.forEach((g) => g.items.forEach((it) => (seed[it.id] = it.checked)))
    setChecked(seed)
  }, [groups])

  // Ticks persist for the whole crew. Optimistic — reverts if the write fails.
  const toggle = (item: FoodItem) => {
    const next = !checked[item.id]
    setChecked((c) => ({ ...c, [item.id]: next }))
    db.setFoodItemChecked(item.id, next).catch(() => {
      setChecked((c) => ({ ...c, [item.id]: !next }))
    })
  }

  const total = groups?.reduce((n, g) => n + g.items.length, 0) ?? 0
  const picked = Object.values(checked).filter(Boolean).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Food shopping</h1>
          <p className="page-sub">For the next build day. Ticks are shared — the whole crew sees what's bought.</p>
        </div>
        <div className="cluster no-print">
          <Link to="/food" className="btn"><Icon name="arrow-left" size={15} /> Back to food</Link>
          <button className="btn" onClick={() => window.print()}><Icon name="printer" size={15} /> Print</button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" weight="bold" size={15} /> Add item
          </button>
        </div>
      </div>

      <div style={{ marginTop: 'var(--section-gap)', display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)', fontSize: 13.5, color: 'var(--ink-soft)' }}>
        <div style={{ flex: 1, maxWidth: 280, height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ width: total ? `${(picked / total) * 100}%` : '0%', height: '100%', background: 'var(--leaf)', borderRadius: 999, transition: 'width .3s ease' }} />
        </div>
        <span style={{ fontWeight: 600 }}>{picked} / {total} picked up</span>
      </div>

      {!groups ? (
        <Loading />
      ) : groups.length === 0 ? (
        <div style={{ marginTop: 'var(--section-gap)' }}>
          <EmptyState icon="basket" title="Nothing on the food list yet" hint="Add what the build day needs — it lands here grouped by category." />
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', marginTop: 'var(--section-gap)' }}>
          {groups.map((g) => (
            <div key={g.category} className="card" style={{ padding: 'var(--panel-padding)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)', marginBottom: 11 }}>
                <Icon name={g.icon} weight="fill" size={18} color="var(--accent-2)" />
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{g.category}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-faint)', marginLeft: 'auto' }}>{g.items.length} items</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {g.items.map((it) => {
                  const on = checked[it.id]
                  return (
                    <ChecklistRow key={it.id} checked={!!on} onChange={() => toggle(it)} trailing={it.qty}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: on ? 'var(--ink-faint)' : 'var(--ink)', textDecoration: on ? 'line-through' : 'none' }}>{it.name}</div>
                        {it.note && <div style={{ fontSize: 12, color: 'var(--clay)' }}>{it.note}</div>}
                      </div>
                    </ChecklistRow>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <FoodItemModal
          categories={(groups ?? []).map((g) => g.category)}
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
