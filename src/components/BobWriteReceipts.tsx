import { Link } from 'react-router-dom'
import type { ProjectWriteReceipt } from '../data/provenance'

/** Useful navigation from verified receipts; save diagnostics stay out of chat. */
export function BobWriteReceipts({ receipts, onOpenDrawing }: { receipts?: ProjectWriteReceipt[]; onOpenDrawing?: () => void }) {
  const links = receipts?.filter(receipt => ['building_context','stock','requirements','materials','events','tasks'].includes(receipt.dataset) || (receipt.dataset === 'artifacts' && receipt.revision))
  if (!links?.length) return null
  return <div className="bob-saved-links">{links.map(receipt =>
    <Link key={`${receipt.dataset}:${receipt.recordId}:${receipt.revision ?? ''}:${receipt.savedAt}`}
      onClick={onOpenDrawing} title={receipt.label}
      to={receipt.dataset === 'building_context'
        ? `/building?building=${encodeURIComponent(receipt.recordId)}`
        : receipt.dataset==='tasks'?`/tasks/${encodeURIComponent(receipt.recordId)}`
        : receipt.dataset==='events'?'/events'
        : ['stock','requirements'].includes(receipt.dataset)?'/material-plan'
        : receipt.dataset==='materials'?'/shopping'
        : `/artifacts?drawing=${encodeURIComponent(receipt.recordId)}&revision=${receipt.revision}${receipt.areaId ? `&area=${encodeURIComponent(receipt.areaId)}` : ''}`}>
      {receipt.dataset === 'building_context' ? 'Open building context'
        : receipt.dataset==='tasks'?`Open task · ${receipt.label}`
        : receipt.dataset==='events'?'Open build days'
        : ['stock','requirements'].includes(receipt.dataset)?'Open material plan'
        : receipt.dataset==='materials'?'Open Shopping':`Open drawing · v${receipt.revision}`}
    </Link>,
  )}</div>
}
