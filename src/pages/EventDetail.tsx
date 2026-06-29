import { Link, useParams } from 'react-router-dom'
import * as db from '../data/database'
import {
  AvatarStack,
  EmptyState,
  Icon,
  Loading,
  SkillPill,
  StatusPill,
  statusCheck,
  useAsync,
} from '../components/ui'

export function EventDetail() {
  const { slug = '' } = useParams()
  const { data: event, loading } = useAsync(() => db.getEvent(slug), [slug])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const { data: dayTasks } = useAsync(() => db.getTodayTasks(), [])

  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))

  if (loading) return <div className="page"><Loading /></div>
  if (!event) return <div className="page"><EmptyState icon="magnifying-glass" title="Event not found" hint="Check the events list for the right date." /></div>

  const going = event.status === 'going'
  const tasks = going ? dayTasks ?? [] : []

  return (
    <div className="page">
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Link to="/events">Events</Link>
        <Icon name="caret-right" size={12} />
        <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{event.title}</span>
      </div>

      <div className="area-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 22, marginTop: 16 }}>
        <div>
          <div style={{ background: 'var(--brand)', color: 'var(--brand-ink)', borderRadius: 'var(--r-lg)', padding: 22 }}>
            <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#ffffff90', fontWeight: 700 }}>Build day</div>
            <h1 className="font-display" style={{ fontSize: 28, fontWeight: 700, marginTop: 5 }}>{event.title}</h1>
            <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 14, color: '#ffffffd5', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="calendar-dots" size={16} color="var(--accent)" />{event.day}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="clock" size={16} color="var(--accent)" />{event.time}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="map-pin" size={16} color="var(--accent)" />{event.place}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <AvatarStack people={resolve(event.attendeeIds)} max={8} />
              <span style={{ fontSize: 13, color: '#ffffffc8', fontWeight: 600 }}>{event.spots} spots filled</span>
            </div>
            <div style={{ marginTop: 14, background: '#ffffff14', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#ffffffe0', display: 'flex', gap: 8 }}>
              <Icon name="cooking-pot" weight="fill" size={16} color="var(--accent)" style={{ marginTop: 1 }} />
              <span>{event.food}</span>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{going ? 'The plan for the day' : 'Tasks open this day'}</h3>
            {tasks.length === 0 ? (
              <EmptyState icon="list-checks" title="No tasks scheduled yet" hint="Sign up and the organiser will line up jobs for the day." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {tasks.map((t) => {
                  const chk = statusCheck(t.status)
                  return (
                    <div key={t.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 15px' }}>
                      <Icon name={chk.icon} size={22} color={chk.color} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--ink-faint)', fontWeight: 600 }}>{t.areaName}</div>
                        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{t.name}</div>
                        <div style={{ marginTop: 6 }}><SkillPill level={t.skill} /></div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} className="task-right">
                        <AvatarStack people={resolve(t.assigneeIds)} max={3} />
                        <StatusPill status={t.status} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Will you be there?</div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45 }}>One tap. We'll remind you the day before and show your tasks on the day.</p>
            <button
              className="font-display no-print"
              style={{
                width: '100%',
                marginTop: 13,
                borderRadius: 13,
                padding: 12,
                fontSize: 14.5,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                border: going ? '1px solid var(--leaf)' : 'none',
                background: going ? 'var(--leaf-bg)' : 'var(--accent)',
                color: going ? 'var(--leaf)' : 'var(--accent-ink)',
                boxShadow: going ? 'none' : '0 3px 0 var(--accent-2)',
              }}
            >
              <Icon name={going ? 'check' : 'hand-waving'} size={16} weight={going ? 'bold' : 'fill'} />
              {going ? "You're going" : "I'm coming!"}
            </button>
            {going && (
              <Link to="/today" className="btn no-print" style={{ width: '100%', justifyContent: 'center', marginTop: 9 }}>
                <Icon name="sun-horizon" size={15} /> See my tasks today
              </Link>
            )}
          </div>

          <Link to="/food" className="card" style={{ padding: 16, display: 'block' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>
              <Icon name="cooking-pot" weight="fill" size={17} color="var(--accent-2)" /> Food & allergies
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.45 }}>See the meal plan and the allergy matrix for everyone confirmed.</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
