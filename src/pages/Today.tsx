import { useBobSurface } from '../lib/bobSurface'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import { useState } from 'react'
import { formatEventDay, parseEventDay } from '../lib/eventDay'
import { AvatarStack, EmptyState, Icon, LoadFailed, Loading, SkillPill, StatusPill, statusCheck, useAsync } from '../components/ui'
import type { TodayTask } from '../data/types'
import { PhasePill } from '../components/PhaseUI'

export function Today() {
  useBobSurface(db.getActiveProjectId() ?? '', { surface: 'today' }, 'Today’s work')
  const projectId = db.getActiveProjectId() ?? ''
  const [version, setVersion] = useState(0)
  const retry = () => setVersion((v) => v + 1)
  const { data: tasks, error: tasksError } = useAsync(() => db.getTodayTasks(), [version])
  const { data: readiness } = useAsync(() => projectId ? db.getTaskReadiness(projectId) : Promise.resolve([]), [projectId, version])
  const { data: next, error: nextError } = useAsync(() => db.getNextEvent(), [version])
  const { data: people } = useAsync(() => db.getPeople(), [version])
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
  const readinessById = new Map((readiness ?? []).map(item => [item.taskId, item]))
  const rank = (id: string) => ({ ready: 0, unreviewed: 1, blocked: 2, complete: 3 }[readinessById.get(id)?.state ?? 'blocked'])
  const orderedTasks = tasks ? [...tasks].sort((a, b) => rank(a.id) - rank(b.id) || Number(b.areaPhase === 'build') - Number(a.areaPhase === 'build')) : null
  const { data: dayTasks } = useAsync(() => next ? db.getEventTasks(next.id) : Promise.resolve([]), [next?.id, version])
  const { data: me } = useAsync(() => db.getCurrentUser(), [])
  const [params, setParams] = useSearchParams()
  const mine = params.get('mine') === '1'

  const nextDate = next ? parseEventDay(next.day) : null
  const now = new Date()
  const isToday = Boolean(nextDate && nextDate.toDateString() === now.toDateString())
  const plannedIds = new Set((dayTasks ?? []).map(task => task.id))
  const visible = (orderedTasks ?? []).filter(task => !mine || Boolean(me && task.assigneeIds.includes(me.id)))
  const planned = visible.filter(task => plannedIds.has(task.id))
  const others = visible.filter(task => !plannedIds.has(task.id))

  const card = (t: TodayTask) => {
    const chk = statusCheck(t.status)
    const taskPlan = readinessById.get(t.id)
    return (
      <div key={t.id} className="card" style={{ padding: 'var(--panel-padding)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--layout-gap)' }}>
          <Icon name={chk.icon} size={24} color={chk.color} style={{ marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-faint)', fontWeight: 600 }}>{t.areaName}</div>
            <Link to={'/tasks/' + t.id} className="task-title-link" style={{ fontSize: 16, fontWeight: 700 }}>{t.name}</Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)', marginTop: 8, flexWrap: 'wrap' }}>
              <SkillPill level={t.skill} />
              <StatusPill status={t.status} />
              {t.areaPhase && <PhasePill phase={t.areaPhase} prefix="Area" />}
              {taskPlan && <span className="image-purpose">{taskPlan.state === 'ready' ? 'Ready' : taskPlan.state === 'unreviewed' ? 'Review readiness' : `${taskPlan.blockerCount} blocker${taskPlan.blockerCount === 1 ? '' : 's'}`}</span>}
              <AvatarStack people={resolve(t.assigneeIds)} max={4} size={24} />
            </div>
            {taskPlan?.state === 'blocked' && <p className="foundation-hint" style={{ margin: '9px 0 0' }}>{taskPlan.blockers[0]?.label}</p>}
            {taskPlan?.state === 'unreviewed' && <p className="foundation-hint" style={{ margin: '9px 0 0' }}>Readiness has not been confirmed yet.</p>}
            {!taskPlan && <p className="foundation-hint" style={{ margin: '9px 0 0' }}>Readiness is unavailable. Open the task to check its prerequisites before starting.</p>}
          </div>
        </div>
      </div>
    )
  }
  const list = (items: TodayTask[]) => <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--layout-gap)', marginTop: 'var(--layout-gap)' }}>{items.map(card)}</div>

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="page-title">What needs doing today</h1>
      {next && <p className="page-sub">{isToday ? 'Build day today' : 'Next build day'}: {next.title} · {formatEventDay(next.day)} · {next.time}</p>}
      {nextError && <LoadFailed what="The next build day" onRetry={retry} />}

      {next && (
        <div style={{ marginTop: 'var(--section-gap)', background: 'var(--brand)', color: 'var(--brand-ink)', borderRadius: 'var(--r)', padding: 'var(--row-padding)', display: 'flex', alignItems: 'center', gap: 'var(--layout-gap)', fontSize: 13.5 }}>
          <Icon name="cooking-pot" weight="fill" size={17} color="var(--accent)" />
          <span style={{ color: '#ffffffe0' }}>{next.food}</span>
        </div>
      )}

      <div className="cluster no-print" role="group" aria-label="Whose tasks" style={{ marginTop: 'var(--section-gap)' }}>
        <button type="button" className="btn" aria-pressed={!mine} onClick={() => setParams({}, { replace: true })}>Everyone</button>
        <button type="button" className="btn" aria-pressed={mine} onClick={() => setParams({ mine: '1' }, { replace: true })}>My tasks</button>
      </div>

      {tasksError ? (
        <LoadFailed what="Today’s tasks" onRetry={retry} />
      ) : !orderedTasks ? (
        <Loading />
      ) : !visible.length ? (
        <div style={{ marginTop: 'var(--section-gap)' }}>
          <EmptyState icon="check-circle" title={mine ? 'Nothing assigned to you' : 'Nothing open right now'}
            hint={mine ? (me ? 'Pick an unassigned task from Everyone, or ask the organiser what to start with.' : 'Your name is not linked to a crew member in this project yet.') : 'Add tasks to an Area, or ask Bob to plan the next steps.'} />
        </div>
      ) : (
        <>
          {planned.length > 0 && <section aria-label={`Planned for ${next?.title ?? 'the build day'}`} style={{ marginTop: 'var(--section-gap)' }}>
            <h2 className="ui-section-title" style={{ fontSize: 'var(--text-section)' }}>Planned for {next?.title}</h2>
            {list(planned)}
          </section>}
          {others.length > 0 && <section aria-label="Other open tasks" style={{ marginTop: 'var(--section-gap)' }}>
            {planned.length > 0 && <h2 className="ui-section-title" style={{ fontSize: 'var(--text-section)' }}>Other open tasks</h2>}
            {list(others)}
          </section>}
        </>
      )}

      <Link to="/areas" className="btn no-print" style={{ marginTop: 'var(--section-gap)' }}>
        <Icon name="squares-four" size={15} /> Browse all areas
      </Link>
    </div>
  )
}
