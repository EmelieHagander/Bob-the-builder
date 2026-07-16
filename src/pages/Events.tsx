import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { AvatarStack, EmptyState, Icon, Loading, useAsync } from '../components/ui'
import { NewEventModal } from '../components/editors'

export function Events() {
  const [version, setVersion] = useState(0)
  const { data: events } = useAsync(() => db.getEvents(), [version])
  const { data: people } = useAsync(() => db.getPeople(), [version])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))

  const join = (id: string) => {
    setError(null)
    db.joinEvent(id)
      .then(() => setVersion((v) => v + 1))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Build events</h1>
          <p className="page-sub">The days when work happens. Sign up so the organiser knows to expect you.</p>
        </div>
        <button className="btn btn-primary no-print" onClick={() => setAdding(true)}>
          <Icon name="plus" weight="bold" size={15} /> New event
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, background: 'var(--clay-bg)', border: '1px solid #e0b3a8', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#8a3b2b' }}>
          {error}
        </div>
      )}

      {!events ? (
        <Loading />
      ) : events.length === 0 ? (
        <div style={{ marginTop: 22 }}>
          <EmptyState icon="calendar-plus" title="No build days yet" hint="Create the first event and the crew can start signing up." />
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', marginTop: 22 }}>
          {events.map((e) => {
            const [taken, cap] = e.spots.split('/').map((s) => parseInt(s, 10))
            const pct = cap > 0 ? Math.round((taken / cap) * 100) : 0
            const going = e.status === 'going'
            return (
              <div key={e.id} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <Link to={`/events/${e.slug}`} className="font-display" style={{ fontWeight: 700, fontSize: 18, color: 'var(--ink)' }}>{e.title}</Link>
                  <span className="pill" style={going ? { color: 'var(--leaf)', background: 'var(--leaf-bg)' } : { color: '#9A6313', background: 'var(--honey-bg)' }}>
                    {going ? "You're going" : 'Spots open'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 11, fontSize: 13, color: 'var(--ink-soft)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="calendar-dots" size={15} color="var(--accent)" />{e.day}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="clock" size={15} color="var(--accent)" />{e.time}</span>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>
                    <span>{e.spots} spots</span>
                  </div>
                  <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: pct >= 70 ? 'var(--leaf)' : 'var(--honey)', borderRadius: 999 }} />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13 }}>
                  <AvatarStack people={resolve(e.attendeeIds)} max={6} />
                </div>

                {going ? (
                  <Link
                    to={`/events/${e.slug}`}
                    className="font-display no-print"
                    style={{ marginTop: 'auto', paddingTop: 14, display: 'block', fontWeight: 800, fontSize: 14.5 }}
                  >
                    <span
                      style={{
                        width: '100%',
                        borderRadius: 13,
                        padding: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 7,
                        background: 'var(--leaf-bg)',
                        border: '1px solid var(--leaf)',
                        color: 'var(--leaf)',
                      }}
                    >
                      <Icon name="check" size={16} weight="bold" />
                      You're in — see your tasks
                    </span>
                  </Link>
                ) : (
                  <button
                    className="font-display no-print"
                    onClick={() => join(e.id)}
                    style={{
                      marginTop: 'auto',
                      border: 'none',
                      background: 'none',
                      padding: '14px 0 0',
                      fontWeight: 800,
                      fontSize: 14.5,
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        width: '100%',
                        borderRadius: 13,
                        padding: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 7,
                        background: 'var(--accent)',
                        color: 'var(--accent-ink)',
                        boxShadow: '0 3px 0 var(--accent-2)',
                      }}
                    >
                      <Icon name="hand-waving" size={16} weight="fill" />
                      I'm coming!
                    </span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <NewEventModal
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
