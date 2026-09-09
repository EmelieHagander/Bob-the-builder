import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as db from '../data/database'
import type { TaskDetail as Detail, TaskStatus, TaskStep } from '../data/types'
import { Field, FormError, inputStyle } from '../components/form'
import { Modal } from '../components/Modal'
import { ProjectImages } from '../components/ProjectImages'
import { TaskModal } from '../components/editors'
import { Icon, Loading, SkillPill, useAsync } from '../components/ui'

const errorText = (err: unknown) => err instanceof Error ? err.message : String(err)

function StepEditor({ projectId, taskId, step, onClose, onSaved }: {
  projectId: string; taskId: string; step?: TaskStep; onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState(step?.title ?? '')
  const [instructions, setInstructions] = useState(step?.instructions ?? '')
  const [checkpoint, setCheckpoint] = useState(step?.isCheckpoint ?? false)
  const [required, setRequired] = useState(step?.required ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title={step ? 'Edit step' : 'Add step'} onClose={() => { if (!busy) onClose() }}>
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
      <Field label="Step title"><input style={inputStyle} value={title} required maxLength={200} disabled={busy} onChange={e => setTitle(e.target.value)} autoFocus /></Field>
      <Field label="Instructions"><textarea style={inputStyle} rows={5} value={instructions} maxLength={12000} disabled={busy} onChange={e => setInstructions(e.target.value)} /></Field>
      <label className="foundation-check"><input type="checkbox" checked={checkpoint} disabled={busy} onChange={e => { setCheckpoint(e.target.checked); if (!e.target.checked) setRequired(false) }} /> This is a completion check</label>
      {checkpoint && <label className="foundation-check"><input type="checkbox" checked={required} disabled={busy} onChange={e => setRequired(e.target.checked)} /> Required before the task is done</label>}
      {error && <FormError>{error}</FormError>}
      <div className="foundation-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save step'}</button></div>
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
  return <details className="step-images" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Step images</summary>
    {open && <ProjectImages projectId={projectId} target={{ kind: 'step', id: stepId }} title="Step images" />}
  </details>
}

export function TaskDetail() {
  const { taskId = '' } = useParams()
  const projectId = db.getActiveProjectId() ?? ''
  const [version, setVersion] = useState(0)
  const { data: detail, loading, error: loadError } = useAsync(() => db.getTaskDetail(projectId, taskId), [projectId, taskId, version])
  const { data: areas } = useAsync(() => db.getAreas(), [projectId])
  const [dialog, setDialog] = useState<{ kind: 'step' | 'delete'; step?: TaskStep } | { kind: 'instructions' | 'task' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reload = () => { setDialog(null); setVersion(v => v + 1) }
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); reload() } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  if (loading && !detail) return <div className="page"><Loading /></div>
  if (!detail || loadError) return <div className="page"><h1 className="page-title">Task unavailable</h1>
    <p role="alert">{loadError?.message ?? 'This task may have been removed, or your project access changed.'}</p>
    <div className="foundation-actions"><Link to="/areas" className="btn">Back to areas</Link><button className="btn" onClick={reload}>Reload task</button></div>
  </div>
  const { task, steps } = detail
  const area = areas?.find(a => a.id === task.areaId)
  const editable = db.authEnabled()
  return <div className="page task-detail">
    <Link to={area ? '/areas/' + area.slug : '/areas'} className="task-back"><Icon name="arrow-left" size={16} /> {area?.name ?? 'Areas'}</Link>
    <div className="page-head"><div><h1 className="page-title">{task.name}</h1>
      <div className="foundation-actions"><SkillPill level={task.skill} /><span>{task.hours}</span></div></div>
      <button className="btn" onClick={() => setDialog({ kind: 'task' })}>Edit task</button>
    </div>
    {!editable && <p className="foundation-hint">This demo shows the task layout. Saved instructions, steps and images are available in connected projects.</p>}
    {error && <div role="alert"><FormError>{error}</FormError><button className="btn" onClick={reload}>Reload task</button></div>}
    <div className="task-state"><Field label="Task status"><select aria-label="Task status" style={inputStyle} value={task.status} disabled={busy || loading}
      onChange={e => void act(() => db.setTaskStatus(task.id, e.target.value as TaskStatus))}>
      <option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option><option value="blocked">Blocked</option>
    </select></Field></div>
    <section className="card foundation-section" aria-label="Task instructions">
      <div className="foundation-heading"><h2>Instructions</h2><button className="btn" disabled={!editable} onClick={() => setDialog({ kind: 'instructions' })}>Edit instructions</button></div>
      {detail.instructions ? <p className="instruction-text">{detail.instructions}</p> : <p className="foundation-hint">Describe the scope and the result this task should achieve.</p>}
    </section>
    <section className="foundation-section" aria-label="Steps and checks">
      <div className="foundation-heading"><h2>Steps and checks <span className="foundation-hint">{steps.filter(s => s.completedAt).length} / {steps.length}</span></h2>
        <button className="btn btn-primary" disabled={!editable || busy} onClick={() => setDialog({ kind: 'step' })}><Icon name="plus" size={16} /> Add step</button></div>
      {!steps.length && <p className="foundation-hint">Add the work in order. Each step can have its own instructions and images.</p>}
      <ol className="task-step-list">
        {steps.map((step, index) => <li className="card task-step" key={step.id} data-step-id={step.id}>
          <div className="foundation-heading">
            <label className="foundation-check step-completion"><input type="checkbox" checked={Boolean(step.completedAt)} disabled={busy || !editable}
              onChange={e => void act(() => db.editTaskSteps(projectId, task.id, 'complete', step.id, { revision: step.revision, completed: e.target.checked }))} />
              <span><span className="step-number">{index + 1}.</span> <strong>{step.title}</strong></span></label>
            <div className="foundation-actions">
              <button className="btn" aria-label={'Move ' + step.title + ' up'} disabled={!editable || busy || index === 0}
                onClick={() => void act(() => db.editTaskSteps(projectId, task.id, 'move', step.id, { revision: step.revision, direction: 'up' }))}><Icon name="arrow-up" size={17} /></button>
              <button className="btn" aria-label={'Move ' + step.title + ' down'} disabled={!editable || busy || index === steps.length - 1}
                onClick={() => void act(() => db.editTaskSteps(projectId, task.id, 'move', step.id, { revision: step.revision, direction: 'down' }))}><Icon name="arrow-down" size={17} /></button>
              <button className="btn" disabled={!editable || busy} onClick={() => setDialog({ kind: 'step', step })}>Edit step</button>
              <button className="btn" aria-label={'Remove step: ' + step.title} disabled={!editable || busy} onClick={() => setDialog({ kind: 'delete', step })}><Icon name="trash" size={16} /></button>
            </div>
          </div>
          {step.isCheckpoint && <p className="checkpoint-label">{step.required ? 'Required completion check' : 'Optional check'}</p>}
          {step.instructions && <p className="instruction-text">{step.instructions}</p>}
          {step.completedAt && <p className="foundation-hint">Completed {new Date(step.completedAt).toLocaleString()}</p>}
          <StepImages projectId={projectId} stepId={step.id} />
        </li>)}
      </ol>
    </section>
    <div className="card foundation-section"><ProjectImages projectId={projectId} target={{ kind: 'task', id: task.id }} title="Task images" /></div>
    {dialog?.kind === 'step' && <StepEditor projectId={projectId} taskId={task.id} step={dialog.step} onClose={() => setDialog(null)} onSaved={reload} />}
    {dialog?.kind === 'instructions' && <InstructionsEditor projectId={projectId} detail={detail} onClose={() => setDialog(null)} onSaved={reload} />}
    {dialog?.kind === 'task' && <TaskModal task={task} areas={areas ?? []} onClose={() => setDialog(null)} onDone={reload} />}
    {dialog?.kind === 'delete' && dialog.step && <Modal title="Remove step?" onClose={() => { if (!busy) setDialog(null) }}>
      <p>Remove “{dialog.step.title}”? Its original images stay in the project image collection.</p>
      {error && <FormError>{error}</FormError>}
      <div className="foundation-actions"><button className="btn" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => db.editTaskSteps(projectId, task.id, 'delete', dialog.step!.id, { revision: dialog.step!.revision }))}>Remove step</button></div>
    </Modal>}
  </div>
}
