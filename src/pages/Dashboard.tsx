import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { AvatarStack, Icon, Loading, ProgressBar, Ring, SectionTitle, useAsync } from '../components/ui'

export function Dashboard() {
  const { data: project } = useAsync(() => db.getProject(), [])
  const { data: stats } = useAsync(() => db.getDashboardStats(), [])
  const { data: areas } = useAsync(() => db.getAreas(), [])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const { data: next } = useAsync(() => db.getNextEvent(), [])
  const { data: attention } = useAsync(() => db.getAttention(), [])
  const { data: announcements } = useAsync(() => db.getAnnouncements(), [])
  const { data: me } = useAsync(() => db.getCurrentUser(), [])

  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">God morgon{me ? `, ${me.name.split(' ')[0]}` : ''}!</h1>
          <p className="page-sub">
            {project
              ? `Here's where ${project.name} stands today.${next ? ` The big build day is ${next.day}.` : ''}`
              : ''}
          </p>
        </div>
        <div className="cluster no-print">
          <Link to="/announcements" className="btn">
            <Icon name="megaphone" size={16} /> Post update
          </Link>
          <button className="btn btn-primary">
            <Icon name="plus" weight="bold" size={15} /> New task
          </button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 22 }}>
        {stats?.map((s) => (
          <div key={s.label} style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '14px 15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>
              <Icon name={s.icon} weight="fill" size={15} color={s.color} /> {s.label}
            </div>
            <div className="font-display" style={{ fontWeight: 700, fontSize: 24, marginTop: 6 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 22, marginTop: 24 }}>
        {/* Areas */}
        <section>
          <SectionTitle action={<Link to="/areas" style={{ fontSize: 13, color: 'var(--accent-2)', fontWeight: 600 }}>View all</Link>}>
            Areas <span style={{ color: 'var(--ink-faint)', fontWeight: 600 }}>· {areas?.length ?? 0}</span>
          </SectionTitle>
          {!areas ? (
            <Loading />
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
              {areas.map((a) => {
                const overall = Math.round((a.assignedPct + a.materialsPct + a.donePct) / 3)
                return (
                  <Link key={a.id} to={`/areas/${a.slug}`} className="card" style={{ padding: 15, display: 'block' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={a.icon} size={21} color="var(--brand)" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{a.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{byId.get(a.leadId ?? '')?.name.split(' ')[0]} leads</div>
                      </div>
                      <Ring value={overall} />
                    </div>
                    <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <ProgressBar label="Assigned" value={a.assignedPct} />
                      <ProgressBar label="Materials" value={a.materialsPct} />
                      <ProgressBar label="Done" value={a.donePct} />
                    </div>
                    <div style={{ marginTop: 11, fontSize: 12, color: 'var(--ink-faint)' }}>{a.taskSummary}</div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* Right column */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {next && (
            <Link to={`/events/${next.slug}`} style={{ background: 'var(--brand)', color: 'var(--brand-ink)', borderRadius: 'var(--r)', padding: '17px 17px 16px', display: 'block' }}>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#ffffff90', fontWeight: 700 }}>Next build day</div>
              <div className="font-display" style={{ fontWeight: 700, fontSize: 19, marginTop: 4 }}>{next.title}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, color: '#ffffffd0' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="calendar-dots" size={15} color="var(--accent)" />{next.day}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="clock" size={15} color="var(--accent)" />{next.time}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                <AvatarStack people={resolve(next.attendeeIds)} max={5} />
                <span style={{ fontSize: 12.5, color: '#ffffffc0', fontWeight: 600 }}>{next.spots} spots</span>
              </div>
              <div style={{ marginTop: 13, background: '#ffffff14', borderRadius: 10, padding: '9px 11px', fontSize: 12, color: '#ffffffd5', display: 'flex', gap: 8 }}>
                <Icon name="cooking-pot" weight="fill" size={15} color="var(--accent)" style={{ marginTop: 1 }} />
                <span>{next.food}</span>
              </div>
            </Link>
          )}

          <div className="card" style={{ padding: 16 }}>
            <SectionTitle icon="warning-circle" color="var(--clay)">Needs attention</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {attention?.map((x, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', background: x.tone === 'clay' ? 'var(--clay-bg)' : 'var(--honey-bg)' }}>
                    <Icon name={x.icon} weight="fill" size={14} color={x.tone === 'clay' ? 'var(--clay)' : '#9A6313'} />
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.35 }}>{x.text}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <SectionTitle icon="megaphone" color="var(--accent-2)" action={<Link to="/announcements" style={{ fontSize: 13, color: 'var(--accent-2)', fontWeight: 600 }}>All</Link>}>
              Announcements
            </SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {announcements?.slice(0, 2).map((p) => {
                const who = byId.get(p.authorId)
                return (
                  <div key={p.id} style={{ display: 'flex', gap: 10 }}>
                    {who && <AvatarStack people={[who]} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                        <span style={{ fontWeight: 700 }}>{who?.name.split(' ')[0]}</span>
                        <span style={{ color: 'var(--ink-faint)' }}>{p.time}</span>
                        {p.pinned && <Icon name="push-pin" weight="fill" size={12} color="var(--accent-2)" />}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.4, marginTop: 2 }}>{p.text}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
