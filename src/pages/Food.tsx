import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { Meal } from '../data/types'
import { Avatar, EmptyState, Icon, Loading, SectionTitle, useAsync } from '../components/ui'
import { MealModal } from '../components/editors'

export function Food() {
  const [version, setVersion] = useState(0)
  const { data: meals } = useAsync(() => db.getMeals(), [version])
  const { data: columns } = useAsync(() => db.getDietColumns(), [version])
  const { data: matrix } = useAsync(() => db.getDietMatrix(), [version])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const { data: summary } = useAsync(() => db.getFoodSummary(), [version])
  const [mealModal, setMealModal] = useState<{ meal?: Meal } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flagBusy, setFlagBusy] = useState<string | null>(null)

  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  // Click a cell to flip a dietary flag. Creates the default columns on
  // first use for projects that never had any.
  const toggleFlag = async (personId: string, columnId: string, on: boolean) => {
    const key = `${personId}:${columnId}`
    setFlagBusy(key)
    setError(null)
    try {
      await db.setDietFlag(personId, columnId, !on)
      setVersion((v) => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFlagBusy(null)
    }
  }

  const seedColumns = async () => {
    setError(null)
    try {
      await db.ensureDietColumns()
      setVersion((v) => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Food</h1>
          <p className="page-sub">Meal plan and allergies for the next build day.</p>
        </div>
        <div className="cluster no-print">
          <button className="btn" onClick={() => setMealModal({})}>
            <Icon name="plus" weight="bold" size={15} /> Add meal
          </button>
          <Link to="/food/shopping" className="btn btn-primary">
            <Icon name="shopping-cart-simple" size={15} /> Food shopping list
          </Link>
        </div>
      </div>

      {summary && (
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 9, background: 'var(--honey-bg)', border: '1px solid #e7d3a8', borderRadius: 'var(--r)', padding: '12px 15px', color: '#7c5410', fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="users-three" weight="fill" size={17} />
          {summary}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, background: 'var(--clay-bg)', border: '1px solid #e0b3a8', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#8a3b2b' }}>
          {error}
        </div>
      )}

      {/* Meal plan */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle icon="fork-knife">Meal plan</SectionTitle>
        {!meals ? (
          <Loading />
        ) : meals.length === 0 ? (
          <EmptyState icon="cooking-pot" title="No meals planned yet" hint="Add breakfast, lunch and fika so the crew knows what's cooking." />
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
            {meals.map((m) => (
              <button
                key={m.id}
                type="button"
                className="card"
                title="Edit meal"
                onClick={() => setMealModal({ meal: m })}
                style={{ padding: 16, textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={m.icon} weight="fill" size={19} color="var(--accent-2)" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{m.meal}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{m.time}</div>
                  </div>
                  <Icon name="pencil-simple" size={14} color="var(--ink-faint)" />
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 12 }}>{m.dish}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.4 }}>{m.notes}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Allergy matrix */}
      <div style={{ marginTop: 28 }}>
        <SectionTitle icon="warning" color="var(--clay)">Allergy & dietary matrix</SectionTitle>
        {!matrix || !columns || !people ? (
          <Loading />
        ) : columns.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            <EmptyState icon="warning" title="No dietary columns yet" hint="Set up the standard set (vegetarian, vegan, gluten-free…) and tick who's who." />
            <button className="btn no-print" onClick={() => void seedColumns()}>
              <Icon name="plus" weight="bold" size={14} /> Set up the standard columns
            </button>
          </div>
        ) : (
          <>
            <p className="no-print" style={{ fontSize: 12.5, color: 'var(--ink-faint)', margin: '0 0 8px' }}>
              Tap a cell to flip it — green check means yes, warning means allergy.
            </p>
            <div className="card" style={{ padding: 4, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '12px 14px', fontSize: 12.5, color: 'var(--ink-soft)', position: 'sticky', left: 0, background: 'var(--surface)' }}>Person</th>
                    {columns.map((c) => (
                      <th key={c.id} style={{ padding: '12px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row) => {
                    const person = byId.get(row.personId)
                    if (!person) return null
                    return (
                      <tr key={row.personId} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '10px 14px', position: 'sticky', left: 0, background: 'var(--surface)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <Avatar person={person} size={28} />
                            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{person.name.split(' ')[0]}</span>
                          </div>
                        </td>
                        {row.flags.map((flag, i) => {
                          const column = columns[i]
                          if (!column) return null
                          const isAllergy = column.name.toLowerCase().includes('allergy')
                          const key = `${row.personId}:${column.id}`
                          return (
                            <td key={column.id} style={{ textAlign: 'center', padding: 0 }}>
                              <button
                                type="button"
                                title={`${person.name.split(' ')[0]} · ${column.name}: ${flag ? 'yes' : 'no'}`}
                                disabled={flagBusy === key}
                                onClick={() => void toggleFlag(row.personId, column.id, flag)}
                                style={{ background: 'none', border: 'none', padding: '10px', cursor: 'pointer', opacity: flagBusy === key ? 0.4 : 1 }}
                              >
                                <Icon
                                  name={flag ? (isAllergy ? 'warning' : 'check-circle') : 'minus'}
                                  weight={flag ? 'fill' : 'regular'}
                                  size={18}
                                  color={flag ? (isAllergy ? 'var(--clay)' : 'var(--leaf)') : 'var(--ink-faint)'}
                                />
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {mealModal && (
        <MealModal
          meal={mealModal.meal}
          onClose={() => setMealModal(null)}
          onDone={() => {
            setMealModal(null)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}
