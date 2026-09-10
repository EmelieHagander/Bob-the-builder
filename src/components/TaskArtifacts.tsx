import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as db from '../data/database'
import type { Artifact } from '../data/types'
import { FormError } from './form'
import { Modal } from './Modal'
import { Loading, useAsync } from './ui'
import { ArtifactDetails, ArtifactPager, ArtifactRetry, ArtifactStatus, artifactError } from './ArtifactDetails'

function Picker({ projectId, taskId, onClose, onSaved }: { projectId: string; taskId: string; onClose: () => void; onSaved: () => void }) {
  const [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false), [failure, setFailure] = useState('')
  const { data, loading, error } = useAsync(() => db.getArtifacts(projectId, '', false, offset), [projectId, offset, attempt])
  return <Modal title="Attach drawing/reference" onClose={() => { if (!busy) onClose() }}>
    <p>The task keeps the version you attach. Update an existing reference from the task after reviewing its new version.</p>
    {loading ? <Loading /> : error ? <ArtifactRetry error={error} retry={() => setAttempt(n => n + 1)} /> : <>
      {!data?.items.length && <p>No active drawings/references available. Add one from Drawings & references first.</p>}
      <div className="fact-list">{data?.items.map(v => <article className="card fact-card" key={v.id} aria-label={v.title}>
        <h4>{v.title}</h4><ArtifactStatus value={v} />
        <button className="btn" disabled={busy || !v.imageReady} onClick={async () => {
          setBusy(true); setFailure('')
          try { await db.linkTaskArtifact(projectId, taskId, v, 'attach', 0); onSaved() }
          catch (e) { setFailure(artifactError(e)) } finally { setBusy(false) }
        }}>Attach version {v.revision}</button>
      </article>)}</div>
      {!busy && <ArtifactPager offset={offset} more={Boolean(data?.hasMore)} move={setOffset} />}
    </>}
    {failure && <div role="alert"><FormError>{failure}</FormError></div>}
  </Modal>
}
function ChangeLink({ value, action, onClose, onSaved }: { value: Artifact; action: 'attach' | 'detach'; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [view, setView] = useState(false)
  return <Modal title={action === 'attach' ? 'Update task reference' : 'Detach task reference'} onClose={() => { if (!busy) onClose() }}>
    <p>{value.title} · Current task reference: version {value.revision}</p>
    <p>{action === 'attach' ? 'This task will use version ' + value.latestRevision + '. Review it before updating.' : 'Only this task reference is removed. The drawing/reference and its history stay in the project.'}</p>
    {action === 'attach' && <button className="btn" disabled={busy} onClick={() => setView(true)}>Review version {value.latestRevision}</button>}
    {failure && <div role="alert"><FormError>{failure}</FormError></div>}
    <div className="foundation-actions"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setFailure('')
        try { await db.linkTaskArtifact(value.projectId, value.taskId!, value, action, value.revision); onSaved() }
        catch (e) { setFailure(artifactError(e)) } finally { setBusy(false) }
      }}>{busy ? 'Saving…' : action === 'attach' ? 'Use version ' + value.latestRevision : 'Detach reference'}</button></div>
    {view && <ArtifactDetails projectId={value.projectId} id={value.id} revision={value.latestRevision} onClose={() => setView(false)} />}
  </Modal>
}
type Dialog = { kind: 'picker' } | { kind: 'view' | 'attach' | 'detach'; value: Artifact }
function ConnectedTaskArtifacts({ projectId, taskId, areaId }: { projectId: string; taskId: string; areaId: string }) {
  const [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0), [dialog, setDialog] = useState<Dialog | null>(null)
  const { data, loading, error } = useAsync(() => db.getTaskArtifacts(projectId, taskId, offset), [projectId, taskId, offset, attempt])
  const close = () => setDialog(null), saved = () => { close(); setAttempt(n => n + 1) }
  return <section aria-label="Task drawings and references"><h2>Drawings & references</h2>
    {loading ? <Loading /> : error ? <ArtifactRetry error={error} retry={() => setAttempt(n => n + 1)} /> : <>
      {!data?.items.length && <p>No drawing/reference attached on this page.</p>}
      <div className="fact-list">{data?.items.map(v => <article className="card fact-card" key={v.id} aria-label={v.title}>
        <h3>{v.title}</h3><ArtifactStatus value={v} />
        <p className="foundation-hint">Attached by {v.linkedBy} · {new Date(v.linkedAt!).toLocaleString()}</p>
        <div className="foundation-actions"><button className="btn" onClick={() => setDialog({ kind: 'view', value: v })}>View attached version</button>
          {v.latestRevision !== v.revision && !v.currentlyArchived && <button className="btn" onClick={() => setDialog({ kind: 'attach', value: v })}>Update reference</button>}
          <button className="btn" onClick={() => setDialog({ kind: 'detach', value: v })}>Detach</button></div>
      </article>)}</div><ArtifactPager offset={offset} more={Boolean(data?.hasMore)} move={setOffset} />
    </>}
    <div className="foundation-actions"><button className="btn" onClick={() => setDialog({ kind: 'picker' })}>Attach drawing/reference</button>
      <Link className="btn" to={'/artifacts?area=' + encodeURIComponent(areaId)}>Manage drawings & references</Link></div>
    {dialog?.kind === 'picker' && <Picker projectId={projectId} taskId={taskId} onClose={close} onSaved={saved} />}
    {dialog?.kind === 'view' && <ArtifactDetails projectId={projectId} id={dialog.value.id} revision={dialog.value.revision} onClose={close} />}
    {(dialog?.kind === 'attach' || dialog?.kind === 'detach') && <ChangeLink value={dialog.value} action={dialog.kind} onClose={close} onSaved={saved} />}
  </section>
}
export function TaskArtifacts(props: { projectId: string; taskId: string; areaId: string }) {
  if (!db.authEnabled()) return <section><h2>Drawings & references</h2><p>This demo does not save drawing/reference links.</p></section>
  return <ConnectedTaskArtifacts key={props.projectId + ':' + props.taskId} {...props} />
}
