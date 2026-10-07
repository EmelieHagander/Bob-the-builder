import { useBobSurface } from '../lib/bobSurface'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { BuildEvent } from '../data/types'
import { formatEventDay } from '../lib/eventDay'
import { AvatarStack, EmptyState, Icon, List, ListItem, LoadFailed, Loading, SummaryRow, useAsync } from '../components/ui'
import { useAuthTick } from '../components/Layout'
import { EventModal } from '../components/editors'

export function Events() {
  useBobSurface(db.getActiveProjectId() ?? '', { surface: 'events' }, 'Build days')
  const tick = useAuthTick()
  const [version, setVersion] = useState(0)
  const { data: events, error: eventsError } = useAsync(() => db.getEvents(), [version])
  const { data: people } = useAsync(() => db.getPeople(), [version])
  const { data: me } = useAsync(() => db.getCurrentUser(), [tick])
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'edit'; event: BuildEvent } | null>(null)
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
        <button className="btn btn-primary no-print" onClick={() => setModal({ kind: 'new' })}>
          <Icon name="plus" weight="bold" size={15} /> New event
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 'var(--section-gap)', background: 'var(--clay-bg)', border: '1px solid #e0b3a8', borderRadius: 'var(--r)', padding: 'var(--row-padding)', fontSize: 13, color: '#8a3b2b' }}>
          {error}
        </div>
      )}

      {eventsError ? (
        <LoadFailed what="Build days" onRetry={() => setVersion((v) => v + 1)} />
      ) : !events ? (
        <Loading />
      ) : events.length === 0 ? (
        <div style={{ marginTop: 'var(--section-gap)' }}>
          <EmptyState icon="calendar-plus" title="No build days yet" hint="Create the first event and the crew can start signing up." />
        </div>
      ) : (
        <List aria-label="Build days">
          {events.map((e) => {
            const going = db.isAttending(e, me?.id)
            const full = db.isFull(e)
            return <ListItem key={e.id}>
              <SummaryRow trailing={<button type="button" className="ui-icon-button no-print" aria-label={`Edit event ${e.title}`} title="Edit event" onClick={() => setModal({ kind: 'edit', event: e })}><Icon name="pencil-simple" size={16} /></button>}>
                <div className="ui-row-title"><Link to={`/events/${e.slug}`}>{e.title}</Link><span className="pill" style={going ? { color: 'var(--leaf)', background: 'var(--leaf-bg)' } : full ? { color: 'var(--clay)', background: 'var(--clay-bg)' } : { color: 'var(--ink-soft)', background: 'var(--honey-bg)' }}>{going ? "You're going" : full ? 'Full' : 'Spots open'}</span></div>
                <div className="ui-row-meta">{formatEventDay(e.day)} · {e.time} · {e.spots} spots</div>
              </SummaryRow>
              <div className="ui-row-actions" style={{ justifyContent: 'space-between' }}>
                <AvatarStack people={resolve(e.attendeeIds)} max={4} size={24} />
                {going ? <Link to={`/events/${e.slug}`} className="btn no-print"><Icon name="check" size={16} /> View tasks</Link>
                  : <button type="button" className="btn no-print" onClick={() => join(e.id)} disabled={full}><Icon name={full ? 'prohibit' : 'hand-waving'} size={16} />{full ? 'This day is full' : "I'm coming!"}</button>}
              </div>
            </ListItem>
          })}
        </List>
      )}

      {modal && (
        <EventModal
          event={modal.kind === 'edit' ? modal.event : undefined}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}
