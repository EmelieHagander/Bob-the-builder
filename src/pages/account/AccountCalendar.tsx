/*
 * The account calendar: every scheduled project as a bar across its build
 * window, one month at a time. The month grid and interaction model are
 * ported from the Djuvanäs farm-portal calendar; here the bookings are
 * projects and their colour is where they sit relative to today.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../../data/database'
import type { Project } from '../../data/types'
import { EmptyState, Icon, Loading, SectionTitle, useAsync } from '../../components/ui'
import { isWithin, monthGrid, scheduleStatus, WEEKDAY_LABELS } from '../../lib/calendarGrid'
import { formatDateRange, formatMonth } from '../../lib/format'
import { ProjectModal, SCHEDULE_META } from './ProjectModal'

type Scheduled = Project & { startDate: string; endDate: string }

export function AccountCalendar() {
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [version, setVersion] = useState(0)
  const { data: projects, loading } = useAsync(() => db.getProjects(), [version])
  const [modal, setModal] = useState<{ project: Project; editing: boolean } | null>(null)

  const days = monthGrid(cursor.year, cursor.month)
  const scheduled = (projects ?? []).filter((p): p is Scheduled => Boolean(p.startDate && p.endDate))
  const unscheduled = (projects ?? []).filter((p) => !p.startDate || !p.endDate)

  const step = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Project calendar</h1>
          <p className="page-sub">Every scheduled build on the account, month by month.</p>
        </div>
        <div className="cluster no-print">
          <Link to="/account" className="btn">
            <Icon name="arrow-left" size={15} /> Account
          </Link>
        </div>
      </div>

      <div className="calendar-toolbar">
        <button type="button" className="btn" onClick={() => step(-1)} aria-label="Previous month">
          <Icon name="caret-left" weight="bold" size={14} />
        </button>
        <h2>{formatMonth(cursor.year, cursor.month)}</h2>
        <button type="button" className="btn" onClick={() => step(1)} aria-label="Next month">
          <Icon name="caret-right" weight="bold" size={14} />
        </button>
        <button type="button" className="btn" onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}>
          Today
        </button>
        <div className="calendar-legend" aria-hidden>
          {(['ongoing', 'upcoming', 'finished'] as const).map((status) => (
            <span key={status}>
              <span
                className="legend-dot"
                style={{ background: status === 'ongoing' ? 'var(--leaf)' : status === 'upcoming' ? 'var(--honey)' : 'var(--ink-faint)' }}
              />
              {SCHEDULE_META[status].label}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <Loading label="Loading the calendar…" />
      ) : (
        <div className="calendar-grid" role="grid">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="calendar-weekday" role="columnheader">
              {label}
            </div>
          ))}
          {days.map((day) => {
            const dayProjects = scheduled.filter((p) => isWithin(day.iso, p.startDate, p.endDate))
            return (
              <div key={day.iso} className={`calendar-day${day.inMonth ? '' : ' outside'}${day.isToday ? ' today' : ''}`} role="gridcell">
                <span className="day-number">{day.dayOfMonth}</span>
                {dayProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`cal-chip ${scheduleStatus(p.startDate, p.endDate)}`}
                    title={`${p.name} · ${formatDateRange(p.startDate, p.endDate)}`}
                    onClick={() => setModal({ project: p, editing: false })}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {!loading && scheduled.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <EmptyState icon="calendar-plus" title="Nothing scheduled yet" hint="Give a project below a build window and it shows up here." />
        </div>
      )}

      {!loading && unscheduled.length > 0 && (
        <section style={{ marginTop: 26 }}>
          <SectionTitle icon="calendar-slash" color="var(--ink-faint)">
            Not on the calendar yet
          </SectionTitle>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {unscheduled.map((p) => (
              <div key={p.id} className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{[p.type, p.location].filter(Boolean).join(' · ')}</div>
                </div>
                <button type="button" className="btn" onClick={() => setModal({ project: p, editing: true })}>
                  <Icon name="calendar-plus" size={15} /> Schedule
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {modal && (
        <ProjectModal
          project={modal.project}
          startEditing={modal.editing}
          onClose={() => setModal(null)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  )
}
