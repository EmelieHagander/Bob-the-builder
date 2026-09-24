import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { Task } from '../data/types'
import type { TaskNeedKind, TaskReadinessState } from '../data/workPlan'
import { Field, FormError, inputStyle } from './form'
import { Modal } from './Modal'
import { Icon, Loading, useAsync } from './ui'

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

const STATE_COPY: Record<TaskReadinessState, { title: string; text: string; icon: string }> = {
  unreviewed: { title: 'Readiness not reviewed', text: 'No named blocker remains, but someone still needs to confirm that this work plan is ready.', icon: 'magnifying-glass' },
  ready: { title: 'Ready to start', text: 'The current confirmed work plan has no named blocker.', icon: 'check-circle' },
  blocked: { title: 'Blocked', text: 'Resolve the named blockers before treating this task as startable.', icon: 'warning-circle' },
  complete: { title: 'Complete', text: 'This task is marked done. Its readiness record remains useful as history.', icon: 'check-circle' },
}

function DependencyEditor({ projectId, taskId, tasks, onClose, onSaved }: {
  projectId: string; taskId: string; tasks: Task[]; onClose: () => void; onSaved: () => void
}) {
  const options = tasks.filter(task => task.id !== taskId)
  const [prerequisite, setPrerequisite] = useState(options[0]?.id ?? '')
  const [checkpoint, setCheckpoint] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { data: detail } = useAsync(
    () => prerequisite ? db.getTaskDetail(projectId, prerequisite) : Promise.resolve(null),
    [projectId, prerequisite],
  )
  const checkpoints = detail?.steps.filter(step => step.isCheckpoint) ?? []
  return <Modal title="Add prerequisite" onClose={() => { if (!busy) onClose() }}>
    <form className="foundation-form" onSubmit={async event => {
      event.preventDefault(); if (busy || !prerequisite) return
      setBusy(true); setError('')
      try {
        await db.editTaskWorkPlan(projectId, taskId, 'add_dependency', null, 0, {
          prerequisite_task_id: prerequisite,
          prerequisite_step_id: checkpoint || null,
          note,
        })
        onSaved()
      } catch (err) { setError(errorText(err)); setBusy(false) }
    }}>
      <Field label="Earlier task"><select style={inputStyle} required value={prerequisite} disabled={busy} onChange={event => { setPrerequisite(event.target.value); setCheckpoint('') }}>
        {options.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}
      </select></Field>
      <Field label="What must be finished"><select style={inputStyle} value={checkpoint} disabled={busy} onChange={event => setCheckpoint(event.target.value)}>
        <option value="">Whole task must be done</option>
        {checkpoints.map(step => <option key={step.id} value={step.id}>Checkpoint: {step.title}</option>)}
      </select></Field>
      <Field label="Note"><textarea style={inputStyle} rows={2} maxLength={1000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></Field>
      {!options.length && <p className="foundation-hint">Add another task before creating a dependency.</p>}
      {error && <FormError>{error}</FormError>}
      <div className="foundation-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !prerequisite}>{busy ? 'Saving…' : 'Add prerequisite'}</button></div>
    </form>
  </Modal>
}

function NeedEditor({ projectId, taskId, kind, onClose, onSaved }: {
  projectId: string; taskId: string; kind: TaskNeedKind; onClose: () => void; onSaved: () => void
}) {
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = kind === 'tool' ? 'Add required tool' : 'Add required information'
  return <Modal title={title} onClose={() => { if (!busy) onClose() }}>
    <form className="foundation-form" onSubmit={async event => {
      event.preventDefault(); if (busy) return
      setBusy(true); setError('')
      try {
        await db.editTaskWorkPlan(projectId, taskId, 'add_need', null, 0, { kind, label, notes })
        onSaved()
      } catch (err) { setError(errorText(err)); setBusy(false) }
    }}>
      <Field label={kind === 'tool' ? 'Tool' : 'What must be confirmed'}><input style={inputStyle} required maxLength={200} value={label} disabled={busy} onChange={event => setLabel(event.target.value)} autoFocus /></Field>
      <Field label="Notes"><textarea style={inputStyle} rows={3} maxLength={2000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} /></Field>
      {error && <FormError>{error}</FormError>}
      <div className="foundation-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button></div>
    </form>
  </Modal>
}

export function TaskReadinessPanel({ projectId, taskId, areaId, refreshKey = 0 }: {
  projectId: string; taskId: string; areaId: string | null; refreshKey?: number
}) {
  const [version, setVersion] = useState(0)
  const [dialog, setDialog] = useState<'dependency' | TaskNeedKind | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const { data, loading, error } = useAsync(() => db.getTaskWorkPlan(projectId, taskId), [projectId, taskId, refreshKey, version])
  const { data: tasks } = useAsync(() => db.getTasks(), [projectId, version])
  const reload = () => { setDialog(null); setVersion(value => value + 1) }
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setActionError('')
    try { await action(); reload() } catch (err) { setActionError(errorText(err)) } finally { setBusy(false) }
  }

  if (loading && !data) return <section className="card foundation-section" aria-label="Task readiness"><Loading label="Checking readiness…" /></section>
  if (!data || error) return <section className="card foundation-section" aria-label="Task readiness"><h2>Readiness</h2><p role="alert">{error?.message ?? 'Readiness is unavailable.'}</p><button className="btn" onClick={reload}>Reload readiness</button></section>

  const copy = STATE_COPY[data.readiness.state]
  if (!copy) return <section className="card foundation-section" aria-label="Task readiness"><h2>Readiness</h2><p role="alert">Readiness data is unavailable or out of date.</p><button className="btn" onClick={reload}>Reload readiness</button></section>
  const tools = data.needs.filter(item => item.kind === 'tool')
  const information = data.needs.filter(item => item.kind === 'information')
  const materialHref = areaId ? `/material-plan?area=${encodeURIComponent(areaId)}` : '/material-plan'

  return <section className="card foundation-section" aria-label="Task readiness">
    <div className="foundation-heading">
      <div><h2 style={{ marginBottom: 4 }}>Readiness</h2><div className="foundation-actions"><Icon name={copy.icon} size={18} /><strong>{copy.title}</strong></div></div>
      {data.readiness.state === 'unreviewed' && <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => db.editTaskWorkPlan(projectId, taskId, 'confirm_readiness', null, 0, {}))}>Confirm ready</button>}
    </div>
    <p className="foundation-hint">{copy.text}</p>
    {data.readiness.reviewedAt && <p className="foundation-hint">Last confirmed {new Date(data.readiness.reviewedAt).toLocaleString()}{data.readiness.reviewedBy ? ` by ${data.readiness.reviewedBy}` : ''}.</p>}
    {actionError && <div role="alert"><FormError>{actionError}</FormError></div>}

    {data.readiness.blockers.length > 0 && <div className="fact-details"><h3 style={{ marginTop: 0 }}>What blocks this task</h3>{data.readiness.blockers.map(blocker => <p key={`${blocker.kind}:${blocker.id}`}><Icon name="warning-circle" size={15} /> {blocker.label}</p>)}</div>}

    <details open={data.readiness.state === 'blocked'} style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 750 }}>Readiness details</summary>
      <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
        <div className="fact-source">
          <div className="foundation-heading"><strong>Prerequisites</strong><button className="btn" disabled={busy || !(tasks?.some(task => task.id !== taskId))} onClick={() => setDialog('dependency')}><Icon name="plus" size={14} /> Add</button></div>
          {!data.dependencies.length ? <p>No explicit task dependency recorded.</p> : data.dependencies.map(dependency => <div key={dependency.id} style={{ marginTop: 9 }}>
            <p style={{ margin: 0 }}><Icon name={dependency.satisfied ? 'check-circle' : 'warning-circle'} size={15} /> <strong>{dependency.prerequisiteTaskName}</strong>{dependency.prerequisiteStepTitle ? ` · ${dependency.prerequisiteStepTitle}` : ' · whole task'}</p>
            {dependency.note && <small>{dependency.note}</small>}
            <button className="btn" style={{ marginTop: 6 }} disabled={busy} onClick={() => void act(() => db.editTaskWorkPlan(projectId, taskId, 'remove_dependency', dependency.id, 0, {}))}>Remove</button>
          </div>)}
        </div>

        <div className="fact-source">
          <div className="foundation-heading"><strong>Tools</strong><button className="btn" disabled={busy} onClick={() => setDialog('tool')}><Icon name="plus" size={14} /> Add</button></div>
          {!tools.length ? <p>No required tool recorded.</p> : tools.map(need => <div key={need.id} className="foundation-actions" style={{ justifyContent: 'space-between', marginTop: 8 }}><label className="foundation-check" style={{ flex: 1 }}><input aria-label={`Available: ${need.label}`} type="checkbox" checked={need.ready} disabled={busy} onChange={event => void act(() => db.editTaskWorkPlan(projectId, taskId, 'set_need_ready', need.id, need.revision, { ready: event.target.checked }))} /><span><strong>{need.label}</strong>{need.notes && <small style={{ display: 'block' }}>{need.notes}</small>}</span></label><button type="button" className="btn" disabled={busy} onClick={() => void act(() => db.editTaskWorkPlan(projectId, taskId, 'remove_need', need.id, need.revision, {}))}>Remove</button></div>)}
        </div>

        <div className="fact-source">
          <div className="foundation-heading"><strong>Required information</strong><button className="btn" disabled={busy} onClick={() => setDialog('information')}><Icon name="plus" size={14} /> Add</button></div>
          {!information.length ? <p>No explicit information check recorded.</p> : information.map(need => <div key={need.id} className="foundation-actions" style={{ justifyContent: 'space-between', marginTop: 8 }}><label className="foundation-check" style={{ flex: 1 }}><input aria-label={`Confirmed: ${need.label}`} type="checkbox" checked={need.ready} disabled={busy} onChange={event => void act(() => db.editTaskWorkPlan(projectId, taskId, 'set_need_ready', need.id, need.revision, { ready: event.target.checked }))} /><span><strong>{need.label}</strong>{need.notes && <small style={{ display: 'block' }}>{need.notes}</small>}</span></label><button type="button" className="btn" disabled={busy} onClick={() => void act(() => db.editTaskWorkPlan(projectId, taskId, 'remove_need', need.id, need.revision, {}))}>Remove</button></div>)}
        </div>

        <div className="fact-source">
          <div className="foundation-heading"><strong>Materials</strong><Link className="btn" to={materialHref}>Material plan</Link></div>
          {!data.materials.length ? <p>No canonical material requirement is linked to this task. That does not prove materials are unnecessary.</p> : data.materials.map(material => <p key={material.requirementId}><Icon name={material.ready ? 'check-circle' : 'warning-circle'} size={15} /> <strong>{material.name}</strong> · {material.reason}</p>)}
        </div>
      </div>
    </details>

    {dialog === 'dependency' && <DependencyEditor projectId={projectId} taskId={taskId} tasks={tasks ?? []} onClose={() => setDialog(null)} onSaved={reload} />}
    {(dialog === 'tool' || dialog === 'information') && <NeedEditor projectId={projectId} taskId={taskId} kind={dialog} onClose={() => setDialog(null)} onSaved={reload} />}
  </section>
}
