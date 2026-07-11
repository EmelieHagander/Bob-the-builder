/*
 * The account level's front page: every project on the account, shared
 * notes, and the doors to the calendar and settings. This sits ABOVE the
 * per-project world — opening a project from here decides what the rest of
 * the app shows.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as db from '../../data/database'
import type { AccountNote, Project, ThemeName } from '../../data/types'
import { EmptyState, Icon, Loading, SectionTitle, useAsync, useProjectVersion } from '../../components/ui'
import { Modal } from '../../components/Modal'
import { Field, FormError, inputStyle } from '../../components/form'
import { scheduleStatus } from '../../lib/calendarGrid'
import { formatDate, formatDateRange } from '../../lib/format'
import { ProjectModal, SchedulePill } from './ProjectModal'

export function AccountDashboard() {
  const navigate = useNavigate()
  const projectVersion = useProjectVersion()
  const [version, setVersion] = useState(0)
  const [notesVersion, setNotesVersion] = useState(0)
  const { data: account } = useAsync(() => db.getAccount(), [])
  const { data: projects, loading } = useAsync(() => db.getProjects(), [version, projectVersion])
  const { data: active } = useAsync(() => db.getProject(), [version, projectVersion])
  const { data: notes } = useAsync(() => db.getNotes(), [notesVersion])
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'project'; project: Project; editing: boolean } | null>(null)

  const reload = () => setVersion((v) => v + 1)
  const openProject = (p: Project) => {
    db.setActiveProject(p.id)
    navigate('/')
  }

  const scheduled = (projects ?? []).filter((p) => p.startDate && p.endDate)
  const buildingNow = scheduled.filter((p) => scheduleStatus(p.startDate!, p.endDate!) === 'ongoing')
  const nextUp = scheduled
    .filter((p) => scheduleStatus(p.startDate!, p.endDate!) === 'upcoming')
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!))

  const stats = [
    { icon: 'squares-four', value: String(projects?.length ?? 0), label: 'Projects', color: 'var(--accent)' },
    { icon: 'hammer', value: String(buildingNow.length), label: 'Building now', color: 'var(--leaf)' },
    { icon: 'calendar-dots', value: nextUp[0] ? formatDate(nextUp[0].startDate) : '—', label: 'Next build starts', color: 'var(--honey)' },
    { icon: 'note-pencil', value: String(notes?.length ?? 0), label: 'Notes', color: 'var(--clay)' },
  ]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{account?.name ?? 'Your account'}</h1>
          <p className="page-sub">Every build in one place — projects, shared notes and settings.</p>
        </div>
        <div className="cluster no-print">
          <Link to="/account/calendar" className="btn">
            <Icon name="calendar-dots" size={16} /> Calendar
          </Link>
          <Link to="/account/settings" className="btn">
            <Icon name="gear-six" size={16} /> Settings
          </Link>
          <button className="btn btn-primary" onClick={() => setModal({ kind: 'new' })}>
            <Icon name="plus" weight="bold" size={15} /> New project
          </button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 22 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '14px 15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>
              <Icon name={s.icon} weight="fill" size={15} color={s.color} /> {s.label}
            </div>
            <div className="font-display" style={{ fontWeight: 700, fontSize: 24, marginTop: 6 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 22, marginTop: 24 }}>
        {/* Projects */}
        <section>
          <SectionTitle>
            Projects <span style={{ color: 'var(--ink-faint)', fontWeight: 600 }}>· {projects?.length ?? 0}</span>
          </SectionTitle>
          {loading ? (
            <Loading />
          ) : (projects ?? []).length === 0 ? (
            <EmptyState icon="squares-four" title="No projects yet" hint="Start one with the button above." />
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {projects!.map((p) => (
                <div
                  key={p.id}
                  className="card"
                  style={{ padding: 15, cursor: 'pointer' }}
                  onClick={() => setModal({ kind: 'project', project: p, editing: false })}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                      <Icon name="hammer" size={20} color="var(--brand)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                        {active?.id === p.id && (
                          <span className="pill" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Active</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{[p.type, p.location.split(',')[0]].filter(Boolean).join(' · ')}</div>
                    </div>
                    <SchedulePill project={p} />
                  </div>
                  <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
                    <Icon name="calendar-dots" size={15} color="var(--accent-2)" />
                    {p.startDate && p.endDate ? formatDateRange(p.startDate, p.endDate) : 'Not scheduled yet'}
                  </div>
                  <div className="cluster" style={{ marginTop: 12 }}>
                    <button
                      className="btn"
                      style={{ padding: '7px 12px', fontSize: 12.5 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        openProject(p)
                      }}
                    >
                      <Icon name="arrow-right" weight="bold" size={13} /> Open
                    </button>
                    <button
                      className="btn"
                      style={{ padding: '7px 12px', fontSize: 12.5 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setModal({ kind: 'project', project: p, editing: true })
                      }}
                    >
                      <Icon name="calendar-plus" size={13} /> {p.startDate ? 'Reschedule' : 'Schedule'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right column: coming up + notes */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <SectionTitle
              icon="calendar-dots"
              color="var(--accent-2)"
              action={<Link to="/account/calendar" style={{ fontSize: 13, color: 'var(--accent-2)', fontWeight: 600 }}>Calendar</Link>}
            >
              Coming up
            </SectionTitle>
            {[...buildingNow, ...nextUp].length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Nothing scheduled — put a project on the calendar.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {[...buildingNow, ...nextUp].slice(0, 3).map((p) => (
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
          </div>

          <NotesCard notes={notes} onChanged={() => setNotesVersion((v) => v + 1)} />
        </section>
      </div>

      {modal?.kind === 'new' && (
        <NewProjectModal
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null)
            reload()
          }}
        />
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
    <div className="card" style={{ padding: 16 }}>
      <SectionTitle icon="note-pencil" color="var(--clay)">Notes</SectionTitle>
      <form onSubmit={add} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notes.map((note) => (
            <div key={note.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
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

const THEMES: { name: ThemeName; label: string }[] = [
  { name: 'birch', label: 'Birch' },
  { name: 'forest', label: 'Forest' },
  { name: 'dusk', label: 'Dusk' },
]

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [type, setType] = useState('')
  const [theme, setTheme] = useState<ThemeName>('birch')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    if ((startDate && !endDate) || (!startDate && endDate)) {
      setError('Pick both schedule dates — or leave both empty for now.')
      return
    }
    if (startDate && endDate && endDate < startDate) {
      setError('The end date can’t be before the start date.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await db.createProject({
        name: name.trim(),
        description: description.trim(),
        location: location.trim(),
        type: type.trim(),
        theme,
        startLabel: '',
        startDate: startDate || null,
        endDate: endDate || null,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <Field label="Project name *">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Växthuset" autoFocus />
        </Field>
        <Field label="What are you building?">
          <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A one-sentence description" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Location">
            <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Town, Country" />
          </Field>
          <Field label="Type">
            <input style={inputStyle} value={type} onChange={(e) => setType(e.target.value)} placeholder="Greenhouse" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Build starts (optional)">
            <input
              type="date"
              style={inputStyle}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                if (endDate && endDate < e.target.value) setEndDate(e.target.value)
              }}
            />
          </Field>
          <Field label="Build ends">
            <input type="date" style={inputStyle} value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Theme">
          <div style={{ display: 'flex', gap: 6 }}>
            {THEMES.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => setTheme(t.name)}
                className="btn"
                style={{
                  flex: 1,
                  padding: '9px 0',
                  fontSize: 12.5,
                  justifyContent: 'center',
                  border: theme === t.name ? '2px solid var(--accent)' : '1px solid var(--line)',
                  fontWeight: theme === t.name ? 800 : 600,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        {error && <FormError>{error}</FormError>}
        <div className="cluster" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
