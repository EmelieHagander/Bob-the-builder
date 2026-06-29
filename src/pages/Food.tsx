import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { Avatar, Icon, Loading, SectionTitle, useAsync } from '../components/ui'

export function Food() {
  const { data: meals } = useAsync(() => db.getMeals(), [])
  const { data: columns } = useAsync(() => db.getDietColumns(), [])
  const { data: matrix } = useAsync(() => db.getDietMatrix(), [])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const { data: summary } = useAsync(() => db.getFoodSummary(), [])

  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Food</h1>
          <p className="page-sub">Meal plan and allergies for the next build day.</p>
        </div>
        <Link to="/food/shopping" className="btn btn-primary no-print">
          <Icon name="shopping-cart-simple" size={15} /> Food shopping list
        </Link>
      </div>

      {summary && (
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 9, background: 'var(--honey-bg)', border: '1px solid #e7d3a8', borderRadius: 'var(--r)', padding: '12px 15px', color: '#7c5410', fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="users-three" weight="fill" size={17} />
          {summary}
        </div>
      )}

      {/* Meal plan */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle icon="fork-knife">Meal plan</SectionTitle>
        {!meals ? (
          <Loading />
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
            {meals.map((m) => (
              <div key={m.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={m.icon} weight="fill" size={19} color="var(--accent-2)" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{m.meal}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{m.time}</div>
                  </div>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 12 }}>{m.dish}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.4 }}>{m.notes}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Allergy matrix */}
      <div style={{ marginTop: 28 }}>
        <SectionTitle icon="warning" color="var(--clay)">Allergy & dietary matrix</SectionTitle>
        {!matrix || !columns || !people ? (
          <Loading />
        ) : (
          <div className="card" style={{ padding: 4, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '12px 14px', fontSize: 12.5, color: 'var(--ink-soft)', position: 'sticky', left: 0, background: 'var(--surface)' }}>Person</th>
                  {columns.map((c) => (
                    <th key={c} style={{ padding: '12px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{c}</th>
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
                        const isAllergy = columns[i].toLowerCase().includes('allergy')
                        return (
                          <td key={i} style={{ textAlign: 'center', padding: '10px' }}>
                            <Icon
                              name={flag ? (isAllergy ? 'warning' : 'check-circle') : 'minus'}
                              weight={flag ? 'fill' : 'regular'}
                              size={18}
                              color={flag ? (isAllergy ? 'var(--clay)' : 'var(--leaf)') : 'var(--ink-faint)'}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
