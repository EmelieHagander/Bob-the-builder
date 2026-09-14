import { useRef, useState, type FormEvent } from 'react'
import * as db from '../data/database'
import { volunteerSecret } from '../data/volunteers'
import { Field, FormError, inputStyle } from './form'
import { Loading, useAsync } from './ui'

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
      setNotice('Volunteer link created. Copy it and share it with your volunteers.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { pending(false) }
  }
  async function revoke() {
    if (!removing || busy) return
    pending(true); setError(''); setNotice('')
    try {
      await db.volunteers.revoke(projectId, removing.linkId, removing.sessionId)
      setRemoving(null); setCreated(null); setVersion(value => value + 1)
      setNotice('Volunteer access revoked.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { pending(false) }
  }
  return <section className="volunteer-link-manager" aria-label="Volunteer links">
    <p className="foundation-hint">Volunteers open your link and enter their name. No email, password or account. They can read project tasks, instructions and build days, join tasks and update their own work.</p>
    <p className="foundation-hint">When food is planned, volunteers may share allergies with the project crew. Volunteer links never show other participants’ allergy notes.</p>
    {loading ? <Loading label="Loading volunteer links…" /> : loadError ? <div role="alert"><FormError>{loadError.message}</FormError><button className="btn" onClick={() => setVersion(value => value + 1)}>Refresh volunteer links</button></div> : data && <>
      <form onSubmit={create} className="foundation-form">
        <Field label="Volunteer link name"><input style={inputStyle} maxLength={120} value={label} disabled={busy} onChange={event => setLabel(event.target.value)} required /></Field>
        <Field label="Link expires after"><select style={inputStyle} value={days} disabled={busy} onChange={event => setDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></Field>
        <button className="btn btn-primary" disabled={busy || !label.trim()}>{busy ? 'Saving…' : 'Create volunteer link'}</button>
      </form>
      {created && <div className="volunteer-created">
        <Field label="Link to share"><input style={inputStyle} value={created.url} readOnly onFocus={event => event.target.select()} /></Field>
        <button className="btn" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(created.url); setNotice('Volunteer link copied.') }
          catch { setError('Copy the link from the field above. Automatic copying is unavailable.') }
        }}>Copy volunteer link</button>
        <p className="foundation-hint">Save this link now; its full address is shown only here. It expires {new Date(created.expiresAt).toLocaleDateString()}.</p>
      </div>}
      <div className="sharing-divider"><h3>Existing volunteer links</h3>
        <p className="foundation-hint">Anyone you give a link to can register a name in this project. Revoking a link also ends access for everyone who joined through it.</p>
        {!data.links.length ? <p className="foundation-hint">No volunteer links yet.</p> : <ul className="sharing-list">{data.links.map(link => <li key={link.id} className="sharing-row">
          <div><strong>{link.label}</strong><p className="foundation-hint">{link.participants} participants · {link.revokedAt ? 'Revoked' : new Date(link.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Expires ' + new Date(link.expiresAt).toLocaleDateString()}</p></div>
          {!link.revokedAt && new Date(link.expiresAt).getTime() > Date.now() && <button type="button" className="btn" disabled={busy} onClick={() => setRemoving({ linkId: link.id, sessionId: null })}>Revoke link</button>}
        </li>)}</ul>}
      </div>
      {data.participants.length > 0 && <div className="sharing-divider"><h3>Volunteers using these links</h3><p className="foundation-hint">A participant’s access belongs to their browser. Names are not verified. Revoke the shared link to prevent new registrations.</p><ul className="sharing-list">{data.participants.map(person => {
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
