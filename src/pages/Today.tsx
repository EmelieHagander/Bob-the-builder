import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { AvatarStack, Icon, Loading, SkillPill, StatusPill, statusCheck, useAsync } from '../components/ui'

export function Today() {
  const { data: tasks } = useAsync(() => db.getTodayTasks(), [])
  const { data: next } = useAsync(() => db.getNextEvent(), [])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="page-title">What needs doing today</h1>
      {next && <p className="page-sub">{next.title} · {next.day} · {next.time}</p>}

      {next && (
        <div style={{ marginTop: 16, background: 'var(--brand)', color: 'var(--brand-ink)', borderRadius: 'var(--r)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
          <Icon name="cooking-pot" weight="fill" size={17} color="var(--accent)" />
          <span style={{ color: '#ffffffe0' }}>{next.food}</span>
        </div>
      )}

      {!tasks ? (
        <Loading />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
          {tasks.map((t) => {
            const chk = statusCheck(t.status)
            return (
              <div key={t.id} className="card" style={{ padding: 15 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
                  <Icon name={chk.icon} size={24} color={chk.color} style={{ marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)', fontWeight: 600 }}>{t.areaName}</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{t.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                      <SkillPill level={t.skill} />
                      <StatusPill status={t.status} />
                      <AvatarStack people={resolve(t.assigneeIds)} max={4} size={24} />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Link to="/areas" className="btn no-print" style={{ marginTop: 18 }}>
        <Icon name="squares-four" size={15} /> Browse all areas
      </Link>
    </div>
  )
}
