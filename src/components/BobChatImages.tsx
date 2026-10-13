import { useState } from 'react'
import { StoredImage } from './ProjectImages'
import { Modal } from './Modal'

/** Originals stay behind the existing authenticated project-media reader. */
export function BobChatImages({ projectId, ids, label = 'Attached image' }: { projectId: string; ids?: string[]; label?: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  if (!ids?.length) return null
  return <>
    <div className="bob-chat-images">{ids.map((id, i) => <button type="button" className="bob-chat-image" key={id}
      aria-label={`Open ${label.toLowerCase()} ${i + 1}`} onClick={() => setSelected(id)}>
      <StoredImage projectId={projectId} image={{ id, title: `${label} ${i + 1}` }} original allowRetry={false} />
    </button>)}</div>
    {selected && <Modal title={label} layer={100} onClose={() => setSelected(null)}>
      <StoredImage projectId={projectId} image={{ id: selected, title: label }} original />
    </Modal>}
  </>
}
