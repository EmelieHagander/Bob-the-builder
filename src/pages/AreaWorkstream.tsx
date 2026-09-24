import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import type { Material, MaterialStatus, Task, TaskStatus } from '../data/types'
import { AreaModal, AssignModal, MaterialModal, TaskModal } from '../components/editors'
import { PhasePill, PhaseRail, PhaseTransitionDialog, NextActionCard } from '../components/PhaseUI'
import { ProjectImages } from '../components/ProjectImages'
import {
  AvatarStack,
  EmptyState,
  Icon,
  Loading,
  MaterialPill,
  ProgressBar,
  SkillPill,
  StatusPill,
  statusCheck,
  useAsync,
} from '../components/ui'
import { areaNextAction } from '../lib/projectPhase'
import { AreaArchiveNotice } from '../components/AreaArchiveNotice'

type Tab = 'tasks' | 'materials' | 'images'
const NEXT_TASK_STATUS: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo', blocked: 'doing' }
const NEXT_MATERIAL_STATUS: Record<MaterialStatus, MaterialStatus> = { needed: 'ordered', ordered: 'delivered', delivered: 'needed', backorder: 'ordered' }

export function AreaWorkstream() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const projectId = db.getActiveProjectId() ?? ''
  const [version, setVersion] = useState(0)
  const { data: area, loading, error: areaError } = useAsync(() => db.getArea(slug), [slug, version])
  const { data: people } = useAsync(() => db.getPeople(), [version])
  const { data: allTasks } = useAsync(() => db.getTasks(), [version])
  const { data: allMaterials } = useAsync(() => db.getMaterials(), [version])
  const { data: taskReadiness } = useAsync(() => db.getTaskReadiness(projectId), [projectId, version])
  const requestedTab = params.get('tab')
  const tab: Tab = requestedTab === 'materials' || requestedTab === 'images' ? requestedTab : 'tasks'
  const setTab = (next: Tab) => {
    const copy = new URLSearchParams(params)
    if (next === 'tasks') copy.delete('tab')
    else copy.set('tab', next)
    setParams(copy, { replace: true })
  }
  const [phaseOpen, setPhaseOpen] = useState(false)
  const [modal, setModal] = useState<
    | { kind: 'task'; task?: Task }
    | { kind: 'material'; material?: Material }
    | { kind: 'assign'; task: Task }
    | { kind: 'area' }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)

  const reload = () => { setModal(null); setVersion(value => value + 1) }
  const act = (action: () => Promise<unknown>) => {
    setError(null)
    void action().then(reload).catch(err => setError(err instanceof Error ? err.message : String(err)))
  }

  if (loading) return <div className="page"><Loading label="Loading Area…" /></div>
  if (!area || areaError) return <div className="page"><EmptyState icon="magnifying-glass" title="Area unavailable" hint={areaError?.message ?? 'It may have been renamed, removed or your access changed.'} /></div>

  const tasks = (allTasks ?? []).filter(task => task.areaId === area.id)
  const materials = (allMaterials ?? []).filter(material => material.area === area.name)
  const materialCategories = [...new Set((allMaterials ?? []).map(material => material.category))]
  const byId = new Map((people ?? []).map(person => [person.id, person]))
  const resolve = (ids: string[]) => ids.map(id => byId.get(id)).filter((person): person is NonNullable<typeof person> => Boolean(person))
  const lead = byId.get(area.leadId ?? '')
  const next = areaNextAction(area)
  const readinessByTask = new Map((taskReadiness ?? []).map(item => [item.taskId, item]))
  const readyTasks = tasks.filter(task => readinessByTask.get(task.id)?.state === 'ready')
  const firstReadyTask = readyTasks.find(task => task.status === 'doing') ?? readyTasks.find(task => task.status === 'todo')
  const firstBlockedTask = tasks.find(task => task.status !== 'done' && ['blocked', 'unreviewed'].includes(readinessByTask.get(task.id)?.state ?? ''))
  const blockedState = firstBlockedTask ? readinessByTask.get(firstBlockedTask.id) : undefined
  const primary = area.phase === 'build' && firstReadyTask
    ? { ...next, title: `Continue: ${firstReadyTask.name}`, text: 'This task has a confirmed blocker-free work plan.', to: `/tasks/${firstReadyTask.id}` }
    : area.phase === 'build' && firstBlockedTask
      ? { ...next, title: `${blockedState?.state === 'unreviewed' ? 'Review' : 'Unblock'}: ${firstBlockedTask.name}`, text: blockedState?.blockers[0]?.label ?? 'Readiness has not been reviewed yet.', to: `/tasks/${firstBlockedTask.id}` }
      : next

  const tabs: { key: Tab; label: string; count: number | null }[] = [
    { key: 'tasks', label: 'Tasks', count: tasks.length },
    { key: 'materials', label: 'Materials', count: materials.length },
    { key: 'images', label: 'Images', count: null },
  ]

  return <div className="page">
    <div style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 7 }}>
      <Link to="/">Project</Link><Icon name="caret-right" size={12} />
      <Link to="/areas">Areas</Link><Icon name="caret-right" size={12} />
      <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{area.name}</span>
    </div>

    <div className="page-head" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 15, minWidth: 0 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
          <Icon name={area.icon} size={30} color="var(--brand)" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}><PhasePill phase={area.phase} prefix="Area" /></div>
          <h1 className="page-title">{area.name}</h1>
          <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 2 }}>
            {area.description}{lead ? ` · ${lead.name.split(' ')[0]} leads · ${area.crewIds.length} in the crew` : ''}
          </div>
        </div>
      </div>
      <div className="cluster no-print">
        {!area.archivedAt && <button className="btn" onClick={() => setPhaseOpen(true)}><Icon name="signpost" size={15} /> {area.phase ? 'Review phase' : 'Set phase'}</button>}
        <details style={{ position: 'relative' }}>
          <summary className="btn" style={{ listStyle: 'none', cursor: 'pointer' }}><Icon name="dots-three" size={17} /> More tools</summary>
          <div className="card" style={{ position: 'absolute', right: 0, zIndex: 10, width: 220, padding: 9, marginTop: 6, display: 'grid', gap: 4 }}>
            <Link className="btn" to={`/facts?area=${encodeURIComponent(area.id)}`}><Icon name="ruler" size={15} /> Measurements &amp; parts</Link>
            <Link className="btn" to={`/solutions?area=${encodeURIComponent(area.id)}`}><Icon name="path" size={15} /> Solutions &amp; target</Link>
            <Link className="btn" to={`/artifacts?area=${encodeURIComponent(area.id)}`}><Icon name="blueprint" size={15} /> Drawings</Link>
            <Link className="btn" to={`/material-plan?area=${encodeURIComponent(area.id)}`}><Icon name="package" size={15} /> Material plan</Link>
            <button className="btn" onClick={() => setModal({ kind: 'area' })}><Icon name="pencil-simple" size={15} /> Edit Area</button>
          </div>
        </details>
      </div>
    </div>

    <div style={{ marginTop: 16 }}><PhaseRail phase={area.phase} compact /></div>

    <AreaArchiveNotice area={area} onChanged={reload} />
    {!area.archivedAt && <section style={{ marginTop: 16 }}>
      <NextActionCard eyebrow="This Area" title={primary.title} text={primary.text} icon={primary.icon}
        action={<Link className="btn btn-primary" to={primary.to}>Open next step <Icon name="arrow-right" size={14} /></Link>} />
    </section>}

    {error && <div role="alert" style={{ marginTop: 12, background: 'var(--clay-bg)', border: '1px solid #e0b3a8', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#8a3b2b' }}>{error}</div>}

    <div style={{ display: 'flex', gap: 4, marginTop: 22, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
      {tabs.map(item => {
        const active = tab === item.key
        return <button key={item.key} onClick={() => setTab(item.key)} style={{ background: 'none', border: 'none', padding: '9px 12px', marginBottom: -1, borderBottom: active ? '2.5px solid var(--accent)' : '2.5px solid transparent', fontSize: 14, fontWeight: active ? 750 : 600, color: active ? 'var(--ink)' : 'var(--ink-soft)' }}>
          {item.label} {item.count !== null && <span style={{ color: 'var(--ink-faint)' }}>{item.count}</span>}
        </button>
      })}
    </div>

    <div className="area-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 22, marginTop: 18 }}>
      <div>
        {tab === 'tasks' && <>
          <div className="foundation-heading" style={{ marginBottom: 10 }}><h2 style={{ margin: 0, fontSize: 16 }}>Tasks</h2>{!area.archivedAt && <button className="btn btn-primary no-print" onClick={() => setModal({ kind: 'task' })}><Icon name="plus" size={15} /> Add task</button>}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {!tasks.length && <EmptyState icon="list-plus" title="No tasks yet" hint={area.phase === 'planning' ? 'Break the selected plan into executable work when it is ready.' : 'Add work here when tasks are useful for this Area.'} />}
            {tasks.map(task => {
              const check = statusCheck(task.status)
              const [got, total] = task.materials.split('/').map(value => value.trim())
              const materialReady = got === total
              const taskPlan = readinessByTask.get(task.id)
              return <div key={task.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 15px' }}>
                <button className="no-print" disabled={!!area.archivedAt} title={area.archivedAt ? 'Restore the Area to reopen work' : `Mark as ${NEXT_TASK_STATUS[task.status]}`} onClick={() => act(() => db.setTaskStatus(task.id, NEXT_TASK_STATUS[task.status]))} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', cursor: 'pointer' }}>
                  <Icon name={check.icon} size={22} color={check.color} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/tasks/${task.id}`} className="task-title-link">{task.name}</Link>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                    <SkillPill level={task.skill} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-soft)' }}><Icon name="clock" size={13} />{task.hours}</span>
                    {total !== '0' && total !== '' && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: materialReady ? 'var(--leaf)' : 'var(--clay)' }}><Icon name="package" size={13} />{task.materials} materials</span>}
                    {taskPlan && task.status !== 'done' && <span className="image-purpose">{taskPlan.state === 'ready' ? 'Ready' : taskPlan.state === 'unreviewed' ? 'Review readiness' : `${taskPlan.blockerCount} blocker${taskPlan.blockerCount === 1 ? '' : 's'}`}</span>}
                  </div>
                  {taskPlan?.state === 'blocked' && <p className="foundation-hint" style={{ margin: '7px 0 0' }}>{taskPlan.blockers[0]?.label}</p>}
                  {taskPlan?.state === 'unreviewed' && <p className="foundation-hint" style={{ margin: '7px 0 0' }}>Readiness has not been confirmed yet.</p>}
                </div>
                <div className="task-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button title="Choose who's on this task" onClick={() => setModal({ kind: 'assign', task })} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                    {task.assigneeIds.length ? <AvatarStack people={resolve(task.assigneeIds)} max={3} /> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 650, color: 'var(--clay)', border: '1.5px dashed var(--clay)', borderRadius: 999, padding: '4px 10px' }}><Icon name="user-plus" size={13} /> Assign</span>}
                  </button>
                  <StatusPill status={task.status} />
                </div>
              </div>
            })}
          </div>
        </>}

        {tab === 'materials' && <>
          <div className="foundation-heading" style={{ marginBottom: 10 }}><h2 style={{ margin: 0, fontSize: 16 }}>Materials</h2><button className="btn btn-primary no-print" onClick={() => setModal({ kind: 'material' })}><Icon name="plus" size={15} /> Add material</button></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {!materials.length && <EmptyState icon="package" title="No shopping materials here" hint="The richer Material plan is separate; publish purchase needs to Shopping when ready." />}
            {materials.map(material => <div key={material.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 15px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button title="Edit material" onClick={() => setModal({ kind: 'material', material })} style={{ background: 'none', border: 'none', padding: 0, fontSize: 14.5, fontWeight: 750, color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}>{material.name}</button>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 3 }}>{material.qty} · {material.supplier} · {material.cost}</div>
              </div>
              <button title={`Mark as ${NEXT_MATERIAL_STATUS[material.status]}`} onClick={() => act(() => db.setMaterialStatus(material.id, NEXT_MATERIAL_STATUS[material.status]))} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}><MaterialPill status={material.status} /></button>
            </div>)}
          </div>
        </>}

        {tab === 'images' && <ProjectImages projectId={projectId} target={{ kind: 'area', id: area.id }} title="Area images" />}
      </div>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 750, marginBottom: 10 }}>Area at a glance</div>
          {area.phase === 'build' ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ProgressBar label="Assigned" value={area.assignedPct} /><ProgressBar label="Materials ready" value={area.materialsPct} /><ProgressBar label="Done" value={area.donePct} />
          </div> : <p className="foundation-hint">{area.taskSummary}. Build progress stays secondary until this Area is actually in Build.</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, paddingTop: 13, borderTop: '1px solid var(--line)' }}>
            <AvatarStack people={resolve(area.crewIds)} /><span style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 650 }}>{area.crewIds.length} in the crew</span>
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <strong style={{ fontSize: 14 }}>Planning tools</strong>
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            <Link to={`/facts?area=${encodeURIComponent(area.id)}`}>Measurements &amp; existing parts</Link>
            <Link to={`/solutions?area=${encodeURIComponent(area.id)}`}>Solutions &amp; target</Link>
            <Link to={`/artifacts?area=${encodeURIComponent(area.id)}`}>Drawings</Link>
            <Link to={`/material-plan?area=${encodeURIComponent(area.id)}`}>Material plan</Link>
          </div>
        </div>
      </aside>
    </div>

    {phaseOpen && <PhaseTransitionDialog title={`Review phase · ${area.name}`} current={area.phase} onClose={() => setPhaseOpen(false)} onSave={async (phase, reason) => {
      await db.setAreaPhase(area.id, phase, reason); setPhaseOpen(false); setVersion(value => value + 1)
    }} />}
    {modal?.kind === 'task' && <TaskModal areas={[area]} areaId={area.id} task={modal.task} onClose={() => setModal(null)} onDone={reload} />}
    {modal?.kind === 'material' && <MaterialModal areas={[area]} categories={materialCategories} defaultArea={area.name} material={modal.material} onClose={() => setModal(null)} onDone={reload} />}
    {modal?.kind === 'assign' && <AssignModal task={modal.task} people={people ?? []} onClose={() => setModal(null)} onDone={reload} />}
    {modal?.kind === 'area' && <AreaModal people={people ?? []} area={area} onClose={() => setModal(null)} onDone={() => {
      setModal(null)
      void db.getAreas().then(all => {
        const still = all.find(item => item.id === area.id)
        if (!still) navigate('/areas')
        else if (still.slug !== slug) navigate(`/areas/${still.slug}`)
        else setVersion(value => value + 1)
      })
    }} />}
  </div>
}
