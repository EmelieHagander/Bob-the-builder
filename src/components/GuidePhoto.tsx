import { useEffect, useState } from 'react'
import * as db from '../data/database'
import type { MediaTarget } from '../data/types'
import { IMAGE_PURPOSES, StoredImage } from './ProjectImages'
import { Modal } from './Modal'
import { useAsync, useProjectVersion } from './ui'

/** Only media attached to this exact instruction or plan step can illustrate it. */
export function GuidePhoto({ projectId, target }: { projectId: string; target: MediaTarget }) {
  const version = useProjectVersion(), [retry, setRetry] = useState(0), [open, setOpen] = useState(false)
  useEffect(() => {
    const refresh = () => setRetry(n => n + 1)
    window.addEventListener(db.MEDIA_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(db.MEDIA_CHANGED_EVENT, refresh)
  }, [])
  const {data, error, loading} = useAsync(() => db.getProjectImages(projectId, target, 0, true), [projectId, target.kind, target.id, retry, version])
  if (loading) return null
  if (error) return <button className="btn" onClick={() => setRetry(n => n+1)}>Retry step image</button>
  const photos = data?.items.filter(img => img.state === 'ready' && img.links.some(link => link.kind === target.kind && link.targetId === target.id)) ?? []
  const photo = photos.find(img => img.purpose === 'instruction') ?? photos[0]
  if (!photo) return null
  return <figure className="guide-photo">
    <button type="button" className="guide-image" aria-label={`Open image: ${photo.title}`} onClick={() => setOpen(true)}>
      <StoredImage projectId={projectId} image={photo} allowRetry={false} />
    </button>
    <figcaption>{IMAGE_PURPOSES[photo.purpose]} · {photo.title}{photo.sourceKind === 'ai_generated' && ' · AI illustration'}</figcaption>
    {open && <Modal title={photo.title} wide onClose={() => setOpen(false)}><StoredImage projectId={projectId} image={photo} original zoomable /></Modal>}
  </figure>
}
