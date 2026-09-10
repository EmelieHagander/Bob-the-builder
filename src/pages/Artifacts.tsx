import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as db from '../data/database'
import type { Area, Artifact } from '../data/types'
import { ARTIFACT_KINDS } from '../data/artifacts'
import { Field, FormError, inputStyle } from '../components/form'
import { Modal } from '../components/Modal'
import { Loading, useAsync } from '../components/ui'
import { ProjectImages } from '../components/ProjectImages'
import { ArtifactDetails, ArtifactPager, ArtifactRetry, ArtifactStatus, artifactError } from '../components/ArtifactDetails'
import { SolutionEvidence } from '../components/SolutionEvidence'

function Editor({ projectId, value, areas, initialArea, onClose, onSaved }: {
  projectId: string; value?: Artifact; areas: Area[]; initialArea: string; onClose: () => void; onSaved: () => void
}) {
  const [id] = useState(() => value?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(value?.title ?? ''), [kind, setKind] = useState<Artifact['kind']>(value?.kind ?? 'reference')
  const [notes, setNotes] = useState(value?.notes ?? ''), [source, setSource] = useState(value?.source ?? '')
  const [unresolved, setUnresolved] = useState(value?.unresolved ?? ''), [reason, setReason] = useState('')
  const [area, setArea] = useState(initialArea), [reviewed, setReviewed] = useState(false)
  const [image, setImage] = useState({ id: value?.imageId ?? null, title: value?.imageTitle ?? '' })
  const [picker, setPicker] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const target = useAsync(() => db.getSelectedTarget(projectId), [projectId, attempt])
  return <Modal title={value ? 'Revise drawing/reference' : 'Add drawing/reference'} onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={async e => {
      e.preventDefault(); if (busy || !target.data?.solution) return
      setBusy(true); setError('')
      try {
        await db.editArtifact(projectId, value ? 'revise' : 'create', id, value?.revision ?? 0, {
          title, kind, notes, source, unresolved, source_media_id: image.id, reviewed,
          expected_target_revision: target.data.decision.revision,
          ...(value ? { change_note: reason } : { area_id: area || null }),
        }); onSaved()
      } catch (e) { setError(artifactError(e)) } finally { setBusy(false) }
    }}><fieldset className="foundation-form fact-fieldset" disabled={busy}>
      <Field label="Reference name"><input style={inputStyle} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label="Drawing kind"><select style={inputStyle} value={kind} onChange={e => setKind(e.target.value as Artifact['kind'])}>
        {Object.entries(ARTIFACT_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></Field>
      {!value && <Field label="Area"><select style={inputStyle} value={area} onChange={e => setArea(e.target.value)}>
        <option value="">Project as a whole</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select></Field>}
      <div className="fact-source"><strong>Project image</strong><p>{image.title || 'Choose or upload an image'}</p>
        <button type="button" className="btn" onClick={() => setPicker(true)}>Choose drawing image</button>
      </div>
      <Field label="Notes"><textarea style={inputStyle} rows={3} maxLength={6000} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <Field label="Source and preparation"><textarea style={inputStyle} rows={2} required maxLength={4000} value={source} onChange={e => setSource(e.target.value)} /></Field>
      <Field label="Unresolved checks"><textarea style={inputStyle} rows={2} maxLength={4000} value={unresolved} onChange={e => setUnresolved(e.target.value)} /></Field>
      <div className="fact-source"><h3>Target for this new version</h3>
        {target.loading ? <Loading /> : target.error ? <FormError>{target.error.message}</FormError> : target.data?.solution ? <>
          <strong>{target.data.solution.title} · Solution version {target.data.solution.revision}</strong>
          <p>{target.data.solution.description}</p><p>Assumptions: {target.data.solution.assumptions || 'Not recorded'}</p>
          <SolutionEvidence items={target.data.solution.measurements} />
        </> : <p>Select a project target in Solutions & target before saving.</p>}
        {value && <p>Previous basis: {value.solutionTitle} · Solution version {value.solutionRevision}. Saving creates a new version for the target shown above.</p>}
        <button type="button" className="btn" onClick={() => { setReviewed(false); setAttempt(n => n + 1) }}>Reload selected target</button>
      </div>
      <label className="artifact-review"><input type="checkbox" required checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
        I checked this image and notes against the selected solution and its measurements.</label>
      <p className="foundation-hint">Manually supplied reference. This records your review; it does not verify dimensions or construction readiness.</p>
      {value && <Field label="Reason for change"><input style={inputStyle} required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
      {error && <div role="alert"><FormError>{error}</FormError></div>}
      <div className="foundation-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!image.id || !reviewed || target.loading || Boolean(target.error) || !target.data?.solution}>
          {busy ? 'Saving and reading back…' : value ? 'Save new version' : 'Save reference'}</button></div>
    </fieldset></form>
    {picker && <Modal title="Choose a drawing image" onClose={() => setPicker(false)}>
      <p className="foundation-hint">Uploads stay in the project gallery if you cancel the reference.</p>
      <ProjectImages projectId={projectId} target={{ kind: 'project', id: projectId }} allowUpload selectImage={async v => {
        setImage({ id: v.id, title: v.title }); setReviewed(false); setPicker(false)
      }} />
    </Modal>}
  </Modal>
}
function History({ projectId, value, onClose, onVersion }: { projectId: string; value: Artifact; onClose: () => void; onVersion: (v: Artifact) => void }) {
  const [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0)
  const { data, loading, error } = useAsync(() => db.getArtifactHistory(projectId, value.id, offset), [projectId, value.id, offset, attempt])
  return <Modal title="Drawing/reference history" onClose={onClose}>
    {loading ? <Loading /> : error ? <ArtifactRetry error={error} retry={() => setAttempt(n => n + 1)} /> : <>
      <ol className="fact-history">{data?.items.map(v => <li key={v.revision} className="card fact-card">
        <h4>{v.title} · Version {v.revision}</h4><p>{v.reason}</p><p>{v.actor} · {new Date(v.recordedAt).toLocaleString()}</p>
        <button className="btn" onClick={() => onVersion(v)}>View version</button>
      </li>)}</ol><ArtifactPager offset={offset} size={12} more={Boolean(data?.hasMore)} move={setOffset} />
    </>}
  </Modal>
}
function Archive({ value, onClose, onSaved }: { value: Artifact; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <Modal title={value.archived ? 'Restore drawing/reference' : 'Archive drawing/reference'} onClose={() => { if (!busy) onClose() }}>
    <p>{value.title} · Version {value.revision}</p><p>History and existing task references keep their recorded versions and basis.</p>
    {error && <div role="alert"><FormError>{error}</FormError></div>}
    <div className="foundation-actions"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError('')
        try { await db.editArtifact(value.projectId, value.archived ? 'restore' : 'archive', value.id, value.revision); onSaved() }
        catch (e) { setError(artifactError(e)) } finally { setBusy(false) }
      }}>{busy ? 'Saving and reading back…' : value.archived ? 'Restore reference' : 'Archive reference'}</button></div>
  </Modal>
}
type Dialog = { kind: 'create' } | { kind: 'edit' | 'view' | 'history' | 'archive'; value: Artifact }
function ConnectedArtifacts({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams(), area = params.get('area') ?? ''
  const [archived, setArchived] = useState(false), [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const { data, loading, error } = useAsync(async () => {
    const [artifacts, target, areas] = await Promise.all([db.getArtifacts(projectId, area, archived, offset), db.getSelectedTarget(projectId), db.getAreas()])
    return { artifacts, target, areas }
  }, [projectId, area, archived, offset, attempt])
  const close = () => setDialog(null), saved = () => { close(); setAttempt(n => n + 1) }
  return <div className="page artifacts-page"><Link className="btn" to="/">Dashboard</Link>
    <div className="page-head"><div><h1 className="page-title">Drawings & references</h1><p className="page-sub">Keep the reviewed image and solution version together.</p></div>
      <button className="btn btn-primary" disabled={loading || Boolean(error) || !data?.target.solution} onClick={() => setDialog({ kind: 'create' })}>Add drawing/reference</button></div>
    {loading ? <Loading /> : error ? <ArtifactRetry error={error} retry={() => setAttempt(n => n + 1)} /> : data && <>
      <div className="card fact-card"><h2>Selected project target</h2>
        <p>{data.target.solution ? data.target.solution.title + ' · Solution version ' + data.target.solution.revision : 'Select a project target before adding or revising a drawing/reference.'}</p>
        <Link className="btn" to="/solutions">Solutions & target</Link>
      </div>
      <div className="fact-filters"><Field label="Filter references by area"><select style={inputStyle} value={area} onChange={e => { setOffset(0); setParams(e.target.value ? { area: e.target.value } : {}) }}>
        <option value="">All areas</option>{data.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select></Field><Field label="Show references"><select style={inputStyle} value={archived ? 'archived' : 'active'} onChange={e => { setOffset(0); setArchived(e.target.value === 'archived') }}>
        <option value="active">Active</option><option value="archived">Archived</option>
      </select></Field></div>
      {!data.artifacts.items.length && <p className="card fact-card">No {archived ? 'archived' : 'active'} drawings/references in this selection.</p>}
      <div className="fact-list artifact-list">{data.artifacts.items.map(v => <article className="card fact-card" aria-label={v.title} key={v.id}>
        <h3>{v.title}</h3><ArtifactStatus value={v} /><p>{v.notes}</p>
        <div className="foundation-actions"><button className="btn" onClick={() => setDialog({ kind: 'view', value: v })}>View reference</button>
          {!v.archived && <button className="btn" disabled={!data.target.solution} onClick={() => setDialog({ kind: 'edit', value: v })}>Revise</button>}
          <button className="btn" onClick={() => setDialog({ kind: 'history', value: v })}>History</button>
          <button className="btn" onClick={() => setDialog({ kind: 'archive', value: v })}>{v.archived ? 'Restore' : 'Archive'}</button></div>
      </article>)}</div><ArtifactPager offset={offset} more={data.artifacts.hasMore} move={setOffset} />
    </>}
    {(dialog?.kind === 'create' || dialog?.kind === 'edit') && <Editor projectId={projectId} value={dialog.kind === 'edit' ? dialog.value : undefined}
      areas={data?.areas ?? []} initialArea={area} onClose={close} onSaved={saved} />}
    {dialog?.kind === 'view' && <ArtifactDetails projectId={projectId} id={dialog.value.id} revision={dialog.value.revision} onClose={close} />}
    {dialog?.kind === 'history' && <History projectId={projectId} value={dialog.value} onClose={close} onVersion={value => setDialog({ kind: 'view', value })} />}
    {dialog?.kind === 'archive' && <Archive value={dialog.value} onClose={close} onSaved={saved} />}
  </div>
}
export function Artifacts() {
  const id = db.getActiveProjectId()
  if (!db.authEnabled() || !id) return <div className="page"><h1 className="page-title">Drawings & references</h1><p>This demo does not save drawings/references. Open a connected project to use them.</p><Link className="btn" to="/">Dashboard</Link></div>
  return <ConnectedArtifacts key={id} projectId={id} />
}
