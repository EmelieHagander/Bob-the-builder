/*
 * Invite someone to a project: share a join link, or invite a friend with one
 * tap. Used from the account dashboard and the People page. (Owner decision
 * 2026-11-15: no email path; it never sent anything and only confused.)
 */

import { useEffect, useState } from 'react'
import type { Project } from '../data/types'
import { Modal } from './Modal'
import { Field, inputStyle } from './form'
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
  const [method, setMethod] = useState<'volunteer' | 'friend'>('volunteer')
  const [busy, setBusy] = useState(false)
  // Opened from a project: invite to that project, no picker.
  const fixedProject = projects.some(project => project.id === defaultProjectId)

  useEffect(() => {
    if (!projects.some(project => project.id === projectId)) setProjectId(projects.some(project => project.id === defaultProjectId) ? defaultProjectId : '')
  }, [projects, projectId, defaultProjectId])

  return (
    <Modal title="Invite to the crew" onClose={() => { if (!busy) onClose() }}>
      <div className="foundation-form sharing-invite">
        {!fixedProject && <Field label="Project">
          <select style={{ ...inputStyle, appearance: 'auto' }} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy}>
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>}
        <div className="foundation-actions" role="group" aria-label="Invitation method">
          <button type="button" className={`btn${method === 'volunteer' ? ' btn-primary' : ''}`} aria-pressed={method === 'volunteer'} disabled={busy} onClick={() => setMethod('volunteer')}>Share link</button>
          <button type="button" className={`btn${method === 'friend' ? ' btn-primary' : ''}`} aria-pressed={method === 'friend'} disabled={busy} onClick={() => setMethod('friend')}>Friend</button>
        </div>
        {!projectId ? <p className="foundation-hint">Choose the project you want to invite someone to.</p>
          : method === 'volunteer' ? <VolunteerLinks key={projectId} projectId={projectId} onBusyChange={setBusy} />
          : <FriendInviteForm key={projectId} projectId={projectId} onInvited={onInvited} onBusyChange={setBusy} />}
        <div className="foundation-actions" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose} disabled={busy}>Done</button></div>
      </div>
    </Modal>
  )
}
