import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import { stepTasksInOrder, type ProjectWork, type WorkStep, type WorkTask } from '../data/projectWork'
import { openBobForCurrentSurface, openBobWithDraft, useBobSurface } from '../lib/bobSurface'
import { useAsync, useProjectVersion } from './ui'
import { PhasePill } from './PhaseUI'
import { ProjectImages } from './ProjectImages'
import { ProjectStart } from './ProjectStart'
import { TaskModal } from './editors'
import { GuideVisuals } from './GuideVisuals'
import { GuidePager } from './GuidePager'
import { DrawingRequests } from './DrawingRequests'

const taskState = { todo: 'To do', doing: 'In progress', blocked: 'Blocked', done: 'Done' }
const stepState = { planned: 'Planned', active: 'In progress', blocked: 'Blocked', completed: 'Complete' }

const criterionState: Record<string, string> = {
  missing: 'Awaiting evidence', satisfied: 'Verified', stale: 'Needs rechecking',
  conflicted: 'Conflicting evidence', waived: 'Waived', not_applicable: 'Not applicable',
}

function TaskLinks({ tasks, people }: { tasks: WorkTask[]; people: Map<string, string> }) {
  return <ul className="work-task-list">{tasks.map(task => <li key={task.id}>
    <Link to={`/tasks/${encodeURIComponent(task.id)}`}>{task.name}</Link>
    <span className="foundation-hint">{taskState[task.status]}{task.assignee_ids?.length ? ' · ' + task.assignee_ids.map(id => people.get(id) ?? 'Assigned participant').join(', ') : ''}</span>
  </li>)}</ul>
}

function responsible(kind: WorkStep['responsible_kind'], id: string | null | undefined, people: Map<string, string>) {
  if (kind === 'bob') return 'Bob'
  if (kind === 'person') return people.get(id ?? '') ?? 'Assigned participant'
  return 'Unassigned'
}

function CurrentStep({ work, step, people, onAdd }: {
  work: ProjectWork; step: WorkStep; people: Map<string, string>; onAdd: () => void
}) {
  const [imagesOpen, setImagesOpen] = useState(false)
  const area = work.areas.find(item => item.id === step.area_id)
  const isFocus = step.id === work.focus_step_id
  const archivedAreas = new Set(work.areas.filter(a => a.archived_at).map(a => a.id))
  const sequence = work.steps.filter(s => area?.archived_at ? s.area_id === area.id : !s.area_id || !archivedAreas.has(s.area_id))
  const index = sequence.findIndex(s => s.id === step.id)
  const page = (s?: WorkStep) => s ? `/project?step=${encodeURIComponent(s.id)}` : undefined
  const tasks = stepTasksInOrder(step.tasks)
  const nextTask = tasks.find(t => t.status === 'doing') ?? tasks.find(t => t.status === 'todo')
  const pending = step.requirements.filter(r => !['satisfied','waived','not_applicable'].includes(r.status.state))
  const need = pending.find(r => r.responsible_kind === 'person') ?? (step.state === 'blocked' ? pending[0] : undefined)
  return <article id={`step-${step.id}`} className="current-plan-step">
    <GuidePager label="Browse plan steps" previous={page(sequence[index-1])} next={page(sequence[index+1])}><strong>Step {index+1} of {sequence.length}</strong>
      <span className="step-responsibility" aria-label={`Responsible: ${responsible(step.responsible_kind, step.responsible_person_id, people)}`}>
        {step.responsible_kind === 'bob' ? 'Bob’s step' : responsible(step.responsible_kind, step.responsible_person_id, people)}</span>
    </GuidePager>
    <h2>{step.title}</h2>
    {step.state === 'blocked' && <p className="guide-caution" role="status">Blocked{need && ` · ${need.title}`}</p>}
    {step.state === 'completed' && <p className="foundation-hint">Completed</p>}
    {need && step.state !== 'blocked' && <p className="guide-need">{need.title}</p>}
    <GuideVisuals key={step.id} projectId={work.project_id} planStepId={step.id} target={{kind:'plan_step',id:step.id}} returnLabel={step.title} returnKey={`step:${step.id}`} />
    {nextTask && !area?.archived_at && step.state !== 'completed' && <Link className="guide-task" to={`/tasks/${encodeURIComponent(nextTask.id)}`}>
      <span><small>{nextTask.status === 'doing' ? 'In progress' : 'Task'}</small>{nextTask.name}</span><span aria-hidden="true">→</span>
    </Link>}
    {!nextTask && !need && !area?.archived_at && step.state !== 'completed' && <button className="guide-help" onClick={() => openBobWithDraft('Explain this step in plain words. What, if anything, do you need from me?')}>Explain this step</button>}
    {!isFocus && work.focus_step_id && <Link className="guide-return" to="/project">Back to Bob’s focus</Link>}
    <details id={`work-details-${step.id}`} className="step-support">
      <summary>Step details</summary>
      {step.goal && <p>{step.goal}</p>}
      <p className="foundation-hint">{stepState[step.state]}{isFocus && ' · Bob’s focus'}</p>
      {!!step.requirements.length && <section className="work-criteria" aria-label="Finish criteria">
        <h3>Finish criteria</h3>
        <ul>{step.requirements.map(r => <li key={r.id}>
          <strong>{r.title}</strong><span className="foundation-hint">{criterionState[r.status.state] ?? r.status.state.replace(/_/g, ' ')}</span>
          {r.description && <p>{r.description}</p>}
        </li>)}</ul>
      </section>}
      {!!tasks.length && <section aria-label="Step tasks"><h3>Tasks</h3><TaskLinks tasks={tasks} people={people} /></section>}
      <div className="foundation-actions">
        {step.state !== 'completed' && !area?.archived_at && <button className="btn" onClick={() => openBobWithDraft('Review the approved plan against the work saved in this project. Link matching evidence, update the steps it supports and move your focus to the next outstanding work. Tell me which checks still need someone on site.')}>Review plan progress with Bob</button>}
        <button className="btn" onClick={openBobForCurrentSurface}>Ask Bob about this step</button>
        {!area?.archived_at && <button className="btn" onClick={onAdd}>Add task</button>}
      </div>
      {area && <p className="foundation-hint"><Link to={`/areas/${area.slug}`}>{area.name}</Link>{area.archived_at && ' · Archived area'}</p>}
      {!!step.related_tasks.length && <details id={`related-${step.id}`}><summary>Related work</summary><TaskLinks tasks={step.related_tasks} people={people} /></details>}
      <details id={`work-images-${step.id}`} className="step-support" onToggle={event => setImagesOpen(event.currentTarget.open)}>
        <summary>Step images</summary>
        {imagesOpen && <ProjectImages projectId={work.project_id} target={{kind:'plan_step',id:step.id}} title="Step images" />}
      </details>
    </details>
  </article>
}

function PlanList({ work, viewed, people }: { work: ProjectWork; viewed?: string; people: Map<string,string> }) {
  const archived = work.areas.filter(a => a.archived_at)
  function rows(areaId: string | null) {
    const tasks = work.unorganised_tasks.filter(t => (t.area_id ?? null) === areaId)
    return <>
      {work.steps.filter(s => s.area_id === areaId).map(step => <Link className="plan-step-link" key={step.id}
        to={`/project?step=${encodeURIComponent(step.id)}`} aria-current={viewed === step.id ? 'step' : undefined}>
        <span>{step.position}. {step.title}</span><small>{step.id === work.focus_step_id ? 'Bob’s focus · ' : ''}{stepState[step.state]}</small>
      </Link>)}
      {!!tasks.length && <details className="work-unorganised"><summary>Tasks to organise · {tasks.length}</summary><TaskLinks tasks={tasks} people={people} /></details>}
    </>
  }
  function areaRow(area: ProjectWork['areas'][number]) {
    return <section className="work-area" key={area.id} aria-label={area.name}><div className="foundation-heading"><h3><Link to={`/areas/${area.slug}`}>{area.name}</Link></h3><PhasePill phase={area.phase}/></div>{rows(area.id)}</section>
  }
  return <details id="full-project-plan" className="full-project-plan" open={!viewed || undefined} key={viewed ? 'selected' : 'unselected'}>
    <summary>Full plan · {work.steps.length} steps</summary>
    {rows(null)}{work.areas.filter(a => !a.archived_at).map(areaRow)}
    {!!archived.length && <details id="archived-work-areas"><summary>Archived Areas · {archived.length}</summary>{archived.map(areaRow)}</details>}
    <Link className="btn" to="/areas">Manage areas</Link>
  </details>
}

function StartOrResume({ projectId, hasWork }: { projectId: string; hasWork: boolean }) {
  const [retry, setRetry] = useState(0)
  const { data, error, loading } = useAsync(() => db.getProjectStartingPoint(projectId), [projectId, retry])
  if (loading) return <p role="status">Checking saved project work…</p>
  if (error || !data) return <p role="alert">Saved project work could not be checked. <button className="btn" onClick={() => setRetry(n => n + 1)}>Retry</button></p>
  if (!hasWork && !data.pending && !data.hasSources) return <ProjectStart photoUrl="/project?media=photos" />
  return <div className="current-plan-step"><h2>{data.pending ? 'Plan proposal' : 'Continue planning'}</h2>
    <p>{data.pending?.summary || 'Use the existing project records to prepare the plan.'}</p>
    <button className="btn" onClick={() => openBobWithDraft(data.pending ? 'Show me the pending plan proposal.' : 'Help me plan the next step using the saved project records.')}>Discuss with Bob</button>
  </div>
}

export function ProjectStepWorkspace({ projectId, building }: { projectId: string; building: boolean }) {
  const version = useProjectVersion(), [local, setLocal] = useState(0), [params] = useSearchParams()
  const [adding, setAdding] = useState<WorkStep | null>(null)
  const { data: work, error, loading } = useAsync(() => db.getProjectWork(projectId), [projectId, version, local])
  const { data: crew } = useAsync(() => db.getPeople(), [projectId, version])
  const people = new Map(crew?.map(person => [person.id, person.name]) ?? [])
  const requested = params.get('step')
  const step = work?.steps.find(s => s.id === (requested ?? work.focus_step_id))
  useBobSurface(projectId, step ? { surface:'project', planStepId:step.id } : null, step ? `Plan Step · ${step.title}` : 'Project', 2)
  useEffect(() => {
    if (requested && step?.id === requested) document.getElementById('project-plan')?.scrollIntoView({ block: 'start' })
  }, [requested, step?.id])
  if (error || (!work && !loading)) return <div role="alert">Project plan could not be loaded. <button className="btn" onClick={() => setLocal(v => v+1)}>Try again</button></div>
  if (!work) return <p role="status">Loading project plan…</p>
  const unplanned = !building && work.status === 'not_initialized' && !work.revision && !work.steps.length
  const hasWork = work.areas.length > 0 || work.unorganised_tasks.length > 0
  return <>
    <section className="card project-plan-panel" id="project-plan" tabIndex={-1} aria-label="Project plan">
      {requested && !step && <p role="status">This step is unavailable in the current plan. <Link to="/project">Return to project focus</Link></p>}
      {step ? <CurrentStep key={step.id} work={work} step={step} people={people} onAdd={() => setAdding(step)} />
        : unplanned ? <StartOrResume projectId={projectId} hasWork={hasWork} />
        : <div className="current-plan-step"><h2>{work.steps.length ? 'Project plan' : 'No approved steps yet'}</h2>
          <p>{work.steps.length ? 'Choose a step to see its work and sources.' : 'Discuss the next step with Bob using your saved project work.'}</p>
          {!work.steps.length && <button className="btn" onClick={openBobForCurrentSurface}>Ask Bob about the plan</button>}
        </div>}
      {(!unplanned || hasWork) && <PlanList work={work} viewed={step?.id} people={people} />}
    </section>
    <DrawingRequests key={projectId} projectId={projectId} stepId={step?.id} />
    {adding && <TaskModal areas={work.areas.filter(a => !a.archived_at)} areaId={adding.area_id ?? undefined} stepId={adding.id}
      onClose={() => setAdding(null)} onDone={() => {setAdding(null); setLocal(v => v+1)}} />}
  </>
}
