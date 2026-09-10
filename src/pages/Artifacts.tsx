import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import type {
  Area,
  ArtifactMeasurement,
  ArtifactVersion,
  ProjectArtifact,
  SelectedTarget,
} from '../data/types'
import { TRUTH_LABELS, describeMeasurement } from '../data/projectFacts'
import { Field, FormError, inputStyle } from '../components/form'
import { Modal } from '../components/Modal'
import { Loading, useAsync } from '../components/ui'
import { ProjectImages, StoredImage } from '../components/ProjectImages'

const KIND_LABELS = { plan: 'Plan', elevation: 'Elevation', section: 'Section', detail: 'Detail' } as const
const STATUS_LABELS = { concept: 'Concept', measured: 'Measured', build_ready: 'Build ready' } as const
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

function Retry({ error, retry }: { error: Error; retry: () => void }) {
  return <div role="alert"><FormError>{error.message}</FormError><button className="btn" onClick={retry}>Reload drawings</button></div>
}

function Pager({ offset, size = 12, more, move }: { offset: number; size?: number; more: boolean; move: (next: number) => void }) {
  return <div className="foundation-actions">
    {offset > 0 && <button className="btn" onClick={() => move(Math.max(0, offset - size))}>Previous page</button>}
    {more && <button className="btn" onClick={() => move(offset + size)}>Next page</button>}
  </div>
}

function Evidence({ items }: { items: ArtifactMeasurement[] }) {
  return <div className="fact-details"><h4>Measurements used by this version</h4>
    {!items.length && <p>No measurements linked. Dimensions not represented here remain unspecified.</p>}
    {items.map(item => <div key={item.id} className="fact-source">
      <strong>{item.subject} · {item.value === null ? 'Unknown' : item.value + ' ' + item.unit}</strong>
      <span>{TRUTH_LABELS[item.truth]} · Measurement version {item.revision}</span>
      <p>Source: {item.source || 'Not recorded'}</p>
      {(item.latestRevision !== item.revision || item.archived) && <p className="solution-attention">
        Measurement changed since this drawing version{item.archived ? ' and is now archived' : ''}. The recorded value above is retained.
      </p>}
    </div>)}
  </div>
}

function TargetLineage({ value, current }: { value: ProjectArtifact; current: SelectedTarget }) {
  const stillCurrent = current.decision.revision === value.targetRevision
    && current.solution?.id === value.solutionId
    && current.solution?.revision === value.solutionRevision
  return <div className="fact-source">
    <strong>Based on {value.solutionTitle} · Version {value.solutionRevision}</strong>
    <span>Target decision {value.targetRevision}</span>
    {!stillCurrent && <p className="solution-attention">The project target has changed since this drawing version. This version keeps its original target lineage.</p>}
  </div>
}

function VersionDetails({ value, target }: { value: ArtifactVersion; target: SelectedTarget }) {
  const [image, setImage] = useState(false)
  return <div className="fact-details">
    <div className="foundation-actions">
      <span className="image-purpose">{KIND_LABELS[value.kind]}</span>
      <span className="image-purpose">{STATUS_LABELS[value.status]}</span>
    </div>
    <p>{value.description}</p>
    <p><strong>Assumptions / limits:</strong> {value.assumptions || 'Not recorded'}</p>
    <p className="foundation-hint">{value.actor} · {new Date(value.recordedAt).toLocaleString()} · {value.reason}</p>
    <TargetLineage value={value} current={target} />
    <Evidence items={value.measurements} />
    {value.imageId ? <button className="btn" onClick={() => setImage(true)}>View drawing image</button>
      : value.imageTitle && <p>Drawing image removed: {value.imageTitle}</p>}
    {image && <Modal title={value.imageTitle} wide onClose={() => setImage(false)}>
      <StoredImage projectId={value.projectId} image={{ id: value.imageId!, title: value.imageTitle }} original />
      <p className="foundation-hint">Stored project image. The drawing status and linked evidence above determine what this version claims.</p>
    </Modal>}
  </div>
}

function MeasurementPicker({ projectId, onPick, onClose }: {
  projectId: string
  onPick: (measurement: ArtifactMeasurement) => void
  onClose: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(
    () => db.getProjectFacts(projectId, 'measurement', {}, offset),
    [projectId, offset, attempt],
  )
  return <Modal title="Choose a measurement" onClose={onClose}>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(value => value + 1)} /> : <>
      {!data?.items.length && <p>No active measurements here. Record them in Measurements & existing parts first.</p>}
      <div className="fact-list">{data?.items.map(item => item.kind === 'measurement' && <article className="card fact-card" key={item.id}>
        <h4>{item.subject}</h4><p>{describeMeasurement(item)} · {TRUTH_LABELS[item.truth]} · Version {item.revision}</p>
        <button className="btn" onClick={() => onPick({
          id: item.id,
          revision: item.revision,
          subject: item.subject,
          value: item.value,
          unit: item.unit,
          truth: item.truth,
          source: item.source,
          latestRevision: item.revision,
          archived: item.archived,
        })}>Use measurement</button>
      </article>)}</div>
      <Pager offset={offset} size={24} more={Boolean(data?.hasMore)} move={setOffset} />
    </>}
  </Modal>
}

function Editor({ projectId, value, areas, initialArea, target, onClose, onSaved }: {
  projectId: string
  value?: ArtifactVersion
  areas: Area[]
  initialArea: string
  target: SelectedTarget
  onClose: () => void
  onSaved: () => void
}) {
  const [id] = useState(() => value?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(value?.title ?? '')
  const [description, setDescription] = useState(value?.description ?? '')
  const [kind, setKind] = useState<ProjectArtifact['kind']>(value?.kind ?? 'plan')
  const [status, setStatus] = useState<ProjectArtifact['status']>(value?.status ?? 'concept')
  const [assumptions, setAssumptions] = useState(value?.assumptions ?? '')
  const [area, setArea] = useState(initialArea)
  const [reason, setReason] = useState('')
  const [refs, setRefs] = useState(value?.measurements ?? [])
  const [source, setSource] = useState({ id: value?.imageId ?? null, title: value?.imageTitle ?? '' })
  const [picker, setPicker] = useState<'image' | 'measurement' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = target.solution

  return <Modal title={value ? 'Revise drawing' : 'Add drawing'} onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (busy || !selected) return
      setBusy(true); setError('')
      try {
        await db.editProjectArtifact(projectId, value ? 'revise' : 'create', id, value?.revision ?? 0, {
          title,
          description,
          kind,
          status,
          assumptions,
          source_media_id: source.id,
          target_revision: target.decision.revision,
          measurements: refs.map(item => ({ id: item.id, revision: item.revision })),
          ...(value ? { change_note: reason } : { area_id: area || null }),
        })
        onSaved()
      } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}>
      <fieldset className="foundation-form fact-fieldset" disabled={busy}>
        <div className="fact-source">
          <strong>Selected project target</strong>
          <p>{selected ? `${selected.title} · Version ${selected.revision}` : 'No target selected'}</p>
          <span>Target decision {target.decision.revision}. If this decision changes before save, the save is rejected.</span>
        </div>
        <Field label="Drawing title"><input style={inputStyle} required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></Field>
        {!value && <Field label="Area"><select style={inputStyle} value={area} onChange={event => setArea(event.target.value)}>
          <option value="">Project as a whole</option>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></Field>}
        <div className="fact-filters">
          <Field label="Drawing type"><select style={inputStyle} value={kind} onChange={event => setKind(event.target.value as ProjectArtifact['kind'])}>
            {Object.entries(KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></Field>
          <Field label="Drawing status"><select style={inputStyle} value={status} onChange={event => setStatus(event.target.value as ProjectArtifact['status'])}>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></Field>
        </div>
        <p className="foundation-hint">Concept is illustrative. Measured and Build ready are deliberate project labels, not engineering or permit approval.</p>
        <Field label="What this drawing shows"><textarea style={inputStyle} rows={3} required maxLength={6000} value={description} onChange={event => setDescription(event.target.value)} /></Field>
        <Field label="Assumptions and limits"><textarea style={inputStyle} rows={2} maxLength={4000} value={assumptions} onChange={event => setAssumptions(event.target.value)} /></Field>
        <div className="fact-source"><strong>Drawing image</strong><p>{source.title || 'No image selected'}</p>
          {!source.id && source.title && <p>Previous image removed.</p>}
          <div className="foundation-actions"><button type="button" className="btn" onClick={() => setPicker('image')}>Choose drawing image</button>
            {source.title && <button type="button" className="btn" onClick={() => setSource({ id: null, title: '' })}>Clear image</button>}</div>
        </div>
        <Evidence items={refs} />
        {refs.map(item => <button key={item.id} type="button" className="btn" onClick={() => setRefs(current => current.filter(ref => ref.id !== item.id))}>Remove measurement: {item.subject}</button>)}
        <button type="button" className="btn" disabled={refs.length >= 20} onClick={() => setPicker('measurement')}>Link measurement</button>
        <p className="foundation-hint">Each link keeps the exact measurement version used by this drawing.</p>
        {value && <Field label="Reason for change"><input style={inputStyle} required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></Field>}
        {error && <div role="alert"><FormError>{error}</FormError></div>}
        <div className="foundation-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!selected}>{busy ? 'Saving and reading back…' : value ? 'Save new version' : 'Save drawing'}</button></div>
      </fieldset>
    </form>
    {picker === 'image' && <Modal title="Choose a drawing image" onClose={() => setPicker(null)}>
      <p className="foundation-hint">Uploads stay in the project gallery if you cancel the drawing.</p>
      <ProjectImages projectId={projectId} target={{ kind: 'project', id: projectId }} allowUpload
        selectImage={async image => { setSource({ id: image.id, title: image.title }); setPicker(null) }} />
    </Modal>}
    {picker === 'measurement' && <MeasurementPicker projectId={projectId} onClose={() => setPicker(null)}
      onPick={measurement => { setRefs(current => [...current.filter(item => item.id !== measurement.id), measurement]); setPicker(null) }} />}
  </Modal>
}

function VersionDialog({ projectId, id, revision, edit, areas, target, onClose, onSaved }: {
  projectId: string
  id: string
  revision: number
  edit?: boolean
  areas: Area[]
  target: SelectedTarget
  onClose: () => void
  onSaved: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(
    () => db.getProjectArtifactVersion(projectId, id, revision),
    [projectId, id, revision, attempt],
  )
  if (data && !loading && !error && edit) return <Editor projectId={projectId} value={data} areas={areas} initialArea="" target={target} onClose={onClose} onSaved={onSaved} />
  return <Modal title={data ? `${data.title} · Version ${data.revision}` : 'Drawing version'} onClose={onClose}>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(value => value + 1)} /> : data && <VersionDetails value={data} target={target} />}
  </Modal>
}

function History({ projectId, record, target, onClose, onVersion }: {
  projectId: string
  record: ProjectArtifact
  target: SelectedTarget
  onClose: () => void
  onVersion: (id: string, revision: number) => void
}) {
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(
    () => db.getProjectArtifactHistory(projectId, record.id, offset),
    [projectId, record.id, offset, attempt],
  )
  return <Modal title="Drawing history" onClose={onClose}>
    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(value => value + 1)} /> : <>
      {!data?.items.length && <p>No recorded history.</p>}
      <ol className="fact-history">{data?.items.map(item => <li key={item.revision} className="card fact-card">
        <h4>{item.title} · Version {item.revision}</h4>
        <p>{STATUS_LABELS[item.status]} · {item.reason}</p>
        <TargetLineage value={item} current={target} />
        <p className="foundation-hint">{item.actor} · {new Date(item.recordedAt).toLocaleString()}</p>
        <button className="btn" onClick={() => onVersion(item.id, item.revision)}>View version</button>
      </li>)}</ol>
      <Pager offset={offset} more={Boolean(data?.hasMore)} move={setOffset} />
    </>}
  </Modal>
}

function ArchiveDialog({ projectId, record, onClose, onSaved }: {
  projectId: string
  record: ProjectArtifact
  onClose: () => void
  onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const action = record.archived ? 'Restore drawing' : 'Archive drawing'
  return <Modal title={action} onClose={() => { if (!busy) onClose() }}>
    <p>{record.title} · Version {record.revision}</p>
    <p className="foundation-hint">Previous versions, target lineage and linked measurements stay in history.</p>
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    <div className="foundation-actions"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        if (busy) return
        setBusy(true); setError('')
        try {
          await db.editProjectArtifact(projectId, record.archived ? 'restore' : 'archive', record.id, record.revision)
          onSaved()
        } catch (err) { setError(message(err)) } finally { setBusy(false) }
      }}>{busy ? 'Saving and reading back…' : action}</button></div>
  </Modal>
}

type Dialog = { kind: 'create' }
  | { kind: 'edit' | 'view' | 'history' | 'archive'; record: ProjectArtifact }
  | { kind: 'version'; id: string; revision: number }

function ConnectedArtifacts({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams()
  const area = params.get('area') ?? ''
  const [archived, setArchived] = useState(false)
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const { data, loading, error } = useAsync(async () => {
    const [drawings, target, areas] = await Promise.all([
      db.getProjectArtifacts(projectId, area, archived, offset),
      db.getSelectedTarget(projectId),
      db.getAreas(),
    ])
    return { drawings, target, areas }
  }, [projectId, area, archived, offset, attempt])
  const close = () => setDialog(null)
  const saved = () => { close(); setAttempt(value => value + 1) }
  const target = data?.target
  const areas = data?.areas ?? []
  const canCreate = Boolean(target?.solution)

  return <div className="page project-artifacts">
    <Link className="btn" to="/">Dashboard</Link>
    <div className="page-head"><div><h1 className="page-title">Plans & drawings</h1>
      <p className="page-sub">Keep the exact plan the crew is building from, with its measurements and target version.</p></div>
      <button className="btn btn-primary" disabled={loading || Boolean(error) || !canCreate} onClick={() => setDialog({ kind: 'create' })}>Add drawing</button></div>

    {loading ? <Loading /> : error ? <Retry error={error} retry={() => setAttempt(value => value + 1)} /> : data && <>
      <section className="card fact-card" aria-label="Drawing target">
        <h2>Drawing target</h2>
        {target.solution ? <><h3>{target.solution.title} · Version {target.solution.revision}</h3>
          <p className="foundation-hint">Target decision {target.decision.revision}. New drawing versions pin this exact decision.</p>
          <Link className="btn" to="/solutions">Review target</Link></>
          : <><p>Choose a project target before creating a plan or drawing.</p>
            <p className="foundation-hint">Drawings cannot float without a decision about what the project is trying to build.</p>
            <Link className="btn btn-primary" to="/solutions">Choose a target</Link></>}
      </section>

      <div className="fact-filters"><Field label="Filter drawings by area"><select style={inputStyle} value={area} onChange={event => {
        setOffset(0); setParams(event.target.value ? { area: event.target.value } : {})
      }}><option value="">All areas</option>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Show drawings"><select style={inputStyle} value={archived ? 'archived' : 'active'} onChange={event => {
        setOffset(0); setArchived(event.target.value === 'archived')
      }}><option value="active">Active</option><option value="archived">Archived</option></select></Field></div>

      <h2>Drawings</h2>
      {!data.drawings.items.length && <p className="card fact-card">No {archived ? 'archived' : 'active'} drawings in this selection.</p>}
      <div className="fact-list artifact-list">{data.drawings.items.map(item => {
        const current = target.decision.revision === item.targetRevision
          && target.solution?.id === item.solutionId
          && target.solution?.revision === item.solutionRevision
        return <article className="card fact-card" aria-label={item.title} key={item.id}>
          <h3>{item.title}</h3>
          <div className="foundation-actions"><span className="image-purpose">{KIND_LABELS[item.kind]}</span>
            <span className="image-purpose">{STATUS_LABELS[item.status]}</span>
            <span className="image-purpose">Version {item.revision}{item.archived ? ' · Archived' : ''}</span></div>
          <p>{item.description}</p>
          <p className="foundation-hint">Based on {item.solutionTitle} · Version {item.solutionRevision} · target decision {item.targetRevision}</p>
          {!current && <p className="solution-attention">Project target changed after this drawing version. Review before building from it.</p>}
          <div className="foundation-actions">
            <button className="btn" onClick={() => setDialog({ kind: 'view', record: item })}>View evidence</button>
            {!item.archived && canCreate && <button className="btn" onClick={() => setDialog({ kind: 'edit', record: item })}>Revise</button>}
            <button className="btn" onClick={() => setDialog({ kind: 'history', record: item })}>History</button>
            <button className="btn" onClick={() => setDialog({ kind: 'archive', record: item })}>{item.archived ? 'Restore' : 'Archive'}</button>
          </div>
        </article>
      })}</div>
      <Pager offset={offset} size={24} more={data.drawings.hasMore} move={setOffset} />
    </>}

    {dialog?.kind === 'create' && target && <Editor projectId={projectId} areas={areas} initialArea={area} target={target} onClose={close} onSaved={saved} />}
    {(dialog?.kind === 'edit' || dialog?.kind === 'view' || dialog?.kind === 'version') && target && <VersionDialog
      projectId={projectId}
      id={dialog.kind === 'version' ? dialog.id : dialog.record.id}
      revision={dialog.kind === 'version' ? dialog.revision : dialog.record.revision}
      edit={dialog.kind === 'edit'}
      areas={areas}
      target={target}
      onClose={close}
      onSaved={saved}
    />}
    {dialog?.kind === 'history' && target && <History projectId={projectId} record={dialog.record} target={target} onClose={close}
      onVersion={(id, revision) => setDialog({ kind: 'version', id, revision })} />}
    {dialog?.kind === 'archive' && <ArchiveDialog projectId={projectId} record={dialog.record} onClose={close} onSaved={saved} />}
  </div>
}

export function Artifacts() {
  const id = db.getActiveProjectId()
  if (!db.authEnabled() || !id) return <div className="page"><h1 className="page-title">Plans & drawings</h1>
    <p>This demo does not save plans and drawings. Open a connected project to use them.</p><Link className="btn" to="/">Dashboard</Link></div>
  return <ConnectedArtifacts key={id} projectId={id} />
}
