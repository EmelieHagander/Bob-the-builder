import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { Field, FormError, inputStyle } from './form'
import { Icon, Loading } from './ui'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Clear unverified reads and ignore replies for a previous resource. */
function useSharingResource<T>(read: () => Promise<T>, version = 0) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef(0)
  const mounted = useRef(false)
  const reload = useCallback(async () => {
    if (!mounted.current) return false
    const current = ++request.current
    setLoading(true)
    setError('')
    try {
      const next = await read()
      if (!mounted.current || current !== request.current) return false
      setData(next)
      return true
    } catch (reason) {
      if (mounted.current && current === request.current) {
        setData(null)
        setError(message(reason))
      }
      return false
    } finally {
      if (mounted.current && current === request.current) setLoading(false)
    }
  }, [read])
  useEffect(() => {
    mounted.current = true
    setData(null)
    void reload()
    return () => { mounted.current = false; request.current++ }
  }, [reload, version])
  return { data, loading, error, reload }
}

function SharingError({ error, retry, busy = false }: { error: string; retry?: () => void; busy?: boolean }) {
  return <div className="sharing-feedback" role="alert">
    <FormError>{error}</FormError>
    {retry && <button className="btn" type="button" onClick={retry} disabled={busy}>Refresh sharing</button>}
  </div>
}

export function BuildingSharingCard({ buildingId, buildingName, onChanged }: {
  buildingId: string; buildingName: string; onChanged?: () => void
}) {
  const read = useCallback(async () => {
    const [sharing, directory] = await Promise.all([db.sharing.building(buildingId), db.sharing.directory()])
    return { sharing, directory }
  }, [buildingId])
  const { data, loading, error, reload } = useSharingResource(read)
  const [householdId, setHouseholdId] = useState('')
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!data) return
    setHouseholdId(data.sharing.householdId ?? '')
    setProjectIds(data.sharing.projects.filter(project => project.buildingId === buildingId).map(project => project.id))
  }, [data, buildingId])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!data || busy || !data.sharing.canManage) return
    setBusy(true); setWriteError(''); setNotice('')
    try {
      await db.sharing.saveBuilding({ buildingId, householdId: householdId || null, expected: data.sharing.revision, projectIds: householdId ? projectIds : [] })
      const verified = await reload()
      setNotice(verified ? 'Building sharing saved.' : 'The change was saved, but sharing could not be read back. Refresh before making another change.')
      onChanged?.()
    } catch (reason) { setWriteError(message(reason)) }
    finally { setBusy(false) }
  }

  const knownHousehold = !householdId || data?.directory.households.some(household => household.id === householdId)
  const initialProjectIds = data?.sharing.projects.filter(project => project.buildingId === buildingId).map(project => project.id) ?? []
  const changed = data && (householdId !== (data.sharing.householdId ?? '') || projectIds.length !== initialProjectIds.length || projectIds.some(id => !initialProjectIds.includes(id)))

  return <section className="card foundation-section sharing-card no-print" aria-label={`Household sharing for ${buildingName}`}>
    <div className="foundation-heading"><h3><Icon name="house" size={18} /> Share this building with family</h3></div>
    <p className="foundation-hint">Your household can edit the building together and collaborate on the projects you choose below. Direct building members manage its sharing.</p>
    {loading ? <Loading label="Loading building sharing…" /> : error ? <SharingError error={error} retry={() => void reload()} /> : data && <>
      {!data.sharing.canManage ? <p className="foundation-hint">Building sharing is managed by its direct members. Your access to physical details is shown above.</p> : <form onSubmit={save}>
        <fieldset className="foundation-form fact-fieldset" disabled={busy}>
          <Field label="Building household">
            <select style={inputStyle} value={householdId} onChange={event => { setHouseholdId(event.target.value); if (!event.target.value) setProjectIds(initialProjectIds); setNotice('') }}>
              <option value="">No household sharing</option>
              {!knownHousehold && <option value={householdId} disabled>Current household (unavailable)</option>}
              {data.directory.households.map(household => <option key={household.id} value={household.id}>{household.name}</option>)}
            </select>
          </Field>
          {data.directory.households.length === 0 && <p className="foundation-hint">No households are available. Use your household in MaidIn or Hearth &amp; Larder, then refresh sharing here.</p>}
          <fieldset className="fact-fieldset">
            <legend className="sharing-label">Also share these linked projects</legend>
            <p className="foundation-hint">Choose each project explicitly. Its whole crew workspace will follow this building’s household. Projects with their own saved sharing choice are managed from that project.</p>
            {data.sharing.projects.length === 0 ? <p className="foundation-hint">No linked projects are available for you to share. Link a project to this building from that project’s Building &amp; spaces page.</p> : <div className="sharing-projects">
              {data.sharing.projects.map(project => <div key={project.id} className="sharing-project-row"><label className="foundation-check">
                <input type="checkbox" disabled={!householdId || Boolean(project.buildingId || project.householdId) || project.revision > 0} checked={projectIds.includes(project.id)} onChange={event => setProjectIds(current => event.target.checked ? [...current, project.id] : current.filter(id => id !== project.id))} />
                <span>{project.name}{project.buildingId === buildingId && <small>Already follows this building</small>}{project.buildingId && project.buildingId !== buildingId && <small>Follows another building</small>}{project.householdId && <small>Shared directly with a household</small>}{!project.buildingId && !project.householdId && project.revision > 0 && <small>Project crew only (set in project)</small>}</span>
              </label>{(project.buildingId || project.householdId || project.revision > 0) && <Link className="btn" to="/people" onClick={() => db.setActiveProject(project.id)}>Manage in project</Link>}</div>)}
            </div>}
          </fieldset>
          <p className="foundation-hint">Stopping household sharing ends access inherited from this building and projects that follow it. To stop one project following the building, use Manage in project. Existing direct crew access and accepted friend invitations still apply.</p>
          {writeError && <SharingError error={writeError} retry={() => { setWriteError(''); void reload() }} busy={busy} />}
          <div className="foundation-actions"><button className="btn btn-primary" disabled={busy || !changed || !knownHousehold}>{busy ? 'Saving…' : 'Save building sharing'}</button><button type="button" className="btn" onClick={() => { setNotice(''); void reload() }}>Refresh sharing</button></div>
        </fieldset>
      </form>}
    </>}
    {notice && <p className="sharing-status" role="status">{notice}</p>}
  </section>
}

type SharingMode = 'private' | 'household' | 'building'

export function ProjectSharingCard({ projectId, version = 0, onChanged }: { projectId: string; version?: number; onChanged?: () => void }) {
  const read = useCallback(async () => {
    const [sharing, directory] = await Promise.all([db.sharing.project(projectId), db.sharing.directory()])
    return { sharing, directory }
  }, [projectId])
  const { data, loading, error, reload } = useSharingResource(read, version)
  const [mode, setMode] = useState<SharingMode>('private')
  const [householdId, setHouseholdId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [notice, setNotice] = useState('')
  const [removing, setRemoving] = useState('')

  useEffect(() => {
    if (!data) return
    setMode(data.sharing.buildingId ? 'building' : data.sharing.householdId ? 'household' : 'private')
    setHouseholdId(data.sharing.householdId ?? '')
    setBuildingId(data.sharing.buildingId ?? '')
    setRemoving('')
  }, [data])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!data || busy || !data.sharing.canManage) return
    setBusy(true); setWriteError(''); setNotice('')
    try {
      await db.sharing.saveProject({ projectId, householdId: mode === 'household' ? householdId : null, buildingId: mode === 'building' ? buildingId : null, expected: data.sharing.revision })
      setNotice(await reload() ? 'Project sharing saved.' : 'The change was saved, but sharing could not be read back. Refresh before making another change.')
      onChanged?.()
    } catch (reason) { setWriteError(message(reason)) }
    finally { setBusy(false) }
  }

  async function revoke(invitationId: string) {
    if (busy) return
    setBusy(true); setWriteError(''); setNotice('')
    try {
      await db.sharing.revokeInvitation(invitationId)
      setNotice(await reload() ? 'Invitation access removed. Other crew or household access may still apply.' : 'Invitation access was removed, but the list could not be refreshed.')
      onChanged?.()
    } catch (reason) { setWriteError(message(reason)) }
    finally { setBusy(false) }
  }

  const selectedBuilding = data?.sharing.buildings.find(building => building.id === buildingId)
  const knownHousehold = data?.directory.households.some(household => household.id === householdId)
  const valid = mode === 'private' || (mode === 'household' && knownHousehold) || (mode === 'building' && selectedBuilding)
  const targetHousehold = mode === 'household' ? householdId : null
  const targetBuilding = mode === 'building' ? buildingId : null
  const changed = data && (targetHousehold !== data.sharing.householdId || targetBuilding !== data.sharing.buildingId)
  const invitations = data?.sharing.invitations.filter(invitation => invitation.status === 'pending' || invitation.status === 'accepted') ?? []

  return <section className="card foundation-section sharing-card no-print" aria-label="Project sharing">
    <div className="foundation-heading"><h2><Icon name="users-three" size={18} /> Project sharing</h2><Link to="/building" className="btn">Building &amp; spaces</Link></div>
    <p className="foundation-hint">Share the whole project with a household, or let it follow one linked building’s household. Simply linking a building does not share this project.</p>
    {loading ? <Loading label="Loading project sharing…" /> : error ? <SharingError error={error} retry={() => void reload()} /> : data && <>
      {!data.sharing.canManage ? <p className="foundation-hint">A project member manages household sharing and invitations.</p> : <form onSubmit={save}>
        <fieldset className="foundation-form fact-fieldset" disabled={busy}>
          <Field label="Share project with">
            <select style={inputStyle} value={mode} onChange={event => { setMode(event.target.value as SharingMode); setNotice('') }}>
              <option value="private">Project crew only</option><option value="household">A household</option><option value="building">Follow a building’s household</option>
            </select>
          </Field>
          {mode === 'household' && <><Field label="Project household"><select style={inputStyle} value={householdId} onChange={event => setHouseholdId(event.target.value)}>
            <option value="">Choose a household</option>{householdId && !knownHousehold && <option value={householdId} disabled>Current household (unavailable)</option>}{data.directory.households.map(household => <option key={household.id} value={household.id}>{household.name}</option>)}
          </select></Field><p className="foundation-hint">Everyone in this household can collaborate on this project. Households are shared with MaidIn and Hearth &amp; Larder.</p></>}
          {mode === 'building' && <><Field label="Follow building"><select style={inputStyle} value={buildingId} onChange={event => setBuildingId(event.target.value)}>
            <option value="">Choose a linked building</option>{buildingId && !selectedBuilding && <option value={buildingId} disabled>Current building (unavailable)</option>}{data.sharing.buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
          </select></Field><p className="foundation-hint">{selectedBuilding ? `${selectedBuilding.name}: ${selectedBuilding.householdName || (selectedBuilding.householdId ? 'shared household' : 'no household sharing')}. This project follows future changes to that building’s household.` : 'Choose one of this project’s linked buildings. Link a building from Building & spaces if none is listed.'}</p></>}
          <p className="foundation-hint">Household sharing covers the whole project and its existing building context. Stopping it ends inherited household access; direct crew and accepted friend invitations still apply.</p>
          <div className="foundation-actions"><button className="btn btn-primary" disabled={busy || !changed || !valid}>{busy ? 'Saving…' : 'Save project sharing'}</button><button className="btn" type="button" onClick={() => { setWriteError(''); setNotice(''); void reload() }}>Refresh sharing</button></div>
        </fieldset>
      </form>}
      <div className="sharing-divider"><h3>Friend invitations</h3><p className="foundation-hint">Invited friends can collaborate on this project after accepting in Bob. They can read its existing building context; this invitation does not give them building edit rights or access to other projects.</p>
        {invitations.length === 0 ? <p className="foundation-hint">No pending or accepted friend invitations.</p> : <ul className="sharing-list">{invitations.map(invitation => <li key={invitation.id} className="sharing-row">
          <div><strong>{invitation.name}</strong><span className="image-purpose">{invitation.status === 'pending' ? 'Pending acceptance' : 'Accepted'}</span></div>
          {data.sharing.canManage && (removing === invitation.id ? <div className="sharing-confirm"><p className="foundation-hint">Remove access from this invitation? Other crew or household access may still apply.</p><div className="foundation-actions"><button type="button" className="btn" disabled={busy} onClick={() => setRemoving('')}>Keep invitation</button><button type="button" className="btn" disabled={busy} onClick={() => void revoke(invitation.id)}>{busy ? 'Removing…' : 'Confirm removal'}</button></div></div> : <button type="button" className="btn" disabled={busy} onClick={() => setRemoving(invitation.id)}>{invitation.status === 'pending' ? 'Cancel invitation' : 'Remove invitation access'}</button>)}
        </li>)}</ul>}
      </div>
    </>}
    {writeError && <SharingError error={writeError} retry={() => { setWriteError(''); void reload() }} busy={busy} />}
    {notice && <p className="sharing-status" role="status">{notice}</p>}
  </section>
}

export function FriendInviteForm({ projectId, onInvited, onBusyChange }: { projectId: string; onInvited?: () => void; onBusyChange: (busy: boolean) => void }) {
  const read = useCallback(async () => {
    const [sharing, directory] = await Promise.all([db.sharing.project(projectId), db.sharing.directory()])
    return { sharing, directory }
  }, [projectId])
  const { data, loading, error, reload } = useSharingResource(read)
  const [friendId, setFriendId] = useState('')
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [notice, setNotice] = useState('')

  async function invite(event: FormEvent) {
    event.preventDefault()
    if (!friendId || busy || !data?.sharing.canManage) return
    setBusy(true); onBusyChange(true); setWriteError(''); setNotice('')
    try {
      const invitation = await db.sharing.inviteFriend(projectId, friendId)
      const verified = await reload()
      setNotice(verified ? `${invitation.name}: ${invitation.status === 'accepted' ? 'already accepted' : 'invitation pending'}. They can find project invitations in Bob.` : 'The invitation was saved, but its status could not be refreshed. Refresh sharing to check it.')
      setFriendId('')
      onInvited?.()
    } catch (reason) { setWriteError(message(reason)) }
    finally { setBusy(false); onBusyChange(false) }
  }

  return <div className="sharing-invite">
    <p className="foundation-hint">Choose an existing friend. They decide whether to join from their project invitations in Bob.</p>
    {loading ? <Loading label="Loading friends…" /> : error ? <SharingError error={error} retry={() => void reload()} /> : data && (!data.sharing.canManage ? <p className="foundation-hint">A project member can invite friends to this project.</p> : <form className="foundation-form" onSubmit={invite}>
      <Field label="Friend"><select style={inputStyle} value={friendId} onChange={event => setFriendId(event.target.value)} disabled={busy}>
        <option value="">Choose a friend</option>{data.directory.friends.map(friend => {
          const invitation = data.sharing.invitations.find(item => item.inviteeId === friend.id && (item.status === 'pending' || item.status === 'accepted'))
          return <option key={friend.id} value={friend.id} disabled={Boolean(invitation)}>{friend.name}{invitation ? invitation.status === 'pending' ? ' — invitation pending' : ' — accepted' : ''}</option>
        })}
      </select></Field>
      {data.directory.friends.length === 0 && <p className="foundation-hint">No existing friends are available. Add a friend in Hearth &amp; Larder, then refresh sharing here.</p>}
      <p className="foundation-hint">The invitation covers this whole project and read access to its building context. Other projects and building editing require their own access.</p>
      <div className="foundation-actions"><button type="submit" className="btn btn-primary" disabled={busy || !friendId}>{busy ? 'Inviting…' : 'Invite friend'}</button><button type="button" className="btn" onClick={() => void reload()} disabled={busy}>Refresh sharing</button></div>
    </form>)}
    {writeError && <SharingError error={writeError} />}
    {notice && <p className="sharing-status" role="status">{notice}</p>}
  </div>
}

export function ProjectInvitations({ onChanged }: { onChanged?: (projectId?: string) => void }) {
  const read = useCallback(() => db.sharing.invitations(), [])
  const { data, loading, error, reload } = useSharingResource(read)
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [notice, setNotice] = useState('')
  const [acceptedProject, setAcceptedProject] = useState('')
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function openAcceptedProject(projectId: string) {
    const projects = await db.getProjects()
    if (!mounted.current) return
    if (!projects.some(project => project.id === projectId)) throw new Error('Project access is not available yet. Refresh project access to try again.')
    db.setActiveProject(projectId)
    setAcceptedProject('')
    onChanged?.(projectId)
  }

  async function respond(id: string, accept: boolean) {
    if (busy) return
    setBusy(true); setWriteError(''); setNotice('')
    let accepted = false
    try {
      const result = await db.sharing.respondInvitation(id, accept)
      if (accept) { accepted = true; setAcceptedProject(result.projectId) }
      const verified = await reload()
      if (accept) await openAcceptedProject(result.projectId)
      else onChanged?.()
      setNotice(accept ? 'Invitation accepted.' : verified ? 'Invitation declined.' : 'Invitation declined, but the list could not be refreshed.')
    } catch (reason) { setWriteError(`${accepted ? 'Invitation accepted, but Bob could not reload the project. ' : ''}${message(reason)}`) }
    finally { setBusy(false) }
  }

  return <section className="card foundation-section sharing-card no-print" aria-label="Project invitations">
    <div className="foundation-heading"><h2>Project invitations</h2><button className="btn" type="button" disabled={busy || loading} onClick={() => void reload()}>Refresh invitations</button></div>
    {loading ? <Loading label="Loading invitations…" /> : error ? <SharingError error={error} /> : <>
      {(data ?? []).filter(invitation => invitation.status === 'pending').length === 0 ? <p className="foundation-hint">No project invitations waiting for you.</p> : <ul className="sharing-list">{data!.filter(invitation => invitation.status === 'pending').map(invitation => <li key={invitation.id} className="sharing-row">
        <div><strong>{invitation.projectName}</strong><p className="foundation-hint">{invitation.inviterName} invited you to collaborate on this project.</p></div>
        <div className="foundation-actions"><button className="btn btn-primary" type="button" disabled={busy} onClick={() => void respond(invitation.id, true)}>Accept invitation</button><button className="btn" type="button" disabled={busy} onClick={() => void respond(invitation.id, false)}>Decline</button></div>
      </li>)}</ul>}
    </>}
    {writeError && <SharingError error={writeError} />}
    {acceptedProject && <button className="btn" disabled={busy} onClick={async () => {
      setBusy(true); setWriteError('')
      try { await openAcceptedProject(acceptedProject) } catch (reason) { setWriteError(message(reason)) } finally { setBusy(false) }
    }}>Refresh project access</button>}
    {busy && <p className="foundation-hint" role="status">Updating invitation and checking access…</p>}
    {notice && <p className="sharing-status" role="status">{notice}</p>}
  </section>
}
