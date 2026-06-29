import * as db from '../data/database'
import { Avatar, Icon, Loading, useAsync } from '../components/ui'

export function Announcements() {
  const { data: announcements } = useAsync(() => db.getAnnouncements(), [])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const { data: me } = useAsync(() => db.getPerson('em'), [])
  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  const sorted = [...(announcements ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-sub">Day-of info and changes. Pinned posts stay up top.</p>
        </div>
      </div>

      {/* Composer */}
      {me && (
        <div className="card no-print" style={{ padding: 16, marginTop: 18, display: 'flex', gap: 12 }}>
          <Avatar person={me} size={38} />
          <div style={{ flex: 1 }}>
            <textarea
              placeholder="Share an update with the whole crew…"
              rows={2}
              style={{ width: '100%', resize: 'vertical', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 13px', fontSize: 14, background: 'var(--surface-2)', color: 'var(--ink)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 9 }}>
              <button className="btn btn-primary"><Icon name="megaphone" weight="fill" size={15} /> Post update</button>
            </div>
          </div>
        </div>
      )}

      {!announcements ? (
        <Loading />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginTop: 18, maxWidth: 760 }}>
          {sorted.map((a) => {
            const who = byId.get(a.authorId)
            if (!who) return null
            return (
              <div key={a.id} className="card" style={{ padding: 17, borderColor: a.pinned ? 'var(--accent)' : 'var(--line)' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Avatar person={who} size={40} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{who.name}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>{who.role}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>{a.time}</span>
                      {a.pinned && (
                        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: 'var(--accent-2)' }}>
                          <Icon name="push-pin" weight="fill" size={13} /> Pinned
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5, marginTop: 7 }}>{a.text}</p>
                    <div className="no-print" style={{ display: 'flex', gap: 18, marginTop: 11, fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="heart" size={16} /> {a.reacts}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="chat-circle" size={16} /> {a.comments}</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
