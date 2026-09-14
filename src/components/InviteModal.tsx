/*
 * Invite someone to a project's crew. Used from the account dashboard and the
 * People page. Live mode records the email server-side so signing in with it
 * claims the person; demo mode just adds them to the sample crew.
 */

import { useEffect, useState, type FormEvent } from 'react'
import * as db from '../data/database'
import type { Project } from '../data/types'
import { Modal } from './Modal'
import { Field, FormError, inputStyle } from './form'
import { FriendInviteForm } from './SharingCards'
import { VolunteerLinks } from './VolunteerLinks'

export function InviteModal({
  projects,
  defaultProjectId,
  onClose,
  onInvited,
}: {
  projects: Project[]
  defaultProjectId: string
  onClose: () => void
  onInvited?: () => void
}) {
  const [projectId, setProjectId] = useState(projects.some(project => project.id === defaultProjectId) ? defaultProjectId : '')
  const [method, setMethod] = useState<'volunteer' | 'friend' | 'email'>('volunteer')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invited, setInvited] = useState<string[]>([])

  useEffect(() => {
    if (!projects.some(project => project.id === projectId)) setProjectId(projects.some(project => project.id === defaultProjectId) ? defaultProjectId : '')
  }, [projects, projectId, defaultProjectId])

  const chooseProject = (id: string) => {
    setProjectId(id)
    setError(null)
    setInvited([])
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!projectId || !name.trim() || !email.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await db.invitePerson(projectId, name.trim(), email.trim())
      setInvited((list) => [...list, `${name.trim()} (${email.trim()})`])
      setName('')
      setEmail('')
      onInvited?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Invite to the crew" onClose={() => { if (!busy) onClose() }}>
      <div className="foundation-form sharing-invite">
        <Field label="Project">
          <select style={{ ...inputStyle, appearance: 'auto' }} value={projectId} onChange={(e) => chooseProject(e.target.value)} disabled={busy}>
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="foundation-actions" role="group" aria-label="Invitation method">
          <button type="button" className={`btn${method === 'volunteer' ? ' btn-primary' : ''}`} aria-pressed={method === 'volunteer'} disabled={busy} onClick={() => { setMethod('volunteer'); setError(null) }}>Volunteer link</button>
          <button type="button" className={`btn${method === 'friend' ? ' btn-primary' : ''}`} aria-pressed={method === 'friend'} disabled={busy} onClick={() => { setMethod('friend'); setError(null) }}>Existing friend</button>
          <button type="button" className={`btn${method === 'email' ? ' btn-primary' : ''}`} aria-pressed={method === 'email'} disabled={busy} onClick={() => { setMethod('email'); setError(null) }}>Crew by email</button>
        </div>
        {!projectId ? <p className="foundation-hint">Choose the project you want to invite someone to.</p> : method === 'volunteer' ? <VolunteerLinks key={projectId} projectId={projectId} onBusyChange={setBusy} /> : method === 'friend' ? <FriendInviteForm key={projectId} projectId={projectId} onInvited={onInvited} onBusyChange={setBusy} /> : <form onSubmit={submit} className="foundation-form">
        <p className="foundation-hint">Save a crew profile linked to an email address. They claim it when they sign in with that address. This does not send an email.</p>
        <Field label="Name *">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Henrik Lund" disabled={busy} required />
        </Field>
        <Field label="Email *">
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="henrik@example.se" disabled={busy} required />
        </Field>
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        {invited.length > 0 && (
          <div className="sharing-status" role="status">
            Crew profiles saved: {invited.join(', ')}
          </div>
        )}
        <div className="cluster" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={!projectId || !name.trim() || !email.trim() || busy}>
            {busy ? 'Saving…' : 'Add crew profile'}
          </button>
        </div>
      </form>}
        <div className="foundation-actions" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose} disabled={busy}>Done</button></div>
      </div>
    </Modal>
  )
}
