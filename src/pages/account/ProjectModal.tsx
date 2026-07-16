/*
 * Project details as seen from the account level: what it is, when it's
 * scheduled, jump into it, or edit its build window (which is what places
 * it on the account calendar).
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import * as db from '../../data/database'
import type { Project, ThemeName } from '../../data/types'
import { Modal } from '../../components/Modal'
import { Icon } from '../../components/ui'
import { Field, FormError, inputStyle } from '../../components/form'
import { scheduleStatus, type ScheduleStatus } from '../../lib/calendarGrid'
import { formatDateRange } from '../../lib/format'

const THEMES: { name: ThemeName; label: string }[] = [
  { name: 'birch', label: 'Birch' },
  { name: 'forest', label: 'Forest' },
  { name: 'dusk', label: 'Dusk' },
]

export const SCHEDULE_META: Record<ScheduleStatus, { label: string; color: string; bg: string }> = {
  upcoming: { label: 'Upcoming', color: '#9A6313', bg: 'var(--honey-bg)' },
  ongoing: { label: 'Building now', color: '#3d7247', bg: 'var(--leaf-bg)' },
  finished: { label: 'Finished', color: 'var(--ink-soft)', bg: 'var(--surface-2)' },
}

/** "Upcoming / Building now / Finished" pill — or "Not scheduled" when dateless. */
export function SchedulePill({ project }: { project: Project }) {
  const meta =
    project.startDate && project.endDate
      ? SCHEDULE_META[scheduleStatus(project.startDate, project.endDate)]
      : { label: 'Not scheduled', color: 'var(--ink-faint)', bg: 'var(--surface-2)' }
  return (
    <span className="pill" style={{ color: meta.color, background: meta.bg }}>
      {meta.label}
    </span>
  )
}

export function ProjectModal({
  project,
  startEditing = false,
  onClose,
  onChanged,
}: {
  project: Project
  startEditing?: boolean
  onClose: () => void
  /** called after the schedule was saved or cleared */
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'view' | 'schedule' | 'details'>(startEditing ? 'schedule' : 'view')
  const editing = mode === 'schedule'
  const setEditing = (on: boolean) => setMode(on ? 'schedule' : 'view')
  const [startDate, setStartDate] = useState(project.startDate ?? '')
  const [endDate, setEndDate] = useState(project.endDate ?? '')
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [location, setLocation] = useState(project.location)
  const [type, setType] = useState(project.type)
  const [theme, setTheme] = useState<ThemeName>(project.theme)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const saveDetails = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('The project needs a name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await db.updateProjectDetails(project.id, {
        name: name.trim(),
        description: description.trim(),
        location: location.trim(),
        type: type.trim(),
        theme,
      })
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const open = () => {
    db.setActiveProject(project.id)
    navigate('/')
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!startDate || !endDate) {
      setError('Pick both a start and an end date — or remove it from the calendar instead.')
      return
    }
    if (endDate < startDate) {
      setError('The end date can’t be before the start date.')
      return
    }
    await persist(startDate, endDate)
  }

  const clear = async () => persist(null, null)

  async function persist(start: string | null, end: string | null) {
    setBusy(true)
    setError(null)
    try {
      await db.updateProjectSchedule(project.id, start, end)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={project.name} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SchedulePill project={project} />
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
          {[project.type, project.location].filter(Boolean).join(' · ')}
        </span>
      </div>

      {project.description && (
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.45, marginTop: 10 }}>{project.description}</p>
      )}

      {mode === 'view' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="calendar-dots" size={16} color="var(--accent-2)" />
          {project.startDate && project.endDate
            ? formatDateRange(project.startDate, project.endDate)
            : 'Not on the calendar yet'}
        </div>
      )}

      {mode === 'details' ? (
        <form onSubmit={saveDetails} style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Project name *">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="What are you building?">
            <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Location">
              <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field label="Type">
              <input style={inputStyle} value={type} onChange={(e) => setType(e.target.value)} />
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
            <button type="button" className="btn" disabled={busy} onClick={() => setMode('view')}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </form>
      ) : editing ? (
        <form onSubmit={save} style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="From">
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
            <Field label="To">
              <input type="date" style={inputStyle} value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          {error && <FormError>{error}</FormError>}
          <div className="cluster" style={{ justifyContent: 'flex-end' }}>
            {(project.startDate || project.endDate) && (
              <button type="button" className="btn" disabled={busy} onClick={clear} style={{ marginRight: 'auto', color: 'var(--clay)' }}>
                <Icon name="calendar-x" size={15} /> Remove from calendar
              </button>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save schedule'}
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && <div style={{ marginTop: 12 }}><FormError>{error}</FormError></div>}
          <div className="cluster" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
            <button type="button" className="btn" onClick={() => setMode('details')}>
              <Icon name="pencil-simple" size={15} /> Edit details
            </button>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Icon name="calendar-plus" size={15} /> {project.startDate ? 'Edit schedule' : 'Schedule'}
            </button>
            <button type="button" className="btn btn-primary" onClick={open}>
              <Icon name="arrow-right" weight="bold" size={14} /> Open project
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
