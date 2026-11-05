import { useState } from 'react'
import type { MediaAsset } from '../data/types'
import { IMAGE_PURPOSES, StoredImage } from './ProjectImages'
import { Modal } from './Modal'
import { Icon } from './ui'

export function GuidePhoto({ projectId, photo, taskPhoto }: { projectId: string; photo: MediaAsset; taskPhoto: boolean }) {
  const [open, setOpen] = useState(false)
  return <figure className="guide-photo">
    <button type="button" className="guide-image" aria-label={`Open image: ${photo.title}`} onClick={() => setOpen(true)}>
      <StoredImage projectId={projectId} image={photo} allowRetry={false} />
      <span className="guide-expand" aria-hidden="true"><Icon name="arrows-out" size={18}/></span>
    </button>
    <figcaption>{taskPhoto ? 'Task photo' : IMAGE_PURPOSES[photo.purpose]} · {photo.title}{photo.sourceKind === 'ai_generated' && ' · AI illustration'}</figcaption>
    {open && <Modal title={photo.title} wide onClose={() => setOpen(false)}><StoredImage projectId={projectId} image={photo} original zoomable /></Modal>}
  </figure>
}
