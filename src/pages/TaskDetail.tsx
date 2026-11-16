import { openBobForCurrentSurface, openBobWithDraft, useBobSurface } from '../lib/bobSurface'
import {DrawingRequests} from '../components/DrawingRequests'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import type { TaskDetail as Detail, TaskStatus, TaskStep } from '../data/types'
import { Field, FormError, inputStyle } from '../components/form'
import { Modal } from '../components/Modal'
import { GuideVisuals } from '../components/GuideVisuals'
import { GuidePager } from '../components/GuidePager'
import { ProjectImages } from '../components/ProjectImages'
import { PhasePill } from '../components/PhaseUI'
import { TaskModal } from '../components/editors'
import { TaskReadinessPanel } from '../components/TaskReadinessPanel'
import { Icon, Loading, SkillPill, useAsync } from '../components/ui'
import { formatDateTime } from '../lib/format'
import { userErrorMessage } from '../lib/userErrors'

const errorText = (err: unknown) => userErrorMessage(err, 'Could not update the task. Try again.')

// Older tasks can store the whole build brief in one field, without instruction steps.
function TaskInstructions({ text }: { text: string }) {
  if (text.length <= 420 && text.split('\n').length <= 6) return <p className="instruction-text">{text}</p>
  const firstLine = text.trimStart().split('\n', 1)[0]
  const lead = firstLine.match(/^.{1,220}?[.!?](?=\s|$)/u)?.[0] ?? firstLine
  const preview = lead.length <= 220 ? lead : lead.slice(0, 220).replace(/\s+\S*$/u, '') + '…'
  return <details className="task-instruction-disclosure">
    <summary>
      <span className="task-instruction-preview">{preview}</span>
      <span className="task-instruction-action"><Icon name="caret-down" size={16} /><span className="when-closed">Read full instructions</span><span className="when-open">Collapse instructions</span></span>
    </summary>
    <p className="instruction-text">{text}</p>
  </details>
}

function StepEditor({ projectId, taskId, step, onClose, onSaved }: {
  projectId: string; taskId: string; step?: TaskStep; onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState(step?.title ?? '')
  const [instructions, setInstructions] = useState(step?.instructions ?? '')
  const [checkpoint, setCheckpoint] = useState(step?.isCheckpoint ?? false)
  const [required, setRequired] = useState(step?.required ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title={step ? 'Edit instruction' : 'Add instruction'} onClose={() => { if (!busy) onClose() }}>
    <form className="foundation-form" onSubmit={async e => {
      e.preventDefault(); if (busy) return
      setBusy(true); setError('')
      try {
        await db.editTaskSteps(projectId, taskId, step ? 'edit' : 'create', step?.id ?? null, {
          title: title.trim(), instructions, is_checkpoint: checkpoint, required: checkpoint && required, revision: step?.revision,
        })
        onSaved()
      } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
    }}>
      <Field label="Instruction title"><input style={inputStyle} value={title} required maxLength={200} disabled={busy} onChange={e => setTitle(e.target.value)} autoFocus /></Field>
      <Field label="Instructions"><textarea style={inputStyle} rows={5} value={instructions} maxLength={12000} disabled={busy} onChange={e => setInstructions(e.target.value)} /></Field>
      <label className="foundation-check"><input type="checkbox" checked={checkpoint} disabled={busy} onChange={e => { setCheckpoint(e.target.checked); if (!e.target.checked) setRequired(false) }} /> This is a completion check</label>
      {checkpoint && <label className="foundation-check"><input type="checkbox" checked={required} disabled={busy} onChange={e => setRequired(e.target.checked)} /> Required before the task is done</label>}
      {error && <FormError>{error}</FormError>}
      <div className="foundation-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save instruction'}</button></div>
    </form>
  </Modal>
}

function InstructionsEditor({ projectId, detail, onClose, onSaved }: { projectId: string; detail: Detail; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(detail.instructions)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [baseStamp] = useState(detail.updatedAt)
  return <Modal title="Task instructions" onClose={() => { if (!busy) onClose() }}>
    <form className="foundation-form" onSubmit={async e => {
      e.preventDefault(); if (busy) return
      setBusy(true); setError('')
      try { await db.editTaskSteps(projectId, detail.task.id, 'instructions', null, { instructions: text, expected_updated_at: baseStamp }); onSaved() }
      catch (err) { setError(errorText(err)) } finally { setBusy(false) }
    }}>
      <Field label="Scope and instructions"><textarea style={inputStyle} rows={8} value={text} maxLength={12000} disabled={busy} onChange={e => setText(e.target.value)} autoFocus /></Field>
      {error && <FormError>{error}</FormError>}
      <div className="foundation-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save instructions'}</button></div>
    </form>
  </Modal>
}

function StepImages({ projectId, stepId }: { projectId: string; stepId: string }) {
  const [open, setOpen] = useState(false)
  return <details id={`instruction-images-${stepId}`} className="step-images" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Instruction images</summary>
    {open && <ProjectImages projectId={projectId} target={{ kind: 'step', id: stepId }} title="Instruction images" />}
  </details>
}

export function TaskDetail() {
  const { taskId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const projectId = db.getActiveProjectId() ?? ''
  const [version, setVersion] = useState(0)
  const { data: detail, loading, error: loadError } = useAsync(() => db.getTaskDetail(projectId, taskId), [projectId, taskId, version])
  const { data: areas } = useAsync(() => db.getAreas({ includeArchived: true }), [projectId])
  const { data: work } = useAsync(() => db.getProjectWork(projectId), [projectId, version])
  const [dialog, setDialog] = useState<{ kind: 'step' | 'delete'; step?: TaskStep } | { kind: 'instructions' | 'task' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reload = () => { setDialog(null); setVersion(v => v + 1) }
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); reload() } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const focusedPlanStep = work?.steps.find(step => step.id === detail?.task.primaryStepId)
  const requested = params.get('instruction')
  const savedSteps = detail?.task.id === taskId ? detail.steps : []
  const active = savedSteps.find(s => s.id === requested) ?? savedSteps.find(s => !s.completedAt) ?? savedSteps.at(-1)
  const focusedInstruction = params.get('context') === 'task' ? undefined : active
  const instructionUrl = (step?: TaskStep) => {
    if (!step) return undefined
    const next = new URLSearchParams(params)
    next.set('instruction', step.id)
    next.delete('context')
    next.delete('visual')
    return `/tasks/${encodeURIComponent(taskId)}?${next}`
  }
  const selectContext = (wholeTask: boolean) => {
    const next = new URLSearchParams(params)
    if (active) next.set('instruction', active.id)
    if (wholeTask) next.set('context','task')
    else next.delete('context')
    setParams(next, {replace:true})
  }
  useBobSurface(projectId, detail?.task.id === taskId && !loading && !loadError ? { surface: 'task', taskId: detail.task.id, ...(detail.task.areaId ? { areaId: detail.task.areaId } : {}), ...(focusedPlanStep ? { planStepId: focusedPlanStep.id } : {}), ...(focusedInstruction ? { instructionId: focusedInstruction.id } : {}) } : null, focusedInstruction ? `Instruction · ${focusedInstruction.title}` : detail ? `Task · ${detail.task.name}` : 'Task loading')
  if (loading && detail?.task.id !== taskId) return <div className="page"><Loading /></div>
  if (!detail || detail.task.id !== taskId || loadError) return <div className="page"><h1 className="page-title">Task unavailable</h1>
    <p role="alert">{loadError ? userErrorMessage(loadError, 'This task may have been removed, or your project access changed.') : 'This task may have been removed, or your project access changed.'}</p>
    <div className="foundation-actions"><Link to="/areas" className="btn">Back to areas</Link><button className="btn" onClick={reload}>Reload task</button></div>
  </div>
  const { task, steps } = detail
  const instructionIndex = active ? steps.indexOf(active) : -1
  const area = areas?.find(a => a.id === task.areaId)
  const planStep = work?.steps.find(s => s.id === task.primaryStepId)
  const editable = db.authEnabled()
  return <div className="page task-detail">
    <Link to={planStep ? '/project?step='+planStep.id : area ? '/areas/' + area.slug : '/project'} className="task-back"><Icon name="arrow-left" size={16} /> {planStep ? 'Back to plan step' : area ? area.name : 'Back to project plan'}</Link>
    <div className="page-head"><h1 className="page-title">{task.name}</h1></div>
    {error && <div role="alert"><FormError>{error}</FormError><button className="btn" onClick={reload}>Reload task</button></div>}
    {busy && <p role="status">Saving…</p>}
    <TaskReadinessPanel projectId={projectId} taskId={task.id} areaId={task.areaId} refreshKey={version} />
    <section className="card project-plan-panel" aria-label="Instructions and checks">
      {active ? <article key={active.id} className="task-step current-plan-step" data-step-id={active.id}>
        <GuidePager label="Browse instructions" previous={instructionUrl(steps[instructionIndex-1])} next={instructionUrl(steps[instructionIndex+1])}><strong>Instruction {instructionIndex+1} of {steps.length}</strong>
          {active.isCheckpoint && <span>{active.required ? 'Required check' : 'Optional check'}</span>}
        </GuidePager>
        <h2>{active.title}</h2>
        <GuideVisuals projectId={projectId} planStepId={task.primaryStepId} taskId={task.id} target={{kind:'step',id:active.id}} returnLabel={active.title} returnKey={`instruction:${active.id}`} />
        {active.instructions && <p className="instruction-text">{active.instructions}</p>}
        <label className="foundation-check"><input type="checkbox" checked={Boolean(active.completedAt)} disabled={busy || !editable}
          onChange={e => {
            const completed = e.currentTarget.checked
            // Keep the instruction on screen when it is checked; browsing is separate.
            selectContext(params.get('context') === 'task')
            void act(() => db.editTaskSteps(projectId, task.id, 'complete', active.id, {revision:active.revision,completed}))
          }} /> Completed</label>
        <details className="step-support" id={`instruction-options-${active.id}`}><summary>Instruction details</summary>
          <div className="foundation-actions">
            <button className="btn" onClick={() => {selectContext(false);openBobForCurrentSurface()}}>Ask Bob about this instruction</button>
            {focusedInstruction && <button className="btn" onClick={() => selectContext(true)}>Use whole Task</button>}
            <button className="btn" disabled={!editable || busy} onClick={() => setDialog({ kind:'step',step:active })}>Edit instruction</button>
            <button className="btn" aria-label={`Move ${active.title} up`} disabled={!editable || busy || active.id === steps[0].id}
              onClick={() => void act(() => db.editTaskSteps(projectId,task.id,'move',active.id,{revision:active.revision,direction:'up'}))}><Icon name="arrow-up" size={16}/></button>
            <button className="btn" aria-label={`Move ${active.title} down`} disabled={!editable || busy || active.id === steps.at(-1)?.id}
              onClick={() => void act(() => db.editTaskSteps(projectId,task.id,'move',active.id,{revision:active.revision,direction:'down'}))}><Icon name="arrow-down" size={16}/></button>
            <button className="btn" aria-label={`Remove instruction: ${active.title}`} disabled={!editable || busy} onClick={() => setDialog({kind:'delete',step:active})}><Icon name="trash" size={16}/></button>
          </div>
          {active.completedAt && <p className="foundation-hint">Completed {formatDateTime(active.completedAt)}</p>}
          <StepImages projectId={projectId} stepId={active.id} />
        </details>
      </article> : <>
        <GuideVisuals key={task.id} projectId={projectId} planStepId={task.primaryStepId} target={{kind:'task',id:task.id}} returnLabel={task.name} returnKey={`task:${task.id}`} />
        {detail.instructions && <TaskInstructions key={task.id} text={detail.instructions} />}
        {!detail.instructions && <button className="btn" onClick={() => openBobWithDraft('Show me how to do this task, one step at a time. What do I do first?')}>Ask Bob how</button>}
      </>}
    </section>
    {db.authEnabled() && <DrawingRequests key={task.id} projectId={projectId} taskId={task.id} />}
    <details className="project-reference" id="task-options"><summary>Task details</summary>
      <div className="foundation-actions"><SkillPill level={task.skill}/><span>{task.hours}</span>{area && <PhasePill phase={area.phase} prefix="Area" />}</div>
      <Field label="Task status"><select aria-label="Task status" style={inputStyle} value={task.status} disabled={busy || loading}
        onChange={e => void act(() => db.setTaskStatus(task.id,e.target.value as TaskStatus))}>
        <option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option><option value="blocked">Blocked</option>
      </select></Field>
      {active && detail.instructions && <p className="instruction-text">{detail.instructions}</p>}
      <div className="foundation-actions">
        <button className="btn" disabled={!editable} onClick={() => setDialog({kind:'task'})}>Edit task</button>
        <button className="btn" disabled={!editable} onClick={() => setDialog({kind:'instructions'})}>Edit instructions</button>
        <button className="btn" disabled={!editable || busy} onClick={() => setDialog({kind:'step'})}>Add instruction</button>
      </div>
      <ProjectImages projectId={projectId} target={{kind:'task',id:task.id}} title="Task images" />
    </details>
    {dialog?.kind === 'step' && <StepEditor projectId={projectId} taskId={task.id} step={dialog.step} onClose={() => setDialog(null)} onSaved={reload} />}
    {dialog?.kind === 'instructions' && <InstructionsEditor projectId={projectId} detail={detail} onClose={() => setDialog(null)} onSaved={reload} />}
    {dialog?.kind === 'task' && <TaskModal task={task} areas={areas ?? []} onClose={() => setDialog(null)} onDone={reload} />}
    {dialog?.kind === 'delete' && dialog.step && <Modal title="Remove instruction?" onClose={() => { if (!busy) setDialog(null) }}>
      <p>Remove “{dialog.step.title}”? Its original images stay in the project image collection.</p>
      {error && <FormError>{error}</FormError>}
      <div className="foundation-actions"><button className="btn" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => db.editTaskSteps(projectId, task.id, 'delete', dialog.step!.id, { revision: dialog.step!.revision }))}>Remove instruction</button></div>
    </Modal>}
  </div>
}
