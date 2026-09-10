import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import type { Area, Solution, SolutionVersion, SolutionMeasurement, TargetDecision } from '../data/types'
import { TRUTH_LABELS, describeMeasurement } from '../data/projectFacts'
import { Field, FormError, inputStyle } from '../components/form'
import { Modal } from '../components/Modal'
import { Loading, useAsync } from '../components/ui'
import { SolutionEvidence } from '../components/SolutionEvidence'
import { ProjectImages, StoredImage } from '../components/ProjectImages'

const message = (e: unknown) => e instanceof Error ? e.message : String(e)
function Retry({ error, retry }: { error: Error; retry: () => void }) {
  return <div role="alert"><FormError>{error.message}</FormError><button className="btn" onClick={retry}>Reload solutions</button></div>
}
function VersionDetails({ value }: { value: SolutionVersion }) {
  const [image, setImage] = useState(false)
  return <div className="fact-details">
    <p>{value.description}</p><p><strong>Assumptions:</strong> {value.assumptions || 'Not recorded'}</p>
    <p><strong>Trade-offs:</strong> {value.tradeoffs || 'Not recorded'}</p>
    <p className="foundation-hint">{value.actor} · {new Date(value.recordedAt).toLocaleString()} · {value.reason}</p>
    <SolutionEvidence items={value.measurements} />
    {value.imageId ? <button className="btn" onClick={() => setImage(true)}>View reference image</button>
      : value.imageTitle && <p>Reference image removed: {value.imageTitle}</p>}
    {image && <Modal title={value.imageTitle} wide onClose={() => setImage(false)}>
      <StoredImage projectId={value.projectId} image={{ id: value.imageId!, title: value.imageTitle }} original />
      <p className="foundation-hint">Reference image. This does not make the solution a measured drawing.</p>
    </Modal>}
  </div>
}
function MeasurementPicker({ projectId, onPick, onClose }: { projectId: string; onPick: (m: SolutionMeasurement) => void; onClose: () => void }) {
  const [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(() => db.getProjectFacts(projectId, 'measurement', {}, offset), [projectId, offset, attempt])
  return <Modal title="Choose a measurement" onClose={onClose}>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(n => n + 1)} /> : <>
      {!data?.items.length && <p>No active measurements here. Record them in Measurements & existing parts first.</p>}
      <div className="fact-list">{data?.items.map(m => m.kind === 'measurement' && <article className="card fact-card" key={m.id}>
        <h4>{m.subject}</h4><p>{describeMeasurement(m)} · {TRUTH_LABELS[m.truth]} · Version {m.revision}</p>
        <button className="btn" onClick={() => onPick({ id: m.id, revision: m.revision, subject: m.subject,
          value: m.value, unit: m.unit, truth: m.truth, source: m.source, latestRevision: m.revision, archived: m.archived })}>Use measurement</button>
      </article>)}</div>
      <Pager offset={offset} size={24} more={Boolean(data?.hasMore)} move={setOffset} />
    </>}
  </Modal>
}
function Pager({ offset, size = 12, more, move }: { offset: number; size?: number; more: boolean; move: (n: number) => void }) {
  return <div className="foundation-actions">
    {offset > 0 && <button className="btn" onClick={() => move(Math.max(0, offset - size))}>Previous page</button>}
    {more && <button className="btn" onClick={() => move(offset + size)}>Next page</button>}
  </div>
}
function Editor({ projectId, value, areas, initialArea, onClose, onSaved }: {
  projectId: string; value?: SolutionVersion; areas: Area[]; initialArea: string; onClose: () => void; onSaved: () => void
}) {
  const [id] = useState(() => value?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(value?.title ?? ''), [description, setDescription] = useState(value?.description ?? '')
  const [assumptions, setAssumptions] = useState(value?.assumptions ?? ''), [tradeoffs, setTradeoffs] = useState(value?.tradeoffs ?? '')
  const [area, setArea] = useState(initialArea), [reason, setReason] = useState('')
  const [refs, setRefs] = useState(value?.measurements ?? [])
  const [source, setSource] = useState({ id: value?.imageId ?? null, title: value?.imageTitle ?? '' })
  const [picker, setPicker] = useState<'image' | 'measurement' | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <Modal title={value ? 'Revise alternative' : 'Add alternative'} onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={async e => {
      e.preventDefault(); if (busy) return
      setBusy(true); setError('')
      try {
        await db.editSolution(projectId, value ? 'revise' : 'create', id, value?.revision ?? 0, {
          title, description, assumptions, tradeoffs, source_media_id: source.id,
          measurements: refs.map(m => ({ id: m.id, revision: m.revision })),
          ...(value ? { change_note: reason } : { area_id: area || null }),
        }); onSaved()
      } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}><fieldset className="foundation-form fact-fieldset" disabled={busy}>
      <Field label="Alternative name"><input style={inputStyle} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></Field>
      {!value && <Field label="Area"><select style={inputStyle} value={area} onChange={e => setArea(e.target.value)}>
        <option value="">Project as a whole</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select></Field>}
      <Field label="Description and rationale"><textarea style={inputStyle} rows={3} required maxLength={6000} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <Field label="Assumptions and unknowns"><textarea style={inputStyle} rows={2} maxLength={4000} value={assumptions} onChange={e => setAssumptions(e.target.value)} /></Field>
      <Field label="Trade-offs"><textarea style={inputStyle} rows={2} maxLength={4000} value={tradeoffs} onChange={e => setTradeoffs(e.target.value)} /></Field>
      <div className="fact-source"><strong>Reference image</strong><p>{source.title || 'No image selected'}</p>
        {!source.id && source.title && <p>Previous image removed.</p>}
        <div className="foundation-actions"><button type="button" className="btn" onClick={() => setPicker('image')}>Choose reference image</button>
          {source.title && <button type="button" className="btn" onClick={() => setSource({ id: null, title: '' })}>Clear image</button>}</div>
      </div>
      <SolutionEvidence items={refs} />
      {refs.map(m => <button key={m.id} type="button" className="btn" onClick={() => setRefs(rs => rs.filter(r => r.id !== m.id))}>Remove measurement: {m.subject}</button>)}
      <button type="button" className="btn" disabled={refs.length >= 20} onClick={() => setPicker('measurement')}>Link measurement</button>
      <p className="foundation-hint">Each link keeps the chosen measurement version. Link it again to use a newer value.</p>
      {value && <><Field label="Reason for change"><input style={inputStyle} required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        <p className="foundation-hint">A new version does not change the selected project target. Select it separately when ready.</p></>}
      {error && <div role="alert"><FormError>{error}</FormError></div>}
      <div className="foundation-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary">{busy ? 'Saving and reading back…' : value ? 'Save new version' : 'Save alternative'}</button></div>
    </fieldset></form>
    {picker === 'image' && <Modal title="Choose a reference image" onClose={() => setPicker(null)}>
      <p className="foundation-hint">Uploads stay in the project gallery if you cancel the alternative.</p>
      <ProjectImages projectId={projectId} target={{ kind: 'project', id: projectId }} allowUpload
        selectImage={async image => { setSource({ id: image.id, title: image.title }); setPicker(null) }} />
    </Modal>}
    {picker === 'measurement' && <MeasurementPicker projectId={projectId} onClose={() => setPicker(null)}
      onPick={m => { setRefs(rs => [...rs.filter(r => r.id !== m.id), m]); setPicker(null) }} />}
  </Modal>
}
function VersionDialog({ projectId, id, revision, edit, areas, onClose, onSaved }: {
  projectId: string; id: string; revision: number; edit?: boolean; areas: Area[]; onClose: () => void; onSaved: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(() => db.getSolutionVersion(projectId, id, revision), [projectId, id, revision, attempt])
  if (data && !loading && !error && edit) return <Editor projectId={projectId} value={data} areas={areas} initialArea="" onClose={onClose} onSaved={onSaved} />
  return <Modal title={data ? data.title + ' · Version ' + data.revision : 'Solution version'} onClose={onClose}>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(n => n + 1)} /> : data && <VersionDetails value={data} />}
  </Modal>
}
function History({ projectId, record, onClose, onVersion }: {
  projectId: string; record?: Solution; onClose: () => void; onVersion: (id: string, revision: number) => void
}) {
  const [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(async () => record
    ? db.getSolutionHistory(projectId, record.id, offset) : db.getTargetHistory(projectId, offset), [projectId, record?.id, offset, attempt])
  return <Modal title={record ? 'Alternative history' : 'Target decisions'} onClose={onClose}>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(n => n + 1)} /> : <>
      {!data?.items.length && <p>No recorded history.</p>}
      <ol className="fact-history">{data?.items.map((r: Solution | TargetDecision) => <li key={r.revision} className="card fact-card">
        <h4>{'title' in r ? r.title + ' · Version ' + r.revision : 'Decision ' + r.revision + (r.solutionId ? ' · Selected version ' + r.solutionRevision : ' · Target cleared')}</h4>
        <p>{r.reason}</p><p className="foundation-hint">{r.actor} · {new Date(r.recordedAt).toLocaleString()}</p>
        {'title' in r ? <button className="btn" onClick={() => onVersion(r.id, r.revision)}>View version</button>
          : r.solutionId && <button className="btn" onClick={() => onVersion(r.solutionId!, r.solutionRevision!)}>View selected version</button>}
      </li>)}</ol><Pager offset={offset} more={Boolean(data?.hasMore)} move={setOffset} />
    </>}
  </Modal>
}
function DecisionDialog({ projectId, record, expected, archive, onClose, onSaved }: {
  projectId: string; record?: Solution; expected: number; archive?: boolean; onClose: () => void; onSaved: () => void
}) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const action = archive ? record?.archived ? 'Restore alternative' : 'Archive alternative' : record ? 'Select target' : 'Clear target'
  return <Modal title={action} onClose={() => { if (!busy) onClose() }}><form className="foundation-form" onSubmit={async e => {
    e.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      if (archive && record) await db.editSolution(projectId, record.archived ? 'restore' : 'archive', record.id, record.revision)
      else await db.selectTarget(projectId, record ?? null, expected, reason)
      onSaved()
    } catch (err) { setError(message(err)) } finally { setBusy(false) }
  }}>
    <p>{record ? record.title + ' · Version ' + record.revision : 'The project will have no selected target.'}</p>
    <p className="foundation-hint">{archive ? 'Previous versions and decisions stay in history.' : 'This records project intent. It does not certify construction safety or update tasks and shopping.'}</p>
    {!archive && <Field label="Reason for decision"><textarea style={inputStyle} rows={2} required disabled={busy} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    <div className="foundation-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving and reading back…' : action}</button></div>
  </form></Modal>
}
type Dialog = { kind: 'create' } | { kind: 'decisions' } | { kind: 'clear' } | { kind: 'edit' | 'view' | 'history' | 'select' | 'archive'; record: Solution }
  | { kind: 'version'; id: string; revision: number }
function ConnectedSolutions({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams(), area = params.get('area') ?? ''
  const [archived, setArchived] = useState(false), [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const { data, loading, error } = useAsync(async () => {
    const [alternatives, target, areas] = await Promise.all([db.getSolutions(projectId, area, archived, offset), db.getSelectedTarget(projectId), db.getAreas()])
    return { alternatives, target, areas }
  }, [projectId, area, archived, offset, attempt])
  const close = () => setDialog(null), saved = () => { close(); setAttempt(n => n + 1) }
  const target = data?.target, areas = data?.areas ?? []
  return <div className="page solutions-page">
    <Link className="btn" to="/">Dashboard</Link>
    <div className="page-head"><div><h1 className="page-title">Solutions & target</h1><p className="page-sub">Keep alternatives and choose the version everyone builds toward.</p></div>
      <button className="btn btn-primary" disabled={loading || Boolean(error)} onClick={() => setDialog({ kind: 'create' })}>Add alternative</button></div>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(n => n + 1)} /> : data && <>
      <section className="card fact-card solution-target" aria-label="Selected project target">
        <h2>Selected project target</h2>
        {target?.solution ? <><h3>{target.solution.title} · Version {target.solution.revision}</h3>
          <p>{target.decision.reason}</p><p className="foundation-hint">Selected by {target.decision.actor} · {new Date(target.decision.recordedAt).toLocaleString()}</p>
          <VersionDetails value={target.solution} />
          <button className="btn" onClick={() => setDialog({ kind: 'clear' })}>Clear target</button>
        </> : <p>No target selected. Add alternatives, then choose one version for the project.</p>}
        <p className="foundation-hint">One target for the whole project. Later edits remain alternatives until explicitly selected.</p>
        <button className="btn" onClick={() => setDialog({ kind: 'decisions' })}>Decision history</button>
      </section>
      <div className="fact-filters"><Field label="Filter alternatives by area"><select style={inputStyle} value={area} onChange={e => { setOffset(0); setParams(e.target.value ? { area: e.target.value } : {}) }}>
        <option value="">All areas</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select></Field><Field label="Show alternatives"><select style={inputStyle} value={archived ? 'archived' : 'active'} onChange={e => { setOffset(0); setArchived(e.target.value === 'archived') }}>
        <option value="active">Active</option><option value="archived">Archived</option>
      </select></Field></div>
      <h2>Alternatives</h2>
      {!data.alternatives.items.length && <p className="card fact-card">No {archived ? 'archived' : 'active'} alternatives in this selection.</p>}
      <div className="fact-list solution-list">{data.alternatives.items.map(s => <article className="card fact-card" aria-label={s.title} key={s.id}>
        <h3>{s.title}</h3><span className="image-purpose">Version {s.revision}{s.archived ? ' · Archived' : ''}</span>
        {target?.solution?.id === s.id && <p className="solution-attention">{target.solution.revision === s.revision ? 'Selected target version' : 'Newer alternative version. Target still uses version ' + target.solution.revision + '.'}</p>}
        <div className="fact-details"><p>{s.description}</p><p><strong>Assumptions:</strong> {s.assumptions || 'Not recorded'}</p><p><strong>Trade-offs:</strong> {s.tradeoffs || 'Not recorded'}</p></div>
        <div className="foundation-actions">
          <button className="btn" onClick={() => setDialog({ kind: 'view', record: s })}>View evidence</button>
          {!s.archived && <><button className="btn" onClick={() => setDialog({ kind: 'edit', record: s })}>Revise</button>
            <button className="btn btn-primary" onClick={() => setDialog({ kind: 'select', record: s })}>Select target</button></>}
          <button className="btn" onClick={() => setDialog({ kind: 'history', record: s })}>History</button>
          <button className="btn" onClick={() => setDialog({ kind: 'archive', record: s })}>{s.archived ? 'Restore' : 'Archive'}</button>
        </div>
      </article>)}</div><Pager offset={offset} size={24} more={data.alternatives.hasMore} move={setOffset} />
    </>}
    {dialog?.kind === 'create' && <Editor projectId={projectId} areas={areas} initialArea={area} onClose={close} onSaved={saved} />}
    {(dialog?.kind === 'edit' || dialog?.kind === 'view' || dialog?.kind === 'version') && <VersionDialog projectId={projectId}
      id={dialog.kind === 'version' ? dialog.id : dialog.record.id} revision={dialog.kind === 'version' ? dialog.revision : dialog.record.revision}
      edit={dialog.kind === 'edit'} areas={areas} onClose={close} onSaved={saved} />}
    {(dialog?.kind === 'history' || dialog?.kind === 'decisions') && <History projectId={projectId}
      record={dialog.kind === 'history' ? dialog.record : undefined} onClose={close} onVersion={(id, revision) => setDialog({ kind: 'version', id, revision })} />}
    {(dialog?.kind === 'select' || dialog?.kind === 'clear' || dialog?.kind === 'archive') && <DecisionDialog projectId={projectId}
      record={dialog.kind === 'clear' ? undefined : dialog.record} expected={target?.decision.revision ?? 0} archive={dialog.kind === 'archive'} onClose={close} onSaved={saved} />}
  </div>
}
export function Solutions() {
  const id = db.getActiveProjectId()
  if (!db.authEnabled() || !id) return <div className="page"><h1 className="page-title">Solutions & target</h1><p>This demo does not save solutions. Open a connected project to use them.</p><Link className="btn" to="/">Dashboard</Link></div>
  return <ConnectedSolutions key={id} projectId={id} />
}
