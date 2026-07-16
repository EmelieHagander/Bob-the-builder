/*
 * Invite someone to a project's crew. Used from the account dashboard and the
 * People page. Live mode records the email server-side so signing in with it
 * claims the person; demo mode just adds them to the sample crew.
 */

import { useState, type FormEvent } from 'react'
import * as db from '../data/database'
import type { Project } from '../data/types'
import { Modal } from './Modal'
import { Field, FormError, inputStyle } from './form'

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
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || '')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invited, setInvited] = useState<string[]>([])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || busy) return
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
    <Modal title="Invite to the crew" onClose={onClose}>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45, marginBottom: 14 }}>
        They join the project's crew right away. When they sign in with this email — magic link or password — the profile becomes theirs.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <Field label="Project">
          <select style={{ ...inputStyle, appearance: 'auto' }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name *">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Henrik Lund" autoFocus />
        </Field>
        <Field label="Email *">
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="henrik@example.se" />
        </Field>
        {error && <FormError>{error}</FormError>}
        {invited.length > 0 && (
          <div style={{ background: 'var(--leaf-bg)', border: '1px solid #c4d6ab', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#3f5c22' }}>
            Invited: {invited.join(', ')}
          </div>
        )}
        <div className="cluster" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {invited.length > 0 ? 'Done' : 'Cancel'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !email.trim() || busy}>
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
