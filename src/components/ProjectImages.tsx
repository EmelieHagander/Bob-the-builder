import { useEffect, useRef, useState } from 'react'
import * as db from '../data/database'
import type { MediaAsset, MediaPurpose, MediaTarget } from '../data/types'
import { Field, FormError, inputStyle } from './form'
import { Modal } from './Modal'
import { Icon } from './ui'

export const IMAGE_PURPOSES: Record<MediaPurpose, string> = {
  current_state: 'Current state', reference: 'Reference', instruction: 'Instruction',
  proposal: 'Proposal', progress: 'Progress', as_built: 'As built',
}
const message = (err: unknown) => err instanceof Error ? err.message : String(err)

/** URLs last only as long as this view; an open original performs a new authorised read. */
function StoredImage({ projectId, image, original = false }: { projectId: string; image: MediaAsset; original?: boolean }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true, objectUrl = ''
    setUrl(''); setError('')
    db.downloadProjectImage(projectId, image.id).then(blob => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(err => { if (active) setError(message(err)) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [projectId, image.id, attempt])
  if (error) return <span className="image-failure" role="alert">{error}
    <button type="button" className="btn" onClick={e => { e.stopPropagation(); setAttempt(n => n + 1) }}>Retry image</button>
  </span>
  if (!url) return <span className="image-loading" role="status">Loading image…</span>
  return <img src={url} alt={image.title} className={original ? 'project-image-original' : 'project-image-thumbnail'}
    onError={() => setError('The stored image could not be displayed. Try loading it again.')} />
}

function UploadImage({ projectId, target, onClose, onSaved }: { projectId: string; target: MediaTarget; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState<MediaPurpose>(target.kind === 'step' || target.kind === 'task' ? 'instruction' : 'current_state')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title="Add image" onClose={() => { if (!busy) onClose() }}>
    <form className="foundation-form" onSubmit={async e => {
      e.preventDefault(); if (!file || busy) return
      setBusy(true); setError('')
      try { await db.uploadProjectImage(projectId, target, file, purpose, title); onSaved() }
      catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}>
      <Field label="Image file">
        <input type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy}
          onChange={e => { const chosen = e.target.files?.[0] ?? null; setFile(chosen); if (chosen) setTitle(chosen.name.replace(/\.[^.]+$/, '').slice(0, 200)) }} />
      </Field>
      <p className="foundation-hint">JPEG, PNG or WebP, up to 6 MiB. The complete original is kept.</p>
      <Field label="Image title"><input style={inputStyle} value={title} maxLength={200} required disabled={busy} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label="Image purpose"><select style={inputStyle} value={purpose} disabled={busy} onChange={e => setPurpose(e.target.value as MediaPurpose)}>
        {Object.entries(IMAGE_PURPOSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></Field>
      {error && <FormError>{error}</FormError>}
      {busy && <p role="status">Saving image…</p>}
      <div className="foundation-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !file}>{busy ? 'Saving…' : 'Save image'}</button></div>
    </form>
  </Modal>
}

export function ProjectImages({ projectId, target, title = 'Images', selectImage }: {
  projectId: string; target: MediaTarget; title?: string; selectImage?: (image: MediaAsset) => Promise<void>
}) {
  const [items, setItems] = useState<MediaAsset[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [dialog, setDialog] = useState<{ kind: 'upload' | 'choose' } | { kind: 'view' | 'remove'; image: MediaAsset } | null>(null)
  const generation = useRef(0)
  const reload = () => setVersion(v => v + 1)
  useEffect(() => {
    const listener = () => reload()
    window.addEventListener(db.MEDIA_CHANGED_EVENT, listener)
    return () => window.removeEventListener(db.MEDIA_CHANGED_EVENT, listener)
  }, [])
  useEffect(() => {
    const current = ++generation.current
    setLoading(true); setError('')
    db.getProjectImages(projectId, target).then(page => {
      if (generation.current === current) { setItems(page.items); setMore(page.hasMore) }
    }).catch(err => { if (generation.current === current) { setItems([]); setError(message(err)) } })
      .finally(() => { if (generation.current === current) setLoading(false) })
    return () => { generation.current++ }
  }, [projectId, target.kind, target.id, version])
  async function act(action: () => Promise<unknown>, close = false, refresh = true) {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); if (close) setDialog(null); if (refresh) reload() }
    catch (err) { setError(message(err)) } finally { setBusy(false) }
  }
  const shown = selectImage ? items.filter(image => image.state === 'ready') : items
  return <section className="project-images" aria-label={title}>
    <div className="foundation-heading"><h3>{title}</h3>
      {!selectImage && <div className="foundation-actions">
        {target.kind !== 'project' && <button className="btn" disabled={!db.authEnabled() || busy} onClick={() => setDialog({ kind: 'choose' })}>Attach existing</button>}
        <button className="btn btn-primary" disabled={!db.authEnabled() || busy} onClick={() => setDialog({ kind: 'upload' })}><Icon name="plus" size={16} /> Add image</button>
      </div>}
    </div>
    {!db.authEnabled() && <p className="foundation-hint">This demo does not save images. Open a connected project to add them.</p>}
    {error && <div role="alert"><FormError>{error}</FormError><button className="btn" onClick={reload}>Reload images</button></div>}
    {loading && <p role="status">Loading images…</p>}
    {!loading && !error && !shown.length && <p className="foundation-hint">No {selectImage ? 'completed uploads' : 'images'} here yet.</p>}
    <div className="project-image-grid">
      {shown.map(image => <article className="project-image-card" key={image.id}>
        {image.state === 'ready' ? <div className="project-image-preview">
          <StoredImage projectId={projectId} image={image} />
          <button type="button" className="image-open btn" aria-label={'Open image: ' + image.title} onClick={() => setDialog({ kind: 'view', image })}>View original</button>
        </div> : <div className="image-loading" role="status">{image.state === 'pending' ? 'Upload incomplete' : 'Removal in progress'}</div>}
        <div className="project-image-caption"><strong>{image.title}</strong>
          <span className="image-purpose">{IMAGE_PURPOSES[image.purpose]}</span>
          <span className="foundation-hint">Uploaded {new Date(image.createdAt).toLocaleDateString()}</span>
        </div>
        <div className="foundation-actions">
          {selectImage ? <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => selectImage(image))}>Use image</button> : <>
            {image.state === 'pending' && <button className="btn" disabled={busy} onClick={() => void act(() => db.finalizeProjectImage(projectId, image.id))}>Check upload</button>}
            {image.state === 'ready' && target.kind !== 'project' && image.links.filter(l => l.kind === target.kind && l.targetId === target.id).map(link =>
              <button key={link.id} className="btn" disabled={busy} onClick={() => void act(() => db.unlinkProjectImage(projectId, image.id, link.id))}>Detach image</button>)}
            {(target.kind === 'project' || image.state !== 'ready') && <button className="btn" disabled={busy} onClick={() => setDialog({ kind: 'remove', image })}>
              {image.state === 'deleting' ? 'Retry removal' : 'Remove image'}</button>}
          </>}
        </div>
      </article>)}
    </div>
    {more && <button className="btn" disabled={busy || loading} onClick={() => {
      const current = generation.current
      void act(async () => {
        const page = await db.getProjectImages(projectId, target, items.length)
        if (current === generation.current) {
          setItems(previous => [...previous, ...page.items.filter(i => !previous.some(p => p.id === i.id))]); setMore(page.hasMore)
        }
      }, false, false)
    }}>Load more images</button>}
    {dialog?.kind === 'upload' && <UploadImage projectId={projectId} target={target} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reload() }} />}
    {dialog?.kind === 'choose' && <Modal title="Choose a project image" onClose={() => setDialog(null)}>
      <ProjectImages projectId={projectId} target={{ kind: 'project', id: projectId }} title="Project images"
        selectImage={async image => { await db.attachProjectImage(projectId, image.id, target); setDialog(null); reload() }} />
    </Modal>}
    {dialog?.kind === 'view' && <Modal title={dialog.image.title} wide onClose={() => setDialog(null)}>
      <StoredImage projectId={projectId} image={dialog.image} original />
      <p className="foundation-hint">{IMAGE_PURPOSES[dialog.image.purpose]} · {dialog.image.width} × {dialog.image.height} pixels · {dialog.image.originalName}</p>
    </Modal>}
    {dialog?.kind === 'remove' && <Modal title="Remove image?" onClose={() => { if (!busy) setDialog(null) }}>
      <p>This removes “{dialog.image.title}” from the project and all its task, step and area attachments.</p>
      {error && <FormError>{error}</FormError>}
      <div className="foundation-actions"><button className="btn" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => db.removeProjectImage(projectId, dialog.image.id), true)}>{busy ? 'Removing…' : 'Remove from project'}</button></div>
    </Modal>}
  </section>
}
