import { useRef, useState, type FormEvent } from 'react'
import * as db from '../data/database'
import { volunteerSecret } from '../data/volunteers'
import { Field, FormError, inputStyle } from './form'
import { Loading, useAsync } from './ui'
import { formatDate } from '../lib/format'
import { userErrorMessage } from '../lib/userErrors'

export function VolunteerLinks({ projectId, onBusyChange }: { projectId: string; onBusyChange: (busy: boolean) => void }) {
  const [version, setVersion] = useState(0)
  const { data, loading, error: loadError } = useAsync(() => db.volunteers.list(projectId), [projectId, version])
  const [label, setLabel] = useState('Build volunteers')
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null)
  const [removing, setRemoving] = useState<{ linkId: string | null; sessionId: string | null } | null>(null)
  const pendingSecret = useRef<string | null>(null)
  function pending(value: boolean) { setBusy(value); onBusyChange(value) }
  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy || !label.trim()) return
    pending(true); setError(''); setNotice('')
    try {
      const secret = pendingSecret.current ??= volunteerSecret()
      const receipt = await db.volunteers.create(projectId, label.trim(), secret, days)
      setCreated({ url: window.location.origin + window.location.pathname + '#/volunteer/' + secret, expiresAt: receipt.expiresAt })
      pendingSecret.current = null
      setVersion(value => value + 1)
      setNotice('')
    } catch (reason) { setError(userErrorMessage(reason, 'Could not create the volunteer link. Try again.')) }
    finally { pending(false) }
  }
  async function revoke() {
    if (!removing || busy) return
    pending(true); setError(''); setNotice('')
    try {
      await db.volunteers.revoke(projectId, removing.linkId, removing.sessionId)
      setRemoving(null); setCreated(null); setVersion(value => value + 1)
      setNotice('Volunteer access revoked.')
    } catch (reason) { setError(userErrorMessage(reason, 'Could not revoke volunteer access. Try again.')) }
    finally { pending(false) }
  }
  return <section className="volunteer-link-manager" aria-label="Volunteer links">
    <p className="foundation-hint">Anyone with the link enters their name and joins. No account needed.</p>
    {loading ? <Loading label="Loading volunteer links…" /> : loadError ? <div role="alert"><FormError>{userErrorMessage(loadError, 'Could not load volunteer links.')}</FormError><button className="btn" onClick={() => setVersion(value => value + 1)}>Refresh volunteer links</button></div> : data && <>
      <form onSubmit={create} className="foundation-form">
        <Field label="Link name"><input style={inputStyle} maxLength={120} value={label} disabled={busy} onChange={event => setLabel(event.target.value)} required /></Field>
        <Field label="Link expires after"><select style={inputStyle} value={days} disabled={busy} onChange={event => setDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></Field>
        <button className="btn btn-primary" disabled={busy || !label.trim()}>{busy ? 'Saving…' : 'Create link'}</button>
      </form>
      {created && <div className="volunteer-created">
        <Field label="Link to share"><input style={inputStyle} value={created.url} readOnly onFocus={event => event.target.select()} /></Field>
        <div className="foundation-actions">
          {typeof navigator.share === 'function' && <button className="btn btn-primary" type="button" onClick={async () => {
            try { await navigator.share({ title: label.trim(), url: created.url }) }
            catch (reason) { if ((reason as Error)?.name !== 'AbortError') setError('Sharing is unavailable. Copy the link instead.') }
          }}>Share link</button>}
          <button className="btn" type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(created.url); setNotice('Link copied.') }
            catch { setError('Copy the link from the field above. Automatic copying is unavailable.') }
          }}>Copy link</button>
        </div>
        <p className="foundation-hint">Shown only now. Expires {formatDate(created.expiresAt)}.</p>
      </div>}
      {data.links.length > 0 && <div className="sharing-divider"><h3>Links</h3>
        <ul className="sharing-list">{data.links.map(link => <li key={link.id} className="sharing-row">
          <div><strong>{link.label}</strong><p className="foundation-hint">{link.participants} participants · {link.revokedAt ? 'Revoked' : new Date(link.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Expires ' + formatDate(link.expiresAt)}</p></div>
          {!link.revokedAt && new Date(link.expiresAt).getTime() > Date.now() && <button type="button" className="btn" disabled={busy} onClick={() => setRemoving({ linkId: link.id, sessionId: null })}>Revoke link</button>}
        </li>)}</ul>
      </div>}
      {data.participants.length > 0 && <div className="sharing-divider"><h3>Joined by link</h3><ul className="sharing-list">{data.participants.map(person => {
        const link = data.links.find(link => link.id === person.linkId)
        const ended = person.revokedAt || !link || link.revokedAt || new Date(link.expiresAt).getTime() <= Date.now()
        return <li key={person.id} className="sharing-row"><div><strong>{person.name}</strong><p className="foundation-hint">{ended ? 'Access ended' : link.label}</p></div>{!ended && <button type="button" className="btn" disabled={busy} onClick={() => setRemoving({ linkId: null, sessionId: person.id })}>Revoke participant</button>}</li>
      })}</ul></div>}
      {removing && <div className="sharing-confirm"><p>{removing.linkId ? 'End access for this link and all its volunteers?' : 'End this participant’s current browser access?'}</p><div className="foundation-actions"><button className="btn" disabled={busy} onClick={() => setRemoving(null)}>Keep access</button><button className="btn btn-primary" disabled={busy} onClick={() => void revoke()}>Confirm revocation</button></div></div>}
    </>}
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    {notice && <p className="sharing-status" role="status">{notice}</p>}
  </section>
}
