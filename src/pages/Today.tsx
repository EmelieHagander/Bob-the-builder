import { Link } from 'react-router-dom'
import * as db from '../data/database'
import { AvatarStack, Icon, Loading, SkillPill, StatusPill, statusCheck, useAsync } from '../components/ui'
import { PhasePill } from '../components/PhaseUI'

export function Today() {
  const projectId = db.getActiveProjectId() ?? ''
  const { data: tasks } = useAsync(() => db.getTodayTasks(), [])
  const { data: readiness } = useAsync(() => projectId ? db.getTaskReadiness(projectId) : Promise.resolve([]), [projectId])
  const { data: next } = useAsync(() => db.getNextEvent(), [])
  const { data: people } = useAsync(() => db.getPeople(), [])
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
  const readinessById = new Map((readiness ?? []).map(item => [item.taskId, item]))
  const rank = (id: string) => ({ ready: 0, unreviewed: 1, blocked: 2, complete: 3 }[readinessById.get(id)?.state ?? 'blocked'])
  const orderedTasks = tasks ? [...tasks].sort((a, b) => rank(a.id) - rank(b.id) || Number(b.areaPhase === 'build') - Number(a.areaPhase === 'build')) : null

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="page-title">What needs doing today</h1>
      {next && <p className="page-sub">{next.title} · {next.day} · {next.time}</p>}

      {next && (
        <div style={{ marginTop: 16, background: 'var(--brand)', color: 'var(--brand-ink)', borderRadius: 'var(--r)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
          <Icon name="cooking-pot" weight="fill" size={17} color="var(--accent)" />
          <span style={{ color: '#ffffffe0' }}>{next.food}</span>
        </div>
      )}

      {!orderedTasks ? (
        <Loading />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
          {orderedTasks.map((t) => {
            const chk = statusCheck(t.status)
            const taskPlan = readinessById.get(t.id)
            return (
              <div key={t.id} className="card" style={{ padding: 15 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
                  <Icon name={chk.icon} size={24} color={chk.color} style={{ marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-faint)', fontWeight: 600 }}>{t.areaName}</div>
                    <Link to={'/tasks/' + t.id} className="task-title-link" style={{ fontSize: 16, fontWeight: 700 }}>{t.name}</Link>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
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
          })}
        </div>
      )}

      <Link to="/areas" className="btn no-print" style={{ marginTop: 18 }}>
        <Icon name="squares-four" size={15} /> Browse all areas
      </Link>
    </div>
  )
}
