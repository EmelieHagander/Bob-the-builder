/*
 * The account level's front page: every project on the account, shared
 * notes, and the doors to the calendar and settings. This sits ABOVE the
 * per-project world — opening a project from here decides what the rest of
 * the app shows.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as db from '../../data/database'
import type { AccountNote, Project } from '../../data/types'
import { EmptyState, Icon, List, ListItem, Loading, Panel, SectionTitle, useAsync, useProjectVersion } from '../../components/ui'
import { Modal } from '../../components/Modal'
import { FormError, inputStyle } from '../../components/form'
import { InviteModal } from '../../components/InviteModal'
import { ProjectInvitations } from '../../components/SharingCards'
import { scheduleStatus } from '../../lib/calendarGrid'
import { formatDate, formatDateRange } from '../../lib/format'
import { ProjectModal, SchedulePill } from './ProjectModal'
import { NewProjectForm } from '../../components/NewProjectForm'
import { ProjectThumbnail } from '../../components/ProjectThumbnail'
import { ProjectMetadata } from '../../components/ProjectMetadata'
import { PhasePill } from '../../components/PhaseUI'
import { areaPhaseSummary } from '../../lib/projectPhase'

export function AccountDashboard() {
  const navigate = useNavigate()
  const projectVersion = useProjectVersion()
  const [version, setVersion] = useState(0)
  const [notesVersion, setNotesVersion] = useState(0)
  const { data: account } = useAsync(() => db.getAccount(), [])
  const { data: projects, loading, error: projectError } = useAsync(() => db.getProjects(), [version, projectVersion])
  const { data: active } = useAsync(() => db.getProject(), [version, projectVersion])
  const { data: notes } = useAsync(() => db.getNotes(), [notesVersion])
  const projectIds = (projects ?? []).map(project => project.id)
  const projectIdsKey = projectIds.join('|')
  const { data: accountAreaPhases } = useAsync(() => db.getAccountAreaPhases(projectIds), [projectIdsKey, version, projectVersion])
  const { data: overview, loading: buildingsLoading, error: buildingsError } = useAsync(() => db.getAccountBuildingOverview(projectIds), [projectIdsKey, version, projectVersion])
  const { data: projectOverview, error: overviewError } = useAsync(() => db.getAccountProjectOverview(projectIds), [projectIdsKey, version, projectVersion])
  const [modal, setModal] = useState<
    { kind: 'new' } | { kind: 'invite' } | { kind: 'project'; project: Project; editing: boolean } | null
  >(null)

  const reload = () => setVersion((v) => v + 1)
  const openProject = (p: Project) => {
    db.setActiveProject(p.id)
    navigate('/project')
  }

  const scheduled = (projects ?? []).filter((p) => p.startDate && p.endDate)
  const happeningNow = scheduled.filter((p) => scheduleStatus(p.startDate!, p.endDate!) === 'ongoing')
  const nextUp = scheduled
    .filter((p) => scheduleStatus(p.startDate!, p.endDate!) === 'upcoming')
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!))

  const stats = [
    { icon: 'squares-four', value: String(projects?.length ?? 0), label: 'Projects', color: 'var(--accent)' },
    { icon: 'calendar-check', value: String(happeningNow.length), label: 'Happening now', color: 'var(--leaf)' },
    { icon: 'calendar-dots', value: nextUp[0] ? formatDate(nextUp[0].startDate) : '—', label: 'Next build starts', color: 'var(--honey)' },
    { icon: 'note-pencil', value: String(notes?.length ?? 0), label: 'Notes', color: 'var(--clay)' },
  ]

  const otherProjects = (projects ?? []).filter(project => !overview?.links.some(link => link.projectId === project.id))
  const projectRow = (p: Project) => {
    const phases = (accountAreaPhases ?? []).filter(item => item.projectId === p.id)
    return <ListItem key={p.id} className="account-project-row">
      <ProjectThumbnail projectId={p.id} mediaId={projectOverview?.find(item => item.projectId === p.id)?.thumbnailId} />
      <button type="button" className="account-project-open" aria-label={`Open project ${p.name}`} onClick={() => openProject(p)}>
        <span className="ui-row-title"><span>{p.name}</span><PhasePill phase={p.phase} /></span>
        {p.startDate && p.endDate && <span className="ui-row-meta"><SchedulePill project={p} /> · {formatDateRange(p.startDate, p.endDate)}</span>}
        <ProjectMetadata overview={projectOverview?.find(item => item.projectId === p.id)} />
        {phases.length > 0 && <span className="ui-row-meta">{phases.length} {phases.length === 1 ? 'Area' : 'Areas'} · {areaPhaseSummary(phases)}</span>}
      </button>
      <button type="button" className="ui-icon-button no-print" aria-label={`Project details ${p.name}`} onClick={() => setModal({ kind: 'project', project: p, editing: false })}><Icon name="dots-three" size={20} /></button>
    </ListItem>
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Home</h1>
          <p className="page-sub">{account?.name ? `${account.name} · ` : ''}Your places, your projects. Let’s build something.</p>
        </div>
        <div className="cluster no-print">
          {!active && db.authEnabled() && <button className="btn" onClick={() => void db.signOut()}><Icon name="sign-out" size={16} /> Sign out</button>}
          <Link to="/account/calendar" className="btn">
            <Icon name="calendar-dots" size={16} /> Calendar
          </Link>
          <Link to="/account/buildings" className="btn"><Icon name="house" size={16} /> Buildings & family</Link>
          <button className="btn" onClick={() => setModal({ kind: 'invite' })} disabled={(projects ?? []).length === 0}>
            <Icon name="user-plus" size={16} /> Invite
          </button>
          <Link to="/account/settings" className="btn"><Icon name="gear-six" size={16} /> Settings</Link>
          {active && <button className="btn" onClick={() => { db.setActiveProject(null); navigate('/') }}>
            <Icon name="x-circle" size={16} /> Close project
          </button>}
          <button className="btn btn-primary" onClick={() => setModal({ kind: 'new' })}>
            <Icon name="plus" weight="bold" size={15} /> New project
          </button>
        </div>
      </div>

      {active && <button type="button" className="workbench-resume" onClick={() => openProject(active)}>
        <ProjectThumbnail projectId={active.id} mediaId={projectOverview?.find(item => item.projectId === active.id)?.thumbnailId} />
        <div><small>Pick up where you left off</small><strong>{active.name}</strong><span className="ui-row-meta">{active.phase ? `Open ${active.phase} plan` : 'Open project plan'}</span></div>
        <Icon name="arrow-right" size={20} />
      </button>}
      <div className="account-stats">
        {stats.map((s) => (
          <span key={s.label}><strong>{s.value}</strong> {s.label}</span>
        ))}
      </div>

      <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 'var(--layout-gap)', marginTop: 'var(--section-gap)' }}>
        {/* Projects */}
        <section>
          <SectionTitle>
            Projects <span style={{ color: 'var(--ink-faint)', fontWeight: 600 }}>· {projects?.length ?? 0}</span>
          </SectionTitle>
          {overviewError && <p className="foundation-hint" role="status">Extra project details could not be loaded. <button className="btn" onClick={reload}>Retry details</button></p>}
          {loading ? <Loading /> : projectError ? <div role="alert"><FormError>{projectError.message}</FormError><button className="btn" onClick={reload}>Try again</button></div>
            : <>
              {!projects?.length && <EmptyState icon="squares-four" title="No projects yet" hint="Start one with the button above." />}
              {buildingsLoading && <Loading label="Loading building groups…" />}
              {buildingsError && <div role="alert"><p className="foundation-hint">Building groups could not be loaded. All your projects are listed below.</p><button className="btn" onClick={reload}>Retry building groups</button></div>}
              {overview && overview.buildings.map(building => {
                const grouped = (projects ?? []).filter(project => overview.links.some(link => link.buildingId === building.id && link.projectId === project.id))
                return <details key={building.id} className="account-building-group" open>
                  <summary><ProjectThumbnail /><strong>{building.name}</strong><span className="ui-row-meta">{grouped.length} {grouped.length === 1 ? 'project' : 'projects'}</span></summary>
                  {grouped.length ? <List>{grouped.map(projectRow)}</List> : <p className="foundation-hint">No linked projects.</p>}
                  <Link className="project-detail-link" to={`/account/buildings?building=${encodeURIComponent(building.id)}`}>Building &amp; spaces</Link>
                </details>
              })}
              {projects && projects.length > 0 && (!overview || otherProjects.length > 0) && <section className="account-building-group" aria-label="Other projects">
                {overview && <h3>Other projects <span className="ui-row-meta">· {otherProjects.length}</span></h3>}
                <List>{(overview ? otherProjects : projects).map(projectRow)}</List>
              </section>}
            </>}
        </section>

        {/* Right column: coming up + notes */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--layout-gap)' }}>
          <Panel>
            <SectionTitle
              icon="calendar-dots"
              color="var(--accent-2)"
              action={<Link to="/account/calendar" style={{ fontSize: 13, color: 'var(--accent-2)', fontWeight: 600 }}>Calendar</Link>}
            >
              Coming up
            </SectionTitle>
            {[...happeningNow, ...nextUp].length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Nothing scheduled — put a project on the calendar.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--layout-gap)' }}>
                {[...happeningNow, ...nextUp].slice(0, 3).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`cal-chip ${scheduleStatus(p.startDate!, p.endDate!)}`}
                    style={{ padding: '7px 9px', fontSize: 12.5 }}
                    onClick={() => setModal({ kind: 'project', project: p, editing: false })}
                  >
                    {p.name} · {formatDateRange(p.startDate!, p.endDate!)}
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {account ? <NotesCard notes={notes} onChanged={() => setNotesVersion((v) => v + 1)} /> : <div className="card" style={{ padding: 'var(--panel-padding)' }}><SectionTitle icon="note-pencil">Household notes</SectionTitle><p className="foundation-hint">Household notes need access to the household account.</p><Link className="btn" to="/account/settings">Account settings</Link></div>}
        </section>
      </div>

      <ProjectInvitations onChanged={projectId => { reload(); if (projectId) navigate('/project') }} />

      {modal?.kind === 'new' && (
        <NewProjectModal
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null)
            reload()
          }}
        />
      )}
      {modal?.kind === 'invite' && (
        <InviteModal projects={projects ?? []} defaultProjectId={active?.id ?? ''} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'project' && (
        <ProjectModal project={modal.project} startEditing={modal.editing} onClose={() => setModal(null)} onChanged={reload} />
      )}
    </div>
  )
}

/* ─────────────────────────── Notes ─────────────────────────── */

function NotesCard({ notes, onChanged }: { notes: AccountNote[] | null; onChanged: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    void run(async () => {
      await db.addNote(text.trim())
      setText('')
    })
  }

  return (
    <div className="card" style={{ padding: 'var(--panel-padding)' }}>
      <SectionTitle icon="note-pencil" color="var(--clay)">Notes</SectionTitle>
      <form onSubmit={add} style={{ display: 'flex', gap: 8, marginBottom: 'var(--section-gap)' }}>
        <input
          style={{ ...inputStyle, padding: '8px 11px', fontSize: 13.5 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Jot something down…"
          aria-label="New note"
        />
        <button type="submit" className="btn" disabled={busy || !text.trim()} style={{ flex: '0 0 auto' }}>
          Add
        </button>
      </form>
      {error && <div style={{ marginBottom: 10 }}><FormError>{error}</FormError></div>}
      {!notes ? (
        <Loading label="Loading notes…" />
      ) : notes.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Nothing noted yet — things that span projects live here.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--layout-gap)' }}>
          {notes.map((note) => (
            <div key={note.id} style={{ display: 'flex', gap: 'var(--layout-gap)', alignItems: 'flex-start' }}>
              <button
                type="button"
                title={note.pinned ? 'Unpin' : 'Pin'}
                onClick={() => void run(() => db.setNotePinned(note.id, !note.pinned))}
                style={{ background: 'none', border: 'none', padding: '2px 0 0', flex: '0 0 auto' }}
              >
                <Icon name="push-pin" weight={note.pinned ? 'fill' : 'regular'} size={15} color={note.pinned ? 'var(--accent-2)' : 'var(--ink-faint)'} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>{note.text}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{formatDate(note.createdAt)}</div>
              </div>
              <button
                type="button"
                title="Delete note"
                onClick={() => void run(() => db.deleteNote(note.id))}
                style={{ background: 'none', border: 'none', padding: '2px 0 0', flex: '0 0 auto' }}
              >
                <Icon name="trash" size={15} color="var(--ink-faint)" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── New project ─────────────────────────── */

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  return <Modal title="New project" layer={100} onClose={onClose}>
    <NewProjectForm onCreated={onCreated} onCancel={onClose} />
  </Modal>
}
