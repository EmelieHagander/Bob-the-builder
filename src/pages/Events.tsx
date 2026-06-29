import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { AvatarStack, Icon, Loading, useAsync } from '../components/ui'

export function Events() {
  const { data: events } = useAsync(() => db.getEvents(), [])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Build events</h1>
          <p className="page-sub">The days when work happens. Sign up so the organiser knows to expect you.</p>
        </div>
        <button className="btn btn-primary no-print">
          <Icon name="plus" weight="bold" size={15} /> New event
        </button>
      </div>

      {!events ? (
        <Loading />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', marginTop: 22 }}>
          {events.map((e) => {
            const [taken, cap] = e.spots.split('/').map((s) => parseInt(s, 10))
            const pct = Math.round((taken / cap) * 100)
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

                <Link
                  to={`/events/${e.slug}`}
                  className="font-display no-print"
                  style={{
                    marginTop: 'auto',
                    paddingTop: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    fontWeight: 800,
                    fontSize: 14.5,
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
                      ...(going
                        ? { background: 'var(--leaf-bg)', border: '1px solid var(--leaf)', color: 'var(--leaf)' }
                        : { background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: '0 3px 0 var(--accent-2)' }),
                    }}
                  >
                    <Icon name={going ? 'check' : 'hand-waving'} size={16} weight={going ? 'bold' : 'fill'} />
                    {going ? "You're in — see your tasks" : "I'm coming!"}
                  </span>
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
