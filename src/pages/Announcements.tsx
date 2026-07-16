import { useState, type FormEvent } from 'react'
import * as db from '../data/database'
import { Avatar, Icon, Loading, useAsync } from '../components/ui'
import { useAuthTick } from '../components/Layout'
import { FormError } from '../components/form'

export function Announcements() {
  const tick = useAuthTick()
  const [version, setVersion] = useState(0)
  const { data: announcements } = useAsync(() => db.getAnnouncements(), [version])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const { data: me } = useAsync(() => db.getCurrentUser(), [tick])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  const sorted = [...(announcements ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned))

  const post = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    setError(null)
    db.postAnnouncement(draft.trim())
      .then(() => {
        setDraft('')
        setVersion((v) => v + 1)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  const act = (action: () => Promise<unknown>) => {
    setError(null)
    action()
      .then(() => setVersion((v) => v + 1))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }
  // One heart per post per session — enough to stop accidental double-taps.
  const [hearted, setHearted] = useState<Record<string, boolean>>({})
  const [confirming, setConfirming] = useState<string | null>(null)

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
        <form className="card no-print" onSubmit={post} style={{ padding: 16, marginTop: 18, display: 'flex', gap: 12 }}>
          <Avatar person={me} size={38} />
          <div style={{ flex: 1 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Share an update with the whole crew…"
              rows={2}
              style={{ width: '100%', resize: 'vertical', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 13px', fontSize: 14, background: 'var(--surface-2)', color: 'var(--ink)' }}
            />
            {error && <div style={{ marginTop: 9 }}><FormError>{error}</FormError></div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 9 }}>
              <button type="submit" className="btn btn-primary" disabled={!draft.trim() || busy}>
                <Icon name="megaphone" weight="fill" size={15} /> {busy ? 'Posting…' : 'Post update'}
              </button>
            </div>
          </div>
        </form>
      )}

      {!announcements ? (
        <Loading />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginTop: 18, maxWidth: 760 }}>
          {sorted.map((a) => {
            // The author may belong to another project on the account (or be
            // gone) — show the post anyway rather than dropping it.
            const who = byId.get(a.authorId) ?? { initials: '?', color: 'var(--ink-faint)', name: 'Crew member', role: '' }
            return (
              <div key={a.id} className="card" style={{ padding: 17, borderColor: a.pinned ? 'var(--accent)' : 'var(--line)' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Avatar person={who} size={40} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{who.name}</span>
                      {who.role && (
                        <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>{who.role}</span>
                      )}
                      <span style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>{a.time}</span>
                      {a.pinned && (
                        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: 'var(--accent-2)' }}>
                          <Icon name="push-pin" weight="fill" size={13} /> Pinned
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5, marginTop: 7 }}>{a.text}</p>
                    <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 11, fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600 }}>
                      <button
                        title="React"
                        disabled={!!hearted[a.id]}
                        onClick={() => {
                          setHearted((h) => ({ ...h, [a.id]: true }))
                          act(() => db.reactToAnnouncement(a.id))
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, font: 'inherit', color: hearted[a.id] ? 'var(--clay)' : 'inherit', cursor: 'pointer' }}
                      >
                        <Icon name="heart" weight={hearted[a.id] ? 'fill' : 'regular'} size={16} /> {a.reacts}
                      </button>
                      <button
                        title={a.pinned ? 'Unpin' : 'Pin to top'}
                        onClick={() => act(() => db.setAnnouncementPinned(a.id, !a.pinned))}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
                      >
                        <Icon name="push-pin" weight={a.pinned ? 'fill' : 'regular'} size={16} /> {a.pinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button
                        title="Delete post"
                        onClick={() => (confirming === a.id ? act(() => db.deleteAnnouncement(a.id)) : setConfirming(a.id))}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, font: 'inherit', color: confirming === a.id ? 'var(--clay)' : 'inherit', cursor: 'pointer', marginLeft: 'auto' }}
                      >
                        <Icon name="trash" size={15} /> {confirming === a.id ? 'Really delete?' : ''}
                      </button>
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
